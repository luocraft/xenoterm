/**
 * ZLG (周立功) USB CAN driver — new zlgcan.dll API (handle-based).
 * Supports USBCANFD-x00U series and other modern ZLG devices.
 * API reference: zlgcan.h
 */
import koffi from 'koffi';
import { join } from 'path';
import { existsSync } from 'fs';
import type { CanDriver, CanFrame, CanDeviceType, CanOpenConfig } from './can-driver.interface';
import { TIMING_TABLE } from './can-driver.interface';

/* ── koffi struct definitions matching zlgcan.h ── */

// can_frame: 16 bytes
const can_frame = koffi.struct('zlg_can_frame', {
  can_id: 'uint32',   // MAKE_CAN_ID with EFF/RTR/ERR flags in upper bits
  can_dlc: 'uint8',
  __pad: 'uint8',
  __res0: 'uint8',
  __res1: 'uint8',
  data: koffi.array('uint8', 8),
});

// canfd_frame: 72 bytes
const canfd_frame = koffi.struct('zlg_canfd_frame', {
  can_id: 'uint32',
  len: 'uint8',
  flags: 'uint8',
  __res0: 'uint8',
  __res1: 'uint8',
  data: koffi.array('uint8', 64),
});

const ZCAN_CHANNEL_INIT_CONFIG = koffi.struct('ZCAN_CHANNEL_INIT_CONFIG', {
  can_type: 'uint32',
  // CAN mode (union — we use the CAN branch)
  acc_code: 'uint32',
  acc_mask: 'uint32',
  reserved: 'uint32',
  filter: 'uint8',
  timing0: 'uint8',
  timing1: 'uint8',
  mode: 'uint8',
});

// ZCAN_Transmit_Data: can_frame + transmit_type
const ZCAN_Transmit_Data = koffi.struct('ZCAN_Transmit_Data', {
  frame: can_frame,
  transmit_type: 'uint32',
});

// ZCAN_Receive_Data: can_frame + uint64 timestamp (us)
const ZCAN_Receive_Data = koffi.struct('ZCAN_Receive_Data', {
  frame: can_frame,
  timestamp: 'uint64',
});

const ZCAN_DEVICE_INFO = koffi.struct('ZCAN_DEVICE_INFO', {
  hw_Version: 'uint16',
  fw_Version: 'uint16',
  dr_Version: 'uint16',
  in_Version: 'uint16',
  irq_Num: 'uint16',
  can_Num: 'uint8',
  str_Serial_Num: koffi.array('uint8', 20),
  str_hw_Type: koffi.array('uint8', 40),
  reserved: koffi.array('uint16', 4),
});

const ZCAN_CHANNEL_ERR_INFO = koffi.struct('ZCAN_CHANNEL_ERR_INFO', {
  error_code: 'uint32',
  passive_ErrData: koffi.array('uint8', 3),
  arLost_ErrData: 'uint8',
});

const ZCAN_CHANNEL_STATUS = koffi.struct('ZCAN_CHANNEL_STATUS', {
  errInterrupt: 'uint8',
  regMode: 'uint8',
  regStatus: 'uint8',
  regALCapture: 'uint8',
  regECCapture: 'uint8',
  regEWLimit: 'uint8',
  regRECounter: 'uint8',
  regTECounter: 'uint8',
  Reserved: 'uint32',
});

// CAN ID flag masks
const CAN_EFF_FLAG = 0x80000000;
const CAN_RTR_FLAG = 0x40000000;
const CAN_ERR_FLAG = 0x20000000;
const CAN_ID_FLAG  = 0x1FFFFFFF;

const ZLG_DEVICE_TYPES: CanDeviceType[] = [
  { code: 3,  name: 'USBCAN-I', channels: 1 },
  { code: 4,  name: 'USBCAN-II', channels: 2 },
  { code: 21, name: 'USBCAN-E-U', channels: 1 },
  { code: 33, name: 'USBCAN-2E-U', channels: 2 },
  { code: 41, name: 'USBCANFD-200U', channels: 2 },
  { code: 42, name: 'USBCANFD-100U', channels: 1 },
  { code: 43, name: 'USBCANFD-MINI', channels: 1 },
  { code: 59, name: 'USBCANFD-800U', channels: 4 },
];

export class ZlgCanDriver implements CanDriver {
  readonly name = 'ZLG';
  private lib: koffi.IKoffiLib | null = null;
  private fns: Record<string, (...args: unknown[]) => unknown> = {};
  private deviceHandle: number = 0; // DEVICE_HANDLE (void*)
  private channelHandles: number[] = []; // CHANNEL_HANDLE per channel
  private opened = false;
  private channelCount = 2;
  private deviceType = 0;
  private deviceIndex = 0;
  // Pre-allocated receive buffer to avoid GC pressure
  private rxBuf: Array<{ frame: { can_id: number; can_dlc: number; __pad: number; __res0: number; __res1: number; data: number[] }; timestamp: bigint }> | null = null;

