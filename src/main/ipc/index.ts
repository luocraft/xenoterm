import { ipcMain, dialog, BrowserWindow } from 'electron';
import type { HostEntry, AppConfig } from '../../shared/types';
import { join, basename } from 'path';
import { existsSync, statSync } from 'fs';
import { ConfigStore } from '../services/config-store';
import { ConnectionManager } from '../services/connection-manager';
import { SSHService } from '../services/ssh-service';
import { SFTPService } from '../services/sftp-service';
import { createTransferProgress } from '../services/sftp-utils';
import * as licenseService from '../services/license-service';
import { SerialService } from '../services/serial-service';
import { NetDebugService } from '../services/net-debug-service';
import { CanService } from '../services/can/can-service';
import { EthercatService } from '../services/ethercat/ethercat-service';

const configStore = new ConfigStore();
const connectionManager = new ConnectionManager(configStore);
const sshService = new SSHService();
const sftpService = new SFTPService();
const serialService = new SerialService();
const netDebugService = new NetDebugService();
const canService = new CanService();
const ethercatService = new EthercatService();

// Wire up host resolver for jump host support
sshService.setHostResolver((id) => connectionManager.getHost(id));

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  const win = windows.length > 0 ? windows[0] : null;
  if (win && win.isDestroyed()) return null;
  if (win && win.webContents.isDestroyed()) return null;
  return win;
}

