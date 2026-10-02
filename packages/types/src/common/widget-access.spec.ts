import {
  evaluateWidgetAccess,
  isValidIpEntry,
  matchIp,
  matchUrl,
  normalizeWidgetAccess,
  type WidgetAccess,
} from './widget-access';

const access = (over: Partial<WidgetAccess> = {}): WidgetAccess => ({
  enabled: true,
  startsAt: null,
  endsAt: null,
  ips: [],
  urls: [],
  ...over,
});

describe('matchIp', () => {
  it('matches a single IPv4 address exactly', () => {
    expect(matchIp('203.0.113.7', '203.0.113.7')).toBe(true);
    expect(matchIp('203.0.113.7', '203.0.113.8')).toBe(false);
  });

  it('honours the CIDR boundary rather than the printed digits', () => {
    // .0 and .255 are inside /24; the next block is not. Getting this wrong by
    // string-comparing prefixes is the classic version of this bug.
    expect(matchIp('10.10.0.0/24', '10.10.0.0')).toBe(true);
    expect(matchIp('10.10.0.0/24', '10.10.0.255')).toBe(true);
    expect(matchIp('10.10.0.0/24', '10.10.1.0')).toBe(false);
    expect(matchIp('10.10.0.0/16', '10.10.1.0')).toBe(true);
  });

  it('/32 is one host and /0 is everyone', () => {
    expect(matchIp('192.0.2.1/32', '192.0.2.1')).toBe(true);
    expect(matchIp('192.0.2.1/32', '192.0.2.2')).toBe(false);
    expect(matchIp('0.0.0.0/0', '198.51.100.9')).toBe(true);
  });

  it('matches IPv6, compressed or not', () => {
    expect(matchIp('2001:db8::1', '2001:0db8:0000:0000:0000:0000:0000:0001')).toBe(true);
    expect(matchIp('2001:db8::/32', '2001:db8:abcd::9')).toBe(true);
    expect(matchIp('2001:db8::/32', '2001:db9::1')).toBe(false);
  });

  it('reads an IPv4 client that arrives in v6 form against a v4 rule', () => {
    // A dual-stack proxy reports ::ffff:203.0.113.7 — refusing that would
    // silently exclude real visitors the operator did allow.
    expect(matchIp('203.0.113.7', '::ffff:203.0.113.7')).toBe(true);
    expect(matchIp('203.0.113.0/24', '::ffff:203.0.113.9')).toBe(true);
  });

  it('never matches on a malformed entry or a missing client IP', () => {
    expect(matchIp('10.10.0.0/33', '10.10.0.1')).toBe(false);
    expect(matchIp('not-an-ip', '10.10.0.1')).toBe(false);
    expect(matchIp('10.10.0.1', null)).toBe(false);
    expect(matchIp('10.10.0.1', '')).toBe(false);
  });
});

describe('isValidIpEntry (save-time gate)', () => {
  it('accepts addresses and CIDR blocks, refuses the rest', () => {
    expect(isValidIpEntry('203.0.113.7')).toBe(true);
    expect(isValidIpEntry('10.0.0.0/8')).toBe(true);
    expect(isValidIpEntry('2001:db8::/32')).toBe(true);
    expect(isValidIpEntry('10.10.0.0/33')).toBe(false);
    expect(isValidIpEntry('256.0.0.1')).toBe(false);
    expect(isValidIpEntry('shop.example.com')).toBe(false);
  });
});

describe('matchUrl', () => {
  const rule = 'https://shop.example.com/collections/test';

  it('matches the prefix path and anything under it', () => {
    expect(matchUrl(rule, 'https://shop.example.com/collections/test')).toBe(true);
    expect(matchUrl(rule, 'https://shop.example.com/collections/test/')).toBe(true);
    expect(matchUrl(rule, 'https://shop.example.com/collections/test/item-1')).toBe(true);
  });

  it('does NOT match a longer word that merely starts the same', () => {
    // The whole reason the prefix stops at a segment boundary.
    expect(matchUrl(rule, 'https://shop.example.com/collections/testing')).toBe(false);
    expect(matchUrl(rule, 'https://shop.example.com/collections/test-drive')).toBe(false);
  });

  it('ignores query and hash, and is case-insensitive on the host only', () => {
    expect(matchUrl(rule, 'https://SHOP.example.com/collections/test?utm=x#a')).toBe(true);
    expect(matchUrl(rule, 'https://shop.example.com/Collections/Test')).toBe(false);
  });

  it('a host-only rule covers the whole site, and scheme/port must agree', () => {
    expect(matchUrl('https://shop.example.com', 'https://shop.example.com/anything')).toBe(true);
    expect(matchUrl('https://shop.example.com', 'http://shop.example.com/anything')).toBe(false);
    expect(matchUrl('http://localhost:3000', 'http://localhost:3000/x')).toBe(true);
    expect(matchUrl('http://localhost:3000', 'http://localhost:4000/x')).toBe(false);
  });

  it('does not treat a wildcard as a wildcard — prefixes only', () => {
    expect(matchUrl('https://shop.example.com/a*', 'https://shop.example.com/abc')).toBe(false);
  });

  it('accepts the same `*.host` wildcard the embed allowlist uses', () => {
    expect(matchUrl('*.amoeba.site', 'https://acm.amoeba.site/')).toBe(true);
    expect(matchUrl('*.amoeba.site', 'https://shoptalk.amoeba.site/widget/')).toBe(true);
    expect(matchUrl('*.amoeba.site', 'https://shop.example.com/')).toBe(false);
  });

  it('does NOT let `*.x` cover the apex `x` — list both when both are meant', () => {
    // Same stance as embed-origin.util: a wildcard quietly covering the apex is
    // the kind of surprise that gets discovered during an incident.
    expect(matchUrl('*.amoeba.site', 'https://amoeba.site/')).toBe(false);
  });

  it('a wildcard host still honours the path prefix', () => {
    expect(matchUrl('*.amoeba.site/sample', 'https://acm.amoeba.site/sample/x')).toBe(true);
    expect(matchUrl('*.amoeba.site/sample', 'https://acm.amoeba.site/other')).toBe(false);
  });

  it('never matches without a page URL', () => {
    expect(matchUrl(rule, null)).toBe(false);
  });
});

