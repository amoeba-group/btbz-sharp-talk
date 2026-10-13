import { AUDIENCE } from './audience';
import {
  KB_ACCESS_OPTIONS,
  kbAccessColumns,
  kbAccessConfirmKey,
  kbAccessOf,
  kbAccessRestrictsRead,
  kbAccessWarningKey,
  kbAccessWidens,
  normalizeAudience,
} from './kb-access';

/**
 * A category's access tier = `min_audience` + the older `guest_visible` flag
 * (PLN-261012 SG-10). The console select and the API read it through these.
 */
describe('kbAccessOf — what a category row reads as', () => {
  it('NULL min_audience is the legacy shape: guest_visible=1 is public, otherwise partner', () => {
    expect(kbAccessOf({ guestVisible: 1, minAudience: null })).toBe(AUDIENCE.PUBLIC);
    expect(kbAccessOf({ guestVisible: 0, minAudience: null })).toBe(AUDIENCE.PARTNER);
    expect(kbAccessOf({ guestVisible: true })).toBe(AUDIENCE.PUBLIC);
    expect(kbAccessOf({})).toBe(AUDIENCE.PARTNER);
  });

  it('manager wins over everything, even a hand-edited guest_visible=1 (retrieval excludes it anyway)', () => {
    expect(kbAccessOf({ guestVisible: 0, minAudience: 'manager' })).toBe(AUDIENCE.MANAGER);
    expect(kbAccessOf({ guestVisible: 1, minAudience: 'manager' })).toBe(AUDIENCE.MANAGER);
  });

  it('guest_visible stays the single public flag: an explicit public/partner without it is not believed', () => {
    expect(kbAccessOf({ guestVisible: 0, minAudience: 'public' })).toBe(AUDIENCE.PARTNER);
    expect(kbAccessOf({ guestVisible: 1, minAudience: 'partner' })).toBe(AUDIENCE.PUBLIC);
  });

  it('an unknown stored value is ignored, not trusted', () => {
    expect(kbAccessOf({ guestVisible: 0, minAudience: 'admin' })).toBe(AUDIENCE.PARTNER);
  });
});

describe('kbAccessColumns — what setAccess writes', () => {
  it.each([
    [AUDIENCE.PUBLIC, { guestVisible: 1, minAudience: 'public' }],
    [AUDIENCE.PARTNER, { guestVisible: 0, minAudience: 'partner' }],
    [AUDIENCE.MANAGER, { guestVisible: 0, minAudience: 'manager' }],
  ])('%s', (tier, columns) => {
    expect(kbAccessColumns(tier)).toEqual(columns);
  });

  it('round-trips through kbAccessOf for every option', () => {
    for (const tier of KB_ACCESS_OPTIONS) {
      expect(kbAccessOf(kbAccessColumns(tier))).toBe(tier);
    }
  });
});

describe('normalizeAudience', () => {
  it('passes the three tiers and nothing else', () => {
    expect(normalizeAudience('public')).toBe('public');
    expect(normalizeAudience('partner')).toBe('partner');
    expect(normalizeAudience('manager')).toBe('manager');
    for (const bad of [null, undefined, '', 'Manager', 'admin', 2, {}, ['manager']]) {
      expect(normalizeAudience(bad)).toBeNull();
    }
  });
});

describe('console helpers', () => {
  it('lists the options widest-first', () => {
    expect(KB_ACCESS_OPTIONS).toEqual(['public', 'partner', 'manager']);
  });

  it('only manager restricts reading, and only manager carries the receptionist warning', () => {
    expect(kbAccessRestrictsRead(AUDIENCE.MANAGER)).toBe(true);
    expect(kbAccessRestrictsRead(AUDIENCE.PARTNER)).toBe(false);
    expect(kbAccessRestrictsRead(AUDIENCE.PUBLIC)).toBe(false);
    expect(kbAccessWarningKey(AUDIENCE.MANAGER)).toBe('categoryAccessManagerWarning');
    expect(kbAccessWarningKey(AUDIENCE.PARTNER)).toBeNull();
    expect(kbAccessWarningKey(AUDIENCE.PUBLIC)).toBeNull();
  });

  it('knows which moves widen the audience', () => {
    expect(kbAccessWidens(AUDIENCE.MANAGER, AUDIENCE.PARTNER)).toBe(true);
    expect(kbAccessWidens(AUDIENCE.PARTNER, AUDIENCE.PUBLIC)).toBe(true);
    expect(kbAccessWidens(AUDIENCE.MANAGER, AUDIENCE.PUBLIC)).toBe(true);
    expect(kbAccessWidens(AUDIENCE.PUBLIC, AUDIENCE.MANAGER)).toBe(false);
    expect(kbAccessWidens(AUDIENCE.PARTNER, AUDIENCE.PARTNER)).toBe(false);
  });

  it('asks for confirmation only when documents become readable by more people', () => {
    expect(kbAccessConfirmKey(AUDIENCE.PARTNER, AUDIENCE.PUBLIC, 4)).toBe('categoryAccessConfirmPublic');
    expect(kbAccessConfirmKey(AUDIENCE.MANAGER, AUDIENCE.PUBLIC, 4)).toBe('categoryAccessConfirmPublic');
    expect(kbAccessConfirmKey(AUDIENCE.MANAGER, AUDIENCE.PARTNER, 1)).toBe('categoryAccessConfirmPartner');
    // Nothing to expose in an empty category; narrowing and no-ops never ask.
    expect(kbAccessConfirmKey(AUDIENCE.PARTNER, AUDIENCE.PUBLIC, 0)).toBeNull();
    expect(kbAccessConfirmKey(AUDIENCE.PUBLIC, AUDIENCE.MANAGER, 9)).toBeNull();
    expect(kbAccessConfirmKey(AUDIENCE.PUBLIC, AUDIENCE.PARTNER, 9)).toBeNull();
    expect(kbAccessConfirmKey(AUDIENCE.PARTNER, AUDIENCE.PARTNER, 9)).toBeNull();
  });
});
