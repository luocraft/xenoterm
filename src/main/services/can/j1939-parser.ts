/**
 * J1939 protocol parser — extracts PGN, SA, DA, Priority from 29-bit extended CAN IDs.
 * Also handles Transport Protocol (TP) multi-frame reassembly.
 */

export interface J1939Header {
  priority: number;    // 0-7
  reserved: number;    // 0 or 1
  dataPage: number;    // 0 or 1
  pduFormat: number;   // PF (0-255)
  pduSpecific: number; // PS (0-255)
  sourceAddress: number; // SA (0-255)
  pgn: number;         // Parameter Group Number
  destinationAddress: number | null; // DA (null for broadcast)
}

export interface J1939FbffHeader {
  applicationProtocolIndicator: number;
  sourceAddress: number;
}

/** Well-known SA names */
const SA_NAMES: Record<number, string> = {
  0: 'Engine #1',
  1: 'Engine #2',
  3: 'Transmission #1',
  5: 'Shift Console',
  11: 'Brakes - System Controller',
  15: 'Retarder - Engine',
  17: 'Cruise Control',
  21: 'Suspension - Steer Axle',
  25: 'Instrument Cluster #1',
  33: 'Body Controller',
  37: 'Cab Controller',
  39: 'Cab Display',
  41: 'Headway Controller',
  43: 'Steering Controller',
  47: 'Fuel System',
  49: 'Vehicle Navigation',
  254: 'Null Address',
  255: 'Global (Broadcast)',
};

/** Well-known PGN names */
const PGN_NAMES: Record<number, string> = {
  // Engine
  61444: 'EEC1 - Electronic Engine Controller 1',
  61443: 'EEC2 - Electronic Engine Controller 2',
  65262: 'ET1 - Engine Temperature 1',
  65263: 'EFL/P1 - Engine Fluid Level/Pressure 1',
  65270: 'IC1 - Inlet/Exhaust Conditions 1',
  65271: 'VEP1 - Vehicle Electrical Power 1',
  65265: 'CCVS - Cruise Control/Vehicle Speed',
  65269: 'AMB - Ambient Conditions',
  65266: 'LFE - Fuel Economy (Liquid)',
  65267: 'DD - Dash Display',
  65272: 'TF - Transmission Fluids',
  65276: 'DD1 - Dash Display 1',
  // Transmission
  61445: 'ETC1 - Electronic Transmission Controller 1',
  // Brakes
  61441: 'EBC1 - Electronic Brake Controller 1',
  // Address Claimed
  60928: 'Address Claimed / Cannot Claim',
  // Transport Protocol
  60416: 'TP.CM - Transport Protocol Connection Management',
  60160: 'TP.DT - Transport Protocol Data Transfer',
  // J1939-22
  9472: 'MCPG - FEFF Multi-PG',
  19712: 'FD.TP.CM - FD Transport Protocol Connection Management',
  19968: 'FD.TP.DT - FD Transport Protocol Data Transfer',
  // DM messages
  65226: 'DM1 - Active Diagnostic Trouble Codes',
  65227: 'DM2 - Previously Active DTCs',
  65228: 'DM3 - Diagnostic Data Clear',
  65229: 'DM4 - Freeze Frame Parameters',
  65230: 'DM5 - Diagnostic Readiness 1',
  // Vehicle
  65256: 'VD - Vehicle Distance',
  65257: 'VH - Vehicle Hours',
};

/**
 * Parse a 29-bit extended CAN ID into J1939 header fields.
 */
export function parseJ1939Id(canId: number): J1939Header {
  const priority = (canId >> 26) & 0x07;
  const reserved = (canId >> 25) & 0x01;
  const dataPage = (canId >> 24) & 0x01;
  const pduFormat = (canId >> 16) & 0xFF;
  const pduSpecific = (canId >> 8) & 0xFF;
  const sourceAddress = canId & 0xFF;

  let pgn: number;
  let destinationAddress: number | null;

  if (pduFormat < 240) {
    // PDU1 (point-to-point): PS is destination address
    pgn = (reserved << 17) | (dataPage << 16) | (pduFormat << 8);
    destinationAddress = pduSpecific;
  } else {
    // PDU2 (broadcast): PS is group extension
    pgn = (reserved << 17) | (dataPage << 16) | (pduFormat << 8) | pduSpecific;
    destinationAddress = null;
  }

  return { priority, reserved, dataPage, pduFormat, pduSpecific, sourceAddress, pgn, destinationAddress };
}

/**
 * Parse an 11-bit FBFF CAN ID into J1939-22 AppPI / SA fields.
 */
export function parseJ1939FbffId(canId: number): J1939FbffHeader | null {
  if (canId < 0 || canId > 0x7ff) return null;
  return {
    applicationProtocolIndicator: (canId >> 8) & 0x07,
    sourceAddress: canId & 0xff,
  };
}

