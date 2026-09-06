import { create } from 'zustand';
import type { CanFrame } from '../../../main/services/can/can-driver.interface';
import type { DbcDatabase, DbcSignal } from '../../../main/services/can/dbc-parser';

export interface CanSession {
  id: string;
  driverName: string;
  deviceType: number;
  deviceIndex: number;
  channel: number;
  baudRate: number;
  status: 'connected' | 'closed' | 'error';
  error?: string;
  busError?: { errCode: number; errTypes: string[]; timestamp: number } | null;
}

export interface CanMessageRow {
  seq: number;
  frame: CanFrame;
  messageName?: string;
}

export interface MonitoredSignal {
  sessionId: string;
  messageId: number;
  extended: boolean;
  signal: DbcSignal;
  value: number;
  history: { t: number; v: number }[];
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
  sendId: string;
  sendDlc: string;
  sendData: string;
  sendExtended: boolean;
  sendFd: boolean;
  sendBrs: boolean;
  timerInterval: string;
  timerRunning: boolean;
  idFilter: string;
  autoScroll: boolean;
  messageFilter: 'all' | 'tx' | 'rx';
  recording: boolean;
  viewMode: 'trace' | 'stats' | 'j1939' | 'uds';
  sendList: SendListItem[];
}

const FD_DATA_LENGTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];

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
const timerHandles = new Map<string, ReturnType<typeof setInterval>>();
const sendListTimers = new Map<string, ReturnType<typeof setInterval>>();
const timerInFlight = new Set<string>();
const sendListInFlight = new Set<string>();
const activeRecordings = new Map<string, string>();
const busLoadCounters = new Map<string, { count: number; lastReset: number }>();
const pendingTxEchoes = new Map<string, { signature: string; expiresAt: number }[]>();
const LOCAL_TX_ECHO_TTL_MS = 2000;

function bumpBusLoad(sessionId: string, frameCount: number): void {
  const blc = busLoadCounters.get(sessionId) || { count: 0, lastReset: Date.now() };
  blc.count += frameCount;
  busLoadCounters.set(sessionId, blc);
}

function getFrameSignature(frame: CanFrame): string {
  return [
    frame.id,
    frame.extended ? 1 : 0,
    frame.remote ? 1 : 0,
    frame.dlc,
    frame.fd ? 1 : 0,
    frame.brs ? 1 : 0,
    frame.data.slice(0, frame.dlc).join(','),
  ].join('|');
}

function prunePendingTxEchoes(sessionId: string, now = Date.now()): { signature: string; expiresAt: number }[] {
  const queue = (pendingTxEchoes.get(sessionId) || []).filter((item) => item.expiresAt > now);
  if (queue.length > 0) {
    pendingTxEchoes.set(sessionId, queue);
  } else {
    pendingTxEchoes.delete(sessionId);
  }
  return queue;
}

function rememberLocalTx(sessionId: string, frame: CanFrame): void {
  const queue = prunePendingTxEchoes(sessionId);
  queue.push({ signature: getFrameSignature(frame), expiresAt: Date.now() + LOCAL_TX_ECHO_TTL_MS });
  pendingTxEchoes.set(sessionId, queue.slice(-256));
}

function forgetLocalTx(sessionId: string, frame: CanFrame): void {
  const queue = prunePendingTxEchoes(sessionId);
  const signature = getFrameSignature(frame);
  const index = queue.findIndex((item) => item.signature === signature);
  if (index >= 0) {
    queue.splice(index, 1);
  }
  if (queue.length > 0) {
    pendingTxEchoes.set(sessionId, queue);
  } else {
    pendingTxEchoes.delete(sessionId);
  }
}

function isPendingLocalTxEcho(sessionId: string, frame: CanFrame): boolean {
  if (frame.direction !== 'tx') return false;
  const queue = prunePendingTxEchoes(sessionId);
  const signature = getFrameSignature(frame);
  const index = queue.findIndex((item) => item.signature === signature);
  if (index < 0) return false;
  queue.splice(index, 1);
  if (queue.length > 0) {
    pendingTxEchoes.set(sessionId, queue);
  } else {
    pendingTxEchoes.delete(sessionId);
  }
  return true;
}

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

