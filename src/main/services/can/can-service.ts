/**
 * CAN service - manages drivers, sessions, polling, and event dispatch.
 */
import { randomUUID } from 'crypto';
import type { CanDriver, CanFrame, CanOpenConfig, CanDeviceType } from './can-driver.interface';
import { decodeCanErrCode } from './can-driver.interface';
import { ZlgCanDriver } from './can-driver-zlg';
import { ZlgControlCanDriver } from './can-driver-zlg-control';
import { GcCanDriver } from './can-driver-gc';
import { GcCanFdDriver } from './can-driver-gc-fd';
import type { CanFdOpenConfig } from './can-driver-gc-fd';
import { VirtualCanDriver } from './can-driver-virtual';
import { TosunCanDriver } from './can-driver-tosun';
import { parseDbc, type DbcDatabase } from './dbc-parser';
import { readFileSync } from 'fs';
import { type IsoTpConfig } from './iso-tp';
import { UdsService, type UdsResponse, type UdsLogEntry } from './uds-service';

const CAN_POLL_INTERVAL_MS = 1;
const CAN_POLL_BATCH_SIZE = 200;

export interface CanSession {
  id: string;
  driverName: string;
  deviceType: number;
  deviceIndex: number;
  channel: number;
  baudRate: number;
  status: 'connected' | 'closed' | 'error';
}

interface SessionState {
  session: CanSession;
  driver: CanDriver;
  channel: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  onData: ((frames: CanFrame[]) => void) | null;
  onError: ((error: string) => void) | null;
  onBusError: ((info: { errCode: number; errTypes: string[]; timestamp: number }) => void) | null;
  lastErrCode?: number;
}

export class CanService {
  private drivers: Map<string, CanDriver> = new Map();
  private sessions: Map<string, SessionState> = new Map();
  private udsInstances: Map<string, UdsService> = new Map();

  constructor() {
    const zlg = new ZlgCanDriver();
    const zlgControl = new ZlgControlCanDriver();
    const gc = new GcCanDriver();
    const gcFd = new GcCanFdDriver();
    const virtual_ = new VirtualCanDriver();
    const tosun = new TosunCanDriver();
    this.drivers.set(zlg.name, zlg);
    this.drivers.set(zlgControl.name, zlgControl);
    this.drivers.set(gc.name, gc);
    this.drivers.set(gcFd.name, gcFd);
    this.drivers.set(virtual_.name, virtual_);
    this.drivers.set(tosun.name, tosun);
  }

  listDrivers(): { name: string; available: boolean }[] {
    return Array.from(this.drivers.entries()).map(([name, d]) => ({
      name,
      available: d.isAvailable(),
    }));
  }

  getDeviceTypes(driverName: string): CanDeviceType[] {
    const driver = this.drivers.get(driverName);
    if (!driver) throw new Error('Unknown driver: ' + driverName);
    return driver.getDeviceTypes();
  }
  open(driverName: string, config: CanOpenConfig, fdConfig?: CanFdOpenConfig): CanSession | CanSession[] {
    const driver = this.drivers.get(driverName);
    if (!driver) throw new Error('Unknown driver: ' + driverName);
    if (!driver.isAvailable()) throw new Error('Driver ' + driverName + ' DLL not found.');

    const existingSessions = Array.from(this.sessions.values()).filter(
      (s) => s.driver === driver && s.session.status === 'connected'
    );
    if (existingSessions.length > 0) {
      throw new Error('Driver ' + driverName + ' is already connected.');
    }

    if (fdConfig && driver instanceof GcCanFdDriver) {
      driver.setFdConfig(fdConfig);
    }

    driver.open(config);

    const chCount = 'getChannelCount' in driver ? (driver as any).getChannelCount() as number : 1;
    const isMultiChannel = chCount > 1;
    const channelsToCreate = isMultiChannel ? Array.from({ length: chCount }, (_, i) => i) : [config.channel];

    const sessions: CanSession[] = channelsToCreate.map((ch) => {
      const ch1Baud = fdConfig?.ch1BaudRate ?? config.ch1BaudRate;
      const chBaud = config.chBaudRates?.[ch] ?? (ch === 1 && ch1Baud ? ch1Baud : config.baudRate);
      const session: CanSession = {
        id: randomUUID(),
        driverName,
        deviceType: config.deviceType,
        deviceIndex: config.deviceIndex,
        channel: ch,
        baudRate: chBaud,
        status: 'connected',
      };

      const state: SessionState = {
        session,
        driver,
        channel: ch,
        pollTimer: null,
        onData: null,
        onError: null,
        onBusError: null,
      };

      this.sessions.set(session.id, state);

      state.pollTimer = setInterval(() => {
        try {
          const frames = driver.receive(ch, CAN_POLL_BATCH_SIZE);
          if ((driver as any).readError && state.onBusError) {
            const errInfo = (driver as any).readError(ch);
            const newErrCode = errInfo?.errCode ?? 0;
            if (newErrCode !== (state.lastErrCode ?? 0)) {
              state.lastErrCode = newErrCode;
              if (newErrCode !== 0) {
                state.onBusError({
                  errCode: newErrCode,
                  errTypes: decodeCanErrCode(newErrCode),
                  timestamp: Date.now(),
                });
              }
            }
          }
          if (frames.length > 0 && state.onData) {
            state.onData(frames);
          }
        } catch (err) {
          if (state.onError) {
            state.onError((err as Error).message);
          }
        }
      }, CAN_POLL_INTERVAL_MS);

      return session;
    });

    return isMultiChannel ? sessions : sessions[0];
  }

