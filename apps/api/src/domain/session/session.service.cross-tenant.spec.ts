import { SessionService } from './session.service';
import { Session } from './entity/session.entity';
import { RedisService } from '../../infrastructure/cache/redis.service';

/**
 * FIX-260916 — a persisted widget token must not resume a session that belongs
 * to a different tenant than the shop the page declares.
 *
 * The widget origin is shared by every tenant on a deployment, so a standalone
 * or app-mode load for shop B could present the token shop A's widget had
 * stored — and ensure() resumed it, because the token lookup never compared the
 * session's tenant with the shop. Everything that made the old behaviour
 * convenient is kept: no shop, an unknown shop and tenant-less legacy sessions
 * still resume.
 */
describe('SessionService.ensure — cross-tenant token is not resumed', () => {
  const TENANTS = [
    { id: 1, shopDomain: 'ivyusa.myshopify.com', timezone: 'America/New_York', embedOrigins: null },
    { id: 4, shopDomain: 'app.go2joy.vn', timezone: 'Asia/Ho_Chi_Minh', embedOrigins: null },
  ];

  function build(existingTenantId: number | null = 4) {
    const existing = {
      id: 40,
      sessionToken: 'tok-40',
      tenantId: existingTenantId,
      aiAgentId: null,
    } as unknown as Session;
    const saved: Array<Record<string, unknown>> = [];
    const sessionRepo = {
      findOne: jest.fn(async (q: { where: { sessionToken: string } }) =>
        q.where.sessionToken === 'tok-40' ? existing : null,
      ),
      update: jest.fn(async () => ({ affected: 1 })),
      create: jest.fn((row: Record<string, unknown>) => row),
      save: jest.fn(async (row: Record<string, unknown>) => {
        saved.push(row);
        return { ...row, id: 41 };
      }),
    };
    const tenantRepo = {
      findOne: jest.fn(async (q: { where: { shopDomain?: string; id?: number } }) =>
        TENANTS.find((t) => t.shopDomain === q.where.shopDomain || t.id === q.where.id) ?? null,
      ),
      findAndCount: jest.fn(async () => [TENANTS.slice(0, 1), TENANTS.length]),
    };
    const publish = jest.fn();
    const redis = { available: () => true, get: jest.fn(), set: jest.fn(), del: jest.fn() };
    const svc = new SessionService(
      sessionRepo as never,
      tenantRepo as never,
      {} as never,
      { publish } as never,
      redis as unknown as RedisService,
      { findOne: jest.fn(async () => null) } as never,
    );
    return { svc, existing, saved, sessionRepo, tenantRepo, publish };
  }

  it('mints a NEW session for the declared shop when the token belongs to another tenant', async () => {
    const { svc, saved, publish } = build(4);
    const s = await svc.ensure('tok-40', 'en-US', 'ivyusa.myshopify.com');
    expect(saved).toHaveLength(1);
    expect(saved[0].tenantId).toBe(1);
    expect(s.sessionToken).not.toBe('tok-40');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('resumes when the token and the shop belong to the same tenant', async () => {
    const { svc, existing, saved } = build(4);
    const s = await svc.ensure('tok-40', 'vi', 'app.go2joy.vn');
    expect(s).toBe(existing);
    expect(saved).toHaveLength(0);
  });

  it('resumes when the page declares no shop (pre-fix behaviour)', async () => {
    const { svc, existing, saved } = build(4);
    const s = await svc.ensure('tok-40', 'vi', undefined);
    expect(s).toBe(existing);
    expect(saved).toHaveLength(0);
  });

  it('resumes when the declared shop matches no tenant — no new failure mode', async () => {
    const { svc, existing, saved } = build(4);
    const s = await svc.ensure('tok-40', 'vi', 'nobody.example');
    expect(s).toBe(existing);
    expect(saved).toHaveLength(0);
  });

  it('resumes a tenant-less legacy session regardless of shop', async () => {
    const { svc, existing, saved } = build(null);
    const s = await svc.ensure('tok-40', 'vi', 'ivyusa.myshopify.com');
    expect(s).toBe(existing);
    expect(saved).toHaveLength(0);
  });

  it('an unknown token still creates a session for the shop', async () => {
    const { svc, saved } = build(4);
    const s = await svc.ensure('tok-unknown', 'vi', 'app.go2joy.vn');
    expect(saved).toHaveLength(1);
    expect(saved[0].tenantId).toBe(4);
    expect(s.sessionToken).not.toBe('tok-unknown');
  });
});
