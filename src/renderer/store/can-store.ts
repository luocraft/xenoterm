import { create } from 'zustand';
import type { CanFrame } from '../../main/services/can/can-driver.interface';
import type { DbcDatabase, DbcSignal } from '../../main/services/can/dbc-parser';

export interface CanSession {
  id: string;
  driverName: string;
  deviceType: number;
  deviceIndex: number;
  channel: number;
  baudRate: number;
  status: 'connected' | 'closed' | 'error';
  error?: string;
}

export interface CanMessageRow {
  seq: number;
  frame: CanFrame;
  messageName?: string; // from DBC
}

export interface MonitoredSignal {
  sessionId: string;
  messageId: number;
  extended: boolean;
  signal: DbcSignal;
  value: number;
  history: { t: number; v: number }[]; // for chart — last N data points
}

export interface SendListItem {
  id: string;
  canId: string;
  dlc: number;
  data: string;
  extended: boolean;
  fd: boolean;
  brs: boolean;
  intervalMs: number;
  enabled: boolean;
}

export interface MessageStats {
  canId: number;
  extended: boolean;
  name?: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  fps: number;
  lastData: number[];
  lastDlc: number;
}

export interface CanSessionUI {
  // Send panel
  sendId: string;
  sendDlc: string;
  sendData: string;
  sendExtended: boolean;
  sendFd: boolean;
  sendBrs: boolean;
  timerInterval: string;
  timerRunning: boolean;
  // Filter
  idFilter: string;
  // Scroll
  autoScroll: boolean;
  // Message filter
  messageFilter: 'all' | 'tx' | 'rx';
  // Recording
  recording: boolean;
  // View mode
  viewMode: 'trace' | 'stats' | 'j1939' | 'uds';
  // Send list
  sendList: SendListItem[];
}

/** Valid CAN FD data lengths */
const FD_DATA_LENGTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];

/** Map a desired byte count to the nearest valid FD data length (round up) */
function fdNearestLength(len: number): number {
  for (const v of FD_DATA_LENGTHS) {
    if (v >= len) return v;
  }
  return 64;
}

const defaultCanUI = (): CanSessionUI => ({
  sendId: '',
  sendDlc: '8',
  sendData: '',
  sendExtended: false,
  sendFd: false,
  sendBrs: false,
  timerInterval: '100',
  timerRunning: false,
  idFilter: '',
  autoScroll: true,
  messageFilter: 'all',
  recording: false,
  viewMode: 'trace',
  sendList: [],
});

const MAX_MESSAGES = 5000;

/** Timer handles — survive tab switches */
const timerHandles = new Map<string, ReturnType<typeof setInterval>>();
/** Send list timers — key: `${sessionId}:${itemId}` */
const sendListTimers = new Map<string, ReturnType<typeof setInterval>>();
/** Recording IDs */
const activeRecordings = new Map<string, string>();
/** Bus load tracking — frame count per second window */
const busLoadCounters = new Map<string, { count: number; lastReset: number }>();

/** Increment bus load frame counter (called for both TX and RX) */
function bumpBusLoad(sessionId: string, frameCount: number): void {
  const blc = busLoadCounters.get(sessionId) || { count: 0, lastReset: Date.now() };
  blc.count += frameCount;
  busLoadCounters.set(sessionId, blc);
}

/** Calculate and update bus load state if enough time has elapsed */
function updateBusLoadState(sessionId: string, set: Function, get: Function): void {
  const blc = busLoadCounters.get(sessionId);
  if (!blc) return;
  const elapsed = Date.now() - blc.lastReset;
  if (elapsed < 1000) return;
  const bitsPerFrame = 111;
  const state = get();
  const sess = state.sessions.find((s: CanSession) => s.id === sessionId);
  const baud = sess?.baudRate || 500000;
  const load = (blc.count * bitsPerFrame / (elapsed / 1000)) / baud * 100;
  const bl = new Map(state.busLoad);
  bl.set(sessionId, Math.min(100, load));
  blc.count = 0;
  blc.lastReset = Date.now();
  busLoadCounters.set(sessionId, blc);
  set({ busLoad: bl });
}
/** Session start time for relative timestamp display */
const sessionStartTime = new Map<string, number>();