/**
 * Build a 29-bit extended CAN ID from J1939 fields.
 */
export function buildJ1939Id(priority: number, pgn: number, sa: number, da?: number): number {
  const dp = (pgn >> 16) & 0x01;
  const r = (pgn >> 17) & 0x01;
  const pf = (pgn >> 8) & 0xFF;
  const ps = pf < 240 ? (da ?? 0xFF) : (pgn & 0xFF);
  return ((priority & 0x07) << 26) | (r << 25) | (dp << 24) | (pf << 16) | (ps << 8) | (sa & 0xFF);
}

export function getSAName(sa: number): string | undefined {
  return SA_NAMES[sa];
}

export function getPGNName(pgn: number): string | undefined {
  return PGN_NAMES[pgn];
}

export interface J1939FdTpCmMessage {
  control: number;
  controlName: 'RTS' | 'CTS' | 'EOMS' | 'EOMA' | 'ABORT' | 'BAM' | 'UNKNOWN';
  session: number;
  totalBytes: number;
  totalSegments: number;
  maxSegmentsOrSize: number;
  adtOrRequestOrReason: number;
  pgn: number;
  da: number | null;
  assuranceData: number[];
  abortRole?: number;
}

export interface J1939FdTpDtMessage {
  formatIndicator: number;
  session: number;
  segmentNumber: number;
  payload: number[];
  da: number | null;
}

export interface J1939MultiPgMessage {
  pgn: number;
  sa: number;
  da: number | null;
  data: number[];
  tos: number;
  trailerFormat: number;
  payloadLength: number;
  assuranceData: number[];
  frameFormat: 'FEFF' | 'FBFF';
  applicationProtocolIndicator?: number;
}

export interface J1939TpMessage {
  pgn: number;
  sa: number;
  da: number | null;
  data: number[];
  protocol: 'j1939-21' | 'j1939-22';
  session?: number;
}

const J1939_21_TP_CM_PGN = 60416;
const J1939_21_TP_DT_PGN = 60160;
const J1939_22_MULTI_PG_PGN = 9472;
const J1939_22_FD_TP_CM_PGN = 19712;
const J1939_22_FD_TP_DT_PGN = 19968;

function readUint24LE(data: number[], offset: number): number {
  return (data[offset] || 0) | ((data[offset + 1] || 0) << 8) | ((data[offset + 2] || 0) << 16);
}

function getFdTpControlName(control: number): J1939FdTpCmMessage['controlName'] {
  switch (control) {
    case 0: return 'RTS';
    case 1: return 'CTS';
    case 2: return 'EOMS';
    case 3: return 'EOMA';
    case 4: return 'BAM';
    case 15: return 'ABORT';
    default: return 'UNKNOWN';
  }
}

function getMultiPgTrailerLength(tos: number, trailerFormat: number, payloadLength: number): number {
  if (tos === 2) return 0;
  if (tos !== 1) return 0;

  if (trailerFormat === 1 || trailerFormat === 2) return Math.min(4, payloadLength);
  if (trailerFormat === 3 || trailerFormat === 5 || trailerFormat === 6) return Math.min(8, payloadLength);
  return 0;
}

export function parseJ1939FdTpCm(canId: number, data: number[]): J1939FdTpCmMessage | null {
  const hdr = parseJ1939Id(canId);
  if (hdr.pgn !== J1939_22_FD_TP_CM_PGN || data.length < 12) return null;

  const control = data[0] & 0x0f;
  const session = (data[0] >> 4) & 0x0f;
  const assuranceStart = 12;

  return {
    control,
    controlName: getFdTpControlName(control),
    session,
    totalBytes: readUint24LE(data, 1),
    totalSegments: readUint24LE(data, 4),
    maxSegmentsOrSize: data[7] || 0,
    adtOrRequestOrReason: data[8] || 0,
    pgn: readUint24LE(data, 9),
    da: hdr.destinationAddress,
    assuranceData: data.slice(assuranceStart),
    abortRole: control === 15 ? ((data[7] || 0) & 0x03) : undefined,
  };
}

export function parseJ1939FdTpDt(canId: number, data: number[]): J1939FdTpDtMessage | null {
  const hdr = parseJ1939Id(canId);
  if (hdr.pgn !== J1939_22_FD_TP_DT_PGN || data.length < 4) return null;

  return {
    formatIndicator: data[0] & 0x0f,
    session: (data[0] >> 4) & 0x0f,
    segmentNumber: readUint24LE(data, 1),
    payload: data.slice(4),
    da: hdr.destinationAddress,
  };
}

