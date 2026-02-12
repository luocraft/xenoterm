import { ipcMain, dialog, BrowserWindow } from 'electron';
import type { HostEntry, AppConfig, NetProtocol, SerialConfig } from '../../shared/types';
import { join } from 'path';
import { existsSync } from 'fs';
import { ConfigStore } from '../services/config-store';
import { ConnectionManager } from '../services/connection-manager';
import { SSHService } from '../services/ssh-service';
import { SFTPService } from '../services/sftp-service';
import { NetDebugService } from '../services/net-debug-service';
import { SerialService } from '../services/serial-service';

const configStore = new ConfigStore();
const connectionManager = new ConnectionManager(configStore);
const sshService = new SSHService();
const sftpService = new SFTPService();
const netDebugService = new NetDebugService();
const serialService = new SerialService();

// Wire up host resolver for jump host support
sshService.setHostResolver((id) => connectionManager.getHost(id));

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
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

  ipcMain.on('ssh:write', (_event, sessionId: string, data: string) => {
    console.log('[IPC] ssh:write received for session:', sessionId, 'data length:', data.length);
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
      const progress = await sftpService.upload(client, localPath, remotePath);

      // Set up progress forwarding
      sftpService.onProgress(progress.transferId, (p) => {
        win?.webContents.send('sftp:progress', p);
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
      const progress = await sftpService.download(client, remotePath, localPath);

      sftpService.onProgress(progress.transferId, (p) => {
        win?.webContents.send('sftp:progress', p);
      });

      return progress.transferId;
    } catch (err) {
      throw new Error(`SFTP download failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('sftp:cancel', async (_event, transferId: string) => {
    sftpService.cancelTransfer(transferId);
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

  // === Net Debug handlers ===
  ipcMain.handle('net:create', async (_event, protocol: NetProtocol, host: string, port: number, localPort?: number) => {
    try {
      const session = await netDebugService.createSession(protocol, host, port, localPort);
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
    } catch (err) {
      throw new Error(`Net debug failed: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('net:close', async (_event, sessionId: string) => {
    netDebugService.close(sessionId);
  });

  ipcMain.on('net:send', (_event, sessionId: string, hexData: string, remoteAddress?: string) => {
    const buf = Buffer.from(hexData, 'hex');
    netDebugService.send(sessionId, buf, remoteAddress);
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
    try {
      return await serialService.listPorts();
    } catch (err) {
      throw new Error(`Failed to list serial ports: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('serial:open', async (_event, config: SerialConfig) => {
    try {
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
    } catch (err) {
      throw new Error(`Failed to open serial port: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('serial:close', async (_event, sessionId: string) => {
    serialService.close(sessionId);
  });

  ipcMain.on('serial:write', (_event, sessionId: string, hexData: string) => {
    const buf = Buffer.from(hexData, 'hex');
    serialService.write(sessionId, buf);
  });

  ipcMain.on('serial:setDTR', (_event, sessionId: string, value: boolean) => {
    serialService.setDTR(sessionId, value);
  });

  ipcMain.on('serial:setRTS', (_event, sessionId: string, value: boolean) => {
    serialService.setRTS(sessionId, value);
  });
}
