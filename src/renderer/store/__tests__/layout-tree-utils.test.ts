import { describe, it, expect, vi } from 'vitest';
import type { LayoutNode, LeafPane, SplitNode } from '../../../shared/types';
import {
  clampRatio,
  findLeaf,
  findLeafBySessionId,
  countLeaves,
  allRatios,
  splitLeaf,
  removeLeaf,
  updateRatioAtPath,
  replaceSession,
} from '../layout-tree-utils';

// ===== Test Fixtures =====

const leafA: LeafPane = { type: 'leaf', paneId: 'pane-a', sessionId: 'session-a' };
const leafB: LeafPane = { type: 'leaf', paneId: 'pane-b', sessionId: 'session-b' };
const leafC: LeafPane = { type: 'leaf', paneId: 'pane-c', sessionId: 'session-c' };

const simpleSplit: SplitNode = {
  type: 'split',
  direction: 'horizontal',
  ratio: 0.5,
  first: leafA,
  second: leafB,
};

const nestedTree: SplitNode = {
  type: 'split',
  direction: 'horizontal',
  ratio: 0.6,
  first: leafA,
  second: {
    type: 'split',
    direction: 'vertical',
    ratio: 0.4,
    first: leafB,
    second: leafC,
  },
};

// ===== clampRatio =====

describe('clampRatio', () => {
  it('returns the value when within range', () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0.2)).toBe(0.2);
    expect(clampRatio(0.8)).toBe(0.8);
  });

  it('clamps values below 0.2 to 0.2', () => {
    expect(clampRatio(0)).toBe(0.2);
    expect(clampRatio(-1)).toBe(0.2);
    expect(clampRatio(0.1)).toBe(0.2);
  });

  it('clamps values above 0.8 to 0.8', () => {
    expect(clampRatio(1)).toBe(0.8);
    expect(clampRatio(0.9)).toBe(0.8);
    expect(clampRatio(100)).toBe(0.8);
  });
});

// ===== findLeaf =====

describe('findLeaf', () => {
  it('finds a leaf in a single-leaf tree', () => {
    expect(findLeaf(leafA, 'pane-a')).toBe(leafA);
  });

  it('returns null when paneId not found', () => {
    expect(findLeaf(leafA, 'nonexistent')).toBeNull();
  });

  it('finds a leaf in a split tree', () => {
    expect(findLeaf(simpleSplit, 'pane-b')).toBe(leafB);
  });

  it('finds a leaf in a nested tree', () => {
    expect(findLeaf(nestedTree, 'pane-c')).toBe(leafC);
  });
});

// ===== findLeafBySessionId =====

describe('findLeafBySessionId', () => {
  it('finds a leaf by session ID', () => {
    expect(findLeafBySessionId(nestedTree, 'session-b')).toBe(leafB);
  });

  it('returns null when session ID not found', () => {
    expect(findLeafBySessionId(nestedTree, 'nonexistent')).toBeNull();
  });

  it('finds a leaf in a single-leaf tree', () => {
    expect(findLeafBySessionId(leafA, 'session-a')).toBe(leafA);
  });
});

// ===== countLeaves =====

describe('countLeaves', () => {
  it('counts 1 for a single leaf', () => {
    expect(countLeaves(leafA)).toBe(1);
  });

  it('counts 2 for a simple split', () => {
    expect(countLeaves(simpleSplit)).toBe(2);
  });

  it('counts 3 for a nested tree', () => {
    expect(countLeaves(nestedTree)).toBe(3);
  });
});

// ===== allRatios =====

describe('allRatios', () => {
  it('returns empty array for a leaf', () => {
    expect(allRatios(leafA)).toEqual([]);
  });

  it('returns single ratio for a simple split', () => {
    expect(allRatios(simpleSplit)).toEqual([0.5]);
  });

  it('returns all ratios for a nested tree', () => {
    const ratios = allRatios(nestedTree);
    expect(ratios).toContain(0.6);
    expect(ratios).toContain(0.4);
    expect(ratios).toHaveLength(2);
  });
});

