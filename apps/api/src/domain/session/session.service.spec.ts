import { Repository } from 'typeorm';
import { CONSENT_STATE, WIDGET_TABS_DEFAULT } from '@sharptalk/types';
import { CONSENT_NOTICE_VERSION, SessionService, sessionCacheKey } from './session.service';
import { Session } from './entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';

/** In-memory Redis stand-in with the availability flag the service consults. */
class FakeRedis {
  up = true;
  store = new Map<string, string>();
  available(): boolean {
    return this.up;
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe('SessionService consent (PLN-Privacy-Control-Gap Stage 1-2)', () => {
  let svc: SessionService;
  let redis: FakeRedis;
  let session: Session;
  let tenant: Tenant | null;

  const bus = { publish: jest.fn() } as unknown as EventBusService;

  beforeEach(() => {
    session = {
      id: 11,
      sessionToken: 'tok-11',
      tenantId: 1,
      customerId: null,
      identityLevel: 'guest',
      language: 'EN',
      consentState: CONSENT_STATE.PENDING,
      consentAt: null,
      consentVersion: null,
    } as Session;
    tenant = {
      id: 1,
      privacyPolicyUrl: null,
      consentNoticeVersion: null,
    } as Tenant;

    const sessionRepo = {
      findOne: jest.fn(async () => session),
      save: jest.fn(async (s: Session) => s),
    } as unknown as Repository<Session>;
    const tenantRepo = {
      findOne: jest.fn(async () => tenant),
      findAndCount: jest.fn(async () => [[tenant], 1]),
    } as unknown as Repository<Tenant>;

    redis = new FakeRedis();
    // customerRepo sits between tenantRepo and bus (it backs customerDisplayName for
    // the widget greeting); unused by the consent suites, but the position matters —
    // omitting it silently shifted redis into the bus slot.
    const customerRepo = { findOne: jest.fn(async () => null) } as never;
    svc = new SessionService(
      sessionRepo,
      tenantRepo,
      customerRepo,
      bus,
      redis as unknown as RedisService,
    );
  });

  describe('setConsent', () => {
    it('grants: stamps state, timestamp, effective version and invalidates the cache', async () => {
      redis.store.set(sessionCacheKey('tok-11'), JSON.stringify(session));
      const saved = await svc.setConsent('tok-11', true);
      expect(saved.consentState).toBe(CONSENT_STATE.GRANTED);
      expect(saved.consentAt).toBeInstanceOf(Date);
      expect(saved.consentVersion).toBe(CONSENT_NOTICE_VERSION);
      expect(redis.store.has(sessionCacheKey('tok-11'))).toBe(false);
    });

    it('declines: records declined with the same audit fields', async () => {
      const saved = await svc.setConsent('tok-11', false);
      expect(saved.consentState).toBe(CONSENT_STATE.DECLINED);
      expect(saved.consentAt).toBeInstanceOf(Date);
      expect(saved.consentVersion).toBe(CONSENT_NOTICE_VERSION);
    });

    it('stamps the tenant-overridden notice version when set', async () => {
      tenant!.consentNoticeVersion = '2026-08-custom';
      const saved = await svc.setConsent('tok-11', true);
      expect(saved.consentVersion).toBe('2026-08-custom');
    });
  });

  describe('getEffectiveConsent', () => {
    const v = '2026-07';
    it.each([
      [CONSENT_STATE.GRANTED, v, CONSENT_STATE.GRANTED], // current grant counts
      [CONSENT_STATE.GRANTED, '2025-01', CONSENT_STATE.PENDING], // outdated → re-consent
      [CONSENT_STATE.GRANTED, null, CONSENT_STATE.PENDING], // no version recorded
      [CONSENT_STATE.DECLINED, v, CONSENT_STATE.DECLINED],
      [CONSENT_STATE.PENDING, null, CONSENT_STATE.PENDING],
    ])('state=%s version=%s → %s', (consentState, consentVersion, expected) => {
      const row = { consentState, consentVersion } as Pick<
        Session,
        'consentState' | 'consentVersion'
      >;
      expect(svc.getEffectiveConsent(row, v)).toBe(expected);
    });
  });

  describe('effective notice version / privacy notice', () => {
    it('falls back to the platform constant when the tenant has no override', async () => {
      await expect(svc.effectiveNoticeVersion(1)).resolves.toBe(CONSENT_NOTICE_VERSION);
    });

    it('falls back when the session has no tenant', async () => {
      await expect(svc.effectiveNoticeVersion(null)).resolves.toBe(CONSENT_NOTICE_VERSION);
    });

    it('uses the tenant override and exposes the policy URL', async () => {
      tenant!.consentNoticeVersion = 'v9';
      tenant!.privacyPolicyUrl = 'https://shop.example/privacy';
      await expect(svc.privacyNotice(1)).resolves.toEqual({
        privacyPolicyUrl: 'https://shop.example/privacy',
        consentNoticeVersion: 'v9',
        aiProcessingRegion: 'US',
        widgetLoginMode: 'redirect',
        widgetTabs: [...WIDGET_TABS_DEFAULT],
        widgetTabPosition: 'top',
        // Null, not absent: an unthemed tenant needs no variables written, and
        // the widget's own stylesheet already holds the built-in palette.
        widgetTheme: null,
        widgetCopy: expect.objectContaining({ firstVisit: {}, loginGreeting: {} }),
        // 'base' (the default) has no shopper-facing issue feed.
        issueFeed: false,
      });
    });

    it('offers the inquiry feed only to tenants running an issue workflow (PLN-260923 D-2)', async () => {
      for (const [mode, expected] of [['native', true], ['bridge', true], ['base', false]] as const) {
        tenant!.workflowMode = mode;
        await expect(svc.privacyNotice(1)).resolves.toMatchObject({ issueFeed: expected });
      }
    });

    /**
     * Tab layout (PLN-260817-Widget-Tab-Config). The widget renders whatever
     * arrives here without re-validating it, so this is where "always renderable"
     * has to hold.
     */
    it('serves the built-in tab default to a tenant that never configured one', async () => {
      tenant!.widgetTabs = null;
      tenant!.widgetTabPosition = 'top';
      // Asserted against the constant, not a copy of today's value: this test
      // is about "unconfigured follows the default", which stays true when the
      // default changes. A literal here would just be a snapshot to re-edit.
      await expect(svc.privacyNotice(1)).resolves.toMatchObject({
        widgetTabs: [...WIDGET_TABS_DEFAULT],
        widgetTabPosition: 'top',
      });
    });

    it('serves the configured tabs, in canonical order, at the configured position', async () => {
      tenant!.widgetTabs = ['chat', 'orders'];
      tenant!.widgetTabPosition = 'bottom';
      await expect(svc.privacyNotice(1)).resolves.toMatchObject({
        widgetTabs: ['orders', 'chat'],
        widgetTabPosition: 'bottom',
      });
    });

    it('falls back to the default rather than serving an unrenderable tab bar', async () => {
      // A stored key we no longer ship (renamed tab, hand-edited row) would
      // otherwise normalize to an empty array — a widget with no way to navigate.
      tenant!.widgetTabs = ['ghost-tab'];
      await expect(svc.privacyNotice(1)).resolves.toMatchObject({
        widgetTabs: [...WIDGET_TABS_DEFAULT],
      });
    });

    it('serves a stored theme, normalized', async () => {
      tenant!.widgetTheme = { brand: '#e11d6b', headerStyle: 'brand' };
      await expect(svc.privacyNotice(1)).resolves.toMatchObject({
        widgetTheme: { brand: '#E11D6B', headerStyle: 'brand' },
      });
    });

    it('an unusable stored theme degrades to unthemed rather than breaking the widget', async () => {
      tenant!.widgetTheme = { brand: 'not-a-colour', headerStyle: 'brand' };
      await expect(svc.privacyNotice(1)).resolves.toMatchObject({ widgetTheme: null });
    });

    it('an unknown stored position reads as top, not as itself', async () => {
      tenant!.widgetTabPosition = 'sideways';
      await expect(svc.privacyNotice(1)).resolves.toMatchObject({ widgetTabPosition: 'top' });
    });

    it('resolves widgetCopy.displayName: configured name wins, else the tenant name', async () => {
      tenant!.name = 'IVY USA';
      tenant!.widgetCopy = null;
      await expect(svc.privacyNotice(1)).resolves.toMatchObject({
        widgetCopy: { displayName: 'IVY USA', firstVisit: {}, loginGreeting: {} },
      });
      tenant!.widgetCopy = {
        displayName: 'IVY 뷰티샵',
        firstVisit: { KO: '어서오세요!' },
        loginGreeting: {},
      };
      await expect(svc.privacyNotice(1)).resolves.toMatchObject({
        widgetCopy: {
          displayName: 'IVY 뷰티샵',
          firstVisit: { KO: '어서오세요!' },
          loginGreeting: {},
        },
      });
    });
  });

  describe('effectiveConsentFor (fresh, cache-bypassing read)', () => {
    it('ignores a stale cached GRANTED: the DB row wins (fail-closed)', async () => {
      // Cache says granted…
      redis.store.set(
        sessionCacheKey('tok-11'),
        JSON.stringify({ ...session, consentState: CONSENT_STATE.GRANTED, consentVersion: CONSENT_NOTICE_VERSION }),
      );
      // …but the DB row (fresh read) says declined.
      session.consentState = CONSENT_STATE.DECLINED;
      await expect(svc.effectiveConsentFor(11, 1)).resolves.toBe(CONSENT_STATE.DECLINED);
    });

    it('degrades an outdated grant to pending', async () => {
      session.consentState = CONSENT_STATE.GRANTED;
      session.consentVersion = 'ancient';
      await expect(svc.effectiveConsentFor(11, 1)).resolves.toBe(CONSENT_STATE.PENDING);
    });

    it('returns granted for a current grant', async () => {
      session.consentState = CONSENT_STATE.GRANTED;
      session.consentVersion = CONSENT_NOTICE_VERSION;
      await expect(svc.effectiveConsentFor(11, 1)).resolves.toBe(CONSENT_STATE.GRANTED);
    });
  });
});

// ---------------------------------------------------------------------------
// Below: session reuse + the shared authorization gate (feature/widget-customer-
// login-popup). Disjoint from the consent suites above — different entry points,
// so both merged in whole rather than either being rewritten.
// ---------------------------------------------------------------------------


/**
 * SessionService.findOrCreateForCustomer — the app proxy re-resolves identity on
 * every storefront page load, so minting a session each time gave a signed-in
 * shopper a brand-new (empty) conversation whenever they followed a link.
 */
describe('SessionService.findOrCreateForCustomer', () => {
  function build(found: Session | null) {
    const sessionRepo = {
      findOne: jest.fn().mockResolvedValue(found),
      create: jest.fn((x: Partial<Session>) => ({ ...x }) as Session),
      save: jest.fn((x: Session) => Promise.resolve({ id: x.id ?? 99, ...x })),
    };
    const svc = new SessionService(
      sessionRepo as never,
      // tenantRepo — createForCustomer reads timezone/default language (G1/G2); null keeps
      // the legacy locale-only resolution these cases assert.
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never, // customerRepo
      { publish: jest.fn().mockResolvedValue(undefined) } as never,
      { available: () => false, del: jest.fn() } as never,
    );
    return { svc, sessionRepo };
  }

  const recent = { id: 7, sessionToken: 'existing-tok', customerId: 4 } as Session;

  it('resumes the recent verified session instead of creating one', async () => {
    const { svc, sessionRepo } = build(recent);
    const s = await svc.findOrCreateForCustomer(2, 4, 'en');

    expect(s.sessionToken).toBe('existing-tok');
    expect(sessionRepo.create).not.toHaveBeenCalled();
  });

  it('scopes the lookup to tenant + customer + verified', async () => {
    const { svc, sessionRepo } = build(recent);
    await svc.findOrCreateForCustomer(2, 4, 'en');

    const where = sessionRepo.findOne.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: 2, customerId: 4, identityLevel: 'verified' });
    // Bounded by an activity window, newest first.
    expect(where.updatedAt).toBeDefined();
    expect(sessionRepo.findOne.mock.calls[0][0].order).toEqual({ updatedAt: 'DESC' });
  });

  it('touches the resumed session so the window rolls forward', async () => {
    const { svc, sessionRepo } = build(recent);
    await svc.findOrCreateForCustomer(2, 4, 'en');
    expect(sessionRepo.save).toHaveBeenCalledWith(recent);
  });

  it('creates a verified session when none is resumable', async () => {
    const { svc, sessionRepo } = build(null);
    const s = await svc.findOrCreateForCustomer(2, 4, 'ko');

    expect(sessionRepo.create).toHaveBeenCalled();
    expect(s).toMatchObject({
      tenantId: 2,
      customerId: 4,
      identityLevel: 'verified',
      language: 'KO',
    });
    expect(s.sessionToken).toBeTruthy();
  });

  // The three languages added in REQ-260817 must survive the same path Korean
  // takes; a locale the registry does not know still lands on English.
  it.each([
    ['vi-VN', 'VI'],
    ['ja', 'JA'],
    ['zh-CN', 'ZH'],
    ['th-TH', 'EN'],
  ])('creates a %s session with language %s', async (locale, expected) => {
    const { svc } = build(null);
    const s = await svc.findOrCreateForCustomer(2, 4, locale);
    expect(s).toMatchObject({ language: expected });
  });
});

