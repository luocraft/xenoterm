/**
 * ISO 15765-2 (ISO-TP) Transport Layer for CAN/CAN FD.
 * Handles segmentation and reassembly of UDS messages over CAN frames.
 */
import type { CanFrame } from './can-driver.interface';

export interface IsoTpConfig {
  txId: number;
  rxId: number;
  extended?: boolean;   // extended CAN ID
  fd?: boolean;         // use CAN FD frames
  brs?: boolean;        // bit rate switch (FD)
  padding?: number;     // pad byte (default 0xCC)
  blockSize?: number;   // BS for flow control (0 = no limit)
  stMin?: number;       // STmin in ms for flow control
  timeout?: number;     // response timeout in ms (default 1000)
}

export type SendFrameFn = (frame: CanFrame) => void;
export type OnCompleteFn = (data: number[]) => void;
export type OnErrorFn = (error: string) => void;

const MAX_CAN_DATA = 8;
const MAX_CANFD_DATA = 64;

export class IsoTpTransport {
  private config: Required<IsoTpConfig>;
  private sendFrame: SendFrameFn;

  // RX reassembly state
  private rxBuffer: number[] = [];
  private rxExpectedLen = 0;
  private rxSeqNum = 0;
  private rxBlockCount = 0;
  private rxTimer: ReturnType<typeof setTimeout> | null = null;
  private onComplete: OnCompleteFn | null = null;
  private onError: OnErrorFn | null = null;

  constructor(config: IsoTpConfig, sendFrame: SendFrameFn) {
    this.config = {
      txId: config.txId,
      rxId: config.rxId,
      extended: config.extended ?? false,
      fd: config.fd ?? false,
      brs: config.brs ?? false,
      padding: config.padding ?? 0xCC,
      blockSize: config.blockSize ?? 0,
      stMin: config.stMin ?? 10,
      timeout: config.timeout ?? 1000,
    };
    this.sendFrame = sendFrame;
  }

  /** Max data bytes per CAN frame (excluding PCI) */
  private get maxFrameData(): number {
    return this.config.fd ? MAX_CANFD_DATA : MAX_CAN_DATA;
  }

  /** Build and pad a CAN frame */
  private buildFrame(data: number[]): CanFrame {
    const maxLen = this.maxFrameData;
    const padded = [...data];
    while (padded.length < maxLen) padded.push(this.config.padding);
    return {
      id: this.config.txId,
      extended: this.config.extended,
      remote: false,
      dlc: padded.length,
      data: padded,
      timestamp: 0,
      direction: 'tx',
      fd: this.config.fd || undefined,
      brs: this.config.brs || undefined,
    };
  }

  /**
   * Send a UDS payload via ISO-TP.
   * Handles Single Frame or First Frame + Consecutive Frames.
   */
  send(payload: number[]): void {
    const maxSf = this.maxFrameData - 1; // 1 byte PCI for SF
    if (payload.length <= maxSf) {
      // Single Frame: PCI = 0x0L where L = length
      const pci = payload.length & 0x0F;
      this.sendFrame(this.buildFrame([pci, ...payload]));
    } else {
      // First Frame: PCI = [0x1L, LL] where 0x1LLL = total length
      const len = payload.length;
      const ff0 = 0x10 | ((len >> 8) & 0x0F);
      const ff1 = len & 0xFF;
      const ffDataLen = this.maxFrameData - 2; // 2 bytes PCI for FF
      this.sendFrame(this.buildFrame([ff0, ff1, ...payload.slice(0, ffDataLen)]));

      // Wait for Flow Control before sending CFs
      let offset = ffDataLen;
      let seqNum = 1;

      // Store remaining data for CF sending (triggered by FC)
      this.pendingTx = { payload, offset, seqNum };
    }
  }

  // Pending TX state for multi-frame
  private pendingTx: { payload: number[]; offset: number; seqNum: number } | null = null;

  /** Send consecutive frames after receiving Flow Control */
  private sendConsecutiveFrames(): void {
    if (!this.pendingTx) return;
    const { payload } = this.pendingTx;
    let { offset, seqNum } = this.pendingTx;
    const cfDataLen = this.maxFrameData - 1; // 1 byte PCI for CF

    const bs = this.config.blockSize;
    let blockSent = 0;

    const sendNext = () => {
      if (offset >= payload.length) {
        this.pendingTx = null;
        return;
      }
      if (bs > 0 && blockSent >= bs) {
        // Wait for next FC
        this.pendingTx = { payload, offset, seqNum };
        return;
      }
      const pci = 0x20 | (seqNum & 0x0F);
      const chunk = payload.slice(offset, offset + cfDataLen);
      this.sendFrame(this.buildFrame([pci, ...chunk]));
      offset += cfDataLen;
      seqNum = (seqNum + 1) & 0x0F;
      blockSent++;

      if (offset < payload.length && (bs === 0 || blockSent < bs)) {
        setTimeout(sendNext, this.config.stMin);
      } else if (offset >= payload.length) {
        this.pendingTx = null;
      } else {
        this.pendingTx = { payload, offset, seqNum };
      }
    };
    sendNext();
  }

