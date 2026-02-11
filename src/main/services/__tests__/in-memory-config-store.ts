import type { HostEntry, ConnectionGroup, AppConfig } from '../../../shared/types';
import type { IConfigStore } from '../config-store.interface';

const DEFAULT_CONFIG: AppConfig = {
  theme: 'dark',
  terminal: { fontFamily: 'monospace', fontSize: 14, colorScheme: 'default' },
  sidebarCollapsed: false,
  defaultKeepAlive: 60
};

export class InMemoryConfigStore implements IConfigStore {
  private hosts: HostEntry[] = [];
  private groups: ConnectionGroup[] = [];
  private appConfig: AppConfig = { ...DEFAULT_CONFIG };

  getHosts(): HostEntry[] {
    return [...this.hosts];
  }
  setHosts(hosts: HostEntry[]): void {
    this.hosts = [...hosts];
  }
  getGroups(): ConnectionGroup[] {
    return [...this.groups];
  }
  setGroups(groups: ConnectionGroup[]): void {
    this.groups = [...groups];
  }
  getAppConfig(): AppConfig {
    return { ...this.appConfig };
  }
  setAppConfig(config: Partial<AppConfig>): void {
    this.appConfig = { ...this.appConfig, ...config };
  }

  reset(): void {
    this.hosts = [];
    this.groups = [];
    this.appConfig = { ...DEFAULT_CONFIG };
  }
}
