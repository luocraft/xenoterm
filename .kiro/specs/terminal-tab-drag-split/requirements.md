# Requirements Document

## Introduction

This feature transforms the current single-terminal view in the SSH client desktop app into a tiling/split layout system. Users can drag terminal tabs to create side-by-side (horizontal) or stacked (vertical) split layouts, enabling multiple SSH terminals to be visible and functional simultaneously. The layout is modeled as a recursive binary split tree, where each leaf is a terminal pane and each internal node is a split (horizontal or vertical) with a draggable divider.

## Glossary

- **Layout_Tree**: A recursive binary tree data structure representing the arrangement of terminal panes. Each node is either a Leaf_Pane or a Split_Node.
- **Leaf_Pane**: A terminal node in the Layout_Tree that holds a reference to a single SSH session and renders a TerminalView.
- **Split_Node**: An internal node in the Layout_Tree that divides its area into two children (first and second) along a specified direction, with a configurable ratio.
- **Split_Direction**: The axis along which a Split_Node divides its area — either "horizontal" (left/right children) or "vertical" (top/bottom children).
- **Split_Ratio**: A number between 0.2 and 0.8 representing the proportion of space allocated to the first child of a Split_Node.
- **Drop_Zone**: A visual indicator region (left, right, top, bottom, or center) displayed during a tab drag operation, showing where a new pane will be created.
- **Pane_Id**: A unique string identifier assigned to each Leaf_Pane in the Layout_Tree.
- **Active_Pane**: The Leaf_Pane that currently has keyboard focus and is highlighted in the UI.
- **Tab_Drag**: The user action of clicking and dragging a session tab from the TabBar toward a Drop_Zone to create a split layout.
- **Layout_Store**: The Zustand state slice that holds the Layout_Tree and provides actions for manipulating it.

## Requirements

### Requirement 1: Layout Tree Data Model

**User Story:** As a developer, I want a recursive tree data structure to represent terminal pane arrangements, so that the app can support arbitrarily nested split layouts.

#### Acceptance Criteria

1. THE Layout_Store SHALL represent the layout as a Layout_Tree where each node is either a Leaf_Pane (containing a session ID and Pane_Id) or a Split_Node (containing a Split_Direction, Split_Ratio, and two child nodes).
2. WHEN the Layout_Tree is serialized to JSON and then deserialized, THE Layout_Store SHALL produce a Layout_Tree equivalent to the original (round-trip property).
3. THE Layout_Store SHALL enforce that every Split_Ratio value is clamped between 0.2 and 0.8 inclusive.

### Requirement 2: Tab Drag to Create Split

**User Story:** As a user, I want to drag a terminal tab toward the edge of the terminal area to create a split layout, so that I can view multiple terminals simultaneously.

#### Acceptance Criteria

1. WHEN a user initiates a Tab_Drag on a session tab, THE TabBar SHALL begin a drag operation carrying the session ID as drag data.
2. WHEN a Tab_Drag enters the terminal content area, THE Drop_Zone indicators SHALL appear showing available split positions (left, right, top, bottom).
3. WHEN a user drops a tab on a left or right Drop_Zone, THE Layout_Store SHALL create a Split_Node with Split_Direction "horizontal" containing the existing pane and the dragged session as children.
4. WHEN a user drops a tab on a top or bottom Drop_Zone, THE Layout_Store SHALL create a Split_Node with Split_Direction "vertical" containing the existing pane and the dragged session as children.
5. WHEN a user drops a tab on the center Drop_Zone of a pane, THE Layout_Store SHALL replace that pane's session ID with the dragged session ID.
6. WHEN a split is created, THE Layout_Store SHALL assign the new Split_Node a default Split_Ratio of 0.5.

### Requirement 3: Layout Tree Rendering

**User Story:** As a user, I want the terminal area to render the Layout_Tree recursively, so that I can see all my terminal sessions arranged according to the split layout.

#### Acceptance Criteria

