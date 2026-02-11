import type { HostEntry, ConnectionGroup, AppConfig } from '../../shared/types';

export interface IConfigStore {
  getHosts(): HostEntry[];
  setHosts(hosts: HostEntry[]): void;
  getGroups(): ConnectionGroup[];
  setGroups(groups: ConnectionGroup[]): void;
  getAppConfig(): AppConfig;
  setAppConfig(config: Partial<AppConfig>): void;
}
