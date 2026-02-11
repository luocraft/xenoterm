import { create } from 'zustand';
import type { LayoutNode, LeafPane, DropPosition, Workspace, TabItem } from '../../shared/types';
import {
  splitLeaf,
  removeLeaf,
  updateRatioAtPath,
  replaceSession,
  findLeafBySessionId,
  collectLeaves,
} from './layout-tree-utils';

export interface LayoutStoreSlice {
  // State
  layoutTree: LayoutNode | null;
  activePaneId: string | null;

  // Workspace state
  workspaces: Workspace[];
  /** Ordered list of tabs: independent sessions + workspaces */
  tabs: TabItem[];
  /** Currently active tab identifier (sessionId or workspaceId) */
  activeTabId: string | null;

  // Actions
  initLayout: (sessionId: string) => void;
  splitPane: (targetPaneId: string, sessionId: string, position: DropPosition) => void;
  closePane: (paneId: string) => void;
  resizeSplit: (splitPath: number[], ratio: number) => void;
  setActivePaneId: (paneId: string) => void;
  findPaneBySessionId: (sessionId: string) => LeafPane | null;
  replaceSessionInPane: (paneId: string, newSessionId: string) => void;

  // Workspace actions
  addSessionTab: (sessionId: string) => void;
  removeSessionTab: (sessionId: string) => void;
  setActiveTab: (tabId: string) => void;
  mergeIntoWorkspace: (sessionIdA: string, sessionIdB: string, position: DropPosition) => void;
  addToWorkspace: (workspaceId: string, sessionId: string, targetPaneId: string, position: DropPosition) => void;
  removeFromWorkspace: (workspaceId: string, sessionId: string) => void;
  getActiveWorkspace: () => Workspace | null;
  switchToTab: (tabId: string) => void;
}

/**
 * Returns the first leaf pane found in the tree (depth-first, left-first).
 */
function getFirstLeaf(node: LayoutNode): LeafPane {
  if (node.type === 'leaf') {
    return node;
  }
  return getFirstLeaf(node.first);
}

