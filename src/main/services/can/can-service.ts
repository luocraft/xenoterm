/**
 * CAN service — manages drivers, sessions, polling, and event dispatch.
 */
import { randomUUID } from 'crypto';
import type { CanDriver, CanFrame, CanOpenConfig, CanDeviceType } from './can-driver.interface';
import { ZlgCanDriver } from './can-driver-zlg';
import { GcCanDriver } from './can-driver-gc';
import { GcCanFdDriver } from './can-driver-gc-fd';
import type { CanFdOpenConfig } from './can-driver-gc-fd';
import { VirtualCanDriver } from './can-driver-virtual';
import { parseDbc, type DbcDatabase } from './dbc-parser';
import { readFileSync } from 'fs';
import { IsoTpTransport, type IsoTpConfig } from './iso-tp';
import { UdsService, type UdsResponse, type UdsLogEntry } from './uds-service';

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
}

export class CanService {
  private drivers: Map<string, CanDriver> = new Map();
  private sessions: Map<string, SessionState> = new Map();
  // UDS: key = `${sessionId}:${txId}:${rxId}`
  private udsInstances: Map<string, UdsService> = new Map();

  constructor() {
    const zlg = new ZlgCanDriver();
    const gc = new GcCanDriver();
    const gcFd = new GcCanFdDriver();
    const virtual_ = new VirtualCanDriver();
    this.drivers.set(zlg.name, zlg);
    this.drivers.set(gc.name, gc);
    this.drivers.set(gcFd.name, gcFd);
    this.drivers.set(virtual_.name, virtual_);
  }

  listDrivers(): { name: string; available: boolean }[] {
    return Array.from(this.drivers.entries()).map(([name, d]) => ({
      name,
      available: d.isAvailable(),
    }));
  }

  getDeviceTypes(driverName: string): CanDeviceType[] {
    const driver = this.drivers.get(driverName);
    if (!driver) throw new Error(`Unknown driver: ${driverName}`);
    return driver.getDeviceTypes();
  }

  open(driverName: string, config: CanOpenConfig, fdConfig?: CanFdOpenConfig): CanSession | CanSession[] {
    const driver = this.drivers.get(driverName);
    if (!driver) throw new Error(`Unknown driver: ${driverName}`);
    if (!driver.isAvailable()) throw new Error(`Driver ${driverName} DLL not found. Please place the DLL in resources/can/ directory.`);

    // If FD driver, set FD-specific config before open
    if (fdConfig && driver instanceof GcCanFdDriver) {
      driver.setFdConfig(fdConfig);
    }

    driver.open(config);

    // All multi-channel drivers now open all channels at once — create a session for each
    const chCount = 'getChannelCount' in driver ? (driver as any).getChannelCount() as number : 1;
    const isMultiChannel = chCount > 1;
    const channelsToCreate = isMultiChannel ? Array.from({ length: chCount }, (_, i) => i) : [config.channel];

    const sessions: CanSession[] = channelsToCreate.map((ch) => {
      const ch1Baud = fdConfig?.ch1BaudRate ?? config.ch1BaudRate;
      const session: CanSession = {
        id: randomUUID(),
        driverName,
        deviceType: config.deviceType,
        deviceIndex: config.deviceIndex,
        channel: ch,
        baudRate: (ch === 1 && ch1Baud) ? ch1Baud : config.baudRate,
        status: 'connected',
      };

      const state: SessionState = {
        session,
        driver,
        channel: ch,
        pollTimer: null,
        onData: null,
        onError: null,
      };

      this.sessions.set(session.id, state);

      // Start polling for this channel
      state.pollTimer = setInterval(() => {
        try {
          const frames = driver.receive(ch, 200);
          if (frames.length > 0 && state.onData) {
            state.onData(frames);
          }
        } catch (err) {
          if (state.onError) {
            state.onError((err as Error).message);
          }
        }
      }, 1);

      return session;
    });

    return isMultiChannel ? sessions : sessions[0];
  }

  close(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (state.pollTimer) clearInterval(state.pollTimer);

    // Clean up UDS instances for this session
    this.udsDestroyAll(sessionId);

    // For FD driver, check if sibling session still exists
    const hasSibling = Array.from(this.sessions.values()).some(
      (s) => s !== state && s.driver === state.driver && s.session.status === 'connected'
    );

    try {
      if (hasSibling) {
        // Only stop this channel, keep device open for sibling
        state.driver.close(state.channel);
      } else {
        // Last session for this driver — close everything
        state.driver.close();
      }
    } catch { /* ignore */ }
    state.session.status = 'closed';
    this.sessions.delete(sessionId);
  }

  send(sessionId: string, frames: CanFrame[]): number {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error('Session not found');
    return state.driver.send(state.channel, frames);
  }

  onData(sessionId: string, callback: (frames: CanFrame[]) => void): void {
    const state = this.sessions.get(sessionId);
    if (state) state.onData = callback;
  }

  onError(sessionId: string, callback: (error: string) => void): void {
    const state = this.sessions.get(sessionId);
    if (state) state.onError = callback;
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

  /** Create or reuse a UDS instance for a given session + txId/rxId pair */
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

    // Hook into the session's data callback to feed rxId frames to ISO-TP
    const origOnData = state.onData;
    state.onData = (frames: CanFrame[]) => {
      // Forward to original callback (trace display)
      origOnData?.(frames);
      // Feed matching rxId frames to UDS
      for (const f of frames) {
        if (f.id === rxId) {
          uds!.processFrame(f);
        }
      }
    };

    this.udsInstances.set(key, uds);
    return uds;
  }

  /** Send a UDS request and return the response */
  async udsRequest(sessionId: string, txId: number, rxId: number, payload: number[], onLog?: (entry: UdsLogEntry) => void): Promise<UdsResponse> {
    const uds = this.getOrCreateUds(sessionId, txId, rxId, onLog);
    return uds.request(payload);
  }

  /** Start TesterPresent heartbeat */
  udsStartTesterPresent(sessionId: string, txId: number, rxId: number, intervalMs?: number): void {
    const uds = this.getOrCreateUds(sessionId, txId, rxId);
    uds.startTesterPresent(intervalMs);
  }

  /** Stop TesterPresent heartbeat */
  udsStopTesterPresent(sessionId: string, txId: number, rxId: number): void {
    const key = this.getUdsKey(sessionId, txId, rxId);
    const uds = this.udsInstances.get(key);
    if (uds) uds.stopTesterPresent();
  }

  /** Destroy UDS instance */
  udsDestroy(sessionId: string, txId: number, rxId: number): void {
    const key = this.getUdsKey(sessionId, txId, rxId);
    const uds = this.udsInstances.get(key);
    if (uds) {
      uds.destroy();
      this.udsInstances.delete(key);
    }
  }

  /** Destroy all UDS instances for a session */
  private udsDestroyAll(sessionId: string): void {
    for (const [key, uds] of this.udsInstances) {
      if (key.startsWith(sessionId + ':')) {
        uds.destroy();
        this.udsInstances.delete(key);
      }
    }
  }
}
