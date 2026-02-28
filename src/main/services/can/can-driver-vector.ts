/**
 * Vector XL Driver Library — FFI bindings via koffi for vxlapi.dll
 */
import koffi from 'koffi';
import { join } from 'path';
import { existsSync } from 'fs';
import type { CanDriver, CanFrame, CanDeviceType, CanOpenConfig } from './can-driver.interface';

// XL status codes
const XL_SUCCESS = 0;
const XL_ERR_QUEUE_IS_EMPTY = 10;

// XL bus type
const XL_BUS_TYPE_CAN = 0x00000001;

// XL interface version
const XL_INTERFACE_VERSION = 3;

// XL channel access mask
const XL_ACTIVATE_NONE = 0;

// XL event tags
const XL_RECEIVE_MSG = 1;

// CAN message flags
const XL_CAN_MSG_FLAG_ERROR_FRAME = 0x01;
const XL_CAN_MSG_FLAG_OVERRUN     = 0x02;
const XL_CAN_MSG_FLAG_NERR        = 0x04;
const XL_CAN_MSG_FLAG_WAKEUP      = 0x08;
const XL_CAN_MSG_FLAG_REMOTE_FRAME = 0x10;
const XL_CAN_MSG_FLAG_TX_COMPLETED = 0x40;

// XL baud rate presets
const VECTOR_BAUD: Record<number, number> = {
  5000:    5000,
  10000:   10000,
  20000:   20000,
  50000:   50000,
  100000:  100000,
  125000:  125000,
  250000:  250000,
  500000:  500000,
  800000:  800000,
  1000000: 1000000,
};

const VECTOR_DEVICE_TYPES: CanDeviceType[] = [
  { code: 1, name: 'Vector (1-CH)', channels: 1 },
  { code: 2, name: 'Vector (2-CH)', channels: 2 },
];

export class VectorCanDriver implements CanDriver {
  readonly name = 'Vector';
  private lib: koffi.IKoffiLib | null = null;
  private fns: Record<string, (...args: unknown[]) => unknown> = {};
  private opened = false;
  private channelCount = 1;
  private portHandle = -1;
  private accessMask = 0n; // BigInt for XLaccess (uint64)
  private permissionMask = 0n;

