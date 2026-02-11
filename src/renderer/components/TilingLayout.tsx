import React from 'react';
import type { LayoutNode } from '../../shared/types';
import LeafPaneWrapper from './LeafPaneWrapper';
import PaneDivider from './PaneDivider';

interface TilingLayoutProps {
  node: LayoutNode;
  path: number[]; // path from root, used for resize identification
}

/**
 * Recursive component that renders the layout tree.
 *
 * - For LeafPane nodes: renders a LeafPaneWrapper with the pane's paneId and sessionId.
 * - For SplitNode nodes: renders a flex container with two TilingLayout children
 *   separated by a PaneDivider, using CSS flexbox with flex-basis set by the split ratio.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export default function TilingLayout({ node, path }: TilingLayoutProps) {
  if (node.type === 'leaf') {
    return <LeafPaneWrapper key={node.sessionId} paneId={node.paneId} sessionId={node.sessionId} />;
  }

  // SplitNode: render two children with a divider between them
  const isHorizontal = node.direction === 'horizontal';
  const firstBasis = `${node.ratio * 100}%`;
  const secondBasis = `${(1 - node.ratio) * 100}%`;

  return (
    <div className={`flex ${isHorizontal ? 'flex-row' : 'flex-col'} w-full h-full`}>
      <div
        style={{ flexBasis: firstBasis }}
        className="flex-shrink-0 flex-grow-0 overflow-hidden"
      >
        <TilingLayout node={node.first} path={[...path, 0]} />
      </div>
      <PaneDivider direction={node.direction} path={path} />
      <div
        style={{ flexBasis: secondBasis }}
        className="flex-shrink-0 flex-grow-0 overflow-hidden"
      >
        <TilingLayout node={node.second} path={[...path, 1]} />
      </div>
    </div>
  );
}
