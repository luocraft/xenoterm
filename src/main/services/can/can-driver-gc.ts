/**
 * GC (广成科技) USB CAN driver — API compatible with ControlCAN (ZLG).
 * Uses ECanVci64.dll with identical function signatures.
 */
import koffi from 'koffi';
import { join } from 'path';
import { existsSync } from 'fs';
import type { CanDriver, CanFrame, CanDeviceType, CanOpenConfig, CanErrorInfo, CanBusStatus } from './can-driver.interface';
import { TIMING_TABLE, decodeCanErrCode } from './can-driver.interface';

// Reuse same struct definitions (API-compatible)
const VCI_CAN_OBJ = koffi.struct('GC_VCI_CAN_OBJ', {
  ID: 'uint32',
  TimeStamp: 'uint32',
  TimeFlag: 'uint8',
  SendType: 'uint8',
  RemoteFlag: 'uint8',
  ExternFlag: 'uint8',
  DataLen: 'uint8',
  Data: koffi.array('uint8', 8),
  Reserved: koffi.array('uint8', 3),
});

const VCI_INIT_CONFIG = koffi.struct('GC_VCI_INIT_CONFIG', {
  AccCode: 'uint32',
  AccMask: 'uint32',
  Reserved: 'uint32',
  Filter: 'uint8',
  Timing0: 'uint8',
  Timing1: 'uint8',
  Mode: 'uint8',
});

const GC_ERR_INFO = koffi.struct('GC_ERR_INFO', {
  ErrCode: 'uint32',
  Passive_ErrData: koffi.array('uint8', 3),
  ArLost_ErrData: 'uint8',
});

const GC_CAN_STATUS = koffi.struct('GC_CAN_STATUS', {
  ErrInterrupt: 'uint8',
  regMode: 'uint8',
  regStatus: 'uint8',
  regALCapture: 'uint8',
  regECCapture: 'uint8',
  regEWLimit: 'uint8',
  regRECounter: 'uint8',
  regTECounter: 'uint8',
  Reserved: 'uint32',
});

const GC_DEVICE_TYPES: CanDeviceType[] = [
  { code: 3, name: 'USBCAN-I', channels: 1 },
  { code: 4, name: 'USBCAN-II', channels: 2 },
];

/**
 * Track which devices are open and how many channels are active.
 */
const gcOpenDevices = new Map<string, Set<number>>();

export class GcCanDriver implements CanDriver {
  readonly name = 'GC';
  private lib: koffi.IKoffiLib | null = null;
  private fns: Record<string, (...args: unknown[]) => unknown> = {};
  private deviceType = 0;
  private deviceIndex = 0;
  private channel = 0;
  private opened = false;
  private channelCount = 2;
  // Pre-allocated receive buffer to avoid GC pressure
  private rxBuf: Array<{ ID: number; TimeStamp: number; TimeFlag: number; SendType: number; RemoteFlag: number; ExternFlag: number; DataLen: number; Data: number[]; Reserved: number[] }> | null = null;

  private deviceKey(): string {
    return `${this.deviceType}:${this.deviceIndex}`;
  }

