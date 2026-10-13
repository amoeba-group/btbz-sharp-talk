import { normalizeKbVersion } from '@sharptalk/types';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  activeKbReference,
  kbPolicyChangedBehaviour,
  kbUnversionedSql,
  kbVersionKeepSql,
  kbVersionMismatchSql,
  kbVersionNormSql,
  parseUiVersionInput,
  sanitizeKbVersionPolicy,
} from './kb-version.util';

/**
 * Server side of KB UI-version stamping (PLN-261012 SG-20): what is allowed into
 * `tenant_ai_config.kb_version_policy` and `kb_documents.ui_version`, and the
 * SQL spelling of the comparison. The axis (Go2Joy v23.x vs FR-010 v0.4.1-v0.12.0)
 * is undecided, so every case below runs on both.
 */

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof BusinessException ? e.errorCode : `unexpected: ${String(e)}`;
  }
};

describe('sanitizeKbVersionPolicy', () => {
  it('resets to "no stamping" for null / undefined', () => {
    expect(sanitizeKbVersionPolicy(null)).toBeNull();
    expect(sanitizeKbVersionPolicy(undefined)).toBeNull();
  });

  it('keeps a reference + mode, trimmed, and defaults the mode to caveat', () => {
    expect(sanitizeKbVersionPolicy({ referenceVersion: ' v0.12.0 ', onMismatch: 'hide' })).toEqual({
      referenceVersion: 'v0.12.0',
      onMismatch: 'hide',
    });
    expect(sanitizeKbVersionPolicy({ referenceVersion: 'v23.4.0' })).toEqual({
      referenceVersion: 'v23.4.0',
      onMismatch: 'caveat',
    });
  });

  it('accepts the snake_case spelling an API client may send', () => {
    expect(sanitizeKbVersionPolicy({ reference_version: 'v23.3.0', on_mismatch: 'off' })).toEqual({
      referenceVersion: 'v23.3.0',
      onMismatch: 'off',
    });
  });

  it('keeps tenant wording only for languages we serve, trimmed; drops blanks', () => {
    const out = sanitizeKbVersionPolicy({
      referenceVersion: 'v0.12.0',
      notice: { VI: '  Theo bản cũ.  ', EN: '   ', xx: 'ignored', KO: '구버전 기준' },
    });
    expect(out).toEqual({ referenceVersion: 'v0.12.0', onMismatch: 'caveat', notice: { KO: '구버전 기준', VI: 'Theo bản cũ.' } });
  });

  it('drops an empty notice object rather than storing {}', () => {
    expect(sanitizeKbVersionPolicy({ referenceVersion: 'v1', notice: { EN: '' } })).toEqual({
      referenceVersion: 'v1',
      onMismatch: 'caveat',
    });
  });

  it('forgets fields it does not know', () => {
    const out = sanitizeKbVersionPolicy({ referenceVersion: 'v1', onMismatch: 'hide', evil: '<script>' });
    expect(out).toEqual({ referenceVersion: 'v1', onMismatch: 'hide' });
  });

  it('an OFF policy with no reference and no wording is nothing at all', () => {
    expect(sanitizeKbVersionPolicy({ referenceVersion: '', onMismatch: 'off' })).toBeNull();
    expect(sanitizeKbVersionPolicy({ onMismatch: 'off' })).toBeNull();
  });

  it('keeps an OFF policy that still holds a reference (mismatch filter, wording)', () => {
    expect(sanitizeKbVersionPolicy({ referenceVersion: 'v1', onMismatch: 'off' })).toEqual({
      referenceVersion: 'v1',
      onMismatch: 'off',
    });
    expect(sanitizeKbVersionPolicy({ onMismatch: 'off', notice: { EN: 'x' } })).toEqual({
      referenceVersion: '',
      onMismatch: 'off',
      notice: { EN: 'x' },
    });
  });

  describe('is refused with E5111', () => {
    const bad: Array<[string, unknown]> = [
      ['a string', 'v1'],
      ['an array', ['v1']],
      ['an unknown mode', { referenceVersion: 'v1', onMismatch: 'delete' }],
      ['a numeric mode', { referenceVersion: 'v1', onMismatch: 1 }],
      ['a numeric reference', { referenceVersion: 12 }],
      ['a reference with a space', { referenceVersion: 'v 1' }],
      ['a reference that is too long', { referenceVersion: 'v1.2.3.4.5.6.7.8.9' }],
      ['a reference with a quote', { referenceVersion: "v1'--" }],
      ['caveat with no reference (would silently do nothing)', { onMismatch: 'caveat' }],
      ['hide with a blank reference', { referenceVersion: '  ', onMismatch: 'hide' }],
      ['a notice that is a string', { referenceVersion: 'v1', notice: 'oops' }],
      ['a notice that is an array', { referenceVersion: 'v1', notice: ['x'] }],
      ['a notice value that is not text', { referenceVersion: 'v1', notice: { EN: 5 } }],
      ['a notice over its limit', { referenceVersion: 'v1', notice: { EN: 'x'.repeat(301) } }],
    ];
    it.each(bad)('%s', (_name, input) => {
      expect(code(() => sanitizeKbVersionPolicy(input))).toBe(ERROR_CODE.KB_VERSION_POLICY_INVALID.code);
    });
  });

  it('accepts a notice exactly at its limit', () => {
    const out = sanitizeKbVersionPolicy({ referenceVersion: 'v1', notice: { EN: 'x'.repeat(300) } });
    expect(out?.notice?.EN).toHaveLength(300);
  });
});

