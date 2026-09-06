/**
 * DBC file parser for CAN message and signal definitions.
 * Supports BO_ / SG_ sections plus CM_ SG_ signal comments.
 */

export interface DbcSignal {
  name: string;
  startBit: number;
  bitLength: number;
  byteOrder: 'little_endian' | 'big_endian';
  valueType: 'unsigned' | 'signed';
  factor: number;
  offset: number;
  min: number;
  max: number;
  unit: string;
  receivers: string[];
  description?: string;
}

export interface DbcMessage {
  id: number;
  extended: boolean;
  name: string;
  dlc: number;
  sender: string;
  signals: DbcSignal[];
}

export interface DbcDatabase {
  messages: DbcMessage[];
}

function decodeDbcComment(text: string): string {
  return text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

export function parseDbc(content: string): DbcDatabase {
  const messages: DbcMessage[] = [];
  const lines = content.split(/\r?\n/);

  let currentMessage: DbcMessage | null = null;

  for (const line of lines) {
    const boMatch = line.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\S+)/);
    if (boMatch) {
      if (currentMessage) {
        messages.push(currentMessage);
      }
      const rawId = parseInt(boMatch[1], 10);
      const extended = (rawId & 0x80000000) !== 0;
      const id = rawId & 0x1fffffff;
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

    if (currentMessage && line.trim() !== '' && !line.match(/^\s/)) {
      messages.push(currentMessage);
      currentMessage = null;
    }
  }

  if (currentMessage) {
    messages.push(currentMessage);
  }

  for (const line of lines) {
    const cmSgMatch = line.match(/^CM_\s+SG_\s+(\d+)\s+(\w+)\s+"((?:[^"\\]|\\.)*)";/);
    if (!cmSgMatch) continue;

    const rawId = parseInt(cmSgMatch[1], 10);
    const extended = (rawId & 0x80000000) !== 0;
    const id = rawId & 0x1fffffff;
    const signalName = cmSgMatch[2];
    const description = decodeDbcComment(cmSgMatch[3]);

    const message = messages.find((m) => m.id === id && m.extended === extended);
    const signal = message?.signals.find((s) => s.name === signalName);
    if (signal) {
      signal.description = description;
    }
  }

  return { messages };
}

function extractRawValue(data: number[], signal: DbcSignal): number {
  const { startBit, bitLength, byteOrder } = signal;

  if (byteOrder === 'little_endian') {
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
  }

  let value = 0;
  let bitPos = startBit;
  for (let i = bitLength - 1; i >= 0; i--) {
    const byteIdx = Math.floor(bitPos / 8);
    const bitIdx = bitPos % 8;
    if (byteIdx < data.length) {
      const bit = (data[byteIdx] >> bitIdx) & 1;
      value |= bit << i;
    }
    if (bitIdx === 0) {
      bitPos += 15;
    } else {
      bitPos -= 1;
    }
  }
  return value;
}

export function decodeSignal(data: number[], signal: DbcSignal): number {
  let rawValue = extractRawValue(data, signal);

  if (signal.valueType === 'signed' && signal.bitLength > 0 && signal.bitLength < 32) {
    const signBit = 1 << (signal.bitLength - 1);
    if (rawValue & signBit) {
      rawValue = rawValue - (1 << signal.bitLength);
    }
  }

  return rawValue * signal.factor + signal.offset;
}

export function findMessageById(db: DbcDatabase, canId: number, extended = false): DbcMessage | undefined {
  return db.messages.find((m) => m.id === canId && m.extended === extended);
}