// ===== splitLeaf =====

describe('splitLeaf', () => {
  // Mock crypto.randomUUID for deterministic tests
  const mockUUID = 'mock-uuid-1234';
  vi.stubGlobal('crypto', { randomUUID: () => mockUUID });

  it('creates a horizontal split for left drop position', () => {
    const result = splitLeaf(leafA, 'pane-a', 'new-session', 'left');
    expect(result.type).toBe('split');
    const split = result as SplitNode;
    expect(split.direction).toBe('horizontal');
    expect(split.ratio).toBe(0.5);
    // New pane is first child for 'left'
    expect(split.first.type).toBe('leaf');
    expect((split.first as LeafPane).sessionId).toBe('new-session');
    expect((split.first as LeafPane).paneId).toBe(mockUUID);
    // Original pane is second child
    expect(split.second).toBe(leafA);
  });

  it('creates a horizontal split for right drop position', () => {
    const result = splitLeaf(leafA, 'pane-a', 'new-session', 'right');
    const split = result as SplitNode;
    expect(split.direction).toBe('horizontal');
    expect(split.ratio).toBe(0.5);
    // Original pane is first child for 'right'
    expect(split.first).toBe(leafA);
    // New pane is second child
    expect((split.second as LeafPane).sessionId).toBe('new-session');
  });

  it('creates a vertical split for top drop position', () => {
    const result = splitLeaf(leafA, 'pane-a', 'new-session', 'top');
    const split = result as SplitNode;
    expect(split.direction).toBe('vertical');
    expect(split.ratio).toBe(0.5);
    // New pane is first child for 'top'
    expect((split.first as LeafPane).sessionId).toBe('new-session');
    expect(split.second).toBe(leafA);
  });

  it('creates a vertical split for bottom drop position', () => {
    const result = splitLeaf(leafA, 'pane-a', 'new-session', 'bottom');
    const split = result as SplitNode;
    expect(split.direction).toBe('vertical');
    // Original pane is first child for 'bottom'
    expect(split.first).toBe(leafA);
    expect((split.second as LeafPane).sessionId).toBe('new-session');
  });

  it('replaces session ID for center drop position', () => {
    const result = splitLeaf(leafA, 'pane-a', 'new-session', 'center');
    expect(result.type).toBe('leaf');
    const leaf = result as LeafPane;
    expect(leaf.paneId).toBe('pane-a');
    expect(leaf.sessionId).toBe('new-session');
  });

  it('does not change tree structure for center drop', () => {
    const result = splitLeaf(nestedTree, 'pane-b', 'new-session', 'center');
    expect(countLeaves(result)).toBe(countLeaves(nestedTree));
  });

  it('splits a leaf inside a nested tree', () => {
    const result = splitLeaf(simpleSplit, 'pane-b', 'new-session', 'right');
    expect(result.type).toBe('split');
    const root = result as SplitNode;
    // First child unchanged
    expect(root.first).toBe(leafA);
    // Second child is now a split
    expect(root.second.type).toBe('split');
    const innerSplit = root.second as SplitNode;
    expect(innerSplit.direction).toBe('horizontal');
    expect(innerSplit.first).toBe(leafB);
    expect((innerSplit.second as LeafPane).sessionId).toBe('new-session');
  });

  it('returns tree unchanged when target paneId not found', () => {
    const result = splitLeaf(leafA, 'nonexistent', 'new-session', 'left');
    expect(result).toBe(leafA);
  });
});

// ===== removeLeaf =====

