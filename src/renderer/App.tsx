import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAppStore } from './store/app-store';
import MainLayout from './components/MainLayout';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import TilingLayout from './components/TilingLayout';
import FileManager from './components/FileManager';
import TransferQueue from './components/TransferQueue';
import ConnectionForm from './components/ConnectionForm';
import ImportExportDialog from './components/ImportExportDialog';
import ToastContainer from './components/Toast';
import CommandHistory from './components/CommandHistory';
import NetDebugPanel from './components/NetDebugPanel';
import SerialDebugPanel from './components/SerialDebugPanel';
import { useLayoutStore } from './store/layout-store';
import type { HostEntry } from '../shared/types';

function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
      <div className="text-center max-w-md">
        <div className="text-5xl mb-6 opacity-30">⌨</div>
        <p className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>XenoTerm</p>
        <p className="text-xs mb-8" style={{ color: 'var(--color-text-dim)' }}>SSH · Network · Serial — All in one</p>

        <div className="grid grid-cols-3 gap-3 text-left">
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--color-hover-bg)', border: '1px solid var(--color-border)' }}>
            <div className="text-lg mb-1.5">🖥</div>
            <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>SSH Terminal</p>
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-dim)' }}>Connect to remote servers with split-pane workspaces</p>
          </div>
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--color-hover-bg)', border: '1px solid var(--color-border)' }}>
            <div className="text-lg mb-1.5">🔌</div>
            <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>Network Debug</p>
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-dim)' }}>TCP Client/Server and UDP data exchange</p>
          </div>
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--color-hover-bg)', border: '1px solid var(--color-border)' }}>
            <div className="text-lg mb-1.5">⚡</div>
            <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>Serial Debug</p>
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-dim)' }}>Serial port communication with DTR/RTS control</p>
          </div>
        </div>

        <p className="text-[10px] mt-6" style={{ color: 'var(--color-text-dim)' }}>
          Double-click a connection or use the toolbar below
        </p>
      </div>
    </div>
  );
}