  private getDllPath(): string {
    const candidates = [
      join(process.resourcesPath || '', 'can', 'gc', 'ECanVci64.dll'),
      join(__dirname, '../../../../resources/can/gc/ECanVci64.dll'),
      join(process.cwd(), 'resources/can/gc/ECanVci64.dll'),
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

    this.fns.OpenDevice = this.lib.func('uint32 __stdcall OpenDevice(uint32, uint32, uint32)');
    this.fns.CloseDevice = this.lib.func('uint32 __stdcall CloseDevice(uint32, uint32)');
    this.fns.InitCAN = this.lib.func('uint32 __stdcall InitCAN(uint32, uint32, uint32, _Inout_ GC_VCI_INIT_CONFIG*)');
    this.fns.StartCAN = this.lib.func('uint32 __stdcall StartCAN(uint32, uint32, uint32)');
    this.fns.Transmit = this.lib.func('uint32 __stdcall Transmit(uint32, uint32, uint32, _Inout_ GC_VCI_CAN_OBJ*, uint32)');
    this.fns.Receive = this.lib.func('uint32 __stdcall Receive(uint32, uint32, uint32, _Out_ GC_VCI_CAN_OBJ*, uint32, int32)');
    this.fns.GetReceiveNum = this.lib.func('uint32 __stdcall GetReceiveNum(uint32, uint32, uint32)');
    this.fns.ClearBuffer = this.lib.func('uint32 __stdcall ClearBuffer(uint32, uint32, uint32)');
    this.fns.ReadErrInfo = this.lib.func('uint32 __stdcall ReadErrInfo(uint32, uint32, uint32, _Out_ GC_ERR_INFO*)');
    this.fns.ReadCANStatus = this.lib.func('uint32 __stdcall ReadCANStatus(uint32, uint32, uint32, _Out_ GC_CAN_STATUS*)');
  }

  isAvailable(): boolean {
    try {
      return existsSync(this.getDllPath());
    } catch {
      return false;
    }
  }

  getDeviceTypes(): CanDeviceType[] {
    return GC_DEVICE_TYPES;
  }

  getChannelCount(): number {
    return this.channelCount;
  }

  open(config: CanOpenConfig): void {
    this.loadLib();
    this.deviceType = config.deviceType;
    this.deviceIndex = config.deviceIndex;
    this.channel = config.channel;

    const devType = GC_DEVICE_TYPES.find((d) => d.code === config.deviceType);
    this.channelCount = devType?.channels ?? 2;

    const key = this.deviceKey();
    const activeChannels = gcOpenDevices.get(key);

    if (!activeChannels || activeChannels.size === 0) {
      const ret = (this.fns.OpenDevice as Function)(this.deviceType, this.deviceIndex, 0);
      if (ret !== 1) throw new Error(`OpenDevice failed (ret=${ret})`);
      gcOpenDevices.set(key, new Set());

      for (let ch = 0; ch < this.channelCount; ch++) {
        const chBaudRate = (ch === 1 && config.ch1BaudRate) ? config.ch1BaudRate : config.baudRate;
        const timing = TIMING_TABLE[chBaudRate];
        if (!timing) throw new Error(`Unsupported baud rate for ch${ch}: ${chBaudRate}`);

        const initConfig = {
          AccCode: config.accCode ?? 0x00000000,
          AccMask: config.accMask ?? 0xFFFFFFFF,
          Reserved: 0,
          Filter: config.filterMode ?? 1,
          Timing0: timing[0],
          Timing1: timing[1],
          Mode: config.mode ?? 0,
        };

        const r2 = (this.fns.InitCAN as Function)(this.deviceType, this.deviceIndex, ch, initConfig);
        if (r2 !== 1) {
          (this.fns.CloseDevice as Function)(this.deviceType, this.deviceIndex);
          gcOpenDevices.delete(key);
          throw new Error(`InitCAN ch${ch} failed (ret=${r2})`);
        }

        const r3 = (this.fns.StartCAN as Function)(this.deviceType, this.deviceIndex, ch);
        if (r3 !== 1) {
          (this.fns.CloseDevice as Function)(this.deviceType, this.deviceIndex);
          gcOpenDevices.delete(key);
          throw new Error(`StartCAN ch${ch} failed (ret=${r3})`);
        }

        gcOpenDevices.get(key)!.add(ch);
      }
    }

    this.opened = true;
  }

  close(channel?: number): void {
    if (!this.lib) return;
    const key = this.deviceKey();
    const channels = gcOpenDevices.get(key);
    if (!channels || channels.size === 0) return;

    if (channel !== undefined) {
      channels.delete(channel);
    } else {
      channels.clear();
    }

    if (channels.size === 0) {
      try {
        (this.fns.CloseDevice as Function)(this.deviceType, this.deviceIndex);
      } catch { /* ignore */ }
      gcOpenDevices.delete(key);
    }

    this.opened = channels.size > 0;
  }

  send(channel: number, frames: CanFrame[]): number {
    if (!this.opened) return 0;
    const objs = frames.map((f) => ({
      ID: f.id,
      TimeStamp: 0,
      TimeFlag: 0,
      SendType: 0,
      RemoteFlag: f.remote ? 1 : 0,
      ExternFlag: f.extended ? 1 : 0,
      DataLen: f.dlc,
      Data: [...f.data.slice(0, 8), ...new Array(8 - Math.min(f.data.length, 8)).fill(0)],
      Reserved: [0, 0, 0],
    }));
    return (this.fns.Transmit as Function)(this.deviceType, this.deviceIndex, channel, objs, objs.length) as number;
  }

  private ensureRxBuf(size: number): void {
    if (!this.rxBuf || this.rxBuf.length < size) {
      this.rxBuf = new Array(size).fill(null).map(() => ({
        ID: 0, TimeStamp: 0, TimeFlag: 0, SendType: 0,
        RemoteFlag: 0, ExternFlag: 0, DataLen: 0,
        Data: [0, 0, 0, 0, 0, 0, 0, 0],
        Reserved: [0, 0, 0],
      }));
    }
  }

  receive(channel: number, maxCount: number): CanFrame[] {
    if (!this.opened) return [];
    this.ensureRxBuf(maxCount);
    const buf = this.rxBuf!;

    // Reset buffer entries for koffi
    for (let i = 0; i < maxCount; i++) {
      const o = buf[i];
      o.ID = 0; o.TimeStamp = 0; o.TimeFlag = 0; o.SendType = 0;
      o.RemoteFlag = 0; o.ExternFlag = 0; o.DataLen = 0;
    }

    const count = (this.fns.Receive as Function)(
      this.deviceType, this.deviceIndex, channel, buf, maxCount, 0
    ) as number;

    if (count <= 0) return [];

    const now = Date.now();
    const frames: CanFrame[] = [];
    let anchorHwTs: number | null = null;
    let anchorMs = now;

    for (let i = 0; i < count; i++) {
      const obj = buf[i];
      let ts: number;
      // TimeFlag=1 means TimeStamp is valid (unit: 0.1ms = 100μs)
      if (obj.TimeFlag === 1 && obj.TimeStamp > 0) {
        if (anchorHwTs === null) {
          anchorHwTs = obj.TimeStamp;
          anchorMs = now;
        }
        ts = anchorMs + (obj.TimeStamp - anchorHwTs) * 0.1;
      } else {
        ts = now;
      }

      frames.push({
        id: obj.ID,
        extended: obj.ExternFlag === 1,
        remote: obj.RemoteFlag === 1,
        dlc: obj.DataLen,
        data: Array.from(obj.Data).slice(0, obj.DataLen),
        timestamp: ts,
        direction: 'rx' as const,
      });
    }
    return frames;
  }

  readError(channel: number): CanErrorInfo | null {
    if (!this.opened) return null;
    const errInfo = {
      ErrCode: 0,
      Passive_ErrData: [0, 0, 0],
      ArLost_ErrData: 0,
    };
    try {
      const ret = (this.fns.ReadErrInfo as Function)(this.deviceType, this.deviceIndex, channel, errInfo);
      if (ret !== 1 || errInfo.ErrCode === 0) return null;
      // GC devices may report spurious FIFO Overflow (0x0001) when bus has no other nodes.
      // Only report if there are real bus errors beyond just the overflow bit.
      if (errInfo.ErrCode === 0x0001) return null;
      return {
        errCode: errInfo.ErrCode,
        passiveErrData: Array.from(errInfo.Passive_ErrData),
        arLostErrData: errInfo.ArLost_ErrData,
      };
    } catch {
      return null;
    }
  }

  readBusStatus(channel: number): CanBusStatus | null {
    if (!this.opened) return null;
    const status = {
      ErrInterrupt: 0, regMode: 0, regStatus: 0,
      regALCapture: 0, regECCapture: 0, regEWLimit: 0,
      regRECounter: 0, regTECounter: 0, Reserved: 0,
    };
    try {
      const ret = (this.fns.ReadCANStatus as Function)(this.deviceType, this.deviceIndex, channel, status);
      if (ret !== 1) return null;
      return {
        errInterrupt: status.ErrInterrupt,
        regMode: status.regMode,
        regStatus: status.regStatus,
        regALCapture: status.regALCapture,
        regECCapture: status.regECCapture,
        regEWLimit: status.regEWLimit,
        rxErrCounter: status.regRECounter,
        txErrCounter: status.regTECounter,
      };
    } catch {
      return null;
    }
  }

}
