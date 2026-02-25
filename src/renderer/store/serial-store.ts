import { create } from 'zustand';
import type { SerialSession, SerialConfig, SerialPortInfo, SerialMessage, NetDataEncoding } from '../../shared/types';

export interface SerialSendTemplate {
  id: string;
  name: string;
  data: string;
  encoding: NetDataEncoding;
  intervalMs: number;
  enabled: boolean;
}

export interface ModbusLogEntry {
  id: string;
  timestamp: number;
  direction: 'req' | 'res' | 'err';
  slave: number;
  fc: number;
  raw: string;
  detail: string;
}

function hexEncode(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexDecode(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []);
  return new TextDecoder().decode(bytes);
}

/** Timer handles for serial template timers — keyed by templateId */
const serialTemplateTimers = new Map<string, ReturnType<typeof setInterval>>();
/** Recording IDs — map sessionId to active recordingId */
const serialRecordings = new Map<string, string>();

function formatSerialRecordLine(msg: SerialMessage): string {
  const dir = msg.direction === 'send' ? 'SEND' : 'RECV';
  const time = new Date(msg.timestamp).toLocaleTimeString();
  const text = hexDecode(msg.data);
  return `[${time}] ${dir}  ${text}`;
}

function writeToSerialRecording(sessionId: string, msg: SerialMessage): void {
  const recId = serialRecordings.get(sessionId);
  if (recId) {
    window.api.recording.write(recId, formatSerialRecordLine(msg));
  }
}

export interface SerialStore {
  sessions: SerialSession[];
  activeSessionId: string | null;
  messages: Map<string, SerialMessage[]>;
  availablePorts: SerialPortInfo[];
  sendTemplates: Map<string, SerialSendTemplate[]>;
  recording: Map<string, boolean>;
  txBytes: Map<string, number>;
  rxBytes: Map<string, number>;
  viewMode: Map<string, 'raw' | 'modbus'>;
  modbusLogs: Map<string, ModbusLogEntry[]>;

  refreshPorts: () => Promise<void>;
  openPort: (config: SerialConfig) => Promise<void>;
  closePort: (sessionId: string) => void;
  reopenPort: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  sendData: (sessionId: string, data: string, encoding: NetDataEncoding) => void;
  clearMessages: (sessionId: string) => void;
  resetCounters: (sessionId: string) => void;
  setDTR: (sessionId: string, value: boolean) => void;
  setRTS: (sessionId: string, value: boolean) => void;
  addTemplate: (sessionId: string) => void;
  removeTemplate: (sessionId: string, templateId: string) => void;
  updateTemplate: (sessionId: string, templateId: string, patch: Partial<SerialSendTemplate>) => void;
  sendTemplate: (sessionId: string, templateId: string) => void;
  toggleTemplateTimer: (sessionId: string, templateId: string) => void;
  startRecording: (sessionId: string, filePath: string) => Promise<void>;
  stopRecording: (sessionId: string) => Promise<void>;
  setViewMode: (sessionId: string, mode: 'raw' | 'modbus') => void;
  appendModbusLog: (sessionId: string, entry: ModbusLogEntry) => void;
  clearModbusLogs: (sessionId: string) => void;
}

