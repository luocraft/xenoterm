/**
 * EtherCAT 服务层 — 管理主站生命周期，协调 Driver 和 ESI Parser。
 */
import { randomUUID } from 'crypto';
import { SoemDriver } from './soem-driver';
import { VirtualEcatDriver } from './ecat-driver-virtual';
import type { EcatDriver } from './ecat-driver.interface';
import { parseEsi, type EsiDevice, type OdEntry } from './esi-parser';
import type { EcSlaveInfo, EcSession, SdoResult, ErrorCounters, PdoSignal, EmergencyMsg, FoeResult } from './types';
import { formatAbortCode } from './types';

export class EthercatService {
  private soemDriver: SoemDriver;
  private virtualDriver: VirtualEcatDriver;
  private driver: EcatDriver;
  private useVirtual = false;
  private session: EcSession | null = null;
  private pdoTimer: ReturnType<typeof setInterval> | null = null;
  private esiDevices: Map<string, EsiDevice> = new Map();
  private expectedWkc = 0;

  private callbacks: {
    onPdoData?: (slaveIndex: number, input: number[], output: number[]) => void;
    onWkcError?: (expectedWkc: number, actualWkc: number) => void;
    onStateChange?: (session: EcSession) => void;
    onEmergency?: (msg: EmergencyMsg) => void;
  } = {};

  constructor() {
    this.soemDriver = new SoemDriver();
    this.virtualDriver = new VirtualEcatDriver();
    // 默认使用 SOEM，不可用时 listAdapters 会包含虚拟适配器
    this.driver = this.soemDriver;
  }

  isAvailable(): boolean {
    // 始终返回 true — SOEM 不可用时有虚拟模式
    return true;
  }

  listAdapters(): { name: string; description: string }[] {
    const adapters: { name: string; description: string }[] = [];
    // 如果 SOEM 可用，列出真实适配器
    if (this.soemDriver.isAvailable()) {
      try {
        adapters.push(...this.soemDriver.listAdapters());
      } catch { /* ignore */ }
    }
    // 始终添加虚拟适配器
    adapters.push(...this.virtualDriver.listAdapters());
    return adapters;
  }

  connect(adapterName: string): EcSession {
    // 单会话约束：先关闭旧会话
    if (this.session && this.session.status !== 'closed') {
      this.disconnect();
    }

    // 根据适配器名称选择驱动
    if (adapterName.includes('Virtual') || adapterName.includes('模拟')) {
      this.driver = this.virtualDriver;
      this.useVirtual = true;
    } else {
      this.driver = this.soemDriver;
      this.useVirtual = false;
    }

    this.driver.init(adapterName);

    const session: EcSession = {
      id: randomUUID(),
      adapter: adapterName,
      slaveCount: 0,
      status: 'scanning',
    };
    this.session = session;
    this.notifyStateChange();

    try {
      const count = this.driver.configInit();
      session.slaveCount = count;
      session.status = 'connected';
    } catch (err) {
      session.status = 'error';
      this.notifyStateChange();
      throw err;
    }

    this.notifyStateChange();
    return { ...session };
  }

  disconnect(): void {
    this.stopPdoMonitor();
    try {
      this.driver.close();
    } catch { /* ignore */ }
    if (this.session) {
      this.session.status = 'closed';
      this.notifyStateChange();
    }
    this.session = null;
  }

  getSession(): EcSession | null {
    return this.session ? { ...this.session } : null;
  }

  getSlaves(): EcSlaveInfo[] {
    if (!this.session) return [];
    const slaves: EcSlaveInfo[] = [];
    for (let i = 1; i <= this.session.slaveCount; i++) {
      slaves.push(this.driver.getSlaveInfo(i));
    }
    return slaves;
  }

  getSlaveInfo(slaveIndex: number): EcSlaveInfo {
    return this.driver.getSlaveInfo(slaveIndex);
  }

  requestState(slaveIndex: number, targetState: number): {
    success: boolean; actualState: number; alStatusCode?: number;
  } {
    this.driver.writeState(slaveIndex, targetState);
    const actual = this.driver.stateCheck(slaveIndex, targetState);
    const info = this.driver.getSlaveInfo(slaveIndex);
    return {
      success: actual === targetState,
      actualState: actual,
      alStatusCode: info.alStatusCode,
    };
  }

