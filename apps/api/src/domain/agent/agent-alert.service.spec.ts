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

describe('AgentAlertService.summary — partner line (REQ-261006 H4)', () => {
  const svc = Object.create(AgentAlertService.prototype) as AgentAlertService;
  const alert = { conversationId: 4820, reason: 'low_confidence', preview: 'Hạn đối soát?' } as AgentAlert;

  it('appends the signed partner label when the escalating session carried one', () => {
    const text = svc.summary(alert, 'A In Hotel Del Luna (1721) · receptionist');
    expect(text).toContain('Partner: A In Hotel Del Luna (1721) · receptionist');
    expect(text).toContain('conversation #4820');
    expect(text.endsWith('> Hạn đối soát?')).toBe(true);
  });

  it('is byte-identical to the pre-v1.1 text without a label', () => {
    expect(svc.summary(alert)).toBe(
      'Chat escalation — conversation #4820\nReason: AI could not answer from the knowledge base\n> Hạn đối soát?',
    );
    expect(svc.summary(alert, '  ')).not.toContain('Partner');
  });
});