export const useSerialStore = create<SerialStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  availablePorts: [],
  sendTemplates: new Map(),
  recording: new Map(),
  txBytes: new Map(),
  rxBytes: new Map(),
  viewMode: new Map(),
  modbusLogs: new Map(),

  refreshPorts: async () => {
    try {
      const ports = await window.api.serial.list();
      set({ availablePorts: ports });
    } catch (err) {
      console.error('Failed to list serial ports:', err);
    }
  },

  openPort: async (config) => {
    try {
      const session = await window.api.serial.open(config);
      set((state) => ({
        sessions: [...state.sessions, session],
        activeSessionId: session.id,
        messages: new Map(state.messages).set(session.id, []),
      }));

      window.api.serial.onData(session.id, (hexData) => {
        const msg: SerialMessage = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          direction: 'recv',
          data: hexData,
          encoding: 'hex',
          timestamp: Date.now(),
        };
        writeToSerialRecording(session.id, msg);
        set((state) => {
          const msgs = new Map(state.messages);
          const list = [...(msgs.get(session.id) || []), msg];
          msgs.set(session.id, list.slice(-500));
          const rx = new Map(state.rxBytes);
          rx.set(session.id, (rx.get(session.id) || 0) + hexData.length / 2);
          return { messages: msgs, rxBytes: rx };
        });
      });

      window.api.serial.onClose(session.id, () => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === session.id ? { ...s, status: 'closed' as const } : s
          ),
        }));
      });

      window.api.serial.onError(session.id, (error) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === session.id ? { ...s, status: 'error' as const, error } : s
          ),
        }));
      });
    } catch (err) {
      console.error('Failed to open serial port:', err);
      throw err;
    }
  },

  closePort: (sessionId) => {
    window.api.serial.close(sessionId);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'closed' as const } : s
      ),
    }));
  },

  reopenPort: async (sessionId) => {
    const oldSession = get().sessions.find((s) => s.id === sessionId);
    if (!oldSession) return;
    try {
      const newSession = await window.api.serial.open(oldSession.config);
      // Migrate state: replace old session with new one, remap messages/templates/counters
      set((state) => {
        const msgs = new Map(state.messages);
        const oldMsgs = msgs.get(sessionId) || [];
        msgs.delete(sessionId);
        msgs.set(newSession.id, oldMsgs);
        const st = new Map(state.sendTemplates);
        const oldTpls = st.get(sessionId) || [];
        st.delete(sessionId);
        st.set(newSession.id, oldTpls);
        const rec = new Map(state.recording);
        rec.delete(sessionId);
        rec.set(newSession.id, false);
        const tx = new Map(state.txBytes);
        const oldTx = tx.get(sessionId) || 0;
        tx.delete(sessionId);
        tx.set(newSession.id, oldTx);
        const rx = new Map(state.rxBytes);
        const oldRx = rx.get(sessionId) || 0;
        rx.delete(sessionId);
        rx.set(newSession.id, oldRx);
        const vm = new Map(state.viewMode);
        const oldVm = vm.get(sessionId) || 'raw';
        vm.delete(sessionId);
        vm.set(newSession.id, oldVm);
        const ml = new Map(state.modbusLogs);
        const oldMl = ml.get(sessionId) || [];
        ml.delete(sessionId);
        ml.set(newSession.id, oldMl);
        return {
          sessions: state.sessions.map((s) => s.id === sessionId ? newSession : s),
          activeSessionId: state.activeSessionId === sessionId ? newSession.id : state.activeSessionId,
          messages: msgs,
          sendTemplates: st,
          recording: rec,
          txBytes: tx,
          rxBytes: rx,
          viewMode: vm,
          modbusLogs: ml,
        };
      });

      // Re-register event listeners for the new session
      window.api.serial.onData(newSession.id, (hexData) => {
        const msg: SerialMessage = {
          id: crypto.randomUUID(),
          sessionId: newSession.id,
          direction: 'recv',
          data: hexData,
          encoding: 'hex',
          timestamp: Date.now(),
        };
        writeToSerialRecording(newSession.id, msg);
        set((state) => {
          const msgs = new Map(state.messages);
          const list = [...(msgs.get(newSession.id) || []), msg];
          msgs.set(newSession.id, list.slice(-500));
          const rx = new Map(state.rxBytes);
          rx.set(newSession.id, (rx.get(newSession.id) || 0) + hexData.length / 2);
          return { messages: msgs, rxBytes: rx };
        });
      });

      window.api.serial.onClose(newSession.id, () => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === newSession.id ? { ...s, status: 'closed' as const } : s
          ),
        }));
      });

      window.api.serial.onError(newSession.id, (error) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === newSession.id ? { ...s, status: 'error' as const, error } : s
          ),
        }));
      });
    } catch (err) {
      console.error('Failed to reopen serial port:', err);
      throw err;
    }
  },

  removeSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (session && session.status === 'open') {
      window.api.serial.close(sessionId);
    }
    // Stop all template timers
    const tpls = get().sendTemplates.get(sessionId) || [];
    for (const tpl of tpls) {
      const key = `${sessionId}:${tpl.id}`;
      const th = serialTemplateTimers.get(key);
      if (th) { clearInterval(th); serialTemplateTimers.delete(key); }
    }
    // Stop recording if active
    const recId = serialRecordings.get(sessionId);
    if (recId) { window.api.recording.stop(recId); serialRecordings.delete(sessionId); }
    set((state) => {
      const msgs = new Map(state.messages);
      msgs.delete(sessionId);
      const st = new Map(state.sendTemplates);
      st.delete(sessionId);
      const rec = new Map(state.recording);
      rec.delete(sessionId);
      const tx = new Map(state.txBytes);
      tx.delete(sessionId);
      const rx = new Map(state.rxBytes);
      rx.delete(sessionId);
      const vm = new Map(state.viewMode);
      vm.delete(sessionId);
      const ml = new Map(state.modbusLogs);
      ml.delete(sessionId);
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        messages: msgs,
        sendTemplates: st,
        recording: rec,
        txBytes: tx,
        rxBytes: rx,
        viewMode: vm,
        modbusLogs: ml,
        activeSessionId: state.activeSessionId === sessionId
          ? (state.sessions.find((s) => s.id !== sessionId)?.id || null)
          : state.activeSessionId,
      };
    });
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  sendData: (sessionId, data, encoding) => {
    const hexData = encoding === 'hex' ? data.replace(/\s/g, '') : hexEncode(data);
    window.api.serial.write(sessionId, hexData);

    const msg: SerialMessage = {
      id: crypto.randomUUID(),
      sessionId,
      direction: 'send',
      data: hexData,
      encoding: 'hex',
      timestamp: Date.now(),
    };
    writeToSerialRecording(sessionId, msg);
    set((state) => {
      const msgs = new Map(state.messages);
      const list = [...(msgs.get(sessionId) || []), msg];
      msgs.set(sessionId, list.slice(-500));
      const tx = new Map(state.txBytes);
      tx.set(sessionId, (tx.get(sessionId) || 0) + hexData.length / 2);
      return { messages: msgs, txBytes: tx };
    });
  },

  clearMessages: (sessionId) => {
    set((state) => {
      const msgs = new Map(state.messages);
      msgs.set(sessionId, []);
      const tx = new Map(state.txBytes);
      tx.set(sessionId, 0);
      const rx = new Map(state.rxBytes);
      rx.set(sessionId, 0);
      return { messages: msgs, txBytes: tx, rxBytes: rx };
    });
  },

  resetCounters: (sessionId) => {
    set((state) => {
      const tx = new Map(state.txBytes);
      tx.set(sessionId, 0);
      const rx = new Map(state.rxBytes);
      rx.set(sessionId, 0);
      return { txBytes: tx, rxBytes: rx };
    });
  },

  setDTR: (sessionId, value) => {
    window.api.serial.setDTR(sessionId, value);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, dtr: value } : s
      ),
    }));
  },

  setRTS: (sessionId, value) => {
    window.api.serial.setRTS(sessionId, value);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, rts: value } : s
      ),
    }));
  },

  addTemplate: (sessionId) => {
    const tpl: SerialSendTemplate = {
      id: crypto.randomUUID(),
      name: '',
      data: '',
      encoding: 'utf8',
      intervalMs: 1000,
      enabled: false,
    };
    set((state) => {
      const m = new Map(state.sendTemplates);
      m.set(sessionId, [...(m.get(sessionId) || []), tpl]);
      return { sendTemplates: m };
    });
  },

  removeTemplate: (sessionId, templateId) => {
    const key = `${sessionId}:${templateId}`;
    const h = serialTemplateTimers.get(key);
    if (h) { clearInterval(h); serialTemplateTimers.delete(key); }
    set((state) => {
      const m = new Map(state.sendTemplates);
      m.set(sessionId, (m.get(sessionId) || []).filter((t) => t.id !== templateId));
      return { sendTemplates: m };
    });
  },

  updateTemplate: (sessionId, templateId, patch) => {
    set((state) => {
      const m = new Map(state.sendTemplates);
      m.set(sessionId, (m.get(sessionId) || []).map((t) =>
        t.id === templateId ? { ...t, ...patch } : t
      ));
      return { sendTemplates: m };
    });
  },

  sendTemplate: (sessionId, templateId) => {
    const tpls = get().sendTemplates.get(sessionId) || [];
    const tpl = tpls.find((t) => t.id === templateId);
    if (!tpl || !tpl.data.trim()) return;
    get().sendData(sessionId, tpl.data, tpl.encoding);
  },

  toggleTemplateTimer: (sessionId, templateId) => {
    const key = `${sessionId}:${templateId}`;
    const existing = serialTemplateTimers.get(key);
    if (existing) {
      clearInterval(existing);
      serialTemplateTimers.delete(key);
      get().updateTemplate(sessionId, templateId, { enabled: false });
      return;
    }
    const tpls = get().sendTemplates.get(sessionId) || [];
    const tpl = tpls.find((t) => t.id === templateId);
    if (!tpl || !tpl.data.trim() || tpl.intervalMs < 10) return;
    get().sendTemplate(sessionId, templateId);
    const handle = setInterval(() => {
      const s = get().sessions.find((ss) => ss.id === sessionId);
      if (!s || s.status !== 'open') {
        clearInterval(serialTemplateTimers.get(key)!);
        serialTemplateTimers.delete(key);
        get().updateTemplate(sessionId, templateId, { enabled: false });
        return;
      }
      get().sendTemplate(sessionId, templateId);
    }, tpl.intervalMs);
    serialTemplateTimers.set(key, handle);
    get().updateTemplate(sessionId, templateId, { enabled: true });
  },

  startRecording: async (sessionId, filePath) => {
    const recId = crypto.randomUUID();
    await window.api.recording.start(filePath, recId);
    serialRecordings.set(sessionId, recId);
    set((state) => {
      const rec = new Map(state.recording);
      rec.set(sessionId, true);
      return { recording: rec };
    });
  },

  stopRecording: async (sessionId) => {
    const recId = serialRecordings.get(sessionId);
    if (recId) {
      await window.api.recording.stop(recId);
      serialRecordings.delete(sessionId);
    }
    set((state) => {
      const rec = new Map(state.recording);
      rec.set(sessionId, false);
      return { recording: rec };
    });
  },

  setViewMode: (sessionId, mode) => {
    set((state) => {
      const vm = new Map(state.viewMode);
      vm.set(sessionId, mode);
      return { viewMode: vm };
    });
  },

  appendModbusLog: (sessionId, entry) => {
    set((state) => {
      const ml = new Map(state.modbusLogs);
      const list = [...(ml.get(sessionId) || []), entry].slice(-200);
      ml.set(sessionId, list);
      return { modbusLogs: ml };
    });
  },

  clearModbusLogs: (sessionId) => {
    set((state) => {
      const ml = new Map(state.modbusLogs);
      ml.set(sessionId, []);
      return { modbusLogs: ml };
    });
  },
}));
