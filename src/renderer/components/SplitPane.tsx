import React, { useRef, useCallback, useState, useEffect } from 'react';

interface SplitPaneProps {
  top: React.ReactNode;
  bottom: React.ReactNode;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  direction?: 'horizontal' | 'vertical';
}

export default function SplitPane({
  top,
  bottom,
  ratio,
  onRatioChange,
  direction = 'horizontal'
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      let newRatio: number;
      if (direction === 'horizontal') {
        newRatio = (e.clientY - rect.top) / rect.height;
      } else {
        newRatio = (e.clientX - rect.left) / rect.width;
      }

      // Clamp between 20% and 80%
      newRatio = Math.min(0.8, Math.max(0.2, newRatio));
      onRatioChange(newRatio);
    };

    const handleMouseUp = () => setDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, direction, onRatioChange]);

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={`flex ${isHorizontal ? 'flex-col' : 'flex-row'} h-full w-full overflow-hidden`}
      style={{ cursor: dragging ? (isHorizontal ? 'row-resize' : 'col-resize') : undefined }}
    >
      {/* Top / Left pane */}
      <div
        className="overflow-hidden"
        style={{
          [isHorizontal ? 'height' : 'width']: `${ratio * 100}%`,
          flexShrink: 0
        }}
      >
        {top}
      </div>

      {/* Divider */}
      <div
        onMouseDown={handleMouseDown}
        className={`
          flex-shrink-0 transition-colors
          ${isHorizontal ? 'h-1 cursor-row-resize' : 'w-1 cursor-col-resize'}
        `}
        style={{ backgroundColor: dragging ? 'var(--color-accent)' : 'var(--color-border)' }}
      />

      {/* Bottom / Right pane */}
      <div className="flex-1 overflow-hidden min-h-0 min-w-0">
        {bottom}
      </div>
    </div>
  );
}
