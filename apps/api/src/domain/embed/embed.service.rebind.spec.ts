import { CLAIMS_IAT_WINDOW_SEC, EmbedService, principalChanged } from './embed.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { sessionCacheKey } from '../session/session.service';

/**
 * One session = one (person, hotel, role) — PLN-261012 SG-02 / REQ D-02, D-03.
 *
 * Conversations hang off the session row, so `identify` rebinding a session to
 * someone else used to hand the new person the previous one's thread, open queue
 * entry and consent, and fed that history into the prompt. These specs pin the
 * replacement rule (a different principal gets a NEW session and the old one is
 * left alone), the cases that must NOT fork (guest upgrade, same principal, v1
 * tenants), and the server-side logout.
 *
 * The fakes are small in-memory stores rather than call-by-call stubs: the
 * property under test is "what is in the tables afterwards".
 */
const SECRET = 'shtk_testsecret';
const NOW = Math.floor(Date.now() / 1000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const CONSENT_AT = new Date('2026-10-01T09:00:00.000Z');

function guestSession(over: Row = {}): Row {
  return {
    id: 5,
    sessionToken: 'tok',
    tenantId: 4,
    channel: null,
    landingPath: 'https://hotel-admin.example/login',
    aiAgentId: 9,
    language: 'VI',
    languageLocked: 1,
    consentState: 'granted',
    consentAt: CONSENT_AT,
    consentVersion: '2026-07',
    customerId: null,
    identityLevel: 'guest',
    identityClaims: null,
    alias: null,
    autoReplyMode: 'inherit',
    openCount: 0,
    firstOpenedAt: null,
    ...over,
  };
}

function build(opts: { secret?: string | null; withConvRepo?: boolean } = {}) {
  const tenant = { id: 4, embedSecret: opts.secret === undefined ? SECRET : opts.secret };
  const sessions: Row[] = [guestSession()];
  const customers: Row[] = [];
  const conversations: Row[] = [];
  let nextSessionId = 6;

  const tenantRepo = { findOne: jest.fn(async () => tenant) };
  const customerRepo = {
    findOne: jest.fn(
      async ({ where }: { where: { externalCustomerId: string } }) =>
        customers.find((c) => c.externalCustomerId === where.externalCustomerId) ?? null,
    ),
    create: (v: Row) => ({ ...v }),
    save: jest.fn(async (c: Row) => {
      if (!c.id) {
        c.id = 100 + customers.length;
        customers.push(c);
      }
      return c;
    }),
    update: jest.fn(async ({ id }: { id: number }, set: Row) => {
      Object.assign(customers.find((c) => c.id === id) as Row, set);
      return { affected: 1 };
    }),
  };
  const sessionRepo = {
    findOne: jest.fn(
      async ({ where }: { where: { sessionToken: string } }) =>
        sessions.find((s) => s.sessionToken === where.sessionToken) ?? null,
    ),
    create: jest.fn((v: Row) => ({ ...v })),
    save: jest.fn(async (s: Row) => {
      if (!s.id) {
        s.id = nextSessionId++;
        sessions.push(s);
      }
      return s;
    }),
    update: jest.fn(async ({ id }: { id: number }, set: Row) => {
      Object.assign(sessions.find((s) => s.id === id) as Row, set);
      return { affected: 1 };
    }),
  };
  const convRepo = {
    update: jest.fn(async (where: { sessionId: number; status: string }, set: Row) => {
      const hit = conversations.filter((c) => c.sessionId === where.sessionId && c.status === where.status);
      hit.forEach((c) => Object.assign(c, set));
      return { affected: hit.length };
    }),
  };
  const redis = { del: jest.fn(async () => undefined) };

  const service = new EmbedService(
    tenantRepo as never,
    customerRepo as never,
    sessionRepo as never,
    redis as never,
    opts.withConvRepo === false ? undefined : (convRepo as never),
  );
  return { service, sessions, customers, conversations, sessionRepo, customerRepo, convRepo, redis };
}

const claims = (over: Partial<{ hotelSn: string; role: 'manager' | 'receptionist' | 'internal'; iat: number }> = {}) => ({
  hotelSn: '1721',
  role: 'receptionist' as const,
  iat: NOW,
  hotelName: 'A In Hotel Del Luna',
  hotelCode: 'HCM_001_001721',
  ...over,
});

/** A correctly signed v2 identify for `user` acting for a hotel. */
function v2(token: string, user: string, over: Parameters<typeof claims>[0] = {}) {
  const c = claims(over);
  return {
    sessionToken: token,
    userId: user,
    hash: EmbedService.signV2(SECRET, user, c.hotelSn, c.role, c.iat),
    claims: c,
  };
}

/** A correctly signed v1 identify (user id only, no claims). */
function v1(token: string, user: string) {
  return { sessionToken: token, userId: user, hash: EmbedService.sign(SECRET, user) };
}

/** Deep, date-safe copy for "left exactly as it was" assertions. */
const snap = (o: unknown) => JSON.parse(JSON.stringify(o));

describe('principalChanged', () => {
  const bound = { customerId: 100, identityClaims: { hotelSn: '1721', role: 'receptionist' } } as never;

  it('a guest (no customer yet) can become anyone without forking', () => {
    expect(principalChanged({ customerId: null, identityClaims: null }, 100, null)).toBe(false);
    expect(principalChanged({ customerId: null, identityClaims: null }, 100, { hotelSn: '1', role: 'manager' })).toBe(false);
  });

  it('same customer, hotel and role is the same principal', () => {
    expect(principalChanged(bound, 100, { hotelSn: '1721', role: 'receptionist' })).toBe(false);
  });

  it.each([
    ['customer', 101, { hotelSn: '1721', role: 'receptionist' as const }],
    ['hotel', 100, { hotelSn: '2204', role: 'receptionist' as const }],
    ['role', 100, { hotelSn: '1721', role: 'manager' as const }],
    ['claims dropped', 100, null],
  ])('a different %s is a different principal', (_what, customerId, c) => {
    expect(principalChanged(bound, customerId, c)).toBe(true);
  });

  it('v1 with v1 (no claims either side) is the same principal for the same customer', () => {
    expect(principalChanged({ customerId: 100, identityClaims: null }, 100, null)).toBe(false);
  });
});

describe('EmbedService.identify — fork on rebind (SG-02)', () => {
  it('guest -> user keeps the SAME session', async () => {
    const h = build();

    const out = await h.service.identify(v2('tok', 'staff-A'));

    expect(out.sessionToken).toBe('tok');
    expect(h.sessions).toHaveLength(1);
    expect(out.customerId).toBe(100);
    expect(out.identityLevel).toBe('verified');
    expect(out.identityClaims).toMatchObject({ hotelSn: '1721', role: 'receptionist', signed: true });
    // The cached guest view of this token must not outlive the binding.
    expect(h.redis.del).toHaveBeenCalledWith(sessionCacheKey('tok'));
  });

  it('the same user, hotel and role again is idempotent: same session, claims refreshed', async () => {
    const h = build();
    await h.service.identify(v2('tok', 'staff-A'));
    (h.sessions[0].identityClaims as Row).verifiedAt = '2000-01-01T00:00:00.000Z';

    const again = await h.service.identify(v2('tok', 'staff-A'));

    expect(again.sessionToken).toBe('tok');
    expect(h.sessions).toHaveLength(1);
    expect(h.customers).toHaveLength(1);
    expect((again.identityClaims as Row).verifiedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(h.redis.del).toHaveBeenLastCalledWith(sessionCacheKey('tok'));
  });

  it('a DIFFERENT user gets a new session and the old one is left untouched', async () => {
    const h = build();
    await h.service.identify(v2('tok', 'staff-A'));
    const before = snap(h.sessions[0]);
    h.redis.del.mockClear();

    const out = await h.service.identify(v2('tok', 'staff-B'));

    expect(out.sessionToken).not.toBe('tok');
    expect(out.id).not.toBe(5);
    expect(h.sessions).toHaveLength(2);
    expect(snap(h.sessions[0])).toEqual(before); // A's session: byte-for-byte as it was
    expect(out.customerId).toBe(101); // B's own customer row
    expect(out.customerId).not.toBe(h.sessions[0].customerId);
    expect(out.identityLevel).toBe('verified');
    expect(out.identityClaims).toMatchObject({ hotelSn: '1721', signed: true });
    // Nothing on the old token changed, so its cache entry is still right.
    expect(h.redis.del).not.toHaveBeenCalledWith(sessionCacheKey('tok'));
  });

  it('the SAME user on ANOTHER hotel gets a new session (a manager switching hotels)', async () => {
    const h = build();
    await h.service.identify(v2('tok', 'mgr-M', { role: 'manager', hotelSn: '1721' }));
    const before = snap(h.sessions[0]);

    const out = await h.service.identify(v2('tok', 'mgr-M', { role: 'manager', hotelSn: '2204' }));

    expect(out.sessionToken).not.toBe('tok');
    expect(h.sessions).toHaveLength(2);
    expect(snap(h.sessions[0])).toEqual(before);
    expect(out.customerId).toBe(h.sessions[0].customerId); // same person …
    expect((out.identityClaims as Row).hotelSn).toBe('2204'); // … other hotel
    expect((h.sessions[0].identityClaims as Row).hotelSn).toBe('1721');
  });

  it('the same user in ANOTHER role gets a new session', async () => {
    const h = build();
    await h.service.identify(v2('tok', 'staff-A', { role: 'receptionist' }));

    const out = await h.service.identify(v2('tok', 'staff-A', { role: 'manager' }));

    expect(out.sessionToken).not.toBe('tok');
    expect(h.sessions).toHaveLength(2);
    expect((out.identityClaims as Row).role).toBe('manager');
    expect((h.sessions[0].identityClaims as Row).role).toBe('receptionist');
  });

  it('adopting the new token and identifying again as the same principal does not fork again', async () => {
    const h = build();
    await h.service.identify(v2('tok', 'staff-A'));
    const forked = await h.service.identify(v2('tok', 'staff-B'));

    const again = await h.service.identify(v2(forked.sessionToken, 'staff-B'));

    expect(again.sessionToken).toBe(forked.sessionToken);
    expect(h.sessions).toHaveLength(2);
  });

  it('the new session inherits the visitor context — agent pin, language, consent, page — not the old identity', async () => {
    const h = build();
    h.sessions[0].alias = 'Ms. Lan (front desk)';
    h.sessions[0].autoReplyMode = 'off';
    h.sessions[0].openCount = 7;
    h.sessions[0].firstOpenedAt = new Date('2026-10-01T08:00:00.000Z');
    await h.service.identify(v2('tok', 'staff-A'));

    const out = await h.service.identify(v2('tok', 'staff-B'));

    expect(out).toMatchObject({
      tenantId: 4,
      aiAgentId: 9,
      channel: null,
      language: 'VI',
      languageLocked: 1,
      landingPath: 'https://hotel-admin.example/login',
      consentState: 'granted',
      consentVersion: '2026-07',
    });
    expect(out.consentAt).toEqual(CONSENT_AT);
    // Operator notes and impression counters belong to the old row.
    expect(out.alias ?? null).toBeNull();
    expect(out.autoReplyMode ?? 'inherit').toBe('inherit');
    expect(out.openCount ?? 0).toBe(0);
    expect(out.firstOpenedAt ?? null).toBeNull();
  });

  it('a pending consent is carried as pending, not upgraded', async () => {
    const h = build();
    h.sessions[0].consentState = 'pending';
    h.sessions[0].consentAt = null;
    h.sessions[0].consentVersion = null;
    await h.service.identify(v2('tok', 'staff-A'));

    const out = await h.service.identify(v2('tok', 'staff-B'));

    expect(out.consentState).toBe('pending');
    expect(out.consentVersion).toBeNull();
  });

  it('records the last claims on the customer of the NEW session', async () => {
    const h = build();
    await h.service.identify(v2('tok', 'staff-A', { hotelSn: '1721' }));
    await h.service.identify(v2('tok', 'staff-B', { hotelSn: '2204' }));

    const b = h.customers.find((c) => c.externalCustomerId === 'staff-B') as Row;
    const a = h.customers.find((c) => c.externalCustomerId === 'staff-A') as Row;
    expect(b.lastClaims).toMatchObject({ hotelSn: '2204' });
    expect(a.lastClaims).toMatchObject({ hotelSn: '1721' });
  });
});

describe('EmbedService.identify — v1 (no claims) tenants never fork on the same user', () => {
  it('Shopify/Odoo style: the same user identifying repeatedly stays on one session', async () => {
    const h = build();
    for (let i = 0; i < 4; i++) {
      const out = await h.service.identify(v1('tok', 'odoo-user-1'));
      expect(out.sessionToken).toBe('tok');
    }
    expect(h.sessions).toHaveLength(1);
    expect(h.customers).toHaveLength(1);
    expect(h.sessionRepo.create).not.toHaveBeenCalled();
  });

  it('a v1 identify of a DIFFERENT user still gets its own session', async () => {
    const h = build();
    await h.service.identify(v1('tok', 'odoo-user-1'));
    const before = snap(h.sessions[0]);

    const out = await h.service.identify(v1('tok', 'odoo-user-2'));

    expect(out.sessionToken).not.toBe('tok');
    expect(snap(h.sessions[0])).toEqual(before);
    expect(out.identityClaims).toBeNull();
  });

  it('a user who starts sending claims gets a clean session (no mixed-context thread)', async () => {
    const h = build();
    await h.service.identify(v1('tok', 'staff-A'));

    const out = await h.service.identify(v2('tok', 'staff-A'));

    expect(out.sessionToken).not.toBe('tok');
    expect(h.sessions[0].identityClaims).toBeNull();
    expect(out.identityClaims).toMatchObject({ hotelSn: '1721' });
  });
});

describe('EmbedService.identify — a failed identify mutates nothing', () => {
  async function boundHarness() {
    const h = build();
    await h.service.identify(v2('tok', 'staff-A'));
    h.redis.del.mockClear();
    h.sessionRepo.save.mockClear();
    h.sessionRepo.create.mockClear();
    h.customerRepo.save.mockClear();
    h.customerRepo.update.mockClear();
    return { h, sessions: snap(h.sessions), customers: snap(h.customers) };
  }

  it('a wrong hash for ANOTHER user neither forks nor rebinds', async () => {
    const { h, sessions, customers } = await boundHarness();
    const bad = { ...v2('tok', 'staff-B'), hash: `${'0'.repeat(63)}1` };

    await expect(h.service.identify(bad)).rejects.toMatchObject({
      errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code,
    });

    expect(snap(h.sessions)).toEqual(sessions);
    expect(snap(h.customers)).toEqual(customers); // not even B's customer row
    expect(h.sessionRepo.save).not.toHaveBeenCalled();
    expect(h.sessionRepo.create).not.toHaveBeenCalled();
    expect(h.customerRepo.save).not.toHaveBeenCalled();
    expect(h.redis.del).not.toHaveBeenCalled();
  });

  it('a hotel swapped after signing is refused and changes nothing', async () => {
    const { h, sessions } = await boundHarness();
    const signed = v2('tok', 'staff-A', { hotelSn: '1721' });

    await expect(
      h.service.identify({ ...signed, claims: { ...signed.claims, hotelSn: '2204' } }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });

    expect(snap(h.sessions)).toEqual(sessions);
    expect(h.sessionRepo.create).not.toHaveBeenCalled();
  });

  it('a stale signature is refused and changes nothing', async () => {
    const { h, sessions } = await boundHarness();

    await expect(
      h.service.identify(v2('tok', 'staff-B', { iat: NOW - CLAIMS_IAT_WINDOW_SEC - 60 })),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });

    expect(snap(h.sessions)).toEqual(sessions);
    expect(h.sessionRepo.create).not.toHaveBeenCalled();
  });

  it('an unknown token is refused before anything else happens', async () => {
    const h = build();

    await expect(h.service.identify(v2('nope', 'staff-A'))).rejects.toMatchObject({
      errorCode: ERROR_CODE.SESSION_NOT_FOUND.code,
    });

    expect(h.sessionRepo.save).not.toHaveBeenCalled();
    expect(h.customers).toHaveLength(0);
  });
});

describe('EmbedService.logout (SG-02)', () => {
  async function signedIn() {
    const h = build();
    await h.service.identify(v2('tok', 'staff-A'));
    h.redis.del.mockClear();
    return h;
  }

  it('clears the customer, claims and identity level and busts the session cache', async () => {
    const h = await signedIn();
    expect(h.sessions[0]).toMatchObject({ customerId: 100, identityLevel: 'verified' });

    await expect(h.service.logout('tok')).resolves.toEqual({ loggedOut: true });

    expect(h.sessions[0]).toMatchObject({ customerId: null, identityClaims: null, identityLevel: 'guest' });
    expect(h.redis.del).toHaveBeenCalledWith(sessionCacheKey('tok'));
    // The person is not erased — only this session's binding to them.
    expect(h.customers).toHaveLength(1);
  });

  it('ends the AI-owned open conversation of the session', async () => {
    const h = await signedIn();
    h.conversations.push({ id: 1, sessionId: 5, status: 'ai_active', endedAt: null });

    await h.service.logout('tok');

    expect(h.conversations[0].status).toBe('ended');
    expect(h.conversations[0].endedAt).toBeInstanceOf(Date);
  });

  it('does NOT close a conversation a human agent owns — it only unbinds the identity', async () => {
    const h = await signedIn();
    h.conversations.push({ id: 1, sessionId: 5, status: 'agent', endedAt: null, agentId: 3 });

    await h.service.logout('tok');

    expect(h.conversations[0]).toMatchObject({ status: 'agent', endedAt: null, agentId: 3 });
    expect(h.sessions[0]).toMatchObject({ customerId: null, identityLevel: 'guest' });
  });

  it('does NOT drop a request that is queued for a human (waiting)', async () => {
    const h = await signedIn();
    h.conversations.push({ id: 1, sessionId: 5, status: 'waiting', endedAt: null });

    await h.service.logout('tok');

    expect(h.conversations[0]).toMatchObject({ status: 'waiting', endedAt: null });
  });

  it("never touches another session's conversations", async () => {
    const h = await signedIn();
    h.conversations.push(
      { id: 1, sessionId: 5, status: 'ai_active', endedAt: null },
      { id: 2, sessionId: 77, status: 'ai_active', endedAt: null },
    );

    await h.service.logout('tok');

    expect(h.conversations[1]).toMatchObject({ status: 'ai_active', endedAt: null });
  });

  it('leaves a fork sibling alone: logging out one session does not log out the other', async () => {
    const h = await signedIn();
    const forked = await h.service.identify(v2('tok', 'staff-B'));

    await h.service.logout('tok');

    expect(h.sessions.find((s) => s.sessionToken === forked.sessionToken)).toMatchObject({
      customerId: 101,
      identityLevel: 'verified',
    });
  });

  it('is idempotent: logging out twice, or a guest session, succeeds and changes nothing more', async () => {
    const h = await signedIn();
    await h.service.logout('tok');
    const once = snap(h.sessions);

    await expect(h.service.logout('tok')).resolves.toEqual({ loggedOut: true });

    expect(snap(h.sessions)).toEqual(once);
    const guest = build();
    await expect(guest.service.logout('tok')).resolves.toEqual({ loggedOut: true });
    expect(guest.sessions[0]).toMatchObject({ customerId: null, identityLevel: 'guest' });
  });

  it('an unknown token errors exactly like identify does, and writes nothing', async () => {
    const h = await signedIn();
    const before = snap(h.sessions);

    await expect(h.service.logout('does-not-exist')).rejects.toMatchObject({
      errorCode: ERROR_CODE.SESSION_NOT_FOUND.code,
    });

    expect(snap(h.sessions)).toEqual(before);
    expect(h.convRepo.update).not.toHaveBeenCalled();
    expect(h.redis.del).not.toHaveBeenCalled();
  });

  it('a conversation failure leaves the binding intact so the caller can retry', async () => {
    const h = await signedIn();
    h.convRepo.update.mockRejectedValueOnce(new Error('db down'));

    await expect(h.service.logout('tok')).rejects.toThrow('db down');

    expect(h.sessions[0]).toMatchObject({ customerId: 100, identityLevel: 'verified' });
    await expect(h.service.logout('tok')).resolves.toEqual({ loggedOut: true });
    expect(h.sessions[0]).toMatchObject({ customerId: null, identityLevel: 'guest' });
  });

  it('still unbinds when built without the conversation repository (older positional doubles)', async () => {
    const h = build({ withConvRepo: false });
    await h.service.identify(v2('tok', 'staff-A'));

    await h.service.logout('tok');

    expect(h.sessions[0]).toMatchObject({ customerId: null, identityLevel: 'guest' });
  });
});
