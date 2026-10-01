import {
  normalizePrivacyNoticeCopy,
  privacyProfileCopy,
  resolvePrivacyNotice,
  resolvePrivacyProfile,
} from './privacy-notice-copy';

/**
 * Consent notice copy (PLN-261001 §2). The notice is a legal text, so the
 * rules that matter most here are the ones about what must NOT happen: no
 * tenant's wording changes without someone choosing, and no line ever renders
 * empty because a box was left blank.
 */
describe('resolvePrivacyProfile', () => {
  it('uses the explicit choice when there is one', () => {
    expect(resolvePrivacyProfile('lodging', true)).toBe('lodging');
    expect(resolvePrivacyProfile('generic', true)).toBe('generic');
  });

  it('falls back to the commerce flag, so nobody’s notice changes on deploy', () => {
    expect(resolvePrivacyProfile(null, true)).toBe('commerce');
    expect(resolvePrivacyProfile(undefined, false)).toBe('generic');
  });

  it('treats an unknown stored value as unset rather than trusting it', () => {
    expect(resolvePrivacyProfile('hotel', true)).toBe('commerce');
  });
});

describe('profile copy', () => {
  it('says "order lookups" for commerce and "booking lookups" for lodging', () => {
    expect(privacyProfileCopy('commerce', 'KO').items).toContain('주문 조회');
    expect(privacyProfileCopy('lodging', 'KO').items).toContain('예약 조회');
    expect(privacyProfileCopy('commerce', 'EN').items).toContain('order lookups');
    expect(privacyProfileCopy('lodging', 'EN').items).toContain('booking lookups');
  });

  it('mentions neither for a generic tenant', () => {
    const items = privacyProfileCopy('generic', 'KO').items ?? '';
    expect(items).not.toContain('주문');
    expect(items).not.toContain('예약');
  });

  it('ships every supported language', () => {
    for (const lang of ['KO', 'EN', 'ES', 'VI', 'JA', 'ZH'] as const) {
      expect(privacyProfileCopy('lodging', lang).items?.length).toBeGreaterThan(0);
    }
  });
});

describe('normalizePrivacyNoticeCopy', () => {
  it('drops blanks — an empty box is not an edit', () => {
    expect(
      normalizePrivacyNoticeCopy({ KO: { items: '   ', purpose: '숙박 지원' } }),
    ).toEqual({ KO: { purpose: '숙박 지원' } });
  });

  it('ignores unknown keys and non-strings', () => {
    expect(
      normalizePrivacyNoticeCopy({ KO: { items: 'ok', nope: 'x', purpose: 42 } }),
    ).toEqual({ KO: { items: 'ok' } });
  });

  it('returns null when nothing survives, so the column stores NULL', () => {
    expect(normalizePrivacyNoticeCopy({ KO: { items: '' } })).toBeNull();
    expect(normalizePrivacyNoticeCopy(null)).toBeNull();
  });
});

describe('resolvePrivacyNotice', () => {
  it('prefers the tenant line, keeps the profile for the rest', () => {
    const out = resolvePrivacyNotice('lodging', { KO: { items: '수집 항목: 메시지만' } }, 'KO');
    expect(out.items).toBe('수집 항목: 메시지만');
    expect(out.purpose).toContain('숙박');
  });

  it('a language the tenant did not touch still reads the profile, not a blank', () => {
    const out = resolvePrivacyNotice('lodging', { KO: { items: '한국어만 수정' } }, 'JA');
    expect(out.items).toContain('予約照会');
  });

  it('falls back to the profile’s English when a language has no copy at all', () => {
    // Defensive: a language we ship but a profile has not been translated into
    // must still produce a sentence rather than an empty legal notice.
    const out = resolvePrivacyNotice('commerce', null, 'KO');
    expect(out.items?.length).toBeGreaterThan(0);
  });

  it('never emits an empty string for a key it cannot fill', () => {
    const out = resolvePrivacyNotice('generic', { EN: { title: '  ' } }, 'EN');
    expect(Object.values(out).every((v) => v && v.trim())).toBe(true);
    // `title` is not part of any profile, so it is simply absent — the widget
    // then renders its own bundled title.
    expect(out.title).toBeUndefined();
  });
});
