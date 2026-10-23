import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuditLog } from './entity/audit-log.entity';
import { User } from '../user/entity/user.entity';
import { AdminUser } from '../auth/entity/admin-user.entity';
import { runWithRequestContext } from '../../global/middleware/request-context.middleware';

/** Actor-name lookups are exercised in the list suite below; write() never uses them. */
const userRepo = (rows: Array<Partial<User>> = []) =>
  ({ find: jest.fn(async () => rows) }) as unknown as Repository<User>;
const adminRepo = (rows: Array<Partial<AdminUser>> = []) =>
  ({ find: jest.fn(async () => rows) }) as unknown as Repository<AdminUser>;

describe('AuditService (Stage 4 — request context + system actor)', () => {
  let svc: AuditService;
  let saved: Array<Partial<AuditLog>>;

  beforeEach(() => {
    saved = [];
    const repo = {
      create: jest.fn((e: Partial<AuditLog>) => e as AuditLog),
      save: jest.fn(async (e: AuditLog) => {
        saved.push(e);
        return e;
      }),
    } as unknown as Repository<AuditLog>;
    svc = new AuditService(repo, userRepo(), adminRepo());
  });

  it('auto-fills ip/requestId from the request context and defaults result=success', async () => {
    await runWithRequestContext({ requestId: 'req-ctx-1', ip: '203.0.113.7' }, () =>
      svc.write({ tenantId: 1, actorType: 'user', actorId: 5, action: 'x.y' }),
    );
    expect(saved[0]).toMatchObject({
      tenantId: 1,
      actorType: 'user',
      actorId: 5,
      action: 'x.y',
      ip: '203.0.113.7',
      requestId: 'req-ctx-1',
      result: 'success',
      metadata: null,
    });
  });

  it('explicit ip/requestId/result/metadata win over the ambient context', async () => {
    await runWithRequestContext({ requestId: 'ambient', ip: '198.51.100.1' }, () =>
      svc.write({
        actorType: 'admin',
        actorId: 9,
        action: 'x.z',
        ip: '192.0.2.10',
        requestId: 'explicit-id',
        result: 'denied',
        metadata: { reason: 'test' },
      }),
    );
    expect(saved[0]).toMatchObject({
      ip: '192.0.2.10',
      requestId: 'explicit-id',
      result: 'denied',
      metadata: { reason: 'test' },
    });
  });

  it("persists the 'system' actor type for machine writers", async () => {
    await svc.write({ actorType: 'system', actorId: 0, action: 'retention.purge' });
    expect(saved[0]).toMatchObject({ actorType: 'system', actorId: 0 });
  });

  it('backward-compat: minimal legacy call outside any request scope', async () => {
    await svc.write({ actorType: 'user', actorId: 3, action: 'legacy.action' });
    expect(saved[0]).toMatchObject({
      tenantId: null,
      actorType: 'user',
      actorId: 3,
      action: 'legacy.action',
      target: null,
      ip: null,
      requestId: null,
      result: 'success',
      metadata: null,
    });
  });
});

