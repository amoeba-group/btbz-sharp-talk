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

  it('fills gaps in the profile but never overwrites what is already known', async () => {
    const h = build();
    await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH, name: 'First' });
    await h.service.identify({ sessionToken: 'tok', userId: USER, hash: HASH, name: 'Second' });
    // Profile fields are unsigned; letting them overwrite would make an
    // unsigned field able to rewrite a verified record.
    expect(h.customers[0]).toMatchObject({ name: 'First' });
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
