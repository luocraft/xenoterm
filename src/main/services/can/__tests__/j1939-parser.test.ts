import { describe, expect, it } from 'vitest';
import {
  buildJ1939Id,
  parseJ1939FbffId,
  parseJ1939FdTpCm,
  parseJ1939FdTpDt,
  parseJ1939MultiPg,
  TpReassembler,
} from '../j1939-parser';

describe('parseJ1939FbffId', () => {
  it('parses J1939-22 FBFF AppPI / SA fields', () => {
    const parsed = parseJ1939FbffId(0x080);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      applicationProtocolIndicator: 0,
      sourceAddress: 0x80,
    });
  });
});

describe('parseJ1939FdTpCm', () => {
  it('parses J1939-22 FD.TP.CM fields', () => {
    const canId = buildJ1939Id(3, 19712, 0x80, 0x91);
    const data = [
      0x20,
      0x3c, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x05,
      0x00,
      0x00, 0xea, 0x00,
      0xaa, 0xbb,
    ];

    const parsed = parseJ1939FdTpCm(canId, data);

    expect(parsed).not.toBeNull();
    expect(parsed!.control).toBe(0);
    expect(parsed!.controlName).toBe('RTS');
    expect(parsed!.session).toBe(2);
    expect(parsed!.totalBytes).toBe(60);
    expect(parsed!.totalSegments).toBe(2);
    expect(parsed!.maxSegmentsOrSize).toBe(5);
    expect(parsed!.pgn).toBe(59904);
    expect(parsed!.da).toBe(0x91);
    expect(parsed!.assuranceData).toEqual([0xaa, 0xbb]);
  });
});

describe('parseJ1939FdTpDt', () => {
  it('parses J1939-22 FD.TP.DT fields', () => {
    const canId = buildJ1939Id(3, 19968, 0x80, 0x91);
    const data = [0x20, 0x03, 0x00, 0x00, 1, 2, 3, 4];

    const parsed = parseJ1939FdTpDt(canId, data);

    expect(parsed).not.toBeNull();
    expect(parsed!.formatIndicator).toBe(0);
    expect(parsed!.session).toBe(2);
    expect(parsed!.segmentNumber).toBe(3);
    expect(parsed!.payload).toEqual([1, 2, 3, 4]);
    expect(parsed!.da).toBe(0x91);
  });
});

describe('parseJ1939MultiPg', () => {
  it('parses FEFF Multi-PG contained messages', () => {
    const canId = buildJ1939Id(3, 9472, 0x81, 0x91);
    const data = [
      0x40, 0xea, 0x00, 0x03,
      0x00, 0xf0, 0x00,
      0x00,
    ];

    const parsed = parseJ1939MultiPg(canId, data);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      pgn: 59904,
      sa: 0x81,
      da: 0x91,
      data: [0x00, 0xf0, 0x00],
      tos: 2,
      trailerFormat: 0,
      payloadLength: 3,
      assuranceData: [],
      frameFormat: 'FEFF',
    });
  });

  it('parses FBFF D-PDU3 Multi-PG contained messages', () => {
    const canId = 0x080;
    const data = [
      0x40, 0xea, 0x00, 0x03,
      0x00, 0xee, 0x00,
      0x00,
    ];

    const parsed = parseJ1939MultiPg(canId, data, false);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      pgn: 59904,
      sa: 0x80,
      da: 0xff,
      data: [0x00, 0xee, 0x00],
      tos: 2,
      trailerFormat: 0,
      payloadLength: 3,
      assuranceData: [],
      frameFormat: 'FBFF',
      applicationProtocolIndicator: 0,
    });
  });
});

