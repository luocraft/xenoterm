/**
 * UDS (Unified Diagnostic Services) — ISO 14229
 * Wraps ISO-TP transport to provide UDS request/response semantics.
 */
import { IsoTpTransport, type IsoTpConfig, type SendFrameFn } from './iso-tp';

/** UDS Negative Response Codes */
export const NRC_NAMES: Record<number, string> = {
  0x10: 'generalReject',
  0x11: 'serviceNotSupported',
  0x12: 'subFunctionNotSupported',
  0x13: 'incorrectMessageLengthOrInvalidFormat',
  0x14: 'responseTooLong',
  0x21: 'busyRepeatRequest',
  0x22: 'conditionsNotCorrect',
  0x24: 'requestSequenceError',
  0x25: 'noResponseFromSubnetComponent',
  0x26: 'failurePreventsExecutionOfRequestedAction',
  0x31: 'requestOutOfRange',
  0x33: 'securityAccessDenied',
  0x35: 'invalidKey',
  0x36: 'exceededNumberOfAttempts',
  0x37: 'requiredTimeDelayNotExpired',
  0x70: 'uploadDownloadNotAccepted',
  0x71: 'transferDataSuspended',
  0x72: 'generalProgrammingFailure',
  0x73: 'wrongBlockSequenceCounter',
  0x78: 'requestCorrectlyReceivedResponsePending',
  0x7E: 'subFunctionNotSupportedInActiveSession',
  0x7F: 'serviceNotSupportedInActiveSession',
};

export const UDS_SERVICES: Record<number, string> = {
  0x10: 'DiagnosticSessionControl',
  0x11: 'ECUReset',
  0x14: 'ClearDiagnosticInformation',
  0x19: 'ReadDTCInformation',
  0x22: 'ReadDataByIdentifier',
  0x27: 'SecurityAccess',
  0x2E: 'WriteDataByIdentifier',
  0x2F: 'InputOutputControlByIdentifier',
  0x31: 'RoutineControl',
  0x34: 'RequestDownload',
  0x35: 'RequestUpload',
  0x36: 'TransferData',
  0x37: 'RequestTransferExit',
  0x3E: 'TesterPresent',
};

export interface UdsResponse {
  positive: boolean;
  serviceId: number;
  data: number[];       // full response payload (including SID+)
  nrc?: number;         // negative response code (if negative)
  nrcName?: string;
  raw: number[];        // raw ISO-TP payload
}

export interface UdsLogEntry {
  seq: number;
  timestamp: number;
  direction: 'tx' | 'rx';
  serviceId: number;
  serviceName: string;
  data: number[];
  positive?: boolean;
  nrc?: number;
  nrcName?: string;
}

