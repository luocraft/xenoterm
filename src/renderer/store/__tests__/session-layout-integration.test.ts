import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeafPane, SplitNode } from '../../../shared/types';
import { useLayoutStore } from '../layout-store';
import { useAppStore } from '../app-store';
import { findLeaf, findLeafBySessionId, countLeaves } from '../layout-tree-utils';

// ===== Mock crypto.randomUUID =====
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `mock-uuid-${++uuidCounter}`,
});

// ===== Reset store state between tests =====
beforeEach(() => {
  uuidCounter = 0;
  useLayoutStore.setState({ layoutTree: null, activePaneId: null });
  useAppStore.setState({ sessions: [], activeSessionId: null });
});

/**
 * These tests validate the integration logic between the app store (sessions)
 * and the layout store (layout tree). They test the same logic that the
 * useEffect hooks in App.tsx implement, but at the store level.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 5.3
 */

describe('Session connect → layout store integration', () => {
  it('initializes layout tree when first session connects and tree is null', () => {
    // Requirement 7.1: new session → add leaf to layout tree
    expect(useLayoutStore.getState().layoutTree).toBeNull();

    useLayoutStore.getState().initLayout('session-1');

    const { layoutTree, activePaneId } = useLayoutStore.getState();
    expect(layoutTree).not.toBeNull();
    expect(layoutTree!.type).toBe('leaf');
    expect((layoutTree as LeafPane).sessionId).toBe('session-1');
    expect(activePaneId).not.toBeNull();
  });

  it('adds new session to existing tree by splitting active pane', () => {
    // Requirement 7.1: add pane to existing tree
    useLayoutStore.getState().initLayout('session-1');
    const activePaneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(activePaneId, 'session-2', 'right');

    const { layoutTree } = useLayoutStore.getState();
    expect(layoutTree!.type).toBe('split');
    expect(countLeaves(layoutTree!)).toBe(2);

    const pane1 = findLeafBySessionId(layoutTree!, 'session-1');
    const pane2 = findLeafBySessionId(layoutTree!, 'session-2');
    expect(pane1).not.toBeNull();
    expect(pane2).not.toBeNull();
  });

  it('does not duplicate pane when session already has a pane', () => {
    useLayoutStore.getState().initLayout('session-1');

    // Trying to init again should be a no-op
    useLayoutStore.getState().initLayout('session-1');

    const { layoutTree } = useLayoutStore.getState();
    expect(layoutTree!.type).toBe('leaf');
    expect(countLeaves(layoutTree!)).toBe(1);
  });
});

describe('Session disconnect → layout store integration', () => {
  it('closes pane when session is removed (single pane → null tree)', () => {
    // Requirement 7.2: disconnect → close pane, Requirement 5.2: last pane → null
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;

    // Simulate what TabBar.handleClose does
    const pane = useLayoutStore.getState().findPaneBySessionId('session-1');
    expect(pane).not.toBeNull();
    useLayoutStore.getState().closePane(pane!.paneId);

    expect(useLayoutStore.getState().layoutTree).toBeNull();
    expect(useLayoutStore.getState().activePaneId).toBeNull();
  });

  it('closes pane and collapses tree when one of two panes is removed', () => {
    // Requirement 7.2 + 5.1: close pane → collapse parent split
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');

    // Find and close the pane for session-2
    const pane2 = useLayoutStore.getState().findPaneBySessionId('session-2');
    expect(pane2).not.toBeNull();
    useLayoutStore.getState().closePane(pane2!.paneId);

    const { layoutTree } = useLayoutStore.getState();
    expect(layoutTree).not.toBeNull();
    expect(layoutTree!.type).toBe('leaf');
    expect((layoutTree as LeafPane).sessionId).toBe('session-1');
  });

  it('updates activePaneId when the active pane is closed', () => {
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');

    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    const secondPaneId = (tree.second as LeafPane).paneId;

    // Make second pane active, then close it
    useLayoutStore.getState().setActivePaneId(secondPaneId);
    useLayoutStore.getState().closePane(secondPaneId);

    // Should fall back to the first leaf in the remaining tree
    expect(useLayoutStore.getState().activePaneId).toBe(firstPaneId);
  });
});

