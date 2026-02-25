/**
 * EtherCAT Zustand Store — 管理渲染进程中的 EtherCAT UI 状态
 */
import { create } from 'zustand';

/** 从站 UI 数据 */
export interface EcSlaveUI {
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
  inputData: number[];
  outputData: number[];
}

/** SDO 操作历史 */
export interface SdoHistoryItem {
  timestamp: number;
  slaveIndex: number;
  index: number;
  subIndex: number;
  operation: 'read' | 'write';
  dataHex: string;
  success: boolean;
  errorMessage?: string;
}

/** OD 条目 (从 ESI 或 SDO 扫描) */
export interface OdEntryUI {
  index: number;
  subIndex: number;
  name: string;
  dataType: string;
  bitSize: number;
  access: string;
  defaultValue?: string;
  description?: string;
}

/** OD 树形分组 */
export interface OdGroup {
  index: number;
  name: string;
  entries: OdEntryUI[];
}

/** 将 OD 条目列表按索引分组 */
export function groupOdEntries(entries: OdEntryUI[]): OdGroup[] {
  const map = new Map<number, OdEntryUI[]>();
  for (const e of entries) {
    const arr = map.get(e.index) ?? [];
    arr.push(e);
    map.set(e.index, arr);
  }
  const groups: OdGroup[] = [];
  for (const [index, subs] of map) {
    subs.sort((a, b) => a.subIndex - b.subIndex);
    groups.push({ index, name: subs[0]?.name ?? '', entries: subs });
  }
  groups.sort((a, b) => a.index - b.index);
  return groups;
}

interface EcSession {
  id: string;
  adapter: string;
  slaveCount: number;
  status: 'connected' | 'scanning' | 'operational' | 'closed' | 'error';
}

/** Emergency 消息 UI 类型 */
export interface EmergencyMsgUI {
  timestamp: number;
  slaveIndex: number;
  errorCode: number;
  errorRegister: number;
  data: number[];
}

/** PDO 信号 UI 类型 */
export interface PdoSignalUI {
  name: string;
  pdoIndex: number;
  bitOffset: number;
  bitSize: number;
  dataType: string;
  direction: 'input' | 'output';
  currentValue?: number;
}

/** 错误计数器 UI 类型 */
export interface ErrorCountersUI {
  invalidFrame: [number, number, number, number];
  rxError: [number, number, number, number];
  lostLink: [number, number, number, number];
}

interface EsiDeviceUI {
  vendorId: number;
  productCode: number;
  revision: number;
  deviceName: string;
  groupName: string;
  objects: OdEntryUI[];
}

interface EthercatState {
  session: EcSession | null;
  adapters: { name: string; description: string }[];
  selectedAdapter: string;
  isAvailable: boolean;
  slaves: EcSlaveUI[];
  selectedSlaveIndex: number | null;
  sdoHistory: SdoHistoryItem[];
  pdoRunning: boolean;
  pdoInterval: number;
  esiDevices: Map<string, EsiDeviceUI>;
  odEntries: Map<number, OdEntryUI[]>;
  errorCounters: Map<number, ErrorCountersUI>;
  pdoSignals: Map<number, PdoSignalUI[]>;
  chartSignals: Set<string>;
  chartData: Map<string, number[]>;
  chartPaused: boolean;
  emergencyMessages: EmergencyMsgUI[];
  foeProgress: number | null;
  siiData: Map<number, number[]>;
  error: string | null;
  wkcError: { expected: number; actual: number } | null;
  activeTab: 'info' | 'sdo' | 'pdo' | 'od' | 'foe' | 'sii';

  // Actions
  checkAvailability: () => Promise<void>;
  loadAdapters: () => Promise<void>;
  setSelectedAdapter: (adapter: string) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshSlaves: () => Promise<void>;
  selectSlave: (index: number | null) => void;
  requestState: (slaveIndex: number, state: number) => Promise<void>;
  sdoRead: (slaveIndex: number, index: number, subIndex: number, size: number) => Promise<void>;
  sdoWrite: (slaveIndex: number, index: number, subIndex: number, dataHex: string, dataType: string) => Promise<void>;
  startPdo: (intervalMs?: number) => Promise<void>;
  stopPdo: () => Promise<void>;
  importEsi: (xmlContent: string) => Promise<void>;
  scanOd: (slaveIndex: number) => Promise<void>;
  loadErrorCounters: (slaveIndex: number) => Promise<void>;
  clearErrorCounters: (slaveIndex: number) => Promise<void>;
  resolvePdoSignals: (slaveIndex: number) => Promise<void>;
  toggleChartSignal: (key: string) => void;
  setChartPaused: (paused: boolean) => void;
  pushChartData: (key: string, value: number) => void;
  writeOutputPdo: (slaveIndex: number, offset: number, data: number[]) => Promise<void>;
  foeUpload: (slaveIndex: number, filename: string, data: number[], password: number) => Promise<void>;
  siiRead: (slaveIndex: number) => Promise<void>;
  siiWrite: (slaveIndex: number, data: number[]) => Promise<void>;
  setActiveTab: (tab: 'info' | 'sdo' | 'pdo' | 'od' | 'foe' | 'sii') => void;
  clearError: () => void;
}

