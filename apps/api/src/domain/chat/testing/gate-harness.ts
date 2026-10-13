import { Repository } from 'typeorm';
import { CONSENT_STATE, CONVERSATION_STATUS, MODERATION_DECISION, GATE_AS, GATE_DECISION } from '@sharptalk/types';
import type { GateAs, GateDecisionValue } from '@sharptalk/types';
import { ChatService } from '../chat.service';
import type { ChatTurnResult } from '../chat.service';
import { Conversation } from '../entity/conversation.entity';
import { Message } from '../entity/message.entity';
import { Session } from '../../session/entity/session.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { User } from '../../user/entity/user.entity';
import { RagService } from '../rag.service';
import { ModerationService } from '../../moderation/moderation.service';
import { CONSENT_NOTICE_VERSION, SessionService } from '../../session/session.service';
import { HandoffRouterService } from '../../ai-engine/handoff-router.service';
import { EventBusService } from '../../../infrastructure/infrastructure.module';
import { RedisService } from '../../../infrastructure/cache/redis.service';
import type { GateRag } from '../gate-decision';
import type { GroundingReport } from '../grounding-report.util';

/**
 * Test kit for the gate decision (PLN-261012 SG-51): ONE scripted "world" of retrieval results that
 * feeds BOTH a real `ChatService` (through a `RagService` double) and the simulator's `decideGate`,
 * so a parity spec can assert they reach the same decision. Specs only — excluded from the build
 * (`**\/testing/**`).
 */

/** What one retrieval scope finds in the scripted world. */
export interface Measure {
  /** The confidence figure the scope yields (the strict one for a gate, the answer's for the audience scope). */
  confidence: number;
  degraded?: boolean;
  vectorProvider?: string | null;
  topSimilarity?: number | null;
  categories?: string[];
}

export interface World {
  /** The agent's guest policy. */
  policy: 'open' | 'login_guidance';
  /** Does the tenant have a manager-only category? */
  tiers: boolean;
  /** The guest scope (`guestOnly` + audience): the guest gate's question — and a gated guest's answer. */
  guest: Measure;
  /** The audience scope: what `answer()` is judged on for everyone not gated. */
  audience: Measure;
  /** The manager audience: the role-tier re-check. */
  manager: Measure;
}

export const AGENT_ID = 10;
export const QUESTION = 'Hạn hoàn tất đối soát là khi nào?';

const report = (m: Measure, scopeCategories: string[]): GroundingReport => {
  const categories = m.categories ?? scopeCategories;
  return {
    confidence: m.confidence,
    topSimilarity: m.topSimilarity ?? null,
    categories,
    docIds: categories.map((_, i) => i + 1),
    vectorProvider: m.vectorProvider === undefined ? 'voyage' : m.vectorProvider,
    degraded: m.degraded === true,
    degradedReason: m.degraded ? 'qdrant_error' : null,
    chunks: categories.map((category, i) => ({
      id: i + 1,
      title: `doc ${i + 1}`,
      category,
      group: 'counsel',
      similarity: m.topSimilarity ?? null,
    })),
  };
};

/** Which measurement a retrieval call asks for, from its scope options — the way RagService scopes it. */
function scopeOf(opts?: { guestOnly?: boolean; audience?: string }): 'guest' | 'audience' | 'manager' {
  if (opts?.audience === 'manager') return 'manager';
  return opts?.guestOnly ? 'guest' : 'audience';
}

/** A `RagService` double that answers from the world; the SAME object serves chat and `decideGate`. */
export function makeRag(world: World) {
  const measureFor = (opts?: { guestOnly?: boolean; audience?: string }): Measure => world[scopeOf(opts)];
  const groundingReport = jest.fn(
    async (_t: number, _q: string, _a: unknown, opts?: { guestOnly?: boolean; audience?: string }) =>
      report(measureFor(opts), scopeOf(opts) === 'manager' ? ['settlement'] : ['sign-up']),
  );
  const answer = jest.fn(async (...args: unknown[]) => {
    const opts = args[args.length - 1] as { guestOnly?: boolean; audience?: string } | undefined;
    const m = measureFor(opts);
    return {
      text: 'AI answer',
      confidence: m.confidence,
      citations: [{ id: 1, title: 'doc' }],
      ...(m.degraded ? { vectorDegraded: 'qdrant_error' } : {}),
      grounding: {
        topSimilarity: m.topSimilarity ?? null,
        categories: m.categories ?? ['sign-up'],
        docIds: [1],
        vectorProvider: m.vectorProvider === undefined ? 'voyage' : m.vectorProvider,
        degraded: m.degraded === true,
      },
    };
  });
  const rag = {
    classifyIntent: jest.fn(async () => ({ intent: 'general_inquiry', needsOrderData: false, confidence: 0.9 })),
    answer,
    answerWithoutKnowledge: jest.fn(async () => 'Xin chào!'),
    effectiveAgentId: jest.fn(async () => AGENT_ID),
    agentGuestPolicy: jest.fn(async () => world.policy),
    groundingReport,
    // The bare number, the way a pre-SG-51 double (and the old chat code) asked for it.
    groundingConfidence: jest.fn(async (...a: Parameters<typeof groundingReport>) => (await groundingReport(...a)).confidence),
    hasAudienceTiers: jest.fn(async () => world.tiers),
    guestGuidance: jest.fn(async () => null),
  };
  return rag;
}

