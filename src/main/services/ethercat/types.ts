/**
 * EtherCAT 核心类型定义、常量和格式化工具函数
 */

/** 从站信息 */
export interface EcSlaveInfo {
  index: number;        // 从站编号 (1-based)
  name: string;         // 从站名称
  vendorId: number;     // 厂商 ID
  productCode: number;  // 产品代码
  revision: number;     // 修订号
  serial: number;       // 序列号
  state: number;        // 当前状态 (EC_STATE_*)
  alStatusCode: number; // AL Status Code
  obits: number;        // 输出位数
  ibits: number;        // 输入位数
  oAddr: number;        // IOmap 输出偏移
  iAddr: number;        // IOmap 输入偏移
}

/** EtherCAT 会话 */
export interface EcSession {
  id: string;
  adapter: string;
  slaveCount: number;
  status: 'connected' | 'scanning' | 'operational' | 'closed' | 'error';
}

/** SDO 操作结果 */
export interface SdoResult {
  success: boolean;
  data?: number[];      // 字节数组 (跨 IPC 序列化友好)
  abortCode?: number;
  errorMessage?: string;
}

/** EtherCAT 状态常量 */
export const EC_STATE = {
  NONE: 0x00,
  INIT: 0x01,
  PRE_OP: 0x02,
  SAFE_OP: 0x04,
  OP: 0x08,
  ERROR: 0x10,
} as const;

/** 状态值 → 可读标签 */
const STATE_LABELS: Record<number, string> = {
  [EC_STATE.NONE]: 'NONE',
  [EC_STATE.INIT]: 'INIT',
  [EC_STATE.PRE_OP]: 'PRE-OP',
  [EC_STATE.SAFE_OP]: 'SAFE-OP',
  [EC_STATE.OP]: 'OP',
  [EC_STATE.ERROR]: 'ERROR',
};

/** 格式化 EtherCAT 状态值为可读标签 */
export function formatState(state: number): string {
  // 处理组合状态 (如 ERROR + 某状态)
  if (state & EC_STATE.ERROR) {
    const base = state & ~EC_STATE.ERROR;
    const baseLabel = STATE_LABELS[base] ?? `0x${base.toString(16).padStart(2, '0')}`;
    return `ERROR+${baseLabel}`;
  }
  return STATE_LABELS[state] ?? `UNKNOWN(0x${state.toString(16).padStart(2, '0')})`;
}

/** SDO Abort Code → 中文描述 */
const SDO_ABORT_CODES: Record<number, string> = {
  0x05030000: '切换位未交替',
  0x05040001: 'SDO 命令标识符无效',
  0x06010000: '不支持访问该对象',
  0x06010001: '尝试读取只写对象',
  0x06010002: '尝试写入只读对象',
  0x06020000: '对象字典中不存在该对象',
  0x06040041: '对象不可映射到 PDO',
  0x06040042: '映射对象数量和长度超出 PDO 限制',
  0x06070010: '数据类型不匹配，服务参数长度不匹配',
  0x06090011: '子索引不存在',
  0x06090030: '参数值超出范围',
  0x08000000: '一般错误',
};

/** 格式化 SDO abort code 为可读描述 */
export function formatAbortCode(abortCode: number): string {
  const desc = SDO_ABORT_CODES[abortCode];
  if (desc) return desc;
  return `未知错误 (0x${abortCode.toString(16).padStart(8, '0')})`;
}

/** 支持的数据类型及其字节数 */
export const DATA_TYPES: Record<string, number> = {
  BOOL: 1,
  SINT: 1,
  USINT: 1,
  INT: 2,
  UINT: 2,
  DINT: 4,
  UDINT: 4,
  REAL: 4,
  LREAL: 8,
};

/** 格式化字节数组为十六进制 + 十进制数值 */
export function formatDataValue(
  bytes: number[],
  dataType: string
): { hex: string; decimal: string } {
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

  if (bytes.length === 0) return { hex: '', decimal: '0' };

  const buf = Buffer.from(bytes);

  switch (dataType) {
    case 'BOOL':
      return { hex, decimal: buf[0] ? '1' : '0' };
    case 'SINT':
      return { hex, decimal: buf.readInt8(0).toString() };
    case 'USINT':
      return { hex, decimal: buf.readUInt8(0).toString() };
    case 'INT':
      return { hex, decimal: buf.readInt16LE(0).toString() };
    case 'UINT':
      return { hex, decimal: buf.readUInt16LE(0).toString() };
    case 'DINT':
      return { hex, decimal: buf.readInt32LE(0).toString() };
    case 'UDINT':
      return { hex, decimal: buf.readUInt32LE(0).toString() };
    case 'REAL':
      return { hex, decimal: buf.readFloatLE(0).toString() };
    case 'LREAL':
      return { hex, decimal: buf.readDoubleLE(0).toString() };
    default: {
      // 未知类型，只显示十六进制和无符号整数
      let val = 0;
      for (let i = bytes.length - 1; i >= 0; i--) {
        val = val * 256 + bytes[i];
      }
      return { hex, decimal: val.toString() };
    }
  }
}

/** 已知的 SDO abort code 列表（用于测试） */
export const KNOWN_ABORT_CODES = Object.keys(SDO_ABORT_CODES).map(Number);

