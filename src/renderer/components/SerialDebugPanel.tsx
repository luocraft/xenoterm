import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSerialStore, hexDecode } from '../store/serial-store';
import type { SerialConfig, NetDataEncoding, SerialMessage } from '../../shared/types';

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'open' ? '#4ade80' :
    status === 'opening' ? '#facc15' :
    status === 'error' ? '#f87171' : '#6b7280';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: color, marginRight: 6 }} />;
}

function MessageItem({ msg, displayEncoding }: { msg: SerialMessage; displayEncoding: NetDataEncoding }) {
  const isSend = msg.direction === 'send';
  const displayData = displayEncoding === 'utf8' ? hexDecode(msg.data) : msg.data.replace(/(.{2})/g, '$1 ').trim();
  const time = new Date(msg.timestamp).toLocaleTimeString();

  return (
    <div className="px-2 py-1 text-xs font-mono border-b"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: isSend ? 'rgba(59,130,246,0.05)' : 'rgba(74,222,128,0.05)',
      }}>
      <div className="flex items-center gap-2 mb-0.5">
        <span style={{ color: isSend ? '#60a5fa' : '#4ade80', fontWeight: 600 }}>
          {isSend ? '→ TX' : '← RX'}
        </span>
        <span className="ml-auto" style={{ color: 'var(--color-text-dim)' }}>{time}</span>
      </div>
      <div style={{ color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}>{displayData}</div>
    </div>
  );
}

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

