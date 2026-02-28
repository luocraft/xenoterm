/**
 * PEAK PCAN driver — FFI bindings via koffi for PCANBasic.dll
 */
import koffi from 'koffi';
import { join } from 'path';
import { existsSync } from 'fs';
import type { CanDriver, CanFrame, CanDeviceType, CanOpenConfig } from './can-driver.interface';

// PCAN channel handles
const PCAN_USBBUS1 = 0x51;
const PCAN_USBBUS2 = 0x52;
const PCAN_USBBUS3 = 0x53;
const PCAN_USBBUS4 = 0x54;
const PCAN_USBBUS5 = 0x55;
const PCAN_USBBUS6 = 0x56;
const PCAN_USBBUS7 = 0x57;
const PCAN_USBBUS8 = 0x58;

// PCAN baud rates
const PCAN_BAUD: Record<number, number> = {
  5000:    0x7F7F,
  10000:   0x672F,
  20000:   0x532F,
  50000:   0x472F,
  100000:  0x432F,
  125000:  0x031C,
  250000:  0x011C,
  500000:  0x001C,
  800000:  0x0016,
  1000000: 0x0014,
};

// PCAN message type flags
const PCAN_MESSAGE_STANDARD = 0x00;
const PCAN_MESSAGE_RTR      = 0x01;
const PCAN_MESSAGE_EXTENDED = 0x02;

// PCAN error codes
const PCAN_ERROR_OK       = 0x00000;
const PCAN_ERROR_QRCVEMPTY = 0x00020;

const PEAK_DEVICE_TYPES: CanDeviceType[] = [
  { code: 1, name: 'PCAN-USB (CH1)', channels: 1 },
  { code: 2, name: 'PCAN-USB (CH1+CH2)', channels: 2 },
];

const PCAN_USB_CHANNELS = [
  PCAN_USBBUS1, PCAN_USBBUS2, PCAN_USBBUS3, PCAN_USBBUS4,
  PCAN_USBBUS5, PCAN_USBBUS6, PCAN_USBBUS7, PCAN_USBBUS8,
];

export class PeakCanDriver implements CanDriver {
  readonly name = 'PEAK';
  private lib: koffi.IKoffiLib | null = null;
  private fns: Record<string, (...args: unknown[]) => unknown> = {};
  private opened = false;
  private channelCount = 1;
  private activeChannels: number[] = []; // PCAN channel handles

