import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import type { LayoutNode, LeafPane, SplitNode, DropPosition } from '../../../shared/types';
import {
  clampRatio,
  findLeafBySessionId,
  countLeaves,
  allRatios,
  splitLeaf,
  removeLeaf,
  updateRatioAtPath,
  replaceSession,
} from '../layout-tree-utils';

// ===== Mock crypto.randomUUID =====
beforeAll(() => {
  let counter = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `mock-uuid-${++counter}`,
  });
});

// ===== Custom Arbitraries =====

/** Generates a LeafPane with random paneId and sessionId */
const arbLeafPane: fc.Arbitrary<LeafPane> = fc
  .record({
    paneId: fc.uuid(),
    sessionId: fc.uuid(),
  })
  .map(({ paneId, sessionId }) => ({
    type: 'leaf' as const,
    paneId,
    sessionId,
  }));

/** Generates a valid ratio in [0.2, 0.8] for constructing valid trees */
const arbValidRatio: fc.Arbitrary<number> = fc.double({ min: 0.2, max: 0.8, noNaN: true });

/** Generates a ratio in [0.0, 1.0] for testing clamping behavior */
const arbRatio: fc.Arbitrary<number> = fc.double({ min: 0.0, max: 1.0, noNaN: true });

/** Generates a split direction */
const arbDirection: fc.Arbitrary<'horizontal' | 'vertical'> = fc.constantFrom(
  'horizontal' as const,
  'vertical' as const
);

/** Generates a DropPosition (all 5 options) */
const arbDropPosition: fc.Arbitrary<DropPosition> = fc.constantFrom(
  'left' as const,
  'right' as const,
  'top' as const,
  'bottom' as const,
  'center' as const
);

/** Generates a non-center DropPosition */
const arbNonCenterDropPosition: fc.Arbitrary<DropPosition> = fc.constantFrom(
  'left' as const,
  'right' as const,
  'top' as const,
  'bottom' as const
);

/**
 * Recursively generates a LayoutNode tree up to a given depth.
 * At depth 0, always generates a leaf. At depth > 0, randomly chooses leaf or split.
 */
function arbLayoutNode(maxDepth: number): fc.Arbitrary<LayoutNode> {
  if (maxDepth <= 0) {
    return arbLeafPane;
  }
  const childArb = arbLayoutNode(maxDepth - 1);
  return fc.oneof(
    { weight: 1, arbitrary: arbLeafPane },
    {
      weight: 2,
      arbitrary: fc
        .tuple(arbDirection, arbValidRatio, childArb, childArb)
        .map(
          ([direction, ratio, first, second]): SplitNode => ({
            type: 'split',
            direction,
            ratio,
            first,
            second,
          })
        ),
    }
  );
}

/** Generates a LayoutNode tree that contains at least one SplitNode */
function arbTreeWithSplit(): fc.Arbitrary<SplitNode> {
  return fc
    .tuple(arbDirection, arbValidRatio, arbLayoutNode(2), arbLayoutNode(2))
    .map(
      ([direction, ratio, first, second]): SplitNode => ({
        type: 'split',
        direction,
        ratio,
        first,
        second,
      })
    );
}

// ===== Helpers =====

/** Validates the tree structure invariant recursively */
function isValidTree(node: LayoutNode): boolean {
  if (node.type === 'leaf') {
    return node.paneId.length > 0 && node.sessionId.length > 0;
  }
  if (node.type === 'split') {
    return (
      (node.direction === 'horizontal' || node.direction === 'vertical') &&
      node.ratio >= 0.2 &&
      node.ratio <= 0.8 &&
      node.first != null &&
      node.second != null &&
      isValidTree(node.first) &&
      isValidTree(node.second)
    );
  }
  return false;
}

/** Collects all leaf paneIds from a tree */
function collectLeafPaneIds(node: LayoutNode): string[] {
  if (node.type === 'leaf') {
    return [node.paneId];
  }
  return [...collectLeafPaneIds(node.first), ...collectLeafPaneIds(node.second)];
}

/** Collects all leaf sessionIds from a tree */
function collectSessionIds(node: LayoutNode): string[] {
  if (node.type === 'leaf') {
    return [node.sessionId];
  }
  return [...collectSessionIds(node.first), ...collectSessionIds(node.second)];
}

/** Collects all split directions from a tree */
function collectDirections(node: LayoutNode): string[] {
  if (node.type === 'leaf') {
    return [];
  }
  return [node.direction, ...collectDirections(node.first), ...collectDirections(node.second)];
}