function PasswordPrompt({
  hostName,
  onSubmit,
  onCancel
}: {
  hostName: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'var(--color-overlay)' }} onClick={onCancel}>
      <div
        className="bg-[var(--color-sidebar)] rounded-xl shadow-2xl w-[340px] p-4"
        style={{ border: '1px solid var(--color-input-border)' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Password Required</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>Enter password for {hostName}</p>
        <form onSubmit={(e: React.FormEvent) => { e.preventDefault(); onSubmit(password); }}>
          <input
            type="password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            autoFocus
            className="w-full px-2.5 py-1.5 text-xs rounded-lg outline-none focus:border-[var(--color-accent)] transition-colors mb-3"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
            placeholder="Password"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)' }}>
              Cancel
            </button>
            <button type="submit"
              className="px-4 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity">
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const loadAppConfig = useAppStore((s) => s.loadAppConfig);
  const loadHosts = useAppStore((s) => s.loadHosts);
  const loadCommandHistory = useAppStore((s) => s.loadCommandHistory);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const splitPaneVisible = useAppStore((s) => s.splitPaneVisible);
  const splitPaneRatio = useAppStore((s) => s.splitPaneRatio);
  const setSplitPaneRatio = useAppStore((s) => s.setSplitPaneRatio);
  const transfers = useAppStore((s) => s.transfers);
  const commandHistoryVisible = useAppStore((s) => s.commandHistoryVisible);
  const toggleCommandHistory = useAppStore((s) => s.toggleCommandHistory);

  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [editingHost, setEditingHost] = useState<HostEntry | null>(null);
  const [showImportExport, setShowImportExport] = useState(false);
  const [passwordPrompt, setPasswordPrompt] = useState<{ hostId: string; hostName: string } | null>(null);
  const [showNetDebug, setShowNetDebug] = useState(false);
  const [showSerialDebug, setShowSerialDebug] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [sidePanelWidth, setSidePanelWidth] = useState(400);
  const [isDraggingSidePanel, setIsDraggingSidePanel] = useState(false);

  const connectToHost = useAppStore((s) => s.connectToHost);
  const hosts = useAppStore((s) => s.hosts);
  const sessions = useAppStore((s) => s.sessions);

  const activeTabId = useLayoutStore((s) => s.activeTabId);
  const tabs = useLayoutStore((s) => s.tabs);
  const workspaces = useLayoutStore((s) => s.workspaces);
  const layoutTree = useLayoutStore((s) => s.layoutTree);

  useEffect(() => {
    loadAppConfig();
    loadHosts();
    loadCommandHistory();
  }, [loadAppConfig, loadHosts, loadCommandHistory]);

  // Handle connect with password prompt
  const handleConnect = async (hostId: string, password?: string) => {
    const host = hosts.find((h) => h.id === hostId);
    if (!host) return;

    if (host.authMethod === 'password' && !password) {
      setPasswordPrompt({ hostId, hostName: host.name });
      return;
    }

    try {
      await connectToHost(hostId, password);
      // After successful connect, the new session is the last one in the array
      const newSessions = useAppStore.getState().sessions;
      const newSession = newSessions[newSessions.length - 1];
      if (newSession && !addedSessionIdsRef.current.has(newSession.id)) {
        useLayoutStore.getState().addSessionTab(newSession.id);
        useLayoutStore.getState().switchToTab(newSession.id);
        useAppStore.getState().setActiveSession(newSession.id);
        addedSessionIdsRef.current.add(newSession.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConnectError(msg);
    }
  };

  const handlePasswordSubmit = async (password: string) => {
    if (!passwordPrompt) return;
    setPasswordPrompt(null);
    await handleConnect(passwordPrompt.hostId, password);
  };

  // Track which sessions have been added as tabs
  const addedSessionIdsRef = useRef<Set<string>>(new Set());

  // Sync new sessions → independent tabs
  useEffect(() => {
    for (const session of sessions) {
      if (addedSessionIdsRef.current.has(session.id)) continue;
      if (session.status === 'disconnected' || session.status === 'error') continue;

      // Add as independent tab
      useLayoutStore.getState().addSessionTab(session.id);
      // Switch to it
      useLayoutStore.getState().switchToTab(session.id);
      useAppStore.getState().setActiveSession(session.id);

      addedSessionIdsRef.current.add(session.id);
    }

    // Clean up tracked IDs for sessions that no longer exist
    const currentSessionIds = new Set(sessions.map((s) => s.id));
    for (const id of addedSessionIdsRef.current) {
      if (!currentSessionIds.has(id)) {
        addedSessionIdsRef.current.delete(id);
      }
    }

    // If all sessions are gone, clear everything
    if (sessions.length === 0) {
      const store = useLayoutStore.getState();
      if (store.tabs.length > 0 || store.layoutTree !== null) {
        useLayoutStore.setState({
          layoutTree: null,
          activePaneId: null,
          tabs: [],
          workspaces: [],
          activeTabId: null,
        });
      }
    }
  }, [sessions]);

  // Sync workspace layout changes back to workspace state
  useEffect(() => {
    if (!activeTabId) return;
    const store = useLayoutStore.getState();
    const ws = store.workspaces.find((w) => w.id === activeTabId);
    if (ws && layoutTree) {
      // Keep workspace's layoutTree in sync with the current layoutTree
      if (ws.layoutTree !== layoutTree) {
        const newWorkspaces = store.workspaces.map((w) =>
          w.id === activeTabId ? { ...w, layoutTree } : w
        );
        useLayoutStore.setState({ workspaces: newWorkspaces });
      }
    }
  }, [layoutTree, activeTabId]);

  const hasActiveTransfers = transfers.some((t) => t.status === 'pending' || t.status === 'transferring');

  // Determine what to render in the content area
  const activeWorkspace = workspaces.find((w) => w.id === activeTabId);
  const isWorkspaceView = !!activeWorkspace;
  const isIndependentSession = !isWorkspaceView && activeTabId && tabs.some(
    (t) => t.type === 'session' && t.sessionId === activeTabId
  );

  // Draggable divider
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingDivider(true);
  }, []);

  useEffect(() => {
    if (!isDraggingDivider) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      let ratio = (e.clientY - rect.top) / rect.height;
      ratio = Math.min(0.8, Math.max(0.2, ratio));
      setSplitPaneRatio(ratio);
    };
    const handleMouseUp = () => setIsDraggingDivider(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingDivider, setSplitPaneRatio]);

  // Side panel horizontal drag
  useEffect(() => {
    if (!isDraggingSidePanel) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      setSidePanelWidth(Math.min(800, Math.max(250, newWidth)));
    };
    const handleMouseUp = () => setIsDraggingSidePanel(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSidePanel]);

  const hasContent = isWorkspaceView || isIndependentSession;

  return (
    <>
      <MainLayout
        sidebar={
          <Sidebar
            onNewConnection={() => { setEditingHost(null); setShowConnectionForm(true); }}
            onEditConnection={(host: HostEntry) => { setEditingHost(host); setShowConnectionForm(true); }}
            onImportExport={() => setShowImportExport(true)}
            onConnect={handleConnect}
            onNetDebug={() => { setShowNetDebug((v) => !v); setShowSerialDebug(false); }}
            onSerialDebug={() => { setShowSerialDebug((v) => !v); setShowNetDebug(false); }}
          />
        }
      >
        <TabBar />

        {!hasContent ? (
          <div className="flex-1 flex overflow-visible">
            {showNetDebug ? (
              <div className="flex-1 overflow-visible">
                <NetDebugPanel onClose={() => setShowNetDebug(false)} />
              </div>
            ) : showSerialDebug ? (
              <div className="flex-1 overflow-visible">
                <SerialDebugPanel onClose={() => setShowSerialDebug(false)} />
              </div>
            ) : (
              <WelcomeScreen />
            )}
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Main terminal + file manager area */}
            <div className="flex-1 flex flex-col overflow-hidden" ref={splitContainerRef}>
              <div
                className="overflow-hidden relative flex-shrink-0"
                style={{ height: splitPaneVisible ? `${splitPaneRatio * 100}%` : '100%' }}
              >
                <div className="absolute inset-0">
                  {isWorkspaceView && layoutTree ? (
                    <TilingLayout node={layoutTree} path={[]} />
                  ) : isIndependentSession && layoutTree ? (
                    <TilingLayout node={layoutTree} path={[]} />
                  ) : null}
                </div>
              </div>

              {splitPaneVisible && activeSessionId && (
                <>
                  <div
                    onMouseDown={handleDividerMouseDown}
                    className={`h-1 flex-shrink-0 cursor-row-resize transition-colors`}
                    style={{ backgroundColor: isDraggingDivider ? 'var(--color-accent)' : 'var(--color-border)' }}
                  />
                  <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                    <FileManager sessionId={activeSessionId} />
                    {hasActiveTransfers && (
                      <div className="max-h-[150px] overflow-hidden" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <TransferQueue />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Command history side panel */}
            {commandHistoryVisible && (
              <div
                className="flex-shrink-0 w-[280px] overflow-hidden"
                style={{ borderLeft: '1px solid var(--color-border)' }}
              >
                <CommandHistory onClose={toggleCommandHistory} />
              </div>
            )}

            {/* Net debug side panel */}
            {showNetDebug && (
              <>
                <div
                  onMouseDown={(e) => { e.preventDefault(); setIsDraggingSidePanel(true); }}
                  className="flex-shrink-0 w-1 cursor-col-resize transition-colors"
                  style={{ backgroundColor: isDraggingSidePanel ? 'var(--color-accent)' : 'var(--color-border)' }}
                />
                <div
                  className="flex-shrink-0 overflow-hidden"
                  style={{ width: sidePanelWidth }}
                >
                  <NetDebugPanel onClose={() => setShowNetDebug(false)} />
                </div>
              </>
            )}

            {/* Serial debug side panel */}
            {showSerialDebug && (
              <>
                <div
                  onMouseDown={(e) => { e.preventDefault(); setIsDraggingSidePanel(true); }}
                  className="flex-shrink-0 w-1 cursor-col-resize transition-colors"
                  style={{ backgroundColor: isDraggingSidePanel ? 'var(--color-accent)' : 'var(--color-border)' }}
                />
                <div
                  className="flex-shrink-0 overflow-hidden"
                  style={{ width: sidePanelWidth }}
                >
                  <SerialDebugPanel onClose={() => setShowSerialDebug(false)} />
                </div>
              </>
            )}
          </div>
        )}
      </MainLayout>

      {showConnectionForm && (
        <ConnectionForm
          editHost={editingHost}
          onClose={() => { setShowConnectionForm(false); setEditingHost(null); }}
        />
      )}
      {showImportExport && (
        <ImportExportDialog onClose={() => setShowImportExport(false)} />
      )}
      {passwordPrompt && (
        <PasswordPrompt
          hostName={passwordPrompt.hostName}
          onSubmit={handlePasswordSubmit}
          onCancel={() => setPasswordPrompt(null)}
        />
      )}

      {connectError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--color-overlay)' }} onClick={() => setConnectError(null)}>
          <div
            className="rounded-xl shadow-2xl w-[360px] p-5"
            style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-input-border)' }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">❌</span>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Connection Failed</h3>
            </div>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{connectError}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setConnectError(null)}
                className="px-4 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
    </>
  );
}