  private getDllPath(): string {
    const candidates = [
      join(process.resourcesPath || '', 'can', 'peak', 'PCANBasic.dll'),
      join(__dirname, '../../../../resources/can/peak/PCANBasic.dll'),
      join(process.cwd(), 'resources/can/peak/PCANBasic.dll'),
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

    // TPCANStatus CAN_Initialize(TPCANHandle Channel, TPCANBaudrate Btr0Btr1, ...)
    this.fns.CAN_Initialize = this.lib.func('uint32 CAN_Initialize(uint16, uint16, uint8, uint8, uint16)');
    // TPCANStatus CAN_Uninitialize(TPCANHandle Channel)
    this.fns.CAN_Uninitialize = this.lib.func('uint32 CAN_Uninitialize(uint16)');
    // TPCANStatus CAN_Write(TPCANHandle Channel, TPCANMsg* MessageBuffer)
    this.fns.CAN_Write = this.lib.func('uint32 CAN_Write(uint16, _Inout_ TPCANMsg*)');
    // TPCANStatus CAN_Read(TPCANHandle Channel, TPCANMsg* MessageBuffer, TPCANTimestamp* TimestampBuffer)
    this.fns.CAN_Read = this.lib.func('uint32 CAN_Read(uint16, _Out_ TPCANMsg*, _Out_ TPCANTimestamp*)');
  }

  isAvailable(): boolean {
    try {
      return existsSync(this.getDllPath());
    } catch {
      return false;
    }
  }

  getDeviceTypes(): CanDeviceType[] {
    return PEAK_DEVICE_TYPES;
  }

  getChannelCount(): number {
    return this.channelCount;
  }

  open(config: CanOpenConfig): void {
    this.loadLib();

    const devType = PEAK_DEVICE_TYPES.find((d) => d.code === config.deviceType);
    this.channelCount = devType?.channels ?? 1;

    const baud = PCAN_BAUD[config.baudRate];
    if (baud === undefined) throw new Error(`Unsupported baud rate: ${config.baudRate}`);

    this.activeChannels = [];
    for (let ch = 0; ch < this.channelCount; ch++) {
      const handle = PCAN_USB_CHANNELS[config.deviceIndex * this.channelCount + ch];
      if (!handle) throw new Error(`Invalid channel index: ${ch}`);

      const chBaud = (ch === 1 && config.ch1BaudRate) ? (PCAN_BAUD[config.ch1BaudRate] ?? baud) : baud;
      // CAN_Initialize(channel, baudrate, hwType=0, ioPort=0, interrupt=0)
      const ret = (this.fns.CAN_Initialize as Function)(handle, chBaud, 0, 0, 0) as number;
      if (ret !== PCAN_ERROR_OK) {
        // Cleanup already opened channels
        for (const h of this.activeChannels) {
          (this.fns.CAN_Uninitialize as Function)(h);
        }
        this.activeChannels = [];
        throw new Error(`CAN_Initialize failed for channel ${ch} (error=0x${ret.toString(16)})`);
      }
      this.activeChannels.push(handle);
    }

    this.opened = true;
  }

  close(_channel?: number): void {
    if (!this.lib) return;
    for (const handle of this.activeChannels) {
      try {
        (this.fns.CAN_Uninitialize as Function)(handle);
      } catch { /* ignore */ }
    }
    this.activeChannels = [];
    this.opened = false;
  }

  send(channel: number, frames: CanFrame[]): number {
    if (!this.opened || channel >= this.activeChannels.length) return 0;
    const handle = this.activeChannels[channel];
    let sent = 0;
    for (const f of frames) {
      let msgType = PCAN_MESSAGE_STANDARD;
      if (f.extended) msgType |= PCAN_MESSAGE_EXTENDED;
      if (f.remote) msgType |= PCAN_MESSAGE_RTR;

      const msg = {
        ID: f.id,
        MSGTYPE: msgType,
        LEN: f.dlc,
        DATA: [...f.data.slice(0, 8), ...new Array(8 - Math.min(f.data.length, 8)).fill(0)],
      };
      const ret = (this.fns.CAN_Write as Function)(handle, msg) as number;
      if (ret === PCAN_ERROR_OK) sent++;
    }
    return sent;
  }

  receive(channel: number, maxCount: number): CanFrame[] {
    if (!this.opened || channel >= this.activeChannels.length) return [];
    const handle = this.activeChannels[channel];
    const frames: CanFrame[] = [];
    const now = Date.now();

    for (let i = 0; i < maxCount; i++) {
      const msg = { ID: 0, MSGTYPE: 0, LEN: 0, DATA: [0, 0, 0, 0, 0, 0, 0, 0] };
      const ts = { millis: 0, millis_overflow: 0, micros: 0 };
      const ret = (this.fns.CAN_Read as Function)(handle, msg, ts) as number;
      if (ret === PCAN_ERROR_QRCVEMPTY || ret !== PCAN_ERROR_OK) break;

      frames.push({
        id: msg.ID,
        extended: (msg.MSGTYPE & PCAN_MESSAGE_EXTENDED) !== 0,
        remote: (msg.MSGTYPE & PCAN_MESSAGE_RTR) !== 0,
        dlc: msg.LEN,
        data: Array.from(msg.DATA).slice(0, msg.LEN),
        timestamp: now,
        direction: 'rx',
      });
    }
    return frames;
  }
}

// koffi struct definitions — must be registered before loadLib uses them
koffi.struct('TPCANMsg', {
  ID: 'uint32',
  MSGTYPE: 'uint8',
  LEN: 'uint8',
  DATA: koffi.array('uint8', 8),
});

koffi.struct('TPCANTimestamp', {
  millis: 'uint32',
  millis_overflow: 'uint16',
  micros: 'uint16',
});