export type WorldRag = ReturnType<typeof makeRag>;

export function sessionFor(viewer: GateAs): Session {
  const signed = viewer === GATE_AS.RECEPTIONIST || viewer === GATE_AS.MANAGER;
  return {
    id: 5,
    sessionToken: 'tok-5',
    tenantId: 1,
    aiAgentId: null,
    channel: 'widget',
    customerId: viewer === GATE_AS.GUEST ? null : 100,
    identityLevel: viewer === GATE_AS.GUEST ? 'guest' : 'verified',
    identityClaims: signed
      ? {
          hotelSn: '1721',
          role: viewer,
          hotelName: 'A In Hotel Del Luna',
          hotelCode: 'HCM_001_001721',
          province: 'Hà Nội',
          signed: true,
          verifiedAt: new Date().toISOString(),
        }
      : null,
    language: 'VI',
    consentState: CONSENT_STATE.GRANTED,
    consentAt: new Date(),
    consentVersion: CONSENT_NOTICE_VERSION,
  } as unknown as Session;
}

/** A real ChatService wired to `rag`; everything else is the minimum a text turn needs. */
export function buildChat(rag: WorldRag | RagService, viewer: GateAs) {
  const session = sessionFor(viewer);
  const conversations: Array<Partial<Conversation>> = [];
  let nextConv = 200;
  const convRepo = {
    findOne: jest.fn(async (q: { where?: { sessionId?: number } }) =>
      conversations.find((c) => (q?.where?.sessionId == null || c.sessionId === q.where.sessionId) && c.status !== 'ended') ?? null,
    ),
    save: jest.fn(async (c: Partial<Conversation>) => {
      const row = { id: nextConv++, tenantId: 1, status: CONVERSATION_STATUS.AI_ACTIVE, ...c };
      conversations.push(row);
      return row as Conversation;
    }),
    create: jest.fn((c: Partial<Conversation>) => c),
    update: jest.fn(),
  } as unknown as Repository<Conversation>;
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
  const sessionRepo = {
    findOne: jest.fn(async () => session),
    save: jest.fn(async (s: Session) => s),
  } as unknown as Repository<Session>;
  const tenantRepo = {
    findOne: jest.fn(async () => ({ id: 1, commerceEnabled: 1, privacyPolicyUrl: null, consentNoticeVersion: null, identityPolicy: null }) as unknown as Tenant),
  } as unknown as Repository<Tenant>;
  const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
  const publish = jest.fn();
  const bus = { publish } as unknown as EventBusService;
  const sessionService = new SessionService(sessionRepo, tenantRepo, { findOne: jest.fn(async () => null) } as never, bus, redis);

  const svc = new ChatService(
    convRepo,
    msgRepo,
    sessionRepo,
    tenantRepo,
    { find: jest.fn(async () => []) } as unknown as Repository<User>,
    { update: jest.fn() } as never,
    rag as unknown as RagService,
    { moderate: jest.fn(async () => ({ decision: MODERATION_DECISION.DELIVERED, text: 'AI answer' })) } as unknown as ModerationService,
    { recentForCustomer: jest.fn(async () => []) } as never,
    sessionService,
    {
      route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
      denyMatch: jest.fn(async () => null),
      teamQuestion: jest.fn(async () => null),
      regionLookup: jest.fn(async () => ({ region: null, unmapped: null })),
    } as unknown as HandoffRouterService,
    bus,
    { contactEmail: jest.fn(async () => null) } as never,
    redis,
    {
      lookup: jest.fn(async () => null),
      recordAiAnswer: jest.fn(async () => undefined),
      recordHit: jest.fn(async () => undefined),
      deactivate: jest.fn(async () => undefined),
    } as never,
  );
  const traces = (senderType: string) =>
    saved.filter((m) => m.senderType === senderType).map((m) => m.retrievalTrace as Record<string, unknown>);
  return { svc, session, saved, publish, traces };
}

/**
 * What a chat turn did, in the gate's own words — read ONLY from what a customer (and the stored
 * trace) can observe, never from the decision function, so it is an independent witness.
 */
export function observedDecision(
  result: ChatTurnResult,
  traces: { system: Array<Record<string, unknown>>; ai: Array<Record<string, unknown>> },
): GateDecisionValue {
  const sys = traces.system[0];
  if (result.needsAuth && result.authReason === 'login') return sys.gate as GateDecisionValue;
  if (result.escalate) return (sys.gate as GateDecisionValue | undefined) ?? GATE_DECISION.LOW_CONFIDENCE;
  if (sys?.reason === 'role_manager_only') return GATE_DECISION.ROLE_MANAGER_ONLY;
  return GATE_DECISION.ALLOW;
}

/** The `GateRag` view of a world double — what the simulator hands `decideGate`. */
export const asGateRag = (rag: WorldRag): GateRag => rag as unknown as GateRag;
