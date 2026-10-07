import { AgentService } from './agent.service';
import { Conversation } from '../chat/entity/conversation.entity';
import { toSessionResponse } from './agent.mapper';
import { Message } from '../chat/entity/message.entity';

/** listSessions — queue query, customer-name search branch (PLN-260804). */
describe('AgentService.listSessions', () => {
  const conv = (id: number, sessionId: number): Conversation =>
    ({ id, tenantId: 1, sessionId, status: 'waiting', createdAt: new Date() }) as Conversation;

  function build(opts: {
    conversations?: Conversation[];
    customers?: Array<{ id: number }>;
    sessions?: Array<{ id: number }>;
  }) {
    const getManyAndCount = jest
      .fn()
      .mockResolvedValue([opts.conversations ?? [], (opts.conversations ?? []).length]);
    const wheres: string[] = [];
    const qb = {
      where: jest.fn(function (this: unknown) { return qb; }),
      andWhere: jest.fn((clause: string) => { wheres.push(clause); return qb; }),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount,
    } as Record<string, unknown>;
    const convRepo = { createQueryBuilder: jest.fn(() => qb), wheres, getManyAndCount };
    const msgRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    const sessionRepo = { find: jest.fn().mockResolvedValue(opts.sessions ?? []) };
    const customerService = {
      searchByEmailOrName: jest.fn().mockResolvedValue(opts.customers ?? []),
      contactsByIds: jest.fn().mockResolvedValue(new Map()),
    };
    const svc = new AgentService(
      convRepo as never,
      msgRepo as never,
      {} as never, // userRepo
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
    );
    return { svc, convRepo, sessionRepo, customerService };
  }

  it('without q, lists the queue unfiltered', async () => {
    const { svc, convRepo, customerService } = build({ conversations: [conv(2, 20), conv(1, 10)] });
    const res = await svc.listSessions(1, 1, 20);
    expect(res.total).toBe(2);
    expect(customerService.searchByEmailOrName).not.toHaveBeenCalled();
    expect(convRepo.wheres.some((w: string) => w.includes('session_id'))).toBe(false);
  });

  it('with q, filters by the matched customers sessions', async () => {
    const { svc, convRepo, sessionRepo, customerService } = build({
      conversations: [conv(3, 30)],
      customers: [{ id: 7 }],
      sessions: [{ id: 30 }],
    });
    const res = await svc.listSessions(1, 1, 20, 'kim');
    expect(customerService.searchByEmailOrName).toHaveBeenCalledWith(1, 'kim', 20);
    expect(sessionRepo.find).toHaveBeenCalled();
    expect(convRepo.wheres.some((w: string) => w.includes('session_id'))).toBe(true);
    expect(res.total).toBe(1);
  });

  it('with q matching no customer, returns an empty page without touching conversations', async () => {
    const { svc, convRepo } = build({ customers: [] });
    const res = await svc.listSessions(1, 1, 20, 'nobody');
    expect(res).toEqual({ items: [], total: 0 });
    expect(convRepo.getManyAndCount).not.toHaveBeenCalled();
  });
});