describe('TpReassembler', () => {
  it('reassembles classic J1939-21 BAM transfers', () => {
    const tp = new TpReassembler();
    const targetPgn = 65262;
    const payload = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const cmId = buildJ1939Id(3, 60416, 0x80, 0xff);
    const dtId = buildJ1939Id(3, 60160, 0x80, 0xff);

    expect(tp.process(cmId, [32, 10, 0, 2, 0xff, targetPgn & 0xff, (targetPgn >> 8) & 0xff, (targetPgn >> 16) & 0xff], 1000)).toBeNull();
    expect(tp.process(dtId, [1, ...payload.slice(0, 7)], 1010)).toBeNull();

    const result = tp.process(dtId, [2, ...payload.slice(7), 0xff, 0xff, 0xff, 0xff], 1020);
    expect(result).toMatchObject({
      pgn: targetPgn,
      sa: 0x80,
      da: null,
      protocol: 'j1939-21',
      data: payload,
    });
  });

  it('reassembles J1939-22 FD BAM transfers after EOMS', () => {
    const tp = new TpReassembler();
    const targetPgn = 61444;
    const payload = Array.from({ length: 80 }, (_, i) => i);
    const cmId = buildJ1939Id(3, 19712, 0x90, 0xff);
    const dtId = buildJ1939Id(3, 19968, 0x90, 0xff);

    expect(tp.process(cmId, [
      0x24,
      0x50, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x00,
      0x00,
      targetPgn & 0xff, (targetPgn >> 8) & 0xff, (targetPgn >> 16) & 0xff,
    ], 2000)).toBeNull();
    expect(tp.process(dtId, [0x20, 0x01, 0x00, 0x00, ...payload.slice(0, 60)], 2010)).toBeNull();
    expect(tp.process(dtId, [0x20, 0x02, 0x00, 0x00, ...payload.slice(60)], 2020)).toBeNull();

    const result = tp.process(cmId, [
      0x22,
      0x50, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x00,
      0x00,
      targetPgn & 0xff, (targetPgn >> 8) & 0xff, (targetPgn >> 16) & 0xff,
    ], 2030);

    expect(result).toMatchObject({
      pgn: targetPgn,
      sa: 0x90,
      da: null,
      protocol: 'j1939-22',
      session: 2,
      data: payload,
    });
  });

  it('reassembles J1939-22 FD RTS/CTS transfers after EOMA', () => {
    const tp = new TpReassembler();
    const targetPgn = 59392;
    const payload = Array.from({ length: 88 }, (_, i) => (0xc0 + i) & 0xff);
    const cmTxId = buildJ1939Id(7, 19712, 0x81, 0x91);
    const dtTxId = buildJ1939Id(7, 19968, 0x81, 0x91);
    const cmRxId = buildJ1939Id(7, 19712, 0x91, 0x81);

    expect(tp.process(cmTxId, [
      0x10,
      0x58, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x10,
      0x00,
      targetPgn & 0xff, (targetPgn >> 8) & 0xff, (targetPgn >> 16) & 0xff,
    ], 3000)).toBeNull();
    expect(tp.process(dtTxId, [0x10, 0x01, 0x00, 0x00, ...payload.slice(0, 60)], 3010)).toBeNull();
    expect(tp.process(dtTxId, [0x10, 0x02, 0x00, 0x00, ...payload.slice(60)], 3020)).toBeNull();
    expect(tp.process(cmTxId, [
      0x12,
      0x58, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x00,
      0x00,
      targetPgn & 0xff, (targetPgn >> 8) & 0xff, (targetPgn >> 16) & 0xff,
    ], 3030)).toBeNull();

    const result = tp.process(cmRxId, [
      0x13,
      0x58, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x00,
      0x00,
      targetPgn & 0xff, (targetPgn >> 8) & 0xff, (targetPgn >> 16) & 0xff,
    ], 3040);

    expect(result).toMatchObject({
      pgn: targetPgn,
      sa: 0x81,
      da: 0x91,
      protocol: 'j1939-22',
      session: 1,
      data: payload,
    });
  });

  it('keeps opposite-direction FD RTS/CTS sessions separate when session numbers match', () => {
    const tp = new TpReassembler();
    const pgnA = 59392;
    const pgnB = 61444;
    const payloadA = Array.from({ length: 88 }, (_, i) => (0xc0 + i) & 0xff);
    const payloadB = Array.from({ length: 96 }, (_, i) => (0x40 + i) & 0xff);

    const cmA = buildJ1939Id(7, 19712, 0x91, 0x81);
    const dtA = buildJ1939Id(7, 19968, 0x91, 0x81);
    const ackA = buildJ1939Id(7, 19712, 0x81, 0x91);

    const cmB = buildJ1939Id(7, 19712, 0x81, 0x91);
    const dtB = buildJ1939Id(7, 19968, 0x81, 0x91);
    const ackB = buildJ1939Id(7, 19712, 0x91, 0x81);

    expect(tp.process(cmA, [
      0x40,
      0x58, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x10,
      0x00,
      pgnA & 0xff, (pgnA >> 8) & 0xff, (pgnA >> 16) & 0xff,
    ], 4000)).toBeNull();

    expect(tp.process(cmB, [
      0x40,
      0x60, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x10,
      0x00,
      pgnB & 0xff, (pgnB >> 8) & 0xff, (pgnB >> 16) & 0xff,
    ], 4001)).toBeNull();

    expect(tp.process(dtB, [0x40, 0x01, 0x00, 0x00, ...payloadB.slice(0, 60)], 4010)).toBeNull();
    expect(tp.process(dtA, [0x40, 0x01, 0x00, 0x00, ...payloadA.slice(0, 60)], 4011)).toBeNull();
    expect(tp.process(dtA, [0x40, 0x02, 0x00, 0x00, ...payloadA.slice(60)], 4012)).toBeNull();

    expect(tp.process(cmA, [
      0x42,
      0x58, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x00,
      0x00,
      pgnA & 0xff, (pgnA >> 8) & 0xff, (pgnA >> 16) & 0xff,
    ], 4013)).toBeNull();

    expect(tp.process(dtB, [0x40, 0x02, 0x00, 0x00, ...payloadB.slice(60)], 4014)).toBeNull();
    expect(tp.process(cmB, [
      0x42,
      0x60, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x00,
      0x00,
      pgnB & 0xff, (pgnB >> 8) & 0xff, (pgnB >> 16) & 0xff,
    ], 4015)).toBeNull();

    const resultA = tp.process(ackA, [
      0x43,
      0x58, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x00,
      0x00,
      pgnA & 0xff, (pgnA >> 8) & 0xff, (pgnA >> 16) & 0xff,
    ], 4016);

    expect(resultA).toMatchObject({
      pgn: pgnA,
      sa: 0x91,
      da: 0x81,
      protocol: 'j1939-22',
      session: 4,
      data: payloadA,
    });

    const resultB = tp.process(ackB, [
      0x43,
      0x60, 0x00, 0x00,
      0x02, 0x00, 0x00,
      0x00,
      0x00,
      pgnB & 0xff, (pgnB >> 8) & 0xff, (pgnB >> 16) & 0xff,
    ], 4017);

    expect(resultB).toMatchObject({
      pgn: pgnB,
      sa: 0x81,
      da: 0x91,
      protocol: 'j1939-22',
      session: 4,
      data: payloadB,
    });
  });
});
