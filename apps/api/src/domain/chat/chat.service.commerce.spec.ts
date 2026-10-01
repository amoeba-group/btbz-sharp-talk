import { Repository } from 'typeorm';
import { CONSENT_STATE, CONVERSATION_STATUS, MODERATION_DECISION } from '@sharptalk/types';
import { ChatService } from './chat.service';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { RagService } from './rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { CONSENT_NOTICE_VERSION, SessionService } from '../session/session.service';
import { EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';

/**
 * Order sign-in gate vs. tenants with no orders (PLN-261001 S2).
 *
 * On staging a go2joy hotel partner asking "오늘 예약 현황 보기" was told to sign
 * in or use guest order lookup — a store login that does not exist for them.
 */
describe('ChatService — commerce_enabled order gate', () => {
  const build = (commerceEnabled: number | undefined, needsOrderData = true) => {
    const conversation = { id: 91, sessionId: 7, tenantId: 4, status: CONVERSATION_STATUS.AI_ACTIVE } as Conversation;
    const session = {
      id: 7,
      sessionToken: 'tok-7',
      tenantId: 4,
      customerId: null,
      identityLevel: 'guest',
      language: 'KO',
      consentState: CONSENT_STATE.GRANTED,
      consentAt: new Date(),
      consentVersion: CONSENT_NOTICE_VERSION,
    } as Session;
    const saved: Array<Partial<Message>> = [];
    let nextId = 100;
    const msgRepo = {
      save: jest.fn(async (m: Partial<Message>) => {
        const row = { ...m, id: nextId++ };
        saved.push(row);
        return row;
      }),
      create: (m: Partial<Message>) => m,
      update: jest.fn(),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
    } as unknown as Repository<Message>;
    const convRepo = {
      findOne: jest.fn(async () => conversation),
      save: jest.fn(async (c: Conversation) => c),
      create: (c: Partial<Conversation>) => c,
      update: jest.fn(),
      findOneOrFail: jest.fn(async () => conversation),
    } as unknown as Repository<Conversation>;
    const sessionRepo = {
      findOne: jest.fn(async () => session),
      save: jest.fn(async (s: Session) => s),
    } as unknown as Repository<Session>;
    const tenantRepo = {
      findOne: jest.fn(
        async () =>
          ({ id: 4, privacyPolicyUrl: null, consentNoticeVersion: null, commerceEnabled }) as unknown as Tenant,
      ),
    } as unknown as Repository<Tenant>;
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const bus = { publish: jest.fn() } as unknown as EventBusService;
    const rag = {
      classifyIntent: jest.fn(async () => ({ intent: 'order_status', needsOrderData, confidence: 0.85 })),
      answerWithoutKnowledge: jest.fn(async () => '안녕하세요!'),
      answer: jest.fn(async () => ({
        text: '홈 대시보드의 예약 현황에서 오늘 예약을 확인할 수 있습니다.',
        confidence: 0.9,
        citations: [{ id: 2600, title: 'Video 0 — Trang chủ' }],
      })),
      effectiveAgentId: jest.fn(async () => 21),
    } as unknown as RagService;
    const svc = new ChatService(
      convRepo,
      msgRepo,
      sessionRepo,
      tenantRepo,
      { find: jest.fn(async () => []) } as unknown as Repository<User>,
      { update: jest.fn() } as never,
      rag,
      {
        moderate: jest.fn(async (req: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text: req.text })),
      } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      new SessionService(sessionRepo, tenantRepo, bus, redis),
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () => null),
      } as unknown as HandoffRouterService,
      bus,
    );
    return { svc, session, saved, rag };
  };

  const ask = (b: ReturnType<typeof build>) => b.svc.handleUserMessage(b.session, '오늘 예약 현황 보기');

  it('a store still asks a guest to sign in for order questions', async () => {
    const b = build(1);
    const res = await ask(b);
    expect(res.needsAuth).toBe(true);
    expect(res.reply?.senderType).toBe('system');
    expect(b.rag.answer).not.toHaveBeenCalled();
  });

  it('a row without the column (older DB) behaves as a store', async () => {
    const res = await ask(build(undefined));
    expect(res.needsAuth).toBe(true);
  });

  it('a tenant with no orders answers from the knowledge base instead', async () => {
    const b = build(0);
    const res = await ask(b);
    expect(res.needsAuth).toBe(false);
    expect(res.reply?.senderType).toBe('ai');
    expect(res.reply?.body).toContain('대시보드');
    expect(b.rag.answer).toHaveBeenCalled();
    // The classifier's own label is kept for the intent statistics lens.
    expect(b.saved.some((m) => m.senderType === 'system')).toBe(false);
  });
});
