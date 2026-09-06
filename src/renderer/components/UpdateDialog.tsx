import React, { useState } from 'react';
import { useI18nStore, useT } from '../i18n';
import { useAppStore } from '../store/app-store';
import { getUpdateText } from '../update-text';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getStatusText(state: string, text: ReturnType<typeof getUpdateText>): string {
  switch (state) {
    case 'checking':
      return text.status.checking;
    case 'available':
      return text.status.available;
    case 'not-available':
      return text.status.notAvailable;
    case 'downloading':
      return text.status.downloading;
    case 'downloaded':
      return text.status.downloaded;
    case 'error':
      return text.status.error;
    case 'disabled':
      return text.status.disabled;
    default:
      return text.status.idle;
  }
}

export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  const text = getUpdateText(locale);
  const updateStatus = useAppStore((s) => s.updateStatus);
  const checkForUpdates = useAppStore((s) => s.checkForUpdates);
  const setAutoCheckUpdates = useAppStore((s) => s.setAutoCheckUpdates);
  const quitAndInstallUpdate = useAppStore((s) => s.quitAndInstallUpdate);
  const [checking, setChecking] = useState(false);
  const [toggling, setToggling] = useState(false);

  if (!updateStatus) return null;

  const handleCheck = async () => {
    setChecking(true);
    try {
      await checkForUpdates();
    } finally {
      setChecking(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await setAutoCheckUpdates(enabled);
    } finally {
      setToggling(false);
    }
  };

  const isDownloading = updateStatus.state === 'downloading';
  const canInstall = updateStatus.state === 'downloaded';
  const canCheck = !checking && !isDownloading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-overlay)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-2xl w-[420px] overflow-hidden"
        style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {text.title}
          </h2>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center text-xs hover:bg-[var(--color-hover-bg)] transition-colors"
            style={{ color: 'var(--color-text-dim)' }}
          >
            x
          </button>
        </div>

        <div className="px-4 pb-4 space-y-3">
          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] mb-1" style={{ color: 'var(--color-text-dim)' }}>
                  {text.currentVersion}
                </p>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  v{updateStatus.currentVersion}
                </p>
              </div>
              {(updateStatus.availableVersion || updateStatus.downloadedVersion) && (
                <div className="text-right">
                  <p className="text-[10px] mb-1" style={{ color: 'var(--color-text-dim)' }}>
                    {text.availableVersion}
                  </p>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>
                    v{updateStatus.downloadedVersion || updateStatus.availableVersion}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] mb-1" style={{ color: 'var(--color-text-dim)' }}>
                  {t('common.status')}
                </p>
                <p className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {getStatusText(updateStatus.state, text)}
                </p>
              </div>

              <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={updateStatus.autoCheckOnStartup}
                  disabled={toggling}
                  onChange={(e) => void handleToggle(e.target.checked)}
                />
                {text.autoCheck}
              </label>
            </div>

            {isDownloading && (
              <div className="mt-3 space-y-2">
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(0, Math.min(100, updateStatus.progressPercent || 0))}%`,
                      background: 'linear-gradient(90deg, var(--color-accent), #4cc7ff)'
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
                  <span>{text.progress}</span>
                  <span>
                    {Math.round(updateStatus.progressPercent || 0)}% - {formatBytes(updateStatus.transferredBytes)} / {formatBytes(updateStatus.totalBytes)}
                  </span>
                </div>
              </div>
            )}

            {updateStatus.error && updateStatus.state === 'error' && (
              <div className="mt-3 text-[11px] rounded-lg px-2.5 py-2" style={{ backgroundColor: '#ef444415', color: '#ef4444' }}>
                {updateStatus.error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)' }}
            >
              {t('common.close')}
            </button>

            {canInstall ? (
              <button
                onClick={() => void quitAndInstallUpdate()}
                className="px-4 py-1.5 text-xs rounded-lg text-white font-medium"
                style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)' }}
              >
                {text.installNow}
              </button>
            ) : (
              <button
                onClick={() => void handleCheck()}
                disabled={!canCheck}
                className="px-4 py-1.5 text-xs rounded-lg text-white font-medium transition-opacity disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)' }}
              >
                {checking || updateStatus.state === 'checking' ? text.status.checking : text.checkNow}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
