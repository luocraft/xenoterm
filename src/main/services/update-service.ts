import { app, dialog, BrowserWindow } from 'electron';
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import type { UpdateStatusSnapshot } from '../../shared/types';
import { ConfigStore } from './config-store';

const UPDATE_FEED_URL = 'https://xenotech.net/api/update';
type AppAutoUpdater = typeof import('electron-updater')['autoUpdater'];

function isUpdateSupported(): boolean {
  return process.platform === 'win32' && app.isPackaged;
}

function getLocaleText() {
  const locale = app.getLocale().toLowerCase();
  const isZh = locale.startsWith('zh');

  return isZh
    ? {
        disabled: '自动更新仅在安装版中可用。',
        installTitle: '发现新版本',
        installMessage: '新版本 {version} 已下载完成，是否现在安装？',
        installNow: '立即安装',
        installLater: '稍后'
      }
    : {
        disabled: 'Auto update is only available in the packaged app.',
        installTitle: 'Update Ready',
        installMessage: 'Version {version} has been downloaded. Install it now?',
        installNow: 'Install now',
        installLater: 'Later'
      };
}

function nowIso(): string {
  return new Date().toISOString();
}

export class UpdateService {
  private readonly configStore = new ConfigStore();
  private readonly listeners = new Set<(status: UpdateStatusSnapshot) => void>();
  private autoUpdater: AppAutoUpdater | null = null;
  private initialized = false;
  private installPromptVersion: string | null = null;
  private getWindow: (() => BrowserWindow | null) | null = null;
  private status: UpdateStatusSnapshot = this.createStatus();

  initialize(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow;
    this.status = this.createStatus();

    if (this.initialized) {
      this.emit();
      return;
    }

    this.initialized = true;

    if (!this.status.enabled) {
      this.emit();
      return;
    }

    const autoUpdater = this.ensureAutoUpdater();
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = console;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: UPDATE_FEED_URL
    });

    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({
        state: 'checking',
        checkedAt: nowIso(),
        error: undefined,
        progressPercent: undefined,
        transferredBytes: undefined,
        totalBytes: undefined,
        bytesPerSecond: undefined,
        downloadedVersion: undefined
      });
    });

    autoUpdater.on('update-available', (info) => {
      this.updateFromInfo(info, {
        state: 'available',
        error: undefined
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      this.updateStatus({
        state: 'not-available',
        availableVersion: undefined,
        downloadedVersion: undefined,
        progressPercent: undefined,
        transferredBytes: undefined,
        totalBytes: undefined,
        bytesPerSecond: undefined,
        releaseDate: info.releaseDate ? new Date(info.releaseDate).toISOString() : undefined,
        error: undefined
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.applyProgress(progress);
    });

    autoUpdater.on('update-downloaded', (event) => {
      this.updateFromInfo(event, {
        state: 'downloaded',
        downloadedVersion: event.version,
        progressPercent: 100,
        error: undefined
      });
      void this.promptForInstall(event);
    });

    autoUpdater.on('error', (error) => {
      this.updateStatus({
        state: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    });

    this.emit();
  }

  getStatus(): UpdateStatusSnapshot {
    const autoCheckOnStartup = this.getAutoCheckEnabled();
    if (this.status.autoCheckOnStartup !== autoCheckOnStartup) {
      this.status = {
        ...this.status,
        autoCheckOnStartup
      };
    }
    return { ...this.status };
  }

  onStatusChange(listener: (status: UpdateStatusSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async checkForUpdates(manual = false): Promise<UpdateStatusSnapshot> {
    if (!this.initialized) {
      this.initialize(() => BrowserWindow.getAllWindows()[0] ?? null);
    }

    this.status = {
      ...this.status,
      autoCheckOnStartup: this.getAutoCheckEnabled(),
      lastCheckManual: manual
    };
    this.emit();

    if (!this.status.enabled) {
      this.updateStatus({
        state: 'disabled',
        error: getLocaleText().disabled
      });
      return this.getStatus();
    }

    if (this.status.state === 'checking' || this.status.state === 'downloading') {
      return this.getStatus();
    }

    if (this.status.state === 'downloaded') {
      return this.getStatus();
    }

    const autoUpdater = this.autoUpdater ?? this.ensureAutoUpdater();
    await autoUpdater.checkForUpdates();
    return this.getStatus();
  }

  scheduleStartupCheck(): void {
    if (!this.getStatus().enabled || !this.getAutoCheckEnabled()) {
      return;
    }

    setTimeout(() => {
      void this.checkForUpdates(false).catch((error) => {
        console.error('[update] automatic check failed:', error);
      });
    }, 4000);
  }

  setAutoCheckOnStartup(enabled: boolean): UpdateStatusSnapshot {
    this.configStore.setAppConfig({ autoCheckUpdates: enabled });
    this.updateStatus({
      autoCheckOnStartup: enabled
    });
    return this.getStatus();
  }

  quitAndInstall(): void {
    if (!this.status.enabled || this.status.state !== 'downloaded') {
      return;
    }

    const autoUpdater = this.autoUpdater ?? this.ensureAutoUpdater();
    autoUpdater.quitAndInstall(false, true);
  }

  private createStatus(): UpdateStatusSnapshot {
    return {
      enabled: isUpdateSupported(),
      currentVersion: app.getVersion(),
      autoCheckOnStartup: this.getAutoCheckEnabled(),
      state: isUpdateSupported() ? 'idle' : 'disabled',
      lastCheckManual: false
    };
  }

  private getAutoCheckEnabled(): boolean {
    try {
      return this.configStore.getAppConfig().autoCheckUpdates !== false;
    } catch {
      return true;
    }
  }

  private updateStatus(partial: Partial<UpdateStatusSnapshot>): void {
    this.status = {
      ...this.status,
      ...partial,
      currentVersion: app.getVersion()
    };
    this.emit();
  }

  private updateFromInfo(info: UpdateInfo, partial: Partial<UpdateStatusSnapshot>): void {
    this.updateStatus({
      ...partial,
      availableVersion: info.version,
      releaseDate: info.releaseDate ? new Date(info.releaseDate).toISOString() : undefined
    });
  }

  private applyProgress(progress: ProgressInfo): void {
    this.updateStatus({
      state: 'downloading',
      progressPercent: progress.percent,
      transferredBytes: progress.transferred,
      totalBytes: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      error: undefined
    });
  }

  private emit(): void {
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private ensureAutoUpdater(): AppAutoUpdater {
    if (!this.autoUpdater) {
      // Delay loading electron-updater until packaged builds where it is actually needed.
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
      this.autoUpdater = autoUpdater;
    }

    return this.autoUpdater;
  }

  private async promptForInstall(event: UpdateDownloadedEvent): Promise<void> {
    if (this.installPromptVersion === event.version) {
      return;
    }

    this.installPromptVersion = event.version;
    const text = getLocaleText();
    const win = this.getWindow?.() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const options = {
      type: 'info',
      buttons: [text.installNow, text.installLater],
      defaultId: 0,
      cancelId: 1,
      title: text.installTitle,
      message: text.installTitle,
      detail: text.installMessage.replace('{version}', event.version)
    } as const;
    const result = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);

    if (result.response === 0) {
      this.quitAndInstall();
    }
  }
}

export const updateService = new UpdateService();
