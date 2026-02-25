/**
 * Virtual CAN driver — generates simulated CAN traffic for testing without hardware.
 * Simulates an engine ECU sending EngineData (0x123) and BrakeData (0x200) at ~100Hz.
 */
import type { CanDriver, CanFrame, CanDeviceType, CanOpenConfig } from './can-driver.interface';

const VIRTUAL_DEVICE_TYPES: CanDeviceType[] = [
  { code: 0, name: 'Virtual CAN', channels: 2 },
];

export class VirtualCanDriver implements CanDriver {
  readonly name = 'Virtual';
  private opened = false;
  private startTime = 0;
  private tick = 0;
  // Simulated engine state
  private rpm = 800;
  private temp = 60;
  private brakeForce = 0;
  private brakePedal = 0;
  // Sent frames waiting to be "echoed back"
  private txQueue: CanFrame[] = [];

  isAvailable(): boolean {
    return true; // Always available
  }

  getDeviceTypes(): CanDeviceType[] {
    return VIRTUAL_DEVICE_TYPES;
  }

  open(_config: CanOpenConfig): void {
    this.opened = true;
    this.startTime = Date.now();
    this.tick = 0;
    this.rpm = 800;
    this.temp = 60;
    this.brakeForce = 0;
    this.brakePedal = 0;
    this.txQueue = [];
  }

  close(): void {
    this.opened = false;
  }

  send(_channel: number, frames: CanFrame[]): number {
    if (!this.opened) return 0;
    // Store sent frames so they appear as TX in next receive
    for (const f of frames) {
      this.txQueue.push({ ...f, direction: 'tx', timestamp: Date.now() });
    }
    return frames.length;
  }