  close(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (state.pollTimer) clearInterval(state.pollTimer);
    this.udsDestroyAll(sessionId);

    const hasSibling = Array.from(this.sessions.values()).some(
      (s) => s !== state && s.driver === state.driver && s.session.status === 'connected'
    );

    try {
      if (hasSibling) {
        state.driver.close(state.channel);
      } else {
        state.driver.close();
      }
    } catch { /* ignore */ }
    state.session.status = 'closed';
    this.sessions.delete(sessionId);
  }

  send(sessionId: string, frames: CanFrame[]): number {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error('Session not found');
    const sent = state.driver.send(state.channel, frames);
    if (sent < frames.length) {
      throw new Error(`CAN send failed (${sent}/${frames.length})`);
    }
    return sent;
  }

  onData(sessionId: string, callback: (frames: CanFrame[]) => void): void {
    const state = this.sessions.get(sessionId);
    if (state) state.onData = callback;
  }

  onError(sessionId: string, callback: (error: string) => void): void {
    const state = this.sessions.get(sessionId);
    if (state) state.onError = callback;
  }

  onBusError(sessionId: string, callback: (info: { errCode: number; errTypes: string[]; timestamp: number }) => void): void {
    const state = this.sessions.get(sessionId);
    if (state) state.onBusError = callback;
  }

  parseDbcFile(filePath: string): DbcDatabase {
    const content = readFileSync(filePath, 'utf-8');
    return parseDbc(content);
  }

  parseDbcContent(content: string): DbcDatabase {
    return parseDbc(content);
  }

  // ─── UDS ───

  private getUdsKey(sessionId: string, txId: number, rxId: number): string {
    return `${sessionId}:${txId}:${rxId}`;
  }

  private getOrCreateUds(sessionId: string, txId: number, rxId: number, onLog?: (entry: UdsLogEntry) => void): UdsService {
    const key = this.getUdsKey(sessionId, txId, rxId);
    let uds = this.udsInstances.get(key);
    if (uds) {
      if (onLog) uds.setOnLog(onLog);
      return uds;
    }

    const state = this.sessions.get(sessionId);
    if (!state) throw new Error('Session not found');

    const sendFrame = (frame: CanFrame) => {
      state.driver.send(state.channel, [frame]);
    };

    const config: IsoTpConfig = {
      txId,
      rxId,
      extended: txId > 0x7FF || rxId > 0x7FF,
      fd: false,
      padding: 0xCC,
      timeout: 5000,
    };

    uds = new UdsService(config, sendFrame);
    if (onLog) uds.setOnLog(onLog);

    const origOnData = state.onData;
    state.onData = (frames: CanFrame[]) => {
      origOnData?.(frames);
      for (const f of frames) {
        if (f.id === rxId) {
          uds!.processFrame(f);
        }
      }
    };

    this.udsInstances.set(key, uds);
    return uds;
  }

  async udsRequest(sessionId: string, txId: number, rxId: number, payload: number[], onLog?: (entry: UdsLogEntry) => void): Promise<UdsResponse> {
    const uds = this.getOrCreateUds(sessionId, txId, rxId, onLog);
    return uds.request(payload);
  }

  udsStartTesterPresent(sessionId: string, txId: number, rxId: number, intervalMs?: number): void {
    const uds = this.getOrCreateUds(sessionId, txId, rxId);
    uds.startTesterPresent(intervalMs);
  }

  udsStopTesterPresent(sessionId: string, txId: number, rxId: number): void {
    const key = this.getUdsKey(sessionId, txId, rxId);
    const uds = this.udsInstances.get(key);
    if (uds) uds.stopTesterPresent();
  }

  udsDestroy(sessionId: string, txId: number, rxId: number): void {
    const key = this.getUdsKey(sessionId, txId, rxId);
    const uds = this.udsInstances.get(key);
    if (uds) {
      uds.destroy();
      this.udsInstances.delete(key);
    }
  }

  private udsDestroyAll(sessionId: string): void {
    for (const [key, uds] of this.udsInstances) {
      if (key.startsWith(sessionId + ':')) {
        uds.destroy();
        this.udsInstances.delete(key);
      }
    }
  }
}
