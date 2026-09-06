import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAppStore } from '../store/app-store';
import type { AppConfig } from '../../shared/types';
import { DEFAULT_TERMINAL_CONFIG } from '../../shared/terminal-defaults';

interface TerminalViewProps {
  sessionId: string;
}

interface CachedTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  wrapper: HTMLDivElement;
  initialized: boolean;
  ipcCleanup: (() => void) | null;
  ghostOverlay: HTMLSpanElement;
  /** Timestamp gutter state */
  gutter: {
    /** Time string per absolute line index (scrollback + viewport) */
    lineTimestamps: string[];
    /** The gutter canvas element */
    canvas: HTMLCanvasElement;
    /** Last known viewport top row for scroll sync */
    lastViewportTop: number;
    /** Render function — called on scroll, data, resize */
    render: () => void;
    cancelRender: () => void;
    /** Cleanup disposables */
    disposables: Array<{ dispose: () => void }>;
  };
}

const terminalCache = new Map<string, CachedTerminal>();

function getDarkTheme() {
  return {
    background: '#242423',
    foreground: '#eeede9',
    cursor: '#CC7D5E',
    cursorAccent: '#242423',
    selectionBackground: '#cc7d5e40',
    black: '#30302e',
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
    background: '#F9F9F7',
    foreground: '#2D2D2B',
    cursor: '#CC7D5E',
    cursorAccent: '#F9F9F7',
    selectionBackground: '#cc7d5e35',
    black: '#2D2D2B',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#ca8a04',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#eeede9',
    brightBlack: '#78766f',
    brightRed: '#ef4444',
    brightGreen: '#22c55e',
    brightYellow: '#eab308',
    brightBlue: '#3b82f6',
    brightMagenta: '#a855f7',
    brightCyan: '#06b6d4',
    brightWhite: '#ecf0ed',
  };
}

function getTerminalConfig(isDark: boolean, terminalConfig: AppConfig['terminal']) {
  return {
    fontFamily: terminalConfig.fontFamily || DEFAULT_TERMINAL_CONFIG.fontFamily,
    fontSize: terminalConfig.fontSize || DEFAULT_TERMINAL_CONFIG.fontSize,
    theme: isDark ? getDarkTheme() : getLightTheme(),
  };
}

