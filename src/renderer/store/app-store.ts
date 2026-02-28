import { create } from 'zustand';
import type {
  HostEntry,
  ConnectionGroup,
  SSHSession,
  TransferProgress
} from '../../shared/types';

export interface AppStore {
  // Connection management
  hosts: HostEntry[];
  groups: ConnectionGroup[];
  selectedHostId: string | null;

  // Session management
  sessions: SSHSession[];
  activeSessionId: string | null;

  // File transfer
  transfers: TransferProgress[];

  // UI state
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;
  splitPaneVisible: boolean;
  splitPaneRatio: number;
  commandHistoryVisible: boolean;
  timestampGutterVisible: boolean;

  // Command history: global list of commands (persisted, max 100)
  commandHistory: { cmd: string; ts: number; hostName?: string }[];

  // Remote CWD tracking per session (detected from terminal prompt)
  sessionCwdMap: Record<string, string>;

  // Actions — Connection
  loadHosts: () => Promise<void>;
  addHost: (entry: Omit<HostEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateHost: (id: string, updates: Partial<HostEntry>) => Promise<void>;
  removeHost: (id: string) => Promise<void>;
  selectHost: (id: string | null) => void;

  // Actions — Session
  connectToHost: (id: string, password?: string) => Promise<void>;
  disconnectSession: (sessionId: string) => Promise<void>;
  reconnectSession: (sessionId: string, password?: string) => Promise<void>;
  setActiveSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: SSHSession['status'], error?: string) => void;

  // Actions — Transfer
  addTransfer: (transfer: TransferProgress) => void;
  updateTransfer: (transferId: string, updates: Partial<TransferProgress>) => void;
  removeTransfer: (transferId: string) => void;

  // Actions — UI
  toggleTheme: () => void;
  toggleSidebar: () => void;
  toggleSplitPane: () => void;
  toggleCommandHistory: () => void;
  toggleTimestampGutter: () => void;
  setSplitPaneRatio: (ratio: number) => void;
  loadAppConfig: () => Promise<void>;
  addCommand: (sessionId: string, cmd: string) => void;
  loadCommandHistory: () => Promise<void>;
  setSessionCwd: (sessionId: string, cwd: string) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Initial state
  hosts: [],
  groups: [],
  selectedHostId: null,
  sessions: [],
  activeSessionId: null,
  transfers: [],
  theme: 'dark',
  sidebarCollapsed: false,
  splitPaneVisible: false,
  splitPaneRatio: 0.5,
  commandHistoryVisible: false,
  timestampGutterVisible: false,
  commandHistory: [],
  sessionCwdMap: {},

  // Connection actions
  loadHosts: async () => {
    try {
      const hosts = await window.api.config.getHosts();
      set({ hosts });
    } catch (err) {
      console.error('Failed to load hosts:', err);
    }
  },

  addHost: async (entry) => {
    try {
      const now = new Date().toISOString();
      const host: HostEntry = {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now
      };
      await window.api.config.saveHost(host);
      set((state) => ({ hosts: [...state.hosts, host] }));
    } catch (err) {
      console.error('Failed to add host:', err);
      throw err;
    }
  },

  updateHost: async (id, updates) => {
    try {
      const host = get().hosts.find((h) => h.id === id);
      if (!host) return;
      const updated = { ...host, ...updates, updatedAt: new Date().toISOString() };
      await window.api.config.saveHost(updated);
      set((state) => ({
        hosts: state.hosts.map((h) => (h.id === id ? updated : h))
      }));
    } catch (err) {
      console.error('Failed to update host:', err);
      throw err;
    }
  },

  removeHost: async (id) => {
    try {
      await window.api.config.deleteHost(id);
      set((state) => ({
        hosts: state.hosts.filter((h) => h.id !== id),
        selectedHostId: state.selectedHostId === id ? null : state.selectedHostId
      }));
    } catch (err) {
      console.error('Failed to remove host:', err);
      throw err;
    }
  },

  selectHost: (id) => set({ selectedHostId: id }),

  // Session actions
  connectToHost: async (id, password) => {
    const host = get().hosts.find((h) => h.id === id);
    if (!host) throw new Error('Host not found');

    try {
      const session = await window.api.ssh.connect(host, password);
      set((state) => ({
        sessions: [...state.sessions, session],
        activeSessionId: session.id
      }));

      // Listen for session close
      window.api.ssh.onClose(session.id, () => {
        get().updateSessionStatus(session.id, 'disconnected');
      });

      window.api.ssh.onError(session.id, (error) => {
        get().updateSessionStatus(session.id, 'error', error);
      });
    } catch (err) {
      console.error('Failed to connect:', err);
      throw err;
    }
  },

