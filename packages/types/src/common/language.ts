/**
 * The system's language registry — the single source of truth for "which
 * languages does SharpTalk speak" (REQ-260817 §1a / PLN-260817 §1).
 *
 * Before this file the list lived in five places (SESSION_LANGUAGE, four apps'
 * SUPPORTED_LANGUAGES) plus eight `'EN' | 'ES' | 'KO'` type literals and six UI
 * label maps. Every lookup on those paths ends in `?? EN`, so missing one spot
 * did not fail — it silently served English. Adding a seventh language should
 * be one row here plus the translation files, nothing else.
 *
 * Chinese is registered as `zh` meaning Simplified (zh-Hans). Traditional, if
 * it is ever needed, joins as its own `zh-TW` row rather than a variant of this
 * one; until then `zh-TW`/`zh-HK` browsers resolve to Simplified.
 */

export interface LanguageDef {
  /** i18next language code, and what the browser/localStorage carries. */
  code: string;
  /** What `session.language` stores (varchar(8)) and the backend copy maps key on. */
  session: SessionLanguage;
  /** Endonym for language pickers — a reader who needs this language can read it. */
  nativeLabel: string;
  /** Two/three-char form for width-constrained spots (the widget header). */
  shortLabel: string;
  /**
   * false = LLM first-pass translation awaiting native review. Surfaced as a β
   * badge in the console and the apps; deliberately NOT shown to shoppers in
   * the widget, where it would dent trust without changing any decision.
   */
  reviewed: boolean;
  /**
   * IANA timezones whose tenants default to this language when the shopper
   * expressed no preference (SessionService.languageForTimezone). Entries are
   * matched by prefix, so 'america/' covers every US/CA zone.
   */
  timezones?: readonly string[];
  /**
   * The zone to offer in the console's timezone picker. Separate from
   * `timezones` because a matching prefix ('america/') is not itself a zone a
   * tenant can be asked to choose.
   */
  pickerTimezone?: string;
}

export const LANGUAGES: readonly LanguageDef[] = [
  {
    code: 'en',
    session: 'EN',
    nativeLabel: 'English',
    shortLabel: 'EN',
    reviewed: true,
    timezones: ['america/'],
    pickerTimezone: 'America/New_York',
  },
  { code: 'es', session: 'ES', nativeLabel: 'Español', shortLabel: 'ES', reviewed: true },
  {
    code: 'ko',
    session: 'KO',
    nativeLabel: '한국어',
    shortLabel: 'KO',
    reviewed: true,
    timezones: ['asia/seoul'],
    pickerTimezone: 'Asia/Seoul',
  },
  {
    code: 'vi',
    session: 'VI',
    nativeLabel: 'Tiếng Việt',
    shortLabel: 'VI',
    reviewed: false,
    timezones: ['asia/ho_chi_minh'],
    pickerTimezone: 'Asia/Ho_Chi_Minh',
  },
  {
    code: 'ja',
    session: 'JA',
    nativeLabel: '日本語',
    shortLabel: 'JA',
    reviewed: false,
    timezones: ['asia/tokyo'],
    pickerTimezone: 'Asia/Tokyo',
  },
  {
    code: 'zh',
    session: 'ZH',
    nativeLabel: '简体中文',
    shortLabel: 'ZH',
    reviewed: false,
    timezones: ['asia/shanghai', 'asia/chongqing', 'asia/harbin', 'asia/urumqi'],
    pickerTimezone: 'Asia/Shanghai',
  },
] as const;

/** Zones the console offers as "default language by timezone", with their label. */
export const LANGUAGE_TIMEZONES = LANGUAGES.filter((l) => l.pickerTimezone).map((l) => ({
  zone: l.pickerTimezone as string,
  label: l.nativeLabel,
}));

/** i18next codes, in display order. */
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

/** Session-language values, in display order. */
export const SESSION_LANGUAGE_CODES = LANGUAGES.map((l) => l.session);

export const SESSION_LANGUAGE = {
  EN: 'EN',
  ES: 'ES',
  KO: 'KO',
  VI: 'VI',
  JA: 'JA',
  ZH: 'ZH',
} as const;
export type SessionLanguage = (typeof SESSION_LANGUAGE)[keyof typeof SESSION_LANGUAGE];

