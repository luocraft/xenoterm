/**
 * SOEM (Simple Open EtherCAT Master) 驱动层
 * 通过 koffi FFI 调用 soem.dll，提供类型安全的 TypeScript 接口。
 */
import koffi from 'koffi';
import { join } from 'path';
import { existsSync } from 'fs';
import type { EcSlaveInfo, SdoResult, ErrorCounters, EmergencyMsg, FoeResult } from './types';

const IOMAP_SIZE = 4096;
const EC_TIMEOUT_STATE = 3_000_000;  // 3s in µs
const EC_TIMEOUT_SDO = 500_000;      // 500ms in µs

export class SoemDriver {
  readonly name = 'SOEM';
  private lib: koffi.IKoffiLib | null = null;
  private fns: Record<string, (...args: unknown[]) => unknown> = {};
  private iomap: Buffer | null = null;
  private initialized = false;
  private slaveCount = 0;

  // 缓存从站信息偏移（从 ec_slave 结构体读取）
  private slaveInfoCache: Map<number, {
    oAddr: number; iAddr: number;
    obits: number; ibits: number;
  }> = new Map();

  private getDllPath(): string {
    const candidates = [
      join(process.resourcesPath || '', 'ethercat', 'soem.dll'),
      join(__dirname, '../../../../resources/ethercat/soem.dll'),
      join(process.cwd(), 'resources/ethercat/soem.dll'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return candidates[0];
  }

  private loadLib(): void {
    if (this.lib) return;
    const dllPath = this.getDllPath();
    this.lib = koffi.load(dllPath);

    // SOEM 核心函数绑定
    this.fns.ec_init = this.lib.func('int ec_init(const char*)');
    this.fns.ec_close = this.lib.func('void ec_close()');
    this.fns.ec_config_init = this.lib.func('int ec_config_init(uint8)');
    this.fns.ec_config_map = this.lib.func('int ec_config_map(_Inout_ void*)');
    this.fns.ec_writestate = this.lib.func('int ec_writestate(uint16)');
    this.fns.ec_statecheck = this.lib.func('uint16 ec_statecheck(uint16, uint16, int)');
    this.fns.ec_send_processdata = this.lib.func('int ec_send_processdata()');
    this.fns.ec_receive_processdata = this.lib.func('int ec_receive_processdata(int)');

    // SDO 读写
    this.fns.ec_SDOread = this.lib.func(
      'int ec_SDOread(uint16, uint16, uint8, uint8, _Inout_ int*, _Out_ void*, int)'
    );
    this.fns.ec_SDOwrite = this.lib.func(
      'int ec_SDOwrite(uint16, uint16, uint8, uint8, int, _In_ void*, int)'
    );

    // 从站信息访问
    this.fns.ec_slavecount = this.lib.func('int ec_slavecount()');

    // 适配器枚举
    // SOEM 使用 ec_find_adapters 或遍历链表，这里用简化版本
    this.fns.ec_find_adapters = this.lib.func('void* ec_find_adapters()');

    // 从站名称和信息读取
    this.fns.ec_slave_name = this.lib.func('const char* ec_slave_name(uint16)');
    this.fns.ec_slave_eep_man = this.lib.func('uint32 ec_slave_eep_man(uint16)');
    this.fns.ec_slave_eep_id = this.lib.func('uint32 ec_slave_eep_id(uint16)');
    this.fns.ec_slave_eep_rev = this.lib.func('uint32 ec_slave_eep_rev(uint16)');
    this.fns.ec_slave_eep_ser = this.lib.func('uint32 ec_slave_eep_ser(uint16)');
    this.fns.ec_slave_state = this.lib.func('uint16 ec_slave_state(uint16)');
    this.fns.ec_slave_ALstatuscode = this.lib.func('uint16 ec_slave_ALstatuscode(uint16)');
    this.fns.ec_slave_obits = this.lib.func('uint16 ec_slave_obits(uint16)');
    this.fns.ec_slave_ibits = this.lib.func('uint16 ec_slave_ibits(uint16)');
    this.fns.ec_slave_set_state = this.lib.func('void ec_slave_set_state(uint16, uint16)');

    // IOmap 偏移
    this.fns.ec_slave_oaddr = this.lib.func('uint32 ec_slave_oaddr(uint16)');
    this.fns.ec_slave_iaddr = this.lib.func('uint32 ec_slave_iaddr(uint16)');
  }

  /** 检查 soem.dll 是否可用 */
  isAvailable(): boolean {
    try {
      return existsSync(this.getDllPath());
    } catch {
      return false;
    }
  }

  /** 枚举 Npcap 网络适配器 */
  listAdapters(): { name: string; description: string }[] {
    this.loadLib();
    // SOEM 的适配器枚举返回链表，这里通过自定义封装函数获取
    // 实际实现依赖 soem.dll 的导出接口
    // 简化：使用 Npcap 的 pcap_findalldevs 或 SOEM 的 ec_find_adapters
    try {
      const adapters: { name: string; description: string }[] = [];
      const ptr = (this.fns.ec_find_adapters as Function)();
      if (!ptr) return adapters;
      // 遍历 ec_adaptert 链表
      // 注意：实际结构取决于 SOEM 编译版本
      // 这里返回空列表，由 service 层处理
      return adapters;
    } catch {
      return [];
    }
  }

  /** 初始化指定适配器 */
  init(adapterName: string): void {
    this.loadLib();
    const ret = (this.fns.ec_init as Function)(adapterName) as number;
    if (ret <= 0) throw new Error(`ec_init 失败: 无法初始化适配器 "${adapterName}"，请检查 Npcap 是否已安装`);
    this.initialized = true;
  }

  /** 扫描从站并映射 IOmap */
  configInit(): number {
    if (!this.initialized) throw new Error('适配器未初始化');
    const count = (this.fns.ec_config_init as Function)(0) as number;
    if (count <= 0) throw new Error('未发现从站设备');
    this.slaveCount = count;

    // 分配 IOmap 并映射
    this.iomap = Buffer.alloc(IOMAP_SIZE);
    (this.fns.ec_config_map as Function)(this.iomap);

    // 缓存从站 IO 偏移信息
    this.slaveInfoCache.clear();
    for (let i = 1; i <= count; i++) {
      this.slaveInfoCache.set(i, {
        oAddr: (this.fns.ec_slave_oaddr as Function)(i) as number,
        iAddr: (this.fns.ec_slave_iaddr as Function)(i) as number,
        obits: (this.fns.ec_slave_obits as Function)(i) as number,
        ibits: (this.fns.ec_slave_ibits as Function)(i) as number,
      });
    }

    return count;
  }

  /** 获取从站数量 */
  getSlaveCount(): number {
    return this.slaveCount;
  }

  /** 获取从站信息 */
  getSlaveInfo(slaveIndex: number): EcSlaveInfo {
    if (slaveIndex < 1 || slaveIndex > this.slaveCount) {
      throw new Error(`从站编号 ${slaveIndex} 超出范围 (1-${this.slaveCount})`);
    }
    const cached = this.slaveInfoCache.get(slaveIndex);
    return {
      index: slaveIndex,
      name: String((this.fns.ec_slave_name as Function)(slaveIndex) ?? ''),
      vendorId: (this.fns.ec_slave_eep_man as Function)(slaveIndex) as number,
      productCode: (this.fns.ec_slave_eep_id as Function)(slaveIndex) as number,
      revision: (this.fns.ec_slave_eep_rev as Function)(slaveIndex) as number,
      serial: (this.fns.ec_slave_eep_ser as Function)(slaveIndex) as number,
      state: (this.fns.ec_slave_state as Function)(slaveIndex) as number,
      alStatusCode: (this.fns.ec_slave_ALstatuscode as Function)(slaveIndex) as number,
      obits: cached?.obits ?? 0,
      ibits: cached?.ibits ?? 0,
      oAddr: cached?.oAddr ?? 0,
      iAddr: cached?.iAddr ?? 0,
    };
  }

  /** 设置从站状态 */
  writeState(slaveIndex: number, targetState: number): void {
    (this.fns.ec_slave_set_state as Function)(slaveIndex, targetState);
    (this.fns.ec_writestate as Function)(slaveIndex);
  }

  /** 检查从站状态 */
  stateCheck(slaveIndex: number, targetState: number, timeoutUs: number = EC_TIMEOUT_STATE): number {
    return (this.fns.ec_statecheck as Function)(slaveIndex, targetState, timeoutUs) as number;
  }

  /** SDO 读取 */
  sdoRead(slaveIndex: number, index: number, subIndex: number, size: number): SdoResult {
    const dataBuf = Buffer.alloc(Math.max(size, 256));
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeInt32LE(dataBuf.length);

    const wkc = (this.fns.ec_SDOread as Function)(
      slaveIndex, index, subIndex, 0, sizeBuf, dataBuf, EC_TIMEOUT_SDO
    ) as number;

    if (wkc <= 0) {
      return { success: false, abortCode: 0x08000000, errorMessage: 'SDO 读取失败 (WKC=0)' };
    }

    const actualSize = sizeBuf.readInt32LE(0);
    return {
      success: true,
      data: Array.from(dataBuf.subarray(0, actualSize)),
    };
  }

  /** SDO 写入 */
  sdoWrite(slaveIndex: number, index: number, subIndex: number, data: Buffer): SdoResult {
    const wkc = (this.fns.ec_SDOwrite as Function)(
      slaveIndex, index, subIndex, 0, data.length, data, EC_TIMEOUT_SDO
    ) as number;

    if (wkc <= 0) {
      return { success: false, abortCode: 0x08000000, errorMessage: 'SDO 写入失败 (WKC=0)' };
    }
    return { success: true };
  }

  /** 发送过程数据 */
  sendProcessData(): void {
    (this.fns.ec_send_processdata as Function)();
  }

  /** 接收过程数据，返回 WKC */
  receiveProcessData(timeoutUs: number = 2000): number {
    return (this.fns.ec_receive_processdata as Function)(timeoutUs) as number;
  }

  /** 读取 IOmap 中指定从站的输入数据 */
  getInputData(slaveIndex: number): Buffer {
    const info = this.slaveInfoCache.get(slaveIndex);
    if (!info || !this.iomap) return Buffer.alloc(0);
    const byteLen = Math.ceil(info.ibits / 8);
    if (byteLen === 0) return Buffer.alloc(0);
    return Buffer.from(this.iomap.subarray(info.iAddr, info.iAddr + byteLen));
  }

  /** 读取 IOmap 中指定从站的输出数据 */
  getOutputData(slaveIndex: number): Buffer {
    const info = this.slaveInfoCache.get(slaveIndex);
    if (!info || !this.iomap) return Buffer.alloc(0);
    const byteLen = Math.ceil(info.obits / 8);
    if (byteLen === 0) return Buffer.alloc(0);
    return Buffer.from(this.iomap.subarray(info.oAddr, info.oAddr + byteLen));
  }

  /** 写入 IOmap 中指定从站的输出数据 */
  writeOutputData(slaveIndex: number, data: Buffer): void {
    const info = this.slaveInfoCache.get(slaveIndex);
    if (!info || !this.iomap) return;
    const byteLen = Math.ceil(info.obits / 8);
    data.copy(this.iomap, info.oAddr, 0, Math.min(data.length, byteLen));
  }

  /** 读取错误计数器 (通过 SDO 读取 ESC 寄存器 0x0300-0x030D) */
  getErrorCounters(_slaveIndex: number): ErrorCounters {
    // 预留: 需要通过 FPRD 直接读取 ESC 寄存器，当前 SOEM 标准 API 不直接暴露
    return { invalidFrame: [0, 0, 0, 0], rxError: [0, 0, 0, 0], lostLink: [0, 0, 0, 0] };
  }

  /** 清零错误计数器 */
  clearErrorCounters(_slaveIndex: number): void {
    // 预留: 需要通过 FPWR 写入 ESC 寄存器
  }

  /** 读取 Emergency 消息 */
  readEmergency(_slaveIndex: number): EmergencyMsg | null {
    // 预留: 需要通过 mailbox 读取 Emergency 帧
    return null;
  }

  /** FoE 固件写入 */
  foeWrite(_slaveIndex: number, _filename: string, _data: Buffer, _password?: number): FoeResult {
    // 预留: 绑定 ec_FOEwrite()
    return { success: false, errorMessage: 'SOEM FoE 尚未实现' };
  }

  /** SII EEPROM 读取 */
  siiRead(_slaveIndex: number, _offset: number, _size: number): number[] {
    // 预留: 绑定 ec_SIIread()
    return [];
  }

  /** SII EEPROM 写入 */
  siiWrite(_slaveIndex: number, _offset: number, _data: number[]): boolean {
    // 预留: 绑定 ec_SIIwrite()
    return false;
  }

  /** 关闭连接 */
  close(): void {
    if (!this.initialized) return;
    try {
      (this.fns.ec_close as Function)();
    } catch { /* ignore */ }
    this.initialized = false;
    this.slaveCount = 0;
    this.iomap = null;
    this.slaveInfoCache.clear();
  }
}
