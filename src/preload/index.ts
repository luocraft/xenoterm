import { contextBridge, ipcRenderer, clipboard } from 'electron';
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
import type { CanFrame, CanDeviceType } from '../main/services/can/can-driver.interface';
import type { DbcDatabase } from '../main/services/can/dbc-parser';
import type { EcSession, EcSlaveInfo, SdoResult, ErrorCounters, PdoSignal, EmergencyMsg, FoeResult } from '../main/services/ethercat/types';
import type { EsiDevice, OdEntry } from '../main/services/ethercat/esi-parser';

const api = {
  ssh: {
    connect: (config: HostEntry, password?: string): Promise<SSHSession> =>
      ipcRenderer.invoke('ssh:connect', config, password),
    disconnect: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('ssh:disconnect', sessionId),
    reconnect: (sessionId: string, password?: string): Promise<SSHSession> =>
      ipcRenderer.invoke('ssh:reconnect', sessionId, password),
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
      ipcRenderer.invoke('local:getHomePath')
  },
  shell: {
    showItemInFolder: (fullPath: string): Promise<void> =>
      ipcRenderer.invoke('shell:showItemInFolder', fullPath),
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
  },
  can: {
    listDrivers: (): Promise<{ name: string; available: boolean }[]> =>
      ipcRenderer.invoke('can:listDrivers'),
    getDeviceTypes: (driverName: string): Promise<CanDeviceType[]> =>
      ipcRenderer.invoke('can:getDeviceTypes', driverName),
    open: (driverName: string, deviceType: number, deviceIndex: number, channel: number, baudRate: number, fdConfig?: { protocol?: number; mode?: number; dataBaudRate?: number; nonIso?: boolean; ch1BaudRate?: number; ch1DataBaudRate?: number }): Promise<{ id: string; driverName: string; deviceType: number; channel: number; baudRate: number; status: string } | { id: string; driverName: string; deviceType: number; channel: number; baudRate: number; status: string }[]> =>
      ipcRenderer.invoke('can:open', driverName, deviceType, deviceIndex, channel, baudRate, fdConfig),
    close: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('can:close', sessionId),
    send: (sessionId: string, frame: CanFrame): void =>
      ipcRenderer.send('can:send', sessionId, frame),
    parseDbc: (content: string): Promise<DbcDatabase> =>
      ipcRenderer.invoke('can:parseDbc', content),
    onData: (sessionId: string, callback: (frames: CanFrame[]) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, frames: CanFrame[]) => {
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
    // UDS
    udsRequest: (sessionId: string, txId: number, rxId: number, payload: number[]): Promise<any> =>
      ipcRenderer.invoke('can:udsRequest', sessionId, txId, rxId, payload),
    udsStartTesterPresent: (sessionId: string, txId: number, rxId: number, intervalMs?: number): void =>
      ipcRenderer.send('can:udsStartTesterPresent', sessionId, txId, rxId, intervalMs),
    udsStopTesterPresent: (sessionId: string, txId: number, rxId: number): void =>
      ipcRenderer.send('can:udsStopTesterPresent', sessionId, txId, rxId),
    udsDestroy: (sessionId: string, txId: number, rxId: number): void =>
      ipcRenderer.send('can:udsDestroy', sessionId, txId, rxId),
    onUdsLog: (sessionId: string, callback: (entry: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sid: string, entry: any) => {
        if (sid === sessionId) callback(entry);
      };
      ipcRenderer.on('can:udsLog', handler);
      return () => ipcRenderer.removeListener('can:udsLog', handler);
    }
  },
  ecat: {
    isAvailable: (): Promise<boolean> =>
      ipcRenderer.invoke('ecat:isAvailable'),
    listAdapters: (): Promise<{ name: string; description: string }[]> =>
      ipcRenderer.invoke('ecat:listAdapters'),
    connect: (adapter: string): Promise<EcSession> =>
      ipcRenderer.invoke('ecat:connect', adapter),
    disconnect: (): Promise<void> =>
      ipcRenderer.invoke('ecat:disconnect'),
    getSlaves: (): Promise<EcSlaveInfo[]> =>
      ipcRenderer.invoke('ecat:getSlaves'),
    requestState: (slave: number, state: number): Promise<{ success: boolean; actualState: number; alStatusCode?: number }> =>
      ipcRenderer.invoke('ecat:requestState', slave, state),
    sdoRead: (slave: number, index: number, subIndex: number, size: number): Promise<SdoResult> =>
      ipcRenderer.invoke('ecat:sdoRead', slave, index, subIndex, size),
    sdoWrite: (slave: number, index: number, subIndex: number, dataHex: string, dataType: string): Promise<SdoResult> =>
      ipcRenderer.invoke('ecat:sdoWrite', slave, index, subIndex, dataHex, dataType),
    startPdo: (intervalMs?: number): Promise<void> =>
      ipcRenderer.invoke('ecat:startPdo', intervalMs),
    stopPdo: (): Promise<void> =>
      ipcRenderer.invoke('ecat:stopPdo'),
    importEsi: (xml: string): Promise<EsiDevice> =>
      ipcRenderer.invoke('ecat:importEsi', xml),
    scanOd: (slave: number): Promise<OdEntry[]> =>
      ipcRenderer.invoke('ecat:scanOd', slave),
    getErrorCounters: (slave: number): Promise<ErrorCounters> =>
      ipcRenderer.invoke('ecat:getErrorCounters', slave),
    clearErrorCounters: (slave: number): Promise<void> =>
      ipcRenderer.invoke('ecat:clearErrorCounters', slave),
    resolvePdoSignals: (slave: number): Promise<PdoSignal[]> =>
      ipcRenderer.invoke('ecat:resolvePdoSignals', slave),
    writeOutputPdo: (slave: number, offset: number, data: number[]): Promise<void> =>
      ipcRenderer.invoke('ecat:writeOutputPdo', slave, offset, data),
    foeUpload: (slave: number, filename: string, data: number[], password: number): Promise<FoeResult> =>
      ipcRenderer.invoke('ecat:foeUpload', slave, filename, data, password),
    siiRead: (slave: number, offset: number, size: number): Promise<number[]> =>
      ipcRenderer.invoke('ecat:siiRead', slave, offset, size),
    siiWrite: (slave: number, offset: number, data: number[]): Promise<boolean> =>
      ipcRenderer.invoke('ecat:siiWrite', slave, offset, data),
    onPdoData: (callback: (slave: number, input: number[], output: number[]) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, slave: number, input: number[], output: number[]) => {
        callback(slave, input, output);
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
    onStateChange: (callback: (session: EcSession) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, session: EcSession) => {
        callback(session);
      };
      ipcRenderer.on('ecat:stateChange', handler);
      return () => ipcRenderer.removeListener('ecat:stateChange', handler);
    },
    onEmergency: (callback: (msg: EmergencyMsg) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, msg: EmergencyMsg) => {
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
  license: {
    getStatus: (): Promise<{ licensed: boolean; trial: boolean; daysLeft: number; expired: boolean; licenseKey?: string }> =>
      ipcRenderer.invoke('license:getStatus'),
    getMachineId: (): Promise<string> =>
      ipcRenderer.invoke('license:getMachineId'),
    activate: (licenseKey: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('license:activate', licenseKey),
    verify: (): Promise<boolean> =>
      ipcRenderer.invoke('license:verify'),
    createPayment: (payType: 'wxpay' | 'alipay'): Promise<{ success: boolean; orderId?: string; qrCodeUrl?: string; error?: string }> =>
      ipcRenderer.invoke('license:createPayment', payType),
    queryPayment: (orderId: string): Promise<{ success: boolean; status?: string; licenseKey?: string }> =>
      ipcRenderer.invoke('license:queryPayment', orderId),
  }
};

contextBridge.exposeInMainWorld('api', api);

// Type declaration for renderer process
export type ElectronAPI = typeof api;
