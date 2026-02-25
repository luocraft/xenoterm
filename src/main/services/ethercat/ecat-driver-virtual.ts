/**
 * Virtual EtherCAT 驱动 — 模拟 3 个从站设备，用于无硬件环境下的 UI 测试。
 */
import type { EcatDriver } from './ecat-driver.interface';
import type { EcSlaveInfo, SdoResult, ErrorCounters, EmergencyMsg, FoeResult } from './types';
import { EC_STATE } from './types';

interface VirtualSlave {
  index: number;
  name: string;
  vendorId: number;
  productCode: number;
  revision: number;
  serial: number;
  state: number;
  alStatusCode: number;
  obits: number;
  ibits: number;
  inputData: Buffer;
  outputData: Buffer;
  od: Map<string, Buffer>;
  errorCounters: ErrorCounters;
  eeprom: Buffer;
}

const VIRTUAL_SLAVES: Omit<VirtualSlave, 'inputData' | 'outputData' | 'od' | 'alStatusCode' | 'errorCounters' | 'eeprom'>[] = [
  { index: 1, name: 'EL1008 8Ch Digital Input', vendorId: 0x00000002, productCode: 0x03f03052, revision: 0x00120000, serial: 0x00000001, state: EC_STATE.PRE_OP, obits: 0, ibits: 8 },
  { index: 2, name: 'EL2008 8Ch Digital Output', vendorId: 0x00000002, productCode: 0x07d83052, revision: 0x00120000, serial: 0x00000002, state: EC_STATE.PRE_OP, obits: 8, ibits: 0 },
  { index: 3, name: 'EL3102 2Ch Analog Input', vendorId: 0x00000002, productCode: 0x0c1e3052, revision: 0x00120000, serial: 0x00000003, state: EC_STATE.PRE_OP, obits: 0, ibits: 48 },
];

export class VirtualEcatDriver implements EcatDriver {
  readonly name = 'Virtual';
  private slaves: VirtualSlave[] = [];
  private initialized = false;
  private tick = 0;
  private lastEmergencyTick = 0;
  private pendingEmergency: Map<number, EmergencyMsg | null> = new Map();

  isAvailable(): boolean {
    return true;
  }

  listAdapters(): { name: string; description: string }[] {
    return [
      { name: '\\Device\\NPF_Virtual', description: 'Virtual EtherCAT Adapter (模拟)' },
    ];
  }

  init(_adapterName: string): void {
    this.initialized = true;
  }

  configInit(): number {
    this.slaves = VIRTUAL_SLAVES.map((s) => ({
      ...s,
      alStatusCode: 0,
      inputData: Buffer.alloc(Math.ceil(s.ibits / 8)),
      outputData: Buffer.alloc(Math.ceil(s.obits / 8)),
      od: this.buildVirtualOd(s.index),
      errorCounters: { invalidFrame: [0, 0, 0, 0], rxError: [0, 0, 0, 0], lostLink: [0, 0, 0, 0] } as ErrorCounters,
      eeprom: this.buildVirtualEeprom(),
    }));
    return this.slaves.length;
  }

  getSlaveCount(): number {
    return this.slaves.length;
  }

  getSlaveInfo(slaveIndex: number): EcSlaveInfo {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    if (!s) throw new Error(`从站 ${slaveIndex} 不存在`);
    return {
      index: s.index,
      name: s.name,
      vendorId: s.vendorId,
      productCode: s.productCode,
      revision: s.revision,
      serial: s.serial,
      state: s.state,
      alStatusCode: s.alStatusCode,
      obits: s.obits,
      ibits: s.ibits,
      oAddr: 0,
      iAddr: 0,
    };
  }

  writeState(slaveIndex: number, targetState: number): void {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    if (!s) return;
    // 模拟: 不允许从 INIT 直接跳到 OP（必须经过 PRE-OP → SAFE-OP）
    const validTransitions: Record<number, number[]> = {
      [EC_STATE.INIT]: [EC_STATE.PRE_OP, EC_STATE.INIT],
      [EC_STATE.PRE_OP]: [EC_STATE.SAFE_OP, EC_STATE.INIT, EC_STATE.PRE_OP],
      [EC_STATE.SAFE_OP]: [EC_STATE.OP, EC_STATE.PRE_OP, EC_STATE.INIT, EC_STATE.SAFE_OP],
      [EC_STATE.OP]: [EC_STATE.SAFE_OP, EC_STATE.PRE_OP, EC_STATE.INIT, EC_STATE.OP],
    };
    const allowed = validTransitions[s.state] ?? [EC_STATE.INIT];
    if (allowed.includes(targetState)) {
      s.state = targetState;
      s.alStatusCode = 0;
    } else {
      // 无效切换 → 设置 AL Status Code 0x0011
      s.alStatusCode = 0x0011;
    }
  }