describe('parseUiVersionInput', () => {
  it('trims and keeps the label as typed', () => {
    expect(parseUiVersionInput(' v23.3.0 ')).toBe('v23.3.0');
    expect(parseUiVersionInput('0.12.0')).toBe('0.12.0');
  });

  it('turns blank / null / undefined into "unversioned"', () => {
    expect(parseUiVersionInput('')).toBeNull();
    expect(parseUiVersionInput('   ')).toBeNull();
    expect(parseUiVersionInput(null)).toBeNull();
    expect(parseUiVersionInput(undefined)).toBeNull();
  });

  it.each(['v 1', 'v1/2', '.1', 'x'.repeat(17), "v1'", 'v１'])('refuses %j with E5110', (bad) => {
    expect(code(() => parseUiVersionInput(bad))).toBe(ERROR_CODE.KB_UI_VERSION_INVALID.code);
  });
});

describe('activeKbReference', () => {
  const p = (referenceVersion: string, onMismatch: 'caveat' | 'hide' | 'off') => ({ referenceVersion, onMismatch });

  it('is the NORMALISED reference while stamping acts', () => {
    expect(activeKbReference(p('V23.4.0', 'caveat'))).toBe('23.4.0');
    expect(activeKbReference(p('v0.12.0', 'hide'))).toBe('0.12.0');
  });

  it('is null for no policy, off, or a blank reference', () => {
    expect(activeKbReference(null)).toBeNull();
    expect(activeKbReference(undefined)).toBeNull();
    expect(activeKbReference(p('v1', 'off'))).toBeNull();
    expect(activeKbReference(p('', 'caveat'))).toBeNull();
  });

  it('can ask for one mode only', () => {
    expect(activeKbReference(p('v1', 'hide'), 'hide')).toBe('1');
    expect(activeKbReference(p('v1', 'hide'), 'caveat')).toBeNull();
    expect(activeKbReference(p('v1', 'caveat'), 'hide')).toBeNull();
  });
});

describe('kbPolicyChangedBehaviour (retires the answer-reuse store)', () => {
  const p = (referenceVersion: string, onMismatch: 'caveat' | 'hide' | 'off') => ({ referenceVersion, onMismatch });

  it('a new reference version changes behaviour', () => {
    expect(kbPolicyChangedBehaviour(p('v0.11.0', 'caveat'), p('v0.12.0', 'caveat'))).toBe(true);
    expect(kbPolicyChangedBehaviour(p('v23.3.0', 'hide'), p('v23.4.0', 'hide'))).toBe(true);
  });

  it('a new mode changes behaviour', () => {
    expect(kbPolicyChangedBehaviour(p('v1', 'caveat'), p('v1', 'hide'))).toBe(true);
    expect(kbPolicyChangedBehaviour(p('v1', 'hide'), p('v1', 'off'))).toBe(true);
  });

  it('turning it on or off from nothing changes behaviour', () => {
    expect(kbPolicyChangedBehaviour(null, p('v1', 'caveat'))).toBe(true);
    expect(kbPolicyChangedBehaviour(p('v1', 'caveat'), null)).toBe(true);
  });

  it('re-spelling the same version does not (v0.12.0 == V0.12.0 == 0.12.0)', () => {
    expect(kbPolicyChangedBehaviour(p('v0.12.0', 'caveat'), p('V0.12.0', 'caveat'))).toBe(false);
    expect(kbPolicyChangedBehaviour(p('v0.12.0', 'hide'), p('0.12.0', 'hide'))).toBe(false);
  });

  it('nothing configured before or after is no change; neither is off -> off with another reference', () => {
    expect(kbPolicyChangedBehaviour(null, null)).toBe(false);
    expect(kbPolicyChangedBehaviour(null, p('v1', 'off'))).toBe(false);
    expect(kbPolicyChangedBehaviour(p('v1', 'off'), p('v2', 'off'))).toBe(false);
  });
});

describe('SQL spelling of the comparison', () => {
  it('normalises exactly like the TypeScript: trim, lower-case, one v before a digit', () => {
    const sql = kbVersionNormSql('kb.ui_version');
    expect(sql).toContain('LOWER(TRIM(kb.ui_version))');
    expect(sql).toContain("REGEXP '^v[0-9]'");
    expect(sql).toContain('SUBSTRING(LOWER(TRIM(kb.ui_version)), 2)');
  });

  it('treats NULL and blank as unversioned', () => {
    expect(kbUnversionedSql('c')).toBe("(c IS NULL OR TRIM(c) = '')");
  });

  it('the hide predicate keeps unversioned rows and the reference', () => {
    const sql = kbVersionKeepSql('kb.ui_version', 'ref');
    expect(sql).toContain("kb.ui_version IS NULL OR TRIM(kb.ui_version) = ''");
    expect(sql).toMatch(/= :ref\)$/);
  });

  it('the mismatch filter is "stamped and different", never including unversioned rows', () => {
    const sql = kbVersionMismatchSql('c', 'ref');
    expect(sql).toContain("NOT (c IS NULL OR TRIM(c) = '')");
    expect(sql).toContain('<> :ref');
  });

  it('uses a trusted literal column only (no parameter smuggling)', () => {
    expect(kbVersionNormSql('kb.ui_version')).not.toContain(':');
  });

  it('reference and column go through the same key function, so a re-spelling still matches', () => {
    // The parameter bound to the predicate is the TS normaliser's output.
    expect(normalizeKbVersion('V23.4.0')).toBe('23.4.0');
  });
});