1. WHEN the Layout_Tree contains a single Leaf_Pane, THE Renderer SHALL display one TerminalView filling the entire content area.
2. WHEN the Layout_Tree contains a Split_Node, THE Renderer SHALL divide the available space according to the Split_Direction and Split_Ratio, rendering each child recursively.
3. WHEN a Split_Node has Split_Direction "horizontal", THE Renderer SHALL place the first child on the left and the second child on the right.
4. WHEN a Split_Node has Split_Direction "vertical", THE Renderer SHALL place the first child on the top and the second child on the bottom.
5. THE Renderer SHALL render a draggable divider between the two children of every Split_Node.

### Requirement 4: Divider Resizing

**User Story:** As a user, I want to drag the divider between split panes to resize them, so that I can allocate more space to the terminal I am focusing on.

#### Acceptance Criteria

1. WHEN a user drags a divider in a Split_Node, THE Layout_Store SHALL update the Split_Ratio of that Split_Node based on the mouse position relative to the Split_Node's bounds.
2. THE Layout_Store SHALL clamp the updated Split_Ratio between 0.2 and 0.8 so that neither child pane becomes too small.
3. WHEN the divider is being dragged, THE Renderer SHALL update the pane sizes in real time.

### Requirement 5: Pane Closing and Layout Collapse

**User Story:** As a user, I want to close a terminal pane and have the layout automatically simplify, so that empty splits do not waste screen space.

#### Acceptance Criteria

1. WHEN a user closes a Leaf_Pane that is a child of a Split_Node, THE Layout_Store SHALL replace that Split_Node with the remaining child node.
2. WHEN the last Leaf_Pane in the Layout_Tree is closed, THE Layout_Store SHALL set the Layout_Tree to an empty state and the app SHALL display the welcome screen.
3. WHEN a pane is closed, THE Layout_Store SHALL dispose of the terminal instance associated with that pane's session.

### Requirement 6: Active Pane Focus

**User Story:** As a user, I want to click on a terminal pane to make it the active pane, so that keyboard input is directed to the correct terminal.

#### Acceptance Criteria

1. WHEN a user clicks inside a Leaf_Pane, THE Layout_Store SHALL set that pane as the Active_Pane.
2. WHILE a Leaf_Pane is the Active_Pane, THE Renderer SHALL display a visible border highlight on that pane.
3. WHEN the Active_Pane changes, THE TabBar SHALL highlight the tab corresponding to the Active_Pane's session ID.

### Requirement 7: Integration with Existing Session Management

**User Story:** As a user, I want the split layout to work seamlessly with the existing session and tab management, so that connecting, disconnecting, and switching sessions behaves consistently.

#### Acceptance Criteria

1. WHEN a new SSH session is connected, THE Layout_Store SHALL add a new Leaf_Pane for that session to the Layout_Tree (either replacing an empty layout or adding to the existing tree).
2. WHEN a session is disconnected or removed, THE Layout_Store SHALL close the corresponding Leaf_Pane and collapse the layout as specified in Requirement 5.
3. WHEN a user clicks a tab in the TabBar (without dragging), THE Layout_Store SHALL set the Active_Pane to the pane containing that session, or focus an existing pane if the session is already visible.
4. THE Layout_Store SHALL preserve the existing terminal caching mechanism so that terminals survive layout changes without losing state.

### Requirement 8: Compatibility with File Manager Split

**User Story:** As a user, I want the terminal tiling layout to coexist with the existing file manager split pane, so that I can use both features together.

#### Acceptance Criteria

1. WHEN the file manager split pane is toggled on, THE Renderer SHALL display the Layout_Tree in the top portion and the file manager in the bottom portion, using the existing vertical split mechanism.
2. WHEN the file manager split pane is toggled off, THE Layout_Tree SHALL occupy the full content area.
3. THE terminal tiling layout SHALL NOT interfere with the file manager split pane's divider or resize behavior.
