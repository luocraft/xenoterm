import { create } from 'zustand';
import type { NetSession, NetProtocol, NetMessage, NetDataEncoding } from '../../shared/types';

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

export interface NetDebugStore {
  sessions: NetSession[];
  activeSessionId: string | null;
  messages: Map<string, NetMessage[]>;
  sessionUI: Map<string, SessionUIState>;

  createSession: (protocol: NetProtocol, host: string, port: number, localPort?: number) => Promise<void>;
  closeSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  sendData: (sessionId: string, data: string, encoding: NetDataEncoding, remoteAddress?: string) => void;
  clearMessages: (sessionId: string) => void;
  updateSessionUI: (sessionId: string, patch: Partial<SessionUIState>) => void;
  startTimer: (sessionId: string) => void;
  stopTimer: (sessionId: string) => void;
  startRecording: (sessionId: string, filePath: string) => Promise<void>;
  stopRecording: (sessionId: string) => Promise<void>;
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
      window.api.net.onData(session.id, (hexData, remote) => {
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

      window.api.net.onClose(session.id, () => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === session.id ? { ...s, status: 'closed' as const } : s
          ),
        }));
      });

      window.api.net.onError(session.id, (error) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === session.id ? { ...s, status: 'error' as const, error } : s
          ),
        }));
      });

      window.api.net.onClients(session.id, (clients) => {
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
    set((state) => {
      const msgs = new Map(state.messages);
      msgs.delete(sessionId);
      const ui = new Map(state.sessionUI);
      ui.delete(sessionId);
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        messages: msgs,
        sessionUI: ui,
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
}));

export { hexDecode, hexEncode };
