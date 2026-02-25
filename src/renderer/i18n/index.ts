/**
 * Lightweight i18n — no external dependencies.
 * Uses Zustand for reactive language switching.
 */
import { create } from 'zustand';
import zh from './locales/zh';
import en from './locales/en';

export type Locale = 'zh' | 'en';
export type TranslationKey = keyof typeof zh;

const locales: Record<Locale, Record<string, string>> = { zh, en };

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

function getStoredLocale(): Locale {
  try { return (localStorage.getItem('xenoterm-locale') as Locale) || 'zh'; }
  catch { return 'zh'; }
}

function storeLocale(locale: Locale): void {
  try { localStorage.setItem('xenoterm-locale', locale); }
  catch { /* noop */ }
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: getStoredLocale(),
  setLocale: (locale) => {
    storeLocale(locale);
    set({ locale });
  },
}));

/** Main translation hook */
export function useT() {
  const locale = useI18nStore((s) => s.locale);
  const dict = locales[locale];

  /** Translate a key, with optional interpolation: t('key', { name: 'X' }) */
  function t(key: TranslationKey, params?: Record<string, string | number>): string {
    let text = dict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  }

  return t;
}

/** Non-hook version for use outside React components */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const locale = useI18nStore.getState().locale;
  const dict = locales[locale];
  let text = dict[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}
