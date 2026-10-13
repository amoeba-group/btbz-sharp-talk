import {
  aiRegionName,
  hasUnfilledPlaceholder,
  interpolateNoticeLine,
  isPrivacyProfile,
  normalizePrivacyNoticeCopy,
  PRIVACY_NOTICE_KEYS,
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

/**
 * vn_pdpl (PLN-261012 SG-70, REQ D-17). The Vietnamese partner notice used to
 * be the bundled CCPA/Google Analytics text with "365 days" and "United States"
 * frozen in. The properties that matter: it never falls back to that text, the
 * numbers come from the server, and an unfinished draft is detectable.
 */
describe('vn_pdpl profile', () => {
  const ctx = { retentionDays: 180, region: 'US' };

  it('is a selectable profile and survives the "unknown value" check', () => {
    expect(isPrivacyProfile('vn_pdpl')).toBe(true);
    expect(resolvePrivacyProfile('vn_pdpl', true)).toBe('vn_pdpl');
    // Fits the varchar(16) column the profile is stored in.
    expect('vn_pdpl'.length).toBeLessThanOrEqual(16);
  });

  it('supplies every key in vi and en, so the bundled CCPA text is never reached', () => {
    for (const lang of ['VI', 'EN'] as const) {
      const notice = privacyProfileCopy('vn_pdpl', lang, ctx);
      for (const key of PRIVACY_NOTICE_KEYS) {
        expect(notice[key]?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('carries none of the CCPA / Google Analytics wording', () => {
    for (const lang of ['VI', 'EN'] as const) {
      const all = Object.values(privacyProfileCopy('vn_pdpl', lang, ctx)).join(' ');
      expect(all).not.toMatch(/CCPA|CPRA|Google|Analytics|GA4|365/i);
    }
  });

  it('interpolates the retention window and region from the server context', () => {
    const vi = privacyProfileCopy('vn_pdpl', 'VI', ctx);
    expect(vi.retention).toContain('180 ngày');
    expect(vi.aiProcessor).toContain('Hoa Kỳ');
    expect(vi.crossBorder).toContain('Hoa Kỳ');
    const en = privacyProfileCopy('vn_pdpl', 'EN', { retentionDays: 30, region: 'SG' });
    expect(en.retention).toContain('30 days');
    expect(en.crossBorder).toContain('Singapore');
    // No token may survive once a context is supplied.
    for (const text of Object.values(vi)) expect(text).not.toContain('{{');
  });

  it('a language without profile copy reads the EN lines, with an English region name', () => {
    const ko = privacyProfileCopy('vn_pdpl', 'KO', ctx);
    expect(ko.title).toBe(privacyProfileCopy('vn_pdpl', 'EN', ctx).title);
    expect(ko.crossBorder).toContain('the United States');
    expect(ko.crossBorder).not.toContain('미국');
  });

  it('interpolates inside a tenant override too, in the override language', () => {
    const out = resolvePrivacyNotice(
      'vn_pdpl',
      { VI: { retention: 'Chúng tôi giữ {{retentionDays}} ngày tại {{region}}.' } },
      'VI',
      ctx,
    );
    expect(out.retention).toBe('Chúng tôi giữ 180 ngày tại Hoa Kỳ.');
  });

  it('names the controller, the recipients and the rights', () => {
    const vi = privacyProfileCopy('vn_pdpl', 'VI', ctx);
    expect(vi.controller).toMatch(/Bên kiểm soát/);
    expect(vi.aiProcessor).toMatch(/Anthropic/);
    expect(vi.aiProcessor).toMatch(/Voyage/);
    expect(vi.rights).toMatch(/rút lại/);
  });

  it('keeps the controller placeholders detectable until the tenant fills them', () => {
    const draft = privacyProfileCopy('vn_pdpl', 'EN', ctx);
    expect(hasUnfilledPlaceholder(draft.controller)).toBe(true);
    expect(hasUnfilledPlaceholder(draft.rights)).toBe(false);
    const filled = resolvePrivacyNotice(
      'vn_pdpl',
      { EN: { controller: 'Data controller: Go2Joy Vietnam JSC, Hanoi. DPO: dpo@example.com.' } },
      'EN',
      ctx,
    );
    expect(hasUnfilledPlaceholder(filled.controller)).toBe(false);
  });

  it('normalisation keeps the three new keys instead of dropping them as unknown', () => {
    expect(
      normalizePrivacyNoticeCopy({
        VI: { controller: 'a', crossBorder: 'b', rights: 'c', nope: 'x' },
      }),
    ).toEqual({ VI: { controller: 'a', crossBorder: 'b', rights: 'c' } });
  });

  it('does not change what the other profiles resolve to', () => {
    // Existing tenants must see byte-identical copy: no new key leaks into them.
    const lodging = privacyProfileCopy('lodging', 'VI', ctx);
    expect(Object.keys(lodging).sort()).toEqual(['items', 'purpose']);
  });
});

describe('interpolateNoticeLine / aiRegionName', () => {
  it('leaves the text alone when there is no context or no token', () => {
    expect(interpolateNoticeLine('kept {{retentionDays}}', 'EN', undefined)).toBe('kept {{retentionDays}}');
    expect(interpolateNoticeLine('plain', 'EN', { retentionDays: 5 })).toBe('plain');
  });

  it('tolerates spaces inside the braces and repeated tokens', () => {
    expect(interpolateNoticeLine('{{ retentionDays }} / {{retentionDays}}', 'EN', { retentionDays: 90 })).toBe('90 / 90');
  });

  it('passes an unknown region code through as written', () => {
    expect(aiRegionName('XX', 'VI')).toBe('XX');
    expect(aiRegionName('us', 'VI')).toBe('Hoa Kỳ');
  });
});
