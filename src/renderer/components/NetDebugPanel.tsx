import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNetDebugStore, hexDecode } from '../store/net-debug-store';
import type { NetProtocol, NetDataEncoding, NetMessage } from '../store/net-debug-store';
import { useT } from '../i18n';

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
    <div className="flex px-2 py-0.5 font-mono text-[10px]" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="shrink-0 mr-1" style={{ whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--color-text-dim)' }}>{time}</span>{' '}
        <span style={{ color: isSend ? '#2563eb' : '#16a34a', fontWeight: 500 }}>
          {isSend ? '→ SEND' : '← RECV'}
        </span>{' '}
        {msg.remoteAddress && (
          <span style={{ color: 'var(--color-text-dim)' }}>{msg.remoteAddress} </span>
        )}
      </span>
      <span style={{ color: 'var(--color-text-primary)', wordBreak: 'break-all' }}>{displayData}</span>
    </div>
  );
}

function CreateSessionForm({ onCreated }: { onCreated: () => void }) {
  const t = useT();
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
    <form onSubmit={handleSubmit} className="px-3 py-2 space-y-1.5">
      <div className="flex gap-1">
        {(['tcp-client', 'tcp-server', 'udp'] as NetProtocol[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setProtocol(p)}
            className="flex-1 px-2 py-0.5 text-[10px] rounded transition-colors"
            style={{
              backgroundColor: protocol === p ? 'var(--color-accent)' : 'var(--color-input-bg)',
              color: protocol === p ? '#fff' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-input-border)',
            }}
          >
            {p === 'tcp-client' ? t('net.tcpClient') : p === 'tcp-server' ? t('net.tcpServer') : t('net.udp')}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 items-center">
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder={t('net.host')}
          className="flex-1 px-2 py-0.5 text-[10px] rounded outline-none"
          style={inputStyle}
        />
        <input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder={t('net.port')}
          className="w-16 px-2 py-0.5 text-[10px] rounded outline-none"
          style={inputStyle}
        />
        {protocol === 'udp' && (
          <input
            value={localPort}
            onChange={(e) => setLocalPort(e.target.value)}
            placeholder={t('net.localBind')}
            className="w-24 px-2 py-0.5 text-[10px] rounded outline-none"
            style={inputStyle}
          />
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-3 py-0.5 text-[10px] rounded bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? t('common.connecting') : protocol === 'tcp-server' ? t('net.startListen') : t('common.connect')}
        </button>
      </div>

      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </form>
  );
}

function NetSendTemplatePanel({ sessionId }: { sessionId: string }) {
  const t = useT();
  const templates = useNetDebugStore((s) => s.sendTemplates.get(sessionId) || []);
  const addTemplate = useNetDebugStore((s) => s.addTemplate);
  const removeTemplate = useNetDebugStore((s) => s.removeTemplate);
  const updateTemplate = useNetDebugStore((s) => s.updateTemplate);
  const sendTpl = useNetDebugStore((s) => s.sendTemplate);
  const toggleTimer = useNetDebugStore((s) => s.toggleTemplateTimer);
  const session = useNetDebugStore((s) => s.sessions.find((ss) => ss.id === sessionId));
  const [collapsed, setCollapsed] = useState(false);

  const isActive = session && (session.status === 'connected' || session.status === 'listening');
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
              <span className="w-6"></span>
              <span className="w-6"></span>
              <span className="w-20">{t('tpl.name')}</span>
              <span className="w-16">{t('tpl.encoding')}</span>
              <span className="flex-1">{t('tpl.data')}</span>
              <span className="w-16">{t('tpl.intervalMs')}</span>
              <span className="w-8"></span>
            </div>
            <div className="overflow-y-auto flex-1">
              {templates.map((tpl) => (
                <div key={tpl.id} className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-[var(--color-hover-bg)]">
                  <button onClick={() => isActive && sendTpl(sessionId, tpl.id)}
                    className="w-6 text-center text-[10px]"
                    style={{ color: 'var(--color-text-secondary)', cursor: isActive ? 'pointer' : 'default' }}
                    title={t('tpl.sendOnce')}>📤</button>
                  <button onClick={() => isActive && toggleTimer(sessionId, tpl.id)}
                    className="w-6 text-center text-[10px]"
                    style={{ color: tpl.enabled ? '#4ade80' : 'var(--color-text-dim)', cursor: isActive ? 'pointer' : 'default' }}
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

function SessionView({ sessionId }: { sessionId: string }) {
  const t = useT();
  const session = useNetDebugStore((s) => s.sessions.find((ss) => ss.id === sessionId));
  const messages = useNetDebugStore((s) => s.messages.get(sessionId) || []);
  const sendData = useNetDebugStore((s) => s.sendData);
  const clearMessages = useNetDebugStore((s) => s.clearMessages);
  const closeSession = useNetDebugStore((s) => s.closeSession);
  const reopenSession = useNetDebugStore((s) => s.reopenSession);
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
    const container = messagesEndRef.current?.parentElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
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
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 text-[10px]" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <StatusDot status={session.status} />
        <span style={{ color: 'var(--color-text-primary)' }}>
          {session.protocol.toUpperCase()} {session.host}:{session.port}
        </span>
        {session.localPort && session.protocol === 'udp' && (
          <span style={{ color: 'var(--color-text-secondary)' }}>(local: {session.localPort})</span>
        )}
        <span className="px-1.5 py-0.5 rounded text-[10px]" style={{
          backgroundColor: 'var(--color-input-bg)',
          color: isActive ? '#16a34a' : '#6b7280',
          border: '1px solid var(--color-input-border)',
        }}>
          {session.status}
        </span>
        {session.clients && session.clients.length > 0 && (
          <span style={{ color: 'var(--color-text-dim)' }}>
            {session.clients.length} {t('net.clients')}
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
            {t('common.clear')}
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
            title={recording ? t('net.stopRecTitle') : t('net.startRecTitle')}>
            {recording ? t('net.rec') : '⏺'}
          </button>
          {isActive ? (
            <button onClick={() => closeSession(sessionId)} className="px-1.5 py-0.5 text-[10px] rounded"
              style={{ backgroundColor: 'var(--color-input-bg)', color: '#ef4444', border: '1px solid var(--color-border)' }}>
              {t('net.close')}
            </button>
          ) : (
            <button onClick={() => reopenSession(sessionId)} className="px-1.5 py-0.5 text-[10px] rounded"
              style={{ backgroundColor: 'var(--color-input-bg)', color: '#16a34a', border: '1px solid var(--color-border)' }}>
              {t('net.reconnect')}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1" style={{ backgroundColor: 'var(--color-surface)' }}>
        {filteredMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--color-text-dim)' }}>
            <span className="text-3xl opacity-30">💬</span>
            <span className="text-xs">{messages.length === 0 ? t('net.noMessages') : t('net.noMatch')}</span>
          </div>
        )}
        {filteredMessages.map((msg) => (
          <MessageItem key={msg.id} msg={msg} displayEncoding={displayEncoding} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Send Templates */}
      <NetSendTemplatePanel sessionId={sessionId} />

      {/* Send bar */}
      {isActive && (
        <div className="flex items-center gap-2 px-2 py-1.5 flex-shrink-0 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
          {session.protocol === 'tcp-server' && session.clients && session.clients.length > 0 && (
            <select
              value={targetClient}
              onChange={(e) => updateUI(sessionId, { targetClient: e.target.value })}
              className="px-1 py-0.5 text-[10px] rounded outline-none"
              style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}
            >
              <option value="">All clients</option>
              {session.clients.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select
            value={encoding}
            onChange={(e) => updateUI(sessionId, { encoding: e.target.value as NetDataEncoding })}
            className="px-1 py-0.5 text-[10px] rounded outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-secondary)' }}
          >
            <option value="utf8">UTF-8</option>
            <option value="hex">HEX</option>
          </select>
          <input
            value={input}
            onChange={(e) => updateUI(sessionId, { input: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSendAndClear(); }}
            placeholder={encoding === 'hex' ? t('net.hexPlaceholder') : t('net.textPlaceholder')}
            className="flex-1 min-w-[120px] px-1.5 py-0.5 text-[11px] rounded outline-none font-mono"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
          />
          <button
            onClick={handleSendAndClear}
            disabled={!input.trim()}
            className="px-3 py-1 text-[11px] rounded text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-40"
          >
            {t('common.send')}
          </button>
          <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>|</span>
          <input
            value={timerInterval}
            onChange={(e) => updateUI(sessionId, { timerInterval: e.target.value })}
            className="w-14 px-1.5 py-0.5 text-[11px] rounded text-center"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
            disabled={timerRunning}
          />
          <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>ms</span>
          {!timerRunning ? (
            <button
              onClick={() => startTimer(sessionId)}
              disabled={!input.trim()}
              className="px-2 py-1 text-[11px] rounded text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-50"
            >
              ⏱ Timer
            </button>
          ) : (
            <button
              onClick={() => stopTimer(sessionId)}
              className="px-2 py-1 text-[11px] rounded text-white bg-red-500 hover:bg-red-600"
            >
              ⏹ Stop
            </button>
          )}
          {timerRunning && (
            <span className="text-[10px]" style={{ color: '#16a34a' }}>{t('net.sending')}</span>
          )}
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
  const t = useT();
  const sessions = useNetDebugStore((s) => s.sessions);
  const activeSessionId = useNetDebugStore((s) => s.activeSessionId);
  const setActiveSession = useNetDebugStore((s) => s.setActiveSession);
  const removeSession = useNetDebugStore((s) => s.removeSession);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('net.title')}</span>
        <div className="flex gap-1">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-2 py-0.5 text-xs rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
            style={{ lineHeight: '1', paddingTop: '4px', paddingBottom: '4px' }}
          >
            {t('net.new')}
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
          {sessions.length === 0 ? t('net.emptyNew') : t('net.selectSession')}
        </div>
      )}
    </div>
  );
}