export function parseJ1939MultiPg(canId: number, data: number[], extended = true): J1939MultiPgMessage[] {
  let sourceAddress = 0;
  let destinationAddress: number | null = null;
  let frameFormat: 'FEFF' | 'FBFF' = 'FEFF';
  let applicationProtocolIndicator: number | undefined;

  if (extended) {
    const hdr = parseJ1939Id(canId);
    if (hdr.pgn !== J1939_22_MULTI_PG_PGN || data.length < 4) return [];
    sourceAddress = hdr.sourceAddress;
    destinationAddress = hdr.destinationAddress;
  } else {
    const hdr = parseJ1939FbffId(canId);
    if (!hdr || hdr.applicationProtocolIndicator !== 0 || data.length < 4) return [];
    sourceAddress = hdr.sourceAddress;
    destinationAddress = 0xff;
    frameFormat = 'FBFF';
    applicationProtocolIndicator = hdr.applicationProtocolIndicator;
  }

  const messages: J1939MultiPgMessage[] = [];
  let offset = 0;

  while (offset < data.length) {
    const first = data[offset];
    const tos = first >> 5;

    // TOS 0 is padding and always terminates the Multi-PG payload.
    if (tos === 0) break;
    if (offset + 4 > data.length) break;

    const trailerFormat = (first >> 2) & 0x07;
    const containedPgn = ((first & 0x03) << 16) | (data[offset + 1] << 8) | data[offset + 2];
    const payloadLength = data[offset + 3];
    const totalLength = 4 + payloadLength;
    if (payloadLength > 60 || offset + totalLength > data.length) break;

    // Only TOS=1/2 carry SAE J1939 contained PGs.
    if (tos === 1 || tos === 2) {
      const payload = data.slice(offset + 4, offset + totalLength);
      const trailerLength = getMultiPgTrailerLength(tos, trailerFormat, payloadLength);
      const pgDataLength = Math.max(0, payload.length - trailerLength);
      const containedPf = (containedPgn >> 8) & 0xff;
      messages.push({
        pgn: containedPgn,
        sa: sourceAddress,
        da: containedPf < 240 ? destinationAddress : null,
        data: payload.slice(0, pgDataLength),
        tos,
        trailerFormat,
        payloadLength,
        assuranceData: payload.slice(pgDataLength),
        frameFormat,
        applicationProtocolIndicator,
      });
    }

    offset += totalLength;
  }

  return messages;
}

/** TP reassembly state for a single transfer */
interface TpSession {
  protocol: 'j1939-21' | 'j1939-22';
  pgn: number;
  totalBytes: number;
  totalPackets: number;
  sa: number;
  da: number | null;
  session?: number;
  data: Uint8Array;
  received: number; // packets received
  receivedSegments?: Set<number>;
  waitingForAck?: boolean;
  timestamp: number;
}

/**
 * Transport Protocol reassembler.
 * Handles BAM (Broadcast Announce Message) and RTS/CTS multi-frame transfers.
 */
export class TpReassembler {
  private sessions = new Map<string, TpSession>(); // key: `${sa}-${da ?? 'bcast'}`
  private static readonly TIMEOUT_MS = 5000; // 5s timeout for stale sessions

  private get21Key(sa: number, da: number | null): string {
    return `21:${sa}:${da == null ? 'bcast' : da}`;
  }

  private get22Key(sa: number, da: number | null, session: number): string {
    return `22:${sa}:${da == null ? 'bcast' : da}:${session}`;
  }

  /**
   * Purge sessions that haven't received data within the timeout window.
   */
  private purgeStale(now: number): void {
    for (const [key, session] of this.sessions) {
      if (now - session.timestamp > TpReassembler.TIMEOUT_MS) {
        this.sessions.delete(key);
      }
    }
  }