describe('removeLeaf', () => {
  it('returns null when removing the only leaf', () => {
    expect(removeLeaf(leafA, 'pane-a')).toBeNull();
  });

  it('returns the tree unchanged when paneId not found', () => {
    expect(removeLeaf(leafA, 'nonexistent')).toBe(leafA);
  });

  it('collapses a simple split when removing first child', () => {
    const result = removeLeaf(simpleSplit, 'pane-a');
    expect(result).toBe(leafB);
  });

  it('collapses a simple split when removing second child', () => {
    const result = removeLeaf(simpleSplit, 'pane-b');
    expect(result).toBe(leafA);
  });

  it('collapses parent split in a nested tree', () => {
    const result = removeLeaf(nestedTree, 'pane-b');
    expect(result).not.toBeNull();
    const root = result as SplitNode;
    expect(root.type).toBe('split');
    expect(root.first).toBe(leafA);
    expect(root.second).toBe(leafC);
  });

  it('reduces leaf count by one', () => {
    const result = removeLeaf(nestedTree, 'pane-c');
    expect(result).not.toBeNull();
    expect(countLeaves(result!)).toBe(countLeaves(nestedTree) - 1);
  });
});

// ===== updateRatioAtPath =====

describe('updateRatioAtPath', () => {
  it('updates ratio at root (empty path)', () => {
    const result = updateRatioAtPath(simpleSplit, [], 0.7);
    expect((result as SplitNode).ratio).toBe(0.7);
  });

  it('clamps ratio to minimum 0.2', () => {
    const result = updateRatioAtPath(simpleSplit, [], 0.1);
    expect((result as SplitNode).ratio).toBe(0.2);
  });

  it('clamps ratio to maximum 0.8', () => {
    const result = updateRatioAtPath(simpleSplit, [], 0.95);
    expect((result as SplitNode).ratio).toBe(0.8);
  });

  it('updates ratio at a nested path', () => {
    // nestedTree: root (0.6) -> second child is split (0.4)
    const result = updateRatioAtPath(nestedTree, [1], 0.7);
    const root = result as SplitNode;
    expect(root.ratio).toBe(0.6); // root unchanged
    expect((root.second as SplitNode).ratio).toBe(0.7); // nested updated
  });

  it('returns tree unchanged for invalid path (leaf)', () => {
    const result = updateRatioAtPath(leafA, [], 0.5);
    expect(result).toBe(leafA);
  });

  it('returns tree unchanged for path that goes too deep', () => {
    const result = updateRatioAtPath(simpleSplit, [0, 0], 0.5);
    // path [0, 0] tries to go into first child (a leaf), which is invalid
    expect((result as SplitNode).ratio).toBe(0.5); // root unchanged
  });

  it('does not mutate the original tree', () => {
    const original = { ...simpleSplit };
    updateRatioAtPath(simpleSplit, [], 0.7);
    expect(simpleSplit.ratio).toBe(original.ratio);
  });
});

// ===== replaceSession =====

describe('replaceSession', () => {
  it('replaces session ID in a single leaf', () => {
    const result = replaceSession(leafA, 'pane-a', 'new-session');
    expect(result.type).toBe('leaf');
    expect((result as LeafPane).sessionId).toBe('new-session');
    expect((result as LeafPane).paneId).toBe('pane-a');
  });

  it('returns tree unchanged when paneId not found', () => {
    const result = replaceSession(leafA, 'nonexistent', 'new-session');
    expect(result).toBe(leafA);
  });

  it('replaces session in a nested tree', () => {
    const result = replaceSession(nestedTree, 'pane-c', 'new-session');
    const innerSplit = (result as SplitNode).second as SplitNode;
    expect((innerSplit.second as LeafPane).sessionId).toBe('new-session');
    // Other leaves unchanged
    expect(((result as SplitNode).first as LeafPane).sessionId).toBe('session-a');
    expect((innerSplit.first as LeafPane).sessionId).toBe('session-b');
  });

  it('does not mutate the original tree', () => {
    replaceSession(leafA, 'pane-a', 'new-session');
    expect(leafA.sessionId).toBe('session-a');
  });
});
