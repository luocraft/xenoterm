// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import DropZoneOverlay from '../DropZoneOverlay';
import type { DropPosition } from '../../../shared/types';

// Helper to create a mock DragEvent with clientX/clientY and dataTransfer
function createDragEvent(
  type: string,
  clientX: number,
  clientY: number,
  sessionId?: string
): Partial<React.DragEvent<HTMLDivElement>> {
  return {
    clientX,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      getData: vi.fn((key: string) => (key === 'text/session-id' ? sessionId ?? '' : '')),
    } as unknown as DataTransfer,
  };
}

describe('DropZoneOverlay', () => {
  const paneId = 'test-pane-1';
  let onDrop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDrop = vi.fn();
  });

  describe('rendering', () => {
    it('renders the overlay with correct test id', () => {
      const { getByTestId } = render(
        <DropZoneOverlay paneId={paneId} onDrop={onDrop} />
      );
      expect(getByTestId(`drop-zone-overlay-${paneId}`)).toBeDefined();
    });

    it('does not show any highlight by default', () => {
      const { queryByTestId } = render(
        <DropZoneOverlay paneId={paneId} onDrop={onDrop} />
      );
      expect(queryByTestId('drop-zone-highlight-left')).toBeNull();
      expect(queryByTestId('drop-zone-highlight-right')).toBeNull();
      expect(queryByTestId('drop-zone-highlight-top')).toBeNull();
      expect(queryByTestId('drop-zone-highlight-bottom')).toBeNull();
      expect(queryByTestId('drop-zone-highlight-center')).toBeNull();
    });

    it('has absolute positioning and z-10 class', () => {
      const { getByTestId } = render(
        <DropZoneOverlay paneId={paneId} onDrop={onDrop} />
      );
      const overlay = getByTestId(`drop-zone-overlay-${paneId}`);
      expect(overlay.className).toContain('absolute');
      expect(overlay.className).toContain('inset-0');
      expect(overlay.className).toContain('z-10');
    });
  });

  describe('zone detection on dragOver', () => {
    // We mock getBoundingClientRect to simulate a 400x400 overlay
    function renderWithBounds() {
      const result = render(
        <DropZoneOverlay paneId={paneId} onDrop={onDrop} />
      );
      const overlay = result.getByTestId(`drop-zone-overlay-${paneId}`);

      // Mock the overlay's bounding rect: 400x400 at position (0, 0)
      vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 400,
        bottom: 400,
        width: 400,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      return { ...result, overlay };
    }

    function fireDragOver(overlay: HTMLElement, clientX: number, clientY: number) {
      const event = new Event('dragover', { bubbles: true, cancelable: true }) as any;
      event.clientX = clientX;
      event.clientY = clientY;
      event.preventDefault = vi.fn();
      event.stopPropagation = vi.fn();
      event.dataTransfer = { getData: () => '' };
      fireEvent(overlay, event);
    }

    it('highlights left zone when cursor is in left 25%', () => {
      const { overlay, queryByTestId } = renderWithBounds();

      // clientX=50 out of 400 = 12.5% → left zone
      fireDragOver(overlay, 50, 200);

      expect(queryByTestId('drop-zone-highlight-left')).not.toBeNull();
    });

    it('highlights right zone when cursor is in right 25%', () => {
      const { overlay, queryByTestId } = renderWithBounds();

      // clientX=350 out of 400 = 87.5% → right zone
      fireDragOver(overlay, 350, 200);

      expect(queryByTestId('drop-zone-highlight-right')).not.toBeNull();
    });

    it('highlights top zone when cursor is in top 25% (not in left/right edge)', () => {
      const { overlay, queryByTestId } = renderWithBounds();

      // clientX=200 (50%), clientY=50 (12.5%) → top zone
      fireDragOver(overlay, 200, 50);

      expect(queryByTestId('drop-zone-highlight-top')).not.toBeNull();
    });

    it('highlights bottom zone when cursor is in bottom 25% (not in left/right edge)', () => {
      const { overlay, queryByTestId } = renderWithBounds();

      // clientX=200 (50%), clientY=350 (87.5%) → bottom zone
      fireDragOver(overlay, 200, 350);

      expect(queryByTestId('drop-zone-highlight-bottom')).not.toBeNull();
    });

    it('highlights center zone when cursor is in center area', () => {
      const { overlay, queryByTestId } = renderWithBounds();

      // clientX=200 (50%), clientY=200 (50%) → center zone
      fireDragOver(overlay, 200, 200);

      expect(queryByTestId('drop-zone-highlight-center')).not.toBeNull();
    });

    it('left/right zones take priority over top/bottom in corner regions', () => {
      const { overlay, queryByTestId } = renderWithBounds();

      // clientX=50 (12.5%), clientY=50 (12.5%) → left zone (left takes priority)
      fireDragOver(overlay, 50, 50);

      expect(queryByTestId('drop-zone-highlight-left')).not.toBeNull();
      expect(queryByTestId('drop-zone-highlight-top')).toBeNull();
    });
  });

  describe('drop handling', () => {
    function renderWithBounds() {
      const result = render(
        <DropZoneOverlay paneId={paneId} onDrop={onDrop} />
      );
      const overlay = result.getByTestId(`drop-zone-overlay-${paneId}`);

      vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 400,
        bottom: 400,
        width: 400,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      return { ...result, overlay };
    }

    it('calls onDrop with session ID and left position on left zone drop', () => {
      const { overlay } = renderWithBounds();

      // Simulate drop in left zone
      const dropEvent = new Event('drop', { bubbles: true }) as any;
      dropEvent.clientX = 50;
      dropEvent.clientY = 200;
      dropEvent.preventDefault = vi.fn();
      dropEvent.stopPropagation = vi.fn();
      dropEvent.dataTransfer = {
        getData: (key: string) => (key === 'text/session-id' ? 'session-abc' : ''),
      };

      fireEvent(overlay, dropEvent);

      expect(onDrop).toHaveBeenCalledWith('session-abc', 'left');
    });

    it('calls onDrop with session ID and center position on center zone drop', () => {
      const { overlay } = renderWithBounds();

      const dropEvent = new Event('drop', { bubbles: true }) as any;
      dropEvent.clientX = 200;
      dropEvent.clientY = 200;
      dropEvent.preventDefault = vi.fn();
      dropEvent.stopPropagation = vi.fn();
      dropEvent.dataTransfer = {
        getData: (key: string) => (key === 'text/session-id' ? 'session-xyz' : ''),
      };

      fireEvent(overlay, dropEvent);

      expect(onDrop).toHaveBeenCalledWith('session-xyz', 'center');
    });

    it('does not call onDrop when session ID is empty', () => {
      const { overlay } = renderWithBounds();

      const dropEvent = new Event('drop', { bubbles: true }) as any;
      dropEvent.clientX = 200;
      dropEvent.clientY = 200;
      dropEvent.preventDefault = vi.fn();
      dropEvent.stopPropagation = vi.fn();
      dropEvent.dataTransfer = {
        getData: () => '',
      };

      fireEvent(overlay, dropEvent);

      expect(onDrop).not.toHaveBeenCalled();
    });

    it('calls onDrop with right position on right zone drop', () => {
      const { overlay } = renderWithBounds();

      const dropEvent = new Event('drop', { bubbles: true }) as any;
      dropEvent.clientX = 350;
      dropEvent.clientY = 200;
      dropEvent.preventDefault = vi.fn();
      dropEvent.stopPropagation = vi.fn();
      dropEvent.dataTransfer = {
        getData: (key: string) => (key === 'text/session-id' ? 'session-right' : ''),
      };

      fireEvent(overlay, dropEvent);

      expect(onDrop).toHaveBeenCalledWith('session-right', 'right');
    });

    it('calls onDrop with bottom position on bottom zone drop', () => {
      const { overlay } = renderWithBounds();

      const dropEvent = new Event('drop', { bubbles: true }) as any;
      dropEvent.clientX = 200;
      dropEvent.clientY = 350;
      dropEvent.preventDefault = vi.fn();
      dropEvent.stopPropagation = vi.fn();
      dropEvent.dataTransfer = {
        getData: (key: string) => (key === 'text/session-id' ? 'session-bottom' : ''),
      };

      fireEvent(overlay, dropEvent);

      expect(onDrop).toHaveBeenCalledWith('session-bottom', 'bottom');
    });
  });

  describe('drag leave', () => {
    it('clears highlight when drag leaves the overlay', () => {
      const { getByTestId, queryByTestId } = render(
        <DropZoneOverlay paneId={paneId} onDrop={onDrop} />
      );
      const overlay = getByTestId(`drop-zone-overlay-${paneId}`);

      vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 400,
        bottom: 400,
        width: 400,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // First, trigger a dragOver to show a highlight
      fireEvent.dragOver(overlay, { clientX: 200, clientY: 200 });
      expect(queryByTestId('drop-zone-highlight-center')).not.toBeNull();

      // Then trigger dragLeave with relatedTarget outside the overlay
      fireEvent.dragLeave(overlay, { relatedTarget: document.body });
      expect(queryByTestId('drop-zone-highlight-center')).toBeNull();
    });
  });
});
