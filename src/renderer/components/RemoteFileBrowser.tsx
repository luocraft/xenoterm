import React, { useState, useEffect, useCallback } from 'react';
import type { FileEntry } from '../../shared/types';
import { useAppStore } from '../store/app-store';
import FileList from './FileList';

interface RemoteFileBrowserProps {
  sessionId: string;
  onDragStart?: (e: React.DragEvent, file: FileEntry, source: 'remote') => void;
  onDrop?: (files: FileEntry[], targetPath: string) => void;
}

export default function RemoteFileBrowser({ sessionId, onDragStart, onDrop }: RemoteFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);

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
      setSelectedFiles(new Set());
    } catch (err) {
      console.error('Failed to list remote directory:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadDirectory('/');
  }, [loadDirectory]);

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
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    // Handle files from OS file manager
    if (e.dataTransfer.files.length > 0) {
      const osFiles: FileEntry[] = Array.from(e.dataTransfer.files).map((f) => ({
        name: f.name,
        path: (f as File & { path?: string }).path || f.name,
        isDirectory: false,
        size: f.size,
        modifiedAt: new Date(f.lastModified).toISOString(),
        permissions: ''
      }));
      onDrop?.(osFiles, currentPath);
      return;
    }

    // Handle drag from local panel
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.source === 'local' && data.file) {
        onDrop?.([data.file], currentPath);
      }
    } catch { /* ignore parse errors */ }
  }, [currentPath, onDrop]);

  return (
    <div
      className={`h-full flex flex-col transition-colors ${
        dragOver ? 'ring-2 ring-[var(--color-accent)] ring-inset rounded-lg' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider flex items-center justify-between" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-input-bg)' }}>
        <span>Remote</span>
        <button
          onClick={() => loadDirectory(currentPath)}
          className="transition-colors"
          style={{ color: 'var(--color-text-dim)' }}
          title="Refresh"
        >
          ↻
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <FileList
          files={files}
          loading={loading}
          currentPath={currentPath}
          onNavigate={loadDirectory}
          onDragStart={handleDragStart}
          selectedFiles={selectedFiles}
          onSelect={handleSelect}
        />
      </div>
      {dragOver && (
        <div className="absolute inset-0 bg-[var(--color-accent)]/10 flex items-center justify-center pointer-events-none rounded-lg">
          <span className="text-sm text-[var(--color-accent)] font-medium">Drop to upload</span>
        </div>
      )}
    </div>
  );
}
