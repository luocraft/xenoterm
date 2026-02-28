import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useT } from '../i18n';
import type { FileEntry } from '../../shared/types';
import FileList, { type ContextMenuItem } from './FileList';

interface RemoteFileBrowserProps {
  sessionId: string;
  onDragStart?: (e: React.DragEvent, file: FileEntry, source: 'remote') => void;
  onDrop?: (files: FileEntry[], targetPath: string) => void;
  onDownloadFiles?: (files: FileEntry[], targetPath: string) => void;
  refreshKey?: number;
  syncPath?: string;
}

const remotePathCache = new Map<string, string>();

export default function RemoteFileBrowser({ sessionId, onDragStart, onDrop, onDownloadFiles, refreshKey, syncPath }: RemoteFileBrowserProps) {
  const t = useT();
  const [currentPath, setCurrentPath] = useState(() => remotePathCache.get(sessionId) || '/');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewPathRef = useRef<string>('');
  // Inline rename state
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Inline new folder state
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // Chmod dialog
  const [chmodTarget, setChmodTarget] = useState<FileEntry | null>(null);
  const [chmodValue, setChmodValue] = useState('');

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const entries = await window.api.sftp.listDirectory(sessionId, path);
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(entries);
      setCurrentPath(path);
      remotePathCache.set(sessionId, path);
      lastPreviewPathRef.current = path;
      setSelectedFiles(new Set());
    } catch (err) {
      console.error('Failed to list remote directory:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const previewDirectory = useCallback(async (path: string) => {
    if (path === lastPreviewPathRef.current) return;
    lastPreviewPathRef.current = path;
    setLoading(true);
    try {
      const entries = await window.api.sftp.listDirectory(sessionId, path);
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(entries);
      setSelectedFiles(new Set());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [sessionId]);

  const handlePathInputChange = useCallback((value: string) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    if (!value.trim()) return;
    if (value.endsWith('/') || value.endsWith('\\')) {
      previewTimerRef.current = setTimeout(() => previewDirectory(value.trim()), 300);
    }
  }, [previewDirectory]);

  useEffect(() => {
    loadDirectory(remotePathCache.get(sessionId) || '/');
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [loadDirectory]);

  useEffect(() => {
    if (refreshKey && refreshKey > 0 && currentPath) loadDirectory(currentPath);
  }, [refreshKey]);

  // Sync to terminal CWD when it changes
  const syncedPathRef = useRef<string>('');
  useEffect(() => {
    if (syncPath && syncPath !== syncedPathRef.current) {
      syncedPathRef.current = syncPath;
      loadDirectory(syncPath);
    }
  }, [syncPath, loadDirectory]);

  const handleSelect = useCallback((file: FileEntry, multi: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(multi ? prev : []);
      if (next.has(file.path)) next.delete(file.path);
      else next.add(file.path);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, file: FileEntry) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ source: 'remote', file }));
    e.dataTransfer.effectAllowed = 'copy';
    onDragStart?.(e, file, 'remote');
  }, [onDragStart]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      const osFiles: FileEntry[] = [];
      for (const f of Array.from(e.dataTransfer.files)) {
        const filePath = (f as File & { path?: string }).path || f.name;
        // Use main process fs.stat to reliably detect directories
        const isDir = await window.api.local.isDirectory(filePath);
        osFiles.push({
          name: f.name, path: filePath,
          isDirectory: isDir, size: f.size, modifiedAt: new Date(f.lastModified).toISOString(), permissions: ''
        });
      }
      onDrop?.(osFiles, currentPath);
      return;
    }
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.source === 'local' && data.file) onDrop?.([data.file], currentPath);
    } catch { /* ignore */ }
  }, [currentPath, onDrop]);

  // === Context menu actions ===
  const handleDelete = useCallback(async (file: FileEntry) => {
    if (!confirm(t('sftp.confirmDelete').replace('{name}', file.name))) return;
    try {
      await window.api.sftp.delete(sessionId, file.path);
      loadDirectory(currentPath);
    } catch (err) { console.error('Delete failed:', err); }
  }, [sessionId, currentPath, loadDirectory, t]);

  const handleRenameSubmit = useCallback(async (file: FileEntry) => {
    const newName = renameValue.trim();
    if (!newName || newName === file.name) { setRenaming(null); return; }
    const parentPath = currentPath.endsWith('/') ? currentPath : currentPath + '/';
    try {
      await window.api.sftp.rename(sessionId, file.path, parentPath + newName);
      loadDirectory(currentPath);
    } catch (err) { console.error('Rename failed:', err); }
    setRenaming(null);
  }, [sessionId, currentPath, renameValue, loadDirectory]);

  const handleNewFolderSubmit = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) { setCreatingFolder(false); return; }
    const parentPath = currentPath.endsWith('/') ? currentPath : currentPath + '/';
    try {
      await window.api.sftp.mkdir(sessionId, parentPath + name);
      loadDirectory(currentPath);
    } catch (err) { console.error('Mkdir failed:', err); }
    setCreatingFolder(false);
    setNewFolderName('');
  }, [sessionId, currentPath, newFolderName, loadDirectory]);

  const handleChmodSubmit = useCallback(async () => {
    if (!chmodTarget) return;
    const mode = parseInt(chmodValue, 8);
    if (isNaN(mode)) { setChmodTarget(null); return; }
    try {
      await window.api.sftp.chmod(sessionId, chmodTarget.path, mode);
      loadDirectory(currentPath);
    } catch (err) { console.error('Chmod failed:', err); }
    setChmodTarget(null);
  }, [sessionId, currentPath, chmodTarget, chmodValue, loadDirectory]);

  const buildContextMenu = useCallback((file: FileEntry | null): ContextMenuItem[] => {
    if (!file) {
      return [
        { label: t('sftp.newFolder'), icon: '📁', onClick: () => { setCreatingFolder(true); setNewFolderName(''); } },
        { label: t('sftp.refresh'), icon: '🔄', onClick: () => loadDirectory(currentPath) },
      ];
    }
    return [
      { label: t('sftp.rename'), icon: '✏️', onClick: () => { setRenaming(file.path); setRenameValue(file.name); } },
      { label: t('sftp.chmod'), icon: '🔒', onClick: () => { setChmodTarget(file); setChmodValue(file.permissions || '644'); } },
      { label: t('common.delete'), icon: '🗑️', danger: true, onClick: () => handleDelete(file) },
    ];
  }, [t, currentPath, loadDirectory, handleDelete]);

  // Wrap files to inject inline rename input
  const displayFiles = React.useMemo(() => files, [files]);

  return (
    <div className={`h-full flex flex-col transition-colors ${dragOver ? 'ring-2 ring-[var(--color-accent)] ring-inset rounded-lg' : ''}`}
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider flex items-center justify-between"
        style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-input-bg)' }}>
        <span>Remote</span>
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              if (selectedFiles.size === 0) return;
              const targetPath = await window.api.local.ensureXtDownload();
              const selected = files.filter((f) => selectedFiles.has(f.path));
              onDownloadFiles?.(selected, targetPath);
            }}
            className="transition-colors px-1"
            style={{ color: selectedFiles.size > 0 ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
            title="Download selected to ~/Desktop/xtdownload">⬇</button>
          <button
            onClick={async () => {
              const dir = await window.api.local.ensureXtDownload();
              window.api.shell.openPath(dir);
            }}
            className="transition-colors px-1"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Open xtdownload folder">📂</button>
          <button onClick={() => loadDirectory(currentPath)} className="transition-colors"
            style={{ color: 'var(--color-text-secondary)' }} title="Refresh">↻</button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <FileList files={displayFiles} loading={loading} currentPath={currentPath}
          onNavigate={loadDirectory} onDragStart={handleDragStart}
          selectedFiles={selectedFiles} onSelect={handleSelect}
          onPathInputChange={handlePathInputChange}
          onContextMenu={buildContextMenu} />
      </div>

      {/* Inline rename overlay */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
          onClick={() => setRenaming(null)}>
          <div className="p-3 rounded-lg shadow-xl" style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="text-xs mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('sftp.rename')}</div>
            <input className="w-64 px-2 py-1 text-xs rounded outline-none" autoFocus
              style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
              value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { const f = files.find((f) => f.path === renaming); if (f) handleRenameSubmit(f); }
                if (e.key === 'Escape') setRenaming(null);
              }} />
            <div className="flex justify-end gap-2 mt-2">
              <button className="px-2 py-1 text-[10px] rounded" style={{ color: 'var(--color-text-muted)' }}
                onClick={() => setRenaming(null)}>{t('common.cancel')}</button>
              <button className="px-2 py-1 text-[10px] rounded bg-[var(--color-accent)] text-white"
                onClick={() => { const f = files.find((f) => f.path === renaming); if (f) handleRenameSubmit(f); }}>{t('common.ok')}</button>
            </div>
          </div>
        </div>
      )}

      {/* New folder overlay */}
      {creatingFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
          onClick={() => setCreatingFolder(false)}>
          <div className="p-3 rounded-lg shadow-xl" style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="text-xs mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('sftp.newFolder')}</div>
            <input className="w-64 px-2 py-1 text-xs rounded outline-none" autoFocus placeholder={t('sftp.folderName')}
              style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
              value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNewFolderSubmit(); if (e.key === 'Escape') setCreatingFolder(false); }} />
            <div className="flex justify-end gap-2 mt-2">
              <button className="px-2 py-1 text-[10px] rounded" style={{ color: 'var(--color-text-muted)' }}
                onClick={() => setCreatingFolder(false)}>{t('common.cancel')}</button>
              <button className="px-2 py-1 text-[10px] rounded bg-[var(--color-accent)] text-white"
                onClick={handleNewFolderSubmit}>{t('common.ok')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Chmod overlay */}
      {chmodTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
          onClick={() => setChmodTarget(null)}>
          <div className="p-3 rounded-lg shadow-xl" style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="text-xs mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('sftp.chmod')} — {chmodTarget.name}</div>
            <input className="w-40 px-2 py-1 text-xs rounded outline-none font-mono" autoFocus placeholder="755"
              style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
              value={chmodValue} onChange={(e) => setChmodValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleChmodSubmit(); if (e.key === 'Escape') setChmodTarget(null); }} />
            <div className="flex justify-end gap-2 mt-2">
              <button className="px-2 py-1 text-[10px] rounded" style={{ color: 'var(--color-text-muted)' }}
                onClick={() => setChmodTarget(null)}>{t('common.cancel')}</button>
              <button className="px-2 py-1 text-[10px] rounded bg-[var(--color-accent)] text-white"
                onClick={handleChmodSubmit}>{t('common.ok')}</button>
            </div>
          </div>
        </div>
      )}

      {dragOver && (
        <div className="absolute inset-0 bg-[var(--color-accent)]/10 flex items-center justify-center pointer-events-none rounded-lg">
          <span className="text-sm text-[var(--color-accent)] font-medium">Drop to upload</span>
        </div>
      )}
    </div>
  );
}
