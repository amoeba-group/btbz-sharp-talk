import { AgentService } from './agent.service';

/**
 * CSAT aggregates (PLN-260826-Dashboard-Integration-CSAT-Stats): window
 * defaults, filter assembly, agent attribution and name mapping. Repo query
 * builders are recorded, not executed.
 */
describe('AgentService — CSAT statistics', () => {
  function qbRecorder(rawOne?: unknown, rawMany?: unknown[], rawAndEntities?: unknown) {
    const calls: Array<[string, unknown[]]> = [];
    const qb: Record<string, unknown> = {};
    for (const m of [
      'select',
      'addSelect',
      'where',
      'andWhere',
      'groupBy',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      qb[m] = jest.fn((...args: unknown[]) => {
        calls.push([m, args]);
        return qb;
      });
    }
    qb.getRawOne = jest.fn(async () => rawOne);
    qb.getRawMany = jest.fn(async () => rawMany ?? []);
    qb.getCount = jest.fn(async () => 1);
    qb.getRawAndEntities = jest.fn(async () => rawAndEntities ?? { entities: [], raw: [] });
    return { qb, calls };
  }

  function build(opts: {
    rawOne?: unknown;
    rawMany?: unknown[];
    rawAndEntities?: unknown;
    users?: Array<Record<string, unknown>>;
  }) {
    const rec = qbRecorder(opts.rawOne, opts.rawMany, opts.rawAndEntities);
    const convRepo = { createQueryBuilder: jest.fn(() => rec.qb) };
    const userRepo = { find: jest.fn(async () => opts.users ?? []) };
    const sessionRepo = { find: jest.fn(async () => []) };
    const customerService = { contactsByIds: jest.fn(async () => new Map()) };
    const svc = new AgentService(
      convRepo as never,
      {} as never, // msgRepo
      userRepo as never,
      sessionRepo as never,
      {} as never, // profileRepo
      {} as never, // assignmentRepo
      {} as never, // statRepo
      {} as never, // moderation
      customerService as never,
      {} as never, // aiGateway
      {} as never, // audit
      {} as never, // redis
      {} as never, // sessionService
      {} as never, // bus
      {} as never, // mailer
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    return { svc, ...rec, convRepo, userRepo };
  }

  const flat = (calls: Array<[string, unknown[]]>) => JSON.stringify(calls);

  it('summary: tenant + ended-status + explicit window, 5 distribution buckets', async () => {
    const h = build({ rawOne: { ended: '10', rated: '4', avg: '4.25', r1: '0', r2: '0', r3: '1', r4: '1', r5: '2' } });

    const res = await h.svc.csatSummary(7, '2026-08-01', '2026-08-26');

    expect(res).toEqual({
      from: '2026-08-01',
      to: '2026-08-26',
      ended: 10,
      rated: 4,
      resolved: { yes: 0, no: 0 },
      reasons: { unclear: 0, slow: 0, no_response: 0, software_error: 0, other: 0 },
      avg: 4.25,
      distribution: { '1': 0, '2': 0, '3': 1, '4': 1, '5': 2 },
    });
    const dump = flat(h.calls);
    expect(dump).toContain('"tenantId":7');
    // Half-open instants, not DATE(c.ended_at) BETWEEN …: wrapping the column
    // in a function rules out the index (AN-260826 P2). The upper bound is the
    // next midnight, which covers the whole of `to` without naming 23:59:59.
    expect(dump).toContain('c.ended_at >= :start AND c.ended_at < :end');
    expect(dump).toContain('"start":"2026-08-01 00:00:00"');
    expect(dump).toContain('"end":"2026-08-27 00:00:00"');
    // Sandbox threads are not customer conversations.
    expect(dump).toContain("ps.channel = 'preview'");
    expect(dump).toContain('csat_rating = 5');
  });

  it('summary with no window defaults to a 30-day range ending today', async () => {
    const h = build({ rawOne: { ended: '0', rated: '0', avg: null } });

    const res = await h.svc.csatSummary(7);

    expect(res.to).toBe(new Date().toISOString().slice(0, 10));
    const days = (Date.parse(res.to) - Date.parse(res.from)) / 86_400_000;
    expect(days).toBe(29);
    expect(res.avg).toBeNull();
  });

  it('per-agent rows attribute via COALESCE(agent_id, last agent sender) and map names', async () => {
    const h = build({
      rawMany: [
        { agentId: '22', rated: '3', avg: '4.6667' },
        { agentId: null, rated: '1', avg: '2' },
      ],
      users: [{ id: '22', name: '김상담', email: 'kim@x' }],
    });

    const rows = await h.svc.csatByAgent(7, '2026-08-01', '2026-08-26');

    expect(rows).toEqual([
      { agentId: 22, agentName: '김상담', rated: 3, avg: 4.6667 },
      { agentId: null, agentName: null, rated: 1, avg: 2 },
    ]);
    const dump = flat(h.calls);
    expect(dump).toContain('COALESCE(c.agent_id');
    expect(dump).toContain("m.sender_type = 'agent'");
    // Name lookup is tenant-fenced.
    const findArg = h.userRepo.find.mock.calls[0][0] as { where: { tenantId: number } };
    expect(findArg.where.tenantId).toBe(7);
  });

  it('conversation list applies rating and attributed-agent filters', async () => {
    const h = build({ rawAndEntities: { entities: [], raw: [] } });

    await h.svc.csatConversations(7, { rating: 1, agentId: 22, page: 1, size: 20 });

    const dump = flat(h.calls);
    expect(dump).toContain('c.csat_rating = :rating');
    expect(dump).toContain('"rating":1');
    expect(dump).toContain('= :agentId');
    expect(dump).toContain('"agentId":22');
    expect(dump).toContain('c.csat_rating IS NOT NULL');
  });

  it('conversation rows carry alias/name/attribution (string-id runtime types)', async () => {
    const conv = {
      id: '31',
      sessionId: '90',
      channel: null,
      csatRating: 5,
      csatRatedAt: new Date('2026-08-25T10:00:00Z'),
      endedAt: new Date('2026-08-25T09:00:00Z'),
      tenantId: 7,
    };
    const h = build({
      rawAndEntities: { entities: [conv], raw: [{ attributedAgentId: '22' }] },
      users: [{ id: '22', name: null, email: 'kim@x' }],
    });

    const res = await h.svc.csatConversations(7, { page: 1, size: 20 });

    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({
      id: 31,
      sessionId: '90',
      agentId: 22,
      agentName: 'kim@x', // name null → email fallback
      channel: 'widget', // null channel → widget
      rating: 5,
    });
  });
});
