import { create } from 'zustand';
import type { NetSession, NetProtocol, NetMessage, NetDataEncoding } from '../../shared/types';

export interface SendTemplate {
  id: string;
  name: string;
  data: string;
  encoding: NetDataEncoding;
  intervalMs: number;
  enabled: boolean; // timer running
}

export interface SessionUIState {
  input: string;
  encoding: NetDataEncoding;
  displayEncoding: NetDataEncoding;
  targetClient: string;
  timerInterval: string;
  timerRunning: boolean;
  messageFilter: 'all' | 'send' | 'recv';
  recording: boolean;
}

const defaultUIState = (): SessionUIState => ({
  input: '',
  encoding: 'utf8',
  displayEncoding: 'utf8',
  targetClient: '',
  timerInterval: '1000',
  timerRunning: false,
  messageFilter: 'all',
  recording: false,
});

/** Timer handles live outside React — survive tab switches */
const timerHandles = new Map<string, ReturnType<typeof setInterval>>();
/** Recording IDs — map sessionId to active recordingId */
const activeRecordings = new Map<string, string>();

export function getTimerHandles() { return timerHandles; }

/** Timer handles for template timers — keyed by templateId */
const templateTimerHandles = new Map<string, ReturnType<typeof setInterval>>();

export interface NetDebugStore {
  sessions: NetSession[];
  activeSessionId: string | null;
  messages: Map<string, NetMessage[]>;
  sessionUI: Map<string, SessionUIState>;
  sendTemplates: Map<string, SendTemplate[]>; // sessionId -> templates

  createSession: (protocol: NetProtocol, host: string, port: number, localPort?: number) => Promise<void>;
  closeSession: (sessionId: string) => void;
  reopenSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  sendData: (sessionId: string, data: string, encoding: NetDataEncoding, remoteAddress?: string) => void;
  clearMessages: (sessionId: string) => void;
  updateSessionUI: (sessionId: string, patch: Partial<SessionUIState>) => void;
  startTimer: (sessionId: string) => void;
  stopTimer: (sessionId: string) => void;
  startRecording: (sessionId: string, filePath: string) => Promise<void>;
  stopRecording: (sessionId: string) => Promise<void>;
  addTemplate: (sessionId: string) => void;
  removeTemplate: (sessionId: string, templateId: string) => void;
  updateTemplate: (sessionId: string, templateId: string, patch: Partial<SendTemplate>) => void;
  sendTemplate: (sessionId: string, templateId: string) => void;
  toggleTemplateTimer: (sessionId: string, templateId: string) => void;
}

function hexEncode(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexDecode(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []);
  return new TextDecoder().decode(bytes);
}

function formatRecordLine(msg: NetMessage): string {
  const dir = msg.direction === 'send' ? 'SEND' : 'RECV';
  const time = new Date(msg.timestamp).toLocaleTimeString();
  const text = hexDecode(msg.data);
  const remote = msg.remoteAddress ? ` ${msg.remoteAddress}` : '';
  return `[${time}] ${dir}${remote}  ${text}`;
}

function writeToRecording(sessionId: string, msg: NetMessage): void {
  const recId = activeRecordings.get(sessionId);
  if (recId) {
    window.api.recording.write(recId, formatRecordLine(msg));
  }
}

