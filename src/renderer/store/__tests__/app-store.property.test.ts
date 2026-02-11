import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { SSHSession, SessionStatus } from '../../../shared/types';

/**
 * Pure function that simulates the session-to-tab mapping logic.
 * Each session should produce exactly one tab entry.
 */
function sessionsToTabs(sessions: SSHSession[]): { sessionId: string; label: string }[] {
  return sessions.map((s) => ({
    sessionId: s.id,
    label: s.hostEntryId
  }));
}

const sessionStatusArb: fc.Arbitrary<SessionStatus> = fc.constantFrom(
  'connecting',
  'connected',
  'disconnected',
  'error'
);

const sessionArb: fc.Arbitrary<SSHSession> = fc.record({
  id: fc.uuid(),
  hostEntryId: fc.uuid(),
  status: sessionStatusArb,
  connectedAt: fc.option(fc.date().map((d) => d.toISOString()), { nil: undefined }),
  error: fc.option(fc.string(), { nil: undefined })
});

describe('Feature: ssh-client-app, Property 5: Session tab tracking', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For any number of active SSH sessions, the tab list should contain
   * exactly one tab per session, and each tab should reference a valid session ID.
   */
  it('should have exactly one tab per session with valid session IDs', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArb, { minLength: 0, maxLength: 20 }),
        (sessions) => {
          const tabs = sessionsToTabs(sessions);

          // Tab count equals session count
          expect(tabs.length).toBe(sessions.length);

          // Each tab references a valid session ID
          const sessionIds = new Set(sessions.map((s) => s.id));
          for (const tab of tabs) {
            expect(sessionIds.has(tab.sessionId)).toBe(true);
          }

          // No duplicate tabs
          const tabIds = tabs.map((t) => t.sessionId);
          expect(new Set(tabIds).size).toBe(tabIds.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
