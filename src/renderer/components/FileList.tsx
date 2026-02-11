import React from 'react';
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

interface FileListProps {
  files: FileEntry[];
  loading: boolean;
  currentPath: string;
  onNavigate: (path: string) => void;
  onDragStart?: (e: React.DragEvent, file: FileEntry) => void;
  selectedFiles?: Set<string>;
  onSelect?: (file: FileEntry, multi: boolean) => void;
}

export default function FileList({
  files, loading, currentPath, onNavigate,
  onDragStart, selectedFiles, onSelect
}: FileListProps) {
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

  return (
    <div className="flex flex-col h-full">
      {/* Path bar */}
      <div className="flex items-center gap-1 px-2 py-1.5" style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-input-bg)' }}>
        <button
          onClick={goUp}
          className="px-1.5 py-0.5 text-[10px] rounded transition-colors"
          style={{ backgroundColor: 'var(--color-hover-bg)', color: 'var(--color-text-secondary)' }}
        >
          ↑
        </button>
        <span className="text-[10px] truncate flex-1 font-mono" style={{ color: 'var(--color-text-muted)' }}>{currentPath}</span>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-20 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Loading...
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs" style={{ color: 'var(--color-text-dim)' }}>
            Empty directory
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)' }}>
                <th className="px-2 py-1 font-medium">Name</th>
                <th className="px-2 py-1 font-medium w-16 text-right">Size</th>
                <th className="px-2 py-1 font-medium w-28 text-right hidden lg:table-cell">Modified</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const isSelected = selectedFiles?.has(file.path);
                return (
                  <tr
                    key={file.path}
                    draggable={!!onDragStart}
                    onDragStart={(e) => onDragStart?.(e, file)}
                    onDoubleClick={() => handleDoubleClick(file)}
                    onClick={(e) => onSelect?.(file, e.ctrlKey || e.metaKey)}
                    className={`
                      cursor-pointer transition-colors
                      ${isSelected ? 'bg-[var(--color-accent)]/15' : ''}
                    `}
                    style={!isSelected ? {} : undefined}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = ''; }}
                  >
                    <td className="px-2 py-1 truncate max-w-[200px]">
                      <span className="mr-1.5">{file.isDirectory ? '📁' : '📄'}</span>
                      <span style={{ color: file.isDirectory ? 'var(--color-file-dir)' : 'var(--color-file-name)' }}>
                        {file.name}
                      </span>
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
    </div>
  );
}
