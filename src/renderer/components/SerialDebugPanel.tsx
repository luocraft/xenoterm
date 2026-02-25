import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSerialStore, hexDecode } from '../store/serial-store';
import type { ModbusLogEntry } from '../store/serial-store';
import { useT } from '../i18n';
import type { SerialConfig, NetDataEncoding, SerialMessage } from '../../shared/types';

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'open' ? '#16a34a' :
    status === 'opening' ? '#facc15' :
    status === 'error' ? '#f87171' : '#6b7280';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: color, marginRight: 6 }} />;
}

function MessageItem({ msg, displayEncoding }: { msg: SerialMessage; displayEncoding: NetDataEncoding }) {
  const isSend = msg.direction === 'send';
  const displayData = displayEncoding === 'utf8' ? hexDecode(msg.data) : msg.data.replace(/(.{2})/g, '$1 ').trim();
  const time = new Date(msg.timestamp).toLocaleTimeString();

  return (
    <div className="flex px-2 py-0.5 font-mono text-[10px]" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="shrink-0 mr-1" style={{ whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--color-text-dim)' }}>{time}</span>{' '}
        <span style={{ color: isSend ? '#2563eb' : '#16a34a', fontWeight: 500 }}>
          {isSend ? '→ TX' : '← RX'}
        </span>{' '}
      </span>
      <span style={{ color: 'var(--color-text-primary)', wordBreak: 'break-all' }}>{displayData}</span>
    </div>
  );
}

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

function OpenPortForm({ onOpened }: { onOpened: () => void }) {
  const t = useT();
  const { availablePorts, refreshPorts, openPort } = useSerialStore();
  const [portPath, setPortPath] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [dataBits, setDataBits] = useState<5|6|7|8>(8);
  const [stopBits, setStopBits] = useState<1|1.5|2>(1);
  const [parity, setParity] = useState<'none'|'even'|'odd'>('none');
  const [flowControl, setFlowControl] = useState<'none'|'rtscts'|'xonxoff'>('none');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { refreshPorts(); }, [refreshPorts]);

  const handleOpenVirtual = async () => {
    setError('');
    setLoading(true);
    try {
      await openPort({ path: 'VIRTUAL', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', rtscts: false, xon: false, xoff: false });
      onOpened();
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!portPath) { setError(t('serial.selectPortErr')); return; }
    setError('');
    setLoading(true);
    try {
      await openPort({ path: portPath, baudRate, dataBits, stopBits, parity, rtscts: flowControl === 'rtscts', xon: flowControl === 'xonxoff', xoff: flowControl === 'xonxoff' });
      onOpened();
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const sel = "px-1.5 py-1 text-[10px] rounded outline-none";
  const inputStyle: React.CSSProperties = { backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' };

  return (
    <form onSubmit={handleSubmit} className="flex-shrink-0 px-3 py-2 space-y-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
      {/* Row 1: Port + Baud + Refresh */}
      <div className="flex gap-1.5 items-center">
        <select value={portPath} onChange={(e) => setPortPath(e.target.value)} className={`flex-1 ${sel}`} style={inputStyle}>
          <option value="">{t('serial.selectPort')}</option>
          {availablePorts.map((p) => <option key={p.path} value={p.path}>{p.path}{p.manufacturer ? ` — ${p.manufacturer}` : ''}</option>)}
        </select>
        <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))} className={`w-20 ${sel}`} style={inputStyle}>
          {BAUD_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" onClick={refreshPorts} className="text-[10px] px-1.5 py-1 rounded" style={inputStyle} title={t('serial.refreshPorts')}>↻</button>
      </div>
      {/* Row 2: DataBits + StopBits + Parity + Flow */}
      <div className="flex gap-1.5 items-center">
        <select value={dataBits} onChange={(e) => setDataBits(Number(e.target.value) as 5|6|7|8)} className={sel} style={inputStyle}>
          {[5,6,7,8].map((d) => <option key={d} value={d}>{d}bit</option>)}
        </select>
        <select value={stopBits} onChange={(e) => setStopBits(Number(e.target.value) as 1|1.5|2)} className={sel} style={inputStyle}>
          <option value={1}>1stop</option><option value={1.5}>1.5</option><option value={2}>2stop</option>
        </select>
        <select value={parity} onChange={(e) => setParity(e.target.value as 'none'|'even'|'odd')} className={sel} style={inputStyle}>
          <option value="none">{t('serial.parityNone')}</option><option value="even">{t('serial.parityEven')}</option><option value="odd">{t('serial.parityOdd')}</option>
        </select>
        <select value={flowControl} onChange={(e) => setFlowControl(e.target.value as 'none'|'rtscts'|'xonxoff')} className={sel} style={inputStyle}>
          <option value="none">{t('serial.flowNone')}</option><option value="rtscts">RTS/CTS</option><option value="xonxoff">XON/XOFF</option>
        </select>
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      {/* Row 3: Buttons */}
      <div className="flex gap-1.5">
        <button type="submit" disabled={loading}
          className="flex-1 py-1.5 text-[10px] font-medium rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40">
          {loading ? t('serial.opening') : t('serial.openPort')}
        </button>
        <button type="button" onClick={handleOpenVirtual} disabled={loading}
          className="px-3 py-1.5 text-[10px] rounded-md hover:opacity-90 disabled:opacity-40"
          style={inputStyle}>
          {t('serial.virtual')}
        </button>
      </div>
    </form>
  );
}


function SerialSendTemplatePanel({ sessionId }: { sessionId: string }) {
  const t = useT();
  const templates = useSerialStore((s) => s.sendTemplates.get(sessionId) || []);
  const addTemplate = useSerialStore((s) => s.addTemplate);
  const removeTemplate = useSerialStore((s) => s.removeTemplate);
  const updateTemplate = useSerialStore((s) => s.updateTemplate);
  const sendTpl = useSerialStore((s) => s.sendTemplate);
  const toggleTimer = useSerialStore((s) => s.toggleTemplateTimer);
  const session = useSerialStore((s) => s.sessions.find((ss) => ss.id === sessionId));
  const [collapsed, setCollapsed] = useState(false);

  const isOpen = session?.status === 'open';
  const inputStyle = {
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    color: 'var(--color-text-primary)',
  };

  return (
    <div className="flex-shrink-0 flex flex-col" style={{ borderTop: '1px solid var(--color-border)', maxHeight: collapsed ? 28 : 180 }}>
      <div className="flex items-center justify-between px-2 py-0.5 flex-shrink-0 cursor-pointer" style={{ borderBottom: collapsed ? 'none' : '1px solid var(--color-border)' }} onClick={() => setCollapsed(!collapsed)}>
        <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>
          {collapsed ? '▶' : '▼'} {t('tpl.title')}
        </span>
        <button onClick={(e) => { e.stopPropagation(); addTemplate(sessionId); setCollapsed(false); }}
          className="text-[10px] px-1.5 py-0.5 rounded hover:bg-[var(--color-hover-bg)]"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
          {t('tpl.add')}
        </button>
      </div>
      {!collapsed && (
        templates.length === 0 ? (
          <div className="text-[10px] text-center py-2" style={{ color: 'var(--color-text-dim)' }}>{t('tpl.empty')}</div>
        ) : (
          <div className="text-[11px] flex flex-col min-h-0">
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-[9px] flex-shrink-0" style={{ color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)' }}>
              <span className="w-12"></span>
              <span className="w-20">{t('tpl.name')}</span>
              <span className="w-16">{t('tpl.encoding')}</span>
              <span className="flex-1">{t('tpl.data')}</span>
              <span className="w-16">{t('tpl.intervalMs')}</span>
              <span className="w-8"></span>
            </div>
            <div className="overflow-y-auto flex-1">
              {templates.map((tpl) => (
                <div key={tpl.id} className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-[var(--color-hover-bg)]">
                  <button onClick={() => isOpen && sendTpl(sessionId, tpl.id)}
                    className="w-6 text-center text-[10px]"
                    style={{ color: 'var(--color-text-secondary)', cursor: isOpen ? 'pointer' : 'default' }}
                    title={t('tpl.sendOnce')}>📤</button>
                  <button onClick={() => isOpen && toggleTimer(sessionId, tpl.id)}
                    className="w-6 text-center text-[10px]"
                    style={{ color: tpl.enabled ? '#4ade80' : 'var(--color-text-dim)', cursor: isOpen ? 'pointer' : 'default' }}
                    title={tpl.enabled ? t('tpl.timerStop') : t('tpl.timerStart')}>
                    {tpl.enabled ? '⏹' : '⏱'}</button>
                  <input value={tpl.name} onChange={(e) => updateTemplate(sessionId, tpl.id, { name: e.target.value })}
                    placeholder="name" className="w-20 px-1 py-0.5 text-[10px] rounded" style={inputStyle} disabled={tpl.enabled} />
                  <select value={tpl.encoding} onChange={(e) => updateTemplate(sessionId, tpl.id, { encoding: e.target.value as NetDataEncoding })}
                    className="w-16 px-1 py-0.5 text-[10px] rounded outline-none" style={inputStyle} disabled={tpl.enabled}>
                    <option value="utf8">UTF8</option>
                    <option value="hex">HEX</option>
                  </select>
                  <input value={tpl.data} onChange={(e) => updateTemplate(sessionId, tpl.id, { data: e.target.value })}
                    placeholder={tpl.encoding === 'hex' ? 'hex...' : 'text...'}
                    className="flex-1 px-1 py-0.5 text-[10px] rounded font-mono" style={inputStyle} disabled={tpl.enabled} />
                  <input value={tpl.intervalMs} onChange={(e) => updateTemplate(sessionId, tpl.id, { intervalMs: parseInt(e.target.value) || 1000 })}
                    className="w-16 px-1 py-0.5 text-[10px] rounded text-center" style={inputStyle} disabled={tpl.enabled} />
                  <button onClick={() => removeTemplate(sessionId, tpl.id)}
                    className="w-8 text-center text-[9px] text-red-400 hover:text-red-300" title={t('tpl.delete')}>🗑</button>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

/* ─── Modbus RTU helpers ─── */
const MODBUS_FC: Record<number, string> = {
  1: 'Read Coils', 2: 'Read Discrete Inputs',
  3: 'Read Holding Registers', 4: 'Read Input Registers',
  5: 'Write Single Coil', 6: 'Write Single Register',
  15: 'Write Multiple Coils', 16: 'Write Multiple Registers',
};

function crc16modbus(buf: number[]): number {
  let crc = 0xFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      if (crc & 1) { crc = (crc >> 1) ^ 0xA001; } else { crc >>= 1; }
    }
  }
  return crc;
}

function buildModbusRequest(slave: number, fc: number, startAddr: number, value: number): number[] {
  const buf = [slave, fc, (startAddr >> 8) & 0xFF, startAddr & 0xFF, (value >> 8) & 0xFF, value & 0xFF];
  const crc = crc16modbus(buf);
  buf.push(crc & 0xFF, (crc >> 8) & 0xFF);
  return buf;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/\s/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.substring(i, i + 2), 16));
  return bytes;
}

function parseModbusResponse(bytes: number[]): { slave: number; fc: number; detail: string; isError: boolean } {
  if (bytes.length < 4) return { slave: 0, fc: 0, detail: 'Frame too short', isError: true };
  const slave = bytes[0];
  const fc = bytes[1];
  // Verify CRC
  const payload = bytes.slice(0, -2);
  const rxCrc = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
  const calcCrc = crc16modbus(payload);
  if (rxCrc !== calcCrc) return { slave, fc, detail: `CRC error (rx=${rxCrc.toString(16)} calc=${calcCrc.toString(16)})`, isError: true };
  // Exception response
  if (fc & 0x80) {
    const excCode = bytes[2];
    const excNames: Record<number, string> = { 1: 'Illegal Function', 2: 'Illegal Data Address', 3: 'Illegal Data Value', 4: 'Slave Device Failure' };
    return { slave, fc: fc & 0x7F, detail: `Exception ${excCode}: ${excNames[excCode] || 'Unknown'}`, isError: true };
  }
  // FC 01-04: read response
  if (fc >= 1 && fc <= 4) {
    const byteCount = bytes[2];
    const data = bytes.slice(3, 3 + byteCount);
    if (fc <= 2) {
      // Coils / discrete inputs — show as bits
      return { slave, fc, detail: data.map((b) => b.toString(2).padStart(8, '0')).join(' '), isError: false };
    }
    // Registers — show as 16-bit values
    const regs: string[] = [];
    for (let i = 0; i < data.length; i += 2) {
      regs.push('0x' + ((data[i] << 8) | (data[i + 1] || 0)).toString(16).padStart(4, '0'));
    }
    return { slave, fc, detail: regs.join(' '), isError: false };
  }
  // FC 05/06: write single
  if (fc === 5 || fc === 6) {
    const addr = (bytes[2] << 8) | bytes[3];
    const val = (bytes[4] << 8) | bytes[5];
    return { slave, fc, detail: `@${addr} = ${val}`, isError: false };
  }
  // FC 15/16: write multiple
  if (fc === 15 || fc === 16) {
    const addr = (bytes[2] << 8) | bytes[3];
    const qty = (bytes[4] << 8) | bytes[5];
    return { slave, fc, detail: `@${addr} x${qty} OK`, isError: false };
  }
  return { slave, fc, detail: bytesToHex(bytes), isError: false };
}

interface ModbusWatchItem {
  id: string;
  address: number;
  dataType: 'INT16' | 'UINT16' | 'INT32' | 'UINT32' | 'FLOAT32';
  value: string;
  hexValue: string;
}

/** Module-level poll state that survives component remounts */
interface ModbusPollState {
  handle: ReturnType<typeof setInterval>;
  watchSlave: number;
  watchStartAddr: number;
  watchCount: number;
  pollInterval: number;
  watchItems: ModbusWatchItem[];
}
const modbusPollStates = new Map<string, ModbusPollState>();

function ModbusRtuView({ sessionId, active }: { sessionId: string; active: boolean }) {
  const t = useT();
  const session = useSerialStore((s) => s.sessions.find((ss) => ss.id === sessionId));
  const isOpen = session?.status === 'open';
  const activeRef = useRef(active);
  activeRef.current = active;

  const [slave, setSlave] = useState(1);
  const [fc, setFc] = useState(3);
  const [startAddr, setStartAddr] = useState(0);
  const [quantity, setQuantity] = useState(10);
  const [writeValue, setWriteValue] = useState(0);
  const logs = useSerialStore((s) => s.modbusLogs.get(sessionId) || []);
  const appendModbusLog = useSerialStore((s) => s.appendModbusLog);
  const clearModbusLogs = useSerialStore((s) => s.clearModbusLogs);
  const rxBufferRef = useRef('');
  const rxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Watch table — restore from module-level state if poll was running
  const existingPoll = modbusPollStates.get(sessionId);
  const [watchItems, setWatchItems] = useState<ModbusWatchItem[]>(existingPoll?.watchItems || []);
  const [watchSlave, setWatchSlave] = useState(existingPoll?.watchSlave ?? 1);
  const [watchStartAddr, setWatchStartAddr] = useState(existingPoll?.watchStartAddr ?? 0);
  const [watchCount, setWatchCount] = useState(existingPoll?.watchCount ?? 10);
  const [pollInterval, setPollInterval] = useState(existingPoll?.pollInterval ?? 1000);
  const [polling, setPolling] = useState(!!existingPoll);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(existingPoll?.handle || null);
  const [watchCollapsed, setWatchCollapsed] = useState(false);

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    color: 'var(--color-text-primary)',
  };

  // Auto-scroll logs
  useEffect(() => {
    const container = logsEndRef.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [logs.length]);

  // Listen for serial data and accumulate into rxBuffer, parse after silence
  useEffect(() => {
    if (!session || session.status !== 'open') return;
    const unsub = window.api.serial.onData(sessionId, (hexData) => {
      if (!activeRef.current) return; // skip processing when not in Modbus mode
      rxBufferRef.current += hexData;
      if (rxTimerRef.current) clearTimeout(rxTimerRef.current);
      // Wait for 50ms silence to consider frame complete (Modbus RTU uses 3.5 char gap)
      rxTimerRef.current = setTimeout(() => {
        const frameHex = rxBufferRef.current;
        rxBufferRef.current = '';
        if (frameHex.length < 8) return; // minimum 4 bytes
        const bytes = hexToBytes(frameHex);
        const parsed = parseModbusResponse(bytes);
        const entry: ModbusLogEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          direction: parsed.isError ? 'err' : 'res',
          slave: parsed.slave,
          fc: parsed.fc,
          raw: frameHex,
          detail: parsed.detail,
        };
        appendModbusLog(sessionId, entry);

        // Update watch table if this is a FC03/04 response
        if (!parsed.isError && (parsed.fc === 3 || parsed.fc === 4)) {
          const dataBytes = bytes.slice(3, 3 + bytes[2]);
          setWatchItems((prev) => {
            if (prev.length === 0) return prev;
            return prev.map((item, idx) => {
              const offset = idx * 2;
              if (offset + 1 >= dataBytes.length) return item;
              const raw16 = (dataBytes[offset] << 8) | dataBytes[offset + 1];
              let val: number;
              switch (item.dataType) {
                case 'INT16': val = raw16 > 0x7FFF ? raw16 - 0x10000 : raw16; break;
                case 'UINT16': val = raw16; break;
                case 'INT32':
                case 'UINT32':
                case 'FLOAT32':
                  if (offset + 3 < dataBytes.length) {
                    const raw32 = (dataBytes[offset] << 24) | (dataBytes[offset + 1] << 16) | (dataBytes[offset + 2] << 8) | dataBytes[offset + 3];
                    if (item.dataType === 'FLOAT32') {
                      const buf = new ArrayBuffer(4);
                      new DataView(buf).setInt32(0, raw32);
                      val = new DataView(buf).getFloat32(0);
                    } else if (item.dataType === 'INT32') {
                      val = raw32 > 0x7FFFFFFF ? raw32 - 0x100000000 : raw32;
                    } else { val = raw32 >>> 0; }
                  } else { return item; }
                  break;
                default: val = raw16;
              }
              return { ...item, value: String(val), hexValue: '0x' + raw16.toString(16).padStart(4, '0') };
            });
          });
        }
      }, 50);
    });
    return () => { unsub(); if (rxTimerRef.current) clearTimeout(rxTimerRef.current); };
  }, [sessionId, session?.status]);

  // Track latest poll config in ref for unmount save
  const pollConfigRef = useRef({ watchSlave, watchStartAddr, watchCount, pollInterval, watchItems });
  pollConfigRef.current = { watchSlave, watchStartAddr, watchCount, pollInterval, watchItems };

  // On unmount: save poll state externally if polling, otherwise clean up
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        modbusPollStates.set(sessionId, {
          handle: pollRef.current,
          ...pollConfigRef.current,
        });
      } else {
        modbusPollStates.delete(sessionId);
      }
    };
  }, [sessionId]);

  const addLog = (entry: ModbusLogEntry) => appendModbusLog(sessionId, entry);

  const sendModbus = useCallback((frameBytes: number[]) => {
    if (!isOpen) return;
    const hex = bytesToHex(frameBytes);
    window.api.serial.write(sessionId, hex);
    const entry: ModbusLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      direction: 'req',
      slave: frameBytes[0],
      fc: frameBytes[1],
      raw: hex,
      detail: `${MODBUS_FC[frameBytes[1]] || 'FC' + frameBytes[1]} @${(frameBytes[2] << 8) | frameBytes[3]} x${(frameBytes[4] << 8) | frameBytes[5]}`,
    };
    addLog(entry);
  }, [isOpen, sessionId]);

  const handleSendRequest = () => {
    if (fc === 5) {
      // Write single coil: value must be 0xFF00 (ON) or 0x0000 (OFF)
      const coilVal = writeValue ? 0xFF00 : 0x0000;
      sendModbus(buildModbusRequest(slave, fc, startAddr, coilVal));
    } else if (fc === 6) {
      sendModbus(buildModbusRequest(slave, fc, startAddr, writeValue));
    } else {
      sendModbus(buildModbusRequest(slave, fc, startAddr, quantity));
    }
  };

  const initWatchTable = () => {
    const items: ModbusWatchItem[] = [];
    for (let i = 0; i < watchCount; i++) {
      items.push({ id: crypto.randomUUID(), address: watchStartAddr + i, dataType: 'UINT16', value: '-', hexValue: '-' });
    }
    setWatchItems(items);
  };

  const togglePolling = () => {
    if (polling) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      modbusPollStates.delete(sessionId);
      setPolling(false);
    } else {
      if (watchItems.length === 0) initWatchTable();
      const doRead = () => sendModbus(buildModbusRequest(watchSlave, 3, watchStartAddr, watchCount));
      doRead();
      pollRef.current = setInterval(doRead, pollInterval);
      setPolling(true);
    }
  };

  const isWriteFC = fc === 5 || fc === 6;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Modbus request form */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-1.5 px-3 py-2 text-[10px]" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <label style={{ color: 'var(--color-text-dim)' }}>{t('modbus.slave')}</label>
        <input type="number" value={slave} onChange={(e) => setSlave(Number(e.target.value))} min={1} max={247}
          className="w-12 px-1 py-0.5 text-[10px] rounded text-center" style={inputStyle} />
        <label style={{ color: 'var(--color-text-dim)' }}>{t('modbus.fc')}</label>
        <select value={fc} onChange={(e) => setFc(Number(e.target.value))}
          className="px-1 py-0.5 text-[10px] rounded outline-none" style={inputStyle}>
          {Object.entries(MODBUS_FC).map(([k, v]) => <option key={k} value={k}>FC{String(k).padStart(2, '0')} {v}</option>)}
        </select>
        <label style={{ color: 'var(--color-text-dim)' }}>{t('modbus.addr')}</label>
        <input type="number" value={startAddr} onChange={(e) => setStartAddr(Number(e.target.value))} min={0}
          className="w-16 px-1 py-0.5 text-[10px] rounded text-center" style={inputStyle} />
        {isWriteFC ? (
          <>
            <label style={{ color: 'var(--color-text-dim)' }}>{t('modbus.value')}</label>
            <input type="number" value={writeValue} onChange={(e) => setWriteValue(Number(e.target.value))}
              className="w-16 px-1 py-0.5 text-[10px] rounded text-center" style={inputStyle} />
          </>
        ) : (
          <>
            <label style={{ color: 'var(--color-text-dim)' }}>{t('modbus.qty')}</label>
            <input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} min={1} max={125}
              className="w-12 px-1 py-0.5 text-[10px] rounded text-center" style={inputStyle} />
          </>
        )}
        <button onClick={handleSendRequest} disabled={!isOpen}
          className="px-3 py-0.5 text-[10px] rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40">
          {t('common.send')}
        </button>
        <button onClick={() => clearModbusLogs(sessionId)} className="px-2 py-0.5 text-[10px] rounded"
          style={{ ...inputStyle, color: 'var(--color-text-secondary)' }}>
          {t('common.clear')}
        </button>
      </div>

      {/* Modbus log */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1 font-mono text-[10px]" style={{ backgroundColor: 'var(--color-surface)' }}>
        {logs.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--color-text-dim)' }}>
            {t('modbus.noLogs')}
          </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="py-0.5 flex gap-2" style={{ borderBottom: '1px solid var(--color-border)', opacity: 0.9 }}>
            <span style={{ color: 'var(--color-text-dim)' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span style={{ color: log.direction === 'req' ? '#2563eb' : log.direction === 'err' ? '#dc2626' : '#16a34a', fontWeight: 500 }}>
              {log.direction === 'req' ? '→' : '←'} [{String(log.slave).padStart(2, '0')}] FC{String(log.fc).padStart(2, '0')}
            </span>
            <span style={{ color: log.direction === 'err' ? '#dc2626' : 'var(--color-text-primary)' }}>{log.detail}</span>
            <span className="ml-auto truncate max-w-[120px]" title={log.raw} style={{ color: 'var(--color-text-dim)', fontSize: 9 }}>{log.raw.length > 24 ? log.raw.slice(0, 24) + '…' : log.raw}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>

      {/* Register watch table */}
      <div className="flex-shrink-0 flex flex-col" style={{ borderTop: '1px solid var(--color-border)', maxHeight: watchCollapsed ? 28 : 200 }}>
        <div className="flex items-center gap-1.5 px-2 py-0.5 flex-shrink-0 cursor-pointer" style={{ borderBottom: watchCollapsed ? 'none' : '1px solid var(--color-border)' }}
          onClick={() => setWatchCollapsed(!watchCollapsed)}>
          <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>
            {watchCollapsed ? '▶' : '▼'} {t('modbus.watchTitle')}
          </span>
          {!watchCollapsed && (
            <div className="flex items-center gap-1 ml-auto" onClick={(e) => e.stopPropagation()}>
              <label className="text-[9px]" style={{ color: 'var(--color-text-dim)' }}>{t('modbus.slave')}</label>
              <input type="number" value={watchSlave} onChange={(e) => setWatchSlave(Number(e.target.value))} min={1} max={247}
                className="w-10 px-0.5 py-0.5 text-[9px] rounded text-center" style={inputStyle} disabled={polling} />
              <label className="text-[9px]" style={{ color: 'var(--color-text-dim)' }}>{t('modbus.addr')}</label>
              <input type="number" value={watchStartAddr} onChange={(e) => setWatchStartAddr(Number(e.target.value))} min={0}
                className="w-14 px-0.5 py-0.5 text-[9px] rounded text-center" style={inputStyle} disabled={polling} />
              <label className="text-[9px]" style={{ color: 'var(--color-text-dim)' }}>x</label>
              <input type="number" value={watchCount} onChange={(e) => setWatchCount(Number(e.target.value))} min={1} max={125}
                className="w-10 px-0.5 py-0.5 text-[9px] rounded text-center" style={inputStyle} disabled={polling} />
              <label className="text-[9px]" style={{ color: 'var(--color-text-dim)' }}>{t('modbus.pollMs')}</label>
              <input type="number" value={pollInterval} onChange={(e) => setPollInterval(Number(e.target.value))} min={100}
                className="w-14 px-0.5 py-0.5 text-[9px] rounded text-center" style={inputStyle} disabled={polling} />
              <button onClick={togglePolling} disabled={!isOpen}
                className="px-2 py-0.5 text-[9px] rounded"
                style={{
                  backgroundColor: polling ? 'rgba(239,68,68,0.15)' : 'var(--color-accent)',
                  color: polling ? '#ef4444' : '#fff',
                  border: `1px solid ${polling ? 'rgba(239,68,68,0.3)' : 'var(--color-accent)'}`,
                }}>
                {polling ? t('modbus.stopPoll') : t('modbus.startPoll')}
              </button>
            </div>
          )}
        </div>
        {!watchCollapsed && (
          watchItems.length === 0 ? (
            <div className="text-[10px] text-center py-2" style={{ color: 'var(--color-text-dim)' }}>
              {t('modbus.watchEmpty')}
            </div>
          ) : (
            <div className="overflow-y-auto flex-1 text-[10px] font-mono">
              <div className="flex items-center gap-2 px-2 py-0.5 text-[9px] flex-shrink-0" style={{ color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)' }}>
                <span className="w-16">{t('modbus.regAddr')}</span>
                <span className="w-20">{t('modbus.regDec')}</span>
                <span className="w-16">{t('modbus.regHex')}</span>
                <span className="w-16">{t('modbus.regType')}</span>
              </div>
              {watchItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 px-2 py-0.5 hover:bg-[var(--color-hover-bg)]">
                  <span className="w-16" style={{ color: 'var(--color-text-dim)' }}>{item.address}</span>
                  <span className="w-20" style={{ color: 'var(--color-text-primary)' }}>{item.value}</span>
                  <span className="w-16" style={{ color: 'var(--color-text-dim)' }}>{item.hexValue}</span>
                  <select value={item.dataType} onChange={(e) => {
                    setWatchItems((prev) => prev.map((w) => w.id === item.id ? { ...w, dataType: e.target.value as ModbusWatchItem['dataType'] } : w));
                  }} className="w-16 px-0.5 py-0.5 text-[9px] rounded outline-none" style={inputStyle}>
                    <option value="UINT16">UINT16</option>
                    <option value="INT16">INT16</option>
                    <option value="UINT32">UINT32</option>
                    <option value="INT32">INT32</option>
                    <option value="FLOAT32">FLOAT32</option>
                  </select>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function SessionView({ sessionId }: { sessionId: string }) {
  const t = useT();
  const session = useSerialStore((s) => s.sessions.find((ss) => ss.id === sessionId));
  const messages = useSerialStore((s) => s.messages.get(sessionId) || []);
  const sendData = useSerialStore((s) => s.sendData);
  const clearMessages = useSerialStore((s) => s.clearMessages);
  const closePort = useSerialStore((s) => s.closePort);
  const reopenPort = useSerialStore((s) => s.reopenPort);
  const setDTR = useSerialStore((s) => s.setDTR);
  const setRTS = useSerialStore((s) => s.setRTS);
  const recording = useSerialStore((s) => s.recording.get(sessionId) ?? false);
  const startRecording = useSerialStore((s) => s.startRecording);
  const stopRecording = useSerialStore((s) => s.stopRecording);
  const txBytes = useSerialStore((s) => s.txBytes.get(sessionId) ?? 0);
  const rxBytes = useSerialStore((s) => s.rxBytes.get(sessionId) ?? 0);
  const resetCounters = useSerialStore((s) => s.resetCounters);
  const viewMode = useSerialStore((s) => s.viewMode.get(sessionId) ?? 'raw');
  const setViewMode = useSerialStore((s) => s.setViewMode);

  const [input, setInput] = useState('');
  const [encoding, setEncoding] = useState<NetDataEncoding>('utf8');
  const [displayEncoding, setDisplayEncoding] = useState<NetDataEncoding>('utf8');
  const [lineEnding, setLineEnding] = useState<'none' | '\\r\\n' | '\\r' | '\\n'>('none');
  const [messageFilter, setMessageFilter] = useState<'all' | 'send' | 'recv'>('all');
  const [timerInterval, setTimerInterval] = useState('1000');
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  const encodingRef = useRef(encoding);
  const lineEndingRef = useRef(lineEnding);
  inputRef.current = input;
  encodingRef.current = encoding;
  lineEndingRef.current = lineEnding;

  const startSendTimer = useCallback(() => {
    if (timerRef.current) return;
    const ms = parseInt(timerInterval) || 1000;
    setTimerRunning(true);
    timerRef.current = setInterval(() => {
      if (!inputRef.current.trim()) return;
      const suffix = lineEndingRef.current === 'none' ? '' : lineEndingRef.current === '\\r\\n' ? '\r\n' : lineEndingRef.current === '\\r' ? '\r' : '\n';
      sendData(sessionId, inputRef.current + suffix, encodingRef.current);
    }, ms);
  }, [timerInterval, sessionId, sendData]);

  const stopSendTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setTimerRunning(false);
  }, []);

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  const filteredMessages = messageFilter === 'all' ? messages : messages.filter((m) => m.direction === messageFilter);

  useEffect(() => {
    const container = messagesEndRef.current?.parentElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !session) return;
    const suffix = lineEnding === 'none' ? '' : lineEnding === '\\r\\n' ? '\r\n' : lineEnding === '\\r' ? '\r' : '\n';
    sendData(sessionId, input + suffix, encoding);
    setInput('');
  }, [input, sessionId, encoding, lineEnding, session, sendData]);

  if (!session) return null;
  const isOpen = session.status === 'open';

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <StatusDot status={session.status} />
        <span style={{ color: 'var(--color-text-primary)' }}>
          {session.config.path}
        </span>
        <span style={{ color: 'var(--color-text-dim)' }}>
          {session.config.baudRate} {session.config.dataBits}{session.config.parity[0].toUpperCase()}{session.config.stopBits}
        </span>
        <span className="px-1.5 py-0.5 rounded text-[10px]" style={{
          backgroundColor: 'var(--color-input-bg)',
          color: isOpen ? '#16a34a' : '#6b7280',
          border: '1px solid var(--color-input-border)',
        }}>
          {session.status}
        </span>

        {/* DTR / RTS toggles */}
        {isOpen && (
          <>
            <button onClick={() => setDTR(sessionId, !session.dtr)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{
                backgroundColor: 'var(--color-input-bg)',
                color: session.dtr ? '#16a34a' : '#6b7280',
                border: '1px solid var(--color-input-border)',
              }}>
              DTR {session.dtr ? 'ON' : 'OFF'}
            </button>
            <button onClick={() => setRTS(sessionId, !session.rts)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{
                backgroundColor: 'var(--color-input-bg)',
                color: session.rts ? '#16a34a' : '#6b7280',
                border: '1px solid var(--color-input-border)',
              }}>
              RTS {session.rts ? 'ON' : 'OFF'}
            </button>
          </>
        )}

        <span className="text-[10px] font-mono cursor-pointer" style={{ color: 'var(--color-text-dim)' }}
          onClick={() => resetCounters(sessionId)} title={t('serial.resetCounters')}>
          ↑{txBytes} ↓{rxBytes}
        </span>

        <div className="ml-auto flex gap-1">
          {(['all', 'send', 'recv'] as const).map((f) => (
            <button key={f} onClick={() => setMessageFilter(f)}
              className="px-1.5 py-0.5 text-[10px] rounded"
              style={{
                backgroundColor: messageFilter === f ? 'var(--color-accent)' : 'var(--color-input-bg)',
                color: messageFilter === f ? '#fff' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-input-border)',
              }}>
              {f === 'all' ? 'All' : f === 'send' ? '↑S' : '↓R'}
            </button>
          ))}
          <select value={displayEncoding} onChange={(e) => setDisplayEncoding(e.target.value as NetDataEncoding)}
            className="px-2 py-0.5 text-[10px] rounded outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}>
            <option value="utf8">UTF-8</option>
            <option value="hex">HEX</option>
          </select>
          <button onClick={() => clearMessages(sessionId)} className="px-2 py-0.5 text-[10px] rounded"
            style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
            {t('common.clear')}
          </button>
          <button onClick={async () => {
            if (recording) {
              await stopRecording(sessionId);
            } else {
              const filePath = await window.api.dialog.selectSaveLocation(`serial-${sessionId.slice(0, 8)}.txt`);
              if (filePath) {
                await startRecording(sessionId, filePath);
              }
            }
          }}
            className="px-2 py-0.5 text-[10px] rounded"
            style={{
              backgroundColor: recording ? 'rgba(239,68,68,0.15)' : 'var(--color-input-bg)',
              color: recording ? '#ef4444' : 'var(--color-text-secondary)',
              border: `1px solid ${recording ? 'rgba(239,68,68,0.3)' : 'var(--color-input-border)'}`,
            }}
            title={recording ? t('serial.stopRecTitle') : t('serial.startRecTitle')}>
            {recording ? t('serial.rec') : '⏺'}
          </button>
          {isOpen ? (
            <button onClick={() => closePort(sessionId)} className="px-2 py-0.5 text-[10px] rounded"
              style={{ backgroundColor: 'var(--color-input-bg)', color: '#dc2626', border: '1px solid var(--color-input-border)' }}>
              {t('serial.close')}
            </button>
          ) : (
            <button onClick={() => reopenPort(sessionId)} className="px-2 py-0.5 text-[10px] rounded"
              style={{ backgroundColor: 'var(--color-input-bg)', color: '#16a34a', border: '1px solid var(--color-input-border)' }}>
              {t('serial.reconnect')}
            </button>
          )}
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex-shrink-0 flex gap-0 text-[10px]" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {(['raw', 'modbus'] as const).map((m) => (
          <button key={m} onClick={() => setViewMode(sessionId, m)}
            className="px-3 py-1"
            style={{
              color: viewMode === m ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              borderBottom: viewMode === m ? '2px solid var(--color-accent)' : '2px solid transparent',
              backgroundColor: 'transparent',
            }}>
            {m === 'raw' ? t('serial.modeRaw') : t('serial.modeModbus')}
          </button>
        ))}
      </div>

      {/* Modbus RTU view — always mounted, hidden via CSS */}
      <div className={viewMode === 'modbus' ? 'flex-1 flex flex-col overflow-hidden min-h-0' : 'hidden'}>
        <ModbusRtuView sessionId={sessionId} active={viewMode === 'modbus'} />
      </div>

      {/* Raw data view — always mounted, hidden via CSS */}
      <div className={viewMode === 'raw' ? 'flex-1 flex flex-col overflow-hidden min-h-0' : 'hidden'}>
      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)' }}>
        {filteredMessages.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--color-text-dim)' }}>
            {messages.length === 0 ? t('serial.noData') : t('serial.noMatch')}
          </div>
        )}
        {filteredMessages.map((msg) => (
          <MessageItem key={msg.id} msg={msg} displayEncoding={displayEncoding} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Send Templates */}
      <SerialSendTemplatePanel sessionId={sessionId} />

      {/* Send bar */}
      {isOpen && (
        <div className="flex items-center gap-2 px-2 py-1.5 flex-shrink-0 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
          <select value={encoding} onChange={(e) => setEncoding(e.target.value as NetDataEncoding)}
            className="px-1 py-0.5 text-[10px] rounded outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}>
            <option value="utf8">UTF-8</option>
            <option value="hex">HEX</option>
          </select>
          <select value={lineEnding} onChange={(e) => setLineEnding(e.target.value as typeof lineEnding)}
            className="px-1 py-0.5 text-[10px] rounded outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}>
            <option value="none">{t('serial.noNewline')}</option>
            <option value="\r\n">\r\n</option>
            <option value="\r">\r</option>
            <option value="\n">\n</option>
          </select>
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            placeholder={encoding === 'hex' ? t('serial.hexPlaceholder') : t('serial.textPlaceholder')}
            className="flex-1 min-w-[120px] px-1.5 py-0.5 text-[11px] rounded outline-none font-mono"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }} />
          <button onClick={handleSend} disabled={!input.trim()}
            className="px-3 py-1 text-[11px] rounded text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-50">
            {t('common.send')}
          </button>
          <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>|</span>
          <input value={timerInterval} onChange={(e) => setTimerInterval(e.target.value)}
            className="w-14 px-1.5 py-0.5 text-[11px] rounded text-center" disabled={timerRunning}
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }} />
          <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>ms</span>
          {!timerRunning ? (
            <button onClick={() => startSendTimer()} disabled={!input.trim()}
              className="px-2 py-1 text-[11px] rounded text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-50">
              ⏱ Timer
            </button>
          ) : (
            <button onClick={() => stopSendTimer()}
              className="px-2 py-1 text-[11px] rounded text-white bg-red-500 hover:bg-red-600">
              ⏹ Stop
            </button>
          )}
        </div>
      )}

      {session.error && (
        <div className="px-3 py-1.5 text-xs text-red-400" style={{ borderTop: '1px solid var(--color-border)' }}>
          Error: {session.error}
        </div>
      )}
      </div>
    </div>
  );
}