  receive(_channel: number, maxCount: number): CanFrame[] {
    if (!this.opened) return [];
    const frames: CanFrame[] = [];
    const now = Date.now();

    // Return any TX echoes first
    while (this.txQueue.length > 0 && frames.length < maxCount) {
      frames.push(this.txQueue.shift()!);
    }

    // Generate ~1 frame per call (called at 1ms interval → ~1000 fps potential, but we throttle)
    this.tick++;
    if (this.tick % 10 !== 0) return frames; // Generate every ~10ms → ~100 fps

    // Simulate engine RPM wandering 800-4000
    this.rpm += (Math.random() - 0.48) * 50;
    this.rpm = Math.max(600, Math.min(5000, this.rpm));

    // Simulate temperature slowly rising
    this.temp += (Math.random() - 0.49) * 0.5;
    this.temp = Math.max(40, Math.min(120, this.temp));

    // EngineData message (ID 0x123): RPM(16bit LE) + Temp(8bit, offset -40) + IdleFlag(1bit)
    const rpmRaw = Math.round(this.rpm / 0.1); // factor=0.1
    const tempRaw = Math.round(this.temp + 40);  // offset=-40
    const idle = this.rpm < 1000 ? 1 : 0;
    frames.push({
      id: 0x123,
      extended: false,
      remote: false,
      dlc: 8,
      data: [
        rpmRaw & 0xFF, (rpmRaw >> 8) & 0xFF,
        tempRaw & 0xFF,
        idle,
        0, 0, 0, 0
      ],
      timestamp: now,
      direction: 'rx',
    });

    // BrakeData every ~50ms
    if (this.tick % 50 === 0) {
      this.brakePedal = Math.random() * 80;
      this.brakeForce = (Math.random() - 0.3) * 200;
      const pedalRaw = Math.round(this.brakePedal / 0.4);
      const forceRaw = Math.round(this.brakeForce / 0.01);
      const forceU16 = forceRaw < 0 ? (forceRaw + 65536) : forceRaw;
      frames.push({
        id: 0x200,
        extended: false,
        remote: false,
        dlc: 4,
        data: [
          pedalRaw & 0xFF,
          forceU16 & 0xFF, (forceU16 >> 8) & 0xFF,
          0
        ],
        timestamp: now,
        direction: 'rx',
      });
    }

    // Random other IDs occasionally
    if (this.tick % 100 === 0) {
      frames.push({
        id: 0x300 + Math.floor(Math.random() * 16),
        extended: false,
        remote: false,
        dlc: 8,
        data: Array.from({ length: 8 }, () => Math.floor(Math.random() * 256)),
        timestamp: now,
        direction: 'rx',
      });
    }

    // ─── J1939 Extended Frames ───
    // EEC1 (PGN 61444, SA=0 Engine#1) — Engine Speed + Torque, every ~20ms
    if (this.tick % 20 === 0) {
      const rpmJ = Math.round(this.rpm * 8); // SPN 190: 0.125 rpm/bit
      const torque = Math.round(50 + Math.random() * 30 + 125); // SPN 513: offset -125%
      // J1939 ID: Pri=3, PGN=61444(0xF004), SA=0x00
      // 0x0CF00400
      frames.push({
        id: 0x0CF00400,
        extended: true,
        remote: false,
        dlc: 8,
        data: [
          torque & 0xFF,                    // byte 0: Engine Torque Mode
          0xFF,                              // byte 1: Driver's Demand Torque
          torque & 0xFF,                    // byte 2: Actual Engine Torque
          rpmJ & 0xFF, (rpmJ >> 8) & 0xFF, // byte 3-4: Engine Speed
          0xFF,                              // byte 5: Source Address
          0xFF, 0xFF,                        // byte 6-7: reserved
        ],
        timestamp: now,
        direction: 'rx',
      });
    }

    // ET1 (PGN 65262, SA=0 Engine#1) — Engine Temperature, every ~100ms
    if (this.tick % 100 === 0) {
      const coolantTemp = Math.round(this.temp + 40); // SPN 110: offset -40°C
      const fuelTemp = Math.round(35 + Math.random() * 10 + 40); // SPN 174: offset -40°C
      // J1939 ID: Pri=6, PGN=65262(0xFEEE), SA=0x00
      // 0x18FEEE00
      frames.push({
        id: 0x18FEEE00,
        extended: true,
        remote: false,
        dlc: 8,
        data: [coolantTemp, fuelTemp, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
        timestamp: now,
        direction: 'rx',
      });
    }

    // CCVS (PGN 65265, SA=0x11 Cruise Control) — Vehicle Speed, every ~50ms
    if (this.tick % 50 === 0) {
      const speed = Math.round((30 + Math.random() * 80) * 256); // SPN 84: 1/256 km/h per bit
      // J1939 ID: Pri=6, PGN=65265(0xFEF1), SA=0x11
      // 0x18FEF111
      frames.push({
        id: 0x18FEF111,
        extended: true,
        remote: false,
        dlc: 8,
        data: [
          0xFF,
          speed & 0xFF, (speed >> 8) & 0xFF, // byte 1-2: Wheel-Based Vehicle Speed
          0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        ],
        timestamp: now,
        direction: 'rx',
      });
    }

    // ETC1 (PGN 61445, SA=0x03 Transmission) — every ~50ms
    if (this.tick % 50 === 0) {
      const gear = Math.floor(Math.random() * 6) + 125; // SPN 524: offset -125
      // J1939 ID: Pri=3, PGN=61445(0xF005), SA=0x03
      // 0x0CF00503
      frames.push({
        id: 0x0CF00503,
        extended: true,
        remote: false,
        dlc: 8,
        data: [0xFF, 0xFF, gear, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
        timestamp: now,
        direction: 'rx',
      });
    }

    // ─── TP BAM: DM1 (PGN 65226) from SA=0x00, 18 bytes → 3 TP.DT packets ───
    // Send every ~50 ticks (with ~15ms actual interval per tick on Windows ≈ 750ms)
    if (this.tick % 50 === 0) {
      // TP.CM BAM: PGN 60416 (0xEC00), broadcast → DA=0xFF
      // J1939 ID: Pri=7, PGN=60416, SA=0x00 → 0x1CECFF00
      frames.push({
        id: 0x1CECFF00,
        extended: true,
        remote: false,
        dlc: 8,
        data: [
          32,          // Control byte: BAM (0x20)
          18, 0,       // Total bytes: 18
          3,           // Total packets: 3
          0xFF,        // Reserved
          0xCA, 0xFE, 0x00, // PGN 65226 (0x00FECA) little-endian
        ],
        timestamp: now,
        direction: 'rx',
      });
    }
    // TP.DT packet 1 (seq=1) — 10ms after BAM
    if (this.tick % 50 === 10) {
      frames.push({
        id: 0x1CEBFF00,
        extended: true,
        remote: false,
        dlc: 8,
        data: [1, 0x01, 0x00, 0x00, 0x01, 0xE3, 0x07, 0x00],
        timestamp: now,
        direction: 'rx',
      });
    }
    // TP.DT packet 2 (seq=2) — 20ms after BAM
    if (this.tick % 50 === 20) {
      frames.push({
        id: 0x1CEBFF00,
        extended: true,
        remote: false,
        dlc: 8,
        data: [2, 0x02, 0x00, 0x00, 0x02, 0x9C, 0x01, 0x00],
        timestamp: now,
        direction: 'rx',
      });
    }
    // TP.DT packet 3 (seq=3) — 30ms after BAM
    if (this.tick % 50 === 30) {
      frames.push({
        id: 0x1CEBFF00,
        extended: true,
        remote: false,
        dlc: 8,
        data: [3, 0x03, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF],
        timestamp: now,
        direction: 'rx',
      });
    }

    return frames.slice(0, maxCount);
  }
}