export class UdsService {
  private transport: IsoTpTransport;
  private pendingResolve: ((resp: UdsResponse) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private testerPresentTimer: ReturnType<typeof setInterval> | null = null;
  private p2Timeout: number;       // ms, default response timeout
  private p2StarTimeout: number;   // ms, extended timeout after NRC 0x78
  private pendingSid = 0;
  private logEntries: UdsLogEntry[] = [];
  private logSeq = 0;
  private onLog: ((entry: UdsLogEntry) => void) | null = null;

  constructor(config: IsoTpConfig, sendFrame: SendFrameFn, p2 = 5000, p2Star = 25000) {
    this.p2Timeout = p2;
    this.p2StarTimeout = p2Star;
    this.transport = new IsoTpTransport(config, sendFrame);
    this.transport.setOnComplete((data) => this.handleResponse(data));
    this.transport.setOnError((err) => this.handleError(err));
  }

  /** Process incoming CAN frame (pre-filtered to rxId) */
  processFrame(frame: import('./can-driver.interface').CanFrame): void {
    this.transport.processFrame(frame);
  }

  /** Send a UDS request and wait for response */
  request(payload: number[], timeout?: number): Promise<UdsResponse> {
    return new Promise((resolve, reject) => {
      // Cancel any pending request
      this.clearPending();
      this.pendingSid = payload[0];
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      // Log TX
      this.addLog('tx', payload[0], payload, true);

      // Send via ISO-TP
      this.transport.send(payload);

      // Start P2 timeout
      const t = timeout ?? this.p2Timeout;
      this.pendingTimer = setTimeout(() => {
        this.clearPending();
        reject(new Error(`UDS timeout (${t}ms) waiting for response to SID 0x${this.pendingSid.toString(16).toUpperCase()}`));
      }, t);
    });
  }

  private handleResponse(data: number[]): void {
    if (data.length < 1) return;

    // Check for Negative Response (0x7F)
    if (data[0] === 0x7F && data.length >= 3) {
      const sid = data[1];
      const nrc = data[2];

      // NRC 0x78: requestCorrectlyReceivedResponsePending — extend timeout
      if (nrc === 0x78) {
        this.addLog('rx', sid, data, false, nrc);
        // Reset timer with P2* timeout
        if (this.pendingTimer) clearTimeout(this.pendingTimer);
        this.pendingTimer = setTimeout(() => {
          this.clearPending();
          this.pendingReject?.(new Error(`UDS P2* timeout (${this.p2StarTimeout}ms)`));
        }, this.p2StarTimeout);
        return; // Keep waiting
      }

      const resp: UdsResponse = {
        positive: false,
        serviceId: sid,
        data: data.slice(3),
        nrc,
        nrcName: NRC_NAMES[nrc] || `unknown(0x${nrc.toString(16)})`,
        raw: data,
      };
      this.addLog('rx', sid, data, false, nrc);
      this.clearPending();
      this.pendingResolve?.(resp);
      return;
    }

    // Positive response: SID + 0x40
    const sid = data[0] - 0x40;
    const resp: UdsResponse = {
      positive: true,
      serviceId: sid,
      data: data.slice(1),
      raw: data,
    };
    this.addLog('rx', sid, data, true);
    this.clearPending();
    this.pendingResolve?.(resp);
  }

  private handleError(err: string): void {
    this.clearPending();
    this.pendingReject?.(new Error(err));
  }

  private clearPending(): void {
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
  }

  /** Start TesterPresent (0x3E 00) heartbeat */
  startTesterPresent(intervalMs = 2000): void {
    this.stopTesterPresent();
    this.testerPresentTimer = setInterval(() => {
      // Fire-and-forget: send 0x3E 0x00 (suppressPositiveResponse bit NOT set)
      // Use sub-function 0x80 to suppress positive response
      this.transport.send([0x3E, 0x80]);
      this.addLog('tx', 0x3E, [0x3E, 0x80], true);
    }, intervalMs);
  }

  /** Stop TesterPresent heartbeat */
  stopTesterPresent(): void {
    if (this.testerPresentTimer) { clearInterval(this.testerPresentTimer); this.testerPresentTimer = null; }
  }

  /** Get log entries */
  getLog(): UdsLogEntry[] { return this.logEntries; }

  /** Set log callback */
  setOnLog(fn: (entry: UdsLogEntry) => void): void { this.onLog = fn; }

  private addLog(dir: 'tx' | 'rx', sid: number, data: number[], positive?: boolean, nrc?: number): void {
    const entry: UdsLogEntry = {
      seq: ++this.logSeq,
      timestamp: Date.now(),
      direction: dir,
      serviceId: sid,
      serviceName: UDS_SERVICES[sid] || `0x${sid.toString(16).toUpperCase()}`,
      data: [...data],
      positive,
      nrc,
      nrcName: nrc !== undefined ? (NRC_NAMES[nrc] || `0x${nrc.toString(16)}`) : undefined,
    };
    this.logEntries.push(entry);
    if (this.logEntries.length > 2000) this.logEntries.splice(0, 500);
    this.onLog?.(entry);
  }

  /** Clean up */
  destroy(): void {
    this.stopTesterPresent();
    this.clearPending();
    this.transport.destroy();
  }
}
