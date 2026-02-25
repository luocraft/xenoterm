/**
 * DBC file parser — parses Vector DBC format for CAN message/signal definitions.
 * Supports BO_ (message) and SG_ (signal) lines, Intel/Motorola byte order,
 * signed/unsigned values, and physical value decoding.
 */

export interface DbcSignal {
  name: string;
  startBit: number;
  bitLength: number;
  byteOrder: 'little_endian' | 'big_endian'; // 1=Intel(LE), 0=Motorola(BE)
  valueType: 'unsigned' | 'signed';          // +=unsigned, -=signed
  factor: number;
  offset: number;
  min: number;
  max: number;
  unit: string;
  receivers: string[];
}

export interface DbcMessage {
  id: number;       // CAN ID (without extended bit)
  extended: boolean; // bit 31 of raw id indicates extended frame
  name: string;
  dlc: number;
  sender: string;
  signals: DbcSignal[];
}

export interface DbcDatabase {
  messages: DbcMessage[];
}

/**
 * Parse a DBC file content string into a structured database.
 */
export function parseDbc(content: string): DbcDatabase {
  const messages: DbcMessage[] = [];
  const lines = content.split(/\r?\n/);

  let currentMessage: DbcMessage | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match BO_ line: BO_ <ID> <Name>: <DLC> <Sender>
    const boMatch = line.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\S+)/);
    if (boMatch) {
      // Save previous message
      if (currentMessage) {
        messages.push(currentMessage);
      }
      const rawId = parseInt(boMatch[1], 10);
      // Bit 31 (0x80000000) indicates extended frame in DBC
      const extended = (rawId & 0x80000000) !== 0;
      const id = rawId & 0x1FFFFFFF; // 29-bit mask
      currentMessage = {
        id,
        extended,
        name: boMatch[2],
        dlc: parseInt(boMatch[3], 10),
        sender: boMatch[4],
        signals: [],
      };
      continue;
    }

    // Match SG_ line (must be inside a BO_ block, typically indented)
    // SG_ <Name> : <StartBit>|<Length>@<ByteOrder><ValueType> (<Factor>,<Offset>) [<Min>|<Max>] "<Unit>" <Receivers>
    const sgMatch = line.match(
      /^\s+SG_\s+(\w+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(([^,]+),([^)]+)\)\s*\[([^|]+)\|([^\]]+)\]\s*"([^"]*)"\s*(.*)/
    );
    if (sgMatch && currentMessage) {
      currentMessage.signals.push({
        name: sgMatch[1],
        startBit: parseInt(sgMatch[2], 10),
        bitLength: parseInt(sgMatch[3], 10),
        byteOrder: sgMatch[4] === '1' ? 'little_endian' : 'big_endian',
        valueType: sgMatch[5] === '+' ? 'unsigned' : 'signed',
        factor: parseFloat(sgMatch[6]),
        offset: parseFloat(sgMatch[7]),
        min: parseFloat(sgMatch[8]),
        max: parseFloat(sgMatch[9]),
        unit: sgMatch[10],
        receivers: sgMatch[11].trim().split(/[,\s]+/).filter(Boolean),
      });
      continue;
    }

    // A non-indented, non-empty line that isn't SG_ ends the current message block
    if (currentMessage && line.trim() !== '' && !line.match(/^\s/)) {
      messages.push(currentMessage);
      currentMessage = null;
    }
  }

  // Don't forget the last message
  if (currentMessage) {
    messages.push(currentMessage);
  }

  return { messages };
}

/**
 * Extract raw bits from CAN data bytes according to signal definition.
 * Supports both Intel (little-endian) and Motorola (big-endian) byte order.
 */
function extractRawValue(data: number[], signal: DbcSignal): number {
  const { startBit, bitLength, byteOrder } = signal;

  if (byteOrder === 'little_endian') {
    // Intel byte order: startBit is the LSB position
    // Bit numbering: byte0[0..7], byte1[8..15], byte2[16..23], ...
    let value = 0;
    for (let i = 0; i < bitLength; i++) {
      const bitPos = startBit + i;
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        const bit = (data[byteIdx] >> bitIdx) & 1;
        value |= bit << i;
      }
    }
    return value;
  } else {
    // Motorola byte order (big-endian)
    // startBit is the MSB position in Motorola bit numbering
    // Motorola bit numbering: byte0[7,6,5,4,3,2,1,0], byte1[15,14,13,12,11,10,9,8], ...
    let value = 0;
    let bitPos = startBit;
    for (let i = bitLength - 1; i >= 0; i--) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        const bit = (data[byteIdx] >> bitIdx) & 1;
        value |= bit << i;
      }
      // Navigate to next bit in Motorola order
      if (bitIdx === 0) {
        bitPos += 15; // jump to bit 7 of next byte
      } else {
        bitPos -= 1;
      }
    }
    return value;
  }
}

/**
 * Decode a signal's physical value from CAN data bytes.
 * physical = rawValue * factor + offset
 */
export function decodeSignal(data: number[], signal: DbcSignal): number {
  let rawValue = extractRawValue(data, signal);

  // Sign extension for signed values
  if (signal.valueType === 'signed' && signal.bitLength > 0 && signal.bitLength < 32) {
    const signBit = 1 << (signal.bitLength - 1);
    if (rawValue & signBit) {
      // Two's complement: extend sign
      rawValue = rawValue - (1 << signal.bitLength);
    }
  }

  return rawValue * signal.factor + signal.offset;
}

/**
 * Look up a message definition by CAN ID.
 */
export function findMessageById(db: DbcDatabase, canId: number, extended = false): DbcMessage | undefined {
  return db.messages.find((m) => m.id === canId && m.extended === extended);
}