/**
 * Text carried per language — tenant-editable copy (widget greetings, scenario
 * replies, handoff notices) and the built-in message tables. Always partial:
 * a language the tenant never filled in falls back to English at read time.
 */
export type LocalizedText = Partial<Record<SessionLanguage, string>>;

/** Pick `text` for `lang`, falling back to English (then to '' if that is empty too). */
export function localized(text: LocalizedText | undefined, lang: string | null | undefined): string {
  if (!text) return '';
  const key = String(lang ?? '').toUpperCase() as SessionLanguage;
  return text[key] ?? text.EN ?? '';
}

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));
const BY_SESSION = new Map(LANGUAGES.map((l) => [l.session, l]));

export function languageByCode(code: string | null | undefined): LanguageDef | undefined {
  return BY_CODE.get(String(code ?? '').toLowerCase());
}

export function languageBySession(session: string | null | undefined): LanguageDef | undefined {
  return BY_SESSION.get(String(session ?? '').toUpperCase() as SessionLanguage);
}

export function isSupportedLanguage(code: string | null | undefined): boolean {
  return BY_CODE.has(String(code ?? '').toLowerCase());
}

/**
 * Which languages a tenant's widget offers (PLN-261019-Widget-Language-Follow-Selection).
 *
 * `saved` is `tenants.widget_languages`: lowercase codes in display order, or
 * null/empty for "every registered language" — the behaviour every tenant had
 * before the column existed. Unknown codes are dropped rather than rejected, so
 * a language removed from the registry cannot wedge a tenant's picker.
 *
 * English is always in the result (D3). It is the floor everything else falls
 * back to — system copy, scenario text, the start language for a browser whose
 * language the tenant does not offer — and a list without it would have no
 * floor to fall to.
 */
export function offeredLanguages(saved: readonly string[] | null | undefined): LanguageDef[] {
  const wanted = new Set(
    (saved ?? []).map((c) => String(c ?? '').trim().toLowerCase()).filter((c) => BY_CODE.has(c)),
  );
  if (wanted.size === 0) return [...LANGUAGES];
  wanted.add('en');
  // Registry order, not saved order: the picker reads the same top to bottom
  // for every tenant, and a saved list cannot smuggle in a duplicate.
  return LANGUAGES.filter((l) => wanted.has(l.code));
}

/** Lowercase codes of `offeredLanguages(saved)`, in display order. */
export function offeredLanguageCodes(saved: readonly string[] | null | undefined): string[] {
  return offeredLanguages(saved).map((l) => l.code);
}

/**
 * Is `lang` (a code like 'ko' or a session value like 'KO') among the
 * languages `saved` offers? Null/empty `saved` offers everything.
 */
export function isOfferedLanguage(
  lang: string | null | undefined,
  saved: readonly string[] | null | undefined,
): boolean {
  const code = languageBySession(lang)?.code ?? languageByCode(lang)?.code;
  if (!code) return false;
  return offeredLanguages(saved).some((l) => l.code === code);
}

/**
 * A BCP-47 locale ('ko', 'es-ES', 'zh-TW', 'pt') → session language, or null
 * when nothing matches. Prefix matching is deliberate: platforms hand us
 * region-tagged locales we do not enumerate, and `zh-TW` resolving to
 * Simplified is the documented behaviour until a Traditional row exists.
 */
export function sessionLanguageForLocale(locale: string | null | undefined): SessionLanguage | null {
  const l = String(locale ?? '')
    .trim()
    .toLowerCase();
  if (!l) return null;
  const exact = BY_CODE.get(l.split('-')[0]);
  return exact ? exact.session : null;
}

/**
 * Tenant timezone → default session language, or null when unmapped (the
 * caller then falls back to English). Matching is by prefix so a continent-wide
 * entry like 'america/' covers every US/CA zone without listing them.
 */
export function sessionLanguageForTimezone(
  timezone: string | null | undefined,
): SessionLanguage | null {
  const tz = String(timezone ?? '')
    .trim()
    .toLowerCase();
  if (!tz) return null;
  for (const lang of LANGUAGES) {
    for (const prefix of lang.timezones ?? []) {
      if (tz === prefix || tz.startsWith(prefix)) return lang.session;
    }
  }
  return null;
}
