import { create } from 'zustand';
import type { NetSession, NetProtocol, NetMessage, NetDataEncoding } from '../../shared/types';

export interface NetDebugStore {
  sessions: NetSession[];
  activeSessionId: string | null;
  messages: Map<string, NetMessage[]>;

  createSession: (protocol: NetProtocol, host: string, port: number, localPort?: number) => Promise<void>;
  closeSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  sendData: (sessionId: string, data: string, encoding: NetDataEncoding, remoteAddress?: string) => void;
  clearMessages: (sessionId: string) => void;
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

export const useNetDebugStore = create<NetDebugStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),

  createSession: async (protocol, host, port, localPort) => {
    try {
      const session = await window.api.net.create(protocol, host, port, localPort);
      set((state) => ({
        sessions: [...state.sessions, session],
        activeSessionId: session.id,
        messages: new Map(state.messages).set(session.id, []),
      }));

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
}));

export { hexDecode, hexEncode };
