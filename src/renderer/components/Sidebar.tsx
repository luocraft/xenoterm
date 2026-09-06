import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/app-store';
import { useT, useI18nStore } from '../i18n';
import type { HostEntry } from '../../shared/types';
import { getUpdateText } from '../update-text';
import AppIcon from './AppIcon';
import ResourceMonitor from './ResourceMonitor';

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
      className="host-row"
      data-selected={isSelected}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <AppIcon name="terminal" size={17} style={{ color: 'var(--color-text-muted)' }} />
      <span className="min-w-0 flex-1">
        <span className="host-row-name block truncate">{host.name}</span>
        <span className="host-row-address block truncate">
        {host.port !== 22 ? `${host.hostname}:${host.port}` : host.hostname}
        </span>
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
  onUpdateClick
}: {
  onNewConnection: () => void;
  onEditConnection: (host: HostEntry) => void;
  onImportExport: () => void;
  onConnect?: (hostId: string) => void;
  onNetPanel?: () => void;
  onSerialPanel?: () => void;
  onCanPanel?: () => void;
  onUpdateClick?: () => void;
}) {
  const hosts = useAppStore((s) => s.hosts);
  const groups = useAppStore((s) => s.groups);
  const selectedHostId = useAppStore((s) => s.selectedHostId);
  const selectHost = useAppStore((s) => s.selectHost);
  const removeHost = useAppStore((s) => s.removeHost);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const theme = useAppStore((s) => s.theme);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const updateStatus = useAppStore((s) => s.updateStatus);
  const t = useT();
  const { locale, setLocale } = useI18nStore();
  const updateText = getUpdateText(locale);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  const groupedHostIds = new Set(groups.flatMap((g) => g.hostIds));
  const ungroupedHosts = hosts.filter((h) => !groupedHostIds.has(h.id));
  const updateState = updateStatus?.state;
  const updateButtonColor =
    updateState === 'downloaded'
      ? '#22c55e'
      : updateState === 'downloading' || updateState === 'available'
        ? 'var(--color-accent)'
        : 'var(--color-text-dim)';

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-sidebar)' }}>
      <div className="sidebar-heading app-drag">
        <span className="brand-mark"><AppIcon name="terminal" size={17} /></span>
        <strong>XenoTerm</strong>
        <button onClick={toggleSidebar} className="icon-button app-no-drag ml-auto" title="Collapse"><AppIcon name="collapse" size={16} /></button>
      </div>
      <div className="px-4 pt-2 pb-1">
        <button onClick={onNewConnection} className="new-connection"><AppIcon name="plus" size={15} />{t('sidebar.newConn').replace(/^\+\s*/, '')}</button>
      </div>
      <div className="sidebar-label">{locale === 'zh' ? '已保存的连接' : 'SAVED CONNECTIONS'}<span className="float-right">{hosts.length}</span></div>
      <div className="flex-1 overflow-y-auto py-1">
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
            <AppIcon name="terminal" size={24} className="mx-auto mb-3 opacity-50" />
            <p className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
              {t('sidebar.empty')}
            </p>
          </div>
        )}
      </div>

      <ResourceMonitor />

      <div
        className="sidebar-footer"
      >
        <div className="sidebar-tools">
          <button
            key="import-export"
            onClick={onImportExport}
            className="h-7 w-7 rounded-md flex items-center justify-center text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
            title={t('sidebar.importExport')}
          ><AppIcon name="transfer" size={17} /></button>
          <button
            onClick={() => onNetPanel?.()}
            className="flex-1 h-7 rounded-md flex items-center justify-center text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
            title={t('sidebar.network')}
          ><AppIcon name="network" size={17} /></button>
          <button
            onClick={() => onSerialPanel?.()}
            className="flex-1 h-7 rounded-md flex items-center justify-center text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
            title={t('sidebar.serial')}
          ><AppIcon name="serial" size={17} /></button>
          <button
            onClick={() => onCanPanel?.()}
            className="flex-1 h-7 rounded-md flex items-center justify-center text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
            title={t('sidebar.canbus')}
          ><AppIcon name="can" size={17} /></button>
        </div>
        <div className="flex items-center gap-2 px-2 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <AppIcon name="check" size={14} style={{ color: 'var(--color-accent)' }} />
          <span>{locale === 'zh' ? '免费版 · 全部功能' : 'Free · All features'}</span>
        </div>
        <div className="sidebar-utilities">
          <button onClick={handleOpenHelp} className="icon-button" title="Help"><AppIcon name="help" size={16} /></button>
          <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')} className="icon-button text-[11px]" title={locale === 'zh' ? 'Switch to English' : '切换到中文'}>{locale === 'zh' ? 'EN' : '中'}</button>
          <button onClick={() => onUpdateClick?.()} className="icon-button" title={updateText.openDialog} style={{ color: updateButtonColor }}><AppIcon name="update" size={16} /></button>
          <button onClick={toggleTheme} className="icon-button" title="Toggle theme"><AppIcon name={theme === 'dark' ? 'moon' : 'sun'} size={16} /></button>
        </div>
      </div>

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
