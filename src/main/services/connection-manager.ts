import { randomUUID } from 'crypto';
import type {
  HostEntry,
  ConnectionGroup,
  ExportData,
  ImportResult
} from '../../shared/types';
import type { IConfigStore } from './config-store.interface';

export interface ValidationError {
  field: string;
  message: string;
}

export function validateHostEntry(
  entry: Partial<HostEntry>
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!entry.name || entry.name.trim() === '') {
    errors.push({ field: 'name', message: 'Name is required' });
  }
  if (!entry.hostname || entry.hostname.trim() === '') {
    errors.push({ field: 'hostname', message: 'Hostname is required' });
  }
  if (
    entry.port === undefined ||
    entry.port === null ||
    !Number.isInteger(entry.port) ||
    entry.port < 1 ||
    entry.port > 65535
  ) {
    errors.push({ field: 'port', message: 'Port must be an integer between 1 and 65535' });
  }
  if (!entry.username || entry.username.trim() === '') {
    errors.push({ field: 'username', message: 'Username is required' });
  }
  if (entry.authMethod !== 'password' && entry.authMethod !== 'publicKey') {
    errors.push({ field: 'authMethod', message: "Auth method must be 'password' or 'publicKey'" });
  }
  if (entry.authMethod === 'publicKey' && (!entry.privateKeyPath || entry.privateKeyPath.trim() === '')) {
    errors.push({ field: 'privateKeyPath', message: 'Private key path is required for publicKey auth' });
  }
  if (entry.keepAliveInterval !== undefined && entry.keepAliveInterval !== null) {
    if (!Number.isInteger(entry.keepAliveInterval) || entry.keepAliveInterval < 1) {
      errors.push({ field: 'keepAliveInterval', message: 'Keep-alive interval must be a positive integer' });
    }
  }

  return errors;
}

export class ConnectionManager {
  private store: IConfigStore;

  constructor(store: IConfigStore) {
    this.store = store;
  }

  createHost(entry: Omit<HostEntry, 'id' | 'createdAt' | 'updatedAt'>): HostEntry {
    const errors = validateHostEntry(entry as Partial<HostEntry>);
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.map((e) => e.message).join(', ')}`);
    }

    const now = new Date().toISOString();
    const host: HostEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now
    };

    const hosts = this.store.getHosts();
    hosts.push(host);
    this.store.setHosts(hosts);
    return host;
  }

  getHost(id: string): HostEntry | undefined {
    return this.store.getHosts().find((h) => h.id === id);
  }

  updateHost(id: string, updates: Partial<Omit<HostEntry, 'id' | 'createdAt'>>): HostEntry {
    const hosts = this.store.getHosts();
    const index = hosts.findIndex((h) => h.id === id);
    if (index === -1) {
      throw new Error(`Host not found: ${id}`);
    }

    const merged = { ...hosts[index], ...updates, id, createdAt: hosts[index].createdAt };
    const errors = validateHostEntry(merged);
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.map((e) => e.message).join(', ')}`);
    }

    merged.updatedAt = new Date().toISOString();
    hosts[index] = merged;
    this.store.setHosts(hosts);
    return merged;
  }

  deleteHost(id: string): void {
    const hosts = this.store.getHosts();
    const index = hosts.findIndex((h) => h.id === id);
    if (index === -1) {
      throw new Error(`Host not found: ${id}`);
    }
    hosts.splice(index, 1);
    this.store.setHosts(hosts);
  }

  listHosts(): HostEntry[] {
    return this.store.getHosts();
  }

  // Group management
  createGroup(name: string, parentId?: string): ConnectionGroup {
    if (!name || name.trim() === '') {
      throw new Error('Group name is required');
    }
    const group: ConnectionGroup = {
      id: randomUUID(),
      name: name.trim(),
      parentId
    };
    const groups = this.store.getGroups();
    groups.push(group);
    this.store.setGroups(groups);
    return group;
  }

  deleteGroup(id: string): void {
    const groups = this.store.getGroups();
    const index = groups.findIndex((g) => g.id === id);
    if (index === -1) {
      throw new Error(`Group not found: ${id}`);
    }
    groups.splice(index, 1);
    this.store.setGroups(groups);
  }

  listGroups(): ConnectionGroup[] {
    return this.store.getGroups();
  }

  // Import / Export
  exportConfig(): string {
    const data: ExportData = {
      version: '1.0',
      hosts: this.store.getHosts(),
      groups: this.store.getGroups()
    };
    return JSON.stringify(data, null, 2);
  }

  importConfig(json: string): ImportResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { imported: 0, errors: ['Invalid JSON format'] };
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return { imported: 0, errors: ['Invalid config format: expected an object'] };
    }

    const data = parsed as Record<string, unknown>;
    const hostsRaw = Array.isArray(data.hosts) ? data.hosts : [];
    const groupsRaw = Array.isArray(data.groups) ? data.groups : [];

    const errors: string[] = [];
    const validHosts: HostEntry[] = [];

    for (let i = 0; i < hostsRaw.length; i++) {
      const entry = hostsRaw[i] as Partial<HostEntry>;
      const validationErrors = validateHostEntry(entry);
      if (validationErrors.length > 0) {
        errors.push(
          `Host[${i}] (${entry.name || 'unnamed'}): ${validationErrors.map((e) => e.message).join(', ')}`
        );
      } else {
        const now = new Date().toISOString();
        validHosts.push({
          id: entry.id || randomUUID(),
          name: entry.name!,
          hostname: entry.hostname!,
          port: entry.port!,
          username: entry.username!,
          authMethod: entry.authMethod!,
          privateKeyPath: entry.privateKeyPath,
          passphrase: entry.passphrase,
          group: entry.group,
          jumpHost: entry.jumpHost,
          keepAliveInterval: entry.keepAliveInterval,
          createdAt: entry.createdAt || now,
          updatedAt: entry.updatedAt || now
        });
      }
    }

    const validGroups: ConnectionGroup[] = [];
    for (let i = 0; i < groupsRaw.length; i++) {
      const g = groupsRaw[i] as Partial<ConnectionGroup>;
      if (!g.name || g.name.trim() === '') {
        errors.push(`Group[${i}]: Name is required`);
      } else {
        validGroups.push({
          id: g.id || randomUUID(),
          name: g.name.trim(),
          parentId: g.parentId
        });
      }
    }

    // Merge with existing data
    const existingHosts = this.store.getHosts();
    const existingGroups = this.store.getGroups();
    this.store.setHosts([...existingHosts, ...validHosts]);
    this.store.setGroups([...existingGroups, ...validGroups]);

    return { imported: validHosts.length + validGroups.length, errors };
  }
}
