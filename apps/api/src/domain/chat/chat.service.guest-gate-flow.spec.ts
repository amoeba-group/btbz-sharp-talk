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
import { HandoffRouterService } from '../handoff/handoff-router.service';
import { EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';

/**
 * The guest gate's decision inside handleUserMessage (PLN-261001 B-gate).
 *
 * The first cut opened the gate on "any guest-visible hit". That never closed
 * in practice: nearest-neighbour retrieval returns its top-k for every query
 * once a single public document exists, so a signed-out partner asking about
 * reconciliation was answered from the sign-up guide (S3 local run,
 * TCR-261006 §7). The gate now asks the same question the handoff decision
 * asks — is the guest-visible grounding confident enough to answer from? —
 * and these pin that: the threshold, the scope flag, and the two bypasses
 * (verified session, open agent).
 */
describe('ChatService guest gate — decision', () => {
  let svc: ChatService;
  let ragAnswer: jest.Mock;
  let grounding: jest.Mock;
  let policy: jest.Mock;
  let msgSave: jest.Mock;

  const makeSession = (identityLevel: 'guest' | 'verified'): Session =>
    ({
      id: 5,
      sessionToken: 'tok-5',
      tenantId: 1,
      customerId: null,
      identityLevel,
      language: 'VI',
      consentState: CONSENT_STATE.GRANTED,
      consentAt: null,
      consentVersion: CONSENT_NOTICE_VERSION,
      identityClaims: null,
    }) as unknown as Session;

  const build = (guestPolicy: 'open' | 'login_guidance', confidence: number) => {
    const conversation = {
      id: 77,
      sessionId: 5,
      tenantId: 1,
      status: CONVERSATION_STATUS.AI_ACTIVE,
    } as Conversation;
    let nextMessageId = 100;
    msgSave = jest.fn(async (m: Message) => ({ ...m, id: m.id ?? nextMessageId++ }) as Message);
    ragAnswer = jest.fn(async () => ({ text: 'AI answer', confidence: 0.9, citations: [] }));
    grounding = jest.fn(async () => confidence);
    policy = jest.fn(async () => guestPolicy);

    const convRepo = {
      findOne: jest.fn(async () => conversation),
      save: jest.fn(async (c: Conversation) => c),
      create: (c: Partial<Conversation>) => c,
      update: jest.fn(),
      findOneOrFail: jest.fn(async () => conversation),
    } as unknown as Repository<Conversation>;
    const msgRepo = {
      save: msgSave,
      create: (m: Partial<Message>) => m,
      update: jest.fn(),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
    } as unknown as Repository<Message>;
    const sessionRepo = {
      findOne: jest.fn(async () => session),
      save: jest.fn(async (s: Session) => s),
    } as unknown as Repository<Session>;
    const tenantRepo = {
      findOne: jest.fn(async () => ({ id: 1, privacyPolicyUrl: null, consentNoticeVersion: null }) as Tenant),
    } as unknown as Repository<Tenant>;
    const userRepo = { find: jest.fn(async () => []) } as unknown as Repository<User>;
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const bus = { publish: jest.fn() } as unknown as EventBusService;
    const sessionService = new SessionService(sessionRepo, tenantRepo, bus, redis);

    svc = new ChatService(
      convRepo,
      msgRepo,
      sessionRepo,
      tenantRepo,
      userRepo,
      { update: jest.fn() } as never,
      {
        classifyIntent: jest.fn(async () => ({ intent: 'general_inquiry', needsOrderData: false, confidence: 0.8 })),
        answer: ragAnswer,
        effectiveAgentId: jest.fn(async () => 10),
        agentGuestPolicy: policy,
        groundingConfidence: grounding,
        guestGuidance: jest.fn(async () => null),
      } as unknown as RagService,
      { moderate: jest.fn(async () => ({ decision: MODERATION_DECISION.DELIVERED, text: 'AI answer' })) } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      sessionService,
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () => null),
      } as unknown as HandoffRouterService,
      bus,
    );
  };

  let session: Session;
  const QUESTION = 'Hạn hoàn tất đối soát là khi nào?';

  it('prompts a sign-in when the guest-visible grounding is below the handoff bar', async () => {
    session = makeSession('guest');
    build('login_guidance', 0.2);

    const result = await svc.handleUserMessage(session, QUESTION);

    expect(result.needsAuth).toBe(true);
    expect(result.authReason).toBe('login');
    expect(result.reply?.senderType).toBe('system');
    expect(result.reply?.body).toContain('đăng nhập');
    expect(ragAnswer).not.toHaveBeenCalled();
    // Measured on the public scope only — the whole point of the gate.
    expect(grounding).toHaveBeenCalledWith(1, expect.any(String), 10, { guestOnly: true });
    // The prompt is a persisted system turn, so the transcript shows what the
    // visitor was told.
    expect(msgSave).toHaveBeenCalled();
  });

  it('answers from the guest-visible scope when the grounding clears the bar', async () => {
    session = makeSession('guest');
    build('login_guidance', 0.8);

    const result = await svc.handleUserMessage(session, 'Làm sao đăng ký trở thành đối tác?');

    expect(result.needsAuth).toBe(false);
    expect(result.reply?.senderType).toBe('ai');
    expect(ragAnswer).toHaveBeenCalled();
    const opts = ragAnswer.mock.calls[0][ragAnswer.mock.calls[0].length - 1];
    expect(opts).toMatchObject({ guestOnly: true });
  });

  it('never gates a verified (signed-in) session, however weak the public grounding', async () => {
    session = makeSession('verified');
    build('login_guidance', 0.2);

    const result = await svc.handleUserMessage(session, QUESTION);

    expect(result.needsAuth).toBe(false);
    expect(ragAnswer).toHaveBeenCalled();
    expect(grounding).not.toHaveBeenCalled();
    const opts = ragAnswer.mock.calls[0][ragAnswer.mock.calls[0].length - 1];
    expect(opts).toMatchObject({ guestOnly: false });
  });

  it('is inert for an open agent — today\'s behaviour, no extra retrieval', async () => {
    session = makeSession('guest');
    build('open', 0.2);

    const result = await svc.handleUserMessage(session, QUESTION);

    expect(result.needsAuth).toBe(false);
    expect(grounding).not.toHaveBeenCalled();
    expect(ragAnswer).toHaveBeenCalled();
  });
});
