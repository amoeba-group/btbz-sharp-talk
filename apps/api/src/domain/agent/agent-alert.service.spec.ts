import { FindOperator } from 'typeorm';
import { AgentAlertService } from './agent-alert.service';
import { AgentAlert } from './entity/agent-alert.entity';

/**
 * Tenant fence on the escalation alarm feed (REQ-260824 R2). The alert rows
 * always carried tenant_id; these tests pin the read path so a broadcast
 * alarm can never surface on another tenant's console again.
 */
describe('AgentAlertService — tenancy', () => {
  function build(rows: Partial<AgentAlert>[] = []) {
    const finds: Array<Record<string, unknown>> = [];
    const alertRepo = {
      find: jest.fn(async (opts: { where: Array<Record<string, unknown>> }) => {
        finds.push(opts);
        return rows as AgentAlert[];
      }),
      findOne: jest.fn(
        async (opts: { where: Record<string, unknown> }) =>
          (rows.find(
            (r) =>
              r.id === opts.where.id &&
              (opts.where.tenantId === undefined || r.tenantId === opts.where.tenantId),
          ) ?? null) as AgentAlert | null,
      ),
      save: jest.fn(async (a: AgentAlert) => a),
      create: jest.fn((a: Partial<AgentAlert>) => a as AgentAlert),
      update: jest.fn(async () => ({ affected: 0 })),
    };
    const svc = new AgentAlertService(
      alertRepo as never,
      {} as never, // labelRepo
      {} as never, // userLabelRepo
      {} as never, // profileRepo
      {} as never, // assignmentRepo
      { subscribe: jest.fn() } as never, // bus
      { get: jest.fn(() => undefined) } as never, // config
      { send: jest.fn() } as never, // mailer
    );
    return { svc, alertRepo, finds };
  }

  it('fences both list branches (broadcast + addressed) to the tenant', async () => {
    const h = build();

    await h.svc.list('new', 7, 1);

    const where = (h.finds[0].where ?? []) as Array<Record<string, unknown>>;
    expect(where).toHaveLength(2);
    for (const branch of where) expect(branch.tenantId).toBe(1);
    // Branch order: broadcast (target IS NULL) then addressed-to-me.
    expect((where[0].targetUserId as FindOperator<unknown>).type).toBe('isNull');
    expect(where[1].targetUserId).toBe(7);
  });

  it('returns an empty feed without querying when the caller has no tenant', async () => {
    const h = build();

    await expect(h.svc.list('new', 7, 0)).resolves.toEqual([]);
    expect(h.alertRepo.find).not.toHaveBeenCalled();
  });

  it("refuses to ack another tenant's alert with the same 404 as a missing row", async () => {
    const h = build([{ id: 10, tenantId: 2, status: 'new' }]);

    await expect(h.svc.ack(10, 7, 1)).rejects.toThrow();
    expect(h.alertRepo.save).not.toHaveBeenCalled();
  });

  it('acks an own-tenant alert', async () => {
    const h = build([{ id: 10, tenantId: 1, status: 'new' }]);

    const acked = await h.svc.ack(10, 7, 1);

    expect(acked.status).toBe('acked');
    expect(acked.ackedBy).toBe(7);
    expect(h.alertRepo.save).toHaveBeenCalled();
    // Group alarm siblings stop paging once one agent has it (PLN-261015 D3).
    expect(h.alertRepo.update.mock.calls[0][0]).toMatchObject({ tenantId: 1, status: 'new' });
  });

  it('scopes the escalation dedupe lookup to the tenant', async () => {
    const h = build();

    await h.svc.onEscalation({ tenantId: 3, conversationId: 42, reason: 'user_request' });

    const where = h.alertRepo.findOne.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.tenantId).toBe(3);
    expect(where.conversationId).toBe(42);
  });
});

/** Region × topic group alarms (PLN-261015 D3). */
describe('AgentAlertService — routing-rule groups', () => {
  function build(profiles: Array<{ userId: number; maxConcurrent: number }>, load: Record<number, number> = {}) {
    const saved: Array<Partial<AgentAlert>> = [];
    const alertRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((a: Partial<AgentAlert>) => a as AgentAlert),
      save: jest.fn(async (a: AgentAlert | AgentAlert[]) => {
        const list = Array.isArray(a) ? a : [a];
        saved.push(...list);
        return a;
      }),
    };
    const profileRepo = {
      find: jest.fn(async ({ where }: { where: { userId: { value: number[] } } }) =>
        profiles.filter((p) => where.userId.value.includes(p.userId)),
      ),
    };
    const assignmentRepo = {
      count: jest.fn(async ({ where }: { where: { agentId: number } }) => load[where.agentId] ?? 0),
    };
    const svc = new AgentAlertService(
      alertRepo as never,
      {} as never,
      {} as never,
      profileRepo as never,
      assignmentRepo as never,
      { subscribe: jest.fn() } as never,
      { get: jest.fn(() => undefined) } as never,
      { send: jest.fn() } as never,
    );
    return { svc, saved };
  }
  const base = { tenantId: 4, conversationId: 900, reason: 'low_confidence', targetUserIds: [11, 12, 13] };

  it('least_loaded addresses only the free, least-busy online agent', async () => {
    const h = build(
      [
        { userId: 11, maxConcurrent: 3 },
        { userId: 12, maxConcurrent: 3 },
      ],
      { 11: 2, 12: 0 },
    );
    await h.svc.onEscalation({ ...base, assignMode: 'least_loaded' });
    expect(h.saved.map((a) => a.targetUserId)).toEqual([12]);
  });

  it('least_loaded with nobody online alarms the whole group, never nobody', async () => {
    const h = build([]);
    await h.svc.onEscalation({ ...base, assignMode: 'least_loaded' });
    expect(h.saved.map((a) => a.targetUserId)).toEqual([11, 12, 13]);
  });

  it('skips agents at their concurrency limit', async () => {
    const h = build([{ userId: 11, maxConcurrent: 1 }], { 11: 1 });
    await h.svc.onEscalation({ ...base, assignMode: 'least_loaded' });
    expect(h.saved.map((a) => a.targetUserId)).toEqual([11, 12, 13]);
  });

  it('broadcast alarms every group member', async () => {
    const h = build([{ userId: 11, maxConcurrent: 3 }]);
    await h.svc.onEscalation({ ...base, assignMode: 'broadcast' });
    expect(h.saved.map((a) => a.targetUserId)).toEqual([11, 12, 13]);
  });

  it('without a rule keeps the legacy single first-assignee row', async () => {
    const h = build([]);
    await h.svc.onEscalation(base);
    expect(h.saved.map((a) => a.targetUserId)).toEqual([11]);
  });
});
