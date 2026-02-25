/**
 * ESI (EtherCAT Slave Information) XML 解析器
 * 解析 ETG.2000 规范的 ESI XML 文件，提取设备描述、对象字典和 PDO 映射。
 */
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/** 对象字典条目 */
export interface OdEntry {
  index: number;
  subIndex: number;
  name: string;
  dataType: string;
  bitSize: number;
  access: 'ro' | 'rw' | 'wo';
  defaultValue?: string;
  description?: string;
}

/** PDO 映射条目 */
export interface PdoMapping {
  index: number;
  name: string;
  entries: { index: number; subIndex: number; name: string; bitSize: number }[];
}

/** ESI 设备描述 */
export interface EsiDevice {
  vendorId: number;
  productCode: number;
  revision: number;
  deviceName: string;
  groupName: string;
  rxPdo: PdoMapping[];
  txPdo: PdoMapping[];
  objects: OdEntry[];
}

/** 解析 #x 前缀的十六进制数值 */
function parseHexValue(val: string | number | undefined): number {
  if (val === undefined || val === null) return 0;
  const s = String(val).trim();
  if (s.startsWith('#x') || s.startsWith('#X')) {
    return parseInt(s.slice(2), 16) || 0;
  }
  if (s.startsWith('0x') || s.startsWith('0X')) {
    return parseInt(s.slice(2), 16) || 0;
  }
  return parseInt(s, 10) || 0;
}

/** 确保值为数组 */
function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

/** 解析 PDO 映射 */
function parsePdoList(pdoNodes: any[]): PdoMapping[] {
  return pdoNodes.map((pdo) => {
    const entries = ensureArray(pdo.Entry).map((e: any) => ({
      index: parseHexValue(e.Index),
      subIndex: typeof e.SubIndex === 'number' ? e.SubIndex : parseHexValue(e.SubIndex),
      name: String(e.Name ?? ''),
      bitSize: Number(e.BitLen ?? e.BitSize ?? 0),
    }));
    return {
      index: parseHexValue(pdo['@_Index'] ?? pdo.Index),
      name: String(pdo.Name ?? ''),
      entries,
    };
  });
}

/** 解析访问权限 */
function parseAccess(accessStr: string | undefined): 'ro' | 'rw' | 'wo' {
  if (!accessStr) return 'rw';
  const lower = accessStr.toLowerCase();
  if (lower === 'ro' || lower === 'read only') return 'ro';
  if (lower === 'wo' || lower === 'write only') return 'wo';
  return 'rw';
}

/** 解析对象字典 */
function parseObjects(objectNodes: any[]): OdEntry[] {
  const entries: OdEntry[] = [];
  for (const obj of objectNodes) {
    const index = parseHexValue(obj.Index);
    const name = String(obj.Name ?? '');
    const dataType = String(obj.Type ?? obj.DataType ?? '');
    const bitSize = Number(obj.BitSize ?? 0);
    const access = parseAccess(obj.Access);
    const defaultValue = obj.DefaultValue !== undefined ? String(obj.DefaultValue) : undefined;
    const description = obj.Description !== undefined ? String(obj.Description) : undefined;

    // 处理子索引
    const subItems = ensureArray(obj.SubItem);
    if (subItems.length > 0) {
      // 索引 0 = 对象本身（子索引数量）
      entries.push({ index, subIndex: 0, name, dataType, bitSize, access, defaultValue, description });
      for (const sub of subItems) {
        entries.push({
          index,
          subIndex: typeof sub.SubIdx === 'number' ? sub.SubIdx : parseHexValue(sub.SubIdx),
          name: String(sub.Name ?? ''),
          dataType: String(sub.Type ?? sub.DataType ?? ''),
          bitSize: Number(sub.BitSize ?? 0),
          access: parseAccess(sub.Access),
          defaultValue: sub.DefaultValue !== undefined ? String(sub.DefaultValue) : undefined,
          description: sub.Description !== undefined ? String(sub.Description) : undefined,
        });
      }
    } else {
      entries.push({ index, subIndex: 0, name, dataType, bitSize, access, defaultValue, description });
    }
  }
  return entries;
}