export const useLayoutStore = create<LayoutStoreSlice>((set, get) => ({
  // Initial state
  layoutTree: null,
  activePaneId: null,
  workspaces: [],
  tabs: [],
  activeTabId: null,

  initLayout: (sessionId: string) => {
    const { layoutTree } = get();
    if (layoutTree !== null) return;
    // Use stable paneId derived from sessionId
    const paneId = `pane-${sessionId}`;
    const leaf: LeafPane = { type: 'leaf', paneId, sessionId };
    set({ layoutTree: leaf, activePaneId: paneId });
  },

  splitPane: (targetPaneId: string, sessionId: string, position: DropPosition) => {
    const { layoutTree } = get();
    if (layoutTree === null) return;
    const newTree = splitLeaf(layoutTree, targetPaneId, sessionId, position);
    set({ layoutTree: newTree });
  },

  closePane: (paneId: string) => {
    const { layoutTree, activePaneId } = get();
    if (layoutTree === null) return;
    const result = removeLeaf(layoutTree, paneId);
    if (result === null) {
      set({ layoutTree: null, activePaneId: null });
    } else {
      const newActivePaneId =
        activePaneId === paneId ? getFirstLeaf(result).paneId : activePaneId;
      set({ layoutTree: result, activePaneId: newActivePaneId });
    }
  },

  resizeSplit: (splitPath: number[], ratio: number) => {
    const { layoutTree } = get();
    if (layoutTree === null) return;
    const newTree = updateRatioAtPath(layoutTree, splitPath, ratio);
    set({ layoutTree: newTree });
  },

  setActivePaneId: (paneId: string) => {
    set({ activePaneId: paneId });
  },

  findPaneBySessionId: (sessionId: string) => {
    const { layoutTree } = get();
    if (layoutTree === null) return null;
    return findLeafBySessionId(layoutTree, sessionId);
  },

  replaceSessionInPane: (paneId: string, newSessionId: string) => {
    const { layoutTree } = get();
    if (layoutTree === null) return;
    const newTree = replaceSession(layoutTree, paneId, newSessionId);
    set({ layoutTree: newTree });
  },

  // --- Workspace / Tab actions ---

  addSessionTab: (sessionId: string) => {
    const { tabs, activeTabId } = get();
    // Don't add if already exists as independent tab
    const exists = tabs.some(
      (t) => t.type === 'session' && t.sessionId === sessionId
    );
    if (exists) return;
    // Also don't add if it's already inside a workspace
    const inWorkspace = get().workspaces.some((w) =>
      w.sessionIds.includes(sessionId)
    );
    if (inWorkspace) return;

    // Insert after the currently active tab
    const activeIndex = tabs.findIndex((t) =>
      (t.type === 'session' && t.sessionId === activeTabId) ||
      (t.type === 'workspace' && t.workspaceId === activeTabId)
    );
    const newTabs = [...tabs];
    const insertAt = activeIndex >= 0 ? activeIndex + 1 : newTabs.length;
    newTabs.splice(insertAt, 0, { type: 'session', sessionId });

    set({
      tabs: newTabs,
      activeTabId: sessionId,
    });
  },

  removeSessionTab: (sessionId: string) => {
    const state = get();
    // Remove from independent tabs
    let newTabs = state.tabs.filter(
      (t) => !(t.type === 'session' && t.sessionId === sessionId)
    );

    // Also remove from any workspace
    let newWorkspaces = state.workspaces.map((w) => {
      if (!w.sessionIds.includes(sessionId)) return w;
      const newSessionIds = w.sessionIds.filter((id) => id !== sessionId);
      // Remove the pane from workspace layout
      const pane = findLeafBySessionId(w.layoutTree, sessionId);
      let newLayout: LayoutNode | null = w.layoutTree;
      if (pane) {
        newLayout = removeLeaf(w.layoutTree, pane.paneId);
      }
      return {
        ...w,
        sessionIds: newSessionIds,
        layoutTree: newLayout!,
      };
    });

    // Remove workspaces that have 0 or 1 sessions left
    const dissolvedSessions: string[] = [];
    newWorkspaces = newWorkspaces.filter((w) => {
      if (w.sessionIds.length <= 1) {
        // Dissolve: put remaining session back as independent tab
        if (w.sessionIds.length === 1) {
          dissolvedSessions.push(w.sessionIds[0]);
        }
        newTabs = newTabs.filter(
          (t) => !(t.type === 'workspace' && t.workspaceId === w.id)
        );
        return false;
      }
      return true;
    });

    // Add dissolved sessions back as independent tabs
    for (const sid of dissolvedSessions) {
      if (!newTabs.some((t) => t.type === 'session' && t.sessionId === sid)) {
        newTabs.push({ type: 'session', sessionId: sid });
      }
    }

    // Pick new active tab
    let newActiveTabId = state.activeTabId;
    if (newActiveTabId === sessionId) {
      // Was viewing this session directly
      newActiveTabId = newTabs.length > 0
        ? (newTabs[newTabs.length - 1].type === 'session'
          ? newTabs[newTabs.length - 1].sessionId
          : (newTabs[newTabs.length - 1] as { type: 'workspace'; workspaceId: string }).workspaceId)
        : null;
    }
    // Check if activeTabId was a workspace that got dissolved
    const wsTab = state.workspaces.find((w) => w.id === newActiveTabId);
    if (wsTab && !newWorkspaces.some((w) => w.id === wsTab.id)) {
      // Workspace was dissolved
      if (dissolvedSessions.length > 0) {
        newActiveTabId = dissolvedSessions[0];
      } else if (newTabs.length > 0) {
        const last = newTabs[newTabs.length - 1];
        newActiveTabId = last.type === 'session' ? last.sessionId : last.workspaceId;
      } else {
        newActiveTabId = null;
      }
    }

    // Sync the global layoutTree if the active tab is a workspace that was modified
    let newLayoutTree = state.layoutTree;
    let newActivePaneId = state.activePaneId;
    const activeWs = newWorkspaces.find((w) => w.id === newActiveTabId);
    if (activeWs) {
      // Active tab is a workspace that still exists — sync its layout to global
      newLayoutTree = activeWs.layoutTree;
      // If the active pane was removed, pick the first leaf
      const leaves = collectLeaves(newLayoutTree);
      if (!leaves.some((l) => l.paneId === newActivePaneId)) {
        newActivePaneId = getFirstLeaf(newLayoutTree).paneId;
      }
    } else if (newActiveTabId) {
      // Active tab is a dissolved workspace or independent session
      const sessionTab = newTabs.find(
        (t) => t.type === 'session' && t.sessionId === newActiveTabId
      );
      if (sessionTab && sessionTab.type === 'session') {
        const stablePaneId = `pane-${sessionTab.sessionId}`;
        newLayoutTree = { type: 'leaf', paneId: stablePaneId, sessionId: sessionTab.sessionId };
        newActivePaneId = stablePaneId;
      }
    } else {
      newLayoutTree = null;
      newActivePaneId = null;
    }

    set({
      tabs: newTabs,
      workspaces: newWorkspaces,
      activeTabId: newActiveTabId,
      layoutTree: newLayoutTree,
      activePaneId: newActivePaneId,
    });
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId });
  },

  switchToTab: (tabId: string) => {
    const state = get();
    // Find the workspace or session and set up layoutTree + activePaneId
    const ws = state.workspaces.find((w) => w.id === tabId);
    if (ws) {
      // Switching to a workspace tab
      const firstLeaf = getFirstLeaf(ws.layoutTree);
      set({
        activeTabId: tabId,
        layoutTree: ws.layoutTree,
        activePaneId: firstLeaf.paneId,
      });
      return;
    }
    // Independent session tab
    const tab = state.tabs.find(
      (t) => t.type === 'session' && t.sessionId === tabId
    );
    if (tab && tab.type === 'session') {
      // IMPORTANT: Use a stable paneId derived from sessionId to prevent unmount/remount
      // This ensures the same React key is used, preserving the terminal instance
      const stablePaneId = `pane-${tab.sessionId}`;
      const leaf: LeafPane = { type: 'leaf', paneId: stablePaneId, sessionId: tab.sessionId };
      set({
        activeTabId: tabId,
        layoutTree: leaf,
        activePaneId: stablePaneId,
      });
    }
  },

  mergeIntoWorkspace: (
    sessionIdA: string,
    sessionIdB: string,
    position: DropPosition
  ) => {
    const state = get();

    // Check if either session is already in a workspace
    const wsA = state.workspaces.find((w) => w.sessionIds.includes(sessionIdA));
    const wsB = state.workspaces.find((w) => w.sessionIds.includes(sessionIdB));

    if (wsA && wsB && wsA.id === wsB.id) {
      // Both in same workspace — just rearrange within workspace (split)
      return;
    }

    if (wsA) {
      // sessionA is in a workspace, add sessionB to it
      get().addToWorkspace(wsA.id, sessionIdB, '', position);
      return;
    }

    if (wsB) {
      // sessionB is in a workspace, add sessionA to it
      get().addToWorkspace(wsB.id, sessionIdA, '', position);
      return;
    }

    // Neither is in a workspace — create a new one
    // Try to reuse existing paneId for sessionA (the current pane) to avoid unmount/remount
    const existingLeafA = state.layoutTree
      ? findLeafBySessionId(state.layoutTree, sessionIdA)
      : null;
    const paneIdA = existingLeafA ? existingLeafA.paneId : crypto.randomUUID();
    const paneIdB = crypto.randomUUID();
    const leafA: LeafPane = { type: 'leaf', paneId: paneIdA, sessionId: sessionIdA };
    const leafB: LeafPane = { type: 'leaf', paneId: paneIdB, sessionId: sessionIdB };

    const direction = (position === 'left' || position === 'right') ? 'horizontal' as const : 'vertical' as const;
    const newPaneFirst = position === 'left' || position === 'top';

    const wsLayout: LayoutNode = {
      type: 'split',
      direction,
      ratio: 0.5,
      first: newPaneFirst ? leafB : leafA,
      second: newPaneFirst ? leafA : leafB,
    };

    const wsId = crypto.randomUUID();
    const workspace: Workspace = {
      id: wsId,
      name: 'Workspace',
      sessionIds: [sessionIdA, sessionIdB],
      layoutTree: wsLayout,
    };

    // Remove both sessions from independent tabs, add workspace tab
    const newTabs = state.tabs
      .filter((t) => !(t.type === 'session' && (t.sessionId === sessionIdA || t.sessionId === sessionIdB)))
      .concat([{ type: 'workspace', workspaceId: wsId }]);

    set({
      workspaces: [...state.workspaces, workspace],
      tabs: newTabs,
      activeTabId: wsId,
      layoutTree: wsLayout,
      activePaneId: getFirstLeaf(wsLayout).paneId,
    });
  },

  addToWorkspace: (
    workspaceId: string,
    sessionId: string,
    targetPaneId: string,
    position: DropPosition
  ) => {
    const state = get();
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    if (ws.sessionIds.includes(sessionId)) return;

    let newLayout: LayoutNode;
    if (targetPaneId && position !== 'center') {
      newLayout = splitLeaf(ws.layoutTree, targetPaneId, sessionId, position);
    } else {
      // No specific target — split the first leaf
      const firstLeaf = getFirstLeaf(ws.layoutTree);
      newLayout = splitLeaf(ws.layoutTree, firstLeaf.paneId, sessionId, position === 'center' ? 'right' : position);
    }

    const updatedWs: Workspace = {
      ...ws,
      sessionIds: [...ws.sessionIds, sessionId],
      layoutTree: newLayout,
    };

    // Remove session from independent tabs
    const newTabs = state.tabs.filter(
      (t) => !(t.type === 'session' && t.sessionId === sessionId)
    );

    const newWorkspaces = state.workspaces.map((w) =>
      w.id === workspaceId ? updatedWs : w
    );

    set({
      workspaces: newWorkspaces,
      tabs: newTabs,
      activeTabId: workspaceId,
      layoutTree: newLayout,
      activePaneId: getFirstLeaf(newLayout).paneId,
    });
  },

  removeFromWorkspace: (workspaceId: string, sessionId: string) => {
    const state = get();
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    if (!ws.sessionIds.includes(sessionId)) return;

    const newSessionIds = ws.sessionIds.filter((id) => id !== sessionId);

    // Remove the pane from workspace layout
    const pane = findLeafBySessionId(ws.layoutTree, sessionId);
    let newLayout: LayoutNode | null = ws.layoutTree;
    if (pane) {
      newLayout = removeLeaf(ws.layoutTree, pane.paneId);
    }

    if (newSessionIds.length <= 1) {
      // Dissolve workspace: put remaining session(s) back as independent tabs
      let newTabs = state.tabs.filter(
        (t) => !(t.type === 'workspace' && t.workspaceId === workspaceId)
      );
      const newWorkspaces = state.workspaces.filter((w) => w.id !== workspaceId);

      // Add remaining session back as independent tab
      for (const sid of newSessionIds) {
        if (!newTabs.some((t) => t.type === 'session' && t.sessionId === sid)) {
          newTabs.push({ type: 'session', sessionId: sid });
        }
      }
      // Add the extracted session as independent tab
      if (!newTabs.some((t) => t.type === 'session' && t.sessionId === sessionId)) {
        newTabs.push({ type: 'session', sessionId });
      }

      // Switch to the extracted session with stable paneId
      const extractedLeaf: LeafPane = { type: 'leaf', paneId: `pane-${sessionId}`, sessionId };
      set({
        workspaces: newWorkspaces,
        tabs: newTabs,
        activeTabId: sessionId,
        layoutTree: extractedLeaf,
        activePaneId: extractedLeaf.paneId,
      });
    } else {
      // Workspace still has 2+ sessions
      const updatedWs: Workspace = {
        ...ws,
        sessionIds: newSessionIds,
        layoutTree: newLayout!,
      };
      const newWorkspaces = state.workspaces.map((w) =>
        w.id === workspaceId ? updatedWs : w
      );

      // Add extracted session as independent tab
      let newTabs = [...state.tabs];
      if (!newTabs.some((t) => t.type === 'session' && t.sessionId === sessionId)) {
        newTabs.push({ type: 'session', sessionId });
      }

      // Switch to the extracted session with stable paneId
      const extractedLeaf: LeafPane = { type: 'leaf', paneId: `pane-${sessionId}`, sessionId };
      set({
        workspaces: newWorkspaces,
        tabs: newTabs,
        activeTabId: sessionId,
        layoutTree: extractedLeaf,
        activePaneId: extractedLeaf.paneId,
      });
    }
  },

  getActiveWorkspace: () => {
    const { activeTabId, workspaces } = get();
    return workspaces.find((w) => w.id === activeTabId) || null;
  },
}));