  sdoRead(slaveIndex: number, index: number, subIndex: number, size: number): SdoResult {
    const result = this.driver.sdoRead(slaveIndex, index, subIndex, size);
    if (!result.success && result.abortCode) {
      result.errorMessage = formatAbortCode(result.abortCode);
    }
    return result;
  }

  sdoWrite(slaveIndex: number, index: number, subIndex: number, dataHex: string, dataType: string): SdoResult {
    const buf = Buffer.from(dataHex, 'hex');
    const result = this.driver.sdoWrite(slaveIndex, index, subIndex, buf);
    if (!result.success && result.abortCode) {
      result.errorMessage = formatAbortCode(result.abortCode);
    }
    return result;
  }

  startPdoMonitor(intervalMs: number = 1): void {
    this.stopPdoMonitor();
    if (!this.session) return;

    this.expectedWkc = this.session.slaveCount;

    this.pdoTimer = setInterval(() => {
      try {
        this.driver.sendProcessData();
        const wkc = this.driver.receiveProcessData(2000);

        if (wkc !== this.expectedWkc && this.callbacks.onWkcError) {
          this.callbacks.onWkcError(this.expectedWkc, wkc);
        }

        // 推送每个从站的 PDO 数据
        if (this.session && this.callbacks.onPdoData) {
          for (let i = 1; i <= this.session.slaveCount; i++) {
            const input = Array.from(this.driver.getInputData(i));
            const output = Array.from(this.driver.getOutputData(i));
            this.callbacks.onPdoData(i, input, output);
          }
        }

        // 轮询 Emergency 消息
        if (this.session && this.callbacks.onEmergency) {
          for (let i = 1; i <= this.session.slaveCount; i++) {
            const emg = this.driver.readEmergency(i);
            if (emg) this.callbacks.onEmergency(emg);
          }
        }
      } catch (err) {
        console.error('[EtherCAT] PDO cycle error:', (err as Error).message);
      }
    }, intervalMs);
  }

  stopPdoMonitor(): void {
    if (this.pdoTimer) {
      clearInterval(this.pdoTimer);
      this.pdoTimer = null;
    }
  }

  importEsi(xmlContent: string): EsiDevice {
    const device = parseEsi(xmlContent);
    const key = `${device.vendorId}:${device.productCode}`;
    this.esiDevices.set(key, device);
    return device;
  }

  getEsiDevice(vendorId: number, productCode: number): EsiDevice | undefined {
    return this.esiDevices.get(`${vendorId}:${productCode}`);
  }

  scanObjectDictionary(slaveIndex: number): OdEntry[] {
    const entries: OdEntry[] = [];
    // 扫描标准 CoE 对象字典范围: 0x1000 - 0x9FFF
    for (let idx = 0x1000; idx <= 0x9FFF; idx++) {
      const result = this.driver.sdoRead(slaveIndex, idx, 0, 4);
      if (!result.success) continue;

      entries.push({
        index: idx,
        subIndex: 0,
        name: `0x${idx.toString(16).padStart(4, '0')}`,
        dataType: '',
        bitSize: (result.data?.length ?? 0) * 8,
        access: 'rw',
        defaultValue: result.data
          ? result.data.map((b) => b.toString(16).padStart(2, '0')).join('')
          : undefined,
      });

      // 尝试读取子索引数量 (subIndex 0 通常包含子索引数量)
      if (result.data && result.data.length >= 1) {
        const subCount = result.data[0];
        for (let sub = 1; sub <= subCount && sub <= 255; sub++) {
          const subResult = this.driver.sdoRead(slaveIndex, idx, sub, 4);
          if (!subResult.success) continue;
          entries.push({
            index: idx,
            subIndex: sub,
            name: `0x${idx.toString(16).padStart(4, '0')}:${sub}`,
            dataType: '',
            bitSize: (subResult.data?.length ?? 0) * 8,
            access: 'rw',
            defaultValue: subResult.data
              ? subResult.data.map((b) => b.toString(16).padStart(2, '0')).join('')
              : undefined,
          });
        }
      }
    }
    return entries;
  }

