import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/app-store';
import type { HostEntry, ConnectionGroup } from '../../shared/types';

interface ContextMenuState {
  x: number;
  y: number;
  hostId: string;
}

export default function Sidebar({
  onNewConnection,
  onEditConnection,
  onImportExport,
  onConnect
}: {
  onNewConnection: () => void;
  onEditConnection: (host: HostEntry) => void;
  onImportExport: () => void;
  onConnect?: (hostId: string) => void;
}) {
  const hosts = useAppStore((s) => s.hosts);
  const groups = useAppStore((s) => s.groups);
  const selectedHostId = useAppStore((s) => s.selectedHostId);
  const selectHost = useAppStore((s) => s.selectHost);
  const removeHost = useAppStore((s) => s.removeHost);
  const connectToHost = useAppStore((s) => s.connectToHost);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const theme = useAppStore((s) => s.theme);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on any click outside of it (including clicks in the terminal area)
  useEffect(() => {
    if (!contextMenu) return;
    const handleGlobalMouseDown = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleGlobalMouseDown, true);
    return () => document.removeEventListener('mousedown', handleGlobalMouseDown, true);
  }, [contextMenu]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, hostId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, hostId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleConnect = useCallback(async (hostId: string) => {
    closeContextMenu();
    if (onConnect) {
      onConnect(hostId);
    } else {
      try {
        await connectToHost(hostId);
      } catch (err) {
        console.error('Connection failed:', err);
      }
    }
  }, [connectToHost, closeContextMenu, onConnect]);

  const handleDelete = useCallback(async (hostId: string) => {
    closeContextMenu();
    if (confirm('确定要删除这个连接吗？')) {
      await removeHost(hostId);
    }
  }, [removeHost, closeContextMenu]);

  const handleEdit = useCallback((hostId: string) => {
    closeContextMenu();
    const host = hosts.find((h) => h.id === hostId);
    if (host) onEditConnection(host);
  }, [hosts, onEditConnection, closeContextMenu]);

  // Group hosts
  const ungroupedHosts = hosts.filter((h) => !h.group);
  const groupedHosts = (group: ConnectionGroup) =>
    hosts.filter((h) => h.group === group.id);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 flex items-center justify-between" style={{ WebkitAppRegion: 'drag', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties}>
        <h1 className="text-sm font-bold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>SSH Client</h1>
        <div className="flex gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md transition-colors text-xs"
            style={{ color: 'var(--color-text-muted)' }}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-md transition-colors text-xs"
            style={{ color: 'var(--color-text-muted)' }}
            title="Collapse sidebar"
          >
            ◀
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="p-2 flex gap-1">
        <button
          onClick={onNewConnection}
          className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
        >
          + New
        </button>
        <button
          onClick={onImportExport}
          className="px-2 py-1.5 text-xs rounded-lg transition-colors"
          style={{ backgroundColor: 'var(--color-hover-bg)', color: 'var(--color-text-secondary)' }}
        >
          ⇄
        </button>
      </div>

      {/* Connection list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {/* Groups */}
        {groups.map((group) => (
          <div key={group.id} className="mb-1">
            <button
              onClick={() => toggleGroup(group.id)}
              className="w-full px-2 py-1 text-xs font-medium flex items-center gap-1 transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <span className="text-[10px]">{expandedGroups.has(group.id) ? '▼' : '▶'}</span>
              {group.name}
              <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{groupedHosts(group).length}</span>
            </button>
            {expandedGroups.has(group.id) && (
              <div className="ml-2">
                {groupedHosts(group).map((host) => (
                  <HostItem
                    key={host.id}
                    host={host}
                    isSelected={selectedHostId === host.id}
                    onSelect={() => selectHost(host.id)}
                    onDoubleClick={() => handleConnect(host.id)}
                    onContextMenu={(e) => handleContextMenu(e, host.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Ungrouped */}
        {ungroupedHosts.length > 0 && groups.length > 0 && (
          <div className="px-2 py-1 text-[10px] uppercase" style={{ color: 'var(--color-text-dim)' }}>Ungrouped</div>
        )}
        {ungroupedHosts.map((host) => (
          <HostItem
            key={host.id}
            host={host}
            isSelected={selectedHostId === host.id}
            onSelect={() => selectHost(host.id)}
            onDoubleClick={() => handleConnect(host.id)}
            onContextMenu={(e) => handleContextMenu(e, host.id)}
          />
        ))}

        {hosts.length === 0 && (
          <p className="text-xs text-center mt-8 px-4" style={{ color: 'var(--color-text-dim)' }}>
            No connections yet. Click "+ New" to add one.
          </p>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y, backgroundColor: 'var(--color-context-bg)', border: '1px solid var(--color-border)' }}
        >
          <button
            onClick={() => handleConnect(contextMenu.hostId)}
            className="w-full px-3 py-1.5 text-xs text-left transition-colors"
            style={{ color: 'var(--color-text-primary)' }}
          >
            🔗 Connect
          </button>
          <button
            onClick={() => handleEdit(contextMenu.hostId)}
            className="w-full px-3 py-1.5 text-xs text-left transition-colors"
            style={{ color: 'var(--color-text-primary)' }}
          >
            ✏️ Edit
          </button>
          <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
          <button
            onClick={() => handleDelete(contextMenu.hostId)}
            className="w-full px-3 py-1.5 text-xs text-left text-red-400 transition-colors"
          >
            🗑 Delete
          </button>
        </div>
      )}
    </div>
  );
}

function HostItem({
  host,
  isSelected,
  onSelect,
  onDoubleClick,
  onContextMenu
}: {
  host: HostEntry;
  isSelected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`
        px-2 py-1.5 mx-1 rounded-md cursor-pointer text-xs transition-colors
        ${isSelected ? 'bg-[var(--color-accent)]/20' : ''}
      `}
      style={{
        color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        backgroundColor: isSelected ? undefined : undefined,
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = ''; }}
    >
      <div className="font-medium truncate">{host.name}</div>
      <div className="text-[10px] truncate" style={{ color: 'var(--color-text-muted)' }}>
        {host.username}@{host.hostname}:{host.port}
      </div>
    </div>
  );
}
