import React, { useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { useLayoutStore } from '../store/layout-store';
import { disposeTerminal } from './TerminalView';

export default function TabBar() {
  const sessions = useAppStore((s) => s.sessions);
  const disconnectSession = useAppStore((s) => s.disconnectSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const hosts = useAppStore((s) => s.hosts);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSplitPane = useAppStore((s) => s.toggleSplitPane);
  const splitPaneVisible = useAppStore((s) => s.splitPaneVisible);
  const toggleCommandHistory = useAppStore((s) => s.toggleCommandHistory);
  const commandHistoryVisible = useAppStore((s) => s.commandHistoryVisible);

  const tabs = useLayoutStore((s) => s.tabs);
  const activeTabId = useLayoutStore((s) => s.activeTabId);
  const workspaces = useLayoutStore((s) => s.workspaces);

  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const getHostName = (hostEntryId: string) => {
    const host = hosts.find((h) => h.id === hostEntryId);
    return host?.name || 'Unknown';
  };

  const getSessionLabel = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return 'Unknown';
    return getHostName(session.hostEntryId);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-green-400';
      case 'connecting': return 'bg-yellow-400 animate-pulse';
      case 'error': return 'bg-red-400';
      default: return 'bg-gray-500';
    }
  };

  const getSessionStatus = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    return session?.status || 'disconnected';
  };

  const handleCloseSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    useLayoutStore.getState().removeSessionTab(sessionId);
    await disconnectSession(sessionId);
    disposeTerminal(sessionId);
    removeSession(sessionId);
  };

  const handleCloseWorkspace = async (e: React.MouseEvent, workspaceId: string) => {
    e.stopPropagation();
    const ws = workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    for (const sid of [...ws.sessionIds]) {
      useLayoutStore.getState().removeSessionTab(sid);
      await disconnectSession(sid);
      disposeTerminal(sid);
      removeSession(sid);
    }
  };

  const handleTabClick = (tabId: string) => {
    useLayoutStore.getState().switchToTab(tabId);
    const ws = workspaces.find((w) => w.id === tabId);
    if (ws && ws.sessionIds.length > 0) {
      useAppStore.getState().setActiveSession(ws.sessionIds[0]);
    } else {
      useAppStore.getState().setActiveSession(tabId);
    }
  };

  // --- HTML5 Drag and Drop ---
  // This fires native drag events which LeafPaneWrapper/DropZoneOverlay can detect

  const emptyImg = useRef<HTMLImageElement | null>(null);

  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData('text/session-id', sessionId);
    e.dataTransfer.effectAllowed = 'move';
    // Use transparent 1x1 ghost — we don't need the default drag image
    if (!emptyImg.current) {
      emptyImg.current = new Image();
      emptyImg.current.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
    e.dataTransfer.setDragImage(emptyImg.current, 0, 0);
  };

  const handleTabDragOver = (e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const sourceId = e.dataTransfer.types.includes('text/session-id') ? 'pending' : null;
    if (sourceId) {
      setDropTargetId(tabId);
    }
  };

  const handleTabDragLeave = (e: React.DragEvent, tabId: string) => {
    const related = e.relatedTarget as HTMLElement | null;
    const current = e.currentTarget as HTMLElement;
    if (!related || !current.contains(related)) {
      if (dropTargetId === tabId) setDropTargetId(null);
    }
  };

  const handleTabDrop = (e: React.DragEvent, targetId: string, targetType: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);

    const sourceId = e.dataTransfer.getData('text/session-id');
    if (!sourceId || sourceId === targetId) return;

    if (targetType === 'workspace') {
      const ws = useLayoutStore.getState().workspaces.find((w) => w.id === targetId);
      if (ws && !ws.sessionIds.includes(sourceId)) {
        useLayoutStore.getState().addToWorkspace(targetId, sourceId, '', 'right');
      }
    } else {
      useLayoutStore.getState().mergeIntoWorkspace(targetId, sourceId, 'right');
      const store = useLayoutStore.getState();
      const ws = store.workspaces.find((w) =>
        w.sessionIds.includes(targetId) && w.sessionIds.includes(sourceId)
      );
      if (ws) {
        store.switchToTab(ws.id);
        useAppStore.getState().setActiveSession(ws.sessionIds[0]);
      }
    }
  };

  const handleDragEnd = () => {
    setDropTargetId(null);
  };

  return (
    <div
      className="app-drag flex items-center bg-[var(--color-sidebar)] h-9 px-1 gap-0.5 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      {sidebarCollapsed && (
        <button
          onClick={toggleSidebar}
          className="app-no-drag px-2 py-1 text-xs transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          title="Show sidebar"
        >
          ▶
        </button>
      )}

      <div
        className="app-no-drag flex items-center gap-0.5 overflow-x-auto min-w-0"
        style={{ maxWidth: '60%' }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDrop={(e) => {
          e.preventDefault();
          const sid = e.dataTransfer.getData('text/session-id');
          if (!sid) return;
          const store = useLayoutStore.getState();
          const ws = store.workspaces.find((w) => w.sessionIds.includes(sid));
          if (ws) {
            store.removeFromWorkspace(ws.id, sid);
            useAppStore.getState().setActiveSession(sid);
          }
        }}
      >
        {tabs.map((tab) => {
          if (tab.type === 'session') {
            const sid = tab.sessionId;
            const isActive = activeTabId === sid;
            return (
              <div
                key={sid}
                data-tab-id={sid}
                data-tab-type="session"
                draggable
                onDragStart={(e) => handleDragStart(e, sid)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleTabDragOver(e, sid)}
                onDragLeave={(e) => handleTabDragLeave(e, sid)}
                onDrop={(e) => handleTabDrop(e, sid, 'session')}
                onClick={() => handleTabClick(sid)}
                className={`
                  flex items-center gap-1.5 px-3 py-1 rounded-t-md cursor-grab
                  text-xs transition-colors min-w-0 max-w-[180px] group select-none
                  ${dropTargetId === sid ? 'ring-2 ring-emerald-400/60 bg-emerald-400/10' : ''}
                `}
                style={{
                  ...(isActive
                    ? { backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }
                    : { color: 'var(--color-text-muted)' }),
                }}
                onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; } }}
                onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--color-text-muted)'; } }}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor(getSessionStatus(sid))}`} />
                <span className="truncate">{getSessionLabel(sid)}</span>
                <button
                  onClick={(e) => handleCloseSession(e, sid)}
                  className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  style={{ color: 'var(--color-text-dim)' }}
                >
                  ×
                </button>
              </div>
            );
          }

          const ws = workspaces.find((w) => w.id === tab.workspaceId);
          if (!ws) return null;
          const isActive = activeTabId === ws.id;
          return (
            <div
              key={ws.id}
              data-tab-id={ws.id}
              data-tab-type="workspace"
              onDragOver={(e) => handleTabDragOver(e, ws.id)}
              onDragLeave={(e) => handleTabDragLeave(e, ws.id)}
              onDrop={(e) => handleTabDrop(e, ws.id, 'workspace')}
              onClick={() => handleTabClick(ws.id)}
              className={`
                flex items-center gap-1.5 px-3 py-1 rounded-t-md cursor-pointer
                text-xs transition-colors min-w-0 max-w-[200px] group select-none
                ${dropTargetId === ws.id ? 'ring-2 ring-emerald-400/60 bg-emerald-400/10' : ''}
              `}
              style={{
                ...(isActive
                  ? { backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }
                  : { color: 'var(--color-text-muted)' }),
              }}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--color-text-muted)'; } }}
            >
              <span className="text-[10px] opacity-60">⊞</span>
              <span className="truncate">{ws.name} ({ws.sessionIds.length})</span>
              <button
                onClick={(e) => handleCloseWorkspace(e, ws.id)}
                className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                style={{ color: 'var(--color-text-dim)' }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Drag region */}
      <div className="flex-1 min-w-[60px]" />

      {sessions.length > 0 && (
        <>
          <button
            onClick={toggleCommandHistory}
            className={`app-no-drag px-2 py-1 text-xs rounded transition-colors ${
              commandHistoryVisible ? 'text-[var(--color-accent)]' : ''
            }`}
            style={{ color: commandHistoryVisible ? undefined : 'var(--color-text-muted)' }}
            title={commandHistoryVisible ? 'Hide command history' : 'Show command history'}
          >
            🕐
          </button>
          <button
            onClick={toggleSplitPane}
            className={`app-no-drag px-2 py-1 text-xs rounded transition-colors ${
              splitPaneVisible ? 'text-[var(--color-accent)]' : ''
            }`}
            style={{ color: splitPaneVisible ? undefined : 'var(--color-text-muted)' }}
            title={splitPaneVisible ? 'Hide file browser' : 'Show file browser'}
          >
            📁
          </button>
        </>
      )}

      {/* Window controls */}
      <div className="app-no-drag flex items-center">
        <button
          onClick={() => window.api.window?.minimize?.()}
          className="w-[46px] h-9 flex items-center justify-center hover:bg-[var(--color-hover-bg)] transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          title="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button
          onClick={() => window.api.window?.maximize?.()}
          className="w-[46px] h-9 flex items-center justify-center hover:bg-[var(--color-hover-bg)] transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          title="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1"/></svg>
        </button>
        <button
          onClick={() => window.api.window?.close?.()}
          className="w-[46px] h-9 flex items-center justify-center hover:bg-red-500/80 hover:text-white transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
      </div>
    </div>
  );
}
