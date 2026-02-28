import { randomUUID } from 'crypto';
import { join } from 'path';
import type { SerialConfig, SerialSession, SerialPortInfo } from '../../shared/types';

// Lazy-load serialport to avoid vite hoisting the require to the top of the bundle.
// The module path fix in index.ts must run first.
let _SerialPort: typeof import('serialport').SerialPort | null = null;
let _serialportUnavailable = false;
function getSerialPort(): typeof import('serialport').SerialPort | null {
  if (_serialportUnavailable) return null;
  if (!_SerialPort) {
    try {
      // serialport is externalized by electron-vite, so require() works at runtime.
      // Use eval to prevent vite from analyzing/transforming this require call.
      const sp = eval("require('serialport')");
      _SerialPort = sp.SerialPort;
    } catch (err) {
      console.warn('[Serial] serialport module not available:', (err as Error).message);
      _serialportUnavailable = true;
      return null;
    }
  }
  return _SerialPort!;
}

interface SessionEntry {
  session: SerialSession;
  port: any; // SerialPort instance (null for virtual)
  dataCallbacks: Array<(data: Buffer) => void>;
  closeCallbacks: Array<() => void>;
  errorCallbacks: Array<(error: string) => void>;
  virtualTimer?: ReturnType<typeof setInterval>;
}

/** CRC16/Modbus for virtual slave responses */
function crc16modbus(buf: number[]): number {
  let crc = 0xFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xA001 : crc >> 1;
  }
  return crc;
}

/** Build a simulated Modbus slave response for virtual port */
function buildVirtualModbusResponse(req: Buffer): Buffer {
  const bytes = Array.from(req);
  // Minimum Modbus RTU frame: slave(1) + fc(1) + data(2+) + crc(2) = 6
  if (bytes.length < 6) return req; // not a valid frame, echo back

  const slave = bytes[0];
  const fc = bytes[1];
  const startAddr = (bytes[2] << 8) | bytes[3];
  const quantity = (bytes[4] << 8) | bytes[5];

  let resp: number[];

  switch (fc) {
    case 1: // Read Coils
    case 2: { // Read Discrete Inputs
      const byteCount = Math.ceil(quantity / 8);
      resp = [slave, fc, byteCount];
      for (let i = 0; i < byteCount; i++) resp.push(Math.floor(Math.random() * 256));
      break;
    }
    case 3: // Read Holding Registers
    case 4: { // Read Input Registers
      const byteCount = quantity * 2;
      resp = [slave, fc, byteCount];
      for (let i = 0; i < quantity; i++) {
        // Simulate register values: address-based pattern + small random variation
        const val = ((startAddr + i) * 10 + Math.floor(Math.random() * 50)) & 0xFFFF;
        resp.push((val >> 8) & 0xFF, val & 0xFF);
      }
      break;
    }
    case 5: // Write Single Coil
    case 6: { // Write Single Register
      // Echo request (slave + fc + addr + value)
      resp = [slave, fc, bytes[2], bytes[3], bytes[4], bytes[5]];
      break;
    }
    case 15: // Write Multiple Coils
    case 16: { // Write Multiple Registers
      // Echo slave + fc + addr + quantity
      resp = [slave, fc, bytes[2], bytes[3], bytes[4], bytes[5]];
      break;
    }
    default:
      // Unsupported FC → exception response (error code 0x01 = illegal function)
      resp = [slave, fc | 0x80, 0x01];
      break;
  }

  const crc = crc16modbus(resp);
  resp.push(crc & 0xFF, (crc >> 8) & 0xFF);
  return Buffer.from(resp);
}

export class SerialService {
  private sessions: Map<string, SessionEntry> = new Map();