  getErrorCounters(slaveIndex: number): ErrorCounters {
    return this.driver.getErrorCounters(slaveIndex);
  }

  clearErrorCounters(slaveIndex: number): void {
    this.driver.clearErrorCounters(slaveIndex);
  }

  writeOutputPdo(slaveIndex: number, offset: number, data: number[]): void {
    const current = this.driver.getOutputData(slaveIndex);
    const buf = Buffer.from(current);
    for (let i = 0; i < data.length && offset + i < buf.length; i++) {
      buf[offset + i] = data[i];
    }
    this.driver.writeOutputData(slaveIndex, buf);
  }

  resolvePdoSignals(slaveIndex: number): PdoSignal[] {
    const info = this.driver.getSlaveInfo(slaveIndex);
    const esiDevice = this.getEsiDevice(info.vendorId, info.productCode);
    if (!esiDevice) return [];

    const signals: PdoSignal[] = [];
    let bitOffset = 0;

    // TxPDO = 从站输入 (slave → master)
    for (const pdo of esiDevice.txPdo) {
      for (const entry of pdo.entries) {
        if (entry.index === 0 && entry.subIndex === 0) {
          // gap/padding entry
          bitOffset += entry.bitSize;
          continue;
        }
        signals.push({
          name: entry.name || `0x${entry.index.toString(16)}:${entry.subIndex}`,
          pdoIndex: pdo.index,
          bitOffset,
          bitSize: entry.bitSize,
          dataType: this.guessDataType(entry.bitSize),
          direction: 'input',
        });
        bitOffset += entry.bitSize;
      }
    }

    bitOffset = 0;
    // RxPDO = 从站输出 (master → slave)
    for (const pdo of esiDevice.rxPdo) {
      for (const entry of pdo.entries) {
        if (entry.index === 0 && entry.subIndex === 0) {
          bitOffset += entry.bitSize;
          continue;
        }
        signals.push({
          name: entry.name || `0x${entry.index.toString(16)}:${entry.subIndex}`,
          pdoIndex: pdo.index,
          bitOffset,
          bitSize: entry.bitSize,
          dataType: this.guessDataType(entry.bitSize),
          direction: 'output',
        });
        bitOffset += entry.bitSize;
      }
    }

    return signals;
  }

  private guessDataType(bitSize: number): string {
    switch (bitSize) {
      case 1: return 'BOOL';
      case 8: return 'USINT';
      case 16: return 'INT';
      case 32: return 'DINT';
      case 64: return 'LREAL';
      default: return `BIT${bitSize}`;
    }
  }

  async foeUpload(
    slaveIndex: number,
    filename: string,
    data: Buffer,
    password: number,
    onProgress?: (percent: number) => void
  ): Promise<FoeResult> {
    if (this.useVirtual) {
      // 虚拟模式: 模拟分块传输
      const chunkSize = 1024;
      const total = data.length;
      for (let offset = 0; offset < total; offset += chunkSize) {
        await new Promise((r) => setTimeout(r, 100));
        onProgress?.(Math.min(100, Math.round(((offset + chunkSize) / total) * 100)));
      }
      return { success: true };
    }
    return this.driver.foeWrite(slaveIndex, filename, data, password);
  }

  siiRead(slaveIndex: number, offset: number, size: number): number[] {
    return this.driver.siiRead(slaveIndex, offset, size);
  }

  siiWrite(slaveIndex: number, offset: number, data: number[]): boolean {
    return this.driver.siiWrite(slaveIndex, offset, data);
  }

  onPdoData(cb: (slaveIndex: number, input: number[], output: number[]) => void): void {
    this.callbacks.onPdoData = cb;
  }

  onWkcError(cb: (expected: number, actual: number) => void): void {
    this.callbacks.onWkcError = cb;
  }

  onStateChange(cb: (session: EcSession) => void): void {
    this.callbacks.onStateChange = cb;
  }

  onEmergency(cb: (msg: EmergencyMsg) => void): void {
    this.callbacks.onEmergency = cb;
  }

  private notifyStateChange(): void {
    if (this.session && this.callbacks.onStateChange) {
      this.callbacks.onStateChange({ ...this.session });
    }
  }
}
