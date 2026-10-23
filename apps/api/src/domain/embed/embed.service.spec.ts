import { EmbedService } from './embed.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Signed identity (PLN-260819 S2). The security property under test is narrow
 * and worth stating: a correct signature over a user id binds THAT user, and
 * nothing else does.
 */
const SECRET = 'shtk_testsecret';
const USER = 'go2joy-user-77';
const HASH = EmbedService.sign(SECRET, USER);

function build(
  opts: { secret?: string | null; session?: Record<string, unknown> | null; tenant?: Record<string, unknown> } = {},
) {
  const tenant = { id: 1, embedSecret: opts.secret === undefined ? SECRET : opts.secret, ...opts.tenant };
  const session =
    opts.session === undefined
      ? { id: 5, sessionToken: 'tok', tenantId: 1, customerId: null, identityLevel: 'guest' }
      : opts.session;

  const customers: Record<string, unknown>[] = [];
  const saved: Record<string, unknown>[] = [];

  const tenantRepo = {
    findOne: jest.fn(async () => tenant),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const customerRepo = {
    findOne: jest.fn(async ({ where }: { where: { externalCustomerId: string } }) =>
      customers.find((c) => c.externalCustomerId === where.externalCustomerId) ?? null,
    ),
    create: (v: Record<string, unknown>) => ({ ...v }),
    save: jest.fn(async (c: Record<string, unknown>) => {
      const row = { id: customers.length + 100, ...c };
      const at = customers.findIndex((x) => x.externalCustomerId === c.externalCustomerId);
      if (at >= 0) customers[at] = row;
      else customers.push(row);
      return row;
    }),
  };
  const sessionRepo = {
    findOne: jest.fn(async () => session),
    save: jest.fn(async (s: Record<string, unknown>) => {
      saved.push(s);
      return s;
    }),
  };
  const redis = { del: jest.fn(async () => undefined) };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new EmbedService(tenantRepo as any, customerRepo as any, sessionRepo as any, redis as any);
  return { service, customers, saved, redis, tenantRepo };
}

describe('EmbedService.identify', () => {
  it('binds the session to the signed user', async () => {
    const h = build();
    const session = await h.service.identify({
      sessionToken: 'tok',
      userId: USER,
      hash: HASH,
      name: 'Nguyen',
      email: 'n@example.vn',
    });

    expect(session.identityLevel).toBe('verified');
    expect(session.customerId).toBe(100);
    expect(h.customers[0]).toMatchObject({ externalCustomerId: USER, name: 'Nguyen' });
    // The cached session would otherwise keep serving the guest view.
    expect(h.redis.del).toHaveBeenCalled();
  });

  it('rejects a tampered signature', async () => {
    const h = build();
    await expect(
      h.service.identify({ sessionToken: 'tok', userId: USER, hash: `${HASH.slice(0, 63)}0` }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
  });

  it('rejects a valid signature replayed for a different user', async () => {
    // The whole point of signing the id: the hash is not a bearer token.
    const h = build();
    await expect(
      h.service.identify({ sessionToken: 'tok', userId: 'someone-else', hash: HASH }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
  });

  it('rejects when the tenant has no secret — and says nothing more', async () => {
    const h = build({ secret: null });
    await expect(
      h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
  });

  it('refuses an unknown session before looking at the signature', async () => {
    const h = build({ session: null });
    await expect(
      h.service.identify({ sessionToken: 'nope', userId: USER, hash: HASH }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.SESSION_NOT_FOUND.code });
  });

  it('converges on one customer when called repeatedly', async () => {
    const h = build();
    for (let i = 0; i < 3; i++) {
      await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH });
    }
    expect(h.customers).toHaveLength(1);
  });

  it('follows the host for the display name, but fills only gaps for email (PLN-261019 HA D2)', async () => {
    const h = build();
    await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH, name: 'First', email: 'a@x.vn' });
    await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH, name: 'Second', email: 'b@x.vn' });
    // The signed host is the source of truth for what its user is called — a
    // rename in its profile must reach the widget header. Email stays
    // gap-fill: it is matched against orders and must not be rewritten.
    expect(h.customers[0]).toMatchObject({ name: 'Second', email: 'a@x.vn' });
    // A blank name is "nothing to say", not "clear the name".
    await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH, name: '  ' });
    expect(h.customers[0]).toMatchObject({ name: 'Second' });
  });
});

