import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';

// Fix native module resolution: Electron runs from dist/main/ but native modules
// (like serialport) live in project root node_modules/. Adding the project root
// node_modules to NODE_PATH and re-initializing module paths fixes this.
const projectRoot = join(__dirname, '../..');
process.env.NODE_PATH = [
  join(projectRoot, 'node_modules'),
  process.env.NODE_PATH || ''
].filter(Boolean).join(require('path').delimiter);
require('module')._initPaths();

import { registerIpcHandlers } from './ipc/index';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    show: true,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#141525',
      symbolColor: '#9ca3af',
      height: 36
    },
    transparent: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Prevent navigation to external URLs
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
