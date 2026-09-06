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
import ToastContainer, { showToast } from './components/Toast';
import CommandHistory from './components/CommandHistory';
import CanDebugPanel from './components/CanDebugPanel';
import SerialDebugPanel from './components/SerialDebugPanel';
import NetDebugPanel from './components/NetDebugPanel';
import { UpdateDialog } from './components/UpdateDialog';
import { useLayoutStore } from './store/layout-store';
import { useI18nStore, useT } from './i18n';
import { getUpdateText } from './update-text';
import AppIcon, { type AppIconName } from './components/AppIcon';
function WelcomeScreen({
  onSSH,
  onNet,
  onSerial,
  onCan,
}: {
  onSSH: () => void;
  onNet: () => void;
  onSerial: () => void;
  onCan: () => void;
}) {
  const t = useT();
  const zh = useI18nStore((s) => s.locale === 'zh');

  const features = [
    { icon: 'terminal', title: zh ? 'SSH 终端' : 'SSH terminal', desc: t('welcome.ssh.desc'), onClick: onSSH },
    { icon: 'network', title: zh ? '网络调试' : 'Network', desc: t('welcome.net.desc'), onClick: onNet },
    { icon: 'serial', title: zh ? '串口调试' : 'Serial port', desc: t('welcome.serial.desc'), onClick: onSerial },
    { icon: 'can', title: 'CAN / CAN FD', desc: t('welcome.can.desc'), onClick: onCan },
  ];

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-wordmark">
          <span className="brand-mark"><AppIcon name="terminal" size={18} /></span>
          XenoTerm
        </div>
        <h1>{zh ? '连接设备，专注调试。' : 'Connect. Explore. Build.'}</h1>
        <p className="welcome-description">{zh
          ? '从一次连接开始，让终端、文件和设备通信井然有序。'
          : 'Your terminals, files and devices. One quiet place to work.'}</p>
        <div className="welcome-section-label">
          <span>{zh ? '开始工作' : 'Start a workspace'}</span>
          <span>{zh ? '选择连接方式' : 'CHOOSE A CONNECTION'}</span>
        </div>
        <div className="tool-grid">
          {features.map((f) => (
            <button key={f.title}
              aria-label={f.title}
              onClick={f.onClick}
              className="tool-card">
              <span className="tool-card-icon"><AppIcon name={f.icon as AppIconName} size={21} /></span>
              <span><strong>{f.title}</strong><small>{f.desc}</small></span>
              <AppIcon name="arrow" size={15} className="tool-card-arrow" />
            </button>
          ))}
        </div>

        <div className="welcome-hint">
          <AppIcon name="terminal" size={14} />
          <span>{zh ? '双击侧栏中已保存的设备，即可继续工作。' : 'Double-click a saved connection in the sidebar to pick up where you left off.'}</span>
        </div>
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
  const t = useT();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'var(--color-overlay)' }} onClick={onCancel}>
      <div
        className="bg-[var(--color-sidebar)] rounded-xl shadow-2xl w-[340px] p-4"
        style={{ border: '1px solid var(--color-input-border)' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>{t('dialog.password.title')}</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>{t('dialog.password.prompt', { host: hostName })}</p>
        <form onSubmit={(e: React.FormEvent) => { e.preventDefault(); onSubmit(password); }}>
          <input
            type="password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            autoFocus
            className="w-full px-2.5 py-1.5 text-xs rounded-lg outline-none focus:border-[var(--color-accent)] transition-colors mb-3"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
            placeholder={t('dialog.password.placeholder')}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)' }}>
              {t('common.cancel')}
            </button>
            <button type="submit"
              className="px-4 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity">
              {t('common.connect')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  const updateText = getUpdateText(locale);
  const loadAppConfig = useAppStore((s) => s.loadAppConfig);
  const loadHosts = useAppStore((s) => s.loadHosts);
  const loadCommandHistory = useAppStore((s) => s.loadCommandHistory);
  const loadUpdateStatus = useAppStore((s) => s.loadUpdateStatus);
  const setUpdateStatus = useAppStore((s) => s.setUpdateStatus);
  const updateStatus = useAppStore((s) => s.updateStatus);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const splitPaneVisible = useAppStore((s) => s.splitPaneVisible);
  const splitPaneRatio = useAppStore((s) => s.splitPaneRatio);
  const setSplitPaneRatio = useAppStore((s) => s.setSplitPaneRatio);
  const transfers = useAppStore((s) => s.transfers);
  const commandHistoryVisible = useAppStore((s) => s.commandHistoryVisible);
  const toggleCommandHistory = useAppStore((s) => s.toggleCommandHistory);

  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [editingHost, setEditingHost] = useState<any>(null);
  const [showImportExport, setShowImportExport] = useState(false);
  const [passwordPrompt, setPasswordPrompt] = useState<{ hostId: string; hostName: string } | null>(null);
  const [showCanPanel, setShowCanPanel] = useState(false);
  const [showSerialPanel, setShowSerialPanel] = useState(false);
  const [showNetPanel, setShowNetPanel] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
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
    loadUpdateStatus();
  }, [loadAppConfig, loadHosts, loadCommandHistory, loadUpdateStatus]);

  useEffect(() => {
    const unsubscribe = window.api.update.onStatusChange((status) => {
      setUpdateStatus(status);
    });
    return unsubscribe;
  }, [setUpdateStatus]);

  const previousUpdateStateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!updateStatus) return;

    const previousState = previousUpdateStateRef.current;
    const currentState = updateStatus.state;
    const version = updateStatus.downloadedVersion || updateStatus.availableVersion || '';

    if (previousState !== currentState) {
      if (currentState === 'available') {
        showToast('info', updateText.toast.available.replace('{version}', version ? `v${version}` : ''));
      } else if (currentState === 'not-available' && updateStatus.lastCheckManual) {
        showToast('success', updateText.toast.none);
      } else if (currentState === 'disabled' && updateStatus.lastCheckManual) {
        showToast('error', updateStatus.error || updateText.toast.error);
      } else if (currentState === 'error' && updateStatus.lastCheckManual) {
        showToast('error', updateStatus.error || updateText.toast.error);
      }
    }

    previousUpdateStateRef.current = currentState;
  }, [updateStatus, updateText]);

  // Global listener for SFTP progress — must be at App level so it's always active
  const updateTransfer = useAppStore((s) => s.updateTransfer);
  useEffect(() => {
    const unsub = window.api.sftp.onProgress((progress) => {
      updateTransfer(progress.transferId, progress);
    });
    return unsub;
  }, [updateTransfer]);

  // Handle connect with password prompt
  const handleConnect = async (hostId: string, password?: string) => {
    const host = hosts.find((h) => h.id === hostId);
    if (!host) return;

    if (host.authMethod === 'password' && !password) {
      if (host.password) {
        password = host.password;
      } else {
        setPasswordPrompt({ hostId, hostName: host.name });
        return;
      }
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
            onEditConnection={(host: any) => { setEditingHost(host); setShowConnectionForm(true); }}
            onImportExport={() => setShowImportExport(true)}
            onConnect={handleConnect}
            onNetPanel={() => { setShowNetPanel((v) => !v); setShowSerialPanel(false); setShowCanPanel(false); }}
            onSerialPanel={() => { setShowSerialPanel((v) => !v); setShowNetPanel(false); setShowCanPanel(false); }}
            onCanPanel={() => { setShowCanPanel((v) => !v); setShowNetPanel(false); setShowSerialPanel(false); }}
            onUpdateClick={() => setShowUpdateDialog(true)}
          />
        }
      >
        <TabBar />

        {!hasContent ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {showNetPanel ? (
              <NetDebugPanel onClose={() => setShowNetPanel(false)} />
            ) : showSerialPanel ? (
              <SerialDebugPanel onClose={() => setShowSerialPanel(false)} />
            ) : showCanPanel ? (
              <CanDebugPanel onClose={() => setShowCanPanel(false)} />
            ) : (
              <WelcomeScreen
                onSSH={() => { setEditingHost(null); setShowConnectionForm(true); }}
                onNet={() => setShowNetPanel(true)}
                onSerial={() => setShowSerialPanel(true)}
                onCan={() => setShowCanPanel(true)}
              />
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

            {/* Side panel for debug tools */}
            {(showNetPanel || showSerialPanel || showCanPanel) && (
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
                  {showNetPanel && <NetDebugPanel onClose={() => setShowNetPanel(false)} />}
                  {showSerialPanel && <SerialDebugPanel onClose={() => setShowSerialPanel(false)} />}
                  {showCanPanel && <CanDebugPanel onClose={() => setShowCanPanel(false)} />}
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
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('dialog.connFailed.title')}</h3>
            </div>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{connectError}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setConnectError(null)}
                className="px-4 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
              >
                {t('common.ok')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating transfer progress panel */}
      {transfers.length > 0 && (
        <div className="fixed bottom-4 right-4 z-30 w-[320px] max-h-[200px] overflow-y-auto rounded-xl shadow-2xl"
          style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}>
          <TransferQueue />
        </div>
      )}

      <ToastContainer />
      {showUpdateDialog && <UpdateDialog onClose={() => setShowUpdateDialog(false)} />}
    </>
  );
}
