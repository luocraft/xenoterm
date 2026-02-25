import { describe, it, expect } from 'vitest';
import { parseDbc, decodeSignal, findMessageById } from '../dbc-parser';
import type { DbcSignal } from '../dbc-parser';

const SAMPLE_DBC = `
VERSION ""

NS_ :

BS_:

BU_: ECU1 ECU2

BO_ 291 EngineData: 8 ECU1
 SG_ EngSpeed : 0|16@1+ (0.1,0) [0|8000] "rpm" ECU2
 SG_ EngTemp : 16|8@1+ (1,-40) [-40|150] "degC" ECU2
 SG_ IdleRunning : 24|1@1+ (1,0) [0|1] "" ECU2

BO_ 1024 BrakeData: 4 ECU2
 SG_ BrakePedal : 0|8@1+ (0.4,0) [0|100] "%" ECU1
 SG_ BrakeForce : 8|16@1- (0.01,0) [-300|300] "Nm" ECU1

BO_ 2147484160 ExtendedMsg: 8 ECU1
 SG_ ExtSignal : 0|8@1+ (1,0) [0|255] "" ECU2

`;

describe('parseDbc', () => {
  it('should parse messages correctly', () => {
    const db = parseDbc(SAMPLE_DBC);
    expect(db.messages).toHaveLength(3);

    const eng = db.messages[0];
    expect(eng.id).toBe(291);
    expect(eng.extended).toBe(false);
    expect(eng.name).toBe('EngineData');
    expect(eng.dlc).toBe(8);
    expect(eng.sender).toBe('ECU1');
    expect(eng.signals).toHaveLength(3);
  });

  it('should parse signals correctly', () => {
    const db = parseDbc(SAMPLE_DBC);
    const eng = db.messages[0];

    const speed = eng.signals[0];
    expect(speed.name).toBe('EngSpeed');
    expect(speed.startBit).toBe(0);
    expect(speed.bitLength).toBe(16);
    expect(speed.byteOrder).toBe('little_endian');
    expect(speed.valueType).toBe('unsigned');
    expect(speed.factor).toBe(0.1);
    expect(speed.offset).toBe(0);
    expect(speed.min).toBe(0);
    expect(speed.max).toBe(8000);
    expect(speed.unit).toBe('rpm');
    expect(speed.receivers).toContain('ECU2');
  });

  it('should parse signed signals', () => {
    const db = parseDbc(SAMPLE_DBC);
    const brake = db.messages[1];
    const force = brake.signals[1];
    expect(force.name).toBe('BrakeForce');
    expect(force.valueType).toBe('signed');
    expect(force.factor).toBe(0.01);
  });

  it('should detect extended frame (bit 31 set)', () => {
    const db = parseDbc(SAMPLE_DBC);
    // 2147484160 = 0x80000200 → extended=true, id=0x200=512
    const ext = db.messages[2];
    expect(ext.extended).toBe(true);
    expect(ext.id).toBe(512);
    expect(ext.name).toBe('ExtendedMsg');
  });

  it('should handle empty input', () => {
    const db = parseDbc('');
    expect(db.messages).toHaveLength(0);
  });

  it('should handle DBC with no signals', () => {
    const db = parseDbc('BO_ 100 EmptyMsg: 0 Vector__XXX\n\n');
    expect(db.messages).toHaveLength(1);
    expect(db.messages[0].signals).toHaveLength(0);
  });
});

