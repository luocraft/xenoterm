import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { HostEntry, ConnectionGroup, AppConfig } from '../../shared/types';

const DEFAULT_APP_CONFIG: AppConfig = {
  theme: 'dark',
  terminal: {
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    fontSize: 14,
    colorScheme: 'default'
  },
  sidebarCollapsed: false,
  defaultKeepAlive: 60
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
      const raw = readFileSync(filePath, 'utf-8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
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
    data.appConfig = { ...data.appConfig, ...config };
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