describe('AuditService.list — filters + actor names', () => {
  const rows = [
    { id: 1, actorType: 'user', actorId: 5, action: 'agent.conversation_accepted' },
    { id: 2, actorType: 'admin', actorId: 9, action: 'tenant.approved' },
    { id: 3, actorType: 'system', actorId: 0, action: 'retention.purge' },
  ] as AuditLog[];

  const build = () => {
    const captured: Record<string, unknown> = {};
    const qb = {
      andWhere: jest.fn((clause: string, params: Record<string, unknown>) => {
        captured[clause] = params;
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [rows, rows.length] as [AuditLog[], number]),
    };
    const repo = { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<AuditLog>;
    const svc = new AuditService(
      repo,
      userRepo([{ id: 5, name: 'Lee Sangdam', email: 'lee@shop.test' }]),
      adminRepo([{ id: 9, email: 'admin@amoeba.group' }]),
    );
    return { svc, captured };
  };

  it('resolves each actor to a display name (regression: column was always "—")', async () => {
    const { svc } = build();
    const { items } = await svc.list({ tenantId: 1, page: 1, size: 20 });
    expect(items.map((i) => i.actorName)).toEqual(['Lee Sangdam', 'admin@amoeba.group', 'system']);
  });

  it('applies actor_id, action prefix and date-range filters', async () => {
    const { svc, captured } = build();
    await svc.list({
      tenantId: 1,
      actorId: 5,
      actionPrefix: 'agent.',
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-05T00:00:00Z'),
      page: 1,
      size: 20,
    });
    expect(captured['a.actor_id = :actorId']).toEqual({ actorId: 5 });
    expect(captured['a.action LIKE :prefix']).toEqual({ prefix: 'agent.%' });
    expect(captured['a.created_at >= :from']).toBeDefined();
    expect(captured['a.created_at < :to']).toBeDefined();
  });

  it('falls back to null when the actor row no longer exists', async () => {
    const qb = {
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[rows[0]], 1] as [AuditLog[], number]),
    };
    const repo = { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<AuditLog>;
    const svc = new AuditService(repo, userRepo([]), adminRepo([]));
    const { items } = await svc.list({ tenantId: 1, page: 1, size: 20 });
    expect(items[0].actorName).toBeNull();
  });
});

describe('AuditService.list — host sign-ins on the work log (PLN-261022 P6)', () => {
  const build = (rows: Partial<AuditLog>[]) => {
    const clauses: Array<[string, Record<string, unknown> | undefined]> = [];
    const qb = {
      andWhere: jest.fn((c: string, p?: Record<string, unknown>) => {
        clauses.push([c, p]);
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [rows, rows.length] as [AuditLog[], number]),
    };
    const repo = { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<AuditLog>;
    const sessionRepo = {
      find: jest.fn(async () => [
        { id: 18921, customerId: null, identityLevel: 'claimed', identityAttributes: { user_id: 'ha:8818', name: 'G2J SUPPORT' } },
        { id: 18922, customerId: 70, identityLevel: 'verified', identityAttributes: { hotel_id: '1' } },
      ]),
    };
    const customerRepo = { find: jest.fn(async () => [{ id: 70, name: 'Nguyễn An' }]) };
    const svc = new AuditService(repo, userRepo(), adminRepo(), sessionRepo as never, customerRepo as never);
    return { svc, clauses };
  };

  it('reads several action prefixes at once', async () => {
    const { svc, clauses } = build([]);
    await svc.list({ tenantId: 1, actionPrefix: 'agent., host.', page: 1, size: 20 });
    expect(clauses).toContainEqual(['(a.action LIKE :prefix0 OR a.action LIKE :prefix1)', { prefix0: 'agent.%', prefix1: 'host.%' }]);
  });

  it('names a host actor from the session it signed in on — claimed name or verified customer', async () => {
    const { svc } = build([
      { id: 1, actorType: 'host', actorId: 18921, action: 'host.user_signed_in' } as AuditLog,
      { id: 2, actorType: 'host', actorId: 18922, action: 'host.user_signed_in' } as AuditLog,
      { id: 3, actorType: 'host', actorId: 99, action: 'host.user_signed_in' } as AuditLog,
    ]);
    const { items } = await svc.list({ tenantId: 1, page: 1, size: 20 });
    // In the clear like customer names elsewhere on the console (2026-10-23).
    expect(items.map((i) => i.actorName)).toEqual(['G2J SUPPORT', 'Nguyễn An', null]);
  });
});

describe('AuditService.list — agent work log lens', () => {
  it("the work log's default view is the audit trail filtered to agent.*", async () => {
    // The work log is not a second store: one trail, two lenses. A console
    // action added server-side therefore appears without further wiring.
    const clauses: string[] = [];
    const qb = {
      andWhere: jest.fn((c: string) => {
        clauses.push(c);
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[], 0] as [AuditLog[], number]),
    };
    const repo = { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<AuditLog>;
    const svc = new AuditService(repo, userRepo(), adminRepo());
    await svc.list({ tenantId: 1, actionPrefix: 'agent.', page: 1, size: 20 });
    expect(clauses).toContain('a.action LIKE :prefix');
    // Tenant scoping is never dropped by the prefix filter.
    expect(clauses).toContain('a.tenant_id = :tenantId');
  });
});