describe('decodeSignal', () => {
  it('should decode unsigned little-endian 16-bit signal', () => {
    // EngSpeed: startBit=0, 16 bits, LE, unsigned, factor=0.1, offset=0
    const signal: DbcSignal = {
      name: 'EngSpeed', startBit: 0, bitLength: 16,
      byteOrder: 'little_endian', valueType: 'unsigned',
      factor: 0.1, offset: 0, min: 0, max: 8000, unit: 'rpm', receivers: [],
    };
    // data: [0xE8, 0x03, ...] = 0x03E8 = 1000 → 1000 * 0.1 = 100.0 rpm
    const data = [0xE8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    expect(decodeSignal(data, signal)).toBeCloseTo(100.0);
  });

  it('should decode with offset', () => {
    // EngTemp: startBit=16, 8 bits, LE, unsigned, factor=1, offset=-40
    const signal: DbcSignal = {
      name: 'EngTemp', startBit: 16, bitLength: 8,
      byteOrder: 'little_endian', valueType: 'unsigned',
      factor: 1, offset: -40, min: -40, max: 150, unit: 'degC', receivers: [],
    };
    // byte[2] = 130 → 130 * 1 + (-40) = 90°C
    const data = [0x00, 0x00, 130, 0x00, 0x00, 0x00, 0x00, 0x00];
    expect(decodeSignal(data, signal)).toBe(90);
  });

  it('should decode signed value (negative)', () => {
    // BrakeForce: startBit=8, 16 bits, LE, signed, factor=0.01
    const signal: DbcSignal = {
      name: 'BrakeForce', startBit: 8, bitLength: 16,
      byteOrder: 'little_endian', valueType: 'signed',
      factor: 0.01, offset: 0, min: -300, max: 300, unit: 'Nm', receivers: [],
    };
    // 16-bit signed -500 = 0xFE0C → bytes at [1],[2] = [0x0C, 0xFE]
    const data = [0x00, 0x0C, 0xFE, 0x00, 0x00, 0x00, 0x00, 0x00];
    expect(decodeSignal(data, signal)).toBeCloseTo(-5.0);
  });

  it('should decode 1-bit boolean signal', () => {
    const signal: DbcSignal = {
      name: 'IdleRunning', startBit: 24, bitLength: 1,
      byteOrder: 'little_endian', valueType: 'unsigned',
      factor: 1, offset: 0, min: 0, max: 1, unit: '', receivers: [],
    };
    const data = [0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];
    expect(decodeSignal(data, signal)).toBe(1);

    const data2 = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    expect(decodeSignal(data2, signal)).toBe(0);
  });

  it('should decode Motorola (big-endian) signal', () => {
    // Motorola signal: startBit=7 (MSB of byte 0), 16 bits
    // In Motorola order, startBit=7 means MSB is at byte0 bit7
    // The 16 bits span byte0 and byte1
    const signal: DbcSignal = {
      name: 'MotSignal', startBit: 7, bitLength: 16,
      byteOrder: 'big_endian', valueType: 'unsigned',
      factor: 1, offset: 0, min: 0, max: 65535, unit: '', receivers: [],
    };
    // data: [0x01, 0x00] → big-endian value = 0x0100 = 256
    const data = [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    expect(decodeSignal(data, signal)).toBe(256);
  });

  it('should decode Motorola 8-bit signal', () => {
    const signal: DbcSignal = {
      name: 'MotByte', startBit: 7, bitLength: 8,
      byteOrder: 'big_endian', valueType: 'unsigned',
      factor: 1, offset: 0, min: 0, max: 255, unit: '', receivers: [],
    };
    const data = [0xAB, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    expect(decodeSignal(data, signal)).toBe(0xAB);
  });
});

describe('findMessageById', () => {
  it('should find standard frame message', () => {
    const db = parseDbc(SAMPLE_DBC);
    const msg = findMessageById(db, 291);
    expect(msg).toBeDefined();
    expect(msg!.name).toBe('EngineData');
  });

  it('should find extended frame message', () => {
    const db = parseDbc(SAMPLE_DBC);
    const msg = findMessageById(db, 512, true);
    expect(msg).toBeDefined();
    expect(msg!.name).toBe('ExtendedMsg');
  });

  it('should return undefined for non-existent ID', () => {
    const db = parseDbc(SAMPLE_DBC);
    expect(findMessageById(db, 9999)).toBeUndefined();
  });
});
