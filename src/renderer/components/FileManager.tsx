import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { FileEntry } from '../../shared/types';
import { useAppStore } from '../store/app-store';
import LocalFileBrowser from './LocalFileBrowser';
import RemoteFileBrowser from './RemoteFileBrowser';

interface FileManagerProps {
  sessionId: string;
}

export default function FileManager({ sessionId }: FileManagerProps) {
  const addTransfer = useAppStore((s) => s.addTransfer);
  // Bump counters to trigger child refresh after transfer completes
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [remoteRefreshKey, setRemoteRefreshKey] = useState(0);
  // Track which transferIds we initiated and their direction
  const pendingTransfers = useRef<Map<string, 'upload' | 'download'>>(new Map());

  // Listen for progress events — auto-refresh when a transfer completes
  useEffect(() => {
    const unsub = window.api.sftp.onProgress((progress) => {
      if (progress.status === 'completed') {
        const dir = pendingTransfers.current.get(progress.transferId);
        if (dir === 'upload') {
          setRemoteRefreshKey((k) => k + 1);
        } else if (dir === 'download') {
          setLocalRefreshKey((k) => k + 1);
        }
        pendingTransfers.current.delete(progress.transferId);
      }
    });
    return unsub;
  }, []);

  const handleUpload = useCallback(async (files: FileEntry[], targetPath: string) => {
    for (const file of files) {
      try {
        const remotePath = targetPath.endsWith('/')
          ? `${targetPath}${file.name}`
          : `${targetPath}/${file.name}`;
        const transferId = await window.api.sftp.upload(sessionId, file.path, remotePath);
        pendingTransfers.current.set(transferId, 'upload');
        addTransfer({
          transferId,
          filename: file.name,
          direction: 'upload',
          bytesTransferred: 0,
          totalBytes: file.size || 0,
          speed: 0,
          status: 'transferring',
        });
      } catch (err) {
        console.error(`Upload failed for ${file.name}:`, err);
      }
    }
  }, [sessionId, addTransfer]);

  const handleDownload = useCallback(async (files: FileEntry[], targetPath: string) => {
    for (const file of files) {
      try {
        const sep = targetPath.includes('/') ? '/' : '\\';
        const localPath = targetPath.endsWith(sep)
          ? `${targetPath}${file.name}`
          : `${targetPath}${sep}${file.name}`;
        const transferId = await window.api.sftp.download(sessionId, file.path, localPath);
        pendingTransfers.current.set(transferId, 'download');
        addTransfer({
          transferId,
          filename: file.name,
          direction: 'download',
          bytesTransferred: 0,
          totalBytes: file.size || 0,
          speed: 0,
          status: 'transferring',
        });
      } catch (err) {
        console.error(`Download failed for ${file.name}:`, err);
      }
    }
  }, [sessionId, addTransfer]);

  return (
    <div className="h-full flex">
      {/* Local panel */}
      <div className="flex-1 overflow-hidden" style={{ borderRight: '1px solid var(--color-border)' }}>
        <LocalFileBrowser onDrop={handleDownload} refreshKey={localRefreshKey} />
      </div>
      {/* Remote panel */}
      <div className="flex-1 overflow-hidden relative">
        <RemoteFileBrowser
          sessionId={sessionId}
          onDrop={handleUpload}
          refreshKey={remoteRefreshKey}
          onDragStart={(e, file) => {
            e.dataTransfer.setData('application/json', JSON.stringify({ source: 'remote', file }));
            e.dataTransfer.effectAllowed = 'copy';
          }}
        />
      </div>
    </div>
  );
}
