/**
 * GC (广成科技) USB CAN FD driver — uses ECANFDVCI64.dll
 * Based on ECanFDVci.h v5.5 header definitions.
 *
 * Key differences from classic CAN driver:
 *   - STATUS_OK = 0 (success), non-zero = error
 *   - Baud rates use enum indices, not actual values
 *   - INIT_CONFIG is 78 bytes with filter arrays
 *   - CANFD_OBJ is 80 bytes with bitfield frame type
 *   - ReceiveFD Len param is DWORD* (pointer)
 *   - Must call Receive_buffer_thread to start rx thread
 */
import koffi from 'koffi';
import { join } from 'path';
import { existsSync } from 'fs';
import type { CanDriver, CanFrame, CanDeviceType } from './can-driver.interface';

/** CAN FD specific open config */
export interface CanFdOpenConfig {
  deviceType: number;
  deviceIndex: number;
  channel: number;
  protocol: number;       // 0=CAN, 1=CANFD
  mode: number;           // 0=normal, 1=listen-only
  baudRate: number;       // arbitration baud rate (e.g. 500000)
  dataBaudRate: number;   // data baud rate (e.g. 5000000), only for CAN FD
  /** Per-channel config overrides: ch1BaudRate / ch1DataBaudRate for channel 1 */
  ch1BaudRate?: number;
  ch1DataBaudRate?: number;
}

/**
 * Baud rate enum mapping — SDK uses enum indices, not actual values.
 * From header: BAUDRATE_1M=0, BAUDRATE_800K=1, BAUDRATE_500K=2, ...
 */
const NOMINAL_BAUD_MAP: Record<number, number> = {
  1000000: 0,   // BAUDRATE_1M
  800000:  1,   // BAUDRATE_800K
  500000:  2,   // BAUDRATE_500K
  400000:  3,   // BAUDRATE_400K
  250000:  4,   // BAUDRATE_250K
  200000:  5,   // BAUDRATE_200K
  125000:  6,   // BAUDRATE_125K
  100000:  7,   // BAUDRATE_100K
  80000:   8,   // BAUDRATE_80K
  62500:   9,   // BAUDRATE_62500
  50000:   10,  // BAUDRATE_50K
  40000:   11,  // BAUDRATE_40K
  25000:   12,  // BAUDRATE_25K
  20000:   13,  // BAUDRATE_20K
  10000:   14,  // BAUDRATE_10K
  5000:    15,  // BAUDRATE_5K
};

/**
 * Data baud rate enum mapping.
 * From header: DATARATE_5M=0, DATARATE_4M=1, DATARATE_2M=2, ...
 */
const DATA_BAUD_MAP: Record<number, number> = {
  5000000: 0,   // DATARATE_5M
  4000000: 1,   // DATARATE_4M
  2000000: 2,   // DATARATE_2M
  1000000: 3,   // DATARATE_1M
  800000:  4,   // DATARATE_800K
  500000:  5,   // DATARATE_500K
  400000:  6,   // DATARATE_400K
  250000:  7,   // DATARATE_250K
  200000:  8,   // DATARATE_200K
  125000:  9,   // DATARATE_125K
  100000:  10,  // DATARATE_100K
  80000:   11,  // DATARATE_80K
  62500:   12,  // DATARATE_62500
  50000:   13,  // DATARATE_50K
  40000:   14,  // DATARATE_40K
  25000:   15,  // DATARATE_25K
  20000:   16,  // DATARATE_20K
  10000:   17,  // DATARATE_10K
  5000:    18,  // DATARATE_5K
};

export const FD_ARBIT_BAUD_RATES = [
  1000000, 800000, 500000, 400000, 250000, 200000, 125000, 100000,
];

export const FD_DATA_BAUD_RATES = [
  5000000, 4000000, 2000000, 1000000, 800000, 500000,
];

/**
 * CAN FD DLC to actual byte length mapping.
 */
