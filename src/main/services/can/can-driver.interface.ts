/** Unified CAN driver interface — abstracts ZLG, GC, and other ControlCAN-compatible devices */

export interface CanFrame {
  id: number;
  extended: boolean;
  remote: boolean;
  dlc: number;
  data: number[];       // up to 8 bytes (classic) or 64 bytes (FD)
  timestamp: number;    // ms
  direction: 'tx' | 'rx';
  fd?: boolean;         // CAN FD frame
  brs?: boolean;        // Bit Rate Switch (FD only)
  error?: boolean;      // Error frame indicator
  errorType?: string;   // Human-readable error description
}

export interface CanDeviceType {
  code: number;
  name: string;
  channels: number;
}

export interface CanOpenConfig {
  deviceType: number;
  deviceIndex: number;
  channel: number;
  baudRate: number;
  accCode?: number;
  accMask?: number;
  filterMode?: number;  // 0=dual, 1=single
  mode?: number;        // 0=normal, 1=listen-only
  ch1BaudRate?: number; // independent baud rate for channel 1
  chBaudRates?: Record<number, number>; // per-channel baud rates (key=channel index)
}

export interface CanErrorInfo {
  errCode: number;
  passiveErrData: number[];  // 3 bytes
  arLostErrData: number;
}

export interface CanBusStatus {
  errInterrupt: number;
  regMode: number;
  regStatus: number;
  regALCapture: number;   // Arbitration Lost Capture
  regECCapture: number;   // Error Code Capture
  regEWLimit: number;     // Error Warning Limit
  rxErrCounter: number;   // Receive Error Counter
  txErrCounter: number;   // Transmit Error Counter
}

export interface CanDriver {
  readonly name: string;
  isAvailable(): boolean;
  getDeviceTypes(): CanDeviceType[];
  open(config: CanOpenConfig): void;
  close(channel?: number): void;
  send(channel: number, frames: CanFrame[]): number;
  receive(channel: number, maxCount: number): CanFrame[];
  readError?(channel: number): CanErrorInfo | null;
  readBusStatus?(channel: number): CanBusStatus | null;
  /** Hardware-level cyclic send (e.g. TOSUN tscan_add_cyclic_msg_can) */
  startCyclicSend?(channel: number, frame: CanFrame, periodMs: number): void;
  stopCyclicSend?(channel: number, frame: CanFrame): void;
  updateCyclicSend?(channel: number, frame: CanFrame, periodMs: number): void;
}

/** Baud rate → [Timing0, Timing1] for ControlCAN-compatible devices */
export const TIMING_TABLE: Record<number, [number, number]> = {
  5000:    [0xBF, 0xFF],
  10000:   [0x31, 0x1C],
  20000:   [0x18, 0x1C],
  50000:   [0x09, 0x1C],
  100000:  [0x04, 0x1C],
  125000:  [0x03, 0x1C],
  250000:  [0x01, 0x1C],
  500000:  [0x00, 0x1C],
  800000:  [0x00, 0x16],
  1000000: [0x00, 0x14],
};

/** CAN error code bit flags (ControlCAN / GC compatible) */
export const CAN_ERR = {
  OVERFLOW:  0x0001,  // Internal FIFO overflow
  ERRALARM:  0x0002,  // Error alarm
  PASSIVE:   0x0004,  // Error passive
  LOSE:      0x0008,  // Arbitration lost
  BUSERR:    0x0010,  // Bus error
  REG_FULL:  0x0020,  // Receive register full
  REG_OVER:  0x0040,  // Receive register overrun
  ACTIVE:    0x0080,  // Active error
} as const;

export function decodeCanErrCode(code: number): string[] {
  const errors: string[] = [];
  if (code & CAN_ERR.OVERFLOW)  errors.push('FIFO Overflow');
  if (code & CAN_ERR.ERRALARM)  errors.push('Error Alarm');
  if (code & CAN_ERR.PASSIVE)   errors.push('Error Passive');
  if (code & CAN_ERR.LOSE)      errors.push('Arbitration Lost');
  if (code & CAN_ERR.BUSERR)    errors.push('Bus Error');
  if (code & CAN_ERR.REG_FULL)  errors.push('RX Register Full');
  if (code & CAN_ERR.REG_OVER)  errors.push('RX Register Overrun');
  if (code & CAN_ERR.ACTIVE)    errors.push('Active Error');
  return errors;
}