/**
 * SessionService.requireCustomer — the single widget-session authorization gate.
 * Every storefront endpoint that touches personal data routes through it, so the
 * two tiers (bound vs Shopify-verified) are pinned here rather than in ten copies.
 */
describe('SessionService.requireCustomer', () => {
  function build(session: unknown) {
    const sessionRepo = { findOne: jest.fn().mockResolvedValue(session) };
    const svc = new SessionService(
      sessionRepo as never,
      {} as never,
      {} as never,
      { publish: jest.fn() } as never,
      { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
    );
    return { svc };
  }

  const guest = { sessionToken: 't', customerId: 4, identityLevel: 'guest' };
  const verified = { sessionToken: 't', customerId: 4, identityLevel: 'verified' };
  const anon = { sessionToken: 't', customerId: null, identityLevel: 'guest' };

  it('returns the session for a bound customer', async () => {
    const { svc } = build(guest);
    await expect(svc.requireCustomerId('t')).resolves.toBe(4);
  });

  it('rejects an unbound session with 401', async () => {
    const { svc } = build(anon);
    await expect(svc.requireCustomerId('t')).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a missing session with 404', async () => {
    const { svc } = build(null);
    await expect(svc.requireCustomerId('t')).rejects.toMatchObject({ status: 404 });
  });

  it('accepts a Shopify-verified session when verified identity is demanded', async () => {
    const { svc } = build(verified);
    await expect(svc.requireCustomerId('t', { verified: true })).resolves.toBe(4);
  });

  it('rejects a guest-bound session with 403 when verified identity is demanded', async () => {
    // SEC-C3: order number + email are printed on packing slips — strong enough to
    // read your own orders, never enough to export or erase an account.
    const { svc } = build(guest);
    await expect(svc.requireCustomerId('t', { verified: true })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects an unbound session with 401 even when verified is demanded', async () => {
    const { svc } = build(anon);
    await expect(svc.requireCustomerId('t', { verified: true })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('SessionService.resolveAiAgentId (PLN-260820)', () => {
  // TypeORM hands bigint PKs back as strings — the fixture id is a string on purpose.
  const agents = [
    { id: '7', tenantId: 1, code: 'hotel-partner', active: 1 },
    { id: '8', tenantId: 1, code: 'retired', active: 0 },
  ];
  const aiAgentRepo = {
    findOne: jest.fn(async ({ where }: { where: { tenantId: number; code: string; active: number } }) =>
      agents.find(
        (a) => a.tenantId === where.tenantId && a.code === where.code && a.active === where.active,
      ) ?? null,
    ),
  };
  const svc = new SessionService(
    {} as never,
    {} as never,
    {} as never,
    { publish: jest.fn() } as never,
    new FakeRedis() as never,
    aiAgentRepo as never,
  );

  it('resolves an active code the way it is typed into a snippet (case/space-insensitive)', async () => {
    await expect(svc.resolveAiAgentId(1, ' Hotel-Partner ')).resolves.toBe(7);
  });

  it('falls back to null (default agent) for unknown, inactive or cross-tenant codes', async () => {
    await expect(svc.resolveAiAgentId(1, 'no-such')).resolves.toBeNull();
    await expect(svc.resolveAiAgentId(1, 'retired')).resolves.toBeNull();
    await expect(svc.resolveAiAgentId(2, 'hotel-partner')).resolves.toBeNull();
    await expect(svc.resolveAiAgentId(1, undefined)).resolves.toBeNull();
  });
});

/** REQ-260913-VN-Prerequisite-Gaps G1/G2 — explicit tenant default language. */
describe('SessionService default language (G1/G2)', () => {
  function build(tenant: Record<string, unknown>) {
    const sessionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: Partial<Session>) => ({ ...x }) as Session),
      save: jest.fn((x: Session) => Promise.resolve({ id: 99, ...x })),
    };
    return new SessionService(
      sessionRepo as never,
      { findOne: jest.fn().mockResolvedValue(tenant) } as never,
      {} as never,
      { publish: jest.fn().mockResolvedValue(undefined) } as never,
      { available: () => false, del: jest.fn() } as never,
    );
  }

  it('tenant default outranks the timezone for an English browser', async () => {
    const svc = build({ id: 2, timezone: 'Asia/Seoul', defaultLanguage: 'vi' });
    expect((await svc.findOrCreateForCustomer(2, 4, 'en-US')).language).toBe('VI');
  });

  it('an explicit non-English shopper language still wins over the tenant default', async () => {
    const svc = build({ id: 2, timezone: 'Asia/Seoul', defaultLanguage: 'vi' });
    expect((await svc.findOrCreateForCustomer(2, 4, 'ko-KR')).language).toBe('KO');
  });

  it('no default → timezone as before; neither → EN', async () => {
    expect((await build({ id: 2, timezone: 'Asia/Ho_Chi_Minh', defaultLanguage: null }).findOrCreateForCustomer(2, 4, 'en')).language).toBe('VI');
    expect((await build({ id: 2, timezone: null, defaultLanguage: null }).findOrCreateForCustomer(2, 4, 'en')).language).toBe('EN');
  });
});
