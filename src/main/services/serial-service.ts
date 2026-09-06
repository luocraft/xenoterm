import { randomUUID } from 'crypto';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import type { SerialConfig, SerialSession, SerialPortInfo } from '../../shared/types';

/**
 * Communicates with a child Node.js process (serial-worker.js) that loads
 * the native `serialport` module.
 *
 * In packaged builds we run the worker with the app executable itself under
 * `ELECTRON_RUN_AS_NODE=1`, so users do not need a separate Node.js runtime.
 * The worker and its serialport dependencies are shipped as extra resources.
 */

interface PendingCall {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

interface SessionEntry {
  session: SerialSession;
  dataCallbacks: Array<(data: Buffer) => void>;
  closeCallbacks: Array<() => void>;
  errorCallbacks: Array<(error: string) => void>;
  virtualTimer?: ReturnType<typeof setInterval>;
}

/** CRC16/Modbus for virtual slave responses */
function crc16modbus(buf: number[]): number {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
}

/** Build a simulated Modbus slave response for virtual port */
function buildVirtualModbusResponse(req: Buffer): Buffer {
  const bytes = Array.from(req);
  if (bytes.length < 6) return req;
  const slave = bytes[0];
  const fc = bytes[1];
  const startAddr = (bytes[2] << 8) | bytes[3];
  const quantity = (bytes[4] << 8) | bytes[5];
  let resp: number[];
  switch (fc) {
    case 1:
    case 2: {
      const byteCount = Math.ceil(quantity / 8);
      resp = [slave, fc, byteCount];
      for (let i = 0; i < byteCount; i++) resp.push(Math.floor(Math.random() * 256));
      break;
    }
    case 3:
    case 4: {
      const byteCount2 = quantity * 2;
      resp = [slave, fc, byteCount2];
      for (let i = 0; i < quantity; i++) {
        const val = ((startAddr + i) * 10 + Math.floor(Math.random() * 50)) & 0xffff;
        resp.push((val >> 8) & 0xff, val & 0xff);
      }
      break;
    }
    case 5:
    case 6:
      resp = [slave, fc, bytes[2], bytes[3], bytes[4], bytes[5]];
      break;
    case 15:
    case 16:
      resp = [slave, fc, bytes[2], bytes[3], bytes[4], bytes[5]];
      break;
    default:
      resp = [slave, fc | 0x80, 0x01];
      break;
  }
  const crc = crc16modbus(resp);
  resp.push(crc & 0xff, (crc >> 8) & 0xff);
  return Buffer.from(resp);
}

export class SerialService {
  private sessions: Map<string, SessionEntry> = new Map();
  private worker: ChildProcess | null = null;
  private pending: Map<number, PendingCall> = new Map();
  private nextId = 1;
  private workerBuf = '';

