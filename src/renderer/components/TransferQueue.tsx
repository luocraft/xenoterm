import React, { useEffect } from 'react';
import { useAppStore } from '../store/app-store';
import type { TransferProgress } from '../../shared/types';

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '—';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(Math.floor(Math.log(bytesPerSec) / Math.log(1024)), units.length - 1);
  return `${(bytesPerSec / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatETA(progress: TransferProgress): string {
  if (progress.speed <= 0 || progress.totalBytes <= 0) return '—';
  const remaining = progress.totalBytes - progress.bytesTransferred;
  const seconds = Math.ceil(remaining / progress.speed);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
}

function percentage(p: TransferProgress): number {
  if (p.totalBytes <= 0) return 0;
  return Math.min(100, Math.round((p.bytesTransferred / p.totalBytes) * 100));
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'cancelled': return '⊘';
    case 'transferring': return '↕';
    default: return '⏳';
  }
};

const statusColor = (status: string) => {
  switch (status) {
    case 'completed': return 'text-green-400';
    case 'failed': return 'text-red-400';
    case 'cancelled': return 'text-gray-500';
    case 'transferring': return 'text-blue-400';
    default: return 'text-yellow-400';
  }
};

export default function TransferQueue() {
  const transfers = useAppStore((s) => s.transfers);
  const updateTransfer = useAppStore((s) => s.updateTransfer);
  const removeTransfer = useAppStore((s) => s.removeTransfer);

  // Listen for progress updates from main process
  useEffect(() => {
    const unsub = window.api.sftp.onProgress((progress) => {
      updateTransfer(progress.transferId, progress);
    });
    return unsub;
  }, [updateTransfer]);

  const handleCancel = async (transferId: string) => {
    await window.api.sftp.cancelTransfer(transferId);
    updateTransfer(transferId, { status: 'cancelled' });
  };

  const activeTransfers = transfers.filter((t) => t.status === 'pending' || t.status === 'transferring');
  const completedTransfers = transfers.filter((t) => t.status !== 'pending' && t.status !== 'transferring');

  if (transfers.length === 0) {
    return (
      <div className="p-4 text-center text-xs" style={{ color: 'var(--color-text-dim)' }}>
        No transfers
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {activeTransfers.length > 0 && (
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Active ({activeTransfers.length})
        </div>
      )}
      {activeTransfers.map((t) => (
        <TransferItem key={t.transferId} transfer={t} onCancel={handleCancel} />
      ))}

      {completedTransfers.length > 0 && (
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider mt-1" style={{ color: 'var(--color-text-muted)' }}>
          History ({completedTransfers.length})
        </div>
      )}
      {completedTransfers.map((t) => (
        <TransferItem key={t.transferId} transfer={t} onRemove={() => removeTransfer(t.transferId)} />
      ))}
    </div>
  );
}

function TransferItem({
  transfer,
  onCancel,
  onRemove
}: {
  transfer: TransferProgress;
  onCancel?: (id: string) => void;
  onRemove?: () => void;
}) {
  const pct = percentage(transfer);
  const isActive = transfer.status === 'pending' || transfer.status === 'transferring';

  return (
    <div className="mx-2 mb-1 p-2 rounded-lg transition-colors group" style={{ backgroundColor: 'var(--color-input-bg)' }}>
      <div className="flex items-center gap-2">
        <span className={`text-xs ${statusColor(transfer.status)}`}>
          {statusIcon(transfer.status)}
        </span>
        <span className="text-[11px] truncate flex-1" style={{ color: 'var(--color-text-primary)' }}>{transfer.filename}</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {transfer.direction === 'upload' ? '↑' : '↓'}
        </span>
        {isActive && onCancel && (
          <button
            onClick={() => onCancel(transfer.transferId)}
            className="text-[10px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-text-dim)' }}
          >
            ✕
          </button>
        )}
        {!isActive && onRemove && (
          <button
            onClick={onRemove}
            className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-text-dim)' }}
          >
            ✕
          </button>
        )}
      </div>

      {isActive && (
        <>
          {/* Progress bar */}
          <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-input-bg)' }}>
            <div
              className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            <span>{pct}%</span>
            <span>{formatSpeed(transfer.speed)}</span>
            <span>ETA {formatETA(transfer)}</span>
          </div>
        </>
      )}

      {transfer.status === 'failed' && transfer.error && (
        <p className="mt-1 text-[10px] text-red-400 truncate">{transfer.error}</p>
      )}
    </div>
  );
}