  private getDllPath(): string {
    const candidates = [
      join(process.resourcesPath || '', 'can', 'vector', 'vxlapi.dll'),
      join(__dirname, '../../../../resources/can/vector/vxlapi.dll'),
      join(process.cwd(), 'resources/can/vector/vxlapi.dll'),
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

    // XLstatus xlOpenDriver(void)
    this.fns.xlOpenDriver = this.lib.func('int xlOpenDriver()');
    // XLstatus xlCloseDriver(void)
    this.fns.xlCloseDriver = this.lib.func('int xlCloseDriver()');
    // XLstatus xlGetApplConfig(char* appName, uint appChannel, uint* pHwType, uint* pHwIndex, uint* pHwChannel, uint busType)
    this.fns.xlGetApplConfig = this.lib.func('int xlGetApplConfig(str, uint32, _Out_ uint32*, _Out_ uint32*, _Out_ uint32*, uint32)');
    // XLaccess xlGetChannelMask(int hwType, int hwIndex, int hwChannel)
    this.fns.xlGetChannelMask = this.lib.func('uint64 xlGetChannelMask(int, int, int)');
    // XLstatus xlOpenPort(XLportHandle* pPortHandle, char* userName, XLaccess accessMask, XLaccess* pPermissionMask, uint rxQueueSize, uint xlInterfaceVersion, uint busType)
    this.fns.xlOpenPort = this.lib.func('int xlOpenPort(_Out_ int*, str, uint64, _Inout_ uint64*, uint32, uint32, uint32)');
    // XLstatus xlCanSetChannelBitrate(XLportHandle portHandle, XLaccess accessMask, unsigned long bitrate)
    this.fns.xlCanSetChannelBitrate = this.lib.func('int xlCanSetChannelBitrate(int, uint64, uint32)');
    // XLstatus xlActivateChannel(XLportHandle portHandle, XLaccess accessMask, uint busType, uint flags)
    this.fns.xlActivateChannel = this.lib.func('int xlActivateChannel(int, uint64, uint32, uint32)');
    // XLstatus xlDeactivateChannel(XLportHandle portHandle, XLaccess accessMask)
    this.fns.xlDeactivateChannel = this.lib.func('int xlDeactivateChannel(int, uint64)');
    // XLstatus xlClosePort(XLportHandle portHandle)
    this.fns.xlClosePort = this.lib.func('int xlClosePort(int)');
    // XLstatus xlCanTransmit(XLportHandle portHandle, XLaccess accessMask, uint* messageCount, void* pMessages)
    this.fns.xlCanTransmit = this.lib.func('int xlCanTransmit(int, uint64, _Inout_ uint32*, _Inout_ XLevent*)');
    // XLstatus xlReceive(XLportHandle portHandle, uint* pEventCount, void* pEventList)
    this.fns.xlReceive = this.lib.func('int xlReceive(int, _Inout_ uint32*, _Out_ XLevent*)');
  }

  isAvailable(): boolean {
    try {
      return existsSync(this.getDllPath());
    } catch {
      return false;
    }
  }

  getDeviceTypes(): CanDeviceType[] {
    return VECTOR_DEVICE_TYPES;
  }

  getChannelCount(): number {
    return this.channelCount;
  }

  open(config: CanOpenConfig): void {
    this.loadLib();

    const devType = VECTOR_DEVICE_TYPES.find((d) => d.code === config.deviceType);
    this.channelCount = devType?.channels ?? 1;

    const baud = VECTOR_BAUD[config.baudRate];
    if (baud === undefined) throw new Error(`Unsupported baud rate: ${config.baudRate}`);

    // Open driver
    let ret = (this.fns.xlOpenDriver as Function)() as number;
    if (ret !== XL_SUCCESS) throw new Error(`xlOpenDriver failed (ret=${ret})`);

    // Build channel access mask
    this.accessMask = 0n;
    for (let ch = 0; ch < this.channelCount; ch++) {
      const hwChannel = config.deviceIndex * this.channelCount + ch;
      // Get channel mask — use hardware type 57 (XL_HWTYPE_VN1610) as default, or 0 for auto
      const mask = (this.fns.xlGetChannelMask as Function)(0, 0, hwChannel) as bigint;
      this.accessMask |= BigInt(mask);
    }

    if (this.accessMask === 0n) {
      throw new Error('No Vector CAN channels found. Check hardware connection and Vector Hardware Config.');
    }

    // Open port
    const portHandleBuf = [0];
    const permBuf = [this.accessMask];
    ret = (this.fns.xlOpenPort as Function)(
      portHandleBuf, 'XenoTerm', this.accessMask, permBuf, 256, XL_INTERFACE_VERSION, XL_BUS_TYPE_CAN
    ) as number;
    if (ret !== XL_SUCCESS) {
      (this.fns.xlCloseDriver as Function)();
      throw new Error(`xlOpenPort failed (ret=${ret})`);
    }
    this.portHandle = portHandleBuf[0];
    this.permissionMask = BigInt(permBuf[0]);

    // Set bitrate
    if (this.permissionMask !== 0n) {
      ret = (this.fns.xlCanSetChannelBitrate as Function)(this.portHandle, this.accessMask, baud) as number;
      if (ret !== XL_SUCCESS) {
        (this.fns.xlClosePort as Function)(this.portHandle);
        (this.fns.xlCloseDriver as Function)();
        throw new Error(`xlCanSetChannelBitrate failed (ret=${ret})`);
      }
    }

    // Activate channel
    ret = (this.fns.xlActivateChannel as Function)(this.portHandle, this.accessMask, XL_BUS_TYPE_CAN, XL_ACTIVATE_NONE) as number;
    if (ret !== XL_SUCCESS) {
      (this.fns.xlClosePort as Function)(this.portHandle);
      (this.fns.xlCloseDriver as Function)();
      throw new Error(`xlActivateChannel failed (ret=${ret})`);
    }

    this.opened = true;
  }

  close(_channel?: number): void {
    if (!this.lib || !this.opened) return;
    try {
      (this.fns.xlDeactivateChannel as Function)(this.portHandle, this.accessMask);
      (this.fns.xlClosePort as Function)(this.portHandle);
      (this.fns.xlCloseDriver as Function)();
    } catch { /* ignore */ }
    this.opened = false;
    this.portHandle = -1;
  }

  send(channel: number, frames: CanFrame[]): number {
    if (!this.opened) return 0;
    let sent = 0;
    for (const f of frames) {
      let flags = 0;
      if (f.remote) flags |= XL_CAN_MSG_FLAG_REMOTE_FRAME;

      const event = {
        tag: XL_RECEIVE_MSG,
        chanIndex: channel,
        transId: 0,
        portHandle: 0,
        flags: 0,
        reserved: 0,
        timeStamp: 0n,
        tagData: {
          msg: {
            id: f.extended ? (f.id | 0x80000000) : f.id,
            flags,
            dlc: f.dlc,
            data: [...f.data.slice(0, 8), ...new Array(8 - Math.min(f.data.length, 8)).fill(0)],
          }
        }
      };
      const countBuf = [1];
      const ret = (this.fns.xlCanTransmit as Function)(this.portHandle, this.accessMask, countBuf, event) as number;
      if (ret === XL_SUCCESS) sent++;
    }
    return sent;
  }

  receive(channel: number, maxCount: number): CanFrame[] {
    if (!this.opened) return [];
    const frames: CanFrame[] = [];
    const now = Date.now();

    for (let i = 0; i < maxCount; i++) {
      const countBuf = [1];
      const event = {
        tag: 0, chanIndex: 0, transId: 0, portHandle: 0, flags: 0, reserved: 0,
        timeStamp: 0n,
        tagData: { msg: { id: 0, flags: 0, dlc: 0, data: [0, 0, 0, 0, 0, 0, 0, 0] } }
      };
      const ret = (this.fns.xlReceive as Function)(this.portHandle, countBuf, event) as number;
      if (ret === XL_ERR_QUEUE_IS_EMPTY || ret !== XL_SUCCESS) break;
      if (event.tag !== XL_RECEIVE_MSG) continue;

      const msg = event.tagData.msg;
      const extended = (msg.id & 0x80000000) !== 0;
      frames.push({
        id: msg.id & 0x1FFFFFFF,
        extended,
        remote: (msg.flags & XL_CAN_MSG_FLAG_REMOTE_FRAME) !== 0,
        dlc: msg.dlc,
        data: Array.from(msg.data).slice(0, msg.dlc),
        timestamp: now,
        direction: 'rx',
      });
    }
    return frames;
  }
}

// koffi struct definitions for XL events
koffi.struct('s_xl_can_msg', {
  id: 'uint32',
  flags: 'uint16',
  dlc: 'uint16',
  data: koffi.array('uint8', 8),
});

koffi.struct('s_xl_tag_data', {
  msg: 's_xl_can_msg',
});

koffi.struct('XLevent', {
  tag: 'uint8',
  chanIndex: 'uint8',
  transId: 'uint16',
  portHandle: 'uint16',
  flags: 'uint8',
  reserved: 'uint8',
  timeStamp: 'uint64',
  tagData: 's_xl_tag_data',
});