/** Get session start time for relative timestamp display */
export function getSessionStartTime(sessionId: string): number {
  return sessionStartTime.get(sessionId) || 0;
}

const SIGNAL_HISTORY_MAX = 1000;

export interface CanDebugStore {
  sessions: CanSession[];
  activeSessionId: string | null;
  messages: Map<string, CanMessageRow[]>;
  sessionUI: Map<string, CanSessionUI>;
  seqCounters: Map<string, number>;

  // DBC
  dbc: DbcDatabase | null;
  monitoredSignals: MonitoredSignal[];
  // Stats
  messageStats: Map<string, Map<number, MessageStats>>; // sessionId → canId → stats
  busLoad: Map<string, number>; // sessionId → load %

  // Actions
  openDevice: (driverName: string, deviceType: number, deviceIndex: number, channel: number, baudRate: number, fdConfig?: { protocol?: number; mode?: number; dataBaudRate?: number; nonIso?: boolean; ch1BaudRate?: number; ch1DataBaudRate?: number }) => Promise<void>;
  closeDevice: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (id: string | null) => void;
  clearMessages: (sessionId: string) => void;
  updateSessionUI: (sessionId: string, patch: Partial<CanSessionUI>) => void;

  // DBC
  loadDbc: (content: string) => Promise<void>;
  unloadDbc: () => void;
  addMonitorSignal: (sessionId: string, messageId: number, extended: boolean, signal: DbcSignal) => void;
  removeMonitorSignal: (signalName: string, messageId: number, sessionId?: string) => void;

  // Send
  sendFrame: (sessionId: string) => void;
  startTimer: (sessionId: string) => void;
  stopTimer: (sessionId: string) => void;

  // Send list
  addSendListItem: (sessionId: string) => void;
  removeSendListItem: (sessionId: string, itemId: string) => void;
  updateSendListItem: (sessionId: string, itemId: string, patch: Partial<SendListItem>) => void;
  toggleSendListItem: (sessionId: string, itemId: string) => void;
  sendListItemOnce: (sessionId: string, itemId: string) => void;

  // Recording
  startRecording: (sessionId: string, filePath: string) => Promise<void>;
  stopRecording: (sessionId: string) => Promise<void>;

  // ASC replay
  replayAsc: (sessionId: string, content: string) => void;
}

function formatAscLine(frame: CanFrame, seq: number, sessionId?: string): string {
  const startTime = sessionId ? (sessionStartTime.get(sessionId) || 0) : 0;
  const ts = ((frame.timestamp - startTime) / 1000).toFixed(6);
  const dir = frame.direction === 'tx' ? 'Tx' : 'Rx';
  const idHex = frame.id.toString(16).toUpperCase();
  const ext = frame.extended ? 'x' : '';
  const dataHex = frame.data.slice(0, frame.dlc).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  return `${ts} 1 ${idHex}${ext} ${dir} d ${frame.dlc} ${dataHex}`;
}

function writeCanRecording(sessionId: string, frame: CanFrame, seq: number): void {
  const recId = activeRecordings.get(sessionId);
  if (recId) {
    window.api.recording.write(recId, formatAscLine(frame, seq, sessionId));
  }
}