/** 解析 ESI XML 内容 */
export function parseEsi(xmlContent: string): EsiDevice {
  if (!xmlContent || typeof xmlContent !== 'string' || xmlContent.trim().length === 0) {
    throw new Error('ESI XML 内容为空');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
  });

  let parsed: any;
  try {
    parsed = parser.parse(xmlContent);
  } catch (err) {
    throw new Error(`ESI XML 解析失败: ${(err as Error).message}`);
  }

  const root = parsed.EtherCATInfo;
  if (!root) throw new Error('ESI XML 缺少 EtherCATInfo 根节点');

  // Vendor ID
  const vendorId = parseHexValue(root.Vendor?.Id);

  // Device
  const devices = ensureArray(root.Descriptions?.Devices?.Device);
  if (devices.length === 0) throw new Error('ESI XML 缺少 Device 节点');

  const device = devices[0]; // 取第一个设备
  const typeNode = device.Type;
  const productCode = parseHexValue(typeNode?.['@_ProductCode']);
  const revision = parseHexValue(typeNode?.['@_RevisionNo']);
  const deviceName = String(device.Name ?? typeNode?.['#text'] ?? typeNode ?? '');
  const groupName = String(device.Group?.Type ?? device.GroupType ?? '');

  // PDO
  const txPdo = parsePdoList(ensureArray(device.TxPdo));
  const rxPdo = parsePdoList(ensureArray(device.RxPdo));

  // Objects
  const objectNodes = ensureArray(
    device.Profile?.Dictionary?.Objects?.Object ??
    device.Profile?.Objects?.Object
  );
  const objects = parseObjects(objectNodes);

  return { vendorId, productCode, revision, deviceName, groupName, rxPdo, txPdo, objects };
}

/** 将 EsiDevice 序列化回 XML（用于往返测试） */
export function serializeEsi(device: EsiDevice): string {
  const serializePdoEntries = (entries: PdoMapping['entries']) =>
    entries.map((e) => ({
      Index: `#x${e.index.toString(16).padStart(4, '0')}`,
      SubIndex: e.subIndex,
      Name: e.name,
      BitLen: e.bitSize,
    }));

  const serializePdo = (pdos: PdoMapping[]) =>
    pdos.map((p) => ({
      '@_Index': `#x${p.index.toString(16).padStart(4, '0')}`,
      Name: p.name,
      Entry: serializePdoEntries(p.entries),
    }));

  const serializeObjects = (objects: OdEntry[]) => {
    // Group by index
    const groups = new Map<number, OdEntry[]>();
    for (const o of objects) {
      const arr = groups.get(o.index) ?? [];
      arr.push(o);
      groups.set(o.index, arr);
    }

    return Array.from(groups.entries()).map(([index, subs]) => {
      const main = subs[0];
      const obj: any = {
        Index: `#x${index.toString(16).padStart(4, '0')}`,
        Name: main.name,
        Type: main.dataType,
        BitSize: main.bitSize,
        Access: main.access,
      };
      if (main.defaultValue !== undefined) obj.DefaultValue = main.defaultValue;
      if (main.description !== undefined) obj.Description = main.description;

      // SubItems (skip subIndex 0 which is the main entry)
      const subItems = subs.filter((s) => s.subIndex > 0);
      if (subItems.length > 0) {
        obj.SubItem = subItems.map((s) => {
          const si: any = {
            SubIdx: s.subIndex,
            Name: s.name,
            Type: s.dataType,
            BitSize: s.bitSize,
            Access: s.access,
          };
          if (s.defaultValue !== undefined) si.DefaultValue = s.defaultValue;
          if (s.description !== undefined) si.Description = s.description;
          return si;
        });
      }
      return obj;
    });
  };

  const xmlObj = {
    EtherCATInfo: {
      Vendor: { Id: `#x${device.vendorId.toString(16).padStart(8, '0')}` },
      Descriptions: {
        Devices: {
          Device: {
            Type: {
              '#text': device.deviceName,
              '@_ProductCode': `#x${device.productCode.toString(16).padStart(8, '0')}`,
              '@_RevisionNo': `#x${device.revision.toString(16).padStart(8, '0')}`,
            },
            Name: device.deviceName,
            Group: { Type: device.groupName },
            TxPdo: serializePdo(device.txPdo),
            RxPdo: serializePdo(device.rxPdo),
            Profile: {
              Dictionary: {
                Objects: {
                  Object: serializeObjects(device.objects),
                },
              },
            },
          },
        },
      },
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    suppressEmptyNode: true,
  });

  return builder.build(xmlObj);
}