  async listPorts(): Promise<SerialPortInfo[]> {
    const SP = getSerialPort();
    if (!SP) return [];
    const ports = await SP.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      serialNumber: p.serialNumber,
      pnpId: p.pnpId,
      vendorId: p.vendorId,
      productId: p.productId,
    }));
  }

  open(config: SerialConfig): Promise<SerialSession> {
    // Virtual mode — no real hardware
    if (config.path === 'VIRTUAL') {
      return this.openVirtual(config);
    }
    return this.openReal(config);
  }

  private openVirtual(config: SerialConfig): Promise<SerialSession> {
    const id = randomUUID();
    const session: SerialSession = {
      id,
      config,
      status: 'open',
      createdAt: new Date().toISOString(),
      dtr: true,
      rts: true,
    };

    const entry: SessionEntry = {
      session,
      port: null,
      dataCallbacks: [],
      closeCallbacks: [],
      errorCallbacks: [],
    };
    this.sessions.set(id, entry);

    // Simulate periodic data: send a counter + timestamp every 2 seconds
    let counter = 0;
    entry.virtualTimer = setInterval(() => {
      counter++;
      const ts = new Date().toLocaleTimeString();
      const line = `[Virtual] #${counter} ${ts} | RX: ${(Math.random() * 100).toFixed(1)}%\r\n`;
      const buf = Buffer.from(line, 'utf-8');
      entry.dataCallbacks.forEach((cb) => cb(buf));
    }, 2000);

    return Promise.resolve(session);
  }

  private openReal(config: SerialConfig): Promise<SerialSession> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const session: SerialSession = {
        id,
        config,
        status: 'opening',
        createdAt: new Date().toISOString(),
        dtr: true,
        rts: true,
      };

      const SP = getSerialPort();
      if (!SP) {
        reject(new Error('serialport module is not available'));
        return;
      }

      const port = new SP({
        path: config.path,
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity,
        rtscts: config.rtscts,
        xon: config.xon,
        xoff: config.xoff,
        autoOpen: false,
      });

      const entry: SessionEntry = {
        session,
        port,
        dataCallbacks: [],
        closeCallbacks: [],
        errorCallbacks: [],
      };
      this.sessions.set(id, entry);

      port.open((err) => {
        if (err) {
          session.status = 'error';
          session.error = err.message;
          reject(new Error(err.message));
          return;
        }
        session.status = 'open';
        resolve(session);
      });

      port.on('data', (data: Buffer) => {
        entry.dataCallbacks.forEach((cb) => cb(data));
      });

      port.on('error', (err) => {
        session.status = 'error';
        session.error = err.message;
        entry.errorCallbacks.forEach((cb) => cb(err.message));
      });

      port.on('close', () => {
        session.status = 'closed';
        entry.closeCallbacks.forEach((cb) => cb());
      });
    });
  }

  write(sessionId: string, data: Buffer): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    // Virtual mode: simulate Modbus slave response
    if (!entry.port) {
      setTimeout(() => {
        const resp = buildVirtualModbusResponse(data);
        entry.dataCallbacks.forEach((cb) => cb(resp));
      }, 20);
      return;
    }
    if (!entry.port.isOpen) return;
    entry.port.write(data);
  }

  close(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    if (entry.virtualTimer) {
      clearInterval(entry.virtualTimer);
    }
    if (entry.port && entry.port.isOpen) {
      entry.port.close();
    }
    entry.session.status = 'closed';
    entry.closeCallbacks.forEach((cb) => cb());
    this.sessions.delete(sessionId);
  }

  setDTR(sessionId: string, value: boolean): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.session.dtr = value;
    if (entry.port && entry.port.isOpen) {
      entry.port.set({ dtr: value });
    }
  }

  setRTS(sessionId: string, value: boolean): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.session.rts = value;
    if (entry.port && entry.port.isOpen) {
      entry.port.set({ rts: value });
    }
  }

  onData(sessionId: string, callback: (data: Buffer) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.dataCallbacks.push(callback);
  }

  onClose(sessionId: string, callback: () => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.closeCallbacks.push(callback);
  }

  onError(sessionId: string, callback: (error: string) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.errorCallbacks.push(callback);
  }
}
