import { contextBridge, ipcRenderer } from 'electron';
import type {
  HostEntry,
  SSHSession,
  FileEntry,
  TransferProgress,
  AppConfig,
  ImportResult,
  NetSession,
  NetProtocol,
  SerialConfig,
  SerialSession,
  SerialPortInfo
} from '../shared/types';

const api = {
  ssh: {
    connect: (config: HostEntry, password?: string): Promise<SSHSession> =>
      ipcRenderer.invoke('ssh:connect', config, password),
    disconnect: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('ssh:disconnect', sessionId),
    write: (sessionId: string, data: string): void =>
      ipcRenderer.send('ssh:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number): void =>
      ipcRenderer.send('ssh:resize', sessionId, cols, rows),
    onData: (sessionId: string, callback: (data: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, data: string) => {
        if (sid === sessionId) callback(data);
      };
      ipcRenderer.on('ssh:data', handler);
      return () => ipcRenderer.removeListener('ssh:data', handler);
    },
    onClose: (sessionId: string, callback: () => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string) => {
        if (sid === sessionId) callback();
      };
      ipcRenderer.on('ssh:close', handler);
      return () => ipcRenderer.removeListener('ssh:close', handler);
    },
    onError: (sessionId: string, callback: (error: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, error: string) => {
        if (sid === sessionId) callback(error);
      };
      ipcRenderer.on('ssh:error', handler);
      return () => ipcRenderer.removeListener('ssh:error', handler);
    }
  },
  sftp: {
    listDirectory: (sessionId: string, path: string): Promise<FileEntry[]> =>
      ipcRenderer.invoke('sftp:list', sessionId, path),
    upload: (sessionId: string, localPath: string, remotePath: string): Promise<string> =>
      ipcRenderer.invoke('sftp:upload', sessionId, localPath, remotePath),
    download: (sessionId: string, remotePath: string, localPath: string): Promise<string> =>
      ipcRenderer.invoke('sftp:download', sessionId, remotePath, localPath),
    cancelTransfer: (transferId: string): Promise<void> =>
      ipcRenderer.invoke('sftp:cancel', transferId),
    onProgress: (callback: (progress: TransferProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: TransferProgress) => {
        callback(progress);
      };
      ipcRenderer.on('sftp:progress', handler);
      return () => ipcRenderer.removeListener('sftp:progress', handler);
    }
  },
  config: {
    getHosts: (): Promise<HostEntry[]> =>
      ipcRenderer.invoke('config:getHosts'),
    saveHost: (entry: HostEntry): Promise<void> =>
      ipcRenderer.invoke('config:saveHost', entry),
    deleteHost: (id: string): Promise<void> =>
      ipcRenderer.invoke('config:deleteHost', id),
    exportConfig: (): Promise<string> =>
      ipcRenderer.invoke('config:export'),
    importConfig: (json: string): Promise<ImportResult> =>
      ipcRenderer.invoke('config:import', json),
    getAppConfig: (): Promise<AppConfig> =>
      ipcRenderer.invoke('config:getAppConfig'),
    setAppConfig: (config: Partial<AppConfig>): Promise<void> =>
      ipcRenderer.invoke('config:setAppConfig', config),
    getCommandHistory: (): Promise<{ cmd: string; ts: number; hostName?: string }[]> =>
      ipcRenderer.invoke('config:getCommandHistory'),
    setCommandHistory: (history: { cmd: string; ts: number; hostName?: string }[]): Promise<void> =>
      ipcRenderer.invoke('config:setCommandHistory', history)
  },
  dialog: {
    selectFile: (options?: { directory?: boolean }): Promise<string | null> =>
      ipcRenderer.invoke('dialog:selectFile', options),
    selectSaveLocation: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:selectSaveLocation', defaultName)
  },
  local: {
    listDirectory: (dirPath: string): Promise<FileEntry[]> =>
      ipcRenderer.invoke('local:listDirectory', dirPath),
    getHomePath: (): Promise<string> =>
      ipcRenderer.invoke('local:getHomePath')
  },
  theme: {
    updateTitlebar: (bgColor: string, symbolColor: string): void =>
      ipcRenderer.send('theme:update-titlebar', bgColor, symbolColor)
  },
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close')
  },
  help: {
    open: (): void => ipcRenderer.send('help:open')
  },
  net: {
    create: (protocol: NetProtocol, host: string, port: number, localPort?: number): Promise<NetSession> =>
      ipcRenderer.invoke('net:create', protocol, host, port, localPort),
    close: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('net:close', sessionId),
    send: (sessionId: string, hexData: string, remoteAddress?: string): void =>
      ipcRenderer.send('net:send', sessionId, hexData, remoteAddress),
    onData: (sessionId: string, callback: (hexData: string, remote?: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, data: string, remote?: string) => {
        if (sid === sessionId) callback(data, remote);
      };
      ipcRenderer.on('net:data', handler);
      return () => ipcRenderer.removeListener('net:data', handler);
    },
    onClose: (sessionId: string, callback: () => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string) => {
        if (sid === sessionId) callback();
      };
      ipcRenderer.on('net:close', handler);
      return () => ipcRenderer.removeListener('net:close', handler);
    },
    onError: (sessionId: string, callback: (error: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, error: string) => {
        if (sid === sessionId) callback(error);
      };
      ipcRenderer.on('net:error', handler);
      return () => ipcRenderer.removeListener('net:error', handler);
    },
    onClients: (sessionId: string, callback: (clients: string[]) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, clients: string[]) => {
        if (sid === sessionId) callback(clients);
      };
      ipcRenderer.on('net:clients', handler);
      return () => ipcRenderer.removeListener('net:clients', handler);
    }
  },
  serial: {
    list: (): Promise<SerialPortInfo[]> =>
      ipcRenderer.invoke('serial:list'),
    open: (config: SerialConfig): Promise<SerialSession> =>
      ipcRenderer.invoke('serial:open', config),
    close: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('serial:close', sessionId),
    write: (sessionId: string, hexData: string): void =>
      ipcRenderer.send('serial:write', sessionId, hexData),
    setDTR: (sessionId: string, value: boolean): void =>
      ipcRenderer.send('serial:setDTR', sessionId, value),
    setRTS: (sessionId: string, value: boolean): void =>
      ipcRenderer.send('serial:setRTS', sessionId, value),
    onData: (sessionId: string, callback: (hexData: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, data: string) => {
        if (sid === sessionId) callback(data);
      };
      ipcRenderer.on('serial:data', handler);
      return () => ipcRenderer.removeListener('serial:data', handler);
    },
    onClose: (sessionId: string, callback: () => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string) => {
        if (sid === sessionId) callback();
      };
      ipcRenderer.on('serial:close', handler);
      return () => ipcRenderer.removeListener('serial:close', handler);
    },
    onError: (sessionId: string, callback: (error: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, error: string) => {
        if (sid === sessionId) callback(error);
      };
      ipcRenderer.on('serial:error', handler);
      return () => ipcRenderer.removeListener('serial:error', handler);
    }
  }
};

contextBridge.exposeInMainWorld('api', api);

// Type declaration for renderer process
export type ElectronAPI = typeof api;