  stateCheck(slaveIndex: number, targetState: number, _timeoutUs?: number): number {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    return s?.state ?? 0;
  }

  sdoRead(slaveIndex: number, index: number, subIndex: number, size: number): SdoResult {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    if (!s) return { success: false, errorMessage: '从站不存在' };
    const key = `${index}:${subIndex}`;
    const data = s.od.get(key);
    if (!data) return { success: false, abortCode: 0x06020000, errorMessage: '对象字典中不存在该对象' };
    return { success: true, data: Array.from(data.subarray(0, size)) };
  }

  sdoWrite(slaveIndex: number, index: number, subIndex: number, data: Buffer): SdoResult {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    if (!s) return { success: false, errorMessage: '从站不存在' };
    const key = `${index}:${subIndex}`;
    s.od.set(key, Buffer.from(data));
    return { success: true };
  }

  sendProcessData(): void {
    // 虚拟模式：模拟数据变化
    this.tick++;
    for (const s of this.slaves) {
      if (s.state !== EC_STATE.OP) continue;
      // EL1008: 模拟数字输入跳变
      if (s.productCode === 0x03f03052 && s.inputData.length > 0) {
        s.inputData[0] = (this.tick % 256);
      }
      // EL3102: 模拟模拟量输入（正弦波）
      if (s.productCode === 0x0c1e3052 && s.inputData.length >= 6) {
        const ch1 = Math.round(Math.sin(this.tick * 0.02) * 16000);
        const ch2 = Math.round(Math.cos(this.tick * 0.015) * 12000);
        s.inputData.writeInt16LE(ch1 < -32768 ? -32768 : ch1 > 32767 ? 32767 : ch1, 2);
        s.inputData.writeInt16LE(ch2 < -32768 ? -32768 : ch2 > 32767 ? 32767 : ch2, 4);
        // status bytes
        s.inputData[0] = 0x00;
        s.inputData[1] = 0x00;
      }
    }
    // 模拟 Emergency: 每 5000-15000 tick 随机产生一条
    if (this.tick - this.lastEmergencyTick > 5000 + Math.random() * 10000) {
      const opSlaves = this.slaves.filter((sl) => sl.state === EC_STATE.OP);
      if (opSlaves.length > 0) {
        const target = opSlaves[Math.floor(Math.random() * opSlaves.length)];
        const codes = [0x1000, 0x2000, 0x3000, 0x4000, 0x5000, 0x8100, 0xFF00];
        this.pendingEmergency.set(target.index, {
          timestamp: Date.now(),
          slaveIndex: target.index,
          errorCode: codes[Math.floor(Math.random() * codes.length)],
          errorRegister: Math.floor(Math.random() * 0xFF),
          data: Array.from({ length: 5 }, () => Math.floor(Math.random() * 256)),
        });
        this.lastEmergencyTick = this.tick;
      }
    }
  }

  receiveProcessData(_timeoutUs?: number): number {
    return this.slaves.filter((s) => s.state === EC_STATE.OP).length;
  }

  getInputData(slaveIndex: number): Buffer {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    return s ? Buffer.from(s.inputData) : Buffer.alloc(0);
  }

  getOutputData(slaveIndex: number): Buffer {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    return s ? Buffer.from(s.outputData) : Buffer.alloc(0);
  }

  writeOutputData(slaveIndex: number, data: Buffer): void {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    if (s) data.copy(s.outputData, 0, 0, Math.min(data.length, s.outputData.length));
  }

