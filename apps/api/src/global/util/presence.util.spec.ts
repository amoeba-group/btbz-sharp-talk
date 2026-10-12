import {
  DEFAULT_PRESENCE_TTL_SEC,
  isPresent,
  PRESENCE_TOUCH_THROTTLE_SEC,
  presenceTtlSec,
} from './presence.util';

/** Agent presence rule (PLN-261012 SG-60): on duty AND a recent heartbeat. */
describe('presence util', () => {
  const NOW = Date.parse('2026-10-15T09:00:00.000Z');
  const ago = (sec: number) => new Date(NOW - sec * 1000);

  describe('isPresent — TTL boundary', () => {
    it('is present while the heartbeat is younger than the TTL', () => {
      expect(isPresent({ status: 'online', lastSeen: ago(10) }, NOW, 90)).toBe(true);
    });

    it('still counts at exactly the TTL, and drops one second after', () => {
      expect(isPresent({ status: 'online', lastSeen: ago(90) }, NOW, 90)).toBe(true);
      expect(isPresent({ status: 'online', lastSeen: ago(91) }, NOW, 90)).toBe(false);
    });

    it('follows the TTL it is given (env override)', () => {
      expect(isPresent({ status: 'online', lastSeen: ago(100) }, NOW, 120)).toBe(true);
      expect(isPresent({ status: 'online', lastSeen: ago(100) }, NOW, 60)).toBe(false);
    });

    it('accepts an ISO string stamp, as a driver may hand it back', () => {
      expect(isPresent({ status: 'online', lastSeen: ago(5).toISOString() }, NOW, 90)).toBe(true);
    });
  });

  describe('isPresent — never present', () => {
    it('without a profile row', () => {
      expect(isPresent(null, NOW, 90)).toBe(false);
      expect(isPresent(undefined, NOW, 90)).toBe(false);
    });

    it('without a heartbeat (the "online forever" bug: status alone is not enough)', () => {
      expect(isPresent({ status: 'online', lastSeen: null }, NOW, 90)).toBe(false);
      expect(isPresent({ status: 'online' }, NOW, 90)).toBe(false);
    });

    it('when off duty or away, however fresh the stamp', () => {
      expect(isPresent({ status: 'offline', lastSeen: ago(1) }, NOW, 90)).toBe(false);
      expect(isPresent({ status: 'away', lastSeen: ago(1) }, NOW, 90)).toBe(false);
    });

    it('with an unreadable stamp', () => {
      expect(isPresent({ status: 'online', lastSeen: 'not-a-date' }, NOW, 90)).toBe(false);
    });
  });

  describe('presenceTtlSec', () => {
    it('defaults to 90 s when unset or unusable', () => {
      expect(DEFAULT_PRESENCE_TTL_SEC).toBe(90);
      expect(presenceTtlSec(undefined)).toBe(90);
      expect(presenceTtlSec('')).toBe(90);
      expect(presenceTtlSec('abc')).toBe(90);
      expect(presenceTtlSec('0')).toBe(90);
      expect(presenceTtlSec('-5')).toBe(90);
    });

    it('reads a positive number from a string or a number', () => {
      expect(presenceTtlSec('120')).toBe(120);
      expect(presenceTtlSec(45)).toBe(45);
    });
  });

  it('keeps the write throttle well under the TTL, so a throttled poll never lets presence lapse', () => {
    expect(PRESENCE_TOUCH_THROTTLE_SEC).toBeLessThan(DEFAULT_PRESENCE_TTL_SEC / 2);
  });
});
