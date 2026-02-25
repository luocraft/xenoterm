import type { LayoutNode, LeafPane, SplitNode, DropPosition } from '../../shared/types';

/**
 * Clamps a ratio value to the valid range [0.2, 0.8].
 */
export function clampRatio(ratio: number): number {
  return Math.min(0.8, Math.max(0.2, ratio));
}

/**
 * Finds a leaf node by its paneId.
 * Returns the LeafPane if found, or null otherwise.
 */
export function findLeaf(tree: LayoutNode, paneId: string): LeafPane | null {
  if (tree.type === 'leaf') {
    return tree.paneId === paneId ? tree : null;
  }
  return findLeaf(tree.first, paneId) ?? findLeaf(tree.second, paneId);
}

/**
 * Finds a leaf node by its sessionId.
 * Returns the LeafPane if found, or null otherwise.
 */
export function findLeafBySessionId(tree: LayoutNode, sessionId: string): LeafPane | null {
  if (tree.type === 'leaf') {
    return tree.sessionId === sessionId ? tree : null;
  }
  return findLeafBySessionId(tree.first, sessionId) ?? findLeafBySessionId(tree.second, sessionId);
}

/**
 * Collects all leaf panes from the tree.
 */
export function collectLeaves(tree: LayoutNode): LeafPane[] {
  if (tree.type === 'leaf') {
    return [tree];
  }
  return [...collectLeaves(tree.first), ...collectLeaves(tree.second)];
}

/**
 * Counts the total number of leaf nodes in the tree.
 */
export function countLeaves(tree: LayoutNode): number {
  if (tree.type === 'leaf') {
    return 1;
  }
  return countLeaves(tree.first) + countLeaves(tree.second);
}

/**
 * Collects all ratio values from SplitNodes in the tree.
 */
export function allRatios(tree: LayoutNode): number[] {
  if (tree.type === 'leaf') {
    return [];
  }
  return [tree.ratio, ...allRatios(tree.first), ...allRatios(tree.second)];
}

/**
 * Splits a leaf node identified by targetPaneId, creating a new SplitNode
 * containing the original leaf and a new leaf for the given session.
 *
 * - For 'left'/'right' drop positions: creates a horizontal split.
 * - For 'top'/'bottom' drop positions: creates a vertical split.
 * - For 'center': replaces the session ID in the target leaf (no structural change).
 * - For 'left'/'top': the new pane is the first child.
 * - For 'right'/'bottom': the new pane is the second child.
 * - Default ratio is 0.5.
 *
 * Returns a new tree (pure — never mutates the input).
 */
export function splitLeaf(
  tree: LayoutNode,
  targetPaneId: string,
  newSessionId: string,
  position: DropPosition
): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.paneId !== targetPaneId) {
      return tree;
    }

    // Center drop: replace session ID, no structural change
    if (position === 'center') {
      return { ...tree, sessionId: newSessionId };
    }

    const newLeaf: LeafPane = {
      type: 'leaf',
      paneId: crypto.randomUUID(),
      sessionId: newSessionId,
    };

    const direction: SplitNode['direction'] =
      position === 'left' || position === 'right' ? 'horizontal' : 'vertical';

    const newPaneFirst = position === 'left' || position === 'top';

    const split: SplitNode = {
      type: 'split',
      direction,
      ratio: 0.5,
      first: newPaneFirst ? newLeaf : tree,
      second: newPaneFirst ? tree : newLeaf,
    };

    return split;
  }

  // Recurse into split children
  return {
    ...tree,
    first: splitLeaf(tree.first, targetPaneId, newSessionId, position),
    second: splitLeaf(tree.second, targetPaneId, newSessionId, position),
  };
}

/**
 * Removes a leaf node identified by paneId from the tree.
 * The parent SplitNode is replaced by the sibling child.
 * Returns null if the removed leaf was the only leaf (root leaf).
 */
export function removeLeaf(tree: LayoutNode, paneId: string): LayoutNode | null {
  if (tree.type === 'leaf') {
    // If the root is the target leaf, return null (last pane removed)
    return tree.paneId === paneId ? null : tree;
  }

  // Check if either direct child is the target leaf
  if (tree.first.type === 'leaf' && tree.first.paneId === paneId) {
    return tree.second;
  }
  if (tree.second.type === 'leaf' && tree.second.paneId === paneId) {
    return tree.first;
  }

  // Recurse into children
  const newFirst = removeLeaf(tree.first, paneId);
  const newSecond = removeLeaf(tree.second, paneId);

  // If a child subtree collapsed (returned a different node), rebuild
  if (newFirst !== tree.first || newSecond !== tree.second) {
    // If either child became null, that shouldn't happen in a well-formed tree
    // (only the root leaf returns null), but handle defensively
    if (newFirst === null) return newSecond;
    if (newSecond === null) return newFirst;

    return {
      ...tree,
      first: newFirst,
      second: newSecond,
    };
  }

  return tree;
}

/**
 * Updates the ratio of a SplitNode at the given path in the tree.
 * Path is an array of 0/1 indices: 0 = first child, 1 = second child.
 * An empty path means update the current node's ratio (if it's a split).
 * The new ratio is clamped to [0.2, 0.8].
 *
 * Returns a new tree (pure — never mutates the input).
 * If the path is invalid (doesn't lead to a SplitNode), returns the tree unchanged.
 */
export function updateRatioAtPath(
  tree: LayoutNode,
  path: number[],
  newRatio: number
): LayoutNode {
  if (path.length === 0) {
    // We've reached the target node — update ratio if it's a split
    if (tree.type === 'split') {
      return { ...tree, ratio: clampRatio(newRatio) };
    }
    // Path leads to a leaf, not a split — silently ignore
    return tree;
  }

  if (tree.type === 'leaf') {
    // Can't navigate further into a leaf — invalid path, silently ignore
    return tree;
  }

  const [head, ...rest] = path;

  if (head === 0) {
    return { ...tree, first: updateRatioAtPath(tree.first, rest, newRatio) };
  } else if (head === 1) {
    return { ...tree, second: updateRatioAtPath(tree.second, rest, newRatio) };
  }

  // Invalid path index — silently ignore
  return tree;
}

/**
 * Replaces the sessionId of a leaf node identified by paneId.
 * Returns a new tree (pure — never mutates the input).
 */
export function replaceSession(
  tree: LayoutNode,
  paneId: string,
  newSessionId: string
): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.paneId === paneId) {
      return { ...tree, sessionId: newSessionId };
    }
    return tree;
  }

  return {
    ...tree,
    first: replaceSession(tree.first, paneId, newSessionId),
    second: replaceSession(tree.second, paneId, newSessionId),
  };
}

/**
 * Replaces all occurrences of oldSessionId with newSessionId in the tree,
 * also updating paneId to maintain the stable `pane-{sessionId}` convention.
 * Returns a new tree (pure — never mutates the input).
 */
export function replaceSessionId(
  tree: LayoutNode,
  oldSessionId: string,
  newSessionId: string
): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.sessionId === oldSessionId) {
      return { ...tree, sessionId: newSessionId, paneId: `pane-${newSessionId}` };
    }
    return tree;
  }

  return {
    ...tree,
    first: replaceSessionId(tree.first, oldSessionId, newSessionId),
    second: replaceSessionId(tree.second, oldSessionId, newSessionId),
  };
}
