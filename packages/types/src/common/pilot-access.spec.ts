import {
  PILOT_ACCESS_DEFAULTS,
  PILOT_NOTICE_MAX_LENGTH,
  normalizeHotelSn,
  pilotNoticeFor,
  readPilotAccess,
} from './pilot-access';

describe('normalizeHotelSn', () => {
  it('accepts the serials a host signs, trimmed', () => {
    expect(normalizeHotelSn('1721')).toBe('1721');
    expect(normalizeHotelSn('  2204 ')).toBe('2204');
    expect(normalizeHotelSn('HN-0042_b')).toBe('HN-0042_b');
  });

  it('accepts a whole number from a JSON body, as its decimal text', () => {
    expect(normalizeHotelSn(1721)).toBe('1721');
  });

  it('refuses anything that could not be a serial', () => {
    for (const bad of ['', '   ', 'a b', '17 21', '-1', '_x', '1721;', "1'; DROP", 'x'.repeat(65), 1.5, -3, null, undefined, {}, []]) {
      expect(normalizeHotelSn(bad)).toBeNull();
    }
  });

  it('does not fold case or strip leading zeros — the signed claim is compared exactly', () => {
    expect(normalizeHotelSn('01721')).toBe('01721');
    expect(normalizeHotelSn('01721')).not.toBe(normalizeHotelSn('1721'));
    expect(normalizeHotelSn('hn1')).not.toBe(normalizeHotelSn('HN1'));
  });
});

describe('readPilotAccess', () => {
  it('is null for a tenant that never configured it — the feature does not exist there', () => {
    expect(readPilotAccess(null)).toBeNull();
    expect(readPilotAccess(undefined)).toBeNull();
    expect(readPilotAccess('on')).toBeNull();
  });

  it('fills the documented defaults: off, guests allowed, hide', () => {
    expect(readPilotAccess({})).toEqual(PILOT_ACCESS_DEFAULTS);
  });

  it('only `true` switches it on — a truthy string or 1 does not', () => {
    expect(readPilotAccess({ enabled: true })?.enabled).toBe(true);
    expect(readPilotAccess({ enabled: 'true' })?.enabled).toBe(false);
    expect(readPilotAccess({ enabled: 1 })?.enabled).toBe(false);
  });

  it('keeps guests allowed unless it is explicitly false', () => {
    expect(readPilotAccess({ guestAllowed: false })?.guestAllowed).toBe(false);
    expect(readPilotAccess({ guestAllowed: 0 })?.guestAllowed).toBe(true);
    expect(readPilotAccess({})?.guestAllowed).toBe(true);
  });

  it('reads an unknown non-pilot mode as hide', () => {
    expect(readPilotAccess({ nonPilot: 'notice' })?.nonPilot).toBe('notice');
    expect(readPilotAccess({ nonPilot: 'block' })?.nonPilot).toBe('hide');
  });

  it('keeps only known languages, trimmed, and caps a runaway note', () => {
    const access = readPilotAccess({
      notice: { VI: '  Chưa áp dụng.  ', XX: 'nope', EN: '', KO: 3, ZH: 'z'.repeat(PILOT_NOTICE_MAX_LENGTH + 40) },
    });
    expect(access?.notice.VI).toBe('Chưa áp dụng.');
    expect(access?.notice).not.toHaveProperty('XX');
    expect(access?.notice).not.toHaveProperty('EN');
    expect(access?.notice).not.toHaveProperty('KO');
    expect(access?.notice.ZH).toHaveLength(PILOT_NOTICE_MAX_LENGTH);
  });
});

describe('pilotNoticeFor', () => {
  const access = { notice: { VI: 'Chưa áp dụng cho khách sạn của bạn.' } };

  it('returns the tenant wording for the session language, any case', () => {
    expect(pilotNoticeFor(access, 'VI')).toBe('Chưa áp dụng cho khách sạn của bạn.');
    expect(pilotNoticeFor(access, 'vi')).toBe('Chưa áp dụng cho khách sạn của bạn.');
  });

  it('is null — so the built-in copy is used — for a language the tenant left blank', () => {
    expect(pilotNoticeFor(access, 'EN')).toBeNull();
    expect(pilotNoticeFor(null, 'VI')).toBeNull();
    expect(pilotNoticeFor(access, undefined)).toBeNull();
  });
});