describe('EmbedService.identify — signed attributes (PLN-261015 D2)', () => {
  const ATTRS = { hotel_id: 'H-1024', region: 'north', role: 'reception' };
  // What a host server computes — spelled out so the format is pinned by a test,
  // not only by the helper it is checking.
  const ATTR_HASH = require('crypto')
    .createHmac('sha256', SECRET)
    .update(`${USER}\nhotel_id=H-1024\nregion=north\nrole=reception`)
    .digest('hex');

  it('stores attributes signed together with the user id', async () => {
    const h = build();
    const session = await h.service.identify({ sessionToken: 'tok', userId: USER, hash: ATTR_HASH, attributes: ATTRS });
    expect(session.identityAttributes).toEqual(ATTRS);
    expect(EmbedService.sign(SECRET, USER, ATTRS)).toBe(ATTR_HASH);
  });

  it('rejects attributes the signature does not cover', async () => {
    // A hash over the id alone must not let the browser add a region: the
    // region decides which agent gets the conversation.
    const h = build();
    await expect(
      h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH, attributes: ATTRS }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
  });

  it('rejects a changed attribute value', async () => {
    const h = build();
    await expect(
      h.service.identify({
        sessionToken: 'tok',
        userId: USER,
        hash: ATTR_HASH,
        attributes: { ...ATTRS, region: 'south' },
      }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
  });

  it('ignores unknown keys — they are neither signed nor stored', async () => {
    const h = build();
    const session = await h.service.identify({
      sessionToken: 'tok',
      userId: USER,
      hash: ATTR_HASH,
      attributes: { ...ATTRS, is_admin: 'true' },
    });
    expect(session.identityAttributes).toEqual(ATTRS);
  });

  it('keeps the id-only signature working and clears earlier attributes', async () => {
    const h = build({
      session: { id: 5, sessionToken: 'tok', tenantId: 1, customerId: null, identityLevel: 'guest', identityAttributes: ATTRS },
    });
    const session = await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH });
    expect(session.identityLevel).toBe('verified');
    expect(session.identityAttributes).toBeNull();
  });
});

describe('EmbedService.identify — consent via host terms (PLN-261015 D9)', () => {
  const pending = { id: 5, sessionToken: 'tok', tenantId: 1, customerId: null, identityLevel: 'guest', consentState: 'pending', consentVersion: null };

  it('records a signed user as consented, with time and the tenant notice version', async () => {
    const h = build({ tenant: { consentSource: 'host_terms', consentNoticeVersion: '2026-10-vn' }, session: { ...pending } });
    const s = await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH });
    expect(s.consentState).toBe('granted');
    expect(s.consentVersion).toBe('2026-10-vn');
    expect(s.consentAt).toBeInstanceOf(Date);
  });

  it('leaves consent alone for a widget-consent tenant', async () => {
    const h = build({ session: { ...pending } });
    const s = await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH });
    expect(s.consentState).toBe('pending');
  });

  it('never overrides an explicit decline', async () => {
    const h = build({ tenant: { consentSource: 'host_terms' }, session: { ...pending, consentState: 'declined' } });
    const s = await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH });
    expect(s.consentState).toBe('declined');
  });

  it('grants nothing when the signature fails', async () => {
    const session = { ...pending };
    const h = build({ tenant: { consentSource: 'host_terms' }, session });
    await expect(h.service.identify({ sessionToken: 'tok', userId: USER, hash: 'bad' })).rejects.toBeTruthy();
    expect(session.consentState).toBe('pending');
  });
});

describe('EmbedService.rotateSecret', () => {
  it('issues a prefixed secret and stores it', async () => {
    const h = build();
    const secret = await h.service.rotateSecret(1);
    expect(secret).toMatch(/^shtk_[0-9a-f]{48}$/);
    expect(h.tenantRepo.update).toHaveBeenCalledWith({ id: 1 }, { embedSecret: secret });
  });

  it('never issues the same secret twice', async () => {
    const h = build();
    const a = await h.service.rotateSecret(1);
    const b = await h.service.rotateSecret(1);
    expect(a).not.toEqual(b);
  });
});

