/**
 * Kvaser CANlib driver — FFI bindings via koffi for canlib32.dll
 */
import koffi from 'koffi';
import { join } from 'path';
import { existsSync } from 'fs';
import type { CanDriver, CanFrame, CanDeviceType, CanOpenConfig } from './can-driver.interface';

// Kvaser constants
const canOK = 0;
const canOPEN_ACCEPT_VIRTUAL = 0x0020;
const canBITRATE_1M   = -1;
const canBITRATE_500K  = -2;
const canBITRATE_250K  = -3;
const canBITRATE_125K  = -4;
const canBITRATE_100K  = -5;
const canBITRATE_62K   = -6;
const canBITRATE_50K   = -7;
const canBITRATE_83K   = -8;
const canBITRATE_10K   = -9;

const canMSG_EXT = 0x0004;
const canMSG_RTR = 0x0001;

const KVASER_BAUD: Record<number, number> = {
  10000:   canBITRATE_10K,
  50000:   canBITRATE_50K,
  62000:   canBITRATE_62K,
  83000:   canBITRATE_83K,
  100000:  canBITRATE_100K,
  125000:  canBITRATE_125K,
  250000:  canBITRATE_250K,
  500000:  canBITRATE_500K,
  1000000: canBITRATE_1M,
};

const KVASER_DEVICE_TYPES: CanDeviceType[] = [
  { code: 1, name: 'Kvaser USB (1-CH)', channels: 1 },
  { code: 2, name: 'Kvaser USB (2-CH)', channels: 2 },
];

export class KvaserCanDriver implements CanDriver {
  readonly name = 'Kvaser';
  private lib: koffi.IKoffiLib | null = null;
  private fns: Record<string, (...args: unknown[]) => unknown> = {};
  private opened = false;
  private channelCount = 1;
  private handles: number[] = []; // canlib channel handles

