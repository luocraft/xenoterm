// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import type { LayoutNode, LeafPane, SplitNode } from '../../../shared/types';
import TilingLayout from '../TilingLayout';

// ===== Mocks =====

// Mock LeafPaneWrapper to avoid TerminalView/xterm dependencies
vi.mock('../LeafPaneWrapper', () => ({
  default: ({ paneId, sessionId }: { paneId: string; sessionId: string }) =>
    React.createElement('div', { 'data-testid': `leaf-${paneId}`, 'data-session-id': sessionId }, `Leaf: ${paneId}`),
}));

// Mock PaneDivider to avoid store dependencies during rendering
vi.mock('../PaneDivider', () => ({
  default: ({ direction, path }: { direction: string; path: number[] }) =>
    React.createElement('div', { 'data-testid': `divider-${path.join(',')}`, 'data-direction': direction }, 'Divider'),
}));

// ===== Test Fixtures =====

const leafA: LeafPane = { type: 'leaf', paneId: 'pane-a', sessionId: 'session-a' };
const leafB: LeafPane = { type: 'leaf', paneId: 'pane-b', sessionId: 'session-b' };
const leafC: LeafPane = { type: 'leaf', paneId: 'pane-c', sessionId: 'session-c' };

const horizontalSplit: SplitNode = {
  type: 'split',
  direction: 'horizontal',
  ratio: 0.6,
  first: leafA,
  second: leafB,
};

const verticalSplit: SplitNode = {
  type: 'split',
  direction: 'vertical',
  ratio: 0.4,
  first: leafA,
  second: leafB,
};

const nestedTree: SplitNode = {
  type: 'split',
  direction: 'horizontal',
  ratio: 0.5,
  first: leafA,
  second: {
    type: 'split',
    direction: 'vertical',
    ratio: 0.6,
    first: leafB,
    second: leafC,
  },
};

// ===== Tests =====

describe('TilingLayout', () => {
  describe('leaf node rendering', () => {
    it('renders a LeafPaneWrapper for a leaf node', () => {
      const { getByTestId } = render(<TilingLayout node={leafA} path={[]} />);
      const leaf = getByTestId('leaf-pane-a');
      expect(leaf).toBeDefined();
      expect(leaf.getAttribute('data-session-id')).toBe('session-a');
    });
  });

  describe('horizontal split rendering', () => {
    it('renders two children and a divider for a horizontal split', () => {
      const { getByTestId } = render(<TilingLayout node={horizontalSplit} path={[]} />);

      // Both leaves should be rendered
      expect(getByTestId('leaf-pane-a')).toBeDefined();
      expect(getByTestId('leaf-pane-b')).toBeDefined();

      // Divider should be rendered
      const divider = getByTestId('divider-');
      expect(divider.getAttribute('data-direction')).toBe('horizontal');
    });

    it('uses flex-row for horizontal splits', () => {
      const { container } = render(<TilingLayout node={horizontalSplit} path={[]} />);
      const flexContainer = container.firstElementChild as HTMLElement;
      expect(flexContainer.className).toContain('flex-row');
      expect(flexContainer.className).not.toContain('flex-col');
    });

    it('sets correct flex-basis percentages based on ratio', () => {
      const { container } = render(<TilingLayout node={horizontalSplit} path={[]} />);
      const flexContainer = container.firstElementChild as HTMLElement;
      const children = flexContainer.children;

      // First child: 60% (ratio = 0.6)
      expect((children[0] as HTMLElement).style.flexBasis).toBe('60%');
      // Second child (after divider): 40%
      expect((children[2] as HTMLElement).style.flexBasis).toBe('40%');
    });
  });

  describe('vertical split rendering', () => {
    it('uses flex-col for vertical splits', () => {
      const { container } = render(<TilingLayout node={verticalSplit} path={[]} />);
      const flexContainer = container.firstElementChild as HTMLElement;
      expect(flexContainer.className).toContain('flex-col');
      expect(flexContainer.className).not.toContain('flex-row');
    });

    it('renders divider with vertical direction', () => {
      const { getByTestId } = render(<TilingLayout node={verticalSplit} path={[]} />);
      const divider = getByTestId('divider-');
      expect(divider.getAttribute('data-direction')).toBe('vertical');
    });

    it('sets correct flex-basis percentages for vertical split', () => {
      const { container } = render(<TilingLayout node={verticalSplit} path={[]} />);
      const flexContainer = container.firstElementChild as HTMLElement;
      const children = flexContainer.children;

      // First child: 40% (ratio = 0.4)
      expect((children[0] as HTMLElement).style.flexBasis).toBe('40%');
      // Second child: 60%
      expect((children[2] as HTMLElement).style.flexBasis).toBe('60%');
    });
  });

  describe('nested tree rendering', () => {
    it('renders all leaf panes in a nested tree', () => {
      const { getByTestId } = render(<TilingLayout node={nestedTree} path={[]} />);

      expect(getByTestId('leaf-pane-a')).toBeDefined();
      expect(getByTestId('leaf-pane-b')).toBeDefined();
      expect(getByTestId('leaf-pane-c')).toBeDefined();
    });

    it('renders dividers at correct paths', () => {
      const { getByTestId } = render(<TilingLayout node={nestedTree} path={[]} />);

      // Root divider at path []
      const rootDivider = getByTestId('divider-');
      expect(rootDivider.getAttribute('data-direction')).toBe('horizontal');

      // Nested divider at path [1]
      const nestedDivider = getByTestId('divider-1');
      expect(nestedDivider.getAttribute('data-direction')).toBe('vertical');
    });

    it('passes correct paths to child TilingLayout components', () => {
      const { container } = render(<TilingLayout node={nestedTree} path={[]} />);

      // The root flex container should have flex-row (horizontal)
      const rootFlex = container.firstElementChild as HTMLElement;
      expect(rootFlex.className).toContain('flex-row');

      // The second child's inner container should have flex-col (vertical)
      const secondChildWrapper = rootFlex.children[2] as HTMLElement;
      const nestedFlex = secondChildWrapper.firstElementChild as HTMLElement;
      expect(nestedFlex.className).toContain('flex-col');
    });
  });

  describe('flex properties', () => {
    it('applies flex-shrink-0 and flex-grow-0 to child wrappers', () => {
      const { container } = render(<TilingLayout node={horizontalSplit} path={[]} />);
      const flexContainer = container.firstElementChild as HTMLElement;

      const firstChild = flexContainer.children[0] as HTMLElement;
      const secondChild = flexContainer.children[2] as HTMLElement;

      expect(firstChild.className).toContain('flex-shrink-0');
      expect(firstChild.className).toContain('flex-grow-0');
      expect(secondChild.className).toContain('flex-shrink-0');
      expect(secondChild.className).toContain('flex-grow-0');
    });

    it('applies overflow-hidden to child wrappers', () => {
      const { container } = render(<TilingLayout node={horizontalSplit} path={[]} />);
      const flexContainer = container.firstElementChild as HTMLElement;

      const firstChild = flexContainer.children[0] as HTMLElement;
      const secondChild = flexContainer.children[2] as HTMLElement;

      expect(firstChild.className).toContain('overflow-hidden');
      expect(secondChild.className).toContain('overflow-hidden');
    });
  });
});
