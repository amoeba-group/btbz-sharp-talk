import { Repository } from 'typeorm';
import { AnalyticsService } from './analytics.service';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Notification } from '../notification/entity/notification.entity';
import { CjmEvent } from '../cjm/entity/cjm-event.entity';
import { OrderCache } from '../order/entity/order-cache.entity';
import { Session } from '../session/entity/session.entity';
import { Customer } from '../customer/entity/customer.entity';
import { User } from '../user/entity/user.entity';
import { RedisService } from '../../infrastructure/cache/redis.service';

/**
 * Conversation history: the filters that carry a policy decision (preview
 * exclusion, per-agent visibility) and the transcript read that the console
 * previously had no route for.
 */
describe('AnalyticsService — conversation history', () => {
  const conversation = {
    id: 77,
    sessionId: 5,
    tenantId: 1,
    channel: 'widget',
    status: 'ended',
    escalated: 1,
    agentId: 42,
    createdAt: new Date('2026-08-04T09:12:00Z'),
    endedAt: new Date('2026-08-04T09:31:00Z'),
  } as Conversation;

  const messages = [
    {
      id: 1,
      conversationId: 77,
      senderType: 'user',
      senderId: null,
      body: 'How much is return shipping?',
      lang: 'en',
      retrievalTrace: null,
      createdAt: new Date('2026-08-04T09:12:00Z'),
    },
    {
      id: 2,
      conversationId: 77,
      senderType: 'ai',
      senderId: null,
      body: 'It is $6.99.',
      lang: 'en',
      retrievalTrace: { citations: [{ id: 54, title: '2.2.2 Return shipping' }], confidence: 0.56 },
      createdAt: new Date('2026-08-04T09:12:30Z'),
    },
    {
      id: 3,
      conversationId: 77,
      senderType: 'agent',
      senderId: 42,
      body: 'Let me check that for you.',
      lang: null,
      retrievalTrace: null,
      createdAt: new Date('2026-08-04T09:15:00Z'),
    },
  ] as unknown as Message[];

  let clauses: string[];
  let convFindOne: jest.Mock;

  const build = (opts: { conv?: Conversation | null } = {}) => {
    clauses = [];
    const qb = {
      andWhere: jest.fn((c: string) => {
        clauses.push(c);
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[conversation], 1] as [Conversation[], number]),
    };
    convFindOne = jest.fn(async () => ('conv' in opts ? opts.conv : conversation));
    const convRepo = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: convFindOne,
      count: jest.fn(async () => 0),
    } as unknown as Repository<Conversation>;

    const msgRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(async () => [{ cid: '77', cnt: '3' }]),
      })),
      find: jest.fn(async () => messages),
    } as unknown as Repository<Message>;

    const sessionRepo = {
      find: jest.fn(async () => [
        { id: 5, channel: null, customerId: 8821, language: 'en' } as Session,
      ]),
    } as unknown as Repository<Session>;
    const customerRepo = {
      find: jest.fn(async () => [{ id: 8821, name: 'Jane Doe' } as Customer]),
    } as unknown as Repository<Customer>;
    const userRepo = {
      find: jest.fn(async () => [{ id: 42, name: 'Lee Sangdam', email: 'lee@shop.test' } as User]),
    } as unknown as Repository<User>;
    const empty = { count: jest.fn(async () => 0) } as unknown as Repository<never>;

    return new AnalyticsService(
      convRepo,
      msgRepo,
      empty as unknown as Repository<Notification>,
      empty as unknown as Repository<CjmEvent>,
      empty as unknown as Repository<OrderCache>,
      sessionRepo,
      customerRepo,
      userRepo,
      { available: () => false, get: jest.fn(), set: jest.fn() } as unknown as RedisService,
    );
  };

  it('excludes admin-preview threads by default', async () => {
    const svc = build();
    await svc.searchConversations(1, { page: 1, size: 20 });
    // The preview marker is on the session, not the conversation: every
    // conversation row is channel='widget', so filtering c.channel would let
    // the whole sandbox through.
    expect(clauses.some((c) => c.includes('sessions ps') && c.includes("'preview'"))).toBe(true);
  });

  it('includes preview threads only when explicitly asked', async () => {
    const svc = build();
    await svc.searchConversations(1, { page: 1, size: 20, includePreview: true });
    expect(clauses.some((c) => c.includes("'preview'"))).toBe(false);
  });

  it('pins the query to the caller when rank-restricted (D1)', async () => {
    const svc = build();
    await svc.searchConversations(1, { page: 1, size: 20, restrictToAgentId: 42 });
    expect(clauses).toContain('c.agent_id = :scopeAgent');
  });

  it('applies date range and message-body search', async () => {
    const svc = build();
    await svc.searchConversations(1, {
      page: 1,
      size: 20,
      from: new Date('2026-08-01'),
      to: new Date('2026-08-05'),
      q: 'refund',
    });
    expect(clauses).toContain('c.created_at >= :from');
    expect(clauses).toContain('c.created_at < :to');
    expect(clauses.some((c) => c.includes('messages qm'))).toBe(true);
  });

  it('resolves customer and agent names in the list', async () => {
    const svc = build();
    const { items } = await svc.searchConversations(1, { page: 1, size: 20 });
    expect(items[0].agentName).toBe('Lee Sangdam');
    expect(items[0].messageCount).toBe(3);
    // In the clear on the console (2026-10-23).
    expect(items[0].customerName).toBe('Jane Doe');
  });

  it('returns the transcript with AI grounding attached', async () => {
    const svc = build();
    const detail = await svc.conversationDetail(1, 77);
    const msgs = detail!.messages as Array<Record<string, unknown>>;
    expect(msgs).toHaveLength(3);
    // The grounding has been persisted since the RAG work but no read path
    // returned it — this is the whole point of the detail route.
    expect(msgs[1].trace).toEqual({
      citations: [{ id: 54, title: '2.2.2 Return shipping' }],
      confidence: 0.56,
    });
    expect(msgs[0].trace).toBeNull();
    // Agent turns are attributed to a person, not a bare sender_type.
    expect(msgs[2].senderName).toBe('Lee Sangdam');
  });

  it('scopes the transcript read by tenant and, when restricted, by agent', async () => {
    const svc = build();
    await svc.conversationDetail(1, 77, 42);
    expect(convFindOne).toHaveBeenCalledWith({ where: { id: 77, tenantId: 1, agentId: 42 } });
  });

  it('returns null (→ 404, not 403) for a conversation the caller may not read', async () => {
    const svc = build({ conv: null });
    expect(await svc.conversationDetail(1, 999, 42)).toBeNull();
  });

  it('ignores a malformed retrieval_trace instead of leaking it raw', async () => {
    const svc = build();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (messages[1] as any).retrievalTrace = 'not-an-object';
    const detail = await svc.conversationDetail(1, 77);
    const msgs = detail!.messages as Array<Record<string, unknown>>;
    expect(msgs[1].trace).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (messages[1] as any).retrievalTrace = { citations: [], confidence: 0.56 };
  });
});
