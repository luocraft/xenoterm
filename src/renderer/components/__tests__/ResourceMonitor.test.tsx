// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResourceMonitor from '../ResourceMonitor';
import { useAppStore } from '../../store/app-store';

const sample = { sampledAt: 1, cpuPercent: 25, loadAverage: [1, 2, 3], memory: { total: 100, used: 50, available: 50 }, disks: [] };
let getResources: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  getResources = vi.fn().mockResolvedValue(sample);
  Object.defineProperty(window, 'api', { configurable: true, value: { ssh: { getResources } } });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  useAppStore.setState({ sessions: [{ id: 'one', hostEntryId: 'host', status: 'connected' }, { id: 'two', hostEntryId: 'other', status: 'connected' }], hosts: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('refreshes only while visible and stops on disconnect', async () => {
  render(<ResourceMonitor sessionId="one" />);
  await act(async () => {});
  expect(screen.getByText('25.0%')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(getResources).toHaveBeenCalledTimes(2);
  act(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(getResources).toHaveBeenCalledTimes(2);
  await act(async () => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(getResources).toHaveBeenCalledTimes(3);
  act(() => useAppStore.setState({ sessions: [] }));
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(getResources).toHaveBeenCalledTimes(3);
});
it('ignores late samples after switching host and never overlaps polling', async () => {
  let finish!: (value: typeof sample) => void;
  getResources.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ResourceMonitor sessionId="one" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(getResources).toHaveBeenCalledTimes(1);
  view.rerender(<ResourceMonitor sessionId="two" />);
  await act(async () => {});
  await act(async () => { finish({ ...sample, cpuPercent: 99 }); });
  expect(screen.queryByText('99.0%')).toBeNull();
  expect(screen.getByText('25.0%')).toBeTruthy();
});
it('clears failed samples and backs off instead of showing stale values', async () => {
  render(<ResourceMonitor sessionId="one" />);
  await act(async () => {});
  getResources.mockRejectedValue(new Error('timeout'));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByText('25.0%')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(29000); });
  expect(getResources).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(getResources).toHaveBeenCalledTimes(3);
});
