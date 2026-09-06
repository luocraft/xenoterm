import React, { useState, useCallback } from 'react';
import { useLayoutStore } from '../store/layout-store';
import { useAppStore } from '../store/app-store';
import { useT } from '../i18n';
import { collectLeaves } from '../store/layout-tree-utils';
import TerminalView, { disposeTerminal } from './TerminalView';
import DropZoneOverlay from './DropZoneOverlay';
import type { DropPosition, LeafPane } from '../../shared/types';

interface LeafPaneWrapperProps {
  paneId: string;
  sessionId: string;
}

export default function LeafPaneWrapper({ paneId, sessionId }: LeafPaneWrapperProps) {
  const t = useT();
  const [isDragOver, setIsDragOver] = useState(false);
  const paneRef = React.useRef<HTMLDivElement>(null);

  const activeTabId = useLayoutStore((s) => s.activeTabId);
  const activePaneId = useLayoutStore((s) => s.activePaneId);
  const workspaces = useLayoutStore((s) => s.workspaces);
  const sessions = useAppStore((s) => s.sessions);
  const hosts = useAppStore((s) => s.hosts);

  const termBg = 'var(--color-terminal)';
  const termFg = 'var(--color-text-muted)';
  const termFgBold = 'var(--color-text-secondary)';

  const activeWs = workspaces.find((w) => w.id === activeTabId);
  const isInWorkspace = !!activeWs && activeWs.sessionIds.includes(sessionId);
  const hasMultiplePanes = isInWorkspace && activeWs.sessionIds.length > 1;
  const isActivePane = activePaneId === paneId;

  // Session label
  const session = sessions.find((s) => s.id === sessionId);
  const host = session ? hosts.find((h) => h.id === session.hostEntryId) : null;
  const label = host?.name || 'Unknown';
  const status = session?.status || 'disconnected';

  const handleClick = () => {
    useLayoutStore.getState().setActivePaneId(paneId);
    useAppStore.getState().setActiveSession(sessionId);
    // Focus the terminal textarea within THIS pane so it can receive keyboard input
    const textarea = paneRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
    if (textarea) textarea.focus();
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) return;
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((droppedSessionId: string, position: DropPosition) => {
    if (droppedSessionId === sessionId) {
      setIsDragOver(false);
      return;
    }
    const store = useLayoutStore.getState();
    const tabId = store.activeTabId;
    const ws = store.workspaces.find((w) => w.id === tabId);
    if (ws) {
      const isDroppedInWorkspace = ws.sessionIds.includes(droppedSessionId);
      if (isDroppedInWorkspace) {
        if (position === 'center') {
          store.replaceSessionInPane(paneId, droppedSessionId);
        } else {
          store.splitPane(paneId, droppedSessionId, position);
        }
        cleanupDuplicates();
      } else {
        store.addToWorkspace(ws.id, droppedSessionId, paneId, position);
      }
    } else {
      const mergePosition = position === 'center' ? 'right' : position;
      store.mergeIntoWorkspace(sessionId, droppedSessionId, mergePosition);
    }
    setIsDragOver(false);
  }, [paneId, sessionId]);

  const handleClosePane = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeWs) {
      useLayoutStore.getState().removeSessionTab(sessionId);
      await useAppStore.getState().disconnectSession(sessionId);
      disposeTerminal(sessionId);
      useAppStore.getState().removeSession(sessionId);
    }
  }, [sessionId, activeWs]);

  const handleExtractPane = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeWs) {
      useLayoutStore.getState().removeFromWorkspace(activeWs.id, sessionId);
      useAppStore.getState().setActiveSession(sessionId);
    }
  }, [sessionId, activeWs]);

  // HTML5 drag from title bar to extract pane
  const emptyImgRef = React.useRef<HTMLImageElement | null>(null);
  const handleTitleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/session-id', sessionId);
    e.dataTransfer.effectAllowed = 'move';
    if (!emptyImgRef.current) {
      emptyImgRef.current = new Image();
      emptyImgRef.current.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
    e.dataTransfer.setDragImage(emptyImgRef.current, 0, 0);
  }, [sessionId]);

  const statusDot = status === 'connected' ? 'bg-green-400'
    : status === 'connecting' ? 'bg-yellow-400 animate-pulse'
    : status === 'error' ? 'bg-red-400' : 'bg-gray-500';

  const [reconnecting, setReconnecting] = useState(false);
  const handleReconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      await useAppStore.getState().reconnectSession(sessionId);
    } catch (err) {
      console.error('Reconnect failed:', err);
    } finally {
      setReconnecting(false);
    }
  }, [sessionId]);

  return (
    <div
      ref={paneRef}
      onClick={handleClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      className="w-full h-full flex flex-col overflow-hidden"
    >
      {/* Title bar — only shown when inside a workspace with multiple panes */}
      {hasMultiplePanes && (
        <div
          draggable
          onDragStart={handleTitleDragStart}
          className="flex items-center gap-3 px-3.5 h-8 flex-shrink-0 select-none cursor-grab active:cursor-grabbing"
          style={{ backgroundColor: termBg }}
        >
          <span className="text-xs" style={{ color: termFg }}>⌘</span>
          <span
            className="text-xs font-medium truncate"
            style={{ color: termFgBold }}
          >
            {label}
          </span>
          <span className="text-xs" style={{ color: termFg }}>
            ssh, {host?.hostname || '?'}:{host?.port || 22}, {host?.username || '?'}
          </span>

          <span className="flex-1" />

          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot}`} />
          {(status === 'disconnected' || status === 'error') && (
            <button
              onClick={(e) => { e.stopPropagation(); handleReconnect(); }}
              disabled={reconnecting}
              className="px-1.5 rounded transition-opacity opacity-60 hover:opacity-100"
              style={{ color: termFgBold, fontSize: '12px', lineHeight: '1' }}
              title="Reconnect"
            >
              {reconnecting ? '⏳' : '🔄'}
            </button>
          )}
          <button
            onClick={handleExtractPane}
            className="px-1.5 rounded transition-opacity opacity-60 hover:opacity-100"
            style={{ color: termFgBold, fontSize: '13px', lineHeight: '1' }}
            title={t('pane.extract')}
          >
            ⌐⌙
          </button>
          <button
            onClick={handleClosePane}
            className="px-1.5 rounded transition-opacity opacity-60 hover:opacity-100"
            style={{ color: termFgBold, fontSize: '13px', lineHeight: '1', fontWeight: 700 }}
            title={t('pane.close')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Terminal */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        <TerminalView sessionId={sessionId} />
        {(status === 'disconnected' || status === 'error') && !hasMultiplePanes && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
            <span className="text-[11px]" style={{ color: status === 'error' ? '#ef4444' : 'var(--color-text-secondary)' }}>
              {status === 'error' ? '⚠ Connection error' : '🔌 Disconnected'}
            </span>
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              className="px-2 py-0.5 text-[11px] rounded hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
              {reconnecting ? '⏳' : '🔄 Reconnect'}
            </button>
          </div>
        )}
        {isDragOver && <DropZoneOverlay paneId={paneId} onDrop={handleDrop} />}
      </div>
    </div>
  );
}

function cleanupDuplicates() {
  const store = useLayoutStore.getState();
  const tree = store.layoutTree;
  if (!tree) return;
  const leaves: LeafPane[] = collectLeaves(tree);
  const seen = new Set<string>();
  for (const leaf of leaves) {
    if (seen.has(leaf.sessionId)) {
      store.closePane(leaf.paneId);
    } else {
      seen.add(leaf.sessionId);
    }
  }
}