describe('evaluateWidgetAccess', () => {
  const now = new Date('2026-10-10T00:00:00Z');

  it('is invisible to nobody when the restriction is off', () => {
    expect(evaluateWidgetAccess(null, { now })).toMatchObject({ visible: true, restricted: false });
    expect(evaluateWidgetAccess(access({ enabled: false }), { now })).toMatchObject({
      visible: true,
      restricted: false,
    });
  });

  it('lifts itself outside the window — the test period ends by itself', () => {
    const cfg = access({ ips: ['203.0.113.7'], startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-05T00:00:00Z' });
    const verdict = evaluateWidgetAccess(cfg, { now, ip: '198.51.100.1' });
    expect(verdict).toMatchObject({ visible: true, restricted: true, reason: 'window' });
  });

  it('hides a visitor who matches nothing inside the window', () => {
    const cfg = access({ ips: ['203.0.113.7'], urls: ['https://shop.example.com/test'] });
    expect(
      evaluateWidgetAccess(cfg, { now, ip: '198.51.100.1', pageUrl: 'https://shop.example.com/' }),
    ).toMatchObject({ visible: false, restricted: true, reason: 'no_match' });
  });

  it('IP or URL or key — any one is enough (OR)', () => {
    const cfg = access({ ips: ['203.0.113.7'], urls: ['https://shop.example.com/test'] });
    const page = 'https://shop.example.com/';
    expect(evaluateWidgetAccess(cfg, { now, ip: '203.0.113.7', pageUrl: page }).visible).toBe(true);
    expect(
      evaluateWidgetAccess(cfg, { now, ip: '198.51.100.1', pageUrl: 'https://shop.example.com/test/x' }).visible,
    ).toBe(true);
    expect(
      evaluateWidgetAccess(cfg, { now, ip: '198.51.100.1', pageUrl: page, key: 'abc', tenantKey: 'abc' }).visible,
    ).toBe(true);
    expect(
      evaluateWidgetAccess(cfg, { now, ip: '198.51.100.1', pageUrl: page, key: 'abc', tenantKey: 'zzz' }).visible,
    ).toBe(false);
  });

  it('the window is an AND — matching the IP outside the window is still "not restricted now"', () => {
    const cfg = access({ ips: ['203.0.113.7'], startsAt: '2026-11-01T00:00:00Z' });
    expect(evaluateWidgetAccess(cfg, { now, ip: '203.0.113.7' })).toMatchObject({
      visible: true,
      reason: 'window',
    });
  });

  it('skipUrlRule drops only the URL rule, never the rest', () => {
    // Console preview and app-mode WebViews have no page URL to match.
    const cfg = access({ urls: ['https://shop.example.com/test'] });
    expect(
      evaluateWidgetAccess(cfg, { now, pageUrl: 'https://shop.example.com/test', skipUrlRule: true }).visible,
    ).toBe(false);
    const withIp = access({ urls: ['https://shop.example.com/test'], ips: ['203.0.113.7'] });
    expect(evaluateWidgetAccess(withIp, { now, ip: '203.0.113.7', skipUrlRule: true }).visible).toBe(true);
  });

  it('an empty invite key never matches an unset tenant key', () => {
    const cfg = access({ ips: ['203.0.113.7'] });
    expect(
      evaluateWidgetAccess(cfg, { now, key: '', tenantKey: null, ip: '198.51.100.1' }).visible,
    ).toBe(false);
    expect(
      evaluateWidgetAccess(cfg, { now, key: null, tenantKey: 'secret', ip: '198.51.100.1' }).visible,
    ).toBe(false);
  });
});

describe('normalizeWidgetAccess', () => {
  it('drops entries it cannot parse and de-duplicates', () => {
    const out = normalizeWidgetAccess({
      enabled: true,
      ips: ['203.0.113.7', '203.0.113.7', 'nope', '10.0.0.0/33'],
      urls: ['https://shop.example.com/test', 'not a url at all ??'],
      startsAt: '2026-10-01T00:00:00Z',
      endsAt: 'rubbish',
    });
    expect(out).toMatchObject({
      enabled: true,
      ips: ['203.0.113.7'],
      urls: ['https://shop.example.com/test'],
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: null,
    });
  });

  it('returns null when nothing was configured', () => {
    expect(normalizeWidgetAccess(null)).toBeNull();
    expect(normalizeWidgetAccess({ enabled: false, ips: [], urls: [] })).toBeNull();
  });
});
