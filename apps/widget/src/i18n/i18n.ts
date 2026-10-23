import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
// Imported from source, not through '@sharptalk/types': the package publishes CJS, and
// Rollup cannot trace a named export through its `export *` chain, so a value
// import of the entry point fails the widget build ("not exported by dist/index.js").
// Types come through the package as usual; only this runtime table takes the
// source path, which keeps the language list genuinely shared rather than copied.
import { LANGUAGES, LANGUAGE_CODES } from '../../../../packages/types/src/common/language';
import { en } from './locales/en';
import { es } from './locales/es';
import { ko } from './locales/ko';
import { vi } from './locales/vi';
import { ja } from './locales/ja';
import { zh } from './locales/zh';

export const LANG_STORAGE_KEY = 'ivy_lang';
/** Per-shop cache of the languages the tenant offers (PLN-261019): `ivy_langs:<shop>`. */
const OFFERED_CACHE_PREFIX = 'ivy_langs:';

/**
 * Which languages the widget offers — derived from the shared registry so the
 * widget, the console and the backend cannot drift apart (REQ-260817 §1a).
 */
export const SUPPORTED_LANGUAGES = LANGUAGE_CODES;
export type SupportedLanguage = string;

/** Endonym + short label per code, for the header picker. */
export const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({
  code: l.code,
  nativeLabel: l.nativeLabel,
  shortLabel: l.shortLabel,
}));

/**
 * What the browser says this shopper reads, when we support it (PLN-260813 D4).
 *
 * Starting everyone at English meant a Korean shopper got an English greeting
 * and English system notices until they found the language switcher — and the
 * session language the server derived from that hint stayed English too
 * (REQ-260813 G1). `navigator.language` is a preference the shopper already
 * expressed; there is no reason to ignore it.
 */
export function browserLanguage(): SupportedLanguage | null {
  const tag = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
  const base = tag.toLowerCase().split('-')[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base)
    ? (base as SupportedLanguage)
    : null;
}

/** The `?shop=` the loader put in the iframe URL — the cache key for the offered list. */
function shopFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get('shop') ?? '';
  } catch {
    return '';
  }
}

/**
 * Languages this tenant offered the last time the session was ensured, or
 * null when nothing is cached (first visit, cleared storage). The server's
 * answer is the truth; this only stops the first paint from showing a language
 * the picker is about to take away (PLN-261019 P4).
 */
export function cachedOfferedLanguages(): string[] | null {
  try {
    const raw = localStorage.getItem(OFFERED_CACHE_PREFIX + shopFromUrl());
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(list)) return null;
    const codes = list.filter((c): c is string => typeof c === 'string' && SUPPORTED_LANGUAGES.includes(c));
    return codes.length ? codes : null;
  } catch {
    return null;
  }
}

export function cacheOfferedLanguages(codes: readonly string[]): void {
  try {
    localStorage.setItem(OFFERED_CACHE_PREFIX + shopFromUrl(), JSON.stringify(codes));
  } catch {
    /* ignore storage failures */
  }
}

/**
 * The language the embedding page chose in its config (`?locale=` with
 * `host_locale=1`, PLN-261023), or null when the loader only guessed it.
 * Go2Joy HA passes the user's HA language here.
 */
export function hostLocale(): SupportedLanguage | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('host_locale') !== '1') return null;
    const code = (params.get('locale') || '').toLowerCase().split('-')[0];
    return (SUPPORTED_LANGUAGES as readonly string[]).includes(code) ? (code as SupportedLanguage) : null;
  } catch {
    return null;
  }
}

/**
 * Language to open in: the host page's choice, else manual pick, else browser,
 * else English — each only if the tenant offers it (cached list; everything
 * when unknown). The host outranks a stored pick: its language switch reloads
 * the page with the new choice, which must win over a pick from another visit.
 */
export function initialLanguage(): SupportedLanguage {
  const offered = cachedOfferedLanguages();
  const offers = (code: string) => !offered || offered.includes(code);
  const host = hostLocale();
  if (host && offers(host)) return host;
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && SUPPORTED_LANGUAGES.includes(stored) && offers(stored)) {
      return stored;
    }
  } catch {
    /* ignore storage failures */
  }
  // A manual pick outranks the browser; a browser language the tenant does not
  // offer falls to English (PLN-261019 D1), which is also what the server
  // settles on for it.
  const browser = browserLanguage();
  return browser && offers(browser) ? browser : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    ko: { translation: ko },
    vi: { translation: vi },
    ja: { translation: ja },
    zh: { translation: zh },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  defaultNS: 'translation',
  interpolation: {
    escapeValue: false,
  },
});

// Han characters are shared between Japanese and Chinese but drawn differently;
// without a lang attribute the browser picks glyph shapes by font order alone,
// so a Japanese shopper can end up reading Chinese-shaped kanji.
if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language;
}

export default i18n;
