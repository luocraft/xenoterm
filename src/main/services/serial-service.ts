import { randomUUID } from 'crypto';
import { join } from 'path';
import type { SerialConfig, SerialSession, SerialPortInfo } from '../../shared/types';

// Lazy-load serialport to avoid vite hoisting the require to the top of the bundle.
// The module path fix in index.ts must run first.
let _SerialPort: typeof import('serialport').SerialPort | null = null;
function getSerialPort(): typeof import('serialport').SerialPort {
  if (!_SerialPort) {
    // Use Function constructor to prevent vite from analyzing/hoisting this require
    const dynamicRequire = new Function('mod', 'return require(mod)') as (mod: string) => any;
    const sp = dynamicRequire('serialport');
    _SerialPort = sp.SerialPort;
  }
  return _SerialPort!;
}

interface SessionEntry {
  session: SerialSession;
  port: any; // SerialPort instance
  dataCallbacks: Array<(data: Buffer) => void>;
  closeCallbacks: Array<() => void>;
  errorCallbacks: Array<(error: string) => void>;
}

export class SerialService {
  private sessions: Map<string, SessionEntry> = new Map();

  async listPorts(): Promise<SerialPortInfo[]> {
    const SP = getSerialPort();
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

      const port = new (getSerialPort())({
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
    if (!entry || !entry.port.isOpen) return;
    entry.port.write(data);
  }

  close(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    if (entry.port.isOpen) {
      entry.port.close();
    }
    entry.session.status = 'closed';
    entry.closeCallbacks.forEach((cb) => cb());
    this.sessions.delete(sessionId);
  }

  setDTR(sessionId: string, value: boolean): void {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.port.isOpen) return;
    entry.port.set({ dtr: value });
    entry.session.dtr = value;
  }

  setRTS(sessionId: string, value: boolean): void {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.port.isOpen) return;
    entry.port.set({ rts: value });
    entry.session.rts = value;
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