/** Stored form (PLN-261022 stage 1): verified on the raw values, saved normalised. */
describe('EmbedService.identify — region normalisation', () => {
  const config = {
    handoffConfig: { provinceRegions: { 'Hồ Chí Minh': 'south', 'Đà Nẵng': 'south_center' } },
  };
  const withMap = () => {
    const h = build();
    const aiConfigRepo = { findOne: jest.fn(async () => config) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new EmbedService(
      (h.service as any).tenantRepo,
      (h.service as any).customerRepo,
      (h.service as any).sessionRepo,
      (h.service as any).redis,
      aiConfigRepo as any,
    );
    return { svc, aiConfigRepo };
  };

  it('fills the region from the province map when only the province is signed', async () => {
    const { svc } = withMap();
    const attrs = { hotel_id: '3001', province: 'Đà Nẵng' };
    const session = await svc.identify({ sessionToken: 'tok', userId: USER, hash: EmbedService.sign(SECRET, USER, attrs), attributes: attrs });
    expect(session.identityAttributes).toEqual({ hotel_id: '3001', province: 'Đà Nẵng', region: 'south_center' });
  });

  it('verifies a decomposed value as sent, then stores it composed with a canonical region', async () => {
    const { svc } = withMap();
    const attrs = { province: 'Hồ Chí Minh'.normalize('NFD'), region: 'South' };
    const session = await svc.identify({ sessionToken: 'tok', userId: USER, hash: EmbedService.sign(SECRET, USER, attrs), attributes: attrs });
    expect(session.identityAttributes).toEqual({ province: 'Hồ Chí Minh', region: 'south' });
  });

  it('does not read the map when no province arrived', async () => {
    const { svc, aiConfigRepo } = withMap();
    const attrs = { hotel_id: '1', region: 'north' };
    await svc.identify({ sessionToken: 'tok', userId: USER, hash: EmbedService.sign(SECRET, USER, attrs), attributes: attrs });
    expect(aiConfigRepo.findOne).not.toHaveBeenCalled();
  });
});

/** B2B account registration (PLN-261022 stage 2). */
describe('EmbedService.identify — company contact', () => {
  const withCompanies = (company: object | null = { id: '3' }) => {
    const h = build();
    const companies = {
      upsertFromIdentity: jest.fn(async () => company),
      linkContact: jest.fn(async () => undefined),
    };
    const convRepo = { update: jest.fn(async () => ({ affected: 1 })) };
    const customerRepo = (h.service as any).customerRepo;
    customerRepo.update = jest.fn(async () => ({ affected: 1 }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new EmbedService(
      (h.service as any).tenantRepo,
      customerRepo,
      (h.service as any).sessionRepo,
      (h.service as any).redis,
      undefined,
      companies as any,
      convRepo as any,
    );
    return { svc, companies, convRepo, customerRepo, h };
  };

  it('a signed hotel_id makes the user a contact of that company', async () => {
    const { svc, companies, convRepo, customerRepo } = withCompanies();
    const attrs = { hotel_id: '1721', hotel_name: 'A In Hotel Del Luna', role: 'Lễ tân' };
    const session = await svc.identify({ sessionToken: 'tok', userId: 'ha:1001', hash: EmbedService.sign(SECRET, 'ha:1001', attrs), attributes: attrs });
    expect(session.companyId).toBe(3);
    expect(customerRepo.update).toHaveBeenCalledWith({ id: 100 }, { customerType: 'b2b_contact' });
    expect(companies.upsertFromIdentity).toHaveBeenCalledWith(1, expect.objectContaining({ hotel_id: '1721' }));
    expect(companies.linkContact).toHaveBeenCalledWith(1, 3, 100, 'Lễ tân');
    // A thread opened before signing in now belongs to the account.
    expect(convRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 5 }),
      { customerId: 100, companyId: 3 },
    );
  });

  it('without a hotel_id: no company, the customer type is left alone', async () => {
    const { svc, companies, customerRepo } = withCompanies();
    const attrs = { role: 'Quản lý' };
    const session = await svc.identify({ sessionToken: 'tok', userId: 'ha:1001', hash: EmbedService.sign(SECRET, 'ha:1001', attrs), attributes: attrs });
    expect(session.companyId).toBeNull();
    expect(companies.upsertFromIdentity).not.toHaveBeenCalled();
    expect(customerRepo.update).not.toHaveBeenCalled();
  });

  it('a registration failure never fails the identify', async () => {
    const { svc, companies } = withCompanies();
    companies.upsertFromIdentity.mockRejectedValueOnce(new Error('db down'));
    const attrs = { hotel_id: '1721' };
    const session = await svc.identify({ sessionToken: 'tok', userId: 'ha:1001', hash: EmbedService.sign(SECRET, 'ha:1001', attrs), attributes: attrs });
    expect(session.identityLevel).toBe('verified');
    expect(session.companyId).toBeNull();
  });
});

/**
 * Unsigned host (PLN-261022 unsigned). A tenant on the allow-list may identify
 * a user before its server can sign: the call is kept as 'claimed' — facts on
 * the session for agents and routing, and nothing a customer would own.
 */
describe('EmbedService.identify — unsigned host, claimed', () => {
  const ENV = 'EMBED_UNSIGNED_IDENTIFY_TENANT_IDS';
  const ATTRS = { hotel_id: '1721', hotel_name: 'A In Hotel Del Luna', province: 'Hồ Chí Minh', region: 'South', role: 'Lễ tân' };
  const pending = () => ({ id: 5, sessionToken: 'tok', tenantId: 1, customerId: null, identityLevel: 'guest', consentState: 'pending', consentVersion: null });

  const harness = (opts: { secret?: string | null; session?: Record<string, unknown>; tenant?: Record<string, unknown> } = {}) => {
    const h = build({ secret: opts.secret, session: opts.session ?? pending(), tenant: { consentSource: 'host_terms', ...opts.tenant } });
    const companies = { upsertFromIdentity: jest.fn(async () => ({ id: '3' })), linkContact: jest.fn(async () => undefined) };
    const convRepo = { update: jest.fn(async () => ({ affected: 1 })) };
    const aiConfigRepo = { findOne: jest.fn(async () => ({ handoffConfig: { provinceRegions: { 'Đà Nẵng': 'south_center' } } })) };
    const customerRepo = (h.service as any).customerRepo;
    customerRepo.update = jest.fn(async () => ({ affected: 1 }));
    const audit = { write: jest.fn(async () => ({})) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new EmbedService(
      (h.service as any).tenantRepo,
      customerRepo,
      (h.service as any).sessionRepo,
      (h.service as any).redis,
      aiConfigRepo as any,
      companies as any,
      convRepo as any,
      audit as any,
    );
    return { svc, h, companies, convRepo, audit };
  };

  afterEach(() => {
    delete process.env[ENV];
  });

  it('keeps an unsigned identify as claimed: normalised facts + who, on the session only', async () => {
    process.env[ENV] = '1';
    const { svc, h, companies, convRepo } = harness();
    const s = await svc.identify({ sessionToken: 'tok', userId: 'ha:8818', hash: 'testing', name: 'G2J SUPPORT', attributes: ATTRS });

    expect(s.identityLevel).toBe('claimed');
    expect(s.identityAttributes).toEqual({
      hotel_id: '1721',
      hotel_name: 'A In Hotel Del Luna',
      province: 'Hồ Chí Minh',
      region: 'south',
      role: 'Lễ tân',
      user_id: 'ha:8818',
      name: 'G2J SUPPORT',
    });
    // Nothing a customer would own: no customer, no company, no thread, no consent.
    expect(s.customerId).toBeNull();
    expect(h.customers).toHaveLength(0);
    expect(companies.upsertFromIdentity).not.toHaveBeenCalled();
    expect(convRepo.update).not.toHaveBeenCalled();
    expect(s.consentState).toBe('pending');
    expect(h.redis.del).toHaveBeenCalled();
  });

  describe('host-terms consent for a claimed user (PLN-261023)', () => {
    it('is granted when the tenant trusts claimed sign-ins — still no customer or company', async () => {
      process.env[ENV] = '1';
      const { svc, h, companies } = harness({ tenant: { hostTermsTrust: 'claimed', consentNoticeVersion: '2026-07' } });
      const s = await svc.identify({ sessionToken: 'tok', userId: 'laquan10', hash: 'testing', name: 'ADMIN123', attributes: ATTRS });
      expect(s.identityLevel).toBe('claimed');
      expect(s.consentState).toBe('granted');
      expect(s.consentVersion).toBe('2026-07');
      expect(s.consentAt).toBeInstanceOf(Date);
      expect(s.customerId).toBeNull();
      expect(h.customers).toHaveLength(0);
      expect(companies.upsertFromIdentity).not.toHaveBeenCalled();
    });

    it('is not granted under the default trust (signed only)', async () => {
      process.env[ENV] = '1';
      const { svc } = harness({ tenant: { hostTermsTrust: 'signed' } });
      const s = await svc.identify({ sessionToken: 'tok', userId: 'laquan10', hash: 'testing' });
      expect(s.consentState).toBe('pending');
    });

    it('never overrides an explicit decline', async () => {
      process.env[ENV] = '1';
      const { svc } = harness({ tenant: { hostTermsTrust: 'claimed' }, session: { ...pending(), consentState: 'declined' } });
      const s = await svc.identify({ sessionToken: 'tok', userId: 'laquan10', hash: 'testing' });
      expect(s.consentState).toBe('declined');
    });

    it('does nothing for a widget-consent tenant', async () => {
      process.env[ENV] = '1';
      const { svc } = harness({ tenant: { consentSource: 'widget', hostTermsTrust: 'claimed' } });
      const s = await svc.identify({ sessionToken: 'tok', userId: 'laquan10', hash: 'testing' });
      expect(s.consentState).toBe('pending');
    });

    it('is still rejected (401) when the tenant is not allowed unsigned identify', async () => {
      const { svc } = harness({ tenant: { hostTermsTrust: 'claimed' } });
      await expect(svc.identify({ sessionToken: 'tok', userId: 'laquan10', hash: 'testing' })).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  it('claims when the tenant has no secret at all', async () => {
    process.env[ENV] = '1';
    const { svc } = harness({ secret: null });
    const s = await svc.identify({ sessionToken: 'tok', userId: 'ha:8818', hash: 'testing' });
    expect(s.identityLevel).toBe('claimed');
    expect(s.identityAttributes).toEqual({ user_id: 'ha:8818' });
  });

  it('never stores email or phone for a claimed identity', async () => {
    process.env[ENV] = '1';
    const { svc, h } = harness();
    const s = await svc.identify({ sessionToken: 'tok', userId: 'ha:8818', hash: 'x', email: 'a@x.vn', phone: '0123', name: 'A' });
    expect(JSON.stringify(s.identityAttributes)).not.toMatch(/a@x\.vn|0123/);
    expect(h.customers).toHaveLength(0);
  });

  it('fills the region from the province map, like a signed identify', async () => {
    process.env[ENV] = '1';
    const { svc } = harness();
    const s = await svc.identify({ sessionToken: 'tok', userId: 'ha:1', hash: 'x', attributes: { province: 'Đà Nẵng' } });
    expect(s.identityAttributes).toMatchObject({ province: 'Đà Nẵng', region: 'south_center' });
  });

  it('never downgrades a verified session', async () => {
    process.env[ENV] = '1';
    const verified = { ...pending(), identityLevel: 'verified', customerId: 100, identityAttributes: { hotel_id: '9' } };
    const { svc } = harness({ session: verified });
    await expect(
      svc.identify({ sessionToken: 'tok', userId: 'ha:8818', hash: 'testing', attributes: ATTRS }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
    expect(verified).toMatchObject({ identityLevel: 'verified', customerId: 100, identityAttributes: { hotel_id: '9' } });
  });

  it('rejects as before for a tenant that is not on the list', async () => {
    process.env[ENV] = '2, 3';
    const session = pending();
    const { svc } = harness({ session });
    await expect(
      svc.identify({ sessionToken: 'tok', userId: 'ha:8818', hash: 'testing', attributes: ATTRS }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
    expect(session.identityLevel).toBe('guest');
  });

  it('rejects as before when the list is unset', async () => {
    const { svc } = harness();
    await expect(svc.identify({ sessionToken: 'tok', userId: 'ha:8818', hash: 'testing' })).rejects.toMatchObject({
      errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code,
    });
  });

  it('a correct signature later promotes the claimed session to verified', async () => {
    process.env[ENV] = ' 4 , 1 ';
    const { svc, h } = harness();
    await svc.identify({ sessionToken: 'tok', userId: 'ha:8818', hash: 'testing', name: 'G2J SUPPORT', attributes: ATTRS });
    const signed = { hotel_id: '1721', region: 'south' };
    const s = await svc.identify({
      sessionToken: 'tok',
      userId: 'ha:8818',
      hash: EmbedService.sign(SECRET, 'ha:8818', signed),
      name: 'G2J SUPPORT',
      attributes: signed,
    });
    expect(s.identityLevel).toBe('verified');
    expect(s.customerId).toBe(100);
    expect(h.customers[0]).toMatchObject({ externalCustomerId: 'ha:8818', name: 'G2J SUPPORT' });
    // Replaced by the signed facts — the unverified who-keys are gone.
    expect(s.identityAttributes).toEqual(signed);
    expect(s.consentState).toBe('granted');
  });

  /** Host sign-ins on the agent work log (PLN-261022 P6). */
  describe('work log', () => {
    it('logs one sign-in when the session gets its user — not again on every page load', async () => {
      process.env[ENV] = '1';
      const { svc, audit } = harness();
      for (let i = 0; i < 3; i++) {
        await svc.identify({ sessionToken: 'tok', userId: 'ha:8818', hash: 'testing', name: 'G2J SUPPORT', email: 'a@x.vn', attributes: ATTRS });
      }
      expect(audit.write).toHaveBeenCalledTimes(1);
      expect(audit.write).toHaveBeenCalledWith({
        tenantId: 1,
        actorType: 'host',
        actorId: 5,
        action: 'host.user_signed_in',
        target: 'session:5',
        metadata: { level: 'claimed', hotelId: '1721', region: 'south' },
      });
      // No name, email or user id in the audit trail.
      expect(JSON.stringify(audit.write.mock.calls)).not.toMatch(/G2J SUPPORT|a@x\.vn|ha:8818/);
    });

    it('logs again when another user signs in on the session, and when a signature arrives', async () => {
      process.env[ENV] = '1';
      const { svc, audit } = harness();
      await svc.identify({ sessionToken: 'tok', userId: 'ha:1', hash: 'x' });
      await svc.identify({ sessionToken: 'tok', userId: 'ha:2', hash: 'x' });
      await svc.identify({ sessionToken: 'tok', userId: 'ha:2', hash: EmbedService.sign(SECRET, 'ha:2') });
      await svc.identify({ sessionToken: 'tok', userId: 'ha:2', hash: EmbedService.sign(SECRET, 'ha:2') });
      expect(audit.write.mock.calls.map((c) => (c as unknown as [{ metadata: { level: string } }])[0].metadata.level)).toEqual([
        'claimed',
        'claimed',
        'verified',
      ]);
    });

    it('a work-log failure never fails the identify', async () => {
      process.env[ENV] = '1';
      const { svc, audit } = harness();
      audit.write.mockRejectedValueOnce(new Error('db down'));
      await expect(svc.identify({ sessionToken: 'tok', userId: 'ha:1', hash: 'x' })).resolves.toMatchObject({ identityLevel: 'claimed' });
    });

    it('a rejected identify logs nothing', async () => {
      const { svc, audit } = harness();
      await expect(svc.identify({ sessionToken: 'tok', userId: 'ha:1', hash: 'x' })).rejects.toBeTruthy();
      expect(audit.write).not.toHaveBeenCalled();
    });
  });
});