const GUTTER_WIDTH = 64; // px — "HH:MM:SS" at 12px + padding

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function getOrCreateTerminal(sessionId: string, isDark: boolean, terminalConfig: AppConfig['terminal']): CachedTerminal {
  let cached = terminalCache.get(sessionId);
  if (cached) return cached;

  const config = getTerminalConfig(isDark, terminalConfig);
  const terminal = new Terminal({
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    theme: config.theme,
    cursorBlink: true,
    cursorStyle: 'bar',
    lineHeight: 1.15,
    scrollback: 10000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  const wrapper = document.createElement('div');
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  wrapper.style.display = 'flex';

  // --- Timestamp gutter (canvas-based, left of terminal) ---
  const gutterCanvas = document.createElement('canvas');
  gutterCanvas.style.width = `${GUTTER_WIDTH}px`;
  gutterCanvas.style.flexShrink = '0';
  gutterCanvas.style.cursor = 'default';

  const termContainer = document.createElement('div');
  termContainer.style.flex = '1';
  termContainer.style.minWidth = '0';
  termContainer.style.height = '100%';

  wrapper.appendChild(gutterCanvas);
  wrapper.appendChild(termContainer);

  // Gutter state
  const lineTimestamps: string[] = [];
  let lastViewportTop = 0;
  let disposed = false;
  let gutterFrame: number | null = null;

  function renderGutter() {
    if (disposed || gutterFrame !== null || !useAppStore.getState().timestampGutterVisible) return;
    // A single SSH packet can contain thousands of linefeeds and scroll events.
    // Paint once per frame instead of synchronously on every parser event.
    gutterFrame = requestAnimationFrame(() => {
      gutterFrame = null;
      paintGutter();
    });
  }

  function cancelGutterRender() {
    if (gutterFrame !== null) cancelAnimationFrame(gutterFrame);
    gutterFrame = null;
  }

  function paintGutter() {
    const visible = useAppStore.getState().timestampGutterVisible;
    if (disposed || !visible || !wrapper.isConnected || wrapper.offsetWidth === 0 || wrapper.offsetHeight === 0) return;
    const buf = terminal.buffer.active;
    const rows = terminal.rows;
    const cellHeight = getCellHeight(terminal);
    if (!cellHeight || cellHeight <= 0) return;

    const currentTheme = useAppStore.getState().theme;
    const dark = currentTheme === 'dark';

    const dpr = window.devicePixelRatio || 1;
    const canvasW = GUTTER_WIDTH;
    // Use the full container height so the gutter extends to the bottom
    const containerH = gutterCanvas.parentElement?.clientHeight || (rows * cellHeight);
    const canvasH = Math.max(containerH, rows * cellHeight);

    const pixelWidth = Math.round(canvasW * dpr);
    const pixelHeight = Math.round(canvasH * dpr);
    // Assigning width/height resets and reallocates the canvas, even if unchanged.
    if (gutterCanvas.width !== pixelWidth) gutterCanvas.width = pixelWidth;
    if (gutterCanvas.height !== pixelHeight) gutterCanvas.height = pixelHeight;
    if (gutterCanvas.style.height !== `${canvasH}px`) gutterCanvas.style.height = `${canvasH}px`;

    const ctx = gutterCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background matches terminal, with subtle right-edge fade for soft separation
    ctx.fillStyle = dark ? '#242423' : '#F9F9F7';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Soft right edge: a thin gradient strip that blends into terminal bg
    const edgeWidth = 6;
    const fadeColor = dark ? [48, 48, 46] : [230, 229, 224];
    const grad = ctx.createLinearGradient(canvasW - edgeWidth, 0, canvasW, 0);
    grad.addColorStop(0, `rgba(${fadeColor[0]},${fadeColor[1]},${fadeColor[2]},0)`);
    grad.addColorStop(1, `rgba(${fadeColor[0]},${fadeColor[1]},${fadeColor[2]},0.5)`);
    ctx.fillStyle = grad;
    ctx.fillRect(canvasW - edgeWidth, 0, edgeWidth, canvasH);

    // Text style — match terminal font size for baseline alignment
    const fontSize = terminal.options.fontSize || DEFAULT_TERMINAL_CONFIG.fontSize;
    const fontFamily = terminal.options.fontFamily || DEFAULT_TERMINAL_CONFIG.fontFamily;
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'middle';

    const viewportTop = buf.viewportY;
    lastViewportTop = viewportTop;

    for (let row = 0; row < rows; row++) {
      const absLine = viewportTop + row;
      const ts = lineTimestamps[absLine];
      if (ts) {
        // Check if this line has actual content (non-empty)
        const line = buf.getLine(absLine);
        const lineText = line ? line.translateToString(true) : '';
        const hasContent = lineText.trim().length > 0;

        if (hasContent) {
          const y = row * cellHeight + cellHeight / 2;
          ctx.fillStyle = dark ? '#96948e' : '#807d75';
          ctx.fillText(ts, 0, y);
        }
      }
    }
  }

  // Wire up IPC once
  let lineBuffer = '';
  let inAlternateScreen = false;

  // --- Inline autocomplete (fish-style ghost suggestion) ---
  let ghostSuffix = '';
  let lastSuggestionInput = ''; // track lineBuffer to avoid redundant updates
  let suppressSuggestion = false; // suppress ghost during Tab completion / control sequences

  // --- Ghost suggestion via DOM overlay (never touches terminal buffer) ---
  const ghostOverlay = document.createElement('span');
  ghostOverlay.style.position = 'absolute';
  ghostOverlay.style.pointerEvents = 'none';
  ghostOverlay.style.whiteSpace = 'pre';
  ghostOverlay.style.zIndex = '1';
  ghostOverlay.style.display = 'none';
  // Will be appended to terminal element after open()

  function getGhostColor(): string {
    const theme = useAppStore.getState().theme;
    return theme === 'dark' ? '#96948e' : '#807d75';
  }

  function clearGhost() {
    if (!ghostSuffix) return;
    ghostOverlay.style.display = 'none';
    ghostOverlay.textContent = '';
    ghostSuffix = '';
    lastSuggestionInput = '';
  }

  /** Silently discard ghost state (same as clearGhost for DOM approach). */
  function discardGhost() {
    clearGhost();
  }

  function positionGhostOverlay() {
    if (!ghostSuffix) return;
    try {
      const buf = terminal.buffer.active;
      const cursorX = buf.cursorX;
      const cursorY = buf.cursorY;
      const dims = (terminal as any)._core?._renderService?.dimensions;
      if (!dims?.css?.cell?.width || !dims?.css?.cell?.height) { ghostOverlay.style.display = 'none'; return; }
      const cellW = dims.css.cell.width;
      const cellH = dims.css.cell.height;
      ghostOverlay.style.left = `${cursorX * cellW}px`;
      ghostOverlay.style.top = `${cursorY * cellH}px`;
      ghostOverlay.style.height = `${cellH}px`;
      ghostOverlay.style.lineHeight = `${cellH}px`;
      ghostOverlay.style.fontSize = `${terminal.options.fontSize || 12}px`;
      ghostOverlay.style.fontFamily = terminal.options.fontFamily || 'monospace';
      ghostOverlay.style.color = getGhostColor();
      ghostOverlay.style.display = '';
    } catch {
      ghostOverlay.style.display = 'none';
    }
  }

  function showGhost(suffix: string) {
    if (!suffix) return;
    ghostSuffix = suffix;
    ghostOverlay.textContent = suffix;
    positionGhostOverlay();
  }

  function findSuggestion(prefix: string): string {
    if (!prefix || prefix.length < 2) return '';
    const history = useAppStore.getState().commandHistory;
    for (let i = history.length - 1; i >= 0; i--) {
      const cmd = history[i].cmd;
      if (cmd.length > prefix.length && cmd.startsWith(prefix)) {
        return cmd.slice(prefix.length);
      }
    }
    return '';
  }

  function updateSuggestion() {
    if (inAlternateScreen || suppressSuggestion) { clearGhost(); return; }
    // Skip if lineBuffer hasn't changed — avoids resetting cursor blink
    if (lineBuffer === lastSuggestionInput && ghostSuffix) return;
    lastSuggestionInput = lineBuffer;
    clearGhost();
    const suggestion = findSuggestion(lineBuffer);
    if (suggestion) showGhost(suggestion);
  }

  function stampCurrentLine() {
    if (inAlternateScreen) return;
    const buf = terminal.buffer.active;
    const absLine = buf.baseY + buf.cursorY;
    // Always update timestamp so every line with new data gets a time
    lineTimestamps[absLine] = formatTime(new Date());
  }

  let lastDetectedCwd = '';
  let cwdDetectTimer: ReturnType<typeof setTimeout> | null = null;

  function detectCwdFromPrompt() {
    const buf = terminal.buffer.active;
    const cursorLine = buf.getLine(buf.baseY + buf.cursorY);
    if (!cursorLine) return;
    const lineText = cursorLine.translateToString(true);
    if (!lineText) return;

    // Match common prompt patterns:
    // "user@host:path$" or "user@host:path# " (bash default)
    // "root@YSA-2504-1064:/home/luotang#" — path may contain slashes
    // "[user@host path]$" (CentOS/RHEL style)
    let cwd = '';

    // Pattern 1: user@host:path$ or user@host:path# (path is between : and $ or #)
    const m1 = lineText.match(/@[^:]+:([^\s$#]+)\s*[$#]/);
    if (m1) {
      cwd = m1[1];
    }

    // Pattern 2: [user@host path]$ — path is last word before ]
    if (!cwd) {
      const m2 = lineText.match(/\[[^\]]*\s+([^\]\s]+)\]\s*[$#]/);
      if (m2) cwd = m2[1];
    }

    if (!cwd || cwd === lastDetectedCwd) return;
    lastDetectedCwd = cwd;

    // Expand ~ to home directory path
    if (cwd === '~') {
      const userMatch = lineText.match(/(\w+)@/);
      if (userMatch) {
        const user = userMatch[1];
        cwd = user === 'root' ? '/root' : `/home/${user}`;
      }
    } else if (cwd.startsWith('~/')) {
      const userMatch = lineText.match(/(\w+)@/);
      if (userMatch) {
        const user = userMatch[1];
        const home = user === 'root' ? '/root' : `/home/${user}`;
        cwd = home + cwd.slice(1);
      }
    }

    useAppStore.getState().setSessionCwd(sessionId, cwd);
  }

  function scheduleCwdDetect() {
    if (cwdDetectTimer) clearTimeout(cwdDetectTimer);
    cwdDetectTimer = setTimeout(() => {
      cwdDetectTimer = null;
      if (!disposed) detectCwdFromPrompt();
    }, 150);
  }

  const dataDisposable = terminal.onData((data) => {
    // Send keystrokes before command-history persistence or suggestion work.
    const accepted = !inAlternateScreen && data === '\x1b[C' && ghostSuffix ? ghostSuffix : null;
    window.api.ssh.write(sessionId, accepted ?? data);
    try {
      if (!inAlternateScreen) {
        if (accepted) {
          clearGhost();
          lineBuffer += accepted;
          suppressSuggestion = false;
          return;
        }

        clearGhost();

        if (data === '\r') {
          // Read the actual command line from xterm buffer (includes tab-completed text)
          const buf = terminal.buffer.active;
          const cursorLine = buf.getLine(buf.baseY + buf.cursorY);
          if (cursorLine) {
            const fullLine = cursorLine.translateToString(true).trim();
            // Strip common prompt patterns: "user@host:path# cmd" or "user@host:path$ cmd"
            const promptMatch = fullLine.match(/[$#%>]\s*(.*)/);
            const cmd = promptMatch ? promptMatch[1].trim() : fullLine;
            if (cmd) {
              useAppStore.getState().addCommand(sessionId, cmd);
            }
          }
          lineBuffer = '';
          suppressSuggestion = false;
        } else if (data === '\x7f' || data === '\b') {
          lineBuffer = lineBuffer.slice(0, -1);
          suppressSuggestion = false;
        } else if (data === '\x03') {
          lineBuffer = '';
          suppressSuggestion = false;
        } else if (data === '\t') {
          // Tab key — suppress ghost suggestions until next normal input
          // to avoid escape sequences interfering with bash tab completion output
          suppressSuggestion = true;
        } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
          lineBuffer += data;
          suppressSuggestion = false;
        } else if (data.length > 1 && !data.startsWith('\x1b')) {
          lineBuffer += data;
          suppressSuggestion = false;
        } else {
          // Escape sequences (arrow keys etc.) — suppress suggestions
          suppressSuggestion = true;
        }
      }
    } catch (e) {
      console.error('[Terminal] Command tracking error:', e);
    }
  });

  const unsubData = window.api.ssh.onData(sessionId, (data) => {
    if (data.includes('\x1b[?1049h') || data.includes('\x1b[?47h') || data.includes('\x1b[?1047h')) {
      inAlternateScreen = true;
      lineBuffer = '';
      clearGhost();
    }
    if (data.includes('\x1b[?1049l') || data.includes('\x1b[?47l') || data.includes('\x1b[?1047l')) {
      inAlternateScreen = false;
      lineBuffer = '';
    }
    // Detect clear screen sequences
    const isClear = data.includes('\x1b[2J') || data.includes('\x1bc');

    // Clear ghost overlay (DOM-based, no terminal escape sequences needed)
    if (ghostSuffix) clearGhost();

    // xterm.write queues parsing; reading its cursor immediately observes old data.
    terminal.write(data, () => {
      if (disposed) return;
      if (isClear) lineTimestamps.length = 0;
      stampCurrentLine();
      renderGutter();
      if (!inAlternateScreen && lineBuffer) updateSuggestion();
      if (!inAlternateScreen) scheduleCwdDetect();
    });
  });

  const unsubClose = window.api.ssh.onClose(sessionId, () => {
    terminal.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
    renderGutter();
  });
  const unsubError = window.api.ssh.onError(sessionId, (error) => {
    terminal.write(`\r\n\x1b[31m[Error: ${error}]\x1b[0m\r\n`);
    renderGutter();
  });
  const resizeDisposable = terminal.onResize(({ cols, rows }) => {
    window.api.ssh.resize(sessionId, cols, rows);
    renderGutter();
  });

  // Scroll sync: re-render gutter when terminal scrolls
  const scrollDisposable = terminal.onScroll(() => {
    renderGutter();
  });

  // Also re-render on linefeed
  const lineFeedDisposable = terminal.onLineFeed(() => {
    stampCurrentLine();
    renderGutter();
  });

  // Auto-copy on selection
  const selectionDisposable = terminal.onSelectionChange(() => {
    const sel = terminal.getSelection();
    if (sel) {
      window.api.clipboard.writeText(sel);
    }
  });

  const ipcCleanup = () => {
    disposed = true;
    cancelGutterRender();
    if (cwdDetectTimer !== null) clearTimeout(cwdDetectTimer);
    cwdDetectTimer = null;
    dataDisposable.dispose();
    resizeDisposable.dispose();
    scrollDisposable.dispose();
    lineFeedDisposable.dispose();
    selectionDisposable.dispose();
    unsubData();
    unsubClose();
    unsubError();
  };

  cached = {
    terminal,
    fitAddon,
    wrapper,
    initialized: false,
    ipcCleanup,
    ghostOverlay,
    gutter: {
      lineTimestamps,
      canvas: gutterCanvas,
      lastViewportTop,
      render: renderGutter,
      cancelRender: cancelGutterRender,
      disposables: [],
    },
  };
  terminalCache.set(sessionId, cached);
  return cached;
}

/** Get the actual rendered cell height from xterm's internal dimensions */
function getCellHeight(terminal: Terminal): number {
  // xterm exposes cell dimensions via _core (internal API)
  try {
    const dims = (terminal as any)._core?._renderService?.dimensions;
    if (dims?.css?.cell?.height) return dims.css.cell.height;
  } catch { /* ignore */ }
  // Fallback: estimate from font size
  return Math.ceil(terminal.options.fontSize! * 1.2);
}

export default function TerminalView({ sessionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appTheme = useAppStore((s) => s.theme);
  const terminalConfig = useAppStore((s) => s.terminalConfig);
  const gutterVisible = useAppStore((s) => s.timestampGutterVisible);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const isDark = appTheme === 'dark';
    const cached = getOrCreateTerminal(sessionId, isDark, terminalConfig);
    const { terminal, fitAddon, wrapper } = cached;

    // Initialize terminal DOM — open into the right-side termContainer
    if (!cached.initialized) {
      const termContainer = wrapper.children[1] as HTMLDivElement;
      terminal.open(termContainer);
      // Attach ghost suggestion overlay to xterm's screen element
      const xtermScreen = terminal.element?.querySelector('.xterm-screen');
      if (xtermScreen) {
        (xtermScreen as HTMLElement).style.position = 'relative';
        xtermScreen.appendChild(cached.ghostOverlay);
      }
      cached.initialized = true;
    }

    // Keep the cached terminal in sync with the current font settings.
    const nextConfig = getTerminalConfig(isDark, terminalConfig);
    terminal.options.fontFamily = nextConfig.fontFamily;
    terminal.options.fontSize = nextConfig.fontSize;
    terminal.options.theme = nextConfig.theme;

    // Update gutter canvas background on theme change
    const gutterCanvas = cached.gutter.canvas;
    gutterCanvas.style.backgroundColor = isDark ? '#242423' : '#F9F9F7';

    // Update gutter visibility
    gutterCanvas.style.display = gutterVisible ? 'block' : 'none';
    gutterCanvas.style.width = gutterVisible ? `${GUTTER_WIDTH}px` : '0px';

    // Move wrapper into this container
    container.appendChild(wrapper);

    let detached = false;
    let fitFrame: number | null = null;
    // ResizeObserver notifies us when a hidden container becomes visible again.
    // Do not poll a zero-sized container: old retry loops survive tab changes.
    const doFit = () => {
      if (!detached && container.isConnected && container.offsetWidth > 0 && container.offsetHeight > 0) {
        try {
          fitAddon.fit();
          cached.gutter.render();
        } catch { /* ignore */ }
      }
    };
    const scheduleFit = () => {
      if (detached || fitFrame !== null) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null;
        doFit();
      });
    };
    const initialFrame = requestAnimationFrame(() => {
      if (detached) return;
      terminal.focus();
      doFit();
    });
    const initialFitTimer = setTimeout(scheduleFit, 300);

    // Observe container resize
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        const selection = terminal.getSelection();
        if (selection) window.api.clipboard.writeText(selection);
        e.preventDefault();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        const text = window.api.clipboard.readText();
        if (text) {
          cached.ghostOverlay.style.display = 'none';
          cached.ghostOverlay.textContent = '';
          terminal.paste(text);
        }
        e.preventDefault();
      }
    };
    container.addEventListener('keydown', handleKeyDown);

    // Right-click paste — use terminal.paste() so it goes through onData callback
    // which properly updates lineBuffer and clears ghost suggestion
    const handleContextMenu = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const text = window.api.clipboard.readText();
      if (text) {
        cached.ghostOverlay.style.display = 'none';
        cached.ghostOverlay.textContent = '';
        // Use terminal.paste() — this triggers terminal.onData with the pasted text,
        // so lineBuffer gets updated and ghost is properly cleared
        terminal.paste(text);
        terminal.focus();
      }
    };
    // xterm renders a textarea inside its element for input capture
    const xtermTextarea = terminal.element?.querySelector('textarea');
    const xtermScreen = terminal.element?.querySelector('.xterm-screen');
    if (xtermTextarea) xtermTextarea.addEventListener('contextmenu', handleContextMenu, true);
    if (xtermScreen) xtermScreen.addEventListener('contextmenu', handleContextMenu, true);
    if (terminal.element) terminal.element.addEventListener('contextmenu', handleContextMenu, true);
    container.addEventListener('contextmenu', handleContextMenu, true);

    return () => {
      detached = true;
      cancelAnimationFrame(initialFrame);
      clearTimeout(initialFitTimer);
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      cached.gutter.cancelRender();
      resizeObserver.disconnect();
      container.removeEventListener('keydown', handleKeyDown);
      if (xtermTextarea) xtermTextarea.removeEventListener('contextmenu', handleContextMenu, true);
      if (xtermScreen) xtermScreen.removeEventListener('contextmenu', handleContextMenu, true);
      if (terminal.element) terminal.element.removeEventListener('contextmenu', handleContextMenu, true);
      container.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, [
    sessionId,
    appTheme,
    gutterVisible,
    terminalConfig.fontFamily,
    terminalConfig.fontSize,
    terminalConfig.colorScheme
  ]);

  const bgColor = appTheme === 'dark' ? '#242423' : '#F9F9F7';

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
export function getTerminalSize(sessionId: string): { cols: number; rows: number } | null {
  const cached = terminalCache.get(sessionId);
  if (!cached) return null;
  return { cols: cached.terminal.cols, rows: cached.terminal.rows };
}

export function refitTerminal(sessionId: string): void {
  const cached = terminalCache.get(sessionId);
  if (!cached) return;
  try {
    cached.fitAddon.fit();
    cached.gutter.render();
  } catch { /* ignore */ }
}
