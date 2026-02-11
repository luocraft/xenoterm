import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAppStore } from '../store/app-store';

interface TerminalViewProps {
  sessionId: string;
}

/**
 * Persistent terminal entry: terminal instance + IPC wiring live for the
 * entire lifetime of the SSH session, independent of React mount/unmount.
 * The React component only moves the wrapper DOM node into its container
 * and handles fit/focus.
 */
interface CachedTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  wrapper: HTMLDivElement;
  initialized: boolean;
  /** IPC cleanup — called only when the session is disposed */
  ipcCleanup: (() => void) | null;
}

const terminalCache = new Map<string, CachedTerminal>();

function getDarkTheme() {
  return {
    background: '#0d0e1c',
    foreground: '#e4e4e7',
    cursor: '#6366f1',
    cursorAccent: '#0d0e1c',
    selectionBackground: '#6366f140',
    black: '#1a1b2e',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e4e4e7',
    brightBlack: '#52525b',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde68a',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#fafafa',
  };
}

function getLightTheme() {
  return {
    background: '#d5dbd7',
    foreground: '#2e3532',
    cursor: '#4f46e5',
    cursorAccent: '#d5dbd7',
    selectionBackground: '#4f46e540',
    black: '#2e3532',
    red: '#bf3b3b',
    green: '#2e7d32',
    yellow: '#a67c00',
    blue: '#1565c0',
    magenta: '#7b1fa2',
    cyan: '#00838f',
    white: '#d5dbd7',
    brightBlack: '#636e68',
    brightRed: '#d32f2f',
    brightGreen: '#388e3c',
    brightYellow: '#f9a825',
    brightBlue: '#1e88e5',
    brightMagenta: '#8e24aa',
    brightCyan: '#0097a7',
    brightWhite: '#ecf0ed',
  };
}

function getTerminalConfig(isDark: boolean) {
  return {
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    fontSize: 14,
    theme: isDark ? getDarkTheme() : getLightTheme(),
  };
}

/**
 * Get or create a terminal + IPC wiring for a session.
 * IPC listeners are set up once and persist until disposeTerminal() is called.
 */
function getOrCreateTerminal(sessionId: string, isDark: boolean): CachedTerminal {
  let cached = terminalCache.get(sessionId);
  if (cached) return cached;

  const config = getTerminalConfig(isDark);
  const terminal = new Terminal({
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    theme: config.theme,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  const wrapper = document.createElement('div');
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';

  // Wire up IPC once — these persist for the session lifetime
  let lineBuffer = '';
  const dataDisposable = terminal.onData((data) => {
    try {
      if (data === '\r') {
        if (lineBuffer.trim()) {
          useAppStore.getState().addCommand(sessionId, lineBuffer);
        }
        lineBuffer = '';
      } else if (data === '\x7f' || data === '\b') {
        lineBuffer = lineBuffer.slice(0, -1);
      } else if (data === '\x03') {
        lineBuffer = '';
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        lineBuffer += data;
      } else if (data.length > 1 && !data.startsWith('\x1b')) {
        lineBuffer += data;
      }
    } catch (e) {
      console.error('[Terminal] Command tracking error:', e);
    }
    window.api.ssh.write(sessionId, data);
  });

  const unsubData = window.api.ssh.onData(sessionId, (data) => {
    terminal.write(data);
  });
  const unsubClose = window.api.ssh.onClose(sessionId, () => {
    terminal.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
  });
  const unsubError = window.api.ssh.onError(sessionId, (error) => {
    terminal.write(`\r\n\x1b[31m[Error: ${error}]\x1b[0m\r\n`);
  });
  const resizeDisposable = terminal.onResize(({ cols, rows }) => {
    window.api.ssh.resize(sessionId, cols, rows);
  });

  const ipcCleanup = () => {
    dataDisposable.dispose();
    resizeDisposable.dispose();
    unsubData();
    unsubClose();
    unsubError();
  };

  cached = { terminal, fitAddon, wrapper, initialized: false, ipcCleanup };
  terminalCache.set(sessionId, cached);
  return cached;
}

export default function TerminalView({ sessionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appTheme = useAppStore((s) => s.theme);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const isDark = appTheme === 'dark';
    const cached = getOrCreateTerminal(sessionId, isDark);
    const { terminal, fitAddon, wrapper } = cached;

    // Initialize terminal DOM if first time
    if (!cached.initialized) {
      terminal.open(wrapper);
      cached.initialized = true;
    }

    // Update theme
    terminal.options.theme = getTerminalConfig(isDark).theme;

    // Move wrapper into this container
    container.appendChild(wrapper);

    // Focus after DOM update
    requestAnimationFrame(() => {
      terminal.focus();
    });

    // Fit to container
    const doFit = () => {
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        try { fitAddon.fit(); } catch { /* ignore */ }
      } else {
        setTimeout(doFit, 200);
      }
    };
    requestAnimationFrame(() => {
      doFit();
      setTimeout(doFit, 300);
    });

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(container);

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        const selection = terminal.getSelection();
        if (selection) navigator.clipboard.writeText(selection);
        e.preventDefault();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        navigator.clipboard.readText().then((text) => {
          window.api.ssh.write(sessionId, text);
        });
        e.preventDefault();
      }
    };
    container.addEventListener('keydown', handleKeyDown);

    // Cleanup: only remove per-mount resources (resize observer, keydown).
    // IPC listeners and terminal.onData stay alive.
    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [sessionId, appTheme]);

  const bgColor = appTheme === 'dark' ? '#0d0e1c' : '#d5dbd7';

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-lg overflow-hidden"
      style={{ padding: '4px', backgroundColor: bgColor }}
    />
  );
}

export function disposeTerminal(sessionId: string): void {
  const cached = terminalCache.get(sessionId);
  if (cached) {
    cached.ipcCleanup?.();
    cached.terminal.dispose();
    cached.wrapper.remove();
    terminalCache.delete(sessionId);
  }
}
