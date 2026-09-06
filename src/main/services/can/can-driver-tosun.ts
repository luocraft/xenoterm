/**
 * TOSUN (同星) CAN driver — uses libTSCAN.dll
 * API reference: https://github.com/TOSUN-Shanghai/libTSCANDemos
 */
import koffi from 'koffi';
import { join } from 'path';
import { existsSync } from 'fs';
import type { CanDriver, CanFrame, CanDeviceType, CanOpenConfig } from './can-driver.interface';

/* ── koffi struct definitions matching libTSCAN.h ── */

const TCANProperty = koffi.struct('TCANProperty', { value: 'uint8' });

const TLIBCAN = koffi.struct('TLIBCAN', {
  FIdxChn: 'uint8',
  FProperties: TCANProperty,
  FDLC: 'uint8',
  FReserved: 'uint8',
  FIdentifier: 'int32',
  FTimeUS: 'uint64',
  FData: koffi.array('uint8', 8),
});

const TLIBCANFD = koffi.struct('TLIBCANFD', {
  FIdxChn: 'uint8',
  FProperties: TCANProperty,
  FDLC: 'uint8',
  FFDProperties: 'uint8',
  FIdentifier: 'int32',
  FTimeUS: 'uint64',
  FData: koffi.array('uint8', 64),
});

const TOSUN_DEVICE_TYPES: CanDeviceType[] = [
  { code: 0, name: 'TC1005', channels: 2 },
  { code: 1, name: 'TC1014', channels: 1 },
  { code: 2, name: 'TC1016', channels: 2 },
  { code: 3, name: 'TC1016P', channels: 4 },
  { code: 4, name: 'TC1011', channels: 2 },
  { code: 5, name: 'TC1002', channels: 2 },
];

export class TosunCanDriver implements CanDriver {
  readonly name = 'TOSUN';
  private lib: koffi.IKoffiLib | null = null;
  private fns: Record<string, (...args: unknown[]) => unknown> = {};
  private handle: number = 0;
  private opened = false;
  private channelCount = 2;
  private initialized = false;
  // Pre-allocated receive buffer to avoid GC pressure
  private rxBuf: Array<{ FIdxChn: number; FProperties: { value: number }; FDLC: number; FReserved: number; FIdentifier: number; FTimeUS: bigint; FData: number[] }> | null = null;