export const useEthercatStore = create<EthercatState>((set, get) => {
  // 注册 IPC 事件监听
  let cleanupPdo: (() => void) | null = null;
  let cleanupWkc: (() => void) | null = null;
  let cleanupState: (() => void) | null = null;
  let cleanupEmergency: (() => void) | null = null;

  const setupListeners = () => {
    cleanupPdo = window.api?.ecat?.onPdoData?.((slave, input, output) => {
      set((s) => ({
        slaves: s.slaves.map((sl) =>
          sl.index === slave ? { ...sl, inputData: input, outputData: output } : sl
        ),
      }));
    });
    cleanupWkc = window.api?.ecat?.onWkcError?.((expected, actual) => {
      set({ wkcError: { expected, actual } });
    });
    cleanupState = window.api?.ecat?.onStateChange?.((session) => {
      set({ session });
    });
    cleanupEmergency = window.api?.ecat?.onEmergency?.((msg) => {
      set((s) => ({
        emergencyMessages: [...s.emergencyMessages, msg as EmergencyMsgUI].slice(-200),
      }));
    });
  };

  const teardownListeners = () => {
    cleanupPdo?.();
    cleanupWkc?.();
    cleanupState?.();
    cleanupEmergency?.();
    cleanupPdo = null;
    cleanupWkc = null;
    cleanupState = null;
    cleanupEmergency = null;
  };

  return {
    session: null,
    adapters: [],
    selectedAdapter: '',
    isAvailable: false,
    slaves: [],
    selectedSlaveIndex: null,
    sdoHistory: [],
    pdoRunning: false,
    pdoInterval: 1,
    esiDevices: new Map(),
    odEntries: new Map(),
    errorCounters: new Map(),
    pdoSignals: new Map(),
    chartSignals: new Set(),
    chartData: new Map(),
    chartPaused: false,
    emergencyMessages: [],
    foeProgress: null,
    siiData: new Map(),
    error: null,
    wkcError: null,
    activeTab: 'info',

    checkAvailability: async () => {
      try {
        const available = await window.api.ecat.isAvailable();
        set({ isAvailable: available });
      } catch {
        set({ isAvailable: false });
      }
    },

    loadAdapters: async () => {
      try {
        const adapters = await window.api.ecat.listAdapters();
        set({ adapters, selectedAdapter: adapters[0]?.name ?? '' });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    setSelectedAdapter: (adapter) => set({ selectedAdapter: adapter }),

    connect: async () => {
      const { selectedAdapter } = get();
      if (!selectedAdapter) return;
      set({ error: null });
      try {
        const session = await window.api.ecat.connect(selectedAdapter);
        set({ session });
        setupListeners();
        // 自动刷新从站列表
        await get().refreshSlaves();
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    disconnect: async () => {
      try {
        const { pdoRunning } = get();
        if (pdoRunning) await get().stopPdo();
        await window.api.ecat.disconnect();
        teardownListeners();
        set({ session: null, slaves: [], selectedSlaveIndex: null, pdoRunning: false, wkcError: null, errorCounters: new Map(), pdoSignals: new Map(), chartSignals: new Set(), chartData: new Map(), chartPaused: false, emergencyMessages: [], foeProgress: null, siiData: new Map() });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    refreshSlaves: async () => {
      try {
        const slaves = await window.api.ecat.getSlaves();
        set({
          slaves: slaves.map((s: any) => ({
            ...s,
            inputData: [],
            outputData: [],
          })),
        });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    selectSlave: (index) => set({ selectedSlaveIndex: index }),

    requestState: async (slaveIndex, state) => {
      try {
        const result = await window.api.ecat.requestState(slaveIndex, state);
        if (!result.success) {
          set({ error: `状态切换失败: 实际状态 0x${result.actualState.toString(16)}, AL Status: 0x${(result.alStatusCode ?? 0).toString(16)}` });
        }
        await get().refreshSlaves();
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    sdoRead: async (slaveIndex, index, subIndex, size) => {
      try {
        const result = await window.api.ecat.sdoRead(slaveIndex, index, subIndex, size);
        const item: SdoHistoryItem = {
          timestamp: Date.now(),
          slaveIndex,
          index,
          subIndex,
          operation: 'read',
          dataHex: result.data ? result.data.map((b: number) => b.toString(16).padStart(2, '0')).join('') : '',
          success: result.success,
          errorMessage: result.errorMessage,
        };
        set((s) => ({ sdoHistory: [item, ...s.sdoHistory].slice(0, 200) }));
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    sdoWrite: async (slaveIndex, index, subIndex, dataHex, dataType) => {
      try {
        const result = await window.api.ecat.sdoWrite(slaveIndex, index, subIndex, dataHex, dataType);
        const item: SdoHistoryItem = {
          timestamp: Date.now(),
          slaveIndex,
          index,
          subIndex,
          operation: 'write',
          dataHex,
          success: result.success,
          errorMessage: result.errorMessage,
        };
        set((s) => ({ sdoHistory: [item, ...s.sdoHistory].slice(0, 200) }));
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    startPdo: async (intervalMs) => {
      try {
        await window.api.ecat.startPdo(intervalMs ?? get().pdoInterval);
        set({ pdoRunning: true, wkcError: null });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    stopPdo: async () => {
      try {
        await window.api.ecat.stopPdo();
        set({ pdoRunning: false });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    importEsi: async (xmlContent) => {
      try {
        const device = await window.api.ecat.importEsi(xmlContent);
        set((s) => {
          const map = new Map(s.esiDevices);
          map.set(`${device.vendorId}:${device.productCode}`, device as any);
          return { esiDevices: map };
        });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    scanOd: async (slaveIndex) => {
      try {
        const entries = await window.api.ecat.scanOd(slaveIndex);
        set((s) => {
          const map = new Map(s.odEntries);
          map.set(slaveIndex, entries as any);
          return { odEntries: map };
        });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    loadErrorCounters: async (slaveIndex) => {
      try {
        const counters = await window.api.ecat.getErrorCounters(slaveIndex);
        set((s) => {
          const map = new Map(s.errorCounters);
          map.set(slaveIndex, counters as ErrorCountersUI);
          return { errorCounters: map };
        });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    clearErrorCounters: async (slaveIndex) => {
      try {
        await window.api.ecat.clearErrorCounters(slaveIndex);
        set((s) => {
          const map = new Map(s.errorCounters);
          map.set(slaveIndex, { invalidFrame: [0, 0, 0, 0], rxError: [0, 0, 0, 0], lostLink: [0, 0, 0, 0] });
          return { errorCounters: map };
        });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    resolvePdoSignals: async (slaveIndex) => {
      try {
        const signals = await window.api.ecat.resolvePdoSignals(slaveIndex);
        set((s) => {
          const map = new Map(s.pdoSignals);
          map.set(slaveIndex, signals as PdoSignalUI[]);
          return { pdoSignals: map };
        });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    toggleChartSignal: (key) => {
      set((s) => {
        const next = new Set(s.chartSignals);
        if (next.has(key)) {
          next.delete(key);
          const data = new Map(s.chartData);
          data.delete(key);
          return { chartSignals: next, chartData: data };
        }
        if (next.size >= 4) return s; // 最多 4 个
        next.add(key);
        return { chartSignals: next };
      });
    },

    setChartPaused: (paused) => set({ chartPaused: paused }),

    pushChartData: (key, value) => {
      set((s) => {
        if (s.chartPaused) return s;
        if (!s.chartSignals.has(key)) return s;
        const data = new Map(s.chartData);
        const arr = [...(data.get(key) ?? []), value];
        if (arr.length > 500) arr.splice(0, arr.length - 500);
        data.set(key, arr);
        return { chartData: data };
      });
    },

    writeOutputPdo: async (slaveIndex, offset, data) => {
      try {
        await window.api.ecat.writeOutputPdo(slaveIndex, offset, data);
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    foeUpload: async (slaveIndex, filename, data, password) => {
      try {
        set({ foeProgress: 0 });
        const cleanup = window.api.ecat.onFoeProgress?.((percent: number) => {
          set({ foeProgress: percent });
        });
        const result = await window.api.ecat.foeUpload(slaveIndex, filename, data, password);
        cleanup?.();
        set({ foeProgress: null });
        if (!result.success) {
          set({ error: result.errorMessage ?? 'FoE 上传失败' });
        }
      } catch (err) {
        set({ foeProgress: null, error: (err as Error).message });
      }
    },

    siiRead: async (slaveIndex) => {
      try {
        const data = await window.api.ecat.siiRead(slaveIndex, 0, 256);
        set((s) => {
          const map = new Map(s.siiData);
          map.set(slaveIndex, data);
          return { siiData: map };
        });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    siiWrite: async (slaveIndex, data) => {
      try {
        await window.api.ecat.siiWrite(slaveIndex, 0, data);
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    setActiveTab: (tab) => set({ activeTab: tab }),
    clearError: () => set({ error: null }),
  };
});
