import React, { useState, useEffect, useCallback } from 'react';
import { useT } from '../i18n';
import type { FileEntry } from '../../shared/types';
import FileList, { type ContextMenuItem } from './FileList';

interface LocalFileBrowserProps {
  onDragStart?: (e: React.DragEvent, file: FileEntry, source: 'local') => void;
  onDrop?: (files: FileEntry[], targetPath: string) => void;
  refreshKey?: number;
}

export default function LocalFileBrowser({ onDragStart, onDrop, refreshKey }: LocalFileBrowserProps) {
  const t = useT();
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const entries = await window.api.local.listDirectory(path);
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(entries);
      setCurrentPath(path);
      setSelectedFiles(new Set());
    } catch (err) { console.error('Failed to list local directory:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    window.api.local.getHomePath().then((home) => loadDirectory(home));
  }, [loadDirectory]);

  useEffect(() => {
    if (refreshKey && refreshKey > 0 && currentPath) loadDirectory(currentPath);
  }, [refreshKey]);

  const handleSelect = useCallback((file: FileEntry, multi: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(multi ? prev : []);
      if (next.has(file.path)) next.delete(file.path);
      else next.add(file.path);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, file: FileEntry) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ source: 'local', file }));
    e.dataTransfer.effectAllowed = 'copy';
    onDragStart?.(e, file, 'local');
  }, [onDragStart]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.source === 'remote' && data.file) onDrop?.([data.file], currentPath);
    } catch { /* ignore */ }
  }, [currentPath, onDrop]);

  const buildContextMenu = useCallback((file: FileEntry | null): ContextMenuItem[] => {
    if (!file) {
      return [
        { label: t('sftp.refresh'), icon: '🔄', onClick: () => loadDirectory(currentPath) },
      ];
    }
    return [
      { label: t('sftp.openInExplorer'), icon: '📂', onClick: () => window.api.shell.showItemInFolder(file.path) },
      { label: t('sftp.copyPath'), icon: '📋', onClick: () => window.api.clipboard.writeText(file.path) },
    ];
  }, [t, currentPath, loadDirectory]);

  return (
    <div className={`h-full flex flex-col transition-colors ${dragOver ? 'ring-2 ring-[var(--color-accent)] ring-inset rounded-lg' : ''}`}
      onDragOver={onDrop ? handleDragOver : undefined}
      onDragLeave={onDrop ? handleDragLeave : undefined}
      onDrop={onDrop ? handleDrop : undefined}>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider flex items-center justify-between"
        style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-input-bg)' }}>
        <span>Local</span>
        <button onClick={() => loadDirectory(currentPath)} className="transition-colors"
          style={{ color: 'var(--color-text-dim)' }} title="Refresh">↻</button>
      </div>
      <div className="flex-1 overflow-hidden">
        <FileList files={files} loading={loading} currentPath={currentPath}
          onNavigate={loadDirectory} onDragStart={handleDragStart}
          selectedFiles={selectedFiles} onSelect={handleSelect}
          onContextMenu={buildContextMenu} />
      </div>
    </div>
  );
}