/** AL Status Code → 中文描述 (ETG.1000.6) */
export const AL_STATUS_CODES: Record<number, string> = {
  0x0000: '无错误',
  0x0001: '未指定错误',
  0x0002: '内存不足',
  0x0011: '无效的请求状态切换',
  0x0012: '未知的请求状态',
  0x0013: 'Bootstrap 不支持',
  0x0014: '无有效固件',
  0x0015: '无效的邮箱配置 (Bootstrap)',
  0x0016: '无效的邮箱配置 (PreOp)',
  0x0017: '无效的同步管理器配置',
  0x0018: '无有效输入',
  0x0019: '无有效输出',
  0x001A: '同步错误',
  0x001B: '同步管理器看门狗',
  0x001C: '无效的同步管理器类型',
  0x001D: '无效的输出配置',
  0x001E: '无效的输入配置',
  0x001F: '无效的看门狗配置',
  0x0020: '从站需要冷启动',
  0x0021: '从站需要 INIT',
  0x0022: '从站需要 PRE-OP',
  0x0023: '从站需要 SAFE-OP',
  0x0024: '无效的输入映射',
  0x0025: '无效的输出映射',
  0x0026: '设置不一致',
  0x0027: 'FreeRun 不支持',
  0x0028: '同步模式不支持',
  0x0029: 'FreeRun 需要 3 缓冲模式',
  0x002A: '后台看门狗',
  0x002B: '无有效输入输出',
  0x002C: '致命同步错误',
  0x002D: '无同步错误',
  0x002E: '无效的输入 FMMU 配置',
  0x0030: '无效的 DC SYNC 配置',
  0x0031: '无效的 DC 锁存配置',
  0x0032: 'PLL 错误',
  0x0033: 'DC 同步 IO 错误',
  0x0034: 'DC 同步超时',
  0x0035: 'DC 无效的同步周期',
  0x0036: 'DC 无效的同步 0 周期',
  0x0037: 'DC 无效的同步 1 周期',
  0x0041: 'MBX_AOE 错误',
  0x0042: 'MBX_EOE 错误',
  0x0043: 'MBX_COE 错误',
  0x0044: 'MBX_FOE 错误',
  0x0045: 'MBX_SOE 错误',
  0x004F: 'MBX_VOE 错误',
  0x0050: 'EEPROM 无访问权限',
  0x0051: 'EEPROM 错误',
  0x0060: '从站重启',
  0x00F0: '设备标识值更新',
  0x00FF: '应用控制器可用',
};

/** 格式化 AL Status Code 为中文描述 */
export function formatAlStatusCode(code: number): string {
  const desc = AL_STATUS_CODES[code];
  if (desc) return desc;
  if (code === 0) return '';
  return `未知 (0x${code.toString(16).padStart(4, '0')})`;
}

/** 错误计数器 (每从站 4 端口) */
export interface ErrorCounters {
  invalidFrame: [number, number, number, number];
  rxError: [number, number, number, number];
  lostLink: [number, number, number, number];
}

/** PDO 信号定义 */
export interface PdoSignal {
  name: string;
  pdoIndex: number;
  bitOffset: number;
  bitSize: number;
  dataType: string;
  direction: 'input' | 'output';
}

/** Emergency 消息 */
export interface EmergencyMsg {
  timestamp: number;
  slaveIndex: number;
  errorCode: number;
  errorRegister: number;
  data: number[];
}

/** CoE Emergency 错误代码 → 描述 */
export const EMERGENCY_CODES: Record<number, string> = {
  0x0000: '无错误/错误已清除',
  0x1000: '一般错误',
  0x2000: '电流错误',
  0x2100: '设备输入侧电流过大',
  0x2200: '设备内部电流过大',
  0x2300: '设备输出侧电流过大',
  0x3000: '电压错误',
  0x3100: '主电源电压过高',
  0x3200: '设备内部电压过高',
  0x3300: '输出电压过高',
  0x4000: '温度错误',
  0x4100: '环境温度过高',
  0x4200: '设备温度过高',
  0x5000: '设备硬件错误',
  0x6000: '设备软件错误',
  0x6100: '内部软件错误',
  0x6200: '用户软件错误',
  0x6300: '数据集错误',
  0x7000: '附加模块错误',
  0x8000: '监控错误',
  0x8100: '通信错误',
  0x8110: 'CAN 溢出',
  0x8120: '被动错误',
  0x8130: '心跳错误',
  0x8200: '协议错误',
  0x8210: 'PDO 未处理',
  0x8220: 'PDO 长度超出',
  0x9000: '外部错误',
  0xF000: '附加功能错误',
  0xFF00: '设备特定错误',
};

/** 格式化 Emergency 错误代码 */
export function formatEmergencyCode(code: number): string {
  const desc = EMERGENCY_CODES[code];
  if (desc) return desc;
  // 尝试匹配高字节
  const high = code & 0xFF00;
  const highDesc = EMERGENCY_CODES[high];
  if (highDesc) return `${highDesc} (0x${code.toString(16).padStart(4, '0')})`;
  return `未知 (0x${code.toString(16).padStart(4, '0')})`;
}

/** FoE 传输结果 */
export interface FoeResult {
  success: boolean;
  errorCode?: number;
  errorMessage?: string;
}

/** 已知的 AL Status Code 列表（用于测试） */
export const KNOWN_AL_STATUS_CODES = Object.keys(AL_STATUS_CODES).map(Number);