  private getWorkerScriptPath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'serial-worker', 'serial-worker.js');
    }
    const projectRoot = join(__dirname, '..', '..', '..');
    return join(projectRoot, 'src', 'main', 'services', 'serial-worker.js');
  }

  private getNodePath(): string {
    // In development, Electron's embedded Node has trouble resolving the
    // serialport package in this project, while the system Node works.
    // In packaged builds, use the app executable itself as a Node runtime so
    // end users do not need a separate Node.js install.
    return app.isPackaged ? process.execPath : 'node';
  }

  private ensureWorker(): ChildProcess {
    if (this.worker && !this.worker.killed) return this.worker;

    const scriptPath = this.getWorkerScriptPath();
    const nodePath = this.getNodePath();
    const cwd = app.isPackaged
      ? join(process.resourcesPath, 'serial-worker')
      : join(__dirname, '..', '..', '..');
    console.log('[Serial] Spawning worker:', nodePath, scriptPath, 'cwd:', cwd);

    try {
      this.worker = spawn(nodePath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        env: app.isPackaged
          ? {
              ...process.env,
              ELECTRON_RUN_AS_NODE: '1',
            }
          : {
              ...process.env,
            },
        windowsHide: true,
      });
    } catch (err) {
      console.error('[Serial] Failed to spawn worker:', (err as Error).message);
      throw new Error('Failed to start serial worker process');
    }

    this.worker.on('error', (err) => {
      console.error('[Serial] Worker process error:', err.message);
      this.worker = null;
      for (const [, p] of this.pending) {
        p.reject(new Error('Worker process error: ' + err.message));
      }
      this.pending.clear();
    });

    this.worker.stdout!.setEncoding('utf8');
    this.worker.stdout!.on('data', (chunk: string) => {
      this.workerBuf += chunk;
      let nl: number;
      while ((nl = this.workerBuf.indexOf('\n')) !== -1) {
        const line = this.workerBuf.slice(0, nl).trim();
        this.workerBuf = this.workerBuf.slice(nl + 1);
        if (line) this.handleWorkerMessage(line);
      }
    });

    this.worker.stderr!.setEncoding('utf8');
    this.worker.stderr!.on('data', (data: string) => {
      console.warn('[Serial Worker stderr]', data.trim());
    });

    this.worker.on('exit', (code) => {
      console.log('[Serial] Worker exited with code', code);
      this.worker = null;
      // Reject all pending calls
      for (const [id, p] of this.pending) {
        p.reject(new Error('Worker process exited'));
      }
      this.pending.clear();
    });

    return this.worker;
  }

  private handleWorkerMessage(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // RPC response
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      }
      return;
    }

    // Event from worker
    if (msg.event && msg.sessionId) {
      const entry = this.sessions.get(msg.sessionId);
      if (!entry) return;
      switch (msg.event) {
        case 'data': {
          const buf = Buffer.from(msg.data, 'base64');
          entry.dataCallbacks.forEach((cb) => cb(buf));
          break;
        }
        case 'error':
          entry.session.status = 'error';
          entry.session.error = msg.data;
          entry.errorCallbacks.forEach((cb) => cb(msg.data));
          break;
        case 'close':
          entry.session.status = 'closed';
          entry.closeCallbacks.forEach((cb) => cb());
          this.sessions.delete(msg.sessionId);
          break;
      }
    }
  }

  private call(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      let w: ChildProcess;
      try {
        w = this.ensureWorker();
      } catch (err) {
        reject(err);
        return;
      }
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Serial worker call '${method}' timed out`));
      }, 10000);
      this.pending.set(id, {
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });
      const msg = JSON.stringify({ id, method, params }) + '\n';
      try {
        w.stdin!.write(msg);
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new Error('Failed to write to serial worker: ' + (err as Error).message));
      }
    });
  }

  async listPorts(): Promise<SerialPortInfo[]> {
    try {
      return await this.call('list');
    } catch (err) {
      console.warn('[Serial] listPorts failed:', (err as Error).message);
      return [];
    }
  }

  open(config: SerialConfig): Promise<SerialSession> {
    if (config.path === 'VIRTUAL') return this.openVirtual(config);
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
      dataCallbacks: [],
      closeCallbacks: [],
      errorCallbacks: [],
    };
    this.sessions.set(id, entry);
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

  private async openReal(config: SerialConfig): Promise<SerialSession> {
    const id = randomUUID();
    const session: SerialSession = {
      id,
      config,
      status: 'opening',
      createdAt: new Date().toISOString(),
      dtr: true,
      rts: true,
    };
    const entry: SessionEntry = {
      session,
      dataCallbacks: [],
      closeCallbacks: [],
      errorCallbacks: [],
    };
    this.sessions.set(id, entry);

    try {
      await this.call('open', { sessionId: id, config });
      session.status = 'open';
      return session;
    } catch (err) {
      session.status = 'error';
      session.error = (err as Error).message;
      throw err;
    }
  }

  write(sessionId: string, data: Buffer): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    if (!entry.session.config || entry.session.config.path === 'VIRTUAL') {
      // Virtual mode
      if (entry.virtualTimer !== undefined) {
        setTimeout(() => {
          const resp = buildVirtualModbusResponse(data);
          entry.dataCallbacks.forEach((cb) => cb(resp));
        }, 20);
      }
      return;
    }
    this.call('write', { sessionId, data: data.toString('base64') }).catch((err) => {
      console.warn('[Serial] write error:', err.message);
    });
  }

  close(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    if (entry.virtualTimer) clearInterval(entry.virtualTimer);
    if (entry.session.config?.path !== 'VIRTUAL') {
      this.call('close', { sessionId }).catch(() => {});
    }
    entry.session.status = 'closed';
    entry.closeCallbacks.forEach((cb) => cb());
    this.sessions.delete(sessionId);
  }

  setDTR(sessionId: string, value: boolean): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.session.dtr = value;
    if (entry.session.config?.path !== 'VIRTUAL') {
      this.call('set', { sessionId, signals: { dtr: value } }).catch(() => {});
    }
  }

  setRTS(sessionId: string, value: boolean): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.session.rts = value;
    if (entry.session.config?.path !== 'VIRTUAL') {
      this.call('set', { sessionId, signals: { rts: value } }).catch(() => {});
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

  /** Kill the worker process (call on app quit) */
  dispose(): void {
    if (this.worker && !this.worker.killed) {
      this.worker.kill();
      this.worker = null;
    }
  }
}
