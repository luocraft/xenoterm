import { contextBridge, ipcRenderer, clipboard } from 'electron';
import type {
  HostEntry,
  SSHSession,
  RemoteResources,
  FileEntry,
  TransferProgress,
  AppConfig,
  ImportResult,
  UpdateStatusSnapshot,
} from '../shared/types';
const api = {
  ssh: {
    getResources: (sessionId: string): Promise<RemoteResources> =>
      ipcRenderer.invoke('ssh:resources', sessionId),
    connect: (config: HostEntry, password?: string): Promise<SSHSession> =>
      ipcRenderer.invoke('ssh:connect', config, password),
    disconnect: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('ssh:disconnect', sessionId),
    reconnect: (sessionId: string, password?: string, cols?: number, rows?: number): Promise<SSHSession> =>
      ipcRenderer.invoke('ssh:reconnect', sessionId, password, cols, rows),
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
    delete: (sessionId: string, remotePath: string): Promise<void> =>
      ipcRenderer.invoke('sftp:delete', sessionId, remotePath),
    rename: (sessionId: string, oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('sftp:rename', sessionId, oldPath, newPath),
    mkdir: (sessionId: string, remotePath: string): Promise<void> =>
      ipcRenderer.invoke('sftp:mkdir', sessionId, remotePath),
    uploadDir: (sessionId: string, localPath: string, remotePath: string): Promise<string[]> =>
      ipcRenderer.invoke('sftp:uploadDir', sessionId, localPath, remotePath),
    downloadDir: (sessionId: string, remotePath: string, localPath: string): Promise<string[]> =>
      ipcRenderer.invoke('sftp:downloadDir', sessionId, remotePath, localPath),
    chmod: (sessionId: string, remotePath: string, mode: number): Promise<void> =>
      ipcRenderer.invoke('sftp:chmod', sessionId, remotePath, mode),
    readFile: (sessionId: string, remotePath: string): Promise<string> =>
      ipcRenderer.invoke('sftp:readFile', sessionId, remotePath),
    writeFile: (sessionId: string, remotePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke('sftp:writeFile', sessionId, remotePath, content),
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
      ipcRenderer.invoke('local:getHomePath'),
    ensureXtDownload: (): Promise<string> =>
      ipcRenderer.invoke('local:ensureXtDownload'),
    isDirectory: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('local:isDirectory', filePath)
  },
  shell: {
    showItemInFolder: (fullPath: string): Promise<void> =>
      ipcRenderer.invoke('shell:showItemInFolder', fullPath),
    openPath: (fullPath: string): Promise<string> =>
      ipcRenderer.invoke('shell:openPath', fullPath),
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
  clipboard: {
    readText: (): string => clipboard.readText(),
    writeText: (text: string): void => clipboard.writeText(text),
  },
  recording: {
    start: (filePath: string, recordingId: string): Promise<void> =>
      ipcRenderer.invoke('recording:start', filePath, recordingId),
    write: (recordingId: string, line: string): void =>
      ipcRenderer.send('recording:write', recordingId, line),
    stop: (recordingId: string): Promise<void> =>
      ipcRenderer.invoke('recording:stop', recordingId),
  },
  serial: {
    list: (): Promise<any[]> =>
      ipcRenderer.invoke('serial:list'),
    open: (config: any): Promise<any> =>
      ipcRenderer.invoke('serial:open', config),
    close: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('serial:close', sessionId),
    write: (sessionId: string, hexData: string): void =>
      ipcRenderer.send('serial:write', sessionId, hexData),
    setDTR: (sessionId: string, value: boolean): Promise<void> =>
      ipcRenderer.invoke('serial:setDTR', sessionId, value),
    setRTS: (sessionId: string, value: boolean): Promise<void> =>
      ipcRenderer.invoke('serial:setRTS', sessionId, value),
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
  },
  net: {
    create: (protocol: string, host: string, port: number, localPort?: number): Promise<any> =>
      ipcRenderer.invoke('net:create', protocol, host, port, localPort),
    close: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('net:close', sessionId),
    send: (sessionId: string, hexData: string, remoteAddress?: string): void =>
      ipcRenderer.send('net:send', sessionId, hexData, remoteAddress),
    onData: (callback: (sid: string, hexData: string, remote?: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, data: string, remote?: string) => {
        callback(sid, data, remote);
      };
      ipcRenderer.on('net:data', handler);
      return () => ipcRenderer.removeListener('net:data', handler);
    },
    onClose: (callback: (sid: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string) => {
        callback(sid);
      };
      ipcRenderer.on('net:close', handler);
      return () => ipcRenderer.removeListener('net:close', handler);
    },
    onError: (callback: (sid: string, error: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, error: string) => {
        callback(sid, error);
      };
      ipcRenderer.on('net:error', handler);
      return () => ipcRenderer.removeListener('net:error', handler);
    },
    onClients: (callback: (sid: string, clients: string[]) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, clients: string[]) => {
        callback(sid, clients);
      };
      ipcRenderer.on('net:clients', handler);
      return () => ipcRenderer.removeListener('net:clients', handler);
    }
  },
  can: {
    open: (driverName: string, deviceType: number, deviceIndex: number, channel: number, baudRate: number, fdConfig?: any, chBaudRates?: Record<number, number>): Promise<any> =>
      ipcRenderer.invoke('can:open', driverName, deviceType, deviceIndex, channel, baudRate, fdConfig, chBaudRates),
    close: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('can:close', sessionId),
    send: (sessionId: string, frame: any): Promise<void> =>
      ipcRenderer.invoke('can:send', sessionId, frame),
    parseDbc: (content: string): Promise<any> =>
      ipcRenderer.invoke('can:parseDbc', content),
    onData: (sessionId: string, callback: (frames: any[]) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, frames: any[]) => {
        if (sid === sessionId) callback(frames);
      };
      ipcRenderer.on('can:data', handler);
      return () => ipcRenderer.removeListener('can:data', handler);
    },
    onError: (sessionId: string, callback: (error: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, error: string) => {
        if (sid === sessionId) callback(error);
      };
      ipcRenderer.on('can:error', handler);
      return () => ipcRenderer.removeListener('can:error', handler);
    },
    onBusError: (sessionId: string, callback: (info: { errCode: number; errTypes: string[]; timestamp: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, info: any) => {
        if (sid === sessionId) callback(info);
      };
      ipcRenderer.on('can:busError', handler);
      return () => ipcRenderer.removeListener('can:busError', handler);
    },
    udsRequest: (sessionId: string, txId: number, rxId: number, payload: number[]): Promise<any> =>
      ipcRenderer.invoke('can:udsRequest', sessionId, txId, rxId, payload),
    udsStartTesterPresent: (sessionId: string, txId: number, rxId: number, intervalMs?: number): Promise<void> =>
      ipcRenderer.invoke('can:udsStartTesterPresent', sessionId, txId, rxId, intervalMs),
    udsStopTesterPresent: (sessionId: string, txId: number, rxId: number): Promise<void> =>
      ipcRenderer.invoke('can:udsStopTesterPresent', sessionId, txId, rxId),
    udsDestroy: (sessionId: string, txId: number, rxId: number): Promise<void> =>
      ipcRenderer.invoke('can:udsDestroy', sessionId, txId, rxId),
    onUdsLog: (sessionId: string, callback: (entry: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, entry: any) => {
        if (sid === sessionId) callback(entry);
      };
      ipcRenderer.on('can:udsLog', handler);
      return () => ipcRenderer.removeListener('can:udsLog', handler);
    }
  },
  ethercat: {
    isAvailable: (): Promise<boolean> =>
      ipcRenderer.invoke('ecat:isAvailable'),
    listAdapters: (): Promise<any[]> =>
      ipcRenderer.invoke('ecat:listAdapters'),
    connect: (adapterName: string): Promise<any> =>
      ipcRenderer.invoke('ecat:connect', adapterName),
    disconnect: (): Promise<void> =>
      ipcRenderer.invoke('ecat:disconnect'),
    getSlaves: (): Promise<any[]> =>
      ipcRenderer.invoke('ecat:getSlaves'),
    requestState: (slaveIndex: number, targetState: number): Promise<any> =>
      ipcRenderer.invoke('ecat:requestState', slaveIndex, targetState),
    sdoRead: (slaveIndex: number, index: number, subIndex: number, size: number): Promise<any> =>
      ipcRenderer.invoke('ecat:sdoRead', slaveIndex, index, subIndex, size),
    sdoWrite: (slaveIndex: number, index: number, subIndex: number, dataHex: string, dataType: string): Promise<any> =>
      ipcRenderer.invoke('ecat:sdoWrite', slaveIndex, index, subIndex, dataHex, dataType),
    startPdo: (intervalMs?: number): Promise<void> =>
      ipcRenderer.invoke('ecat:startPdo', intervalMs),
    stopPdo: (): Promise<void> =>
      ipcRenderer.invoke('ecat:stopPdo'),
    importEsi: (xmlContent: string): Promise<any> =>
      ipcRenderer.invoke('ecat:importEsi', xmlContent),
    scanOd: (slaveIndex: number): Promise<any> =>
      ipcRenderer.invoke('ecat:scanOd', slaveIndex),
    getErrorCounters: (slaveIndex: number): Promise<any> =>
      ipcRenderer.invoke('ecat:getErrorCounters', slaveIndex),
    clearErrorCounters: (slaveIndex: number): Promise<void> =>
      ipcRenderer.invoke('ecat:clearErrorCounters', slaveIndex),
    resolvePdoSignals: (slaveIndex: number): Promise<any> =>
      ipcRenderer.invoke('ecat:resolvePdoSignals', slaveIndex),
    writeOutputPdo: (slaveIndex: number, offset: number, data: number[]): Promise<void> =>
      ipcRenderer.invoke('ecat:writeOutputPdo', slaveIndex, offset, data),
    foeUpload: (slaveIndex: number, filename: string, data: number[], password: number): Promise<any> =>
      ipcRenderer.invoke('ecat:foeUpload', slaveIndex, filename, data, password),
    siiRead: (slaveIndex: number, offset: number, size: number): Promise<any> =>
      ipcRenderer.invoke('ecat:siiRead', slaveIndex, offset, size),
    siiWrite: (slaveIndex: number, offset: number, data: number[]): Promise<any> =>
      ipcRenderer.invoke('ecat:siiWrite', slaveIndex, offset, data),
    onPdoData: (callback: (slaveIndex: number, input: any, output: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, slaveIndex: number, input: any, output: any) => {
        callback(slaveIndex, input, output);
      };
      ipcRenderer.on('ecat:pdoData', handler);
      return () => ipcRenderer.removeListener('ecat:pdoData', handler);
    },
    onWkcError: (callback: (expected: number, actual: number) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, expected: number, actual: number) => {
        callback(expected, actual);
      };
      ipcRenderer.on('ecat:wkcError', handler);
      return () => ipcRenderer.removeListener('ecat:wkcError', handler);
    },
    onStateChange: (callback: (state: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: any) => {
        callback(state);
      };
      ipcRenderer.on('ecat:stateChange', handler);
      return () => ipcRenderer.removeListener('ecat:stateChange', handler);
    },
    onEmergency: (callback: (msg: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, msg: any) => {
        callback(msg);
      };
      ipcRenderer.on('ecat:emergency', handler);
      return () => ipcRenderer.removeListener('ecat:emergency', handler);
    },
    onFoeProgress: (callback: (percent: number) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, percent: number) => {
        callback(percent);
      };
      ipcRenderer.on('ecat:foeProgress', handler);
      return () => ipcRenderer.removeListener('ecat:foeProgress', handler);
    }
  },
  update: {
    getStatus: (): Promise<UpdateStatusSnapshot> =>
      ipcRenderer.invoke('update:getStatus'),
    check: (): Promise<UpdateStatusSnapshot> =>
      ipcRenderer.invoke('update:check'),
    setAutoCheckOnStartup: (enabled: boolean): Promise<UpdateStatusSnapshot> =>
      ipcRenderer.invoke('update:setAutoCheckOnStartup', enabled),
    quitAndInstall: (): Promise<void> =>
      ipcRenderer.invoke('update:quitAndInstall'),
    onStatusChange: (callback: (status: UpdateStatusSnapshot) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatusSnapshot) => {
        callback(status);
      };
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    }
  }
};

contextBridge.exposeInMainWorld('api', api);

// Type declaration for renderer process
export type ElectronAPI = typeof api;