const FD_DLC_TO_LEN: Record<number, number> = {
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8,
  9: 12, 10: 16, 11: 20, 12: 24, 13: 32, 14: 48, 15: 64,
};
const CANFD_OBJ_SIZE = 80;
const CANFD_OBJ_ID_OFFSET = 4;
const CANFD_OBJ_DATA_OFFSET = 16;

export function fdDlcToLength(dlc: number): number {
  return FD_DLC_TO_LEN[dlc] ?? dlc;
}

// ─── koffi struct definitions (matching ECanFDVci.h exactly) ───

/**
 * BYTE_TYPE — 8 individual bit fields packed into 1 byte.
 * Used for FilterUsedBits and StdOrExdBits in INIT_CONFIG.
 */
const BYTE_TYPE = koffi.struct('FD_BYTE_TYPE', {
  bits: 'uint8',  // packed bitfield — we treat as single byte
});

/**
 * CANFDFRAME_TYPE — 1 byte bitfield struct.
 *   bit0: proto (0=CAN, 1=CANFD)
 *   bit1: format (0=STD, 1=EXD)
 *   bit2: type (0=DATA, 1=RTR)
 *   bit3: bitratemode (0=off, 1=BRS on)
 *   bit4-7: reserved
 */
const CANFDFRAME_TYPE = koffi.struct('FD_CANFDFRAME_TYPE', {
  flags: 'uint8',  // packed bitfield — we manage bits manually
});

/**
 * TIMESTAMP_TYPE — 8 bytes
 */
const TIMESTAMP_TYPE = koffi.struct('FD_TIMESTAMP_TYPE', {
  mday: 'uint8',
  hour: 'uint8',
  minute: 'uint8',
  second: 'uint8',
  millisecond: 'uint16',
  microsecond: 'uint16',
});

/**
 * INIT_CONFIG — 78 bytes. Matches _INIT_CONFIG from header exactly.
 * Fields:
 *   BYTE  CanReceMode          (1)
 *   BYTE  CanSendMode          (1)
 *   DWORD NominalBitRate       (4)  — enum index, not actual value
 *   DWORD DataBitRate          (4)  — enum index
 *   BYTE_TYPE FilterUsedBits   (1)
 *   BYTE_TYPE StdOrExdBits     (1)
 *   BYTE  NominalBitRateSelect (1)  — 0=user-defined
 *   BYTE  DataBitRateSelect    (1)  — 0=user-defined
 *   8 pairs of (DWORD filter, DWORD mask) = 64 bytes
 * Total: 1+1+4+4+1+1+1+1+64 = 78 bytes ✓
 */
const INIT_CONFIG = koffi.struct('FD_INIT_CONFIG', {
  CanReceMode: 'uint8',
  CanSendMode: 'uint8',
  NominalBitRate: 'uint32',
  DataBitRate: 'uint32',
  FilterUsedBits: 'uint8',
  StdOrExdBits: 'uint8',
  NominalBitRateSelect: 'uint8',
  DataBitRateSelect: 'uint8',
  StandardORExtendedfilter1: 'uint32',
  StandardORExtendedfilter1Mask: 'uint32',
  StandardORExtendedfilter2: 'uint32',
  StandardORExtendedfilter2Mask: 'uint32',
  StandardORExtendedfilter3: 'uint32',
  StandardORExtendedfilter3Mask: 'uint32',
  StandardORExtendedfilter4: 'uint32',
  StandardORExtendedfilter4Mask: 'uint32',
  StandardORExtendedfilter5: 'uint32',
  StandardORExtendedfilter5Mask: 'uint32',
  StandardORExtendedfilter6: 'uint32',
  StandardORExtendedfilter6Mask: 'uint32',
  StandardORExtendedfilter7: 'uint32',
  StandardORExtendedfilter7Mask: 'uint32',
  StandardORExtendedfilter8: 'uint32',
  StandardORExtendedfilter8Mask: 'uint32',
});

