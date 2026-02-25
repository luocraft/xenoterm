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
}

export interface CanDriver {
  readonly name: string;
  isAvailable(): boolean;
  getDeviceTypes(): CanDeviceType[];
  open(config: CanOpenConfig): void;
  close(channel?: number): void;
  send(channel: number, frames: CanFrame[]): number;
  receive(channel: number, maxCount: number): CanFrame[];
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