  /**
   * Process an incoming CAN frame (should be pre-filtered to rxId).
   * Call this for every frame with id === config.rxId.
   */
  processFrame(frame: CanFrame): void {
    if (frame.data.length < 1) return;
    const pciType = (frame.data[0] >> 4) & 0x0F;

    switch (pciType) {
      case 0: // Single Frame
        this.handleSingleFrame(frame.data);
        break;
      case 1: // First Frame
        this.handleFirstFrame(frame.data);
        break;
      case 2: // Consecutive Frame
        this.handleConsecutiveFrame(frame.data);
        break;
      case 3: // Flow Control
        this.handleFlowControl(frame.data);
        break;
    }
  }

  private handleSingleFrame(data: number[]): void {
    const len = data[0] & 0x0F;
    if (len === 0 || len > data.length - 1) return;
    const payload = data.slice(1, 1 + len);
    this.clearRxTimer();
    this.onComplete?.(payload);
  }

  private handleFirstFrame(data: number[]): void {
    if (data.length < 2) return;
    const len = ((data[0] & 0x0F) << 8) | data[1];
    this.rxExpectedLen = len;
    this.rxBuffer = [...data.slice(2, Math.min(data.length, 2 + len))];
    this.rxSeqNum = 1;
    this.rxBlockCount = 0;

    // Send Flow Control: CTS (Continue To Send)
    const fc = [0x30, this.config.blockSize, this.config.stMin];
    this.sendFrame(this.buildFrame(fc));

    this.resetRxTimer();
  }

  private handleConsecutiveFrame(data: number[]): void {
    const sn = data[0] & 0x0F;
    if (sn !== (this.rxSeqNum & 0x0F)) {
      this.onError?.(`ISO-TP sequence error: expected ${this.rxSeqNum & 0x0F}, got ${sn}`);
      this.resetRx();
      return;
    }
    this.rxSeqNum++;
    this.rxBlockCount++;

    const remaining = this.rxExpectedLen - this.rxBuffer.length;
    const chunk = data.slice(1, 1 + Math.min(remaining, data.length - 1));
    this.rxBuffer.push(...chunk);

    if (this.rxBuffer.length >= this.rxExpectedLen) {
      // Complete
      this.clearRxTimer();
      const payload = this.rxBuffer.slice(0, this.rxExpectedLen);
      this.resetRx();
      this.onComplete?.(payload);
    } else {
      // Send FC if block size reached
      if (this.config.blockSize > 0 && this.rxBlockCount >= this.config.blockSize) {
        this.rxBlockCount = 0;
        const fc = [0x30, this.config.blockSize, this.config.stMin];
        this.sendFrame(this.buildFrame(fc));
      }
      this.resetRxTimer();
    }
  }

  private handleFlowControl(data: number[]): void {
    if (data.length < 3) return;
    const fs = data[0] & 0x0F; // Flow Status
    if (fs === 0) {
      // Continue To Send
      this.sendConsecutiveFrames();
    } else if (fs === 1) {
      // Wait — retry after a delay
      setTimeout(() => {}, 50);
    } else if (fs === 2) {
      // Overflow — abort
      this.onError?.('ISO-TP: Flow Control overflow');
      this.pendingTx = null;
    }
  }

  private resetRxTimer(): void {
    this.clearRxTimer();
    this.rxTimer = setTimeout(() => {
      this.onError?.('ISO-TP: RX timeout');
      this.resetRx();
    }, this.config.timeout);
  }

  private clearRxTimer(): void {
    if (this.rxTimer) { clearTimeout(this.rxTimer); this.rxTimer = null; }
  }

  private resetRx(): void {
    this.rxBuffer = [];
    this.rxExpectedLen = 0;
    this.rxSeqNum = 0;
    this.rxBlockCount = 0;
    this.clearRxTimer();
  }

  /** Register completion callback */
  setOnComplete(fn: OnCompleteFn): void { this.onComplete = fn; }

  /** Register error callback */
  setOnError(fn: OnErrorFn): void { this.onError = fn; }

  /** Clean up timers */
  destroy(): void {
    this.clearRxTimer();
    this.pendingTx = null;
  }
}
