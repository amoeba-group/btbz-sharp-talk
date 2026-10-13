import { LANGUAGES } from './language';
import {
  isValidKbVersionLabel,
  KB_UI_VERSION_MAX_LEN,
  KB_VERSION_CAVEAT_DEFAULTS,
  KB_VERSION_STATE,
  kbVersionCaveatText,
  kbVersionCaveatVariants,
  kbVersionState,
  normalizeKbVersion,
  sameKbVersion,
} from './kb-version';

/**
 * UI-version stamping (PLN-261012 SG-20). The axis is undecided (Go2Joy CSV says
 * v23.x, FR-010 says v0.4.1-v0.12.0), so everything here must work for an opaque
 * label: equality after normalisation, never ordering.
 */

describe('normalizeKbVersion', () => {
  // [input, comparison key]
  const matrix: Array<[string | null | undefined, string | null]> = [
    ['v23.3.0', '23.3.0'],
    ['V23.3.0', '23.3.0'],
    ['23.3.0', '23.3.0'],
    ['  v0.12.0  ', '0.12.0'],
    ['\tV0.4.1\n', '0.4.1'],
    ['v23.4.0-RC1', '23.4.0-rc1'],
    // The v is dropped only when a digit follows: these are labels, not "v + x".
    ['version2', 'version2'],
    ['vNext', 'vnext'],
    ['v', 'v'],
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
  ];
  it.each(matrix)('%j -> %j', (input, key) => {
    expect(normalizeKbVersion(input)).toBe(key);
  });

  it('strips a v only when a digit follows it, so "vv1.0" is left as typed', () => {
    expect(normalizeKbVersion('vv1.0')).toBe('vv1.0');
    expect(normalizeKbVersion('v1.0')).toBe('1.0');
  });
});

describe('sameKbVersion', () => {
  it('compares after normalising, in both axes the project has seen', () => {
    expect(sameKbVersion('v23.3.0', '23.3.0')).toBe(true);
    expect(sameKbVersion('V0.12.0', 'v0.12.0 ')).toBe(true);
    expect(sameKbVersion('v23.3.0', 'v23.4.0')).toBe(false);
    expect(sameKbVersion('v0.9.2', 'v0.12.0')).toBe(false);
  });

  it('is equality only: 0.10 is not 0.1, and there is no ordering', () => {
    expect(sameKbVersion('0.10', '0.1')).toBe(false);
    expect(sameKbVersion('0.9', '0.10')).toBe(false);
  });

  it('never matches a missing version, not even another missing one', () => {
    expect(sameKbVersion(null, null)).toBe(false);
    expect(sameKbVersion('', 'v1')).toBe(false);
    expect(sameKbVersion('v1', undefined)).toBe(false);
  });
});

describe('kbVersionState', () => {
  it('flags a document with no version as unversioned, with or without a reference', () => {
    expect(kbVersionState(null, 'v0.12.0')).toBe(KB_VERSION_STATE.UNVERSIONED);
    expect(kbVersionState('', 'v0.12.0')).toBe(KB_VERSION_STATE.UNVERSIONED);
    expect(kbVersionState('  ', null)).toBe(KB_VERSION_STATE.UNVERSIONED);
  });

  it('says unchecked while the tenant has no reference version', () => {
    expect(kbVersionState('v0.9.2', null)).toBe(KB_VERSION_STATE.UNCHECKED);
    expect(kbVersionState('v0.9.2', '  ')).toBe(KB_VERSION_STATE.UNCHECKED);
  });

  it('separates match from mismatch by normalised equality', () => {
    expect(kbVersionState('v0.12.0', '0.12.0')).toBe(KB_VERSION_STATE.MATCH);
    expect(kbVersionState('v0.9.2', 'v0.12.0')).toBe(KB_VERSION_STATE.MISMATCH);
    expect(kbVersionState('v23.3.0', 'v23.4.0')).toBe(KB_VERSION_STATE.MISMATCH);
  });
});

describe('isValidKbVersionLabel', () => {
  it.each(['v23.3.0', '0.12.0', 'V0.4.1', '2026-10', 'R5', 'v23.4.0-rc1', 'build_7+x'])('accepts %s', (v) => {
    expect(isValidKbVersionLabel(v)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['inner space', 'v23 .3'],
    ['leading dot', '.1'],
    ['leading dash', '-1'],
    ['slash', 'v1/2'],
    ['quote', "v1'; DROP"],
    ['unicode', 'v１.０'],
  ])('rejects %s', (_name, v) => {
    expect(isValidKbVersionLabel(v)).toBe(false);
  });

  it('allows exactly the column width and no more', () => {
    expect(isValidKbVersionLabel('v'.concat('1'.repeat(KB_UI_VERSION_MAX_LEN - 1)))).toBe(true);
    expect(isValidKbVersionLabel('v'.concat('1'.repeat(KB_UI_VERSION_MAX_LEN)))).toBe(false);
  });

  it('trims before judging, so a pasted trailing space is not an error', () => {
    expect(isValidKbVersionLabel(' v0.12.0 ')).toBe(true);
  });
});

describe('caveat copy', () => {
  it('has a built-in sentence for every language the product serves', () => {
    for (const l of LANGUAGES) {
      const text = kbVersionCaveatText(null, l.session);
      expect(text).toBe(KB_VERSION_CAVEAT_DEFAULTS[l.session]);
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it('is one sentence per language: no placeholder, no line break', () => {
    for (const text of Object.values(KB_VERSION_CAVEAT_DEFAULTS)) {
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toMatch(/\n/);
    }
  });

  it('uses the tenant wording for exactly the session language, else the built-in one', () => {
    const policy = { notice: { VI: 'Bản này theo giao diện cũ.' } };
    expect(kbVersionCaveatText(policy, 'vi')).toBe('Bản này theo giao diện cũ.');
    // No Vietnamese text under an English answer.
    expect(kbVersionCaveatText(policy, 'EN')).toBe(KB_VERSION_CAVEAT_DEFAULTS.EN);
  });

  it('ignores a blank tenant notice', () => {
    expect(kbVersionCaveatText({ notice: { EN: '   ' } }, 'EN')).toBe(KB_VERSION_CAVEAT_DEFAULTS.EN);
  });

  it('falls back to English for an unknown language', () => {
    expect(kbVersionCaveatText(null, 'th')).toBe(KB_VERSION_CAVEAT_DEFAULTS.EN);
  });

  it('lists every built-in plus the tenant overrides, trimmed and de-duplicated', () => {
    const variants = kbVersionCaveatVariants({ notice: { VI: '  Theo giao diện cũ.  ', KO: '' } });
    expect(variants).toHaveLength(7);
    expect(variants).toEqual(expect.arrayContaining(Object.values(KB_VERSION_CAVEAT_DEFAULTS)));
    expect(variants).toContain('Theo giao diện cũ.');
    expect(kbVersionCaveatVariants(null)).toHaveLength(6);
  });
});