export function registerIpcHandlers(): void {
  // === Config handlers ===
  ipcMain.handle('config:getHosts', async () => {
    try {
      return connectionManager.listHosts();
    } catch (err) {
      throw new Error(`Failed to get hosts: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('config:saveHost', async (_event, entry: HostEntry) => {
    try {
      const existing = connectionManager.getHost(entry.id);
      if (existing) {
        connectionManager.updateHost(entry.id, entry);
      } else {
        connectionManager.createHost(entry);
      }
    } catch (err) {
      throw new Error(`Failed to save host: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('config:deleteHost', async (_event, id: string) => {
    try {
      connectionManager.deleteHost(id);
    } catch (err) {
      throw new Error(`Failed to delete host: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('config:export', async () => {
    try {
      return connectionManager.exportConfig();
    } catch (err) {
      throw new Error(`Failed to export config: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('config:import', async (_event, json: string) => {
    try {
      return connectionManager.importConfig(json);
    } catch (err) {
      throw new Error(`Failed to import config: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('config:getAppConfig', async () => {
    try {
      return configStore.getAppConfig();
    } catch (err) {
      throw new Error(`Failed to get app config: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('config:setAppConfig', async (_event, config: Partial<AppConfig>) => {
    try {
      configStore.setAppConfig(config);
    } catch (err) {
      throw new Error(`Failed to set app config: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('config:getCommandHistory', async () => {
    try {
      return configStore.getCommandHistory();
    } catch (err) {
      throw new Error(`Failed to get command history: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('config:setCommandHistory', async (_event, history: { cmd: string; ts: number; hostName?: string }[]) => {
    try {
      configStore.setCommandHistory(history);
    } catch (err) {
      throw new Error(`Failed to save command history: ${(err as Error).message}`);
    }
  });

  // === SSH handlers ===
  ipcMain.handle('ssh:connect', async (_event, hostEntry: HostEntry, password?: string) => {
    try {
      console.log('[SSH] Connecting to:', hostEntry.hostname, hostEntry.port, 'auth:', hostEntry.authMethod);
      const session = await sshService.connect(hostEntry, password);
      console.log('[SSH] Connected, session:', session.id, 'status:', session.status);
      await sshService.openShell(session.id);
      console.log('[SSH] Shell opened for session:', session.id);

      const win = getMainWindow();

      // Buffer initial data until renderer is ready
      const bufferedData: string[] = [];
      let flushed = false;

      sshService.onData(session.id, (data) => {
        if (!flushed) {
          bufferedData.push(data);
        } else {
          win?.webContents.send('ssh:data', session.id, data);
        }
      });

      sshService.onClose(session.id, () => {
        console.log('[SSH] Session closed:', session.id);
        win?.webContents.send('ssh:close', session.id);
      });

      sshService.onError(session.id, (error) => {
        console.log('[SSH] Session error:', session.id, error);
        win?.webContents.send('ssh:error', session.id, error);
      });

      // Flush buffered data after a short delay to let renderer mount
      setTimeout(() => {
        flushed = true;
        for (const data of bufferedData) {
          win?.webContents.send('ssh:data', session.id, data);
        }
        bufferedData.length = 0;
        console.log('[SSH] Flushed buffered data for session:', session.id);
      }, 500);

      return session;
    } catch (err) {
      console.error('[SSH] Connection failed:', (err as Error).message);
      throw new Error(`SSH connection failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('ssh:disconnect', async (_event, sessionId: string) => {
    sshService.disconnect(sessionId);
  });

  ipcMain.handle('ssh:reconnect', async (_event, sessionId: string, password?: string) => {
    try {
      console.log('[SSH] Reconnecting session:', sessionId);
      const session = await sshService.reconnect(sessionId, password);
      console.log('[SSH] Reconnected, session:', session.id, 'status:', session.status);
      await sshService.openShell(session.id);
      console.log('[SSH] Shell re-opened for session:', session.id);
      return session;
    } catch (err) {
      console.error('[SSH] Reconnect failed:', (err as Error).message);
      throw new Error(`SSH reconnect failed: ${(err as Error).message}`);
    }
  });

  ipcMain.on('ssh:write', (_event, sessionId: string, data: string) => {
    sshService.write(sessionId, data);
  });

  ipcMain.on('ssh:resize', (_event, sessionId: string, cols: number, rows: number) => {
    sshService.resize(sessionId, cols, rows);
  });

  // === SFTP handlers ===
  ipcMain.handle('sftp:list', async (_event, sessionId: string, path: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');
      return await sftpService.listDirectory(client, path);
    } catch (err) {
      throw new Error(`SFTP list failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:upload', async (_event, sessionId: string, localPath: string, remotePath: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');

      const win = getMainWindow();

      const sftp = await sftpService.getSFTP(client);
      const stats = statSync(localPath);
      const progress = createTransferProgress(basename(localPath), 'upload', stats.size);
      sftpService.queue.addTransfer(progress);

      sftpService.onProgress(progress.transferId, (p) => {
        win?.webContents.send('sftp:progress', p);
      });

      progress.status = 'transferring';
      sftpService.emitProgress(progress);

      const startTime = Date.now();
      let lastEmit = 0;

      // Use fastPut for parallel transfer — don't await, return transferId immediately
      sftp.fastPut(localPath, remotePath, {
        concurrency: 25,
        chunkSize: 128 * 1024,
        step: (transferred: number, _chunk: number, _total: number) => {
          progress.bytesTransferred = transferred;
          const now = Date.now();
          if (now - lastEmit >= 200) {
            lastEmit = now;
            const elapsed = (now - startTime) / 1000;
            progress.speed = elapsed > 0 ? transferred / elapsed : 0;
            sftpService.emitProgress(progress);
          }
        }
      }, (err) => {
        if (err) {
          progress.status = 'failed';
          progress.error = err.message;
          sftpService.emitProgress(progress);
        } else {
          progress.status = 'completed';
          progress.bytesTransferred = stats.size;
          sftpService.emitProgress(progress);
        }
      });

      return progress.transferId;
    } catch (err) {
      throw new Error(`SFTP upload failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:download', async (_event, sessionId: string, remotePath: string, localPath: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');

      const win = getMainWindow();

      const sftp = await sftpService.getSFTP(client);
      const remoteStats = await new Promise<{ size: number }>((resolve, reject) => {
        sftp.stat(remotePath, (err: any, stats: any) => {
          if (err) reject(new Error(`Failed to stat remote file: ${err.message}`));
          else resolve({ size: stats.size });
        });
      });

      const progress = createTransferProgress(basename(remotePath), 'download', remoteStats.size);
      sftpService.queue.addTransfer(progress);

      sftpService.onProgress(progress.transferId, (p) => {
        win?.webContents.send('sftp:progress', p);
      });

      progress.status = 'transferring';
      sftpService.emitProgress(progress);

      const startTime = Date.now();
      let lastEmit = 0;

      // Use fastGet for parallel transfer — don't await, return transferId immediately
      sftp.fastGet(remotePath, localPath, {
        concurrency: 25,
        chunkSize: 128 * 1024,
        step: (transferred: number, _chunk: number, _total: number) => {
          progress.bytesTransferred = transferred;
          const now = Date.now();
          if (now - lastEmit >= 200) {
            lastEmit = now;
            const elapsed = (now - startTime) / 1000;
            progress.speed = elapsed > 0 ? transferred / elapsed : 0;
            sftpService.emitProgress(progress);
          }
        }
      }, (err) => {
        if (err) {
          progress.status = 'failed';
          progress.error = err.message;
          sftpService.emitProgress(progress);
        } else {
          progress.status = 'completed';
          progress.bytesTransferred = remoteStats.size;
          sftpService.emitProgress(progress);
        }
      });

      return progress.transferId;
    } catch (err) {
      throw new Error(`SFTP download failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:cancel', async (_event, transferId: string) => {
    sftpService.cancelTransfer(transferId);
  });

  ipcMain.handle('sftp:delete', async (_event, sessionId: string, remotePath: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');
      await sftpService.deleteRemote(client, remotePath);
    } catch (err) {
      throw new Error(`SFTP delete failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:rename', async (_event, sessionId: string, oldPath: string, newPath: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');
      await sftpService.renameRemote(client, oldPath, newPath);
    } catch (err) {
      throw new Error(`SFTP rename failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:mkdir', async (_event, sessionId: string, remotePath: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');
      await sftpService.mkdirRemote(client, remotePath);
    } catch (err) {
      throw new Error(`SFTP mkdir failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:uploadDir', async (_event, sessionId: string, localPath: string, remotePath: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');
      const results = await sftpService.uploadDirectory(client, localPath, remotePath);
      return results.map((r) => r.transferId);
    } catch (err) {
      throw new Error(`SFTP upload directory failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:downloadDir', async (_event, sessionId: string, remotePath: string, localPath: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');
      const results = await sftpService.downloadDirectory(client, remotePath, localPath);
      return results.map((r) => r.transferId);
    } catch (err) {
      throw new Error(`SFTP download directory failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:chmod', async (_event, sessionId: string, remotePath: string, mode: number) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');
      await sftpService.chmodRemote(client, remotePath, mode);
    } catch (err) {
      throw new Error(`SFTP chmod failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:readFile', async (_event, sessionId: string, remotePath: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');
      return await sftpService.readRemoteFile(client, remotePath);
    } catch (err) {
      throw new Error(`SFTP read failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:writeFile', async (_event, sessionId: string, remotePath: string, content: string) => {
    try {
      const client = sshService.getSFTPClient(sessionId);
      if (!client) throw new Error('Session not connected');
      await sftpService.writeRemoteFile(client, remotePath, content);
    } catch (err) {
      throw new Error(`SFTP write failed: ${(err as Error).message}`);
    }
  });

  // === Shell utility handlers ===
  ipcMain.handle('shell:showItemInFolder', async (_event, fullPath: string) => {
    const { shell } = require('electron');
    shell.showItemInFolder(fullPath);
  });

  ipcMain.handle('shell:openPath', async (_event, fullPath: string) => {
    const { shell } = require('electron');
    return shell.openPath(fullPath);
  });

  // === Dialog handlers ===

  // === Theme handlers ===
  ipcMain.on('theme:update-titlebar', (_event, bgColor: string, symbolColor: string) => {
    const win = getMainWindow();
    if (win) {
      try {
        win.setTitleBarOverlay({
          color: bgColor,
          symbolColor: symbolColor,
          height: 36
        });
      } catch {
        // Ignore if titleBarOverlay is not supported (frame: false mode)
      }
    }
  });

  // === Window control handlers ===
  ipcMain.on('window:minimize', () => {
    const win = getMainWindow();
    win?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.on('window:close', () => {
    const win = getMainWindow();
    win?.close();
  });

  // === Dialog handlers ===
  ipcMain.handle('dialog:selectFile', async (_event, options?: { directory?: boolean }) => {
    const result = await dialog.showOpenDialog({
      properties: [options?.directory ? 'openDirectory' : 'openFile']
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle('dialog:selectSaveLocation', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName
    });
    return result.canceled ? null : result.filePath || null;
  });

  // Forward global SFTP progress to renderer
  sftpService.onGlobalProgress((progress) => {
    const win = getMainWindow();
    win?.webContents.send('sftp:progress', progress);
  });

  // === Local file system handlers ===
  ipcMain.handle('local:listDirectory', async (_event, dirPath: string) => {
    const { readdirSync, statSync } = await import('fs');
    const { join } = await import('path');
    try {
      const items = readdirSync(dirPath, { withFileTypes: true });
      return items.map((item) => {
        const fullPath = join(dirPath, item.name);
        let size = 0;
        let mtime = new Date();
        try {
          const stats = statSync(fullPath);
          size = stats.size;
          mtime = stats.mtime;
        } catch { /* skip stats errors */ }
        return {
          name: item.name,
          path: fullPath,
          isDirectory: item.isDirectory(),
          size,
          modifiedAt: mtime.toISOString(),
          permissions: ''
        };
      });
    } catch (err) {
      throw new Error(`Failed to list local directory: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('local:getHomePath', async () => {
    const { homedir } = await import('os');
    return homedir();
  });

  ipcMain.handle('local:ensureXtDownload', async () => {
    const { homedir } = await import('os');
    const { join } = await import('path');
    const { mkdirSync, existsSync } = await import('fs');
    const desktop = join(homedir(), 'Desktop', 'xtdownload');
    if (!existsSync(desktop)) {
      mkdirSync(desktop, { recursive: true });
    }
    return desktop;
  });

  ipcMain.handle('local:isDirectory', async (_event, filePath: string) => {
    const { statSync } = await import('fs');
    try {
      return statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  });

  // === Recording (stream to file) handlers ===
  const recordingStreams = new Map<string, import('fs').WriteStream>();

  ipcMain.handle('recording:start', async (_event, filePath: string, recordingId: string) => {
    const { createWriteStream } = await import('fs');
    const ws = createWriteStream(filePath, { flags: 'w', encoding: 'utf-8' });
    recordingStreams.set(recordingId, ws);
  });

  ipcMain.on('recording:write', (_event, recordingId: string, line: string) => {
    const ws = recordingStreams.get(recordingId);
    if (ws) ws.write(line + '\n');
  });

  ipcMain.handle('recording:stop', async (_event, recordingId: string) => {
    const ws = recordingStreams.get(recordingId);
    if (ws) {
      await new Promise<void>((resolve) => ws.end(resolve));
      recordingStreams.delete(recordingId);
    }
  });

  // === Help handler ===
  ipcMain.on('help:open', () => {
    const { shell, app } = require('electron');
    const candidates = [
      join(app.getAppPath(), 'help.html'),
      join(process.resourcesPath || '', 'help.html'),
      join(__dirname, '../../help.html'),
      join(__dirname, '../../../help.html'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        shell.openPath(p);
        return;
      }
    }
    shell.openPath(join(app.getAppPath(), 'help.html'));
  });

  // === Serial Port handlers ===
  ipcMain.handle('serial:list', async () => {
    return serialService.listPorts();
  });

  ipcMain.handle('serial:open', async (_event, config: any) => {
    const session = await serialService.open(config);
    const win = getMainWindow();
    serialService.onData(session.id, (data) => {
      win?.webContents.send('serial:data', session.id, data.toString('hex'));
    });
    serialService.onClose(session.id, () => {
      win?.webContents.send('serial:close', session.id);
    });
    serialService.onError(session.id, (error) => {
      win?.webContents.send('serial:error', session.id, error);
    });
    return session;
  });

  ipcMain.handle('serial:close', async (_event, sessionId: string) => {
    serialService.close(sessionId);
  });

  ipcMain.on('serial:write', (_event, sessionId: string, hexData: string) => {
    const buf = Buffer.from(hexData, 'hex');
    serialService.write(sessionId, buf);
  });

  ipcMain.handle('serial:setDTR', async (_event, sessionId: string, value: boolean) => {
    serialService.setDTR(sessionId, value);
  });

  ipcMain.handle('serial:setRTS', async (_event, sessionId: string, value: boolean) => {
    serialService.setRTS(sessionId, value);
  });

  // === CAN Debug handlers ===
  ipcMain.handle('can:open', async (_event, driverName: string, deviceType: number, deviceIndex: number, channel: number, baudRate: number, fdConfig?: any) => {
    const fdOpts = fdConfig ? {
      deviceType, deviceIndex, channel,
      protocol: fdConfig.protocol ?? 1,
      mode: fdConfig.mode ?? 0,
      baudRate,
      dataBaudRate: fdConfig.dataBaudRate ?? 5000000,
      ch1BaudRate: fdConfig.ch1BaudRate,
      ch1DataBaudRate: fdConfig.ch1DataBaudRate,
    } : undefined;
    const result = canService.open(driverName, { deviceType, deviceIndex, channel, baudRate, ch1BaudRate: fdConfig?.ch1BaudRate }, fdOpts);
    const win = getMainWindow();
    const sessions = Array.isArray(result) ? result : [result];
    for (const session of sessions) {
      canService.onData(session.id, (frames) => {
        win?.webContents.send('can:data', session.id, frames);
      });
      canService.onError(session.id, (error) => {
        win?.webContents.send('can:error', session.id, error);
      });
    }
    return result;
  });

  ipcMain.handle('can:close', async (_event, sessionId: string) => {
    canService.close(sessionId);
  });

  ipcMain.handle('can:send', async (_event, sessionId: string, frame: any) => {
    canService.send(sessionId, [frame]);
  });

  ipcMain.handle('can:parseDbc', async (_event, content: string) => {
    return canService.parseDbcContent(content);
  });

  ipcMain.handle('can:udsRequest', async (_event, sessionId: string, txId: number, rxId: number, payload: number[]) => {
    const win = getMainWindow();
    return canService.udsRequest(sessionId, txId, rxId, payload, (entry) => {
      win?.webContents.send('can:udsLog', sessionId, entry);
    });
  });

  ipcMain.handle('can:udsStartTesterPresent', async (_event, sessionId: string, txId: number, rxId: number, intervalMs?: number) => {
    canService.udsStartTesterPresent(sessionId, txId, rxId, intervalMs);
  });

  ipcMain.handle('can:udsStopTesterPresent', async (_event, sessionId: string, txId: number, rxId: number) => {
    canService.udsStopTesterPresent(sessionId, txId, rxId);
  });

  ipcMain.handle('can:udsDestroy', async (_event, sessionId: string, txId: number, rxId: number) => {
    canService.udsDestroy(sessionId, txId, rxId);
  });

  // === Network Debug handlers ===
  ipcMain.handle('net:create', async (_event, protocol: string, host: string, port: number, localPort?: number) => {
    const session = await netDebugService.createSession(protocol as any, host, port, localPort);
    const win = getMainWindow();
    netDebugService.onData(session.id, (data, remote) => {
      win?.webContents.send('net:data', session.id, data.toString('hex'), remote);
    });
    netDebugService.onClose(session.id, () => {
      win?.webContents.send('net:close', session.id);
    });
    netDebugService.onError(session.id, (error) => {
      win?.webContents.send('net:error', session.id, error);
    });
    netDebugService.onClientChange(session.id, (clients) => {
      win?.webContents.send('net:clients', session.id, clients);
    });
    return session;
  });

  ipcMain.handle('net:close', async (_event, sessionId: string) => {
    netDebugService.close(sessionId);
  });

  ipcMain.on('net:send', (_event, sessionId: string, hexData: string, remoteAddress?: string) => {
    const buf = Buffer.from(hexData, 'hex');
    netDebugService.send(sessionId, buf, remoteAddress);
  });

  // === EtherCAT handlers ===
  ipcMain.handle('ecat:isAvailable', async () => {
    return ethercatService.isAvailable();
  });

  ipcMain.handle('ecat:listAdapters', async () => {
    return ethercatService.listAdapters();
  });

  ipcMain.handle('ecat:connect', async (_event, adapterName: string) => {
    const session = ethercatService.connect(adapterName);
    const win = getMainWindow();
    ethercatService.onPdoData((slaveIndex, input, output) => {
      win?.webContents.send('ecat:pdoData', slaveIndex, input, output);
    });
    ethercatService.onWkcError((expected, actual) => {
      win?.webContents.send('ecat:wkcError', expected, actual);
    });
    ethercatService.onStateChange((s) => {
      win?.webContents.send('ecat:stateChange', s);
    });
    ethercatService.onEmergency((msg) => {
      win?.webContents.send('ecat:emergency', msg);
    });
    return session;
  });

  ipcMain.handle('ecat:disconnect', async () => {
    ethercatService.disconnect();
  });

  ipcMain.handle('ecat:getSlaves', async () => {
    return ethercatService.getSlaves();
  });

  ipcMain.handle('ecat:requestState', async (_event, slaveIndex: number, targetState: number) => {
    return ethercatService.requestState(slaveIndex, targetState);
  });

  ipcMain.handle('ecat:sdoRead', async (_event, slaveIndex: number, index: number, subIndex: number, size: number) => {
    return ethercatService.sdoRead(slaveIndex, index, subIndex, size);
  });

  ipcMain.handle('ecat:sdoWrite', async (_event, slaveIndex: number, index: number, subIndex: number, dataHex: string, dataType: string) => {
    return ethercatService.sdoWrite(slaveIndex, index, subIndex, dataHex, dataType);
  });

  ipcMain.handle('ecat:startPdo', async (_event, intervalMs?: number) => {
    ethercatService.startPdoMonitor(intervalMs ?? 1);
  });

  ipcMain.handle('ecat:stopPdo', async () => {
    ethercatService.stopPdoMonitor();
  });

  ipcMain.handle('ecat:importEsi', async (_event, xmlContent: string) => {
    return ethercatService.importEsi(xmlContent);
  });

  ipcMain.handle('ecat:scanOd', async (_event, slaveIndex: number) => {
    return ethercatService.scanObjectDictionary(slaveIndex);
  });

  ipcMain.handle('ecat:getErrorCounters', async (_event, slaveIndex: number) => {
    return ethercatService.getErrorCounters(slaveIndex);
  });

  ipcMain.handle('ecat:clearErrorCounters', async (_event, slaveIndex: number) => {
    ethercatService.clearErrorCounters(slaveIndex);
  });

  ipcMain.handle('ecat:resolvePdoSignals', async (_event, slaveIndex: number) => {
    return ethercatService.resolvePdoSignals(slaveIndex);
  });

  ipcMain.handle('ecat:writeOutputPdo', async (_event, slaveIndex: number, offset: number, data: number[]) => {
    ethercatService.writeOutputPdo(slaveIndex, offset, data);
  });

  ipcMain.handle('ecat:foeUpload', async (_event, slaveIndex: number, filename: string, dataArr: number[], password: number) => {
    const data = Buffer.from(dataArr);
    const win = getMainWindow();
    return ethercatService.foeUpload(slaveIndex, filename, data, password, (percent) => {
      win?.webContents.send('ecat:foeProgress', percent);
    });
  });

  ipcMain.handle('ecat:siiRead', async (_event, slaveIndex: number, offset: number, size: number) => {
    return ethercatService.siiRead(slaveIndex, offset, size);
  });

  ipcMain.handle('ecat:siiWrite', async (_event, slaveIndex: number, offset: number, data: number[]) => {
    return ethercatService.siiWrite(slaveIndex, offset, data);
  });

  // === License handlers ===
  ipcMain.handle('license:getStatus', async () => {
    return licenseService.getLicenseStatus();
  });

  ipcMain.handle('license:getMachineId', async () => {
    return licenseService.getMachineId();
  });

  ipcMain.handle('license:activate', async (_event, licenseKey: string) => {
    return licenseService.activateLicense(licenseKey);
  });

  ipcMain.handle('license:verify', async () => {
    return licenseService.verifyLicenseOnline();
  });

  ipcMain.handle('license:createPayment', async (_event, payType: 'wxpay' | 'alipay') => {
    return licenseService.createPayment(payType);
  });

  ipcMain.handle('license:queryPayment', async (_event, orderId: string) => {
    return licenseService.queryPayment(orderId);
  });

  ipcMain.handle('license:renew', async () => {
    return licenseService.renewLicense();
  });

}
