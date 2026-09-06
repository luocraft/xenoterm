import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { HostEntry, ConnectionGroup, AppConfig } from '../../shared/types';
import { DEFAULT_TERMINAL_CONFIG, normalizeTerminalConfig } from '../../shared/terminal-defaults';

const DEFAULT_APP_CONFIG: AppConfig = {
  theme: 'light',
  terminal: DEFAULT_TERMINAL_CONFIG,
  sidebarCollapsed: false,
  defaultKeepAlive: 60,
  autoCheckUpdates: true
};

interface StoreData {
  hosts: HostEntry[];
  groups: ConnectionGroup[];
  appConfig: AppConfig;
  commandHistory: { cmd: string; ts: number; hostName?: string }[];
}

const DEFAULTS: StoreData = {
  hosts: [],
  groups: [],
  appConfig: DEFAULT_APP_CONFIG,
  commandHistory: []
};

function getConfigPath(): string {
  const userDataPath = app.getPath('userData');
  return join(userDataPath, 'ssh-client-config.json');
}

function readStore(): StoreData {
  const filePath = getConfigPath();
  try {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<StoreData>;
      return {
        ...DEFAULTS,
        ...raw,
        hosts: raw.hosts ?? DEFAULTS.hosts,
        groups: raw.groups ?? DEFAULTS.groups,
        appConfig: {
          ...DEFAULT_APP_CONFIG,
          ...raw.appConfig,
          terminal: normalizeTerminalConfig(raw.appConfig?.terminal)
        },
        commandHistory: raw.commandHistory ?? DEFAULTS.commandHistory
      };
    }
  } catch {
    // If file is corrupted, return defaults
  }
  return { ...DEFAULTS };
}

function writeStore(data: StoreData): void {
  const filePath = getConfigPath();
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export class ConfigStore {
  getHosts(): HostEntry[] {
    return readStore().hosts;
  }

  setHosts(hosts: HostEntry[]): void {
    const data = readStore();
    data.hosts = hosts;
    writeStore(data);
  }

  getGroups(): ConnectionGroup[] {
    return readStore().groups;
  }

  setGroups(groups: ConnectionGroup[]): void {
    const data = readStore();
    data.groups = groups;
    writeStore(data);
  }

  getAppConfig(): AppConfig {
    return readStore().appConfig;
  }

  setAppConfig(config: Partial<AppConfig>): void {
    const data = readStore();
    data.appConfig = {
      ...data.appConfig,
      ...config,
      terminal: normalizeTerminalConfig({
        ...data.appConfig.terminal,
        ...config.terminal
      })
    };
    writeStore(data);
  }

  getCommandHistory(): { cmd: string; ts: number; hostName?: string }[] {
    return readStore().commandHistory || [];
  }

  setCommandHistory(history: { cmd: string; ts: number; hostName?: string }[]): void {
    const data = readStore();
    data.commandHistory = history.slice(-100); // Keep max 100
    writeStore(data);
  }
}

export const configStore = new ConfigStore();
