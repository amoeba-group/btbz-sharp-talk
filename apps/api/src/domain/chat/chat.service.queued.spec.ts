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
import { SessionService } from '../session/session.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import { EventBusService } from '../../infrastructure/infrastructure.module';

/**
 * Who answers while a thread sits in the agent queue (FIX-260806 A1), and how
 * much of the conversation the retrieval query gets to see (A2).
 *
 * Silence used to start the moment the thread was escalated, so a shopper who
 * asked another question after the handoff notice got nothing back at all —
 * even though no agent had picked the thread up (and, on staging, none existed).
 */
describe('ChatService — queued threads', () => {
  function build(
    opts: {
      status?: string;
      agentId?: number | null;
      confidence?: number;
      decision?: string;
      previousUserTurns?: string[];
    } = {},
  ) {
    const conversation = {
      id: 77,
      sessionId: 5,
      tenantId: 1,
      status: opts.status ?? CONVERSATION_STATUS.WAITING,
      agentId: opts.agentId ?? null,
    } as Conversation;
    const session = {
      id: 5,
      sessionToken: 'tok-5',
      tenantId: 1,
      customerId: null,
      language: 'EN',
      consentState: CONSENT_STATE.GRANTED,
      consentVersion: null,
    } as Session;

    let nextId = 100;
    const msgSave = jest.fn(async (m: Message) => ({ ...m, id: m.id ?? nextId++ }) as Message);
    const ragAnswer = jest.fn(async () => ({
      text: 'AI answer',
      confidence: opts.confidence ?? 0.9,
      citations: [],
    }));
    const moderate = jest.fn(async () => ({
      decision: opts.decision ?? MODERATION_DECISION.DELIVERED,
      text: 'AI answer',
    }));
    const busPublish = jest.fn();
    const convSave = jest.fn(async (c: Conversation) => c);
    const convUpdate = jest.fn();

    const convRepo = {
      findOne: jest.fn(async () => conversation),
      save: convSave,
      create: (c: Partial<Conversation>) => c,
      update: convUpdate,
      findOneOrFail: jest.fn(async () => conversation),
    } as unknown as Repository<Conversation>;
    const msgRepo = {
      save: msgSave,
      create: (m: Partial<Message>) => m,
      update: jest.fn(),
      // Newest-first, like the real history query the retrieval context now
      // derives from (PLN-260929 S8).
      find: jest.fn(async () =>
        (opts.previousUserTurns ?? [])
          .map((body, i) => ({ id: String(10 + i), senderType: 'user', body }) as unknown as Message)
          .reverse(),
      ),
      findOne: jest.fn(async () => null),
    } as unknown as Repository<Message>;
    const sessionRepo = {
      findOne: jest.fn(async () => session),
      save: jest.fn(async (s: Session) => s),
    } as unknown as Repository<Session>;
    const tenantRepo = {
      findOne: jest.fn(async () => ({ id: 1 }) as Tenant),
    } as unknown as Repository<Tenant>;

    const svc = new ChatService(
      convRepo,
      msgRepo,
      sessionRepo,
      tenantRepo,
      { find: jest.fn(async () => []) } as unknown as Repository<User>,
      { update: jest.fn() } as never, // Assignment repo (end-chat release; unused here)
      {
        effectiveAgentId: jest.fn(async () => null),
        classifyIntent: jest.fn(async () => ({
          intent: 'product_recommendation',
          needsOrderData: false,
          confidence: 0.9,
        })),
        answer: ragAnswer,
      } as unknown as RagService,
      { moderate } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      // Consent is not what these cases are about: report GRANTED so the turn
      // reaches the queue logic under test.
      {
        effectiveConsentFor: jest.fn(async () => CONSENT_STATE.GRANTED),
      } as unknown as SessionService,
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () => null),
      } as unknown as HandoffRouterService,
      { publish: busPublish } as unknown as EventBusService,
    );
    return { svc, session, ragAnswer, moderate, msgSave, busPublish, convUpdate };
  }

  it('keeps answering while the thread is queued with no agent assigned', async () => {
    const { svc, session, ragAnswer } = build({ status: CONVERSATION_STATUS.WAITING });
    const res = await svc.handleUserMessage(session, 'recommend a cleanser for teens');
    expect(res.reply?.senderType).toBe('ai');
    expect(ragAnswer).toHaveBeenCalled();
  });

  it('stays silent once an agent has taken the queued thread', async () => {
    const { svc, session, ragAnswer } = build({
      status: CONVERSATION_STATUS.WAITING,
      agentId: 42,
    });
    const res = await svc.handleUserMessage(session, 'any update?');
    expect(res.reply).toBeNull();
    expect(ragAnswer).not.toHaveBeenCalled();
  });

  it('stays silent in agent mode', async () => {
    const { svc, session, ragAnswer } = build({ status: CONVERSATION_STATUS.AGENT });
    const res = await svc.handleUserMessage(session, 'any update?');
    expect(res.reply).toBeNull();
    expect(ragAnswer).not.toHaveBeenCalled();
  });

  it('does not re-escalate a queued thread when the answer is unconfident', async () => {
    const { svc, session, busPublish, convUpdate } = build({
      status: CONVERSATION_STATUS.WAITING,
      confidence: 0.2,
    });
    const res = await svc.handleUserMessage(session, 'and for my young son?');
    expect(res.reply).toBeNull(); // no duplicate handoff notice
    expect(res.escalate).toBe(false);
    // No second alert, and the thread is not re-marked waiting.
    expect(busPublish.mock.calls.some((c) => String(c[0]).includes('escalation'))).toBe(false);
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it('does not re-escalate a queued thread when moderation blocks the answer', async () => {
    const { svc, session, convUpdate } = build({
      status: CONVERSATION_STATUS.WAITING,
      decision: MODERATION_DECISION.BLOCKED,
    });
    const res = await svc.handleUserMessage(session, 'something blocked');
    expect(res.reply).toBeNull();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it('searches with the previous customer turns, but asks the model only the new one', async () => {
    const { svc, session, ragAnswer } = build({
      status: CONVERSATION_STATUS.AI_ACTIVE,
      previousUserTurns: ['please recommend me, my skin is oily'],
    });
    await svc.handleUserMessage(session, 'thanks, and recomend my young son.');
    const [, query, , , , retrievalQuery] = ragAnswer.mock.calls[0] as unknown as string[];
    expect(query).toBe('thanks, and recomend my young son.');
    expect(retrievalQuery).toContain('my skin is oily');
    expect(retrievalQuery).toContain('my young son');
  });

  it('falls back to the message alone on the first turn', async () => {
    const { svc, session, ragAnswer } = build({ status: CONVERSATION_STATUS.AI_ACTIVE });
    await svc.handleUserMessage(session, 'hello');
    const [, query, , , , retrievalQuery] = ragAnswer.mock.calls[0] as unknown as string[];
    expect(retrievalQuery).toBe(query);
  });
});

/**
 * The email channel must outlive a follow-up sent while still off hours — the
 * first implementation cleared it on any customer message, which cancelled the
 * delivery the shopper had just been promised (caught in staging).
 */
describe('ChatService — off-hours reply channel', () => {
  function build(routeMode: 'agents' | 'email') {
    const conversation = {
      id: 77,
      tenantId: 1,
      sessionId: 5,
      status: CONVERSATION_STATUS.WAITING,
      agentId: null,
      replyChannel: 'email',
    } as Conversation;
    const session = {
      id: 5,
      sessionToken: 'tok',
      tenantId: 1,
      customerId: 9,
      language: 'KO',
    } as Session;
    const convUpdate = jest.fn();
    const svc = new ChatService(
      {
        findOne: jest.fn(async () => conversation),
        update: convUpdate,
        create: (c: Partial<Conversation>) => c,
        save: jest.fn(),
      } as never,
      {
        save: jest.fn(async (m: Message) => ({ ...m, id: 1 }) as Message),
        create: (m: Partial<Message>) => m,
        update: jest.fn(),
        find: jest.fn(async () => []),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { update: jest.fn() } as never, // Assignment repo (end-chat release; unused here)
      {
        effectiveAgentId: jest.fn(async () => null),
        classifyIntent: jest.fn(async () => ({ intent: 'x', needsOrderData: false, confidence: 0.9 })),
        answer: jest.fn(async () => ({ text: 'ok', confidence: 0.9, citations: [] })),
      } as never,
      { moderate: jest.fn(async () => ({ decision: MODERATION_DECISION.DELIVERED, text: 'ok' })) } as never,
      {} as never,
      { effectiveConsentFor: jest.fn(async () => CONSENT_STATE.GRANTED) } as never,
      { route: jest.fn(async () => ({ mode: routeMode, targetUserIds: [] })), denyMatch: jest.fn(async () => null) } as never,
      { publish: jest.fn() } as never,
      { contactEmail: jest.fn(async () => 'shopper@example.com') } as never,
      { del: jest.fn() } as never,
    );
    return { svc, session, convUpdate };
  }

  it('keeps mailing the thread when the follow-up is still off hours', async () => {
    const { svc, session, convUpdate } = build('email');
    await svc.handleUserMessage(session, 'any update?');
    expect(convUpdate).not.toHaveBeenCalledWith({ id: 77 }, { replyChannel: null });
  });

  it('hands the thread back to the widget once agents are on shift', async () => {
    const { svc, session, convUpdate } = build('agents');
    await svc.handleUserMessage(session, 'any update?');
    expect(convUpdate).toHaveBeenCalledWith({ id: 77 }, { replyChannel: null });
  });
});
