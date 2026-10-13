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
import { AnswerReuseService } from '../answer-reuse/answer-reuse.service';

/**
 * Per-turn latency in the persisted trace (PLN-261012 SG-53, NFR-001).
 *
 * Every AI turn's `retrieval_trace` now carries `latencyMs: { total, classify,
 * retrieve, generate, moderate }` as plain numbers, so the observability stream
 * can read P50/P95 from the rows. The stage that did not run is `null` — a
 * replayed answer has no search or generation, and "0" would read as instant.
 */
describe('ChatService — per-turn latency in the AI turn trace (SG-53)', () => {
  const build = (opts: { reuseHit?: boolean; intent?: string; timings?: boolean } = {}) => {
    const conversation = { id: 7, sessionId: 1, tenantId: 5, status: CONVERSATION_STATUS.AI_ACTIVE } as Conversation;
    const session = {
      id: 1,
      sessionToken: 'tok',
      tenantId: 5,
      customerId: null,
      identityLevel: 'guest',
      language: 'VI',
      consentState: CONSENT_STATE.GRANTED,
      consentAt: new Date(),
      consentVersion: CONSENT_NOTICE_VERSION,
    } as Session;

    const saved: Array<Partial<Message>> = [];
    let nextId = 100;
    const msgRepo = {
      save: jest.fn(async (m: Partial<Message>) => {
        const row = { ...m, id: String(nextId++) };
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
      findOne: jest.fn(async () => ({ id: 5, privacyPolicyUrl: null, consentNoticeVersion: null }) as Tenant),
    } as unknown as Repository<Tenant>;
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const bus = { publish: jest.fn() } as unknown as EventBusService;

    const rag = {
      classifyIntent: jest.fn(async () => ({ intent: opts.intent ?? 'other', needsOrderData: false, confidence: 0.9 })),
      answerWithoutKnowledge: jest.fn(async () => 'Xin chào! Mình giúp gì được cho bạn?'),
      answer: jest.fn(async () => ({
        text: 'Hoa hồng hiện tại là 15%.',
        confidence: 0.9,
        citations: [{ id: 1 }],
        ...(opts.timings === false ? {} : { timings: { retrieveMs: 120, generateMs: 940 } }),
      })),
      groundingConfidence: jest.fn(async () => 0.2),
      footerConfig: jest.fn(async () => null),
      effectiveAgentId: jest.fn(async () => null),
      agentGuestPolicy: jest.fn(async () => 'open'),
    };
    const moderation = {
      moderate: jest.fn(async (p: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text: p.text })),
    } as unknown as ModerationService;
    const answerReuse = {
      lookup: jest.fn(async () =>
        opts.reuseHit ? { reuseId: 9, text: 'Hoa hồng là 15%', confidence: 0.9, citations: [] } : null,
      ),
      recordAiAnswer: jest.fn(),
      recordHit: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as AnswerReuseService;

    const svc = new ChatService(
      convRepo,
      msgRepo,
      sessionRepo,
      tenantRepo,
      { find: jest.fn(async () => []) } as unknown as Repository<User>,
      { update: jest.fn() } as never,
      rag as unknown as RagService,
      moderation,
      { recentForCustomer: jest.fn(async () => []) } as never,
      new SessionService(sessionRepo, tenantRepo, bus, redis),
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () => null),
        teamQuestion: jest.fn(async () => null),
      } as unknown as HandoffRouterService,
      bus,
      {} as never,
      redis,
      answerReuse,
    );
    const aiTrace = () =>
      (saved.filter((m) => m.senderType === 'ai').pop()?.retrievalTrace ?? null) as {
        latencyMs?: Record<string, number | null>;
        citations?: unknown;
      } | null;
    return { svc, session, aiTrace };
  };

  it('records total and every stage on a knowledge answer, taking search/generation from RAG', async () => {
    const h = build();
    await h.svc.handleUserMessage(h.session, 'Hoa hồng bao nhiêu?');
    const l = h.aiTrace()?.latencyMs;
    expect(l).toBeDefined();
    expect(l?.retrieve).toBe(120);
    expect(l?.generate).toBe(940);
    for (const k of ['total', 'classify', 'moderate']) {
      expect(typeof l?.[k]).toBe('number');
      expect(l?.[k]).toBeGreaterThanOrEqual(0);
    }
    // Total is wall clock for the whole turn, so it is at least the measured stages that ran in-process.
    expect(l?.total as number).toBeGreaterThanOrEqual(l?.classify as number);
    // The existing trace fields are untouched.
    expect(h.aiTrace()?.citations).toEqual([{ id: 1 }]);
  });

  it('a replayed answer has no search or generation: those are null, not 0', async () => {
    const h = build({ reuseHit: true });
    await h.svc.handleUserMessage(h.session, 'Hoa hồng bao nhiêu?');
    const l = h.aiTrace()?.latencyMs;
    expect(l?.retrieve).toBeNull();
    expect(l?.generate).toBeNull();
    expect(typeof l?.moderate).toBe('number');
  });

  it('an answer without timings (an older RagService double) still persists, with nulls', async () => {
    const h = build({ timings: false });
    await h.svc.handleUserMessage(h.session, 'Hoa hồng bao nhiêu?');
    expect(h.aiTrace()?.latencyMs).toMatchObject({ retrieve: null, generate: null });
  });

  it('the no-knowledge (small talk) reply records classify, generate and moderate', async () => {
    const h = build({ intent: 'smalltalk' });
    await h.svc.handleUserMessage(h.session, 'Xin chào bạn');
    const l = h.aiTrace()?.latencyMs;
    expect(l?.retrieve).toBeNull();
    for (const k of ['total', 'classify', 'generate', 'moderate']) expect(typeof l?.[k]).toBe('number');
  });
});