/**
 * CANFD_OBJ — 80 bytes. Matches _CANFD_OBJ from header exactly.
 * Fields:
 *   CANFDFRAME_TYPE CanORCanfdType (1)  — bitfield flags
 *   BYTE  DataLen                  (1)
 *   BYTE  Reserved[2]             (2)
 *   DWORD ID                      (4)
 *   TIMESTAMP_TYPE TimeStamp      (8)
 *   BYTE  Data[64]                (64)
 * Total: 1+1+2+4+8+64 = 80 bytes ✓
 */
const CANFD_OBJ = koffi.struct('FD_CANFD_OBJ', {
  CanORCanfdType: 'uint8',   // bitfield: bit0=proto, bit1=format, bit2=type, bit3=brs
  DataLen: 'uint8',
  Reserved: koffi.array('uint8', 2),
  ID: 'uint32',
  TimeStamp: TIMESTAMP_TYPE,
  Data: koffi.array('uint8', 64),
});

const GC_FD_DEVICE_TYPES: CanDeviceType[] = [
  { code: 6, name: 'USBCANFD', channels: 2 },
];

/**
 * BOARD_INFO struct — 76 bytes. Matches _BOARD_INFO from header.
 */
const BOARD_INFO = koffi.struct('FD_BOARD_INFO', {
  hw_Version: 'uint16',
  fw_Version: 'uint16',
  dr_Version: 'uint16',
  in_Version: 'uint16',
  irq_Num: 'uint16',
  can_Num: 'uint8',
  str_Serial_Num: koffi.array('int8', 20),
  str_hw_Type: koffi.array('int8', 40),
  Reserved: koffi.array('uint16', 4),
});


/**
 * Track which devices are open and how many channels are active.
 * Key: "deviceType:deviceIndex", Value: set of active channel numbers.
 * OpenDeviceFD is called once per device; CloseDeviceFD only when last channel closes.
 */
const openDevices = new Map<string, Set<number>>();

export class GcCanFdDriver implements CanDriver {
  readonly name = 'GC-FD';
  private lib: koffi.IKoffiLib | null = null;
  private fns: Record<string, (...args: unknown[]) => unknown> = {};
  private deviceType = 0;
  private deviceIndex = 0;
  private channel = 0;
  private opened = false;
  private rxThreadStarted = false;
  private fdConfig: CanFdOpenConfig | null = null;
  private detectedChannelCount = 2; // default, updated by BOARD_INFO
  // Reuse one raw output buffer so ReceiveFD does not rebuild JS wrapper arrays every poll.
  private rxBuffer: Buffer | null = null;
  private rxCapacity = 0;
  private rxLenArr: number[] = [0];

  private deviceKey(): string {
    return `${this.deviceType}:${this.deviceIndex}`;
  }

