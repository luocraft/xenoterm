import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ConnectionManager } from '../connection-manager';
import { InMemoryConfigStore } from './in-memory-config-store';
import type { HostEntry } from '../../../shared/types';

// --- Generators ---

const validAuthMethod = fc.constantFrom('password' as const, 'publicKey' as const);

const validHostData = fc.record({
  name: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  hostname: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  port: fc.integer({ min: 1, max: 65535 }),
  username: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  authMethod: validAuthMethod
}).chain((base) => {
  if (base.authMethod === 'publicKey') {
    return fc.record({
      privateKeyPath: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0)
    }).map((extra) => ({ ...base, ...extra }));
  }
  return fc.constant(base);
});

let store: InMemoryConfigStore;
let manager: ConnectionManager;

beforeEach(() => {
  store = new InMemoryConfigStore();
  manager = new ConnectionManager(store);
});

describe('Feature: ssh-client-app, Property 1: Host entry create-then-retrieve', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.6**
   *
   * For any valid HostEntry data, creating a host entry and then retrieving
   * it by ID should return an entry with all the same field values.
   */
  it('should retrieve a created host with matching fields', () => {
    fc.assert(
      fc.property(validHostData, (data) => {
        store.reset();
        const created = manager.createHost(data as Omit<HostEntry, 'id' | 'createdAt' | 'updatedAt'>);
        const retrieved = manager.getHost(created.id);

        expect(retrieved).toBeDefined();
        expect(retrieved!.name).toBe(data.name);
        expect(retrieved!.hostname).toBe(data.hostname);
        expect(retrieved!.port).toBe(data.port);
        expect(retrieved!.username).toBe(data.username);
        expect(retrieved!.authMethod).toBe(data.authMethod);
        if (data.authMethod === 'publicKey' && 'privateKeyPath' in data) {
          expect(retrieved!.privateKeyPath).toBe((data as unknown as { privateKeyPath: string }).privateKeyPath);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: ssh-client-app, Property 2: Host entry update preserves unchanged fields', () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * For any existing HostEntry and any partial update, after applying the update,
   * all fields not included in the update should retain their original values.
   */
  it('should preserve unchanged fields after update', () => {
    fc.assert(
      fc.property(
        validHostData,
        fc.record({
          name: fc.option(fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0), { nil: undefined }),
          hostname: fc.option(fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0), { nil: undefined }),
          port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined })
        }),
        (data, updates) => {
          store.reset();
          const created = manager.createHost(data as Omit<HostEntry, 'id' | 'createdAt' | 'updatedAt'>);

          // Filter out undefined values
          const cleanUpdates: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(updates)) {
            if (v !== undefined) cleanUpdates[k] = v;
          }

          const updated = manager.updateHost(created.id, cleanUpdates);

          // Updated fields should reflect new values
          for (const [k, v] of Object.entries(cleanUpdates)) {
            expect((updated as unknown as Record<string, unknown>)[k]).toBe(v);
          }

          // Unchanged fields should retain original values
          const unchangedKeys = ['username', 'authMethod'] as const;
          for (const key of unchangedKeys) {
            if (!(key in cleanUpdates)) {
              expect(updated[key]).toBe(created[key]);
            }
          }
          expect(updated.id).toBe(created.id);
          expect(updated.createdAt).toBe(created.createdAt);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: ssh-client-app, Property 3: Host entry deletion reduces list', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any list of host entries and any entry in that list, deleting the entry
   * should result in the list length decreasing by one.
   */
  it('should reduce list by one and make entry unretrievable', () => {
    fc.assert(
      fc.property(
        fc.array(validHostData, { minLength: 1, maxLength: 10 }),
        fc.nat(),
        (dataList, indexSeed) => {
          store.reset();
          const created = dataList.map((d) =>
            manager.createHost(d as Omit<HostEntry, 'id' | 'createdAt' | 'updatedAt'>)
          );
          const targetIndex = indexSeed % created.length;
          const target = created[targetIndex];
          const beforeCount = manager.listHosts().length;

          manager.deleteHost(target.id);

          expect(manager.listHosts().length).toBe(beforeCount - 1);
          expect(manager.getHost(target.id)).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: ssh-client-app, Property 4: Host grouping consistency', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * For any set of host entries and groups, assigning a host to a group should
   * result in that host's group field matching the group ID.
   */
  it('should assign group correctly', () => {
    fc.assert(
      fc.property(
        validHostData,
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (data, groupName) => {
          store.reset();
          const group = manager.createGroup(groupName);
          const host = manager.createHost({
            ...(data as Omit<HostEntry, 'id' | 'createdAt' | 'updatedAt'>),
            group: group.id
          });

          expect(host.group).toBe(group.id);

          const allHosts = manager.listHosts();
          const hostsInGroup = allHosts.filter((h) => h.group === group.id);
          expect(hostsInGroup.some((h) => h.id === host.id)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: ssh-client-app, Property 10: Configuration serialization round-trip', () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any valid set of HostEntry and ConnectionGroup objects, serializing to JSON
   * and then deserializing should produce an equivalent set of objects.
   */
  it('should round-trip serialize/deserialize without data loss', () => {
    fc.assert(
      fc.property(
        fc.array(validHostData, { minLength: 0, maxLength: 5 }),
        fc.array(
          fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          { minLength: 0, maxLength: 3 }
        ),
        (hostDataList, groupNames) => {
          store.reset();

          // Create groups
          const groups = groupNames.map((name) => manager.createGroup(name));

          // Create hosts
          hostDataList.forEach((d) =>
            manager.createHost(d as Omit<HostEntry, 'id' | 'createdAt' | 'updatedAt'>)
          );

          const exported = manager.exportConfig();
          const originalHosts = manager.listHosts();
          const originalGroups = manager.listGroups();

          // Reset and import
          store.reset();
          expect(manager.listHosts().length).toBe(0);

          const result = manager.importConfig(exported);

          expect(result.errors.length).toBe(0);
          expect(manager.listHosts().length).toBe(originalHosts.length);
          expect(manager.listGroups().length).toBe(originalGroups.length);

          // Deep compare hosts
          const importedHosts = manager.listHosts();
          for (const original of originalHosts) {
            const imported = importedHosts.find((h) => h.id === original.id);
            expect(imported).toBeDefined();
            expect(imported!.name).toBe(original.name);
            expect(imported!.hostname).toBe(original.hostname);
            expect(imported!.port).toBe(original.port);
            expect(imported!.username).toBe(original.username);
            expect(imported!.authMethod).toBe(original.authMethod);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: ssh-client-app, Property 11: Invalid import graceful handling', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For any JSON string containing a mix of valid and invalid HostEntry objects,
   * importing should successfully add all valid entries and return specific error
   * messages for each invalid entry.
   */
  it('should import valid entries and report errors for invalid ones', () => {
    fc.assert(
      fc.property(
        fc.array(validHostData, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 3 }),
        (validDataList, invalidCount) => {
          store.reset();

          const validHosts = validDataList.map((d, i) => ({
            id: `valid-${i}`,
            ...d,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }));

          // Create invalid entries (missing required fields)
          const invalidHosts = Array.from({ length: invalidCount }, (_, i) => ({
            id: `invalid-${i}`,
            name: `Invalid ${i}`,
            // Missing hostname, port, username, authMethod
          }));

          const json = JSON.stringify({
            version: '1.0',
            hosts: [...validHosts, ...invalidHosts],
            groups: []
          });

          const result = manager.importConfig(json);

          expect(result.imported).toBe(validHosts.length);
          expect(result.errors.length).toBe(invalidCount);

          // Valid entries should be in the store
          const stored = manager.listHosts();
          expect(stored.length).toBe(validHosts.length);

          // Each error should reference the invalid entry
          for (const error of result.errors) {
            expect(error.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