/**
 * Finds leaf panes that are direct children of a SplitNode.
 * Returns an array of { paneId, parentPath } objects.
 */
function findDirectChildLeaves(
  node: LayoutNode,
  path: number[] = []
): { paneId: string; parentPath: number[] }[] {
  if (node.type === 'leaf') {
    return [];
  }
  const results: { paneId: string; parentPath: number[] }[] = [];
  if (node.first.type === 'leaf') {
    results.push({ paneId: node.first.paneId, parentPath: path });
  }
  if (node.second.type === 'leaf') {
    results.push({ paneId: node.second.paneId, parentPath: path });
  }
  results.push(...findDirectChildLeaves(node.first, [...path, 0]));
  results.push(...findDirectChildLeaves(node.second, [...path, 1]));
  return results;
}

/**
 * Collects all ratios from a tree EXCEPT the one at the given path.
 * Used for Property 6 to verify only the target ratio changed.
 */
function collectRatiosExceptAtPath(
  node: LayoutNode,
  targetPath: number[],
  currentPath: number[] = []
): number[] {
  if (node.type === 'leaf') {
    return [];
  }
  const isTarget =
    currentPath.length === targetPath.length &&
    currentPath.every((v, i) => v === targetPath[i]);

  const ratios: number[] = [];
  if (!isTarget) {
    ratios.push(node.ratio);
  }
  ratios.push(
    ...collectRatiosExceptAtPath(node.first, targetPath, [...currentPath, 0]),
    ...collectRatiosExceptAtPath(node.second, targetPath, [...currentPath, 1])
  );
  return ratios;
}

/**
 * Collects all valid paths to SplitNodes in the tree.
 */
function collectSplitPaths(node: LayoutNode, currentPath: number[] = []): number[][] {
  if (node.type === 'leaf') {
    return [];
  }
  return [
    currentPath,
    ...collectSplitPaths(node.first, [...currentPath, 0]),
    ...collectSplitPaths(node.second, [...currentPath, 1]),
  ];
}

// ===== Property Tests =====

