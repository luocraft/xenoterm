import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useT } from '../i18n';
import type { FileEntry } from '../../shared/types';

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return '—'; }
}

type SortKey = 'name' | 'size' | 'modified';
type SortDir = 'asc' | 'desc';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

interface FileListProps {
  files: FileEntry[];
  loading: boolean;
  currentPath: string;
  onNavigate: (path: string) => void;
  onDragStart?: (e: React.DragEvent, file: FileEntry) => void;
  selectedFiles?: Set<string>;
  onSelect?: (file: FileEntry, multi: boolean) => void;
  onPathInputChange?: (value: string) => void;
  onContextMenu?: (file: FileEntry | null, x: number, y: number) => ContextMenuItem[];
}

export default function FileList({
  files, loading, currentPath, onNavigate,
  onDragStart, selectedFiles, onSelect, onPathInputChange, onContextMenu
}: FileListProps) {
  const t = useT();
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(currentPath);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  useEffect(() => {
    if (!editingPath) setPathInput(currentPath);
  }, [currentPath, editingPath]);

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctxMenu]);

  const sortedFiles = React.useMemo(() => {
    const sorted = [...files];
    sorted.sort((a, b) => {
      // Directories always first
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'size': cmp = (a.size || 0) - (b.size || 0); break;
        case 'modified': cmp = (a.modifiedAt || '').localeCompare(b.modifiedAt || ''); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [files, sortKey, sortDir]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const handlePathSubmit = () => {
    const trimmed = pathInput.trim();
    if (trimmed && trimmed !== currentPath) onNavigate(trimmed);
    setEditingPath(false);
  };

  const handlePathClick = () => {
    setEditingPath(true);
    setPathInput(currentPath);
    setTimeout(() => pathInputRef.current?.select(), 0);
  };

  const handleDoubleClick = (file: FileEntry) => {
    if (file.isDirectory) onNavigate(file.path);
  };

  const goUp = () => {
    const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      const parent = currentPath.startsWith('/') ? '/' + parts.join('/') : parts.join('/');
      onNavigate(parent);
    } else if (currentPath !== '/' && currentPath !== '') {
      onNavigate('/');
    }
  };

  const handleRowContextMenu = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onContextMenu) return;
    const items = onContextMenu(file, e.clientX, e.clientY);
    if (items.length > 0) setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [onContextMenu]);

  const handleBgContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!onContextMenu) return;
    const items = onContextMenu(null, e.clientX, e.clientY);
    if (items.length > 0) setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [onContextMenu]);

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Path bar */}
      <div className="flex items-center gap-1 px-2 py-1.5" style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-input-bg)' }}>
        <button onClick={goUp} className="px-1.5 py-0.5 text-[10px] rounded transition-colors"
          style={{ backgroundColor: 'var(--color-hover-bg)', color: 'var(--color-text-secondary)' }}>↑</button>
        {editingPath ? (
          <input ref={pathInputRef} value={pathInput}
            onChange={(e) => { setPathInput(e.target.value); onPathInputChange?.(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handlePathSubmit();
              if (e.key === 'Escape') { setEditingPath(false); setPathInput(currentPath); onPathInputChange?.(''); }
            }}
            onBlur={handlePathSubmit} autoFocus
            className="text-[10px] flex-1 font-mono px-1 py-0 rounded outline-none"
            style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-accent)', color: 'var(--color-text-primary)' }} />
        ) : (
          <span className="text-[10px] truncate flex-1 font-mono cursor-text"
            style={{ color: 'var(--color-text-muted)' }} onClick={handlePathClick} title={currentPath}>
            {currentPath}
          </span>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto" onContextMenu={handleBgContextMenu}>
        {loading ? (
          <div className="flex items-center justify-center h-20 text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs" style={{ color: 'var(--color-text-dim)' }}>{t('fileList.empty')}</div>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left select-none" style={{ color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)' }}>
                <th className="px-2 py-1 font-medium cursor-pointer hover:underline" onClick={() => handleSort('name')}>
                  {t('fileList.name')}{sortIndicator('name')}
                </th>
                <th className="px-2 py-1 font-medium w-16 text-right cursor-pointer hover:underline" onClick={() => handleSort('size')}>
                  {t('fileList.size')}{sortIndicator('size')}
                </th>
                <th className="px-2 py-1 font-medium w-28 text-right hidden lg:table-cell cursor-pointer hover:underline" onClick={() => handleSort('modified')}>
                  {t('fileList.modified')}{sortIndicator('modified')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedFiles.map((file) => {
                const isSelected = selectedFiles?.has(file.path);
                return (
                  <tr key={file.path} draggable={!!onDragStart}
                    onDragStart={(e) => onDragStart?.(e, file)}
                    onDoubleClick={() => handleDoubleClick(file)}
                    onClick={(e) => onSelect?.(file, e.ctrlKey || e.metaKey)}
                    onContextMenu={(e) => handleRowContextMenu(e, file)}
                    className="cursor-pointer transition-colors"
                    style={isSelected ? { backgroundColor: 'var(--color-accent-bg, rgba(99,102,241,0.15))' } : undefined}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = ''; }}>
                    <td className="px-2 py-1 truncate max-w-[200px]">
                      <span className="mr-1.5">{file.isDirectory ? '📁' : '📄'}</span>
                      <span style={{ color: file.isDirectory ? 'var(--color-file-dir)' : 'var(--color-file-name)' }}>{file.name}</span>
                    </td>
                    <td className="px-2 py-1 text-right" style={{ color: 'var(--color-text-muted)' }}>
                      {file.isDirectory ? '—' : formatSize(file.size)}
                    </td>
                    <td className="px-2 py-1 text-right hidden lg:table-cell" style={{ color: 'var(--color-text-dim)' }}>
                      {formatDate(file.modifiedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div className="fixed z-50 py-0.5 rounded shadow-lg min-w-[120px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y, backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}>
          {ctxMenu.items.map((item, i) => (
            <button key={i}
              className="w-full text-left px-2 py-1 text-[11px] transition-colors hover:bg-[var(--color-hover-bg)]"
              style={{ color: item.danger ? '#ef4444' : 'var(--color-text-primary)' }}
              onClick={() => { setCtxMenu(null); item.onClick(); }}>
              {item.icon && <span className="mr-1.5 text-[10px]">{item.icon}</span>}{item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
