import { create } from 'zustand';
import type { SerialSession, SerialConfig, SerialPortInfo, SerialMessage, NetDataEncoding } from '../../shared/types';

function hexEncode(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexDecode(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []);
  return new TextDecoder().decode(bytes);
}

export interface SerialStore {
  sessions: SerialSession[];
  activeSessionId: string | null;
  messages: Map<string, SerialMessage[]>;
  availablePorts: SerialPortInfo[];

  refreshPorts: () => Promise<void>;
  openPort: (config: SerialConfig) => Promise<void>;
  closePort: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  sendData: (sessionId: string, data: string, encoding: NetDataEncoding) => void;
  clearMessages: (sessionId: string) => void;
  setDTR: (sessionId: string, value: boolean) => void;
  setRTS: (sessionId: string, value: boolean) => void;
}

export const useSerialStore = create<SerialStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  availablePorts: [],

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
        set((state) => {
          const msgs = new Map(state.messages);
          const list = [...(msgs.get(session.id) || []), msg];
          msgs.set(session.id, list.slice(-500));
          return { messages: msgs };
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

  removeSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (session && session.status === 'open') {
      window.api.serial.close(sessionId);
    }
    set((state) => {
      const msgs = new Map(state.messages);
      msgs.delete(sessionId);
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        messages: msgs,
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
}));
