import React, { useCallback, useEffect, useState } from 'react';
import { useLayoutStore } from '../store/layout-store';

export interface PaneDividerProps {
  direction: 'horizontal' | 'vertical';
  path: number[]; // path to the parent SplitNode in the layout tree
}

/**
 * A thin draggable divider bar between split children.
 *
 * - Horizontal splits: vertical bar, cursor: col-resize
 * - Vertical splits: horizontal bar, cursor: row-resize
 *
 * On drag, computes new ratio from mouse position relative to parent bounds
 * and calls layoutStore.resizeSplit(path, newRatio).
 */
export default function PaneDivider({ direction, path }: PaneDividerProps) {
  const resizeSplit = useLayoutStore((s) => s.resizeSplit);
  const [isDragging, setIsDragging] = useState(false);

  const isHorizontal = direction === 'horizontal';

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
    },
    []
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Find the parent container — the divider's parent element holds the split
      const divider = document.querySelector(`[data-divider-path="${path.join(',')}"]`);
      if (!divider) return;
      const parent = divider.parentElement;
      if (!parent) return;

      const parentRect = parent.getBoundingClientRect();
      let newRatio: number;

      if (isHorizontal) {
        // Horizontal split: left/right children, vertical divider bar
        newRatio = (e.clientX - parentRect.left) / parentRect.width;
      } else {
        // Vertical split: top/bottom children, horizontal divider bar
        newRatio = (e.clientY - parentRect.top) / parentRect.height;
      }

      resizeSplit(path, newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isHorizontal, path, resizeSplit]);

  return (
    <>
      {/* Transparent overlay during drag to prevent iframe/terminal interference */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50"
          style={{ cursor: isHorizontal ? 'col-resize' : 'row-resize' }}
        />
      )}
      <div
        data-divider-path={path.join(',')}
        onMouseDown={handleMouseDown}
        className={`
          flex-shrink-0 transition-colors
          ${isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}
        `}
        style={{ backgroundColor: isDragging ? 'var(--color-accent)' : 'var(--color-border)' }}
      />
    </>
  );
}
