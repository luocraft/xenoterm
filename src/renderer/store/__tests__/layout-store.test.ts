import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeafPane, SplitNode } from '../../../shared/types';
import { useLayoutStore } from '../layout-store';
import { countLeaves, findLeafBySessionId, findLeaf } from '../layout-tree-utils';

// ===== Mock crypto.randomUUID =====
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `mock-uuid-${++uuidCounter}`,
});

// ===== Reset store state between tests =====
beforeEach(() => {
  uuidCounter = 0;
  useLayoutStore.setState({ layoutTree: null, activePaneId: null });
});

// ===== initLayout =====

describe('initLayout', () => {
  it('creates a single leaf with correct sessionId and sets activePaneId', () => {
    useLayoutStore.getState().initLayout('session-1');

    const { layoutTree, activePaneId } = useLayoutStore.getState();
    expect(layoutTree).not.toBeNull();
    expect(layoutTree!.type).toBe('leaf');

    const leaf = layoutTree as LeafPane;
    expect(leaf.sessionId).toBe('session-1');
    // paneId is now stable and derived from sessionId
    expect(leaf.paneId).toBe('pane-session-1');
    expect(activePaneId).toBe('pane-session-1');
  });

  it('is a no-op when tree already exists', () => {
    useLayoutStore.getState().initLayout('session-1');
    const stateAfterFirst = useLayoutStore.getState();

    useLayoutStore.getState().initLayout('session-2');
    const stateAfterSecond = useLayoutStore.getState();

    expect(stateAfterSecond.layoutTree).toBe(stateAfterFirst.layoutTree);
    expect(stateAfterSecond.activePaneId).toBe(stateAfterFirst.activePaneId);
    // The tree should still have session-1, not session-2
    expect((stateAfterSecond.layoutTree as LeafPane).sessionId).toBe('session-1');
  });
});

// ===== splitPane =====

describe('splitPane', () => {
  it('creates a horizontal split for left drop position', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(paneId, 'session-2', 'left');

    const { layoutTree } = useLayoutStore.getState();
    expect(layoutTree!.type).toBe('split');
    const split = layoutTree as SplitNode;
    expect(split.direction).toBe('horizontal');
    expect(split.ratio).toBe(0.5);
    // New pane is first child for 'left'
    expect((split.first as LeafPane).sessionId).toBe('session-2');
    // Original pane is second child
    expect((split.second as LeafPane).sessionId).toBe('session-1');
  });

  it('creates a horizontal split for right drop position', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(paneId, 'session-2', 'right');

    const { layoutTree } = useLayoutStore.getState();
    const split = layoutTree as SplitNode;
    expect(split.direction).toBe('horizontal');
    // Original pane is first child for 'right'
    expect((split.first as LeafPane).sessionId).toBe('session-1');
    // New pane is second child
    expect((split.second as LeafPane).sessionId).toBe('session-2');
  });

  it('creates a vertical split for top drop position', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(paneId, 'session-2', 'top');

    const { layoutTree } = useLayoutStore.getState();
    const split = layoutTree as SplitNode;
    expect(split.direction).toBe('vertical');
    // New pane is first child for 'top'
    expect((split.first as LeafPane).sessionId).toBe('session-2');
    expect((split.second as LeafPane).sessionId).toBe('session-1');
  });

  it('creates a vertical split for bottom drop position', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(paneId, 'session-2', 'bottom');

    const { layoutTree } = useLayoutStore.getState();
    const split = layoutTree as SplitNode;
    expect(split.direction).toBe('vertical');
    // Original pane is first child for 'bottom'
    expect((split.first as LeafPane).sessionId).toBe('session-1');
    expect((split.second as LeafPane).sessionId).toBe('session-2');
  });

  it('replaces session for center drop position', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(paneId, 'session-2', 'center');

    const { layoutTree } = useLayoutStore.getState();
    expect(layoutTree!.type).toBe('leaf');
    const leaf = layoutTree as LeafPane;
    expect(leaf.sessionId).toBe('session-2');
    expect(leaf.paneId).toBe(paneId);
  });

  it('is a no-op when layoutTree is null', () => {
    useLayoutStore.getState().splitPane('nonexistent', 'session-1', 'right');
    expect(useLayoutStore.getState().layoutTree).toBeNull();
  });
});

// ===== closePane =====

