import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/app-store';
import { LicenseStatusBar } from './LicenseDialog';
import { useT, useI18nStore } from '../i18n';
import type { HostEntry } from '../../shared/types';

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
  onNetPanel,
  onSerialPanel,
  onCanPanel,
  onEthercatPanel,
  onLicenseClick
}: {
  onNewConnection: () => void;
  onEditConnection: (host: HostEntry) => void;
  onImportExport: () => void;
  onConnect?: (hostId: string) => void;
  onNetPanel?: () => void;
  onSerialPanel?: () => void;
  onCanPanel?: () => void;
  onEthercatPanel?: () => void;
  onLicenseClick?: () => void;
}) {
  const hosts = useAppStore((s) => s.hosts);
  const groups = useAppStore((s) => s.groups);
  const selectedHostId = useAppStore((s) => s.selectedHostId);
  const selectHost = useAppStore((s) => s.selectHost);
  const removeHost = useAppStore((s) => s.removeHost);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const theme = useAppStore((s) => s.theme);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const t = useT();
  const { locale, setLocale } = useI18nStore();

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
      <div className="flex items-center justify-between px-3 h-9 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          XenoTerm
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleOpenHelp}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--color-hover-bg)] text-[11px]"
            title="Help"
          >❓</button>
          <button
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--color-hover-bg)] text-[10px] font-medium"
            title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
            style={{ color: 'var(--color-text-dim)' }}
          >{locale === 'zh' ? 'EN' : '中'}</button>
          <button
            onClick={toggleTheme}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--color-hover-bg)] text-[11px]"
            title="Toggle theme"
          >{theme === 'dark' ? '🌙' : '☀️'}</button>
          <button
            onClick={toggleSidebar}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--color-hover-bg)] text-[11px]"
            style={{ color: 'var(--color-text-dim)' }}
            title="Collapse"
          >◀</button>
        </div>
      </div>

      {/* New Connection Button */}
      <div className="px-3 py-2">
        <button
          onClick={onNewConnection}
          className="w-full py-1.5 text-[11px] rounded-md text-white hover:opacity-90 transition-opacity font-medium"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {t('sidebar.newConn')}
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
          <div className="px-3 py-8 text-center">
            <div className="text-2xl mb-2 opacity-30">🖥</div>
            <p className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
              {t('sidebar.empty')}
            </p>
          </div>
        )}
      </div>

      {/* Bottom Toolbar — compact icon row */}
      <div
        className="px-2 py-1.5 flex flex-col gap-1"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-0.5">
          <button
            key="import-export"
            onClick={onImportExport}
            className="h-7 w-7 rounded-md flex items-center justify-center text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
            title={t('sidebar.importExport')}
          >📦</button>
          <button
            onClick={() => onNetPanel?.()}
            className="flex-1 h-7 rounded-md flex items-center justify-center text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
            title={t('sidebar.network')}
          >🔌</button>
          <button
            onClick={() => onSerialPanel?.()}
            className="flex-1 h-7 rounded-md flex items-center justify-center text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
            title={t('sidebar.serial')}
          >⚡</button>
          <button
            onClick={() => onCanPanel?.()}
            className="flex-1 h-7 rounded-md flex items-center justify-center text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
            title={t('sidebar.canbus')}
          >🚗</button>
          <button
            onClick={() => onEthercatPanel?.()}
            className="flex-1 h-7 rounded-md flex items-center justify-center text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
            title={t('sidebar.ethercat')}
          >⚙️</button>
        </div>
        <LicenseStatusBar onClick={() => onLicenseClick?.()} />
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
          >{t('sidebar.connect')}</button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-hover-bg)] transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => {
              const host = hosts.find((h) => h.id === contextMenu.hostId);
              if (host) onEditConnection(host);
              setContextMenu(null);
            }}
          >{t('sidebar.edit')}</button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-hover-bg)] transition-colors"
            style={{ color: '#ef4444' }}
            onClick={() => {
              removeHost(contextMenu.hostId);
              setContextMenu(null);
            }}
          >{t('sidebar.delete')}</button>
        </div>
      )}
    </div>
  );
}
