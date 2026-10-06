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
 * Policy deny-list: what the customer hears while the agent is paged
 * (REQ/PLN-260826).
 *
 * The rule always reaches a human. What changed is that a rule may now answer
 * first — on staging a shopper asking "환불계좌 바꾸고 싶어" was handed off in
 * 290ms and waited two minutes for an agent to retype an answer six knowledge
 * documents already held.
 */
describe('ChatService — deny-list mode', () => {
  const build = (
    opts: {
      mode?: string;
      confidence?: number;
      blocked?: boolean;
      intent?: string;
      needsOrderData?: boolean;
    } = {},
  ) => {
    const conversation = {
      id: 77,
      sessionId: 5,
      tenantId: 1,
      status: CONVERSATION_STATUS.AI_ACTIVE,
    } as Conversation;
    const session = {
      id: 5,
      sessionToken: 'tok-5',
      tenantId: 1,
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
      findOne: jest.fn(async () => ({ id: 1, privacyPolicyUrl: null, consentNoticeVersion: null }) as Tenant),
    } as unknown as Repository<Tenant>;
    const redis = {
      available: () => false,
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as RedisService;
    const busPublish = jest.fn();
    const bus = { publish: busPublish } as unknown as EventBusService;

    const svc = new ChatService(
      convRepo,
      msgRepo,
      sessionRepo,
      tenantRepo,
      { find: jest.fn(async () => []) } as unknown as Repository<User>,
      { update: jest.fn() } as never,
      {
        classifyIntent: jest.fn(async () => ({
          intent: opts.intent ?? 'cancel_refund',
          needsOrderData: opts.needsOrderData ?? false,
          confidence: 0.8,
        })),
        answerWithoutKnowledge: jest.fn(async () => '안녕하세요!'),
        answer: jest.fn(async () => ({
          text: '환불계좌는 마이페이지에서 변경하실 수 있습니다.',
          confidence: opts.confidence ?? 0.9,
          citations: [{ id: 2098, title: '환불계좌 변경' }],
        })),
        effectiveAgentId: jest.fn(async () => null),
        // Guest gate (PLN-261001 v1.1): every agent is open unless a test says otherwise.
        agentGuestPolicy: jest.fn(async () => 'open'),
      } as unknown as RagService,
      {
        moderate: jest.fn(async () => ({
          decision: opts.blocked ? MODERATION_DECISION.BLOCKED : MODERATION_DECISION.DELIVERED,
          text: '환불계좌는 마이페이지에서 변경하실 수 있습니다.',
        })),
      } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      new SessionService(sessionRepo, tenantRepo, bus, redis),
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () =>
          opts.mode === undefined
            ? null
            : { type: 'refund', label: 'accounting', mode: opts.mode },
        ),
      } as unknown as HandoffRouterService,
      bus,
    );
    return { svc, session, saved, busPublish };
  };

  const ask = (b: ReturnType<typeof build>) =>
    b.svc.handleUserMessage(b.session, '환불계좌 바꾸고 싶어');

  it('silent mode hands off without answering — unchanged', async () => {
    const b = build({ mode: 'silent' });

    const res = await ask(b);

    expect(res.reply?.senderType).toBe('system');
    expect(res.escalate).toBe(true);
    expect(b.saved.some((m) => m.senderType === 'ai')).toBe(false);
  });

  it('answer_then_handoff delivers the answer AND still pages an agent', async () => {
    const b = build({ mode: 'answer_then_handoff' });

    const res = await ask(b);

    expect(res.reply?.senderType).toBe('ai');
    expect(res.reply?.body).toContain('마이페이지');
    // The guarantee the rule exists for: a person still gets it.
    expect(res.escalate).toBe(true);
    expect(b.busPublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'policy', issueType: 'refund', issueLabel: 'accounting' }),
    );
  });

  it('persists the answer before the handoff notice, not after', async () => {
    // Order is the whole point for the customer: being told to wait and then
    // answered reads as the wait having been pointless.
    const b = build({ mode: 'answer_then_handoff' });

    await ask(b);

    const kinds = b.saved.map((m) => m.senderType);
    expect(kinds.indexOf('ai')).toBeLessThan(kinds.lastIndexOf('system'));
  });

  it('falls back to a plain handoff when the answer is not confident', async () => {
    const b = build({ mode: 'answer_then_handoff', confidence: 0.1 });

    const res = await ask(b);

    expect(res.reply?.senderType).toBe('system');
    expect(b.saved.some((m) => m.senderType === 'ai')).toBe(false);
    // The issue keeps the deny rule's desk — losing it here would send the
    // topic to the wrong team exactly when a person is needed.
    expect(b.busPublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ issueType: 'refund', issueLabel: 'accounting' }),
    );
  });

  it('hands off a deny topic that reads as chit-chat instead of chatting back', async () => {
    // These paths never reach the knowledge base, so "answer first" has nothing
    // to answer with. Returning the friendly reply and no agent would cancel
    // the handoff rather than defer it — the one thing the rule guarantees.
    const b = build({ mode: 'answer_then_handoff', intent: 'smalltalk' });

    const res = await ask(b);

    expect(res.reply?.senderType).toBe('system');
    expect(res.escalate).toBe(true);
    expect(b.busPublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'policy', issueLabel: 'accounting' }),
    );
  });

  it('answers a guest from knowledge instead of demanding a sign-in first', async () => {
    // The classifier marks "환불계좌 바꾸고 싶어" as needing order data, so a
    // guest asking it hit the sign-in gate and left with neither the policy nor
    // a person. Nothing is guessed here — a guest has no order context, so the
    // answer is grounded in the knowledge base alone and the agent still gets
    // the thread.
    const b = build({ mode: 'answer_then_handoff', needsOrderData: true });

    const res = await ask(b);

    expect(res.needsAuth).toBe(false);
    expect(res.reply?.senderType).toBe('ai');
    expect(res.escalate).toBe(true);
    expect(b.busPublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'policy' }),
    );
  });

  it('still asks a guest to sign in when no deny rule is answering first', async () => {
    const b = build({ mode: 'silent', needsOrderData: true });

    const res = await ask(b);

    // Silent rules hand off before this gate is reached at all.
    expect(res.reply?.senderType).toBe('system');
    expect(res.escalate).toBe(true);
  });

  it('falls back to a plain handoff when moderation blocks the answer', async () => {
    const b = build({ mode: 'answer_then_handoff', blocked: true });

    const res = await ask(b);

    expect(res.reply?.senderType).toBe('system');
    expect(b.busPublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ issueType: 'refund', issueLabel: 'accounting' }),
    );
  });
});
