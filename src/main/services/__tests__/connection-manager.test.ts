import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionManager, validateHostEntry } from '../connection-manager';
import { InMemoryConfigStore } from './in-memory-config-store';

let store: InMemoryConfigStore;
let manager: ConnectionManager;

const validHost = {
  name: 'Test Server',
  hostname: '192.168.1.1',
  port: 22,
  username: 'admin',
  authMethod: 'password' as const
};

beforeEach(() => {
  store = new InMemoryConfigStore();
  manager = new ConnectionManager(store);
});

describe('validateHostEntry', () => {
  it('should reject empty hostname', () => {
    const errors = validateHostEntry({ ...validHost, hostname: '' });
    expect(errors.some((e) => e.field === 'hostname')).toBe(true);
  });

  it('should reject port 0', () => {
    const errors = validateHostEntry({ ...validHost, port: 0 });
    expect(errors.some((e) => e.field === 'port')).toBe(true);
  });

  it('should reject port 65536', () => {
    const errors = validateHostEntry({ ...validHost, port: 65536 });
    expect(errors.some((e) => e.field === 'port')).toBe(true);
  });

  it('should reject empty username', () => {
    const errors = validateHostEntry({ ...validHost, username: '' });
    expect(errors.some((e) => e.field === 'username')).toBe(true);
  });

  it('should reject invalid authMethod', () => {
    const errors = validateHostEntry({ ...validHost, authMethod: 'invalid' as 'password' });
    expect(errors.some((e) => e.field === 'authMethod')).toBe(true);
  });

  it('should require privateKeyPath for publicKey auth', () => {
    const errors = validateHostEntry({ ...validHost, authMethod: 'publicKey' });
    expect(errors.some((e) => e.field === 'privateKeyPath')).toBe(true);
  });

  it('should accept valid publicKey entry', () => {
    const errors = validateHostEntry({
      ...validHost,
      authMethod: 'publicKey',
      privateKeyPath: '/home/user/.ssh/id_rsa'
    });
    expect(errors.length).toBe(0);
  });
});

describe('ConnectionManager CRUD', () => {
  it('should throw when creating host with invalid data', () => {
    expect(() => manager.createHost({ ...validHost, hostname: '' })).toThrow('Validation failed');
  });

  it('should throw when deleting non-existent host', () => {
    expect(() => manager.deleteHost('non-existent-id')).toThrow('Host not found');
  });

  it('should throw when updating non-existent host', () => {
    expect(() => manager.updateHost('non-existent-id', { name: 'New' })).toThrow('Host not found');
  });

  it('should return undefined for non-existent host', () => {
    expect(manager.getHost('non-existent-id')).toBeUndefined();
  });

  it('should throw when creating group with empty name', () => {
    expect(() => manager.createGroup('')).toThrow('Group name is required');
  });

  it('should throw when deleting non-existent group', () => {
    expect(() => manager.deleteGroup('non-existent-id')).toThrow('Group not found');
  });
});

describe('ConnectionManager import', () => {
  it('should return error for invalid JSON', () => {
    const result = manager.importConfig('not valid json');
    expect(result.imported).toBe(0);
    expect(result.errors).toContain('Invalid JSON format');
  });

  it('should return error for non-object JSON', () => {
    const result = manager.importConfig('"just a string"');
    expect(result.imported).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle empty hosts array', () => {
    const result = manager.importConfig(JSON.stringify({ hosts: [], groups: [] }));
    expect(result.imported).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('should handle missing hosts key', () => {
    const result = manager.importConfig(JSON.stringify({ version: '1.0' }));
    expect(result.imported).toBe(0);
    expect(result.errors.length).toBe(0);
  });
});
