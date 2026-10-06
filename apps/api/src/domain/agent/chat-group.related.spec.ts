import { FindOperator } from 'typeorm';
import { ChatGroupService } from './chat-group.service';

/**
 * Same-person suggestion (PLN-261006 P1, D4). Confirmed identities only —
 * the same customer row, or another row with the same email blind index —
 * never across tenants, and never a session already grouped with this one.
 */
describe('ChatGroupService.relatedSessions', () => {
  const inList = (v: unknown): number[] =>
    v instanceof FindOperator ? (v.value as number[]).map(Number) : [Number(v)];

  function build(opts: {
    sessionCustomer?: number | null;
    customers?: Array<{ id: number; emailHash: string | null }>;
    sessions?: Array<{ id: number; customerId: number | null; alias?: string | null }>;
    conversations?: Array<{ id: number; sessionId: number; channel?: string }>;
    members?: Array<{ groupId: number; sessionId: number }>;
    groups?: Array<{ id: number; title: string; kind: string }>;
  }) {
    const sessions = [
      { id: 1, tenantId: 1, customerId: opts.sessionCustomer ?? null, alias: null },
      ...(opts.sessions ?? []).map((s) => ({ tenantId: 1, alias: null, ...s })),
    ];
    const conversations = [
      { id: 100, sessionId: 1, tenantId: 1, channel: 'widget', createdAt: new Date('2026-10-06') },
      ...(opts.conversations ?? []).map((c) => ({ tenantId: 1, channel: 'widget', createdAt: new Date('2026-09-01'), ...c })),
    ];
    const customers = (opts.customers ?? []).map((c) => ({ tenantId: 1, ...c }));
    const members = (opts.members ?? []).map((m) => ({ tenantId: 1, ...m }));
    const groups = (opts.groups ?? []).map((g) => ({ tenantId: 1, ...g }));

    const sessionRepo = {
      findOne: jest.fn(async (q: { where: { id: number; tenantId: number } }) =>
        sessions.find((s) => s.id === q.where.id && s.tenantId === q.where.tenantId) ?? null,
      ),
      find: jest.fn(async (q: { where: { tenantId: number; customerId: unknown } }) => {
        const ids = inList(q.where.customerId);
        return sessions
          .filter((s) => s.tenantId === q.where.tenantId && s.customerId != null && ids.includes(s.customerId))
          .sort((a, b) => b.id - a.id);
      }),
    };
    const convRepo = {
      findOne: jest.fn(async (q: { where: { id: number; tenantId: number } }) =>
        conversations.find((c) => c.id === q.where.id && c.tenantId === q.where.tenantId) ?? null,
      ),
      find: jest.fn(async (q: { where: { sessionId: unknown } }) => {
        const ids = inList(q.where.sessionId);
        return conversations.filter((c) => ids.includes(c.sessionId)).sort((a, b) => b.id - a.id);
      }),
    };
    const customerRepo = {
      findOne: jest.fn(async (q: { where: { id: number } }) => customers.find((c) => c.id === q.where.id) ?? null),
      find: jest.fn(async (q: { where: { emailHash: string; tenantId: number } }) =>
        customers.filter((c) => c.emailHash === q.where.emailHash && c.tenantId === q.where.tenantId),
      ),
    };
    const memberRepo = {
      find: jest.fn(async (q: { where: { sessionId: unknown } }) => {
        const ids = inList(q.where.sessionId);
        return members.filter((m) => ids.includes(m.sessionId));
      }),
    };
    const groupRepo = {
      find: jest.fn(async (q: { where: { id: unknown } }) => {
        const ids = inList(q.where.id);
        return groups.filter((g) => ids.includes(g.id));
      }),
    };
    const svc = new ChatGroupService(
      groupRepo as never,
      memberRepo as never,
      sessionRepo as never,
      convRepo as never,
      {} as never,
      customerRepo as never,
      {} as never,
    );
    return { svc };
  }

  it('a guest session (no linked customer) has no suggestion', async () => {
    const { svc } = build({ sessionCustomer: null });
    const r = await svc.relatedSessions(100, 1);
    expect(r.sessions).toEqual([]);
  });

  it('lists other sessions of the same customer, newest first, with their latest conversation', async () => {
    const { svc } = build({
      sessionCustomer: 7,
      customers: [{ id: 7, emailHash: null }],
      sessions: [
        { id: 2, customerId: 7 },
        { id: 3, customerId: 7 },
      ],
      conversations: [
        { id: 200, sessionId: 2, channel: 'kakao' },
        { id: 201, sessionId: 2, channel: 'kakao' },
        { id: 300, sessionId: 3, channel: 'widget' },
      ],
    });
    const r = await svc.relatedSessions(100, 1);
    expect(r.sessions.map((s) => [s.sessionId, s.conversationId, s.matchedBy])).toEqual([
      [3, 300, 'customer'],
      [2, 201, 'customer'],
    ]);
  });

  it('matches another customer row with the same email, and says so', async () => {
    const { svc } = build({
      sessionCustomer: 7,
      customers: [
        { id: 7, emailHash: 'h1' },
        { id: 8, emailHash: 'h1' },
        { id: 9, emailHash: 'h2' },
      ],
      sessions: [
        { id: 4, customerId: 8 },
        { id: 5, customerId: 9 },
      ],
      conversations: [
        { id: 400, sessionId: 4 },
        { id: 500, sessionId: 5 },
      ],
    });
    const r = await svc.relatedSessions(100, 1);
    expect(r.sessions.map((s) => [s.sessionId, s.matchedBy])).toEqual([[4, 'email']]);
  });

  it('leaves out sessions already grouped with this one, keeps ones in other groups', async () => {
    const { svc } = build({
      sessionCustomer: 7,
      customers: [{ id: 7, emailHash: null }],
      sessions: [
        { id: 2, customerId: 7 },
        { id: 3, customerId: 7 },
      ],
      conversations: [
        { id: 200, sessionId: 2 },
        { id: 300, sessionId: 3 },
      ],
      members: [
        { groupId: 50, sessionId: 1 },
        { groupId: 50, sessionId: 2 },
        { groupId: 60, sessionId: 3 },
      ],
      groups: [
        { id: 50, title: '김OO', kind: 'timeline' },
        { id: 60, title: 'ACME', kind: 'project' },
      ],
    });
    const r = await svc.relatedSessions(100, 1);
    expect(r.currentGroups.map((g) => g.id)).toEqual([50]);
    expect(r.sessions.map((s) => s.sessionId)).toEqual([3]);
    expect(r.sessions[0].groups).toEqual([{ id: 60, title: 'ACME', kind: 'project' }]);
  });

  it('skips a sibling session nobody ever wrote in', async () => {
    const { svc } = build({
      sessionCustomer: 7,
      customers: [{ id: 7, emailHash: null }],
      sessions: [{ id: 2, customerId: 7 }],
    });
    const r = await svc.relatedSessions(100, 1);
    expect(r.sessions).toEqual([]);
  });

  it("another tenant's conversation id is not found", async () => {
    const { svc } = build({ sessionCustomer: 7 });
    await expect(svc.relatedSessions(100, 2)).rejects.toThrow();
  });
});