// Feature: terminal-tab-drag-split, Property 1: Tree structure invariant
describe('Feature: terminal-tab-drag-split, Property 1: Tree structure invariant', () => {
  /**
   * **Validates: Requirements 1.1**
   *
   * For any valid LayoutNode tree, every node is either a LeafPane with a non-empty
   * paneId and sessionId, or a SplitNode with a valid direction, a ratio in [0.2, 0.8],
   * and exactly two non-null children.
   */
  it('every node satisfies the tree structure invariant', () => {
    fc.assert(
      fc.property(arbLayoutNode(3), (tree) => {
        expect(isValidTree(tree)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: terminal-tab-drag-split, Property 2: Serialization round-trip
describe('Feature: terminal-tab-drag-split, Property 2: Serialization round-trip', () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any valid LayoutNode tree, serializing it to JSON and then deserializing
   * it back produces a tree that is deeply equal to the original.
   */
  it('JSON round-trip produces a deeply equal tree', () => {
    fc.assert(
      fc.property(arbLayoutNode(3), (tree) => {
        const serialized = JSON.stringify(tree);
        const deserialized = JSON.parse(serialized) as LayoutNode;
        expect(deserialized).toEqual(tree);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: terminal-tab-drag-split, Property 3: Ratio clamping invariant
describe('Feature: terminal-tab-drag-split, Property 3: Ratio clamping invariant', () => {
  /**
   * **Validates: Requirements 1.3, 4.2**
   *
   * For any LayoutNode tree and any mutation (split, resize, or close),
   * every SplitNode.ratio in the resulting tree is between 0.2 and 0.8 inclusive.
   */
  it('all ratios remain in [0.2, 0.8] after split mutation', () => {
    fc.assert(
      fc.property(
        arbLayoutNode(2),
        fc.uuid(),
        arbNonCenterDropPosition,
        (tree, newSessionId, position) => {
          const paneIds = collectLeafPaneIds(tree);
          if (paneIds.length === 0) return;
          const targetPaneId = paneIds[0];
          const result = splitLeaf(tree, targetPaneId, newSessionId, position);
          const ratios = allRatios(result);
          for (const r of ratios) {
            expect(r).toBeGreaterThanOrEqual(0.2);
            expect(r).toBeLessThanOrEqual(0.8);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all ratios remain in [0.2, 0.8] after resize mutation', () => {
    fc.assert(
      fc.property(arbTreeWithSplit(), arbRatio, (tree, newRatio) => {
        const splitPaths = collectSplitPaths(tree);
        if (splitPaths.length === 0) return;
        const targetPath = splitPaths[0];
        const result = updateRatioAtPath(tree, targetPath, newRatio);
        const ratios = allRatios(result);
        for (const r of ratios) {
          expect(r).toBeGreaterThanOrEqual(0.2);
          expect(r).toBeLessThanOrEqual(0.8);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('all ratios remain in [0.2, 0.8] after close mutation', () => {
    fc.assert(
      fc.property(arbTreeWithSplit(), (tree) => {
        const paneIds = collectLeafPaneIds(tree);
        if (paneIds.length < 2) return;
        const targetPaneId = paneIds[0];
        const result = removeLeaf(tree, targetPaneId);
        if (result === null) return;
        const ratios = allRatios(result);
        for (const r of ratios) {
          expect(r).toBeGreaterThanOrEqual(0.2);
          expect(r).toBeLessThanOrEqual(0.8);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: terminal-tab-drag-split, Property 4: Split direction matches drop position
describe('Feature: terminal-tab-drag-split, Property 4: Split direction matches drop position', () => {
  /**
   * **Validates: Requirements 2.3, 2.4, 2.6**
   *
   * For any valid LayoutNode tree, any leaf pane in that tree, and any non-center
   * drop position, calling splitLeaf produces a new SplitNode where:
   * - direction is "horizontal" if position is "left" or "right"
   * - direction is "vertical" if position is "top" or "bottom"
   * - default ratio is 0.5
   */
  it('split direction and ratio match the drop position', () => {
    fc.assert(
      fc.property(
        arbLayoutNode(2),
        fc.uuid(),
        arbNonCenterDropPosition,
        (tree, newSessionId, position) => {
          const paneIds = collectLeafPaneIds(tree);
          if (paneIds.length === 0) return;
          const targetPaneId = paneIds[0];
          const result = splitLeaf(tree, targetPaneId, newSessionId, position);

          // Find the newly created SplitNode by looking for one that contains
          // the original pane and the new session
          const expectedDirection: 'horizontal' | 'vertical' =
            position === 'left' || position === 'right' ? 'horizontal' : 'vertical';

          // The result tree should have one more leaf than the original
          expect(countLeaves(result)).toBe(countLeaves(tree) + 1);

          // Find the new split node: it should contain a leaf with newSessionId
          const newLeaf = findLeafBySessionId(result, newSessionId);
          expect(newLeaf).not.toBeNull();

          // Verify the new split's properties by walking the tree to find
          // the SplitNode that is the parent of the new leaf
          function findParentSplit(node: LayoutNode): SplitNode | null {
            if (node.type === 'leaf') return null;
            // Check if either child is the new leaf
            if (
              (node.first.type === 'leaf' && node.first.sessionId === newSessionId) ||
              (node.second.type === 'leaf' && node.second.sessionId === newSessionId)
            ) {
              return node;
            }
            return findParentSplit(node.first) ?? findParentSplit(node.second);
          }

          const parentSplit = findParentSplit(result);
          expect(parentSplit).not.toBeNull();
          expect(parentSplit!.direction).toBe(expectedDirection);
          expect(parentSplit!.ratio).toBe(0.5);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: terminal-tab-drag-split, Property 5: Center drop replaces session
describe('Feature: terminal-tab-drag-split, Property 5: Center drop replaces session', () => {
  /**
   * **Validates: Requirements 2.5**
   *
   * For any valid LayoutNode tree and any leaf pane in that tree, dropping a session
   * on the "center" position replaces that pane's session ID with the new session ID
   * without changing the tree structure (same number of nodes, same split directions and ratios).
   */
  it('center drop replaces session without changing tree structure', () => {
    fc.assert(
      fc.property(arbLayoutNode(3), fc.uuid(), (tree, newSessionId) => {
        const paneIds = collectLeafPaneIds(tree);
        if (paneIds.length === 0) return;
        const targetPaneId = paneIds[0];

        const result = splitLeaf(tree, targetPaneId, newSessionId, 'center');

        // Same number of leaves
        expect(countLeaves(result)).toBe(countLeaves(tree));

        // Same split directions
        expect(collectDirections(result)).toEqual(collectDirections(tree));

        // Same ratios
        expect(allRatios(result)).toEqual(allRatios(tree));

        // The target pane now has the new session ID
        const updatedLeaf = result.type === 'leaf' && result.paneId === targetPaneId
          ? result
          : findLeafBySessionId(result, newSessionId);
        expect(updatedLeaf).not.toBeNull();
        expect(updatedLeaf!.sessionId).toBe(newSessionId);
        expect(updatedLeaf!.paneId).toBe(targetPaneId);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: terminal-tab-drag-split, Property 6: Resize updates only the target split
describe('Feature: terminal-tab-drag-split, Property 6: Resize updates only the target split', () => {
  /**
   * **Validates: Requirements 4.1**
   *
   * For any valid LayoutNode tree containing at least one SplitNode, calling
   * updateRatioAtPath with a valid path and a new ratio updates only the ratio
   * of the targeted SplitNode and leaves all other nodes unchanged.
   */
  it('only the targeted split ratio is updated', () => {
    fc.assert(
      fc.property(arbTreeWithSplit(), arbValidRatio, (tree, newRatio) => {
        const splitPaths = collectSplitPaths(tree);
        if (splitPaths.length === 0) return;

        // Pick a random path from available split paths
        const targetPath = splitPaths[splitPaths.length - 1];

        // Collect ratios of all OTHER splits before the update
        const otherRatiosBefore = collectRatiosExceptAtPath(tree, targetPath);

        const result = updateRatioAtPath(tree, targetPath, newRatio);

        // Collect ratios of all OTHER splits after the update
        const otherRatiosAfter = collectRatiosExceptAtPath(result, targetPath);

        // Other ratios should be unchanged
        expect(otherRatiosAfter).toEqual(otherRatiosBefore);

        // The targeted ratio should be the clamped new ratio
        const expectedRatio = clampRatio(newRatio);

        // Navigate to the target split to verify its ratio
        function getRatioAtPath(node: LayoutNode, path: number[]): number | null {
          if (node.type === 'leaf') return null;
          if (path.length === 0) return node.ratio;
          const [head, ...rest] = path;
          if (head === 0) return getRatioAtPath(node.first, rest);
          if (head === 1) return getRatioAtPath(node.second, rest);
          return null;
        }

        expect(getRatioAtPath(result, targetPath)).toBeCloseTo(expectedRatio, 10);

        // Same tree structure (same number of leaves, same directions)
        expect(countLeaves(result)).toBe(countLeaves(tree));
        expect(collectDirections(result)).toEqual(collectDirections(tree));
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: terminal-tab-drag-split, Property 7: Close pane collapses parent split
describe('Feature: terminal-tab-drag-split, Property 7: Close pane collapses parent split', () => {
  /**
   * **Validates: Requirements 5.1**
   *
   * For any valid LayoutNode tree with at least two leaf panes, closing a leaf pane
   * that is a direct child of a SplitNode replaces that SplitNode with the sibling
   * child, reducing the total leaf count by exactly one.
   */
  it('closing a direct-child leaf reduces leaf count by one', () => {
    fc.assert(
      fc.property(arbTreeWithSplit(), (tree) => {
        const directChildLeaves = findDirectChildLeaves(tree);
        if (directChildLeaves.length === 0) return;

        const leafCountBefore = countLeaves(tree);
        // Pick the first direct child leaf
        const target = directChildLeaves[0];

        const result = removeLeaf(tree, target.paneId);

        if (leafCountBefore === 1) {
          // If there was only one leaf, result should be null
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          expect(countLeaves(result!)).toBe(leafCountBefore - 1);

          // The removed pane should no longer be in the tree
          const remainingPaneIds = collectLeafPaneIds(result!);
          expect(remainingPaneIds).not.toContain(target.paneId);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: terminal-tab-drag-split, Property 9: Find pane by session ID
describe('Feature: terminal-tab-drag-split, Property 9: Find pane by session ID', () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any valid LayoutNode tree and any session ID that exists in a leaf of that tree,
   * findPaneBySessionId returns the LeafPane whose sessionId matches, and for any
   * session ID not present in the tree, it returns null.
   */
  it('finds existing session IDs and returns null for missing ones', () => {
    fc.assert(
      fc.property(arbLayoutNode(3), (tree) => {
        const sessionIds = collectSessionIds(tree);
        if (sessionIds.length === 0) return;

        // Every session ID in the tree should be findable
        for (const sid of sessionIds) {
          const found = findLeafBySessionId(tree, sid);
          expect(found).not.toBeNull();
          expect(found!.sessionId).toBe(sid);
          expect(found!.type).toBe('leaf');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('returns null for session IDs not in the tree', () => {
    fc.assert(
      fc.property(arbLayoutNode(3), fc.uuid(), (tree, randomSessionId) => {
        const sessionIds = collectSessionIds(tree);
        // Only test if the random ID is not already in the tree
        fc.pre(!sessionIds.includes(randomSessionId));

        const found = findLeafBySessionId(tree, randomSessionId);
        expect(found).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
