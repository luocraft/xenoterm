import { describe, it, expect, beforeEach } from 'vitest';
import { SSHService } from '../ssh-service';
import type { HostEntry } from '../../../shared/types';

let service: SSHService;

const makeHost = (overrides?: Partial<HostEntry>): HostEntry => ({
  id: 'test-host-1',
  name: 'Test Server',
  hostname: '192.168.1.1',
  port: 22,
  username: 'admin',
  authMethod: 'password',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
});

beforeEach(() => {
  service = new SSHService();
});

describe('SSHService session management', () => {
  it('should return undefined for non-existent session', () => {
    expect(service.getSession('non-existent')).toBeUndefined();
  });

  it('should list empty sessions initially', () => {
    expect(service.listSessions()).toEqual([]);
  });

  it('should handle write to non-existent session gracefully', () => {
    // Should not throw
    service.write('non-existent', 'hello');
  });

  it('should handle resize on non-existent session gracefully', () => {
    service.resize('non-existent', 80, 24);
  });

  it('should handle disconnect on non-existent session gracefully', () => {
    service.disconnect('non-existent');
  });

  it('should reject openShell for non-existent session', async () => {
    await expect(service.openShell('non-existent')).rejects.toThrow('Session not connected');
  });
});

describe('SSHService connection error handling', () => {
  it('should set error status when connection fails (ECONNREFUSED)', async () => {
    const host = makeHost({ hostname: '127.0.0.1', port: 1 });
    try {
      await service.connect(host, 'password');
    } catch {
      // Expected to fail
    }
    const sessions = service.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].status).toBe('error');
    expect(sessions[0].error).toBeDefined();
  });

  it('should set error status for unreachable host', async () => {
    const host = makeHost({ hostname: 'this-host-does-not-exist.invalid', port: 22 });
    try {
      await service.connect(host, 'password');
    } catch {
      // Expected
    }
    const sessions = service.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].status).toBe('error');
  });

  it('should fail with descriptive error for missing private key', async () => {
    const host = makeHost({
      authMethod: 'publicKey',
      privateKeyPath: '/nonexistent/path/id_rsa'
    });
    try {
      await service.connect(host);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('Failed to read private key');
    }
  });
});

describe('SSHService host resolver', () => {
  it('should accept a host resolver function', () => {
    const resolver = (id: string) => (id === 'jump' ? makeHost({ id: 'jump' }) : undefined);
    service.setHostResolver(resolver);
    // No error means it works
  });
});

describe('SSHService callback registration', () => {
  it('should not throw when registering callbacks on non-existent session', () => {
    service.onData('non-existent', () => {});
    service.onClose('non-existent', () => {});
    service.onError('non-existent', () => {});
  });
});

describe('SSHService getSFTPClient', () => {
  it('should return undefined for non-existent session', () => {
    expect(service.getSFTPClient('non-existent')).toBeUndefined();
  });
});