  /**
   * Process a CAN frame. Returns reassembled data if a TP transfer completes, null otherwise.
   */
  process(canId: number, data: number[], timestamp: number): J1939TpMessage | null {
    const hdr = parseJ1939Id(canId);

    // Periodically clean up stale sessions
    if (this.sessions.size > 0) this.purgeStale(timestamp);

    // TP.CM (PGN 60416)
    if (hdr.pgn === J1939_21_TP_CM_PGN && data.length >= 8) {
      const controlByte = data[0];
      if (controlByte === 32) {
        // BAM
        const totalBytes = data[1] | (data[2] << 8);
        const totalPackets = data[3];
        const pgn = data[5] | (data[6] << 8) | (data[7] << 16);
        const key = this.get21Key(hdr.sourceAddress, null);
        this.sessions.set(key, {
          protocol: 'j1939-21',
          pgn, totalBytes, totalPackets,
          sa: hdr.sourceAddress, da: null,
          data: new Uint8Array(totalBytes),
          received: 0, timestamp,
        });
      } else if (controlByte === 16) {
        // RTS
        const totalBytes = data[1] | (data[2] << 8);
        const totalPackets = data[3];
        const pgn = data[5] | (data[6] << 8) | (data[7] << 16);
        const da = hdr.destinationAddress ?? 0xFF;
        const key = this.get21Key(hdr.sourceAddress, da);
        this.sessions.set(key, {
          protocol: 'j1939-21',
          pgn, totalBytes, totalPackets,
          sa: hdr.sourceAddress, da,
          data: new Uint8Array(totalBytes),
          received: 0, timestamp,
        });
      }
      return null;
    }

    // TP.DT (PGN 60160)
    if (hdr.pgn === J1939_21_TP_DT_PGN && data.length >= 2) {
      const seqNo = data[0]; // 1-based
      // Try both broadcast and point-to-point keys
      const keys = [
        this.get21Key(hdr.sourceAddress, null),
        this.get21Key(hdr.sourceAddress, hdr.destinationAddress ?? 0xFF),
      ];
      for (const key of keys) {
        const session = this.sessions.get(key);
        if (!session) continue;
        const offset = (seqNo - 1) * 7;
        const payload = data.slice(1, 8);
        for (let i = 0; i < payload.length && offset + i < session.totalBytes; i++) {
          session.data[offset + i] = payload[i];
        }
        session.received++;
        session.timestamp = timestamp; // keep session alive while receiving
        if (session.received >= session.totalPackets) {
          this.sessions.delete(key);
          return {
            pgn: session.pgn,
            sa: session.sa,
            da: session.da,
            data: Array.from(session.data),
            protocol: session.protocol,
          };
        }
        return null;
      }
    }

    const fdTpCm = parseJ1939FdTpCm(canId, data);
    if (fdTpCm) {
      const da = fdTpCm.control === 4 || fdTpCm.da === 0xFF ? null : fdTpCm.da;
      const key = this.get22Key(hdr.sourceAddress, da, fdTpCm.session);
      const reverseKey = da != null ? this.get22Key(da, hdr.sourceAddress, fdTpCm.session) : key;

      if (fdTpCm.control === 0 || fdTpCm.control === 4) {
        this.sessions.set(key, {
          protocol: 'j1939-22',
          pgn: fdTpCm.pgn,
          totalBytes: fdTpCm.totalBytes,
          totalPackets: fdTpCm.totalSegments,
          sa: hdr.sourceAddress,
          da,
          session: fdTpCm.session,
          data: new Uint8Array(fdTpCm.totalBytes),
          received: 0,
          receivedSegments: new Set<number>(),
          timestamp,
        });
        return null;
      }

      if (fdTpCm.control === 2) {
        const session = this.sessions.get(key);
        if (!session) return null;

        session.timestamp = timestamp;
        const allReceived = session.receivedSegments
          ? session.receivedSegments.size >= session.totalPackets
          : session.received >= session.totalPackets;
        if (!allReceived) return null;

        if (session.da != null) {
          session.waitingForAck = true;
          return null;
        }

        this.sessions.delete(key);
        return {
          pgn: session.pgn,
          sa: session.sa,
          da: session.da,
          data: Array.from(session.data),
          protocol: session.protocol,
          session: session.session,
        };
      }

      if (fdTpCm.control === 3) {
        const session = this.sessions.get(reverseKey);
        this.sessions.delete(reverseKey);
        if (!session || !session.waitingForAck) return null;

        const allReceived = session.receivedSegments
          ? session.receivedSegments.size >= session.totalPackets
          : session.received >= session.totalPackets;
        if (!allReceived) return null;

        return {
          pgn: session.pgn,
          sa: session.sa,
          da: session.da,
          data: Array.from(session.data),
          protocol: session.protocol,
          session: session.session,
        };
      }

      if (fdTpCm.control === 15) {
        this.sessions.delete(reverseKey);
        this.sessions.delete(key);
      }
      return null;
    }

    const fdTpDt = parseJ1939FdTpDt(canId, data);
    if (fdTpDt && fdTpDt.formatIndicator === 0) {
      const da = hdr.destinationAddress === 0xFF ? null : hdr.destinationAddress;
      const key = this.get22Key(hdr.sourceAddress, da, fdTpDt.session);
      const session = this.sessions.get(key);
      if (!session) return null;

      const offset = (fdTpDt.segmentNumber - 1) * 60;
      for (let i = 0; i < fdTpDt.payload.length && offset + i < session.totalBytes; i++) {
        session.data[offset + i] = fdTpDt.payload[i];
      }
      session.receivedSegments?.add(fdTpDt.segmentNumber);
      session.received = session.receivedSegments ? session.receivedSegments.size : session.received + 1;
      session.timestamp = timestamp;
      return null;
    }

    return null;
  }

  clear(): void {
    this.sessions.clear();
  }
}