  private getDllPath(): string {
    const candidates = [
      join(process.resourcesPath || '', 'can', 'gc', 'ECANFDVCI64.dll'),
      join(__dirname, '../../../../resources/can/gc/ECANFDVCI64.dll'),
      join(process.cwd(), 'resources/can/gc/ECANFDVCI64.dll'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return candidates[0];
  }

  private loadLib(): void {
    if (this.lib) return;
    const dllPath = this.getDllPath();
    const dllDir = join(dllPath, '..');

    // Add DLL directory to search path so GCANUSB_x64.dll dependency is found
    try {
      const kernel32 = koffi.load('kernel32.dll');
      const SetDllDirectoryA = kernel32.func('bool SetDllDirectoryA(str)');
      SetDllDirectoryA(dllDir);
    } catch { /* best effort */ }

    this.lib = koffi.load(dllPath);

    // Function signatures match header exactly.
    // Note: BYTE CANInd mapped as uint8; return DWORD where 0=STATUS_OK=success.
    this.fns.OpenDeviceFD = this.lib.func('uint32 __stdcall OpenDeviceFD(uint32, uint32)');
    this.fns.CloseDeviceFD = this.lib.func('uint32 __stdcall CloseDeviceFD(uint32, uint32)');
    this.fns.InitCANFD = this.lib.func('uint32 __stdcall InitCANFD(uint32, uint32, uint8, _Inout_ FD_INIT_CONFIG*)');
    this.fns.StartCANFD = this.lib.func('uint32 __stdcall StartCANFD(uint32, uint32, uint8)');
    this.fns.StopCANFD = this.lib.func('uint32 __stdcall StopCANFD(uint32, uint32, uint8)');
    this.fns.ResetCANFD = this.lib.func('uint32 __stdcall ResetCANFD(uint32, uint32, uint8)');
    this.fns.TransmitFD = this.lib.func('uint32 __stdcall TransmitFD(uint32, uint32, uint8, _Inout_ FD_CANFD_OBJ*, uint32)');
    this.fns.ReceiveFD = this.lib.func('uint32 __stdcall ReceiveFD(uint32, uint32, uint8, _Out_ FD_CANFD_OBJ*, _Inout_ uint32*)');
    this.fns.Receive_buffer_thread = this.lib.func('uint32 __stdcall Receive_buffer_thread(uint32, uint32, uint32)');
    this.fns.GetReference = this.lib.func('uint32 __stdcall GetReference(uint32, uint32, uint8, uint32, _Out_ FD_BOARD_INFO*)');
  }

  isAvailable(): boolean {
    try {
      return existsSync(this.getDllPath());
    } catch {
      return false;
    }
  }

  getDeviceTypes(): CanDeviceType[] {
    return GC_FD_DEVICE_TYPES;
  }

  /** Return detected channel count (valid after open) */
  getChannelCount(): number {
    return this.detectedChannelCount;
  }

  /** Set FD-specific config before calling open() */
  setFdConfig(config: CanFdOpenConfig): void {
    this.fdConfig = config;
  }

  open(config: { deviceType: number; deviceIndex: number; channel: number; baudRate: number }): void {
    try {
      this.loadLib();
    } catch (err) {
      throw new Error(`Failed to load ECANFDVCI64.dll: ${(err as Error).message}`);
    }
    const fd = this.fdConfig;
    this.deviceType = config.deviceType;
    this.deviceIndex = config.deviceIndex;
    this.channel = config.channel;
    const key = this.deviceKey();

    // Only call OpenDeviceFD once per physical device
    const activeChannels = openDevices.get(key);
    if (!activeChannels || activeChannels.size === 0) {
      const ret = (this.fns.OpenDeviceFD as Function)(this.deviceType, this.deviceIndex);
      if (ret !== 0) throw new Error(`OpenDeviceFD failed (ret=${ret})`);
      openDevices.set(key, new Set());

      // Read BOARD_INFO to detect channel count
      try {
        const boardInfo = {
          hw_Version: 0, fw_Version: 0, dr_Version: 0, in_Version: 0,
          irq_Num: 0, can_Num: 0,
          str_Serial_Num: new Array(20).fill(0),
          str_hw_Type: new Array(40).fill(0),
          Reserved: [0, 0, 0, 0],
        };
        const refRet = (this.fns.GetReference as Function)(this.deviceType, this.deviceIndex, 0, 0, boardInfo);
        if (refRet === 0 && boardInfo.can_Num > 0 && boardInfo.can_Num <= 16) {
          this.detectedChannelCount = boardInfo.can_Num;
        }
      } catch {
        // GetReference not supported or failed — keep default 2
      }

      // Init + Start all detected channels
      const nominalRate = fd?.baudRate ?? config.baudRate;
      const dataRate = fd?.dataBaudRate ?? 2000000;
      const channelList = Array.from({ length: this.detectedChannelCount }, (_, i) => i);

      for (const ch of channelList) {
        // Per-channel baud rate: ch0 uses main config, ch1+ can use overrides
        const chNominal = ch === 1 && fd?.ch1BaudRate ? fd.ch1BaudRate : nominalRate;
        const chData = ch === 1 && fd?.ch1DataBaudRate ? fd.ch1DataBaudRate : dataRate;
        const nominalIdx = NOMINAL_BAUD_MAP[chNominal];
        const dataIdx = DATA_BAUD_MAP[chData];

        if (nominalIdx === undefined) throw new Error(`Unsupported nominal baud rate for ch${ch}: ${chNominal}`);
        if (dataIdx === undefined) throw new Error(`Unsupported data baud rate for ch${ch}: ${chData}`);

        const initConfig = {
          CanReceMode: 3,
          CanSendMode: fd?.mode ?? 1,
          NominalBitRate: 0,
          DataBitRate: 0,
          FilterUsedBits: 0,
          StdOrExdBits: 0,
          NominalBitRateSelect: nominalIdx,
          DataBitRateSelect: dataIdx,
          StandardORExtendedfilter1: 0, StandardORExtendedfilter1Mask: 0,
          StandardORExtendedfilter2: 0, StandardORExtendedfilter2Mask: 0,
          StandardORExtendedfilter3: 0, StandardORExtendedfilter3Mask: 0,
          StandardORExtendedfilter4: 0, StandardORExtendedfilter4Mask: 0,
          StandardORExtendedfilter5: 0, StandardORExtendedfilter5Mask: 0,
          StandardORExtendedfilter6: 0, StandardORExtendedfilter6Mask: 0,
          StandardORExtendedfilter7: 0, StandardORExtendedfilter7Mask: 0,
          StandardORExtendedfilter8: 0, StandardORExtendedfilter8Mask: 0,
        };

        let r: number;
        try {
          r = (this.fns.InitCANFD as Function)(this.deviceType, this.deviceIndex, ch, initConfig);
        } catch (err) {
          this.maybeCloseDevice();
          throw new Error(`InitCANFD ch${ch} crashed: ${(err as Error).message}`);
        }
        if (r !== 0) {
          this.maybeCloseDevice();
          throw new Error(`InitCANFD ch${ch} failed (ret=${r})`);
        }

        try {
          r = (this.fns.StartCANFD as Function)(this.deviceType, this.deviceIndex, ch);
        } catch (err) {
          this.maybeCloseDevice();
          throw new Error(`StartCANFD ch${ch} crashed: ${(err as Error).message}`);
        }
        if (r !== 0) {
          this.maybeCloseDevice();
          throw new Error(`StartCANFD ch${ch} failed (ret=${r})`);
        }

        openDevices.get(key)!.add(ch);
      }

      // Start receive buffer thread once per device
      try {
        (this.fns.Receive_buffer_thread as Function)(this.deviceType, this.deviceIndex, 100);
        this.rxThreadStarted = true;
      } catch {
        this.rxThreadStarted = false;
      }
    }

    this.opened = true;
  }

  /** Close device only if no more active channels */
  private maybeCloseDevice(): void {
    const key = this.deviceKey();
    const channels = openDevices.get(key);
    if (!channels || channels.size === 0) {
      try {
        (this.fns.CloseDeviceFD as Function)(this.deviceType, this.deviceIndex);
      } catch { /* ignore */ }
      openDevices.delete(key);
    }
  }

  close(channel?: number): void {
    const key = this.deviceKey();
    if (!this.lib) return;

    const channels = openDevices.get(key);
    if (!channels || channels.size === 0) return;

    if (channel !== undefined) {
      // Stop single channel
      try {
        (this.fns.StopCANFD as Function)(this.deviceType, this.deviceIndex, channel);
      } catch { /* ignore */ }
      channels.delete(channel);
    } else {
      // Stop all channels and close device
      for (const ch of channels) {
        try {
          (this.fns.StopCANFD as Function)(this.deviceType, this.deviceIndex, ch);
        } catch { /* ignore */ }
      }
      channels.clear();
    }

    if (channels.size === 0) {
      try {
        (this.fns.CloseDeviceFD as Function)(this.deviceType, this.deviceIndex);
      } catch { /* ignore */ }
      openDevices.delete(key);
      this.rxThreadStarted = false;
      this.rxBuffer = null;
      this.rxCapacity = 0;
    }

    this.opened = channels.size > 0;
  }

  send(channel: number, frames: CanFrame[]): number {
    if (!openDevices.get(this.deviceKey())?.size) return 0;
    const objs = frames.map((f) => {
      const dataArr = new Array(64).fill(0);
      for (let i = 0; i < Math.min(f.data.length, 64); i++) dataArr[i] = f.data[i];

      // Build CANFDFRAME_TYPE flags byte:
      //   bit0: proto (0=CAN, 1=CANFD)
      //   bit1: format (0=STD, 1=EXD)
      //   bit2: type (0=DATA, 1=RTR)
      //   bit3: bitratemode (0=off, 1=BRS on)
      let flags = 0;
      if (f.fd) flags |= 0x01;           // proto = CANFD
      if (f.extended) flags |= 0x02;     // format = EXD
      if (f.remote) flags |= 0x04;       // type = RTR
      if (f.brs) flags |= 0x08;          // bitratemode = on

      return {
        CanORCanfdType: flags,
        DataLen: f.dlc,
        Reserved: [0, 0],
        ID: f.id,
        TimeStamp: { mday: 0, hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0 },
        Data: dataArr,
      };
    });
    try {
      const ret = (this.fns.TransmitFD as Function)(
        this.deviceType, this.deviceIndex, channel, objs, objs.length
      ) as number;
      // TransmitFD returns STATUS_OK(0) on success
      return ret === 0 ? frames.length : 0;
    } catch {
      return 0;
    }
  }

  private ensureRxBuf(size: number): void {
    if (!this.rxBuffer || this.rxCapacity < size) {
      this.rxBuffer = Buffer.alloc(CANFD_OBJ_SIZE * size);
      this.rxCapacity = size;
    }
  }

  receive(channel: number, maxCount: number): CanFrame[] {
    if (!openDevices.get(this.deviceKey())?.size) return [];
    this.ensureRxBuf(maxCount);
    const buf = this.rxBuffer!;

    this.rxLenArr[0] = maxCount;

    let ret: number;
    try {
      ret = (this.fns.ReceiveFD as Function)(
        this.deviceType, this.deviceIndex, channel, buf, this.rxLenArr
      ) as number;
    } catch {
      return [];
    }

    if (ret !== 0) return [];

    const count = this.rxLenArr[0];
    if (count <= 0) return [];

    const now = Date.now();
    const frames: CanFrame[] = [];
    for (let i = 0; i < count; i++) {
      const base = i * CANFD_OBJ_SIZE;
      const flags = buf[base];
      const isFd = (flags & 0x01) !== 0;
      const isExtended = (flags & 0x02) !== 0;
      const isRemote = (flags & 0x04) !== 0;
      const isBrs = (flags & 0x08) !== 0;
      const dlc = buf[base + 1];
      const dataLen = isFd ? fdDlcToLength(dlc) : Math.min(dlc, 8);
      const data = new Array(dataLen);
      for (let j = 0; j < dataLen; j++) data[j] = buf[base + CANFD_OBJ_DATA_OFFSET + j];

      frames.push({
        id: buf.readUInt32LE(base + CANFD_OBJ_ID_OFFSET),
        extended: isExtended,
        remote: isRemote,
        dlc,
        data,
        timestamp: now,
        direction: 'rx' as const,
        fd: isFd,
        brs: isBrs,
      });
    }
    return frames;
  }
}