  disconnectSession: async (sessionId) => {
    try {
      await window.api.ssh.disconnect(sessionId);
      get().updateSessionStatus(sessionId, 'disconnected');
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  },

  reconnectSession: async (sessionId, password) => {
    const state = get();
    const oldSession = state.sessions.find((s) => s.id === sessionId);
    if (!oldSession) throw new Error('Session not found');

    // Mark as connecting
    get().updateSessionStatus(sessionId, 'connecting');

    try {
      // Backend reconnect: reuses same sessionId, creates new Client + shell
      await window.api.ssh.reconnect(sessionId, password);

      // Update session status — terminal is still alive, data flows through existing callbacks
      get().updateSessionStatus(sessionId, 'connected');
    } catch (err) {
      get().updateSessionStatus(sessionId, 'error', err instanceof Error ? err.message : String(err));
      throw err;
    }
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId);
      return {
        sessions,
        activeSessionId:
          state.activeSessionId === sessionId
            ? sessions[sessions.length - 1]?.id || null
            : state.activeSessionId
      };
    }),

  updateSessionStatus: (sessionId, status, error) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status, error } : s
      )
    })),

  // Transfer actions
  addTransfer: (transfer) =>
    set((state) => {
      // Skip if already exists (may have been auto-created by upsert from progress event)
      if (state.transfers.some((t) => t.transferId === transfer.transferId)) {
        return state;
      }
      return { transfers: [...state.transfers, transfer] };
    }),

  updateTransfer: (transferId, updates) =>
    set((state) => {
      const exists = state.transfers.some((t) => t.transferId === transferId);
      if (exists) {
        return {
          transfers: state.transfers.map((t) =>
            t.transferId === transferId ? { ...t, ...updates } : t
          )
        };
      }
      // Auto-create if progress arrives before addTransfer (race with fastPut/fastGet)
      const newTransfer: TransferProgress = {
        transferId,
        filename: (updates as any).filename || 'unknown',
        direction: (updates as any).direction || 'download',
        bytesTransferred: (updates as any).bytesTransferred || 0,
        totalBytes: (updates as any).totalBytes || 0,
        speed: (updates as any).speed || 0,
        status: (updates as any).status || 'transferring',
        ...updates
      };
      return { transfers: [...state.transfers, newTransfer] };
    }),

  removeTransfer: (transferId) =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.transferId !== transferId)
    })),

  // UI actions
  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    set({ theme: newTheme });
    window.api.config.setAppConfig({ theme: newTheme });
    document.documentElement.classList.toggle('light', newTheme === 'light');
    if (newTheme === 'light') {
      window.api.theme.updateTitlebar('#c9cfcb', '#4a524d');
    } else {
      window.api.theme.updateTitlebar('#141525', '#9ca3af');
    }
  },

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  toggleSplitPane: () =>
    set((state) => ({ splitPaneVisible: !state.splitPaneVisible })),

  toggleCommandHistory: () =>
    set((state) => ({ commandHistoryVisible: !state.commandHistoryVisible })),

  toggleTimestampGutter: () =>
    set((state) => ({ timestampGutterVisible: !state.timestampGutterVisible })),

  setSplitPaneRatio: (ratio) => set({ splitPaneRatio: ratio }),

  addCommand: (sessionId, cmd) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    const state = get();
    const prev = state.commandHistory;
    // Deduplicate consecutive identical commands
    if (prev.length > 0 && prev[prev.length - 1].cmd === trimmed) return;
    // Get host name for display
    const session = state.sessions.find((s) => s.id === sessionId);
    const host = session ? state.hosts.find((h) => h.id === session.hostEntryId) : null;
    const hostName = host?.name || 'Unknown';
    const newHistory = [...prev, { cmd: trimmed, ts: Date.now(), hostName }].slice(-100);
    set({ commandHistory: newHistory });
    // Persist async (include hostName for display after reload)
    window.api.config.setCommandHistory(newHistory);
  },

  loadCommandHistory: async () => {
    try {
      const history = await window.api.config.getCommandHistory();
      set({ commandHistory: history.slice(-100) });
    } catch (err) {
      console.error('Failed to load command history:', err);
    }
  },

  loadAppConfig: async () => {
    try {
      const config = await window.api.config.getAppConfig();
      set({
        theme: config.theme,
        sidebarCollapsed: config.sidebarCollapsed
      });
      document.documentElement.classList.toggle('light', config.theme === 'light');
      if (config.theme === 'light') {
        window.api.theme.updateTitlebar('#c9cfcb', '#4a524d');
      } else {
        window.api.theme.updateTitlebar('#141525', '#9ca3af');
      }
    } catch (err) {
      console.error('Failed to load app config:', err);
    }
  },

  setSessionCwd: (sessionId, cwd) => {
    set((state) => ({
      sessionCwdMap: { ...state.sessionCwdMap, [sessionId]: cwd }
    }));
  }
}));
