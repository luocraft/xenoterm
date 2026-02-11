import React, { useState, useCallback, useRef } from 'react';
import type { DropPosition } from '../../shared/types';

export interface DropZoneOverlayProps {
  paneId: string;
  onDrop: (sessionId: string, position: DropPosition) => void;
}

/**
 * Determines the drop zone position based on cursor coordinates
 * relative to the overlay element bounds.
 *
 * Zone layout:
 * - Left 25%: 'left'
 * - Right 25%: 'right'
 * - Top 25%: 'top'
 * - Bottom 25%: 'bottom'
 * - Center 50%: 'center'
 *
 * Edge zones (left/right) take priority over top/bottom when
 * the cursor is in a corner region within the 25% edge band.
 */
function getDropPosition(
  clientX: number,
  clientY: number,
  rect: DOMRect
): DropPosition {
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;
  const fracX = relX / rect.width;
  const fracY = relY / rect.height;

  if (fracX < 0.25) return 'left';
  if (fracX > 0.75) return 'right';
  if (fracY < 0.25) return 'top';
  if (fracY > 0.75) return 'bottom';
  return 'center';
}

/**
 * Returns Tailwind positioning classes for each zone highlight area.
 */
function getZoneClasses(position: DropPosition): string {
  switch (position) {
    case 'left':
      return 'left-0 top-0 w-1/4 h-full';
    case 'right':
      return 'right-0 top-0 w-1/4 h-full';
    case 'top':
      return 'left-0 top-0 w-full h-1/4';
    case 'bottom':
      return 'left-0 bottom-0 w-full h-1/4';
    case 'center':
      return 'left-1/4 top-1/4 w-1/2 h-1/2';
  }
}

export default function DropZoneOverlay({ paneId, onDrop }: DropZoneOverlayProps) {
  const [activeZone, setActiveZone] = useState<DropPosition | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const position = getDropPosition(e.clientX, e.clientY, rect);
      setActiveZone(position);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const sessionId = e.dataTransfer.getData('text/session-id');
      if (!sessionId) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const position = getDropPosition(e.clientX, e.clientY, rect);
      onDrop(sessionId, position);
      setActiveZone(null);
    },
    [onDrop]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Only clear if we're actually leaving the overlay, not entering a child
      if (overlayRef.current && !overlayRef.current.contains(e.relatedTarget as Node)) {
        setActiveZone(null);
      }
    },
    []
  );

  return (
    <div
      ref={overlayRef}
      data-testid={`drop-zone-overlay-${paneId}`}
      className="absolute inset-0 z-10"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      {activeZone && (
        <div
          data-testid={`drop-zone-highlight-${activeZone}`}
          className={`absolute ${getZoneClasses(activeZone)} bg-emerald-400/30 pointer-events-none transition-all duration-100`}
        />
      )}
    </div>
  );
}
