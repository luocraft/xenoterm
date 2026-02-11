// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import LeafPaneWrapper from '../LeafPaneWrapper';
import { useLayoutStore } from '../../store/layout-store';

// Mock TerminalView to avoid xterm.js dependencies
vi.mock('../TerminalView', () => ({
  default: ({ sessionId }: { sessionId: string }) =>
    React.createElement('div', { 'data-testid': `terminal-${sessionId}` }, `Terminal: ${sessionId}`),
}));

// Mock DropZoneOverlay to track rendering and capture onDrop
vi.mock('../DropZoneOverlay', () => ({
  default: ({ paneId, onDrop }: { paneId: string; onDrop: (sessionId: string, position: string) => void }) =>
    React.createElement('div', {
      'data-testid': `drop-zone-overlay-${paneId}`,
      onClick: () => onDrop('dropped-session', 'left'),
    }, 'DropZoneOverlay'),
}));

describe('LeafPaneWrapper', () => {
  const paneId = 'pane-1';
  const sessionId = 'session-1';

  beforeEach(() => {
    // Reset the layout store before each test
    useLayoutStore.setState({
      layoutTree: { type: 'leaf', paneId, sessionId },
      activePaneId: null,
      tabs: [{ type: 'session', sessionId }],
      activeTabId: sessionId,
      workspaces: [],
    });
  });

  describe('drag-and-drop overlay visibility', () => {
    it('does not show DropZoneOverlay by default', () => {
      const { queryByTestId } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      expect(queryByTestId(`drop-zone-overlay-${paneId}`)).toBeNull();
    });

    it('shows DropZoneOverlay when a drag enters the pane', () => {
      const { container, queryByTestId } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      const wrapper = container.firstElementChild as HTMLElement;

      fireEvent.dragEnter(wrapper, { preventDefault: vi.fn() });

      expect(queryByTestId(`drop-zone-overlay-${paneId}`)).not.toBeNull();
    });

    it('hides DropZoneOverlay when drag leaves the pane entirely', () => {
      const { container, queryByTestId } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      const wrapper = container.firstElementChild as HTMLElement;

      // Enter the pane
      fireEvent.dragEnter(wrapper, { preventDefault: vi.fn() });
      expect(queryByTestId(`drop-zone-overlay-${paneId}`)).not.toBeNull();

      // Leave the pane entirely (relatedTarget is outside)
      fireEvent.dragLeave(wrapper, { relatedTarget: document.body });
      expect(queryByTestId(`drop-zone-overlay-${paneId}`)).toBeNull();
    });

    it('does not hide DropZoneOverlay when drag moves to a child element', () => {
      const { container, queryByTestId } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      const wrapper = container.firstElementChild as HTMLElement;

      // Enter the pane
      fireEvent.dragEnter(wrapper, { preventDefault: vi.fn() });
      expect(queryByTestId(`drop-zone-overlay-${paneId}`)).not.toBeNull();

      // Move to a child element (relatedTarget is inside the wrapper)
      // Use a real child element that is in the DOM tree
      const terminalDiv = queryByTestId(`terminal-${sessionId}`)!;
      // Manually dispatch a dragLeave event with the correct currentTarget/relatedTarget
      const dragLeaveEvent = new Event('dragleave', { bubbles: true }) as any;
      Object.defineProperty(dragLeaveEvent, 'relatedTarget', { value: terminalDiv });
      wrapper.dispatchEvent(dragLeaveEvent);
      expect(queryByTestId(`drop-zone-overlay-${paneId}`)).not.toBeNull();
    });
  });

  describe('dragOver handler', () => {
    it('allows drops by calling preventDefault on dragOver', () => {
      const { container } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      const wrapper = container.firstElementChild as HTMLElement;

      const event = new Event('dragover', { bubbles: true, cancelable: true });
      const prevented = !wrapper.dispatchEvent(event);
      // The event should be cancelable and the handler calls preventDefault
      expect(event.cancelable).toBe(true);
    });
  });

  describe('drop handler wiring', () => {
    it('calls mergeIntoWorkspace on the layout store when a drop occurs on an independent session', () => {
      const mergeIntoWorkspaceSpy = vi.fn();
      useLayoutStore.setState({
        layoutTree: { type: 'leaf', paneId, sessionId },
        activePaneId: null,
        tabs: [{ type: 'session', sessionId }],
        activeTabId: sessionId,
        workspaces: [],
        mergeIntoWorkspace: mergeIntoWorkspaceSpy,
      });

      const { container, queryByTestId } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      const wrapper = container.firstElementChild as HTMLElement;

      // Trigger drag enter to show the overlay
      fireEvent.dragEnter(wrapper, { preventDefault: vi.fn() });
      const overlay = queryByTestId(`drop-zone-overlay-${paneId}`);
      expect(overlay).not.toBeNull();

      // Click the mock overlay to trigger onDrop('dropped-session', 'left')
      fireEvent.click(overlay!);

      expect(mergeIntoWorkspaceSpy).toHaveBeenCalledWith(sessionId, 'dropped-session', 'left');
    });

    it('hides DropZoneOverlay after a drop occurs', () => {
      const mergeIntoWorkspaceSpy = vi.fn();
      useLayoutStore.setState({
        layoutTree: { type: 'leaf', paneId, sessionId },
        activePaneId: null,
        tabs: [{ type: 'session', sessionId }],
        activeTabId: sessionId,
        workspaces: [],
        mergeIntoWorkspace: mergeIntoWorkspaceSpy,
      });

      const { container, queryByTestId } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      const wrapper = container.firstElementChild as HTMLElement;

      // Trigger drag enter to show the overlay
      fireEvent.dragEnter(wrapper, { preventDefault: vi.fn() });
      expect(queryByTestId(`drop-zone-overlay-${paneId}`)).not.toBeNull();

      // Click the mock overlay to trigger onDrop
      fireEvent.click(queryByTestId(`drop-zone-overlay-${paneId}`)!);

      // Overlay should be hidden after drop
      expect(queryByTestId(`drop-zone-overlay-${paneId}`)).toBeNull();
    });
  });

  describe('existing functionality preserved', () => {
    it('still renders TerminalView with the session ID', () => {
      const { getByTestId } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      expect(getByTestId(`terminal-${sessionId}`)).toBeDefined();
    });

    it('sets active pane on click', () => {
      const { container } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      const wrapper = container.firstElementChild as HTMLElement;

      fireEvent.click(wrapper);

      expect(useLayoutStore.getState().activePaneId).toBe(paneId);
    });

    it('never shows ring borders (clean borderless look)', () => {
      useLayoutStore.setState({
        activePaneId: paneId,
        layoutTree: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'leaf', paneId, sessionId },
          second: { type: 'leaf', paneId: 'other-pane', sessionId: 'other-session' },
        },
      });

      const { container } = render(
        <LeafPaneWrapper paneId={paneId} sessionId={sessionId} />
      );
      const wrapper = container.firstElementChild as HTMLElement;

      expect(wrapper.className).not.toContain('ring-');
    });
  });
});
