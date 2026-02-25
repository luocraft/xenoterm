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

/** TP reassembly state for a single transfer */
interface TpSession {
  pgn: number;
  totalBytes: number;
  totalPackets: number;
  sa: number;
  da: number | null;
  data: Uint8Array;
  received: number; // packets received
  timestamp: number;
}

/**
 * Transport Protocol reassembler.
 * Handles BAM (Broadcast Announce Message) and RTS/CTS multi-frame transfers.
 */
export class TpReassembler {
  private sessions = new Map<string, TpSession>(); // key: `${sa}-${da ?? 'bcast'}`
  private static readonly TIMEOUT_MS = 5000; // 5s timeout for stale sessions

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
  process(canId: number, data: number[], timestamp: number): { pgn: number; sa: number; da: number | null; data: number[] } | null {
    const hdr = parseJ1939Id(canId);

    // Periodically clean up stale sessions
    if (this.sessions.size > 0) this.purgeStale(timestamp);

    // TP.CM (PGN 60416)
    if (hdr.pgn === 60416 && data.length >= 8) {
      const controlByte = data[0];
      if (controlByte === 32) {
        // BAM
        const totalBytes = data[1] | (data[2] << 8);
        const totalPackets = data[3];
        const pgn = data[5] | (data[6] << 8) | (data[7] << 16);
        const key = `${hdr.sourceAddress}-bcast`;
        this.sessions.set(key, {
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
        const key = `${hdr.sourceAddress}-${da}`;
        this.sessions.set(key, {
          pgn, totalBytes, totalPackets,
          sa: hdr.sourceAddress, da,
          data: new Uint8Array(totalBytes),
          received: 0, timestamp,
        });
      }
      return null;
    }

    // TP.DT (PGN 60160)
    if (hdr.pgn === 60160 && data.length >= 2) {
      const seqNo = data[0]; // 1-based
      // Try both broadcast and point-to-point keys
      const keys = [
        `${hdr.sourceAddress}-bcast`,
        `${hdr.sourceAddress}-${hdr.destinationAddress ?? 0xFF}`,
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
          };
        }
        return null;
      }
    }

    return null;
  }

  clear(): void {
    this.sessions.clear();
  }
}
