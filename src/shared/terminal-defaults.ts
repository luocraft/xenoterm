import type { AppConfig } from './types';

export const BUNDLED_TERMINAL_FONT_FAMILY = "'XenoTerm Mono'";
export const LEGACY_TERMINAL_FONT_STACK = "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace";

export const DEFAULT_TERMINAL_FONT_STACK = [
  BUNDLED_TERMINAL_FONT_FAMILY,
  "'Cascadia Mono'",
  "'Cascadia Code'",
  "'JetBrains Mono'",
  "'Fira Code'",
  'monospace'
].join(', ');

export const DEFAULT_TERMINAL_CONFIG: AppConfig['terminal'] = {
  fontFamily: DEFAULT_TERMINAL_FONT_STACK,
  fontSize: 14,
  colorScheme: 'default'
};

export function normalizeTerminalConfig(
  terminalConfig?: Partial<AppConfig['terminal']>
): AppConfig['terminal'] {
  const fontFamily = !terminalConfig?.fontFamily || terminalConfig.fontFamily === LEGACY_TERMINAL_FONT_STACK
    ? DEFAULT_TERMINAL_CONFIG.fontFamily
    : terminalConfig.fontFamily;

  return {
    ...DEFAULT_TERMINAL_CONFIG,
    ...terminalConfig,
    fontFamily
  };
}

export const TERMINAL_FONT_OPTIONS = [
  { label: 'XenoTerm Mono (Built-in)', value: DEFAULT_TERMINAL_FONT_STACK },
  { label: 'Cascadia Mono', value: "'Cascadia Mono', monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', monospace" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Fira Code', value: "'Fira Code', monospace" },
  { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
  { label: 'System Monospace', value: 'monospace' }
] as const;
