import { Repository } from 'typeorm';
import { CONSENT_STATE, CONVERSATION_STATUS, MODERATION_DECISION } from '@sharptalk/types';
import { ChatService, sysMsg } from './chat.service';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { RagService } from './rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { CONSENT_NOTICE_VERSION, SessionService } from '../session/session.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import { EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { m, metrics } from '../../infrastructure/observability/app-metrics';

/**
 * PLN-261012 SG-84 — an outage must not read as "no confident answer".
 *
 * Before: when the engine failed (or its breaker was open) the customer was told "I couldn't find
 * a confident answer in our help content" — a statement about the knowledge base, made because
 * the INFRASTRUCTURE failed. The handoff still has to happen; only the words and the recorded
 * reason change.
 */
describe('ChatService — engine outage copy', () => {
  const session = {
    id: 5,
    sessionToken: 'tok-5',
    tenantId: 1,
    customerId: null,
    identityLevel: 'guest',
    language: 'VI',
    consentState: CONSENT_STATE.GRANTED,
    consentAt: null,
    consentVersion: CONSENT_NOTICE_VERSION,
    identityClaims: null,
  } as unknown as Session;

  type Overrides = {
    answer?: Record<string, unknown>;
    moderation?: Record<string, unknown>;
    intent?: Record<string, unknown>;
    drafted?: string;
    /** What the knowledge base says about the question (the out-of-scope override reads it). */
    grounding?: number;
  };

  const build = (o: Overrides = {}) => {
    const conversation = { id: 77, sessionId: 5, tenantId: 1, status: CONVERSATION_STATUS.AI_ACTIVE } as Conversation;
    let nextId = 100;
    const saved: Array<Record<string, unknown>> = [];
    const msgRepo = {
      save: jest.fn(async (msg: Record<string, unknown>) => {
        saved.push(msg);
        return { ...msg, id: nextId++ };
      }),
      create: (x: Partial<Message>) => x,
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
    const sessionRepo = { findOne: jest.fn(async () => session), save: jest.fn(async (s: Session) => s) } as unknown as Repository<Session>;
    const tenantRepo = {
      findOne: jest.fn(async () => ({ id: 1, privacyPolicyUrl: null, consentNoticeVersion: null }) as Tenant),
    } as unknown as Repository<Tenant>;
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const publish = jest.fn();
    const bus = { publish } as unknown as EventBusService;
    const rag = {
      classifyIntent: jest.fn(async () => ({ intent: 'other', needsOrderData: false, confidence: 0.8, ...o.intent })),
      answer: jest.fn(async () => ({ text: 'AI answer', confidence: 0.9, citations: [], ...o.answer })),
      answerWithoutKnowledge: jest.fn(async () => o.drafted ?? 'hi there'),
      effectiveAgentId: jest.fn(async () => 10),
      agentGuestPolicy: jest.fn(async () => 'open'),
      groundingConfidence: jest.fn(async () => o.grounding ?? 0.9),
      guestGuidance: jest.fn(async () => null),
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
        moderate: jest.fn(async () => ({ decision: MODERATION_DECISION.DELIVERED, text: 'AI answer', ...o.moderation })),
      } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      new SessionService(sessionRepo, tenantRepo, bus, redis),
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () => null),
        teamQuestion: jest.fn(async () => null),
        regionLookup: jest.fn(async () => ({ region: null })),
      } as unknown as HandoffRouterService,
      bus,
    );
    const escalation = () => publish.mock.calls.find(([key]) => key === 'escalation.requested')?.[1];
    return { svc, saved, escalation, rag };
  };

  const OUTAGE = sysMsg('engineUnavailable', 'VI');
  const NO_ANSWER = sysMsg('handoff', 'VI');
  const ask = (svc: ChatService) => svc.handleUserMessage(session, 'Hạn hoàn tất đối soát là khi nào?');

  beforeEach(() => metrics.reset());

  it('the engine failed and the stub text was withheld → the OUTAGE notice, and still a handoff', async () => {
    const h = build({ answer: { text: '', confidence: 0, engineDegraded: true } });

    const res = await ask(h.svc);

    expect(res.escalate).toBe(true);
    expect(res.reply).toEqual({ senderType: 'system', body: OUTAGE });
    expect(res.reply?.body).not.toBe(NO_ANSWER);
    expect(h.escalation()).toMatchObject({ reason: 'engine_unavailable', conversationId: 77 });
    // The trace the console shows for the system turn carries the real reason.
    expect(h.saved.some((x) => x.senderType === 'system' && (x.retrievalTrace as { reason?: string })?.reason === 'engine_unavailable')).toBe(true);
  });

  it('knowledge merely missing → the ordinary "no confident answer" notice (unchanged)', async () => {
    const h = build({ answer: { text: 'unsure', confidence: 0.2 } });

    const res = await ask(h.svc);

    expect(res.escalate).toBe(true);
    expect(res.reply?.body).toBe(NO_ANSWER);
    expect(h.escalation()).toMatchObject({ reason: 'low_confidence' });
  });

  it('the moderation path itself failing (fail-safe block) is an outage too', async () => {
    const h = build({ moderation: { decision: MODERATION_DECISION.BLOCKED, text: '', failsafe: 'engine_degraded' } });

    const res = await ask(h.svc);

    expect(res.reply?.body).toBe(OUTAGE);
    expect(h.escalation()).toMatchObject({ reason: 'engine_unavailable' });
  });

  it('a REAL moderation block (a rule fired) keeps its own reason and notice', async () => {
    const h = build({ moderation: { decision: MODERATION_DECISION.BLOCKED, text: '' } });

    const res = await ask(h.svc);

    expect(res.reply?.body).toBe(NO_ANSWER);
    expect(h.escalation()).toMatchObject({ reason: 'moderation_blocked' });
  });

  it('a small-talk reply the engine could not write is an outage, not missing knowledge', async () => {
    const h = build({ intent: { intent: 'smalltalk' }, drafted: '' });

    const res = await h.svc.handleUserMessage(session, 'xin chào');

    expect(res.escalate).toBe(true);
    expect(res.reply?.body).toBe(OUTAGE);
    expect(h.escalation()).toMatchObject({ reason: 'engine_unavailable' });
  });

  it('a delivered keyword-only answer records the degraded vector leg in the retrieval trace', async () => {
    const h = build({ answer: { text: 'Đáp án', confidence: 0.55, vectorDegraded: 'qdrant_error' } });

    const res = await ask(h.svc);

    expect(res.escalate).toBe(false);
    const aiTurn = h.saved.find((x) => x.senderType === 'ai');
    expect(aiTurn?.retrievalTrace).toMatchObject({ vectorProvider: 'degraded', vectorDegraded: 'qdrant_error', confidence: 0.55 });
  });

  it('a healthy answer carries no degradation marker in its trace', async () => {
    const h = build();

    await ask(h.svc);

    expect(h.saved.find((x) => x.senderType === 'ai')?.retrievalTrace).not.toHaveProperty('vectorDegraded');
  });

  it('counts the turn by outcome (handoff vs answered)', async () => {
    await ask(build({ answer: { text: '', confidence: 0, engineDegraded: true } }).svc);
    await ask(build().svc);

    expect(m.chatTurns.get({ outcome: 'handoff' })).toBe(1);
    expect(m.chatTurns.get({ outcome: 'answered' })).toBe(1);
  });

  it('counts an out-of-scope polite reply as "refused", not as an answer', async () => {
    await build({ intent: { intent: 'out_of_scope', confidence: 0.9 }, drafted: 'That is outside what I can help with.', grounding: 0.1 }).svc.handleUserMessage(
      session,
      'thời tiết hôm nay thế nào?',
    );

    expect(m.chatTurns.get({ outcome: 'refused' })).toBe(1);
    expect(m.chatTurns.get({ outcome: 'answered' })).toBe(0);
  });

  describe('copy', () => {
    it.each(['EN', 'ES', 'KO', 'VI', 'JA', 'ZH'])('%s has a distinct outage notice, different from the missing-knowledge one', (lang) => {
      const outage = sysMsg('engineUnavailable', lang);
      expect(outage.length).toBeGreaterThan(20);
      expect(outage).not.toBe(sysMsg('handoff', lang));
    });

    it('promises a person and a follow-up, never an answer or a missing-knowledge claim', () => {
      expect(sysMsg('engineUnavailable', 'EN')).toMatch(/temporarily unavailable/i);
      expect(sysMsg('engineUnavailable', 'EN')).toMatch(/person will help/i);
      expect(sysMsg('engineUnavailable', 'EN')).not.toMatch(/confident answer|help content/i);
      expect(sysMsg('engineUnavailable', 'VI')).toMatch(/tạm thời/);
    });
  });
});
