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
  });

  it('scopes the escalation dedupe lookup to the tenant', async () => {
    const h = build();

    await h.svc.onEscalation({ tenantId: 3, conversationId: 42, reason: 'user_request' });

    const where = h.alertRepo.findOne.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.tenantId).toBe(3);
    expect(where.conversationId).toBe(42);
  });
});

/**
 * Who the alarm is addressed to (PLN-261007 Team Routing). An explicit label —
 * the team the customer picked, or a deny rule's stamp — outranks the tenant's
 * general assignee list; with no such agent online the configured assignee is
 * used; with neither the row stays a broadcast (alarms never drop).
 */
describe('AgentAlertService — label routing precedence', () => {
  function build(opts: { labelUsers: number[]; online: number[] }) {
    const saved: Array<Partial<AgentAlert>> = [];
    const alertRepo = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async (a: Partial<AgentAlert>) => {
        saved.push(a);
        return { id: 1, ...a } as AgentAlert;
      }),
      create: jest.fn((a: Partial<AgentAlert>) => a as AgentAlert),
    };
    const mailer = { send: jest.fn() };
    const svc = new AgentAlertService(
      alertRepo as never,
      { find: jest.fn(async () => [{ id: 3, tenantId: 1, code: 'sales_admin' }]) } as never,
      { find: jest.fn(async () => opts.labelUsers.map((userId) => ({ userId, jobLabelId: 3 }))) } as never,
      {
        find: jest.fn(async () =>
          opts.online.map((userId) => ({ tenantId: 1, userId, status: 'online', maxConcurrent: 5 })),
        ),
      } as never,
      { count: jest.fn(async () => 0) } as never,
      { subscribe: jest.fn() } as never,
      { get: jest.fn((k: string) => (k === 'ALERT_EMAIL_TO' ? 'ops@example.com' : undefined)) } as never,
      mailer as never,
    );
    return { svc, saved, mailer };
  }

  const base = { tenantId: 1, conversationId: 42, reason: 'user_request', targetUserIds: [9] };

  it('the chosen team label wins over the configured assignee', async () => {
    const h = build({ labelUsers: [21, 22], online: [22] });
    await h.svc.onEscalation({ ...base, issueLabel: 'sales_admin', supportLabel: 'Business Support' });
    expect(h.saved[0].targetUserId).toBe(22);
    // The channels say which team was asked for.
    expect(h.mailer.send.mock.calls[0][0].text).toContain('Team: Business Support');
  });

  it('falls back to the configured assignee when nobody with the label is online', async () => {
    const h = build({ labelUsers: [21], online: [] });
    await h.svc.onEscalation({ ...base, issueLabel: 'sales_admin' });
    expect(h.saved[0].targetUserId).toBe(9);
  });

  it('stays a broadcast with neither', async () => {
    const h = build({ labelUsers: [], online: [] });
    await h.svc.onEscalation({ tenantId: 1, conversationId: 42, reason: 'user_request', issueLabel: 'sales_admin' });
    expect(h.saved[0].targetUserId).toBeNull();
    expect(h.mailer.send.mock.calls[0][0].text).not.toContain('Team:');
  });
});