export const useNetDebugStore = create<NetDebugStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  sessionUI: new Map(),
  sendTemplates: new Map(),

  createSession: async (protocol, host, port, localPort) => {
    try {
      const session = await window.api.net.create(protocol, host, port, localPort);
      set((state) => {
        const ui = new Map(state.sessionUI);
        ui.set(session.id, defaultUIState());
        return {
          sessions: [...state.sessions, session],
          activeSessionId: session.id,
          messages: new Map(state.messages).set(session.id, []),
          sessionUI: ui,
        };
      });

      // Listen for data
      window.api.net.onData((sid, hexData, remote) => {
        if (sid !== session.id) return;
        const msg: NetMessage = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          direction: 'recv',
          data: hexData,
          encoding: 'hex',
          timestamp: Date.now(),
          remoteAddress: remote,
        };
        // Stream to recording file if active
        writeToRecording(session.id, msg);
        set((state) => {
          const msgs = new Map(state.messages);
          const list = [...(msgs.get(session.id) || []), msg];
          msgs.set(session.id, list.slice(-500));
          return { messages: msgs };
        });
      });

      window.api.net.onClose((sid) => {
        if (sid !== session.id) return;
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === session.id ? { ...s, status: 'closed' as const } : s
          ),
        }));
      });

      window.api.net.onError((sid, error) => {
        if (sid !== session.id) return;
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === session.id ? { ...s, status: 'error' as const, error } : s
          ),
        }));
      });

      window.api.net.onClients((sid, clients) => {
        if (sid !== session.id) return;
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === session.id ? { ...s, clients } : s
          ),
        }));
      });
    } catch (err) {
      console.error('Failed to create net session:', err);
      throw err;
    }
  },

  closeSession: (sessionId) => {
    window.api.net.close(sessionId);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'closed' as const } : s
      ),
    }));
  },

  reopenSession: async (sessionId) => {
    const oldSession = get().sessions.find((s) => s.id === sessionId);
    if (!oldSession) return;
    try {
      const newSession = await window.api.net.create(oldSession.protocol, oldSession.host, oldSession.port, oldSession.localPort);
      // Migrate state maps from old ID to new ID
      set((state) => {
        const msgs = new Map(state.messages);
        const oldMsgs = msgs.get(sessionId) || [];
        msgs.delete(sessionId);
        msgs.set(newSession.id, oldMsgs);
        const ui = new Map(state.sessionUI);
        const oldUI = ui.get(sessionId) || defaultUIState();
        ui.delete(sessionId);
        ui.set(newSession.id, { ...oldUI, timerRunning: false, recording: false });
        const st = new Map(state.sendTemplates);
        const oldTpls = st.get(sessionId) || [];
        st.delete(sessionId);
        st.set(newSession.id, oldTpls);
        return {
          sessions: state.sessions.map((s) => s.id === sessionId ? newSession : s),
          activeSessionId: state.activeSessionId === sessionId ? newSession.id : state.activeSessionId,
          messages: msgs,
          sessionUI: ui,
          sendTemplates: st,
        };
      });

      // Re-register event listeners
      window.api.net.onData((sid, hexData, remote) => {
        if (sid !== newSession.id) return;
        const msg: NetMessage = {
          id: crypto.randomUUID(),
          sessionId: newSession.id,
          direction: 'recv',
          data: hexData,
          encoding: 'hex',
          timestamp: Date.now(),
          remoteAddress: remote,
        };
        writeToRecording(newSession.id, msg);
        set((state) => {
          const msgs = new Map(state.messages);
          const list = [...(msgs.get(newSession.id) || []), msg];
          msgs.set(newSession.id, list.slice(-500));
          return { messages: msgs };
        });
      });

      window.api.net.onClose((sid) => {
        if (sid !== newSession.id) return;
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === newSession.id ? { ...s, status: 'closed' as const } : s
          ),
        }));
      });

      window.api.net.onError((sid, error) => {
        if (sid !== newSession.id) return;
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === newSession.id ? { ...s, status: 'error' as const, error } : s
          ),
        }));
      });

      window.api.net.onClients((sid, clients) => {
        if (sid !== newSession.id) return;
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === newSession.id ? { ...s, clients } : s
          ),
        }));
      });
    } catch (err) {
      console.error('Failed to reopen net session:', err);
      throw err;
    }
  },

  removeSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (session && session.status !== 'closed') {
      window.api.net.close(sessionId);
    }
    // Stop timer if running
    const handle = timerHandles.get(sessionId);
    if (handle) { clearInterval(handle); timerHandles.delete(sessionId); }
    // Stop recording if active
    const recId = activeRecordings.get(sessionId);
    if (recId) { window.api.recording.stop(recId); activeRecordings.delete(sessionId); }
    // Stop all template timers
    const tpls = get().sendTemplates.get(sessionId) || [];
    for (const tpl of tpls) {
      const key = `${sessionId}:${tpl.id}`;
      const th = templateTimerHandles.get(key);
      if (th) { clearInterval(th); templateTimerHandles.delete(key); }
    }
    set((state) => {
      const msgs = new Map(state.messages);
      msgs.delete(sessionId);
      const ui = new Map(state.sessionUI);
      ui.delete(sessionId);
      const st = new Map(state.sendTemplates);
      st.delete(sessionId);
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        messages: msgs,
        sessionUI: ui,
        sendTemplates: st,
        activeSessionId: state.activeSessionId === sessionId
          ? (state.sessions.find((s) => s.id !== sessionId)?.id || null)
          : state.activeSessionId,
      };
    });
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  sendData: (sessionId, data, encoding, remoteAddress) => {
    const hexData = encoding === 'hex' ? data.replace(/\s/g, '') : hexEncode(data);
    window.api.net.send(sessionId, hexData, remoteAddress);

    const msg: NetMessage = {
      id: crypto.randomUUID(),
      sessionId,
      direction: 'send',
      data: hexData,
      encoding: 'hex',
      timestamp: Date.now(),
      remoteAddress,
    };
    // Stream to recording file if active
    writeToRecording(sessionId, msg);
    set((state) => {
      const msgs = new Map(state.messages);
      const list = [...(msgs.get(sessionId) || []), msg];
      msgs.set(sessionId, list.slice(-500));
      return { messages: msgs };
    });
  },

  clearMessages: (sessionId) => {
    set((state) => {
      const msgs = new Map(state.messages);
      msgs.set(sessionId, []);
      return { messages: msgs };
    });
  },

  updateSessionUI: (sessionId, patch) => {
    set((state) => {
      const ui = new Map(state.sessionUI);
      const prev = ui.get(sessionId) || defaultUIState();
      ui.set(sessionId, { ...prev, ...patch });
      return { sessionUI: ui };
    });
  },

  startTimer: (sessionId) => {
    const state = get();
    const ui = state.sessionUI.get(sessionId);
    if (!ui) return;
    const ms = parseInt(ui.timerInterval, 10);
    if (isNaN(ms) || ms < 10) return;

    // Send immediately
    if (ui.input.trim()) {
      const s = state.sessions.find((ss) => ss.id === sessionId);
      if (s) {
        const remote = s.protocol === 'tcp-server' && ui.targetClient ? ui.targetClient : undefined;
        get().sendData(sessionId, ui.input, ui.encoding, remote);
      }
    }

    const handle = setInterval(() => {
      const st = get();
      const uiNow = st.sessionUI.get(sessionId);
      if (!uiNow || !uiNow.input.trim()) return;
      const s = st.sessions.find((ss) => ss.id === sessionId);
      if (!s || (s.status !== 'connected' && s.status !== 'listening')) {
        // Auto-stop
        clearInterval(timerHandles.get(sessionId)!);
        timerHandles.delete(sessionId);
        get().updateSessionUI(sessionId, { timerRunning: false });
        return;
      }
      const remote = s.protocol === 'tcp-server' && uiNow.targetClient ? uiNow.targetClient : undefined;
      get().sendData(sessionId, uiNow.input, uiNow.encoding, remote);
    }, ms);

    timerHandles.set(sessionId, handle);
    get().updateSessionUI(sessionId, { timerRunning: true });
  },

  stopTimer: (sessionId) => {
    const handle = timerHandles.get(sessionId);
    if (handle) { clearInterval(handle); timerHandles.delete(sessionId); }
    get().updateSessionUI(sessionId, { timerRunning: false });
  },

  startRecording: async (sessionId, filePath) => {
    const recId = crypto.randomUUID();
    await window.api.recording.start(filePath, recId);
    activeRecordings.set(sessionId, recId);
    get().updateSessionUI(sessionId, { recording: true });
  },

  stopRecording: async (sessionId) => {
    const recId = activeRecordings.get(sessionId);
    if (recId) {
      await window.api.recording.stop(recId);
      activeRecordings.delete(sessionId);
    }
    get().updateSessionUI(sessionId, { recording: false });
  },

  addTemplate: (sessionId) => {
    const tpl: SendTemplate = {
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
    // Stop timer if running
    const key = `${sessionId}:${templateId}`;
    const h = templateTimerHandles.get(key);
    if (h) { clearInterval(h); templateTimerHandles.delete(key); }
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
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const ui = get().sessionUI.get(sessionId);
    const remote = session.protocol === 'tcp-server' && ui?.targetClient ? ui.targetClient : undefined;
    get().sendData(sessionId, tpl.data, tpl.encoding, remote);
  },

  toggleTemplateTimer: (sessionId, templateId) => {
    const key = `${sessionId}:${templateId}`;
    const existing = templateTimerHandles.get(key);
    if (existing) {
      clearInterval(existing);
      templateTimerHandles.delete(key);
      get().updateTemplate(sessionId, templateId, { enabled: false });
      return;
    }
    const tpls = get().sendTemplates.get(sessionId) || [];
    const tpl = tpls.find((t) => t.id === templateId);
    if (!tpl || !tpl.data.trim() || tpl.intervalMs < 10) return;
    // Send immediately
    get().sendTemplate(sessionId, templateId);
    const handle = setInterval(() => {
      const st = get();
      const s = st.sessions.find((ss) => ss.id === sessionId);
      if (!s || (s.status !== 'connected' && s.status !== 'listening')) {
        clearInterval(templateTimerHandles.get(key)!);
        templateTimerHandles.delete(key);
        get().updateTemplate(sessionId, templateId, { enabled: false });
        return;
      }
      get().sendTemplate(sessionId, templateId);
    }, tpl.intervalMs);
    templateTimerHandles.set(key, handle);
    get().updateTemplate(sessionId, templateId, { enabled: true });
  },
}));

export { hexDecode, hexEncode };
