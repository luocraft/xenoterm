import React, { useState, useEffect, useCallback } from 'react';
import type { FileEntry } from '../../shared/types';
import FileList from './FileList';

interface LocalFileBrowserProps {
  onDragStart?: (e: React.DragEvent, file: FileEntry, source: 'local') => void;
}

export default function LocalFileBrowser({ onDragStart }: LocalFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const entries = await window.api.local.listDirectory(path);
      // Sort: directories first, then alphabetical
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(entries);
      setCurrentPath(path);
      setSelectedFiles(new Set());
    } catch (err) {
      console.error('Failed to list local directory:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.api.local.getHomePath().then((home) => loadDirectory(home));
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
    e.dataTransfer.setData('application/json', JSON.stringify({ source: 'local', file }));
    e.dataTransfer.effectAllowed = 'copy';
    onDragStart?.(e, file, 'local');
  }, [onDragStart]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-input-bg)' }}>
        Local
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
    </div>
  );
}
