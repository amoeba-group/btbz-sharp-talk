import {
  LANGUAGES,
  LANGUAGE_CODES,
  SESSION_LANGUAGE,
  isOfferedLanguage,
  isSupportedLanguage,
  languageByCode,
  offeredLanguageCodes,
  languageBySession,
  localized,
  sessionLanguageForLocale,
  sessionLanguageForTimezone,
} from './language';

describe('language registry', () => {
  it('registers the six system languages in display order', () => {
    expect(LANGUAGE_CODES).toEqual(['en', 'es', 'ko', 'vi', 'ja', 'zh']);
  });

  it('keeps codes and session values unique and in step', () => {
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGES.length);
    expect(new Set(LANGUAGES.map((l) => l.session)).size).toBe(LANGUAGES.length);
    for (const lang of LANGUAGES) {
      expect(lang.session).toBe(lang.code.toUpperCase());
      expect(lang.nativeLabel.trim()).not.toBe('');
    }
  });

  it('marks the three new languages as awaiting native review', () => {
    const pending = LANGUAGES.filter((l) => !l.reviewed).map((l) => l.code);
    expect(pending).toEqual(['vi', 'ja', 'zh']);
  });

  it('looks a language up by either code or session value, case-insensitively', () => {
    expect(languageByCode('JA')?.session).toBe('JA');
    expect(languageBySession('vi')?.code).toBe('vi');
    expect(languageByCode('th')).toBeUndefined();
    expect(isSupportedLanguage('zh')).toBe(true);
    expect(isSupportedLanguage(null)).toBe(false);
  });
});

describe('sessionLanguageForLocale', () => {
  it.each([
    ['ko', SESSION_LANGUAGE.KO],
    ['es-ES', SESSION_LANGUAGE.ES],
    ['vi-VN', SESSION_LANGUAGE.VI],
    ['ja-JP', SESSION_LANGUAGE.JA],
    ['zh-CN', SESSION_LANGUAGE.ZH],
    ['EN-us', SESSION_LANGUAGE.EN],
  ])('maps %s → %s', (locale, expected) => {
    expect(sessionLanguageForLocale(locale)).toBe(expected);
  });

  // Documented consequence of registering Chinese as Simplified only: a
  // Traditional locale resolves to Simplified until a zh-TW row exists.
  it('resolves Traditional Chinese locales to Simplified for now', () => {
    expect(sessionLanguageForLocale('zh-TW')).toBe(SESSION_LANGUAGE.ZH);
    expect(sessionLanguageForLocale('zh-Hant-HK')).toBe(SESSION_LANGUAGE.ZH);
  });

  it('returns null for unknown or empty locales so the caller can fall back', () => {
    expect(sessionLanguageForLocale('th-TH')).toBeNull();
    expect(sessionLanguageForLocale('')).toBeNull();
    expect(sessionLanguageForLocale(undefined)).toBeNull();
  });
});

describe('sessionLanguageForTimezone', () => {
  it.each([
    ['Asia/Seoul', SESSION_LANGUAGE.KO],
    ['America/New_York', SESSION_LANGUAGE.EN],
    ['america/los_angeles', SESSION_LANGUAGE.EN],
    ['Asia/Ho_Chi_Minh', SESSION_LANGUAGE.VI],
    ['Asia/Tokyo', SESSION_LANGUAGE.JA],
    ['Asia/Shanghai', SESSION_LANGUAGE.ZH],
  ])('maps %s → %s', (tz, expected) => {
    expect(sessionLanguageForTimezone(tz)).toBe(expected);
  });

  it('returns null for unmapped zones', () => {
    expect(sessionLanguageForTimezone('Europe/Berlin')).toBeNull();
    expect(sessionLanguageForTimezone(null)).toBeNull();
  });
});

describe('localized', () => {
  it('prefers the requested language', () => {
    expect(localized({ EN: 'Hello', JA: 'こんにちは' }, 'JA')).toBe('こんにちは');
  });

  it('falls back to English when the language is missing, unknown, or nullish', () => {
    expect(localized({ EN: 'Hello' }, 'VI')).toBe('Hello');
    expect(localized({ EN: 'Hello' }, 'th')).toBe('Hello');
    expect(localized({ EN: 'Hello' }, null)).toBe('Hello');
  });

  it('accepts a lowercase language code', () => {
    expect(localized({ EN: 'Hello', ZH: '你好' }, 'zh')).toBe('你好');
  });

  it('returns an empty string rather than undefined when nothing matches', () => {
    expect(localized({ KO: '안녕' }, 'VI')).toBe('');
    expect(localized(undefined, 'EN')).toBe('');
  });
});

/** PLN-261019-Widget-Language-Follow-Selection — a tenant's offered languages. */
describe('offeredLanguages / isOfferedLanguage', () => {
  it('null or empty offers every registered language', () => {
    expect(offeredLanguageCodes(null)).toEqual(LANGUAGE_CODES);
    expect(offeredLanguageCodes([])).toEqual(LANGUAGE_CODES);
    expect(isOfferedLanguage('KO', null)).toBe(true);
  });

  it('keeps registry order, adds English, drops unknown codes and duplicates', () => {
    expect(offeredLanguageCodes(['vi', 'ko', 'th', 'vi'])).toEqual(['en', 'ko', 'vi']);
    expect(offeredLanguageCodes(['VI'])).toEqual(['en', 'vi']);
  });

  it('answers for codes and session values alike', () => {
    expect(isOfferedLanguage('ko', ['vi', 'en'])).toBe(false);
    expect(isOfferedLanguage('KO', ['vi', 'en'])).toBe(false);
    expect(isOfferedLanguage('VI', ['vi'])).toBe(true);
    expect(isOfferedLanguage('en', ['vi'])).toBe(true);
    expect(isOfferedLanguage('th', null)).toBe(false);
    expect(isOfferedLanguage(null, ['vi'])).toBe(false);
  });
});
