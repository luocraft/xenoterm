import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/app-store';
import type { HostEntry, ConnectionGroup } from '../../shared/types';

interface ContextMenuState {
  x: number;
  y: number;
  hostId: string;
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
  onDoubleClick: () => void;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer rounded-md mx-1 transition-colors"
      style={{
        backgroundColor: isSelected ? 'var(--color-hover-bg)' : 'transparent',
        color: 'var(--color-text-secondary)'
      }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <span style={{ color: 'var(--color-accent)', fontSize: '10px' }}>●</span>
      <span className="truncate flex-1">{host.name}</span>
      <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
        {host.port !== 22 ? `${host.hostname}:${host.port}` : host.hostname}
      </span>
    </div>
  );
}

export default function Sidebar({
  onNewConnection,
  onEditConnection,
  onImportExport,
  onConnect,
  onNetDebug,
  onSerialDebug
}: {
  onNewConnection: () => void;
  onEditConnection: (host: HostEntry) => void;
  onImportExport: () => void;
  onConnect?: (hostId: string) => void;
  onNetDebug?: () => void;
  onSerialDebug?: () => void;
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

  // Close context menu on any click outside (including terminal area)
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

  const handleContextMenu = useCallback((e: React.MouseEvent, hostId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, hostId });
  }, []);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleOpenHelp = useCallback(() => {
    window.api?.help?.open?.();
  }, []);

  // Group hosts
  const groupedHostIds = new Set(groups.flatMap((g) => g.hostIds));
  const ungroupedHosts = hosts.filter((h) => !groupedHostIds.has(h.id));

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-sidebar)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>XenoTerm</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleOpenHelp}
            className="p-0.5 rounded transition-colors text-[11px]"
            title="Help"
          >❓</button>
          <button
            onClick={toggleTheme}
            className="p-0.5 rounded transition-colors text-[11px]"
            title="Toggle theme"
          >{theme === 'dark' ? '🌙' : '☀️'}</button>
          <button
            onClick={toggleSidebar}
            className="p-0.5 rounded transition-colors text-[11px]"
            style={{ color: '#555' }}
            title="Collapse sidebar"
          >◀</button>
        </div>
      </div>

      {/* New Connection Button */}
      <div className="px-3 py-2">
        <button
          onClick={onNewConnection}
          className="w-full py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
        >
          + New
        </button>
      </div>

      {/* Connection List */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Grouped hosts */}
        {groups.map((group) => (
          <div key={group.id} className="mb-1">
            <div
              className="flex items-center gap-1 px-3 py-1 text-[10px] font-medium cursor-pointer select-none"
              style={{ color: 'var(--color-text-dim)' }}
              onClick={() => toggleGroup(group.id)}
            >
              <span className="text-[8px]">{expandedGroups.has(group.id) ? '▼' : '▶'}</span>
              <span className="uppercase tracking-wider">{group.name}</span>
              <span className="ml-auto">{group.hostIds.length}</span>
            </div>
            {expandedGroups.has(group.id) &&
              (group.hostIds
                .reduce((acc: any[], id: any) => {
                  const h = hosts.find((x) => x.id === id);
                  if (h) acc.push(h);
                  return acc;
                }, []) as any[])
                .map((host: any) => (
                  <HostItem
                    key={host.id}
                    host={host}
                    isSelected={selectedHostId === host.id}
                    onSelect={() => selectHost(host.id)}
                    onDoubleClick={() => onConnect?.(host.id)}
                    onContextMenu={(e) => handleContextMenu(e, host.id)}
                  />
                ))}
          </div>
        ))}

        {/* Ungrouped hosts */}
        {ungroupedHosts.map((host) => (
          <HostItem
            key={host.id}
            host={host}
            isSelected={selectedHostId === host.id}
            onSelect={() => selectHost(host.id)}
            onDoubleClick={() => onConnect?.(host.id)}
            onContextMenu={(e) => handleContextMenu(e, host.id)}
          />
        ))}

        {hosts.length === 0 && (
          <div className="px-3 py-4 text-center text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
            No connections yet
          </div>
        )}
      </div>

      {/* Bottom Toolbar */}
      <div
        className="flex items-center justify-around px-2 py-1.5"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <button
          onClick={onImportExport}
          className="flex flex-col items-center gap-0.5 p-1.5 rounded hover:bg-[var(--color-hover-bg)] transition-colors"
          title="Import / Export"
        >
          <span className="text-base">📦</span>
          <span className="text-[9px]" style={{ color: 'var(--color-text-primary)' }}>Import</span>
        </button>
        <button
          onClick={() => onNetDebug?.()}
          className="flex flex-col items-center gap-0.5 p-1.5 rounded hover:bg-[var(--color-hover-bg)] transition-colors"
          title="Network Debug"
        >
          <span className="text-base">🔌</span>
          <span className="text-[9px]" style={{ color: 'var(--color-text-primary)' }}>Network</span>
        </button>
        <button
          onClick={() => onSerialDebug?.()}
          className="flex flex-col items-center gap-0.5 p-1.5 rounded hover:bg-[var(--color-hover-bg)] transition-colors"
          title="Serial Debug"
        >
          <span className="text-base">⚡</span>
          <span className="text-[9px]" style={{ color: 'var(--color-text-primary)' }}>Serial</span>
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 py-1 rounded-lg shadow-xl min-w-[140px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: 'var(--color-sidebar)',
            border: '1px solid var(--color-border)'
          }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-hover-bg)] transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => {
              onConnect?.(contextMenu.hostId);
              setContextMenu(null);
            }}
          >Connect</button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-hover-bg)] transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => {
              const host = hosts.find((h) => h.id === contextMenu.hostId);
              if (host) onEditConnection(host);
              setContextMenu(null);
            }}
          >Edit</button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-hover-bg)] transition-colors"
            style={{ color: '#ef4444' }}
            onClick={() => {
              removeHost(contextMenu.hostId);
              setContextMenu(null);
            }}
          >Delete</button>
        </div>
      )}
    </div>
  );
}