describe('closePane', () => {
  it('sets tree to null and activePaneId to null when last pane is closed', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().closePane(paneId);

    const { layoutTree, activePaneId } = useLayoutStore.getState();
    expect(layoutTree).toBeNull();
    expect(activePaneId).toBeNull();
  });

  it('collapses parent split when closing one of two panes', () => {
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');
    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    const secondPaneId = (tree.second as LeafPane).paneId;

    useLayoutStore.getState().closePane(secondPaneId);

    const { layoutTree } = useLayoutStore.getState();
    expect(layoutTree!.type).toBe('leaf');
    expect((layoutTree as LeafPane).sessionId).toBe('session-1');
  });

  it('picks a new active pane when the active pane is closed', () => {
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');
    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    const secondPaneId = (tree.second as LeafPane).paneId;

    // Set active pane to the second pane, then close it
    useLayoutStore.getState().setActivePaneId(secondPaneId);
    expect(useLayoutStore.getState().activePaneId).toBe(secondPaneId);

    useLayoutStore.getState().closePane(secondPaneId);

    const { activePaneId } = useLayoutStore.getState();
    // Should pick the first leaf in the remaining tree
    expect(activePaneId).toBe(firstPaneId);
  });

  it('keeps activePaneId unchanged when a non-active pane is closed', () => {
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');
    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    const secondPaneId = (tree.second as LeafPane).paneId;

    // Active pane is firstPaneId, close secondPaneId
    useLayoutStore.getState().closePane(secondPaneId);

    expect(useLayoutStore.getState().activePaneId).toBe(firstPaneId);
  });

  it('is a no-op when layoutTree is null', () => {
    useLayoutStore.getState().closePane('nonexistent');
    expect(useLayoutStore.getState().layoutTree).toBeNull();
    expect(useLayoutStore.getState().activePaneId).toBeNull();
  });
});

// ===== resizeSplit =====

describe('resizeSplit', () => {
  it('clamps ratio below 0.2 to 0.2', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(paneId, 'session-2', 'right');

    useLayoutStore.getState().resizeSplit([], 0.1);

    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    expect(tree.ratio).toBe(0.2);
  });

  it('clamps ratio above 0.8 to 0.8', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(paneId, 'session-2', 'right');

    useLayoutStore.getState().resizeSplit([], 0.9);

    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    expect(tree.ratio).toBe(0.8);
  });

  it('updates ratio within valid range', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(paneId, 'session-2', 'right');

    useLayoutStore.getState().resizeSplit([], 0.65);

    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    expect(tree.ratio).toBe(0.65);
  });

  it('is a no-op when layoutTree is null', () => {
    useLayoutStore.getState().resizeSplit([], 0.5);
    expect(useLayoutStore.getState().layoutTree).toBeNull();
  });
});

// ===== setActivePaneId =====

describe('setActivePaneId', () => {
  it('sets the active pane', () => {
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');
    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    const secondPaneId = (tree.second as LeafPane).paneId;

    useLayoutStore.getState().setActivePaneId(secondPaneId);
    expect(useLayoutStore.getState().activePaneId).toBe(secondPaneId);

    useLayoutStore.getState().setActivePaneId(firstPaneId);
    expect(useLayoutStore.getState().activePaneId).toBe(firstPaneId);
  });
});

// ===== findPaneBySessionId =====

describe('findPaneBySessionId', () => {
  it('returns the correct leaf for an existing session', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;

    const result = useLayoutStore.getState().findPaneBySessionId('session-1');
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('session-1');
    expect(result!.paneId).toBe(paneId);
  });

  it('returns null for a non-existent session', () => {
    useLayoutStore.getState().initLayout('session-1');

    const result = useLayoutStore.getState().findPaneBySessionId('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when layoutTree is null', () => {
    const result = useLayoutStore.getState().findPaneBySessionId('session-1');
    expect(result).toBeNull();
  });

  it('finds a session in a multi-pane tree', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(paneId, 'session-2', 'right');

    const result = useLayoutStore.getState().findPaneBySessionId('session-2');
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('session-2');
  });
});

// ===== replaceSessionInPane =====

describe('replaceSessionInPane', () => {
  it('replaces the session correctly', () => {
    useLayoutStore.getState().initLayout('session-1');
    const paneId = useLayoutStore.getState().activePaneId!;

    useLayoutStore.getState().replaceSessionInPane(paneId, 'session-new');

    const { layoutTree } = useLayoutStore.getState();
    expect(layoutTree!.type).toBe('leaf');
    const leaf = layoutTree as LeafPane;
    expect(leaf.sessionId).toBe('session-new');
    expect(leaf.paneId).toBe(paneId);
  });

  it('replaces session in a multi-pane tree', () => {
    useLayoutStore.getState().initLayout('session-1');
    const firstPaneId = useLayoutStore.getState().activePaneId!;
    useLayoutStore.getState().splitPane(firstPaneId, 'session-2', 'right');

    const tree = useLayoutStore.getState().layoutTree as SplitNode;
    const secondPaneId = (tree.second as LeafPane).paneId;

    useLayoutStore.getState().replaceSessionInPane(secondPaneId, 'session-replaced');

    const result = useLayoutStore.getState().findPaneBySessionId('session-replaced');
    expect(result).not.toBeNull();
    expect(result!.paneId).toBe(secondPaneId);
    // Original session should still be there
    const original = useLayoutStore.getState().findPaneBySessionId('session-1');
    expect(original).not.toBeNull();
  });

  it('is a no-op when layoutTree is null', () => {
    useLayoutStore.getState().replaceSessionInPane('nonexistent', 'session-new');
    expect(useLayoutStore.getState().layoutTree).toBeNull();
  });
});