  private getDllPath(): string {
    const candidates = [
      join(process.resourcesPath || '', 'can', 'ZLG', 'x64', 'zlgcan.dll'),
      join(__dirname, '../../../../resources/can/ZLG/x64/zlgcan.dll'),
      join(process.cwd(), 'resources/can/ZLG/x64/zlgcan.dll'),
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

    // DEVICE_HANDLE and CHANNEL_HANDLE are void* — use 'void*' / pointer
    this.fns.ZCAN_OpenDevice = this.lib.func('void* __stdcall ZCAN_OpenDevice(uint32, uint32, uint32)');
    this.fns.ZCAN_CloseDevice = this.lib.func('uint32 __stdcall ZCAN_CloseDevice(void*)');
    this.fns.ZCAN_GetDeviceInf = this.lib.func('uint32 __stdcall ZCAN_GetDeviceInf(void*, _Out_ ZCAN_DEVICE_INFO*)');
    this.fns.ZCAN_InitCAN = this.lib.func('void* __stdcall ZCAN_InitCAN(void*, uint32, _Inout_ ZCAN_CHANNEL_INIT_CONFIG*)');
    this.fns.ZCAN_StartCAN = this.lib.func('uint32 __stdcall ZCAN_StartCAN(void*)');
    this.fns.ZCAN_ResetCAN = this.lib.func('uint32 __stdcall ZCAN_ResetCAN(void*)');
    this.fns.ZCAN_ClearBuffer = this.lib.func('uint32 __stdcall ZCAN_ClearBuffer(void*)');
    this.fns.ZCAN_Transmit = this.lib.func('uint32 __stdcall ZCAN_Transmit(void*, _Inout_ ZCAN_Transmit_Data*, uint32)');
    this.fns.ZCAN_Receive = this.lib.func('uint32 __stdcall ZCAN_Receive(void*, _Out_ ZCAN_Receive_Data*, uint32, int32)');
    this.fns.ZCAN_GetReceiveNum = this.lib.func('uint32 __stdcall ZCAN_GetReceiveNum(void*, uint8)');
    this.fns.ZCAN_ReadChannelErrInfo = this.lib.func('uint32 __stdcall ZCAN_ReadChannelErrInfo(void*, _Out_ ZCAN_CHANNEL_ERR_INFO*)');
    this.fns.ZCAN_ReadChannelStatus = this.lib.func('uint32 __stdcall ZCAN_ReadChannelStatus(void*, _Out_ ZCAN_CHANNEL_STATUS*)');
    // SetValue / GetValue for baud rate config on CANFD devices
    this.fns.ZCAN_SetValue = this.lib.func('uint32 __stdcall ZCAN_SetValue(void*, const char*, const void*)');
  }

  isAvailable(): boolean {
    try {
      return existsSync(this.getDllPath());
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

    const devType = ZLG_DEVICE_TYPES.find((d) => d.code === config.deviceType);
    this.channelCount = devType?.channels ?? 2;

    // Open device — returns DEVICE_HANDLE (void*), 0 = invalid
    const handle = (this.fns.ZCAN_OpenDevice as Function)(config.deviceType, config.deviceIndex, 0);
    if (!handle) throw new Error(`ZCAN_OpenDevice failed (returned null handle)`);
    this.deviceHandle = handle;

    // Query device info for channel count
    const devInfo = {
      hw_Version: 0, fw_Version: 0, dr_Version: 0, in_Version: 0,
      irq_Num: 0, can_Num: 0,
      str_Serial_Num: new Array(20).fill(0),
      str_hw_Type: new Array(40).fill(0),
      reserved: [0, 0, 0, 0],
    };
    const infoRet = (this.fns.ZCAN_GetDeviceInf as Function)(this.deviceHandle, devInfo);
    if (infoRet === 1 && devInfo.can_Num > 0) {
      this.channelCount = devInfo.can_Num;
    }

    // Init + Start all channels
    this.channelHandles = [];
    for (let ch = 0; ch < this.channelCount; ch++) {
      const chBaud = config.chBaudRates?.[ch] ?? (ch === 1 && config.ch1BaudRate ? config.ch1BaudRate : config.baudRate);
      const timing = TIMING_TABLE[chBaud];
      if (!timing) throw new Error(`Unsupported baud rate for ch${ch}: ${chBaud}`);

      const initCfg = {
        can_type: 0, // TYPE_CAN
        acc_code: config.accCode ?? 0x00000000,
        acc_mask: config.accMask ?? 0xFFFFFFFF,
        reserved: 0,
        filter: config.filterMode ?? 1,
        timing0: timing[0],
        timing1: timing[1],
        mode: config.mode ?? 0,
      };

      const chHandle = (this.fns.ZCAN_InitCAN as Function)(this.deviceHandle, ch, initCfg);
      if (!chHandle) {
        (this.fns.ZCAN_CloseDevice as Function)(this.deviceHandle);
        this.deviceHandle = 0;
        throw new Error(`ZCAN_InitCAN ch${ch} failed`);
      }

      const startRet = (this.fns.ZCAN_StartCAN as Function)(chHandle);
      if (startRet !== 1) {
        (this.fns.ZCAN_CloseDevice as Function)(this.deviceHandle);
        this.deviceHandle = 0;
        throw new Error(`ZCAN_StartCAN ch${ch} failed (ret=${startRet})`);
      }

      this.channelHandles.push(chHandle);
    }

    this.opened = true;
    console.log(`[ZLG] Opened device type=${config.deviceType} index=${config.deviceIndex}, channels=${this.channelCount}`);
  }

  close(): void {
    if (!this.lib || !this.opened) return;
    try {
      (this.fns.ZCAN_CloseDevice as Function)(this.deviceHandle);
    } catch { /* ignore */ }
    this.deviceHandle = 0;
    this.channelHandles = [];
    this.opened = false;
  }

  send(channel: number, frames: CanFrame[]): number {
    if (!this.opened || channel >= this.channelHandles.length) return 0;
    const chHandle = this.channelHandles[channel];
    const objs = frames.map((f) => {
      let canId = f.id & CAN_ID_FLAG;
      if (f.extended) canId |= CAN_EFF_FLAG;
      if (f.remote) canId |= CAN_RTR_FLAG;
      const data = new Array(8).fill(0);
      for (let i = 0; i < Math.min(f.data.length, 8); i++) data[i] = f.data[i];
      return {
        frame: { can_id: canId, can_dlc: f.dlc, __pad: 0, __res0: 0, __res1: 0, data },
        transmit_type: 0, // 0 = normal send
      };
    });
    return (this.fns.ZCAN_Transmit as Function)(chHandle, objs, objs.length) as number;
  }

  private ensureRxBuf(size: number): void {
    if (!this.rxBuf || this.rxBuf.length < size) {
      this.rxBuf = new Array(size).fill(null).map(() => ({
        frame: { can_id: 0, can_dlc: 0, __pad: 0, __res0: 0, __res1: 0, data: [0,0,0,0,0,0,0,0] },
        timestamp: 0n,
      }));
    }
  }

  receive(channel: number, maxCount: number): CanFrame[] {
    if (!this.opened || channel >= this.channelHandles.length) return [];
    const chHandle = this.channelHandles[channel];

    this.ensureRxBuf(maxCount);
    const buf = this.rxBuf!;

    // Reset buffer entries
    for (let i = 0; i < maxCount; i++) {
      const o = buf[i];
      o.frame.can_id = 0; o.frame.can_dlc = 0;
      o.frame.__pad = 0; o.frame.__res0 = 0; o.frame.__res1 = 0;
      o.timestamp = 0n;
    }

    const count = (this.fns.ZCAN_Receive as Function)(chHandle, buf, maxCount, 0) as number;
    if (count <= 0) return [];

    const now = Date.now();
    const frames: CanFrame[] = [];
    let anchorHwUs: bigint | null = null;
    let anchorMs = now;

    for (let i = 0; i < count; i++) {
      const obj = buf[i];
      const canId = obj.frame.can_id;
      const id = canId & CAN_ID_FLAG;
      const extended = (canId & CAN_EFF_FLAG) !== 0;
      const remote = (canId & CAN_RTR_FLAG) !== 0;
      const isErr = (canId & CAN_ERR_FLAG) !== 0;
      if (isErr) continue; // skip error frames

      const hwUs = BigInt(obj.timestamp);
      let ts: number;
      if (hwUs > 0n) {
        if (anchorHwUs === null) {
          anchorHwUs = hwUs;
          anchorMs = now;
        }
        ts = anchorMs + Number(hwUs - anchorHwUs) / 1000;
      } else {
        ts = now;
      }

      frames.push({
        id,
        extended,
        remote,
        dlc: obj.frame.can_dlc,
        data: Array.from(obj.frame.data).slice(0, obj.frame.can_dlc),
        timestamp: ts,
        direction: 'rx' as const,
      });
    }
    return frames;
  }

  readError(channel: number): { errCode: number; passiveErrData: number[]; arLostErrData: number } | null {
    if (!this.opened || channel >= this.channelHandles.length) return null;
    const chHandle = this.channelHandles[channel];
    const errInfo = { error_code: 0, passive_ErrData: [0, 0, 0], arLost_ErrData: 0 };
    try {
      const ret = (this.fns.ZCAN_ReadChannelErrInfo as Function)(chHandle, errInfo);
      if (ret !== 1 || errInfo.error_code === 0) return null;
      return {
        errCode: errInfo.error_code,
        passiveErrData: Array.from(errInfo.passive_ErrData),
        arLostErrData: errInfo.arLost_ErrData,
      };
    } catch {
      return null;
    }
  }
}
