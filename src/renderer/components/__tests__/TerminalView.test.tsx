// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import TerminalView, { disposeTerminal } from '../TerminalView';
import { useAppStore } from '../../store/app-store';

const mocks = vi.hoisted(() => ({ terminals: [] as any[], fit: vi.fn() }));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: any;
    rows = 24;
    cols = 80;
    element?: HTMLElement;
    events = new Map<string, Set<(...args: any[]) => void>>();
    writes: Array<{ data: string; callback?: () => void }> = [];
    buffer = { active: { type: 'normal', baseY: 0, cursorY: 0, viewportY: 0,
      getLine: () => ({ translateToString: () => 'user@host:/tmp$ ' }) } };
    constructor(options: any) { this.options = options; mocks.terminals.push(this); }
    subscribe(name: string, callback: (...args: any[]) => void) {
      if (!this.events.has(name)) this.events.set(name, new Set());
      this.events.get(name)!.add(callback);
      return { dispose: () => this.events.get(name)!.delete(callback) };
    }
    emit(name: string, ...args: any[]) { this.events.get(name)?.forEach(cb => cb(...args)); }
    onData = (cb: any) => this.subscribe('data', cb);
    onResize = (cb: any) => this.subscribe('resize', cb);
    onScroll = (cb: any) => this.subscribe('scroll', cb);
    onLineFeed = (cb: any) => this.subscribe('linefeed', cb);
    onSelectionChange = (cb: any) => this.subscribe('selection', cb);
    loadAddon() {}
    open(container: HTMLElement) {
      this.element = document.createElement('div');
      this.element.innerHTML = '<div class="xterm-screen"></div><textarea></textarea>';
      container.appendChild(this.element);
    }
    write(data: string, callback?: () => void) { this.writes.push({ data, callback }); }
    focus() {}
    dispose() {}
  }
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = mocks.fit; } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

let receive: (data: string) => void;
let width: number;
let fillRect: ReturnType<typeof vi.fn>;
let notifyResize: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.terminals.length = 0;
  mocks.fit.mockClear();
  width = 640;
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() {}
    disconnect() {}
  });
  fillRect = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    scale: vi.fn(), setTransform: vi.fn(), fillRect, fillText: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() })
  } as any);
  window.api = {
    ssh: {
      onData: vi.fn((_id, cb) => { receive = cb; return vi.fn(); }),
      onClose: vi.fn(() => vi.fn()), onError: vi.fn(() => vi.fn()),
      write: vi.fn(), resize: vi.fn()
    },
    clipboard: { writeText: vi.fn() },
    config: { setCommandHistory: vi.fn() }
  } as any;
  useAppStore.setState({ theme: 'dark', timestampGutterVisible: true, sessionCwdMap: {}, commandHistory: [] });
});

afterEach(() => {
  cleanup();
  disposeTerminal('test-session');
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountTerminal() {
  const view = render(<TerminalView sessionId="test-session" />);
  act(() => { vi.advanceTimersByTime(400); });
  return view;
}

describe('SSH terminal rendering and lifetime', () => {
  it('coalesces 10,000 linefeed/scroll events into one gutter paint per frame', () => {
    mountTerminal();
    const term = mocks.terminals[0];
    fillRect.mockClear();
    for (let i = 0; i < 10_000; i++) {
      term.emit('linefeed');
      term.emit('scroll');
    }
    expect(fillRect.mock.calls.length).toBe(0);
    act(() => { vi.advanceTimersByTime(16); });
    // One background and one edge gradient per paint.
    expect(fillRect).toHaveBeenCalledTimes(2);
  });

  it('reuses the canvas backing store when its dimensions have not changed', () => {
    mountTerminal();
    const setWidth = vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set');
    const setHeight = vi.spyOn(HTMLCanvasElement.prototype, 'height', 'set');
    for (let i = 0; i < 10; i++) {
      mocks.terminals[0].emit('scroll');
      act(() => { vi.advanceTimersByTime(16); });
    }
    expect(setWidth).not.toHaveBeenCalled();
    expect(setHeight).not.toHaveBeenCalled();
  });

  it('leaves no fit polling behind after repeatedly mounting hidden views', () => {
    width = 0;
    for (let i = 0; i < 20; i++) {
      const view = mountTerminal();
      view.unmount();
    }
    act(() => { vi.advanceTimersByTime(2000); });
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.fit).not.toHaveBeenCalled();
  });

  it('does not paint cached terminals while their view is detached', () => {
    const view = mountTerminal();
    view.unmount();
    fillRect.mockClear();
    mocks.terminals[0].emit('linefeed');
    act(() => { vi.advanceTimersByTime(400); });
    expect(fillRect).not.toHaveBeenCalled();
  });

  it('fits when a hidden view becomes visible and cancels pending work on unmount', () => {
    width = 0;
    const view = mountTerminal();
    width = 640;
    act(() => {
      notifyResize();
      notifyResize();
      vi.advanceTimersByTime(16);
    });
    expect(mocks.fit).toHaveBeenCalledTimes(1);
    notifyResize();
    view.unmount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(mocks.fit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reuses the terminal and IPC subscription after changing tabs', () => {
    mountTerminal().unmount();
    fillRect.mockClear();
    mountTerminal();
    expect(mocks.terminals).toHaveLength(1);
    expect(window.api.ssh.onData).toHaveBeenCalledTimes(1);
    expect(fillRect.mock.calls.length).toBeGreaterThan(0);
    vi.mocked(window.api.ssh.write).mockClear();
    mocks.terminals[0].emit('data', 'a');
    expect(window.api.ssh.write).toHaveBeenCalledTimes(1);
    expect(window.api.ssh.write).toHaveBeenCalledWith('test-session', 'a');
  });

  it('sends Enter before persisting command history', () => {
    mountTerminal();
    const calls: string[] = [];
    vi.mocked(window.api.ssh.write).mockImplementation(() => { calls.push('input'); });
    vi.mocked(window.api.config.setCommandHistory).mockImplementation(async () => { calls.push('history'); });
    mocks.terminals[0].buffer.active.getLine = () => ({ translateToString: () => 'user@host:/tmp$ ls' });
    mocks.terminals[0].emit('data', '\r');
    expect(calls).toEqual(['input', 'history']);
  });

  it('detects the prompt only after xterm has parsed the received output', () => {
    mountTerminal();
    receive('user@host:/tmp$ ');
    act(() => { vi.advanceTimersByTime(200); });
    expect(useAppStore.getState().sessionCwdMap['test-session']).toBeUndefined();
    act(() => {
      mocks.terminals[0].writes[0].callback?.();
      vi.advanceTimersByTime(200);
    });
    expect(useAppStore.getState().sessionCwdMap['test-session']).toBe('/tmp');
  });

  it('cancels prompt detection and ignores queued write callbacks after disposal', () => {
    const view = mountTerminal();
    receive('user@host:/tmp$ ');
    const callback = mocks.terminals[0].writes[0].callback;
    act(() => { callback?.(); });
    view.unmount();
    disposeTerminal('test-session');
    act(() => {
      callback?.();
      vi.advanceTimersByTime(1000);
    });
    expect(useAppStore.getState().sessionCwdMap['test-session']).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