  getErrorCounters(slaveIndex: number): ErrorCounters {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    if (!s) return { invalidFrame: [0, 0, 0, 0], rxError: [0, 0, 0, 0], lostLink: [0, 0, 0, 0] };
    // 模拟: 每次读取时随机增加少量错误
    for (let p = 0; p < 4; p++) {
      if (Math.random() < 0.1) s.errorCounters.invalidFrame[p] += Math.floor(Math.random() * 3);
      if (Math.random() < 0.05) s.errorCounters.rxError[p] += Math.floor(Math.random() * 2);
      if (Math.random() < 0.02) s.errorCounters.lostLink[p] += 1;
    }
    return { ...s.errorCounters };
  }

  clearErrorCounters(slaveIndex: number): void {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    if (s) {
      s.errorCounters = { invalidFrame: [0, 0, 0, 0], rxError: [0, 0, 0, 0], lostLink: [0, 0, 0, 0] };
    }
  }

  readEmergency(slaveIndex: number): EmergencyMsg | null {
    const msg = this.pendingEmergency.get(slaveIndex) ?? null;
    if (msg) this.pendingEmergency.delete(slaveIndex);
    return msg;
  }

  foeWrite(_slaveIndex: number, _filename: string, _data: Buffer, _password?: number): FoeResult {
    // 虚拟模式: 直接返回成功（实际进度模拟在 service 层处理）
    return { success: true };
  }

  siiRead(slaveIndex: number, offset: number, size: number): number[] {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    if (!s) return [];
    const start = offset * 2; // word → byte offset
    const end = Math.min(start + size * 2, s.eeprom.length);
    return Array.from(s.eeprom.subarray(start, end));
  }

  siiWrite(slaveIndex: number, offset: number, data: number[]): boolean {
    const s = this.slaves.find((sl) => sl.index === slaveIndex);
    if (!s) return false;
    const start = offset * 2;
    for (let i = 0; i < data.length && start + i < s.eeprom.length; i++) {
      s.eeprom[start + i] = data[i];
    }
    return true;
  }

  close(): void {
    this.initialized = false;
    this.slaves = [];
    this.tick = 0;
    this.lastEmergencyTick = 0;
    this.pendingEmergency.clear();
  }

  /** 构建虚拟 EEPROM (256 words = 512 bytes) */
  private buildVirtualEeprom(): Buffer {
    const buf = Buffer.alloc(512, 0xFF);
    // SII header: PDI Control, PDI Config, etc.
    buf.writeUInt16LE(0x0000, 0); // PDI Control
    buf.writeUInt16LE(0x0000, 2); // PDI Config
    buf.writeUInt16LE(0x0000, 4); // Sync Impulse Length
    buf.writeUInt16LE(0x0000, 6); // PDI Config2
    buf.writeUInt16LE(0x0000, 8); // Configured Station Alias
    // Checksum at word 7
    buf.writeUInt16LE(0x0088, 14);
    return buf;
  }

  /** 构建虚拟对象字典 */
  private buildVirtualOd(slaveIndex: number): Map<string, Buffer> {
    const od = new Map<string, Buffer>();
    // 0x1000 Device Type
    const dt = Buffer.alloc(4); dt.writeUInt32LE(0x00001389);
    od.set('4096:0', dt);
    // 0x1008 Device Name
    const name = this.slaves?.[slaveIndex - 1]?.name ?? 'Virtual';
    od.set('4104:0', Buffer.from(name, 'utf-8'));
    // 0x1009 Hardware Version
    od.set('4105:0', Buffer.from('V1.0', 'utf-8'));
    // 0x100A Software Version
    od.set('4106:0', Buffer.from('V1.2.3', 'utf-8'));
    // 0x1018 Identity (subIndex 0=count, 1=vendor, 2=product, 3=revision, 4=serial)
    const cnt = Buffer.alloc(4); cnt.writeUInt32LE(4);
    od.set('4120:0', cnt);
    const vendor = Buffer.alloc(4); vendor.writeUInt32LE(0x00000002);
    od.set('4120:1', vendor);
    const product = Buffer.alloc(4); product.writeUInt32LE(VIRTUAL_SLAVES[slaveIndex - 1]?.productCode ?? 0);
    od.set('4120:2', product);
    const rev = Buffer.alloc(4); rev.writeUInt32LE(VIRTUAL_SLAVES[slaveIndex - 1]?.revision ?? 0);
    od.set('4120:3', rev);
    const ser = Buffer.alloc(4); ser.writeUInt32LE(slaveIndex);
    od.set('4120:4', ser);
    return od;
  }
}