  private getDllPath(): string {
    const candidates = [
      join(process.resourcesPath || '', 'can', 'tosun', 'libTSCAN.dll'),
      join(__dirname, '../../../../resources/can/tosun/libTSCAN.dll'),
      join(process.cwd(), 'resources/can/tosun/libTSCAN.dll'),
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

    // Library init/finalize
    this.fns.initialize = this.lib.func('void __stdcall initialize_lib_tscan(bool, bool, bool)');
    this.fns.finalize = this.lib.func('void __stdcall finalize_lib_tscan()');

    // Device scan & connect
    this.fns.scanDevices = this.lib.func('uint32 __stdcall tscan_scan_devices(_Out_ uint32*)');
    this.fns.getDeviceInfo = this.lib.func('uint32 __stdcall tscan_get_device_info(int32, _Out_ char**, _Out_ char**, _Out_ char**)');
    this.fns.connect = this.lib.func('uint32 __stdcall tscan_connect(const char*, _Out_ size_t*)');
    this.fns.getCanChannelCount = this.lib.func('uint32 __stdcall tscan_get_can_channel_count(size_t, _Out_ int32*)');
    this.fns.disconnectByHandle = this.lib.func('uint32 __stdcall tscan_disconnect_by_handle(size_t)');
    this.fns.disconnectAll = this.lib.func('uint32 __stdcall tscan_disconnect_all_devices()');

    // CAN config & transmit
    this.fns.configCanBaudrate = this.lib.func('uint32 __stdcall tscan_config_can_by_baudrate(size_t, int32, double, uint32)');
    this.fns.transmitCanAsync = this.lib.func('uint32 __stdcall tscan_transmit_can_async(size_t, const TLIBCAN*)');

    // FIFO receive
    this.fns.receiveCanMsgs = this.lib.func('uint32 __stdcall tsfifo_receive_can_msgs(size_t, _Out_ TLIBCAN*, _Inout_ int32*, uint8, uint8)');

    // Cyclic messages
    this.fns.addCyclicMsgCan = this.lib.func('uint32 __stdcall tscan_add_cyclic_msg_can(size_t, const TLIBCAN*, float)');
    this.fns.deleteCyclicMsgCan = this.lib.func('uint32 __stdcall tscan_delete_cyclic_msg_can(size_t, const TLIBCAN*)');

    // Error description
    this.fns.getErrorDesc = this.lib.func('uint32 __stdcall tscan_get_error_description(uint32, _Out_ char**)');
  }

  isAvailable(): boolean {
    try {
      return existsSync(this.getDllPath());
    } catch {
      return false;
    }
  }

  getDeviceTypes(): CanDeviceType[] {
    return TOSUN_DEVICE_TYPES;
  }

  getChannelCount(): number {
    return this.channelCount;
  }

  open(config: CanOpenConfig): void {
    this.loadLib();

    // Initialize library (enable FIFO, enable error frames, use HW timestamp)
    if (!this.initialized) {
      (this.fns.initialize as Function)(true, true, true);
      this.initialized = true;
    }

    // Scan for devices
    const countBuf = [0];
    let ret = (this.fns.scanDevices as Function)(countBuf) as number;
    if (ret !== 0) throw new Error(`tscan_scan_devices failed (ret=${ret}${this.getErrDesc(ret)})`);
    const deviceCount = countBuf[0];
    if (deviceCount === 0) throw new Error('No TOSUN devices found');

    // Find device by index (config.deviceIndex)
    const idx = config.deviceIndex;
    if (idx >= deviceCount) throw new Error(`Device index ${idx} out of range (found ${deviceCount} devices)`);

    const mfgPtr = [null];
    const prodPtr = [null];
    const serialPtr = [null];
    ret = (this.fns.getDeviceInfo as Function)(idx, mfgPtr, prodPtr, serialPtr) as number;
    if (ret !== 0) throw new Error(`tscan_get_device_info failed (ret=${ret}${this.getErrDesc(ret)})`);

    const serial = serialPtr[0] as unknown as string;
    const product = prodPtr[0] as unknown as string;
    console.log(`[TOSUN] Connecting to device #${idx}: ${product}, serial=${serial}`);

    // Connect by serial number
    const handleBuf = [0];
    ret = (this.fns.connect as Function)(serial, handleBuf) as number;
    if (ret !== 0) throw new Error(`tscan_connect failed (ret=${ret}${this.getErrDesc(ret)})`);
    this.handle = handleBuf[0];

    // Query actual CAN channel count
    const chCountBuf = [0];
    ret = (this.fns.getCanChannelCount as Function)(this.handle, chCountBuf) as number;
    if (ret === 0 && chCountBuf[0] > 0) {
      this.channelCount = chCountBuf[0];
    } else {
      const devType = TOSUN_DEVICE_TYPES.find((d) => d.code === config.deviceType);
      this.channelCount = devType?.channels ?? 2;
    }

    // Configure baud rate for all channels (use unified baudRate for all)
    for (let ch = 0; ch < this.channelCount; ch++) {
      const chBaud = config.chBaudRates?.[ch] ?? config.baudRate;
      const rateKbps = chBaud / 1000;
      const use120ohm = 1;
      ret = (this.fns.configCanBaudrate as Function)(this.handle, ch, rateKbps, use120ohm) as number;
      if (ret !== 0) {
        console.warn(`[TOSUN] tscan_config_can_by_baudrate ch${ch} failed (ret=${ret}${this.getErrDesc(ret)})`);
      }
    }

    this.opened = true;
    console.log(`[TOSUN] Opened device, handle=${this.handle}, channels=${this.channelCount}`);
  }

  close(): void {
    if (!this.lib || !this.opened) return;
    try {
      (this.fns.disconnectByHandle as Function)(this.handle);
    } catch { /* ignore */ }
    this.opened = false;
    this.handle = 0;
  }

  send(channel: number, frames: CanFrame[]): number {
    if (!this.opened) return 0;
    let sent = 0;
    for (const f of frames) {
      const props = (f.extended ? 0x04 : 0) | (f.remote ? 0x02 : 0) | 0x01; // bit0=TX
      const data = new Array(8).fill(0);
      for (let i = 0; i < Math.min(f.data.length, 8); i++) data[i] = f.data[i];

      const canObj = {
        FIdxChn: channel,
        FProperties: { value: props },
        FDLC: f.dlc,
        FReserved: 0,
        FIdentifier: f.id,
        FTimeUS: 0n,
        FData: data,
      };
      const ret = (this.fns.transmitCanAsync as Function)(this.handle, canObj) as number;
      if (ret === 0) sent++;
    }
    return sent;
  }

  private ensureRxBuf(size: number): void {
    if (!this.rxBuf || this.rxBuf.length < size) {
      this.rxBuf = new Array(size).fill(null).map(() => ({
        FIdxChn: 0,
        FProperties: { value: 0 },
        FDLC: 0,
        FReserved: 0,
        FIdentifier: 0,
        FTimeUS: 0n,
        FData: [0, 0, 0, 0, 0, 0, 0, 0],
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
      o.FIdxChn = 0; o.FProperties.value = 0; o.FDLC = 0;
      o.FReserved = 0; o.FIdentifier = 0; o.FTimeUS = 0n;
    }

    const sizeBuf = [maxCount];
    // ARXTX: 0 = only RX, 1 = TX+RX
    const ret = (this.fns.receiveCanMsgs as Function)(this.handle, buf, sizeBuf, channel, 1) as number;
    if (ret !== 0 || sizeBuf[0] <= 0) return [];

    const count = sizeBuf[0];
    // Use hardware timestamps: FTimeUS is microseconds from device power-on.
    // Map to system time: anchor first frame's HW timestamp to Date.now(),
    // then compute offsets for subsequent frames.
    const now = Date.now();
    const frames: CanFrame[] = [];
    let anchorHwUs: bigint | null = null;
    let anchorMs = now;

    for (let i = 0; i < count; i++) {
      const obj = buf[i];
      const props = obj.FProperties.value;
      const hwUs = BigInt(obj.FTimeUS);

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
        id: obj.FIdentifier,
        extended: (props & 0x04) !== 0,
        remote: (props & 0x02) !== 0,
        dlc: obj.FDLC,
        data: Array.from(obj.FData).slice(0, obj.FDLC),
        timestamp: ts,
        direction: (props & 0x01) ? 'tx' as const : 'rx' as const,
        error: (props & 0x80) !== 0,
      });
    }
    return frames;
  }

  private buildTLIBCAN(channel: number, frame: CanFrame): Record<string, unknown> {
    const props = (frame.extended ? 0x04 : 0) | (frame.remote ? 0x02 : 0);
    const data = new Array(8).fill(0);
    for (let i = 0; i < Math.min(frame.data.length, 8); i++) data[i] = frame.data[i];
    return {
      FIdxChn: channel,
      FProperties: { value: props },
      FDLC: frame.dlc,
      FReserved: 0,
      FIdentifier: frame.id,
      FTimeUS: 0n,
      FData: data,
    };
  }

  startCyclicSend(channel: number, frame: CanFrame, periodMs: number): void {
    if (!this.opened) throw new Error('Device not opened');
    const canObj = this.buildTLIBCAN(channel, frame);
    console.log(`[TOSUN] Calling tscan_add_cyclic_msg_can: handle=${this.handle}, ch=${channel}, id=0x${frame.id.toString(16)}, period=${periodMs}ms`);
    const ret = (this.fns.addCyclicMsgCan as Function)(this.handle, canObj, periodMs) as number;
    if (ret !== 0) {
      const desc = this.getErrDesc(ret);
      console.error(`[TOSUN] tscan_add_cyclic_msg_can FAILED: ret=${ret}${desc}`);
      throw new Error(`tscan_add_cyclic_msg_can failed (ret=${ret}${desc})`);
    }
    console.log(`[TOSUN] tscan_add_cyclic_msg_can SUCCESS: ch=${channel} id=0x${frame.id.toString(16)} period=${periodMs}ms`);
  }

  stopCyclicSend(channel: number, frame: CanFrame): void {
    if (!this.opened) return;
    const canObj = this.buildTLIBCAN(channel, frame);
    const ret = (this.fns.deleteCyclicMsgCan as Function)(this.handle, canObj) as number;
    if (ret !== 0) {
      console.warn(`[TOSUN] tscan_delete_cyclic_msg_can failed (ret=${ret}${this.getErrDesc(ret)})`);
    } else {
      console.log(`[TOSUN] Stopped cyclic send: ch=${channel} id=0x${frame.id.toString(16)}`);
    }
  }

  updateCyclicSend(channel: number, frame: CanFrame, periodMs: number): void {
    if (!this.opened) return;
    // Delete then re-add with new data/period
    try { this.stopCyclicSend(channel, frame); } catch { /* ignore */ }
    this.startCyclicSend(channel, frame, periodMs);
  }

  private getErrDesc(code: number): string {
    if (!this.lib || code === 0) return '';
    try {
      const descPtr = [null];
      const ret = (this.fns.getErrorDesc as Function)(code, descPtr) as number;
      if (ret === 0 && descPtr[0]) return ` - ${descPtr[0]}`;
    } catch { /* ignore */ }
    return '';
  }
}