function OpenPortForm({ onOpened }: { onOpened: () => void }) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!portPath) { setError('Please select a port'); return; }
    setError('');
    setLoading(true);
    try {
      const config: SerialConfig = {
        path: portPath,
        baudRate,
        dataBits,
        stopBits,
        parity,
        rtscts: flowControl === 'rtscts',
        xon: flowControl === 'xonxoff',
        xoff: flowControl === 'xonxoff',
      };
      await openPort(config);
      onOpened();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    color: 'var(--color-text-primary)',
  };

  const labelStyle: React.CSSProperties = { color: 'var(--color-text-secondary)' };

  return (
    <form onSubmit={handleSubmit} className="p-3 space-y-3 overflow-visible" style={{ borderBottom: '1px solid var(--color-border)' }}>
      {/* Port row */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] font-medium" style={labelStyle}>Port</label>
          <button type="button" onClick={refreshPorts}
            className="text-[10px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
            style={inputStyle} title="Refresh ports">
            ↻
          </button>
        </div>
        <select value={portPath} onChange={(e) => setPortPath(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded-lg outline-none" style={inputStyle}>
          <option value="">Select port...</option>
          {availablePorts.map((p) => (
            <option key={p.path} value={p.path}>
              {p.path}{p.manufacturer ? ` — ${p.manufacturer}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Baud + Data Bits */}
      <div className="grid grid-cols-4 gap-1.5">
        <div className="col-span-3">
          <label className="text-[10px] font-medium block mb-1" style={labelStyle}>Baud Rate</label>
          <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}
            className="w-full px-2 py-1.5 text-xs rounded-lg outline-none" style={inputStyle}>
            {BAUD_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-medium block mb-1" style={labelStyle}>Bits</label>
          <select value={dataBits} onChange={(e) => setDataBits(Number(e.target.value) as 5|6|7|8)}
            className="w-full px-2 py-1.5 text-xs rounded-lg outline-none" style={inputStyle}>
            {[5,6,7,8].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Stop + Parity + Flow */}
      <div className="grid grid-cols-3 gap-1.5">
        <div>
          <label className="text-[10px] font-medium block mb-1" style={labelStyle}>Stop Bits</label>
          <select value={stopBits} onChange={(e) => setStopBits(Number(e.target.value) as 1|1.5|2)}
            className="w-full px-2 py-1.5 text-xs rounded-lg outline-none" style={inputStyle}>
            <option value={1}>1</option><option value={1.5}>1.5</option><option value={2}>2</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-medium block mb-1" style={labelStyle}>Parity</label>
          <select value={parity} onChange={(e) => setParity(e.target.value as 'none'|'even'|'odd')}
            className="w-full px-2 py-1.5 text-xs rounded-lg outline-none" style={inputStyle}>
            <option value="none">None</option><option value="even">Even</option><option value="odd">Odd</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-medium block mb-1" style={labelStyle}>Flow</label>
          <select value={flowControl} onChange={(e) => setFlowControl(e.target.value as 'none'|'rtscts'|'xonxoff')}
            className="w-full px-2 py-1.5 text-xs rounded-lg outline-none" style={inputStyle}>
            <option value="none">None</option><option value="rtscts">RTS/CTS</option><option value="xonxoff">XON/XOFF</option>
          </select>
        </div>
      </div>

      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}

      <button type="submit" disabled={loading}
        className="w-full py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40">
        {loading ? 'Opening...' : 'Open Port'}
      </button>
    </form>
  );
}

function SessionView({ sessionId }: { sessionId: string }) {
  const session = useSerialStore((s) => s.sessions.find((ss) => ss.id === sessionId));
  const messages = useSerialStore((s) => s.messages.get(sessionId) || []);
  const sendData = useSerialStore((s) => s.sendData);
  const clearMessages = useSerialStore((s) => s.clearMessages);
  const closePort = useSerialStore((s) => s.closePort);
  const setDTR = useSerialStore((s) => s.setDTR);
  const setRTS = useSerialStore((s) => s.setRTS);

  const [input, setInput] = useState('');
  const [encoding, setEncoding] = useState<NetDataEncoding>('utf8');
  const [displayEncoding, setDisplayEncoding] = useState<NetDataEncoding>('utf8');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !session) return;
    sendData(sessionId, input, encoding);
    setInput('');
  }, [input, sessionId, encoding, session, sendData]);

  if (!session) return null;
  const isOpen = session.status === 'open';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <StatusDot status={session.status} />
        <span style={{ color: 'var(--color-text-primary)' }}>
          {session.config.path}
        </span>
        <span style={{ color: 'var(--color-text-dim)' }}>
          {session.config.baudRate} {session.config.dataBits}{session.config.parity[0].toUpperCase()}{session.config.stopBits}
        </span>
        <span className="px-1.5 py-0.5 rounded text-[10px]" style={{
          backgroundColor: isOpen ? 'rgba(74,222,128,0.15)' : 'rgba(107,114,128,0.15)',
          color: isOpen ? '#4ade80' : '#6b7280',
        }}>
          {session.status}
        </span>

        {/* DTR / RTS toggles */}
        {isOpen && (
          <>
            <button onClick={() => setDTR(sessionId, !session.dtr)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{
                backgroundColor: session.dtr ? 'rgba(74,222,128,0.15)' : 'rgba(107,114,128,0.1)',
                color: session.dtr ? '#4ade80' : '#6b7280',
                border: '1px solid var(--color-input-border)',
              }}>
              DTR {session.dtr ? 'ON' : 'OFF'}
            </button>
            <button onClick={() => setRTS(sessionId, !session.rts)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{
                backgroundColor: session.rts ? 'rgba(74,222,128,0.15)' : 'rgba(107,114,128,0.1)',
                color: session.rts ? '#4ade80' : '#6b7280',
                border: '1px solid var(--color-input-border)',
              }}>
              RTS {session.rts ? 'ON' : 'OFF'}
            </button>
          </>
        )}

        <div className="ml-auto flex gap-1">
          <select value={displayEncoding} onChange={(e) => setDisplayEncoding(e.target.value as NetDataEncoding)}
            className="px-1 py-0.5 text-[10px] rounded outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}>
            <option value="utf8">UTF-8</option>
            <option value="hex">HEX</option>
          </select>
          <button onClick={() => clearMessages(sessionId)} className="px-1.5 py-0.5 text-[10px] rounded"
            style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-muted)', border: '1px solid var(--color-input-border)' }}>
            Clear
          </button>
          {isOpen && (
            <button onClick={() => closePort(sessionId)} className="px-1.5 py-0.5 text-[10px] rounded text-red-400"
              style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)' }}>
              Close
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)' }}>
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--color-text-dim)' }}>
            No data yet
          </div>
        )}
        {messages.map((msg) => (
          <MessageItem key={msg.id} msg={msg} displayEncoding={displayEncoding} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Send bar */}
      {isOpen && (
        <div className="flex gap-1 p-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <select value={encoding} onChange={(e) => setEncoding(e.target.value as NetDataEncoding)}
            className="px-1 py-1 text-xs rounded outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}>
            <option value="utf8">UTF-8</option>
            <option value="hex">HEX</option>
          </select>
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            placeholder={encoding === 'hex' ? 'Hex (e.g. 48656C6C6F)' : 'Text to send...'}
            className="flex-1 px-2 py-1 text-xs rounded-md outline-none font-mono"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }} />
          <button onClick={handleSend} disabled={!input.trim()}
            className="px-3 py-1 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
            Send
          </button>
        </div>
      )}

      {session.error && (
        <div className="px-3 py-1.5 text-xs text-red-400" style={{ borderTop: '1px solid var(--color-border)' }}>
          Error: {session.error}
        </div>
      )}
    </div>
  );
}

export default function SerialDebugPanel({ onClose }: { onClose: () => void }) {
  const sessions = useSerialStore((s) => s.sessions);
  const activeSessionId = useSerialStore((s) => s.activeSessionId);
  const setActiveSession = useSerialStore((s) => s.setActiveSession);
  const removeSession = useSerialStore((s) => s.removeSession);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-sidebar)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>⚡ Serial Debug</span>
        <div className="flex gap-1">
          <button onClick={() => setShowCreate(!showCreate)}
            className="px-2 py-0.5 text-xs rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
            style={{ lineHeight: '1', paddingTop: '4px', paddingBottom: '4px' }}>
            + New
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
        <div className="flex overflow-x-auto gap-0.5 px-2 py-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
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
          {sessions.length === 0 ? 'Click "+ New" to open a serial port' : 'Select a session'}
        </div>
      )}
    </div>
  );
}
