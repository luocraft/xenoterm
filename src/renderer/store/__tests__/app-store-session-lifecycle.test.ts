// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../app-store';
import type { HostEntry } from '../../../shared/types';

afterEach(() => {
  for (const session of useAppStore.getState().sessions) {
    useAppStore.getState().removeSession(session.id);
  }
});

describe('SSH session listener lifetime', () => {
  it('releases IPC subscriptions and cached CWD when sessions are removed', async () => {
    const activeListeners = new Set<() => void>();
    const subscribe = () => {
      const listener = vi.fn();
      activeListeners.add(listener);
      return () => activeListeners.delete(listener);
    };
    let id = 0;
    window.api = { ssh: {
      connect: vi.fn(async () => ({ id: `session-${++id}`, hostEntryId: 'host', status: 'connected' })),
      onClose: subscribe, onError: subscribe
    } } as any;
    useAppStore.setState({ hosts: [{ id: 'host' } as HostEntry], sessions: [], sessionCwdMap: {} });
    for (let i = 0; i < 100; i++) {
      await useAppStore.getState().connectToHost('host');
      const sessionId = useAppStore.getState().activeSessionId!;
      useAppStore.getState().setSessionCwd(sessionId, '/tmp');
      expect(activeListeners.size).toBe(2);
      useAppStore.getState().removeSession(sessionId);
      expect(activeListeners.size).toBe(0);
    }
    expect(useAppStore.getState().sessionCwdMap).toEqual({});
  });
});