  private getDllPath(): string {
    const candidates = [
      join(process.resourcesPath || '', 'can', 'kvaser', 'canlib32.dll'),
      join(__dirname, '../../../../resources/can/kvaser/canlib32.dll'),
      join(process.cwd(), 'resources/can/kvaser/canlib32.dll'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return candidates[0];
  }

  private loadLib(): void {
    if (this.lib) return;
    const dllPath = this.getDllPath();
    this.lib = koffi.load(dllPath);

    this.fns.canInitializeLibrary = this.lib.func('void canInitializeLibrary()');
    // canHandle canOpenChannel(int channel, int flags)
    this.fns.canOpenChannel = this.lib.func('int canOpenChannel(int, int)');
    // canStatus canSetBusParams(canHandle hnd, long freq, uint tseg1, uint tseg2, uint sjw, uint noSamp, uint syncmode)
    this.fns.canSetBusParams = this.lib.func('int canSetBusParams(int, int, uint32, uint32, uint32, uint32, uint32)');
    // canStatus canBusOn(canHandle hnd)
    this.fns.canBusOn = this.lib.func('int canBusOn(int)');
    // canStatus canBusOff(canHandle hnd)
    this.fns.canBusOff = this.lib.func('int canBusOff(int)');
    // canStatus canClose(canHandle hnd)
    this.fns.canClose = this.lib.func('int canClose(int)');
    // canStatus canWrite(canHandle hnd, long id, void* msg, uint dlc, uint flag)
    this.fns.canWrite = this.lib.func('int canWrite(int, int, _In_ uint8*, uint32, uint32)');
    // canStatus canRead(canHandle hnd, long* id, void* msg, uint* dlc, uint* flag, ulong* time)
    this.fns.canRead = this.lib.func('int canRead(int, _Out_ int*, _Out_ uint8*, _Out_ uint32*, _Out_ uint32*, _Out_ uint32*)');
  }

  isAvailable(): boolean {
    try {
      return existsSync(this.getDllPath());
    } catch {
      return false;
    }
  }

  getDeviceTypes(): CanDeviceType[] {
    return KVASER_DEVICE_TYPES;
  }

  getChannelCount(): number {
    return this.channelCount;
  }

  open(config: CanOpenConfig): void {
    this.loadLib();

    const devType = KVASER_DEVICE_TYPES.find((d) => d.code === config.deviceType);
    this.channelCount = devType?.channels ?? 1;

    const baud = KVASER_BAUD[config.baudRate];
    if (baud === undefined) throw new Error(`Unsupported baud rate: ${config.baudRate}`);

    // Initialize library
    (this.fns.canInitializeLibrary as Function)();

    this.handles = [];
    for (let ch = 0; ch < this.channelCount; ch++) {
      const kvaserCh = config.deviceIndex * this.channelCount + ch;
      const handle = (this.fns.canOpenChannel as Function)(kvaserCh, canOPEN_ACCEPT_VIRTUAL) as number;
      if (handle < 0) {
        for (const h of this.handles) {
          (this.fns.canClose as Function)(h);
        }
        this.handles = [];
        throw new Error(`canOpenChannel failed for ch${ch} (ret=${handle})`);
      }

      const chBaud = (ch === 1 && config.ch1BaudRate) ? (KVASER_BAUD[config.ch1BaudRate] ?? baud) : baud;
      // canSetBusParams with predefined bitrate constant (tseg1=0, tseg2=0, sjw=0, noSamp=0, syncmode=0)
      let ret = (this.fns.canSetBusParams as Function)(handle, chBaud, 0, 0, 0, 0, 0) as number;
      if (ret !== canOK) {
        (this.fns.canClose as Function)(handle);
        for (const h of this.handles) (this.fns.canClose as Function)(h);
        this.handles = [];
        throw new Error(`canSetBusParams failed for ch${ch} (ret=${ret})`);
      }

      ret = (this.fns.canBusOn as Function)(handle) as number;
      if (ret !== canOK) {
        (this.fns.canClose as Function)(handle);
        for (const h of this.handles) (this.fns.canClose as Function)(h);
        this.handles = [];
        throw new Error(`canBusOn failed for ch${ch} (ret=${ret})`);
      }

      this.handles.push(handle);
    }

    this.opened = true;
  }

  close(_channel?: number): void {
    if (!this.lib) return;
    for (const handle of this.handles) {
      try {
        (this.fns.canBusOff as Function)(handle);
        (this.fns.canClose as Function)(handle);
      } catch { /* ignore */ }
    }
    this.handles = [];
    this.opened = false;
  }

  send(channel: number, frames: CanFrame[]): number {
    if (!this.opened || channel >= this.handles.length) return 0;
    const handle = this.handles[channel];
    let sent = 0;
    for (const f of frames) {
      let flags = 0;
      if (f.extended) flags |= canMSG_EXT;
      if (f.remote) flags |= canMSG_RTR;
      const data = Buffer.alloc(8);
      for (let i = 0; i < Math.min(f.data.length, 8); i++) data[i] = f.data[i];
      const ret = (this.fns.canWrite as Function)(handle, f.id, data, f.dlc, flags) as number;
      if (ret === canOK) sent++;
    }
    return sent;
  }

  receive(channel: number, maxCount: number): CanFrame[] {
    if (!this.opened || channel >= this.handles.length) return [];
    const handle = this.handles[channel];
    const frames: CanFrame[] = [];
    const now = Date.now();

    for (let i = 0; i < maxCount; i++) {
      const idBuf = [0];
      const msgBuf = Buffer.alloc(8);
      const dlcBuf = [0];
      const flagBuf = [0];
      const timeBuf = [0];
      const ret = (this.fns.canRead as Function)(handle, idBuf, msgBuf, dlcBuf, flagBuf, timeBuf) as number;
      if (ret !== canOK) break;

      const dlc = dlcBuf[0];
      frames.push({
        id: idBuf[0],
        extended: (flagBuf[0] & canMSG_EXT) !== 0,
        remote: (flagBuf[0] & canMSG_RTR) !== 0,
        dlc,
        data: Array.from(msgBuf.subarray(0, dlc)),
        timestamp: now,
        direction: 'rx',
      });
    }
    return frames;
  }
}