describe('listSessions — scope', () => {
  it.each([
    ['all', ['ai_active', 'waiting', 'agent']],
    ['queue', ['waiting', 'agent']],
    ['ended', ['ended']],
  ])('%s selects the right statuses', async (scope, expected) => {
    const { svc, convRepo } = buildScope();
    await svc.listSessions(1, 1, 50, undefined, scope as 'all' | 'queue' | 'ended');
    expect(convRepo.statuses).toEqual(expected);
  });

  function buildScope() {
    let statuses: string[] = [];
    const qb: Record<string, unknown> = {
      where: jest.fn(() => qb),
      andWhere: jest.fn((_c: string, params?: { statuses?: string[] }) => {
        if (params?.statuses) statuses = params.statuses;
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[], 0]),
    };
    const convRepo = { createQueryBuilder: () => qb, get statuses() { return statuses; } };
    const svc = new AgentService(
      convRepo as never,
      { createQueryBuilder: () => ({ select: () => ({ where: () => ({ getMany: async () => [] }) }) }) } as never,
      {} as never,
      { find: jest.fn(async () => []) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { contactsByIds: jest.fn(async () => new Map()) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, convRepo };
  }
});

describe('toSessionResponse', () => {
  it('carries the last message time for the queue row', () => {
    const at = new Date('2026-08-04T10:00:00Z');
    const res = toSessionResponse(
      { id: 1, status: 'waiting', escalated: 0, createdAt: new Date() } as Conversation,
      { body: 'hello there', createdAt: at } as Message,
      { name: 'Kim', email: null },
    );
    expect(res.lastMessageAt).toBe(at);
    expect(res.lastMessagePreview).toBe('hello there');
  });

  it('nulls both preview and time when the thread has no messages', () => {
    const res = toSessionResponse(
      { id: 1, status: 'waiting', escalated: 0, createdAt: new Date() } as Conversation,
      null,
    );
    expect(res.lastMessageAt).toBeNull();
    expect(res.lastMessagePreview).toBeNull();
  });
});

/**
 * Channel filter (PLN-260810 PR-M4). Rows written before external channels
 * existed carry 'widget' or NULL, so the widget view must accept both or those
 * conversations vanish from the console.
 */
describe('listSessions — channel filter', () => {
  function buildChannel() {
    const wheres: Array<{ clause: string; params?: Record<string, unknown> }> = [];
    const qb: Record<string, unknown> = {
      where: jest.fn(() => qb),
      andWhere: jest.fn((clause: string, params?: Record<string, unknown>) => {
        wheres.push({ clause, params });
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[], 0]),
    };
    const convRepo = { createQueryBuilder: () => qb, wheres };
    const svc = new AgentService(
      convRepo as never,
      { createQueryBuilder: () => ({ select: () => ({ where: () => ({ getMany: async () => [] }) }) }) } as never,
      {} as never,
      { find: jest.fn(async () => []) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { contactsByIds: jest.fn(async () => new Map()) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, convRepo };
  }

  it('filters by an external channel', async () => {
    const { svc, convRepo } = buildChannel();
    await svc.listSessions(1, 1, 50, undefined, 'all', 'telegram');
    const clause = convRepo.wheres.find((w) => w.clause.includes('c.channel'));
    expect(clause?.params).toMatchObject({ channel: 'telegram' });
  });

  it('treats widget as "widget or legacy NULL"', async () => {
    const { svc, convRepo } = buildChannel();
    await svc.listSessions(1, 1, 50, undefined, 'all', 'widget');
    expect(convRepo.wheres.some((w) => w.clause.includes('c.channel IS NULL'))).toBe(true);
  });

  it('adds no channel clause for "all" or when omitted', async () => {
    for (const channel of ['all', undefined]) {
      const { svc, convRepo } = buildChannel();
      await svc.listSessions(1, 1, 50, undefined, 'all', channel);
      expect(convRepo.wheres.some((w) => w.clause.includes('c.channel'))).toBe(false);
    }
  });
});

/** The queue row carries the origin channel so the console can badge it. */
describe('toSessionResponse — channel', () => {
  it('passes the conversation channel through', () => {
    const row = toSessionResponse({ id: 1, status: 'waiting', channel: 'kakao', escalated: 0 } as Conversation, null);
    expect(row.channel).toBe('kakao');
  });

  it('defaults a legacy NULL channel to widget', () => {
    const row = toSessionResponse({ id: 1, status: 'waiting', channel: null, escalated: 0 } as unknown as Conversation, null);
    expect(row.channel).toBe('widget');
  });
});

/**
 * Team filter (PLN-261007 Team Routing): the option the customer picked when
 * asking for a human. Rows that never chose only show under "all".
 */
describe('listSessions — team filter', () => {
  function buildTeam() {
    const wheres: Array<{ clause: string; params?: Record<string, unknown> }> = [];
    const qb: Record<string, unknown> = {
      where: jest.fn(() => qb),
      andWhere: jest.fn((clause: string, params?: Record<string, unknown>) => {
        wheres.push({ clause, params });
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[], 0]),
    };
    const svc = new AgentService(
      { createQueryBuilder: () => qb } as never,
      { createQueryBuilder: () => ({ select: () => ({ where: () => ({ getMany: async () => [] }) }) }) } as never,
      {} as never,
      { find: jest.fn(async () => []) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { contactsByIds: jest.fn(async () => new Map()) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, wheres };
  }

  it('filters by the chosen team', async () => {
    const { svc, wheres } = buildTeam();
    await svc.listSessions(1, 1, 50, undefined, 'queue', 'all', undefined, 'business');
    const clause = wheres.find((w) => w.clause.includes('c.support_type'));
    expect(clause?.params).toEqual({ supportType: 'business' });
  });

  it('adds no team clause for "all" or when omitted', async () => {
    for (const team of ['all', undefined, '  ']) {
      const { svc, wheres } = buildTeam();
      await svc.listSessions(1, 1, 50, undefined, 'queue', 'all', undefined, team);
      expect(wheres.some((w) => w.clause.includes('c.support_type'))).toBe(false);
    }
  });

  it('carries the chosen team on the queue row', () => {
    const row = toSessionResponse({ id: 1, sessionId: 2, supportType: 'cs' } as Conversation, null);
    expect(row.supportType).toBe('cs');
    const none = toSessionResponse({ id: 1, sessionId: 2 } as Conversation, null);
    expect(none.supportType).toBeNull();
  });
});
