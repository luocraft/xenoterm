import React, { useCallback } from 'react';
import type { FileEntry } from '../../shared/types';
import { useAppStore } from '../store/app-store';
import LocalFileBrowser from './LocalFileBrowser';
import RemoteFileBrowser from './RemoteFileBrowser';

interface FileManagerProps {
  sessionId: string;
}

export default function FileManager({ sessionId }: FileManagerProps) {
  const addTransfer = useAppStore((s) => s.addTransfer);

  const handleUpload = useCallback(async (files: FileEntry[], targetPath: string) => {
    for (const file of files) {
      try {
        const remotePath = targetPath.endsWith('/')
          ? `${targetPath}${file.name}`
          : `${targetPath}/${file.name}`;
        await window.api.sftp.upload(sessionId, file.path, remotePath);
      } catch (err) {
        console.error(`Upload failed for ${file.name}:`, err);
      }
    }
  }, [sessionId]);

  const handleDownload = useCallback(async (files: FileEntry[], targetPath: string) => {
    for (const file of files) {
      try {
        const localPath = `${targetPath}/${file.name}`;
        await window.api.sftp.download(sessionId, file.path, localPath);
      } catch (err) {
        console.error(`Download failed for ${file.name}:`, err);
      }
    }
  }, [sessionId]);

  return (
    <div className="h-full flex">
      {/* Local panel */}
      <div className="flex-1 overflow-hidden" style={{ borderRight: '1px solid var(--color-border)' }}>
        <LocalFileBrowser />
      </div>
      {/* Remote panel */}
      <div className="flex-1 overflow-hidden relative">
        <RemoteFileBrowser
          sessionId={sessionId}
          onDrop={handleUpload}
        />
      </div>
    </div>
  );
}