function setSessionError(sessionId: string, error: unknown, set: Function): void {
  const message = error instanceof Error ? error.message : String(error);
  set((state: CanDebugStore) => ({
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? { ...s, status: 'error' as const, error: message } : s
    ),
  }));
}

async function transmitCanFrame(
  sessionId: string,
  txFrame: CanFrame,
  set: Function,
  get: Function,
): Promise<boolean> {
  rememberLocalTx(sessionId, txFrame);
  try {
    await window.api.can.send(sessionId, { ...txFrame, timestamp: 0 });
  } catch (error) {
    forgetLocalTx(sessionId, txFrame);
    setSessionError(sessionId, error, set);
    return false;
  }

  bumpBusLoad(sessionId, 1);
  set((state: CanDebugStore) => {
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
  return true;
}

const sessionStartTime = new Map<string, number>();

export function getSessionStartTime(sessionId: string): number {
  return sessionStartTime.get(sessionId) || 0;
}

const SIGNAL_HISTORY_MAX = 6000;



export interface CanDebugStore {
  sessions: CanSession[];
  activeSessionId: string | null;
  messages: Map<string, CanMessageRow[]>;
  sessionUI: Map<string, CanSessionUI>;
  seqCounters: Map<string, number>;
  dbc: DbcDatabase | null;
  monitoredSignals: MonitoredSignal[];
  messageStats: Map<string, Map<number, MessageStats>>;
  busLoad: Map<string, number>;

  openDevice: (driverName: string, deviceType: number, deviceIndex: number, channel: number, baudRate: number, fdConfig?: { protocol?: number; mode?: number; dataBaudRate?: number; nonIso?: boolean; ch1BaudRate?: number; ch1DataBaudRate?: number }, chBaudRates?: Record<number, number>) => Promise<void>;
  closeDevice: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (id: string | null) => void;
  clearMessages: (sessionId: string) => void;
  updateSessionUI: (sessionId: string, patch: Partial<CanSessionUI>) => void;
  loadDbc: (content: string) => Promise<void>;
  unloadDbc: () => void;
  addMonitorSignal: (sessionId: string, messageId: number, extended: boolean, signal: DbcSignal) => void;
  removeMonitorSignal: (signalName: string, messageId: number, sessionId?: string) => void;
  sendFrame: (sessionId: string) => Promise<void>;
  startTimer: (sessionId: string) => void;
  stopTimer: (sessionId: string) => void;
  addSendListItem: (sessionId: string) => void;
  removeSendListItem: (sessionId: string, itemId: string) => void;
  updateSendListItem: (sessionId: string, itemId: string, patch: Partial<SendListItem>) => void;
  toggleSendListItem: (sessionId: string, itemId: string) => void;
  sendListItemOnce: (sessionId: string, itemId: string) => Promise<void>;
  startRecording: (sessionId: string, filePath: string) => Promise<void>;
  stopRecording: (sessionId: string) => Promise<void>;
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

/** Software fallback for single-frame periodic send (startTimer) */
function fallbackStartTimer(sessionId: string, ms: number, set: Function, get: Function): void {
  const existing = timerHandles.get(sessionId);
  if (existing) clearInterval(existing);
  timerHandles.delete(sessionId);
  timerInFlight.delete(sessionId);
  const store = get() as CanDebugStore;
  void store.sendFrame(sessionId);
  const handle = setInterval(async () => {
    const st = get() as CanDebugStore;
    const s = st.sessions.find((ss: CanSession) => ss.id === sessionId);
    if (!s || s.status !== 'connected') {
      clearInterval(timerHandles.get(sessionId)!);
      timerHandles.delete(sessionId);
      timerInFlight.delete(sessionId);
      st.updateSessionUI(sessionId, { timerRunning: false });
      return;
    }
    if (timerInFlight.has(sessionId)) return;
    timerInFlight.add(sessionId);
    try {
      await st.sendFrame(sessionId);
    } finally {
      timerInFlight.delete(sessionId);
    }
  }, ms);
  timerHandles.set(sessionId, handle);
  store.updateSessionUI(sessionId, { timerRunning: true });
}

/** Software fallback for periodic send (setInterval) */
function startSoftwareTimer(sessionId: string, itemId: string, key: string, set: Function, get: Function): void {
  const intervalMs = (get() as CanDebugStore).sessionUI.get(sessionId)?.sendList.find((i: SendListItem) => i.id === itemId)?.intervalMs || 100;
  const sendOne = async () => {
    const st = get() as CanDebugStore;
    const s = st.sessions.find((ss: CanSession) => ss.id === sessionId);
    if (!s || s.status !== 'connected') {
      clearInterval(sendListTimers.get(key)!);
      sendListTimers.delete(key);
      sendListInFlight.delete(key);
      st.updateSendListItem(sessionId, itemId, { enabled: false });
      return;
    }
    const it = st.sessionUI.get(sessionId)?.sendList.find((i: SendListItem) => i.id === itemId);
    if (!it) return;
    const id = parseInt(it.canId, 16);
    if (isNaN(id)) return;
    const dataBytes = it.data.replace(/\s/g, '').match(/.{1,2}/g)?.map((h: string) => parseInt(h, 16)) || [];
    const maxLen = it.fd ? fdNearestLength(it.dlc) : Math.min(it.dlc, 8);
    const txFrame: CanFrame = {
      id, extended: it.extended, remote: false,
      dlc: maxLen, data: [...dataBytes.slice(0, maxLen), ...new Array(Math.max(0, maxLen - dataBytes.length)).fill(0)],
      timestamp: Date.now(), direction: 'tx', fd: it.fd || undefined, brs: it.brs || undefined,
    };
    await transmitCanFrame(sessionId, txFrame, set, get);
  };
  void sendOne();
  const h = setInterval(async () => {
    if (sendListInFlight.has(key)) return;
    sendListInFlight.add(key);
    try {
      await sendOne();
    } finally {
      sendListInFlight.delete(key);
    }
  }, (get() as CanDebugStore).sessionUI.get(sessionId)?.sendList.find((i: SendListItem) => i.id === itemId)?.intervalMs || 100);
  sendListTimers.set(key, h);
  (get() as CanDebugStore).updateSendListItem(sessionId, itemId, { enabled: true });
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

  openDevice: async (driverName, deviceType, deviceIndex, channel, baudRate, fdConfig, chBaudRates) => {
    const result = await window.api.can.open(driverName, deviceType, deviceIndex, channel, baudRate, fdConfig, chBaudRates);
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

      // Listen for CAN data via extension IPC broadcast
      window.api.can.onData(sessionId, (frames: CanFrame[]) => {
        const visibleFrames = frames.filter((frame) => !isPendingLocalTxEcho(sessionId, frame));
        if (visibleFrames.length === 0) return;
        bumpBusLoad(sessionId, visibleFrames.length);
        const blc = busLoadCounters.get(sessionId)!;
        const elapsed = Date.now() - blc.lastReset;

        set((state) => {
          const msgs = new Map(state.messages);
          const seqs = new Map(state.seqCounters);
          let seq = seqs.get(sessionId) || 0;
          const existing = msgs.get(sessionId) || [];
          const db = state.dbc;

          const newRows: CanMessageRow[] = visibleFrames.map((f) => {
            seq++;
            writeCanRecording(sessionId, f, seq);
            const msgDef = db ? db.messages.find((m) => m.id === f.id && m.extended === f.extended) : undefined;
            return { seq, frame: f, messageName: msgDef?.name };
          });

          const combined = [...existing, ...newRows];
          msgs.set(sessionId, combined.length > MAX_MESSAGES ? combined.slice(-MAX_MESSAGES) : combined);
          seqs.set(sessionId, seq);

          const allStats = new Map(state.messageStats);
          const sessionStats = new Map(allStats.get(sessionId) || new Map());
          const now = Date.now();
          for (const f of visibleFrames) {
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

          const bl = new Map(state.busLoad);
          if (elapsed >= 1000) {
            const bitsPerFrame = 111;
            const sess = state.sessions.find((s) => s.id === sessionId);
            const baud = sess?.baudRate || 500000;
            const load = (blc.count * bitsPerFrame / (elapsed / 1000)) / baud * 100;
            bl.set(sessionId, Math.min(100, load));
            blc.count = 0;
            blc.lastReset = Date.now();
            busLoadCounters.set(sessionId, blc);
          }

          const monitored = state.monitoredSignals.map((ms) => {
            if (ms.sessionId !== sessionId) return ms;
            const latestFrame = visibleFrames.findLast((f) => f.id === ms.messageId && f.extended === ms.extended);
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

      window.api.can.onBusError(sessionId, (info) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, busError: info } : s
          ),
        }));
      });
    }
  },

  closeDevice: (sessionId) => {
    const ui = get().sessionUI.get(sessionId);
    if (ui) {
      for (const item of ui.sendList) {
        const key = `${sessionId}:${item.id}`;
        const h = sendListTimers.get(key);
        if (h) { clearInterval(h); sendListTimers.delete(key); }
        sendListInFlight.delete(key);
      }
    }
    window.api.can.close(sessionId);
    const handle = timerHandles.get(sessionId);
    if (handle) { clearInterval(handle); timerHandles.delete(sessionId); }
    timerInFlight.delete(sessionId);
    pendingTxEchoes.delete(sessionId);
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
    // Clean up all send list timers for this session
    const ui = get().sessionUI.get(sessionId);
    if (ui) {
      for (const item of ui.sendList) {
        const key = `${sessionId}:${item.id}`;
        const h = sendListTimers.get(key);
        if (h) { clearInterval(h); sendListTimers.delete(key); }
        sendListInFlight.delete(key);
      }
    }
    timerInFlight.delete(sessionId);
    const recId = activeRecordings.get(sessionId);
    if (recId) { window.api.recording.stop(recId); activeRecordings.delete(sessionId); }
    sessionStartTime.delete(sessionId);
    pendingTxEchoes.delete(sessionId);
    set((state) => {
      const msgs = new Map(state.messages); msgs.delete(sessionId);
      const ui = new Map(state.sessionUI); ui.delete(sessionId);
      const seqs = new Map(state.seqCounters); seqs.delete(sessionId);
      return {
        sessions: state.sessions.filter((ss) => ss.id !== sessionId),
        messages: msgs, sessionUI: ui, seqCounters: seqs,
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
      const msgs = new Map(state.messages); msgs.set(sessionId, []);
      const seqs = new Map(state.seqCounters); seqs.set(sessionId, 0);
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
      return { monitoredSignals: [...state.monitoredSignals, { sessionId, messageId, extended, signal, value: 0, history: [] }] };
    });
  },

  removeMonitorSignal: (signalName, messageId, sessionId) => {
    set((state) => ({
      monitoredSignals: state.monitoredSignals.filter(
        (ms) => !(ms.signal.name === signalName && ms.messageId === messageId && (!sessionId || ms.sessionId === sessionId))
      ),
    }));
  },

  sendFrame: async (sessionId) => {
    const ui = get().sessionUI.get(sessionId);
    if (!ui) return;
    const id = parseInt(ui.sendId, 16);
    if (isNaN(id)) return;
    const dlc = parseInt(ui.sendDlc, 10);
    const parsedBytes = ui.sendData.replace(/\s/g, '').match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) || [];
    const maxLen = ui.sendFd ? fdNearestLength(dlc) : Math.min(dlc, 8);
    const dataBytes = [...parsedBytes.slice(0, maxLen), ...new Array(Math.max(0, maxLen - parsedBytes.length)).fill(0)];
    const txFrame: CanFrame = {
      id, extended: ui.sendExtended, remote: false, dlc: maxLen, data: dataBytes,
      timestamp: Date.now(), direction: 'tx', fd: ui.sendFd || undefined, brs: ui.sendBrs || undefined,
    };
    await transmitCanFrame(sessionId, txFrame, set, get);
  },

  startTimer: (sessionId) => {
    const ui = get().sessionUI.get(sessionId);
    if (!ui) return;
    const ms = parseInt(ui.timerInterval, 10);
    if (isNaN(ms) || ms < 1) return;
    fallbackStartTimer(sessionId, ms, set, get);
  },

  stopTimer: (sessionId) => {
    const handle = timerHandles.get(sessionId);
    if (handle) {
      clearInterval(handle);
      timerHandles.delete(sessionId);
    }
    timerInFlight.delete(sessionId);
    get().updateSessionUI(sessionId, { timerRunning: false });
  },

  startRecording: async (sessionId, filePath) => {
    const recId = crypto.randomUUID();
    await window.api.recording.start(filePath, recId);
    window.api.recording.write(recId, 'date ' + new Date().toLocaleString());
    window.api.recording.write(recId, 'base hex  timestamps absolute');
    window.api.recording.write(recId, 'no internal events logged');
    activeRecordings.set(sessionId, recId);
    get().updateSessionUI(sessionId, { recording: true });
  },

  stopRecording: async (sessionId) => {
    const recId = activeRecordings.get(sessionId);
    if (recId) { await window.api.recording.stop(recId); activeRecordings.delete(sessionId); }
    get().updateSessionUI(sessionId, { recording: false });
  },

  addSendListItem: (sessionId) => {
    const item: SendListItem = {
      id: crypto.randomUUID(), canId: '100', dlc: 8,
      data: '00 00 00 00 00 00 00 00', extended: false, fd: false, brs: false, intervalMs: 100, enabled: false,
    };
    set((state) => {
      const ui = new Map(state.sessionUI);
      const prev = ui.get(sessionId) || defaultCanUI();
      ui.set(sessionId, { ...prev, sendList: [...prev.sendList, item] });
      return { sessionUI: ui };
    });
  },

  removeSendListItem: (sessionId, itemId) => {
    const key = `${sessionId}:${itemId}`;
    const h = sendListTimers.get(key);
    if (h) { clearInterval(h); sendListTimers.delete(key); }
    sendListInFlight.delete(key);
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
      ui.set(sessionId, { ...prev, sendList: prev.sendList.map((i) => i.id === itemId ? { ...i, ...patch } : i) });
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
      sendListInFlight.delete(key);
      get().updateSendListItem(sessionId, itemId, { enabled: false });
    } else {
      // Start software timer
      startSoftwareTimer(sessionId, itemId, key, set, get);
    }
  },

  sendListItemOnce: async (sessionId, itemId) => {
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
      id, extended: it.extended, remote: false, dlc: maxLen, data: dataBytes,
      timestamp: Date.now(), direction: 'tx', fd: it.fd || undefined, brs: it.brs || undefined,
    };
    await transmitCanFrame(sessionId, txFrame, set, get);
  },

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
    let idx = 0;
    const playNext = () => {
      if (idx >= frames.length) return;
      const { delay, frame } = frames[idx++];
      setTimeout(() => {
        set((state) => {
          const msgs = new Map(state.messages);
          const seqs = new Map(state.seqCounters);
          let seq = seqs.get(sessionId) || 0; seq++;
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
      if (byteIdx < data.length) value |= ((data[byteIdx] >> bitIdx) & 1) << i;
    }
    return value;
  } else {
    let value = 0;
    let bitPos = startBit;
    for (let i = bitLength - 1; i >= 0; i--) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) value |= ((data[byteIdx] >> bitIdx) & 1) << i;
      if (bitIdx === 0) bitPos += 15; else bitPos -= 1;
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
