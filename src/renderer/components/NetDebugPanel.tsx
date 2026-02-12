import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNetDebugStore, hexDecode } from '../store/net-debug-store';
import type { NetProtocol, NetDataEncoding, NetMessage } from '../../shared/types';

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'connected' || status === 'listening' ? '#4ade80' :
    status === 'connecting' ? '#facc15' :
    status === 'error' ? '#f87171' : '#6b7280';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: color, marginRight: 6 }} />;
}

function MessageItem({ msg, displayEncoding }: { msg: NetMessage; displayEncoding: NetDataEncoding }) {
  const isSend = msg.direction === 'send';
  const displayData = displayEncoding === 'utf8' ? hexDecode(msg.data) : msg.data.replace(/(.{2})/g, '$1 ').trim();
  const time = new Date(msg.timestamp).toLocaleTimeString();

  return (
    <div
      className="mx-2 my-0.5 px-2 py-1 text-xs font-mono rounded-md"
      style={{
        backgroundColor: isSend ? 'rgba(59,130,246,0.08)' : 'rgba(74,222,128,0.08)',
        border: `1px solid ${isSend ? 'rgba(59,130,246,0.15)' : 'rgba(74,222,128,0.15)'}`,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{
          backgroundColor: isSend ? 'rgba(59,130,246,0.15)' : 'rgba(74,222,128,0.15)',
          color: isSend ? '#60a5fa' : '#4ade80',
        }}>
          {isSend ? '↑ SEND' : '↓ RECV'}
        </span>
        {msg.remoteAddress && (
          <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{msg.remoteAddress}</span>
        )}
        <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{time}</span>
      </div>
      <div className="leading-relaxed" style={{ color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}>{displayData}</div>
    </div>
  );
}

function CreateSessionForm({ onCreated }: { onCreated: () => void }) {
  const createSession = useNetDebugStore((s) => s.createSession);
  const [protocol, setProtocol] = useState<NetProtocol>('tcp-client');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('8080');
  const [localPort, setLocalPort] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await createSession(
        protocol,
        host,
        parseInt(port, 10),
        localPort ? parseInt(localPort, 10) : undefined
      );
      onCreated();
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

  return (
    <form onSubmit={handleSubmit} className="p-3 space-y-2">
      <div className="flex gap-1">
        {(['tcp-client', 'tcp-server', 'udp'] as NetProtocol[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setProtocol(p)}
            className="flex-1 px-2 py-1 text-xs rounded-md transition-colors"
            style={{
              backgroundColor: protocol === p ? 'var(--color-accent)' : 'var(--color-input-bg)',
              color: protocol === p ? '#fff' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-input-border)',
            }}
          >
            {p === 'tcp-client' ? 'TCP Client' : p === 'tcp-server' ? 'TCP Server' : 'UDP'}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="Host"
          className="flex-1 px-2 py-1 text-xs rounded-md outline-none"
          style={inputStyle}
        />
        <input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="Port"
          className="w-20 px-2 py-1 text-xs rounded-md outline-none"
          style={inputStyle}
        />
      </div>

      {protocol === 'udp' && (
        <input
          value={localPort}
          onChange={(e) => setLocalPort(e.target.value)}
          placeholder="Local bind port (optional)"
          className="w-full px-2 py-1 text-xs rounded-md outline-none"
          style={inputStyle}
        />
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-2 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? 'Connecting...' : protocol === 'tcp-server' ? 'Start Listening' : 'Connect'}
      </button>
    </form>
  );
}

function SessionView({ sessionId }: { sessionId: string }) {
  const session = useNetDebugStore((s) => s.sessions.find((ss) => ss.id === sessionId));
  const messages = useNetDebugStore((s) => s.messages.get(sessionId) || []);
  const sendData = useNetDebugStore((s) => s.sendData);
  const clearMessages = useNetDebugStore((s) => s.clearMessages);
  const closeSession = useNetDebugStore((s) => s.closeSession);
  const ui = useNetDebugStore((s) => s.sessionUI.get(sessionId));
  const updateUI = useNetDebugStore((s) => s.updateSessionUI);
  const startTimer = useNetDebugStore((s) => s.startTimer);
  const stopTimer = useNetDebugStore((s) => s.stopTimer);
  const startRecording = useNetDebugStore((s) => s.startRecording);
  const stopRecording = useNetDebugStore((s) => s.stopRecording);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const input = ui?.input ?? '';
  const encoding = ui?.encoding ?? 'utf8';
  const displayEncoding = ui?.displayEncoding ?? 'utf8';
  const targetClient = ui?.targetClient ?? '';
  const timerInterval = ui?.timerInterval ?? '1000';
  const timerRunning = ui?.timerRunning ?? false;
  const messageFilter = ui?.messageFilter ?? 'all';
  const recording = ui?.recording ?? false;

  const filteredMessages = messageFilter === 'all' ? messages : messages.filter((m) => m.direction === messageFilter);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !session) return;
    const remote = session.protocol === 'tcp-server' && targetClient ? targetClient : undefined;
    sendData(sessionId, input, encoding, remote);
  }, [input, sessionId, encoding, targetClient, session, sendData]);

  const handleSendAndClear = useCallback(() => {
    handleSend();
    updateUI(sessionId, { input: '' });
  }, [handleSend, updateUI, sessionId]);

  if (!session) return null;

  const isActive = session.status === 'connected' || session.status === 'listening';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 text-xs" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <StatusDot status={session.status} />
        <span style={{ color: 'var(--color-text-primary)' }}>
          {session.protocol.toUpperCase()} {session.host}:{session.port}
        </span>
        {session.localPort && session.protocol === 'udp' && (
          <span style={{ color: 'var(--color-text-secondary)' }}>(local: {session.localPort})</span>
        )}
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{
          backgroundColor: isActive ? 'rgba(34,197,94,0.2)' : 'rgba(107,114,128,0.2)',
          color: isActive ? '#16a34a' : '#6b7280',
        }}>
          {session.status}
        </span>
        {session.clients && session.clients.length > 0 && (
          <span style={{ color: 'var(--color-text-dim)' }}>
            {session.clients.length} client(s)
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {(['all', 'send', 'recv'] as const).map((f) => (
            <button
              key={f}
              onClick={() => updateUI(sessionId, { messageFilter: f })}
              className="px-1.5 py-0.5 text-[10px] rounded"
              style={{
                backgroundColor: messageFilter === f ? 'var(--color-accent)' : 'var(--color-input-bg)',
                color: messageFilter === f ? '#fff' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-input-border)',
              }}
            >
              {f === 'all' ? 'All' : f === 'send' ? '↑S' : '↓R'}
            </button>
          ))}
          <select
            value={displayEncoding}
            onChange={(e) => updateUI(sessionId, { displayEncoding: e.target.value as NetDataEncoding })}
            className="px-1 py-0.5 text-[10px] rounded outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}
          >
            <option value="utf8">UTF-8</option>
            <option value="hex">HEX</option>
          </select>
          <button onClick={() => clearMessages(sessionId)} className="px-1.5 py-0.5 text-[10px] rounded"
            style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)' }}>
            Clear
          </button>
          <button onClick={async () => {
            if (recording) {
              await stopRecording(sessionId);
            } else {
              const filePath = await window.api.dialog.selectSaveLocation(`net-debug-${sessionId.slice(0, 8)}.txt`);
              if (filePath) {
                await startRecording(sessionId, filePath);
              }
            }
          }}
            className="px-1.5 py-0.5 text-[10px] rounded"
            style={{
              backgroundColor: recording ? 'rgba(239,68,68,0.15)' : 'var(--color-input-bg)',
              color: recording ? '#ef4444' : 'var(--color-text-primary)',
              border: `1px solid ${recording ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}`,
            }}
            title={recording ? 'Stop recording & save' : 'Start recording to file'}>
            {recording ? '⏺ Rec' : '⏺'}
          </button>
          {isActive && (
            <button onClick={() => closeSession(sessionId)} className="px-1.5 py-0.5 text-[10px] rounded"
              style={{ backgroundColor: 'var(--color-input-bg)', color: '#ef4444', border: '1px solid var(--color-border)' }}>
              Close
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-1" style={{ backgroundColor: 'var(--color-surface)' }}>
        {filteredMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--color-text-dim)' }}>
            <span className="text-3xl opacity-30">💬</span>
            <span className="text-xs">{messages.length === 0 ? 'No messages yet' : 'No matching messages'}</span>
          </div>
        )}
        {filteredMessages.map((msg) => (
          <MessageItem key={msg.id} msg={msg} displayEncoding={displayEncoding} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Send bar */}
      {isActive && (
        <div className="flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}>
          <div className="flex items-center gap-1.5 px-3 py-2">
            {session.protocol === 'tcp-server' && session.clients && session.clients.length > 0 && (
              <select
                value={targetClient}
                onChange={(e) => updateUI(sessionId, { targetClient: e.target.value })}
                className="px-1.5 py-1 text-[10px] rounded-md outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}
              >
                <option value="">All clients</option>
                {session.clients.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select
              value={encoding}
              onChange={(e) => updateUI(sessionId, { encoding: e.target.value as NetDataEncoding })}
              className="px-1.5 py-1 text-[10px] rounded-md outline-none"
              style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}
            >
              <option value="utf8">UTF-8</option>
              <option value="hex">HEX</option>
            </select>
            <input
              value={input}
              onChange={(e) => updateUI(sessionId, { input: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendAndClear(); }}
              placeholder={encoding === 'hex' ? 'Hex data (e.g. 48656C6C6F)' : 'Text to send...'}
              className="flex-1 px-2.5 py-1.5 text-xs rounded-lg outline-none font-mono focus:ring-1 focus:ring-[var(--color-accent)]"
              style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
            />
            <button
              onClick={handleSendAndClear}
              disabled={!input.trim()}
              className="px-4 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Send
            </button>
          </div>
          {/* Timer send row */}
          <div className="flex items-center gap-1.5 px-3 pb-2">
            <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>⏱</span>
            <input
              value={timerInterval}
              onChange={(e) => updateUI(sessionId, { timerInterval: e.target.value })}
              className="w-16 px-1.5 py-1 text-[10px] rounded-md outline-none text-center font-mono"
              style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
              disabled={timerRunning}
            />
            <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>ms</span>
            <button
              onClick={() => timerRunning ? stopTimer(sessionId) : startTimer(sessionId)}
              disabled={!input.trim() && !timerRunning}
              className="px-3 py-1 text-[10px] rounded-md transition-colors"
              style={{
                backgroundColor: timerRunning ? 'rgba(239,68,68,0.15)' : 'var(--color-accent)',
                color: timerRunning ? '#ef4444' : '#fff',
                border: `1px solid ${timerRunning ? 'rgba(239,68,68,0.3)' : 'var(--color-accent)'}`,
              }}
            >
              {timerRunning ? '⏹ Stop' : '▶ Start'}
            </button>
            {timerRunning && (
              <span className="text-[10px]" style={{ color: '#4ade80' }}>● Sending...</span>
            )}
          </div>
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


export default function NetDebugPanel({ onClose }: { onClose: () => void }) {
  const sessions = useNetDebugStore((s) => s.sessions);
  const activeSessionId = useNetDebugStore((s) => s.activeSessionId);
  const setActiveSession = useNetDebugStore((s) => s.setActiveSession);
  const removeSession = useNetDebugStore((s) => s.removeSession);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-sidebar)' }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>🔌 Net Debug</span>
        <div className="flex gap-1">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-2 py-0.5 text-xs rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
            style={{ lineHeight: '1', paddingTop: '4px', paddingBottom: '4px' }}
          >
            + New
          </button>
          <button
            onClick={onClose}
            className="px-1.5 py-0.5 text-xs rounded-md"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ✕
          </button>
        </div>
      </div>

      {showCreate && <CreateSessionForm onCreated={() => setShowCreate(false)} />}

      {/* Session tabs */}
      {sessions.length > 0 && (
        <div className="flex-shrink-0 flex overflow-x-auto gap-0.5 px-2 py-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setActiveSession(s.id)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md cursor-pointer whitespace-nowrap"
              style={{
                backgroundColor: activeSessionId === s.id ? 'var(--color-hover-bg)' : 'transparent',
                color: activeSessionId === s.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              <StatusDot status={s.status} />
              <span>{s.protocol.toUpperCase()} :{s.port}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                className="ml-1 hover:text-red-400"
                style={{ color: 'var(--color-text-dim)' }}
              >
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
          {sessions.length === 0 ? 'Click "+ New" to create a connection' : 'Select a session'}
        </div>
      )}
    </div>
  );
}
