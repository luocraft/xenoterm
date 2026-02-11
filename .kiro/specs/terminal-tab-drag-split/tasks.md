# Implementation Plan: Terminal Tab Drag-to-Split Layout

## Overview

Incrementally build the tiling layout system starting from the data model and store, then the recursive renderer, then drag-and-drop, then integration with existing session management. Each step builds on the previous and is validated by tests.

## Tasks

- [ ] 1. Define layout tree types and pure helper functions
  - [x] 1.1 Add `LayoutNode`, `LeafPane`, `SplitNode`, and `DropPosition` types to `src/shared/types.ts`
    - Define the discriminated union types as specified in the design
    - _Requirements: 1.1_
  - [ ] 1.2 Create `src/renderer/store/layout-tree-utils.ts` with pure tree manipulation functions
    - `clampRatio(ratio: number): number` — clamps to [0.2, 0.8]
    - `findLeaf(tree: LayoutNode, paneId: string): LeafPane | null` — find leaf by paneId
    - `findLeafBySessionId(tree: LayoutNode, sessionId: string): LeafPane | null` — find leaf by sessionId
    - `countLeaves(tree: LayoutNode): number` — count total leaves
    - `allRatios(tree: LayoutNode): number[]` — collect all ratios in the tree
    - `splitLeaf(tree: LayoutNode, targetPaneId: string, newSessionId: string, position: DropPosition): LayoutNode` — replace a leaf with a split containing the original and a new pane
    - `removeLeaf(tree: LayoutNode, paneId: string): LayoutNode | null` — remove a leaf and collapse its parent split
    - `updateRatioAtPath(tree: LayoutNode, path: number[], newRatio: number): LayoutNode` — update ratio at a specific path
    - `replaceSession(tree: LayoutNode, paneId: string, newSessionId: string): LayoutNode` — replace session ID in a leaf
    - _Requirements: 1.1, 1.3, 2.3, 2.4, 2.5, 2.6, 4.1, 5.1, 7.3_
  - [x] 1.3 Write property tests for layout tree utils
    - **Property 1: Tree structure invariant**
    - **Property 2: Serialization round-trip**
    - **Property 3: Ratio clamping invariant**
    - **Property 4: Split direction matches drop position**
    - **Property 5: Center drop replaces session**
    - **Property 6: Resize updates only the target split**
    - **Property 7: Close pane collapses parent split**
    - **Property 9: Find pane by session ID**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 5.1, 7.3**

- [ ] 2. Implement layout store slice
  - [x] 2.1 Create `src/renderer/store/layout-store.ts` with Zustand layout state and actions
    - State: `layoutTree: LayoutNode | null`, `activePaneId: string | null`
    - Actions: `initLayout`, `splitPane`, `closePane`, `resizeSplit`, `setActivePaneId`, `findPaneBySessionId`, `replaceSessionInPane`
    - All actions delegate to pure functions from `layout-tree-utils.ts`
    - _Requirements: 1.1, 1.3, 2.3, 2.4, 2.5, 2.6, 4.1, 5.1, 7.1_
  - [x] 2.2 Write unit tests for layout store actions
    - Test `initLayout` creates a single leaf
    - Test `splitPane` with specific tree and drop positions
    - Test `closePane` collapsing and last-pane edge case
    - Test `resizeSplit` with boundary values
    - **Property 8: New session adds leaf to tree**
    - **Validates: Requirements 1.1, 5.1, 5.2, 7.1**

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Build the recursive tiling renderer
  - [x] 4.1 Create `src/renderer/components/PaneDivider.tsx`
    - Thin draggable bar between split children
    - Supports both horizontal (col-resize) and vertical (row-resize) directions
    - Calls `resizeSplit` on drag with computed ratio
    - _Requirements: 3.5, 4.1, 4.3_
  - [x] 4.2 Create `src/renderer/components/LeafPaneWrapper.tsx`
    - Wraps `TerminalView` with click-to-focus handler and active pane border highlight
    - Sets `activePaneId` on click
    - Renders active border when `paneId === activePaneId`
    - _Requirements: 6.1, 6.2_
  - [x] 4.3 Create `src/renderer/components/TilingLayout.tsx`
    - Recursive component: renders `LeafPaneWrapper` for leaf nodes, two `TilingLayout` children + `PaneDivider` for split nodes
    - Uses CSS flexbox with `flex-basis` set by split ratio
    - Accepts `node` and `path` props
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 5. Implement drag-and-drop for tab splitting
  - [x] 5.1 Create `src/renderer/components/DropZoneOverlay.tsx`
    - Overlay shown inside `LeafPaneWrapper` during drag-over
    - Divides pane into 5 zones (left, right, top, bottom, center)
    - Highlights active zone based on cursor position
    - On drop, calls `splitPane` or `replaceSessionInPane`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 5.2 Update `src/renderer/components/TabBar.tsx` to support tab dragging
    - Add `draggable` attribute to tab elements
    - Set `dataTransfer.setData('text/session-id', sessionId)` on drag start
    - Preserve existing click-to-switch behavior
    - _Requirements: 2.1_
  - [x] 5.3 Integrate `DropZoneOverlay` into `LeafPaneWrapper`
    - Show overlay when a drag enters the pane, hide on drag leave
    - Wire drop handler to layout store actions
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

- [x] 6. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Integrate with App.tsx and session management
  - [x] 7.1 Update `src/renderer/App.tsx` to use `TilingLayout`
    - Replace single `TerminalView` with `TilingLayout` rendering `layoutTree`
    - Show welcome screen when `layoutTree` is null
    - Keep file manager split below the tiling area (existing behavior)
    - _Requirements: 3.1, 8.1, 8.2, 8.3_
  - [x] 7.2 Wire session connect/disconnect to layout store
    - On new session connect: call `initLayout` if tree is null, or add pane to existing tree
    - On session disconnect/remove: call `closePane` for the pane holding that session, call `disposeTerminal`
    - Sync `activePaneId` ↔ `activeSessionId`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 5.3_
  - [x] 7.3 Update `TabBar` click behavior to set active pane
    - When a tab is clicked, find the pane with that session ID and set it as active
    - Highlight the tab matching the active pane's session
    - _Requirements: 6.3, 7.3_

- [x] 8. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including tests are required
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties using `fast-check`
- The existing `TerminalView` component and its caching mechanism are not modified
- The existing `SplitPane.tsx` component is not reused for terminal tiling (it remains for file manager split)
