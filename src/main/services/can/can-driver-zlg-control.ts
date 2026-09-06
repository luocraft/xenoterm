/**
 * ZLG (周立功) USB CAN driver — FFI bindings via koffi for ControlCAN.dll
 */
import koffi from 'koffi';
import { join } from 'path';
import { existsSync } from 'fs';
import type { CanDriver, CanFrame, CanDeviceType, CanOpenConfig } from './can-driver.interface';
import { TIMING_TABLE } from './can-driver.interface';

// VCI_CAN_OBJ struct layout (size = 24 bytes with padding)
const VCI_CAN_OBJ = koffi.struct('VCI_CAN_OBJ', {
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

const VCI_INIT_CONFIG = koffi.struct('VCI_INIT_CONFIG', {
  AccCode: 'uint32',
  AccMask: 'uint32',
  Reserved: 'uint32',
  Filter: 'uint8',
  Timing0: 'uint8',
  Timing1: 'uint8',
  Mode: 'uint8',
});

const ZLG_DEVICE_TYPES: CanDeviceType[] = [
  { code: 3, name: 'USBCAN-I', channels: 1 },
  { code: 4, name: 'USBCAN-II', channels: 2 },
  { code: 21, name: 'USBCAN-E-U', channels: 1 },
  { code: 33, name: 'USBCAN-2E-U', channels: 2 },
];

/**
 * Track which devices are open and how many channels are active.
 * Key: "deviceType:deviceIndex", Value: set of active channel numbers.
 */
const zlgOpenDevices = new Map<string, Set<number>>();

export class ZlgControlCanDriver implements CanDriver {
  readonly name = 'ZLGControl';
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
      join(process.resourcesPath || '', 'can', 'ZLGControl', 'x64', 'ControlCAN.dll'),
      join(__dirname, '../../../../resources/can/ZLGControl/x64/ControlCAN.dll'),
      join(process.cwd(), 'resources/can/ZLGControl/x64/ControlCAN.dll'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return candidates[0]; // Return first candidate for error message
  }

  private loadLib(): void {
    if (this.lib) return;
    const dllPath = this.getDllPath();
    this.lib = koffi.load(dllPath);

    this.fns.VCI_OpenDevice = this.lib.func('uint32 VCI_OpenDevice(uint32, uint32, uint32)');
    this.fns.VCI_CloseDevice = this.lib.func('uint32 VCI_CloseDevice(uint32, uint32)');
    this.fns.VCI_InitCAN = this.lib.func('uint32 VCI_InitCAN(uint32, uint32, uint32, _Inout_ VCI_INIT_CONFIG*)');
    this.fns.VCI_StartCAN = this.lib.func('uint32 VCI_StartCAN(uint32, uint32, uint32)');
    this.fns.VCI_Transmit = this.lib.func('uint32 VCI_Transmit(uint32, uint32, uint32, _Inout_ VCI_CAN_OBJ*, uint32)');
    this.fns.VCI_Receive = this.lib.func('uint32 VCI_Receive(uint32, uint32, uint32, _Out_ VCI_CAN_OBJ*, uint32, int32)');
    this.fns.VCI_GetReceiveNum = this.lib.func('uint32 VCI_GetReceiveNum(uint32, uint32, uint32)');
    this.fns.VCI_ClearBuffer = this.lib.func('uint32 VCI_ClearBuffer(uint32, uint32, uint32)');
  }

  isAvailable(): boolean {
    try {
      const dllPath = this.getDllPath();
      return existsSync(dllPath);
    } catch {
      return false;
    }
  }

  getDeviceTypes(): CanDeviceType[] {
    return ZLG_DEVICE_TYPES;
  }

  getChannelCount(): number {
    return this.channelCount;
  }

  open(config: CanOpenConfig): void {
    this.loadLib();
    this.deviceType = config.deviceType;
    this.deviceIndex = config.deviceIndex;
    this.channel = config.channel;

    // Determine channel count from device type
    const devType = ZLG_DEVICE_TYPES.find((d) => d.code === config.deviceType);
    this.channelCount = devType?.channels ?? 2;

    const key = this.deviceKey();
    const activeChannels = zlgOpenDevices.get(key);

    // Only open device once
    if (!activeChannels || activeChannels.size === 0) {
      const ret = (this.fns.VCI_OpenDevice as Function)(this.deviceType, this.deviceIndex, 0);
      if (ret !== 1) throw new Error(`VCI_OpenDevice failed (ret=${ret})`);
      zlgOpenDevices.set(key, new Set());

      // Init + Start all channels
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

        const r2 = (this.fns.VCI_InitCAN as Function)(this.deviceType, this.deviceIndex, ch, initConfig);
        if (r2 !== 1) {
          (this.fns.VCI_CloseDevice as Function)(this.deviceType, this.deviceIndex);
          zlgOpenDevices.delete(key);
          throw new Error(`VCI_InitCAN ch${ch} failed (ret=${r2})`);
        }

        const r3 = (this.fns.VCI_StartCAN as Function)(this.deviceType, this.deviceIndex, ch);
        if (r3 !== 1) {
          (this.fns.VCI_CloseDevice as Function)(this.deviceType, this.deviceIndex);
          zlgOpenDevices.delete(key);
          throw new Error(`VCI_StartCAN ch${ch} failed (ret=${r3})`);
        }

        zlgOpenDevices.get(key)!.add(ch);
      }
    }

    this.opened = true;
  }

  close(channel?: number): void {
    if (!this.lib) return;
    const key = this.deviceKey();
    const channels = zlgOpenDevices.get(key);
    if (!channels || channels.size === 0) return;

    if (channel !== undefined) {
      channels.delete(channel);
    } else {
      channels.clear();
    }

    if (channels.size === 0) {
      try {
        (this.fns.VCI_CloseDevice as Function)(this.deviceType, this.deviceIndex);
      } catch { /* ignore */ }
      zlgOpenDevices.delete(key);
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
    return (this.fns.VCI_Transmit as Function)(this.deviceType, this.deviceIndex, channel, objs, objs.length) as number;
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

    const count = (this.fns.VCI_Receive as Function)(
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
}