export default function SerialDebugPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const sessions = useSerialStore((s) => s.sessions);
  const activeSessionId = useSerialStore((s) => s.activeSessionId);
  const setActiveSession = useSerialStore((s) => s.setActiveSession);
  const removeSession = useSerialStore((s) => s.removeSession);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('serial.title')}</span>
        <div className="flex gap-1">
          <button onClick={() => setShowCreate(!showCreate)}
            className="px-2 py-0.5 text-xs rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
            style={{ lineHeight: '1', paddingTop: '4px', paddingBottom: '4px' }}>
            {t('serial.new')}
          </button>
          <button onClick={onClose} className="px-1.5 py-0.5 text-xs rounded-md"
            style={{ color: 'var(--color-text-muted)' }}>
            ✕
          </button>
        </div>
      </div>

      {showCreate && <OpenPortForm onOpened={() => setShowCreate(false)} />}

      {/* Session tabs */}
      {sessions.length > 0 && (
        <div className="flex-shrink-0 flex overflow-x-auto gap-0.5 px-2 py-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {sessions.map((s) => (
            <div key={s.id} onClick={() => setActiveSession(s.id)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md cursor-pointer whitespace-nowrap"
              style={{
                backgroundColor: activeSessionId === s.id ? 'var(--color-hover-bg)' : 'transparent',
                color: activeSessionId === s.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}>
              <StatusDot status={s.status} />
              <span>{s.config.path} @ {s.config.baudRate}</span>
              <button onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                className="ml-1 hover:text-red-400" style={{ color: 'var(--color-text-dim)' }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Active session view */}
      {activeSessionId ? (
        <SessionView sessionId={activeSessionId} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--color-text-dim)' }}>
          {sessions.length === 0 ? t('serial.emptyNew') : t('serial.selectSession')}
        </div>
      )}
    </div>
  );
}
