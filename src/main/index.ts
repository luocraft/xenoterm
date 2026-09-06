import { app, BrowserWindow, shell, globalShortcut } from 'electron';
import { join } from 'path';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { updateService } from './services/update-service';

let mainWindow: BrowserWindow | null = null;

function getStartupLogPath(): string {
  try {
    const userDataPath = app.getPath('userData');
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true });
    }
    return join(userDataPath, 'startup.log');
  } catch {
    return join(process.cwd(), 'xenoterm-startup.log');
  }
}

function logStartup(message: string, error?: unknown): void {
  const lines = [`[${new Date().toISOString()}] ${message}`];
  if (error !== undefined) {
    if (error instanceof Error) {
      lines.push(error.stack || error.message);
    } else {
      lines.push(String(error));
    }
  }

  try {
    appendFileSync(getStartupLogPath(), `${lines.join('\n')}\n`, 'utf8');
  } catch {
    // Ignore logging failures during startup diagnostics.
  }
}

function createWindow(): void {
  // Use the same branded icon in development and packaged builds. In dev the
  // asset lives in the repository; electron-builder copies it beside the app.
  const iconCandidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.ico')]
    : [join(__dirname, '../../resources/icon.ico'), join(process.cwd(), 'resources', 'icon.ico')];
  const icon = iconCandidates.find((candidate) => existsSync(candidate));
  logStartup(
    `createWindow preload=${join(__dirname, '../preload/index.js')} renderer=${process.env.ELECTRON_RENDERER_URL || join(__dirname, '../renderer/index.html')}`
  );
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
    ...(icon ? { icon } : {}),
    transparent: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.platform === 'win32' && icon) {
    // The taskbar can otherwise select an older installed shortcut sharing our
    // AppUserModelID even when the window and executable icons are correct.
    mainWindow.setAppDetails({
      appId: 'com.xenomai.xenoterm',
      appIconPath: icon,
      appIconIndex: 0,
      relaunchCommand: app.isPackaged
        ? `"${process.execPath}"`
        : `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'XenoTerm'
    });
    logStartup(`taskbar icon=${icon}`);
  }

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

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      logStartup(`did-fail-load code=${errorCode} url=${validatedURL}`, errorDescription);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logStartup(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  mainWindow.on('closed', () => {
    logStartup('mainWindow closed');
  });

  // Zoom controls
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow) return;
    const wc = mainWindow.webContents;
    if (input.control && !input.alt && !input.shift && input.type === 'keyDown') {
      if (input.key === '=' || input.key === '+') {
        event.preventDefault();
        const newLevel = wc.getZoomLevel() + 0.5;
        wc.setZoomLevel(newLevel);
        mainWindow.setTitleBarOverlay({ height: Math.round(36 * Math.pow(1.2, newLevel)) });
      } else if (input.key === '-') {
        event.preventDefault();
        const newLevel = wc.getZoomLevel() - 0.5;
        wc.setZoomLevel(newLevel);
        mainWindow.setTitleBarOverlay({ height: Math.round(36 * Math.pow(1.2, newLevel)) });
      } else if (input.key === '0') {
        event.preventDefault();
        wc.setZoomLevel(0);
        mainWindow.setTitleBarOverlay({ height: 36 });
      }
    }
  });
}

process.on('uncaughtException', (error) => {
  logStartup('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  logStartup('unhandledRejection', reason);
});

app.whenReady().then(async () => {
  // Keep Windows taskbar grouping and shortcut identity tied to XenoTerm,
  // instead of inheriting Electron's default icon identity in development.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.xenomai.xenoterm');
  }
  logStartup(`app ready isPackaged=${app.isPackaged} resourcesPath=${process.resourcesPath} cwd=${process.cwd()}`);
  try {
    const { registerIpcHandlers } = await import('./ipc/index');
    logStartup('ipc module loaded');
    registerIpcHandlers();
    logStartup('ipc handlers registered');
    createWindow();
    logStartup('window creation requested');
    updateService.initialize(() => mainWindow);
    updateService.scheduleStartupCheck();
    logStartup('update service initialized');
  } catch (error) {
    logStartup('startup failed before window became interactive', error);
    throw error;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  logStartup('app.whenReady rejected', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  logStartup('window-all-closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