export const useCanDebugStore = create<CanDebugStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  sessionUI: new Map(),
  seqCounters: new Map(),
  dbc: null,
  monitoredSignals: [],
  messageStats: new Map(),
  busLoad: new Map(),

  openDevice: async (driverName, deviceType, deviceIndex, channel, baudRate, fdConfig) => {
    const result = await window.api.can.open(driverName, deviceType, deviceIndex, channel, baudRate, fdConfig);
    const sessions = Array.isArray(result) ? result : [result];

    for (const session of sessions) {
      const sessionId = session.id;

      set((state) => {
        const ui = new Map(state.sessionUI);
        ui.set(sessionId, defaultCanUI());
        sessionStartTime.set(sessionId, Date.now());
        return {
          sessions: [...state.sessions, { ...session, status: 'connected' as const } as CanSession],
          activeSessionId: sessionId,
          messages: new Map(state.messages).set(sessionId, []),
          sessionUI: ui,
          seqCounters: new Map(state.seqCounters).set(sessionId, 0),
        };
      });

      // Listen for CAN data (batch)
      window.api.can.onData(sessionId, (frames: CanFrame[]) => {
      // Bus load tracking
      bumpBusLoad(sessionId, frames.length);
      const blc = busLoadCounters.get(sessionId)!;
      const elapsed = Date.now() - blc.lastReset;

      set((state) => {
        const msgs = new Map(state.messages);
        const seqs = new Map(state.seqCounters);
        let seq = seqs.get(sessionId) || 0;
        const existing = msgs.get(sessionId) || [];
        const db = state.dbc;

        const newRows: CanMessageRow[] = frames.map((f) => {
          seq++;
          writeCanRecording(sessionId, f, seq);
          const msgDef = db ? db.messages.find((m) => m.id === f.id && m.extended === f.extended) : undefined;
          return { seq, frame: f, messageName: msgDef?.name };
        });

        const combined = [...existing, ...newRows];
        msgs.set(sessionId, combined.length > MAX_MESSAGES ? combined.slice(-MAX_MESSAGES) : combined);
        seqs.set(sessionId, seq);

        // Update message stats
        const allStats = new Map(state.messageStats);
        const sessionStats = new Map(allStats.get(sessionId) || new Map());
        const now = Date.now();
        for (const f of frames) {
          const key = f.id;
          const prev = sessionStats.get(key);
          if (prev) {
            const dt = (now - prev.lastSeen) / 1000;
            const alpha = 0.3;
            const instantFps = dt > 0 ? 1 / dt : prev.fps;
            prev.fps = prev.fps > 0 ? alpha * instantFps + (1 - alpha) * prev.fps : instantFps;
            prev.count++;
            prev.lastSeen = now;
            prev.lastData = f.data.slice(0, f.dlc);
            prev.lastDlc = f.dlc;
          } else {
            const msgDef = db ? db.messages.find((m) => m.id === f.id && m.extended === f.extended) : undefined;
            sessionStats.set(key, {
              canId: f.id, extended: f.extended, name: msgDef?.name,
              count: 1, firstSeen: now, lastSeen: now, fps: 0,
              lastData: f.data.slice(0, f.dlc), lastDlc: f.dlc,
            });
          }
        }
        allStats.set(sessionId, sessionStats);

        // Bus load: calculate every second
        const bl = new Map(state.busLoad);
        if (elapsed >= 1000) {
          // Approximate: each standard CAN frame ≈ 111 bits at max
          const bitsPerFrame = 111;
          const sess = state.sessions.find((s) => s.id === sessionId);
          const baud = sess?.baudRate || 500000;
          const load = (blc.count * bitsPerFrame / (elapsed / 1000)) / baud * 100;
          bl.set(sessionId, Math.min(100, load));
          blc.count = 0;
          blc.lastReset = Date.now();
          busLoadCounters.set(sessionId, blc);
        }

        // Update monitored signals with history (only for this session)
        const monitored = state.monitoredSignals.map((ms) => {
          if (ms.sessionId !== sessionId) return ms;
          const latestFrame = frames.findLast((f) => f.id === ms.messageId && f.extended === ms.extended);
          if (latestFrame) {
            const raw = extractRaw(latestFrame.data, ms.signal);
            const val = applySignedAndScale(raw, ms.signal);
            const history = [...ms.history, { t: now, v: val }];
            if (history.length > SIGNAL_HISTORY_MAX) history.splice(0, history.length - SIGNAL_HISTORY_MAX);
            return { ...ms, value: val, history };
          }
          return ms;
        });

        return { messages: msgs, seqCounters: seqs, monitoredSignals: monitored, messageStats: allStats, busLoad: bl };
      });
    });

    window.api.can.onError(sessionId, (error: string) => {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, status: 'error' as const, error } : s
        ),
      }));
    });
    } // end for loop over sessions
  },

  closeDevice: (sessionId) => {
    window.api.can.close(sessionId);
    // Stop timer
    const handle = timerHandles.get(sessionId);
    if (handle) { clearInterval(handle); timerHandles.delete(sessionId); }
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'closed' as const } : s
      ),
    }));
  },

  removeSession: (sessionId) => {
    const s = get().sessions.find((ss) => ss.id === sessionId);
    if (s && s.status === 'connected') window.api.can.close(sessionId);
    const handle = timerHandles.get(sessionId);
    if (handle) { clearInterval(handle); timerHandles.delete(sessionId); }
    const recId = activeRecordings.get(sessionId);
    if (recId) { window.api.recording.stop(recId); activeRecordings.delete(sessionId); }
    sessionStartTime.delete(sessionId);
    set((state) => {
      const msgs = new Map(state.messages);
      msgs.delete(sessionId);
      const ui = new Map(state.sessionUI);
      ui.delete(sessionId);
      const seqs = new Map(state.seqCounters);
      seqs.delete(sessionId);
      return {
        sessions: state.sessions.filter((ss) => ss.id !== sessionId),
        messages: msgs,
        sessionUI: ui,
        seqCounters: seqs,
        activeSessionId: state.activeSessionId === sessionId
          ? (state.sessions.find((ss) => ss.id !== sessionId)?.id || null)
          : state.activeSessionId,
      };
    });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  clearMessages: (sessionId) => {
    sessionStartTime.set(sessionId, Date.now());
    set((state) => {
      const msgs = new Map(state.messages);
      msgs.set(sessionId, []);
      const seqs = new Map(state.seqCounters);
      seqs.set(sessionId, 0);
      return { messages: msgs, seqCounters: seqs };
    });
  },

  updateSessionUI: (sessionId, patch) => {
    set((state) => {
      const ui = new Map(state.sessionUI);
      const prev = ui.get(sessionId) || defaultCanUI();
      ui.set(sessionId, { ...prev, ...patch });
      return { sessionUI: ui };
    });
  },

  loadDbc: async (content) => {
    const db = await window.api.can.parseDbc(content);
    set({ dbc: db, monitoredSignals: [] });
  },

  unloadDbc: () => set({ dbc: null, monitoredSignals: [] }),

  addMonitorSignal: (sessionId, messageId, extended, signal) => {
    set((state) => {
      const exists = state.monitoredSignals.some(
        (ms) => ms.sessionId === sessionId && ms.messageId === messageId && ms.signal.name === signal.name
      );
      if (exists) return state;
      return {
        monitoredSignals: [...state.monitoredSignals, { sessionId, messageId, extended, signal, value: 0, history: [] }],
      };
    });
  },

  removeMonitorSignal: (signalName, messageId, sessionId) => {
    set((state) => ({
      monitoredSignals: state.monitoredSignals.filter(
        (ms) => !(ms.signal.name === signalName && ms.messageId === messageId && (!sessionId || ms.sessionId === sessionId))
      ),
    }));
  },

  sendFrame: (sessionId) => {
    const ui = get().sessionUI.get(sessionId);
    if (!ui) return;
    const id = parseInt(ui.sendId, 16);
    if (isNaN(id)) return;
    const dlc = parseInt(ui.sendDlc, 10);
    const parsedBytes = ui.sendData.replace(/\s/g, '').match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) || [];
    const maxLen = ui.sendFd ? fdNearestLength(dlc) : Math.min(dlc, 8);
    const dataBytes = [...parsedBytes.slice(0, maxLen), ...new Array(Math.max(0, maxLen - parsedBytes.length)).fill(0)];
    window.api.can.send(sessionId, {
      id,
      extended: ui.sendExtended,
      remote: false,
      dlc: maxLen,
      data: dataBytes,
      timestamp: 0,
      direction: 'tx',
      fd: ui.sendFd || undefined,
      brs: ui.sendBrs || undefined,
    });

    // Add TX frame to message list so it shows in the display
    const txFrame: CanFrame = {
      id,
      extended: ui.sendExtended,
      remote: false,
      dlc: maxLen,
      data: dataBytes,
      timestamp: Date.now(),
      direction: 'tx',
      fd: ui.sendFd || undefined,
      brs: ui.sendBrs || undefined,
    };
    bumpBusLoad(sessionId, 1);
    set((state) => {
      const msgs = new Map(state.messages);
      const seqs = new Map(state.seqCounters);
      let seq = seqs.get(sessionId) || 0;
      seq++;
      const existing = msgs.get(sessionId) || [];
      const db = state.dbc;
      const msgDef = db ? db.messages.find((m) => m.id === txFrame.id && m.extended === txFrame.extended) : undefined;
      const row: CanMessageRow = { seq, frame: txFrame, messageName: msgDef?.name };
      writeCanRecording(sessionId, txFrame, seq);
      const combined = [...existing, row];
      msgs.set(sessionId, combined.length > MAX_MESSAGES ? combined.slice(-MAX_MESSAGES) : combined);
      seqs.set(sessionId, seq);
      return { messages: msgs, seqCounters: seqs };
    });
    updateBusLoadState(sessionId, set, get);
  },

  startTimer: (sessionId) => {
    const ui = get().sessionUI.get(sessionId);
    if (!ui) return;
    const ms = parseInt(ui.timerInterval, 10);
    if (isNaN(ms) || ms < 1) return;
    get().sendFrame(sessionId);
    const handle = setInterval(() => {
      const st = get();
      const s = st.sessions.find((ss) => ss.id === sessionId);
      if (!s || s.status !== 'connected') {
        clearInterval(timerHandles.get(sessionId)!);
        timerHandles.delete(sessionId);
        get().updateSessionUI(sessionId, { timerRunning: false });
        return;
      }
      get().sendFrame(sessionId);
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
    // Write ASC header
    window.api.recording.write(recId, 'date ' + new Date().toLocaleString());
    window.api.recording.write(recId, 'base hex  timestamps absolute');
    window.api.recording.write(recId, 'no internal events logged');
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

  // Send list
  addSendListItem: (sessionId) => {
    const item: SendListItem = {
      id: crypto.randomUUID(),
      canId: '100',
      dlc: 8,
      data: '00 00 00 00 00 00 00 00',
      extended: false,
      fd: false,
      brs: false,
      intervalMs: 100,
      enabled: false,
    };
    set((state) => {
      const ui = new Map(state.sessionUI);
      const prev = ui.get(sessionId) || defaultCanUI();
      ui.set(sessionId, { ...prev, sendList: [...prev.sendList, item] });
      return { sessionUI: ui };
    });
  },

  removeSendListItem: (sessionId, itemId) => {
    // Stop timer if running
    const key = `${sessionId}:${itemId}`;
    const h = sendListTimers.get(key);
    if (h) { clearInterval(h); sendListTimers.delete(key); }
    set((state) => {
      const ui = new Map(state.sessionUI);
      const prev = ui.get(sessionId) || defaultCanUI();
      ui.set(sessionId, { ...prev, sendList: prev.sendList.filter((i) => i.id !== itemId) });
      return { sessionUI: ui };
    });
  },

  updateSendListItem: (sessionId, itemId, patch) => {
    set((state) => {
      const ui = new Map(state.sessionUI);
      const prev = ui.get(sessionId) || defaultCanUI();
      ui.set(sessionId, {
        ...prev,
        sendList: prev.sendList.map((i) => i.id === itemId ? { ...i, ...patch } : i),
      });
      return { sessionUI: ui };
    });
  },

  toggleSendListItem: (sessionId, itemId) => {
    const state = get();
    const ui = state.sessionUI.get(sessionId);
    if (!ui) return;
    const item = ui.sendList.find((i) => i.id === itemId);
    if (!item) return;
    const key = `${sessionId}:${itemId}`;

    if (item.enabled) {
      // Stop
      const h = sendListTimers.get(key);
      if (h) { clearInterval(h); sendListTimers.delete(key); }
      get().updateSendListItem(sessionId, itemId, { enabled: false });
    } else {
      // Start
      const sendOne = () => {
        const st = get();
        const s = st.sessions.find((ss) => ss.id === sessionId);
        if (!s || s.status !== 'connected') {
          clearInterval(sendListTimers.get(key)!);
          sendListTimers.delete(key);
          get().updateSendListItem(sessionId, itemId, { enabled: false });
          return;
        }
        const it = st.sessionUI.get(sessionId)?.sendList.find((i) => i.id === itemId);
        if (!it) return;
        const id = parseInt(it.canId, 16);
        if (isNaN(id)) return;
        const dataBytes = it.data.replace(/\s/g, '').match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) || [];
        const maxLen = it.fd ? fdNearestLength(it.dlc) : Math.min(it.dlc, 8);
        const txFrame: CanFrame = {
          id, extended: it.extended, remote: false,
          dlc: maxLen, data: [...dataBytes.slice(0, maxLen), ...new Array(Math.max(0, maxLen - dataBytes.length)).fill(0)],
          timestamp: Date.now(), direction: 'tx',
          fd: it.fd || undefined, brs: it.brs || undefined,
        };
        window.api.can.send(sessionId, txFrame);
        bumpBusLoad(sessionId, 1);
        // Add TX frame to message list
        set((state2) => {
          const msgs = new Map(state2.messages);
          const seqs = new Map(state2.seqCounters);
          let seq = seqs.get(sessionId) || 0;
          seq++;
          const existing = msgs.get(sessionId) || [];
          const db = state2.dbc;
          const msgDef = db ? db.messages.find((m) => m.id === txFrame.id && m.extended === txFrame.extended) : undefined;
          const row: CanMessageRow = { seq, frame: txFrame, messageName: msgDef?.name };
          writeCanRecording(sessionId, txFrame, seq);
          const combined = [...existing, row];
          msgs.set(sessionId, combined.length > MAX_MESSAGES ? combined.slice(-MAX_MESSAGES) : combined);
          seqs.set(sessionId, seq);
          return { messages: msgs, seqCounters: seqs };
        });
        updateBusLoadState(sessionId, set, get);
      };
      sendOne();
      const h = setInterval(sendOne, item.intervalMs);
      sendListTimers.set(key, h);
      get().updateSendListItem(sessionId, itemId, { enabled: true });
    }
  },

  sendListItemOnce: (sessionId, itemId) => {
    const st = get();
    const s = st.sessions.find((ss) => ss.id === sessionId);
    if (!s || s.status !== 'connected') return;
    const it = st.sessionUI.get(sessionId)?.sendList.find((i) => i.id === itemId);
    if (!it) return;
    const id = parseInt(it.canId, 16);
    if (isNaN(id)) return;
    const parsedBytes = it.data.replace(/\s/g, '').match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) || [];
    const maxLen = it.fd ? fdNearestLength(it.dlc) : Math.min(it.dlc, 8);
    const dataBytes = [...parsedBytes.slice(0, maxLen), ...new Array(Math.max(0, maxLen - parsedBytes.length)).fill(0)];
    const txFrame: CanFrame = {
      id, extended: it.extended, remote: false,
      dlc: maxLen, data: dataBytes,
      timestamp: Date.now(), direction: 'tx',
      fd: it.fd || undefined, brs: it.brs || undefined,
    };
    window.api.can.send(sessionId, txFrame);
    bumpBusLoad(sessionId, 1);
    set((state2) => {
      const msgs = new Map(state2.messages);
      const seqs = new Map(state2.seqCounters);
      let seq = seqs.get(sessionId) || 0;
      seq++;
      const existing = msgs.get(sessionId) || [];
      const db = state2.dbc;
      const msgDef = db ? db.messages.find((m) => m.id === txFrame.id && m.extended === txFrame.extended) : undefined;
      const row: CanMessageRow = { seq, frame: txFrame, messageName: msgDef?.name };
      writeCanRecording(sessionId, txFrame, seq);
      const combined = [...existing, row];
      msgs.set(sessionId, combined.length > MAX_MESSAGES ? combined.slice(-MAX_MESSAGES) : combined);
      seqs.set(sessionId, seq);
      return { messages: msgs, seqCounters: seqs };
    });
    updateBusLoadState(sessionId, set, get);
  },

  // ASC replay
  replayAsc: (sessionId, content) => {
    const lines = content.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('date') && !l.startsWith('base') && !l.startsWith('no '));
    const frames: { delay: number; frame: CanFrame }[] = [];
    let prevTs = -1;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 7) continue;
      const ts = parseFloat(parts[0]);
      if (isNaN(ts)) continue;
      const idStr = parts[2];
      const ext = idStr.endsWith('x');
      const id = parseInt(ext ? idStr.slice(0, -1) : idStr, 16);
      if (isNaN(id)) continue;
      const dir = parts[3].toLowerCase() === 'tx' ? 'tx' as const : 'rx' as const;
      const dlc = parseInt(parts[5], 10) || 0;
      const data: number[] = [];
      for (let i = 6; i < 6 + dlc && i < parts.length; i++) {
        data.push(parseInt(parts[i], 16) || 0);
      }
      const delay = prevTs < 0 ? 0 : Math.max(0, (ts - prevTs) * 1000);
      prevTs = ts;
      frames.push({ delay, frame: { id, extended: ext, remote: false, dlc, data, timestamp: ts * 1000, direction: dir } });
    }
    // Replay with timing
    let idx = 0;
    const playNext = () => {
      if (idx >= frames.length) return;
      const { delay, frame } = frames[idx++];
      setTimeout(() => {
        set((state) => {
          const msgs = new Map(state.messages);
          const seqs = new Map(state.seqCounters);
          let seq = seqs.get(sessionId) || 0;
          seq++;
          const existing = msgs.get(sessionId) || [];
          const db = state.dbc;
          const msgDef = db ? db.messages.find((m) => m.id === frame.id && m.extended === frame.extended) : undefined;
          const combined = [...existing, { seq, frame, messageName: msgDef?.name }];
          msgs.set(sessionId, combined.length > MAX_MESSAGES ? combined.slice(-MAX_MESSAGES) : combined);
          seqs.set(sessionId, seq);
          return { messages: msgs, seqCounters: seqs };
        });
        playNext();
      }, delay);
    };
    playNext();
  },
}));

// Inline signal decode helpers (avoid importing from main process in renderer)
function extractRaw(data: number[], signal: DbcSignal): number {
  const { startBit, bitLength, byteOrder } = signal;
  if (byteOrder === 'little_endian') {
    let value = 0;
    for (let i = 0; i < bitLength; i++) {
      const bitPos = startBit + i;
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        value |= ((data[byteIdx] >> bitIdx) & 1) << i;
      }
    }
    return value;
  } else {
    let value = 0;
    let bitPos = startBit;
    for (let i = bitLength - 1; i >= 0; i--) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        value |= ((data[byteIdx] >> bitIdx) & 1) << i;
      }
      if (bitIdx === 0) bitPos += 15;
      else bitPos -= 1;
    }
    return value;
  }
}

function applySignedAndScale(rawValue: number, signal: DbcSignal): number {
  let v = rawValue;
  if (signal.valueType === 'signed' && signal.bitLength > 0 && signal.bitLength < 32) {
    const signBit = 1 << (signal.bitLength - 1);
    if (v & signBit) v = v - (1 << signal.bitLength);
  }
  return v * signal.factor + signal.offset;
}