describe('activePaneId ↔ activeSessionId sync', () => {
  it('can find the session ID for the active pane', () => {
    // Requirement 7.3: tab click → set active pane for that session
    useLayoutStore.getState().initLayout('session-1');
    const activePaneId = useLayoutStore.getState().activePaneId!;

    const layoutTree = useLayoutStore.getState().layoutTree!;
    const leaf = findLeaf(layoutTree, activePaneId);
    expect(leaf).not.toBeNull();
    expect(leaf!.sessionId).toBe('session-1');
  });

  it('syncs activePaneId to correct session after switching panes', () => {
    // Requirement 7.3: active pane change → activeSessionId update
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');

    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    const secondPaneId = (tree.second as LeafPane).paneId;

    // Switch to second pane
    useLayoutStore.getState().setActivePaneId(secondPaneId);

    // Verify we can derive the correct session ID from the active pane
    const currentTree = useLayoutStore.getState().layoutTree!;
    const activeLeaf = findLeaf(currentTree, useLayoutStore.getState().activePaneId!);
    expect(activeLeaf).not.toBeNull();
    expect(activeLeaf!.sessionId).toBe('session-2');

    // Switch back to first pane
    useLayoutStore.getState().setActivePaneId(firstPaneId);
    const activeLeaf2 = findLeaf(currentTree, useLayoutStore.getState().activePaneId!);
    expect(activeLeaf2).not.toBeNull();
    expect(activeLeaf2!.sessionId).toBe('session-1');
  });

  it('can find the pane for a given session ID (tab click → set active pane)', () => {
    // Requirement 7.3: clicking a tab should find and activate the pane for that session
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');

    // Simulate tab click for session-2: find pane, set active
    const pane = useLayoutStore.getState().findPaneBySessionId('session-2');
    expect(pane).not.toBeNull();
    useLayoutStore.getState().setActivePaneId(pane!.paneId);

    expect(useLayoutStore.getState().activePaneId).toBe(pane!.paneId);

    // Verify the active pane maps to session-2
    const activeLeaf = findLeaf(useLayoutStore.getState().layoutTree!, useLayoutStore.getState().activePaneId!);
    expect(activeLeaf!.sessionId).toBe('session-2');
  });
});

describe('Terminal caching preservation (Requirement 7.4)', () => {
  it('layout changes do not affect pane IDs of untouched panes', () => {
    // Requirement 7.4: terminals survive layout changes
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;

    // Add a second pane
    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');

    // The first pane should still have the same paneId
    const pane1 = useLayoutStore.getState().findPaneBySessionId('session-1');
    expect(pane1).not.toBeNull();
    expect(pane1!.paneId).toBe(firstPaneId);

    // Add a third pane by splitting the second
    const pane2 = useLayoutStore.getState().findPaneBySessionId('session-2');
    useLayoutStore.getState().splitPane(pane2!.paneId, 'session-3', 'bottom');

    // First pane should still have the same paneId
    const pane1After = useLayoutStore.getState().findPaneBySessionId('session-1');
    expect(pane1After!.paneId).toBe(firstPaneId);

    // Second pane should still have the same paneId
    const pane2After = useLayoutStore.getState().findPaneBySessionId('session-2');
    expect(pane2After!.paneId).toBe(pane2!.paneId);
  });
});

describe('Multiple session connect/disconnect workflow', () => {
  it('handles connect → connect → disconnect → disconnect sequence', () => {
    // Connect session 1
    useLayoutStore.getState().initLayout('session-1');
    expect(countLeaves(useLayoutStore.getState().layoutTree!)).toBe(1);

    // Connect session 2
    const activePaneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(activePaneId, 'session-2', 'right');
    expect(countLeaves(useLayoutStore.getState().layoutTree!)).toBe(2);

    // Disconnect session 1
    const pane1 = useLayoutStore.getState().findPaneBySessionId('session-1');
    useLayoutStore.getState().closePane(pane1!.paneId);
    expect(countLeaves(useLayoutStore.getState().layoutTree!)).toBe(1);
    expect((useLayoutStore.getState().layoutTree as LeafPane).sessionId).toBe('session-2');

    // Disconnect session 2
    const pane2 = useLayoutStore.getState().findPaneBySessionId('session-2');
    useLayoutStore.getState().closePane(pane2!.paneId);
    expect(useLayoutStore.getState().layoutTree).toBeNull();
    expect(useLayoutStore.getState().activePaneId).toBeNull();
  });

  it('handles three sessions with interleaved close', () => {
    // Connect 3 sessions
    useLayoutStore.getState().initLayout('session-1');
    const pane1Id = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(pane1Id, 'session-2', 'right');
    const pane2 = useLayoutStore.getState().findPaneBySessionId('session-2')!;

    useLayoutStore.getState().splitPane(pane2.paneId, 'session-3', 'bottom');
    expect(countLeaves(useLayoutStore.getState().layoutTree!)).toBe(3);

    // Close session-2 (middle of the tree)
    const pane2Updated = useLayoutStore.getState().findPaneBySessionId('session-2')!;
    useLayoutStore.getState().closePane(pane2Updated.paneId);
    expect(countLeaves(useLayoutStore.getState().layoutTree!)).toBe(2);

    // session-1 and session-3 should still be present
    expect(useLayoutStore.getState().findPaneBySessionId('session-1')).not.toBeNull();
    expect(useLayoutStore.getState().findPaneBySessionId('session-3')).not.toBeNull();
    expect(useLayoutStore.getState().findPaneBySessionId('session-2')).toBeNull();
  });
});
