import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import type { LayoutNode, LeafPane, SplitNode } from '../../../shared/types';
import { useLayoutStore } from '../layout-store';
import { countLeaves, findLeafBySessionId } from '../layout-tree-utils';

// ===== Mock crypto.randomUUID =====
beforeAll(() => {
  let counter = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `mock-uuid-${++counter}`,
  });
});

// ===== Reset store state between tests =====
beforeEach(() => {
  useLayoutStore.setState({ layoutTree: null, activePaneId: null });
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

/** Generates a split direction */
const arbDirection: fc.Arbitrary<'horizontal' | 'vertical'> = fc.constantFrom(
  'horizontal' as const,
  'vertical' as const
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

/** Collects all leaf paneIds from a tree */
function collectLeafPaneIds(node: LayoutNode): string[] {
  if (node.type === 'leaf') {
    return [node.paneId];
  }
  return [...collectLeafPaneIds(node.first), ...collectLeafPaneIds(node.second)];
}

// ===== Property Tests =====

// Feature: terminal-tab-drag-split, Property 8: New session adds leaf to tree
describe('Feature: terminal-tab-drag-split, Property 8: New session adds leaf to tree', () => {
  /**
   * **Validates: Requirements 7.1**
   *
   * For any valid LayoutNode tree (or null tree) and a new session ID, adding the
   * session to the layout results in a tree that contains a LeafPane with that
   * session ID, and the total leaf count increases by one (or becomes one if the
   * tree was null).
   */
  it('adding a session to a null tree creates a single leaf with that session', () => {
    fc.assert(
      fc.property(fc.uuid(), (newSessionId) => {
        // Reset store to null tree
        useLayoutStore.setState({ layoutTree: null, activePaneId: null });

        useLayoutStore.getState().initLayout(newSessionId);

        const { layoutTree } = useLayoutStore.getState();
        expect(layoutTree).not.toBeNull();
        expect(countLeaves(layoutTree!)).toBe(1);

        const found = findLeafBySessionId(layoutTree!, newSessionId);
        expect(found).not.toBeNull();
        expect(found!.sessionId).toBe(newSessionId);
      }),
      { numRuns: 100 }
    );
  });

  it('adding a session to an existing tree increases leaf count by one', () => {
    fc.assert(
      fc.property(arbLayoutNode(2), fc.uuid(), (tree, newSessionId) => {
        // Set up the store with the generated tree
        const paneIds = collectLeafPaneIds(tree);
        if (paneIds.length === 0) return;

        const targetPaneId = paneIds[0];
        useLayoutStore.setState({ layoutTree: tree, activePaneId: targetPaneId });

        const leafCountBefore = countLeaves(tree);

        // Add a new session via splitPane (since initLayout is a no-op when tree exists)
        useLayoutStore.getState().splitPane(targetPaneId, newSessionId, 'right');

        const { layoutTree } = useLayoutStore.getState();
        expect(layoutTree).not.toBeNull();
        expect(countLeaves(layoutTree!)).toBe(leafCountBefore + 1);

        const found = findLeafBySessionId(layoutTree!, newSessionId);
        expect(found).not.toBeNull();
        expect(found!.sessionId).toBe(newSessionId);
      }),
      { numRuns: 100 }
    );
  });
});
