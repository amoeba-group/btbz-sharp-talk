import { Repository } from 'typeorm';
import {
  CONSENT_STATE,
  CONVERSATION_STATUS,
  MODERATION_DECISION,
  REFUSAL_REASON,
  isRefusalReason,
} from '@sharptalk/types';
import { ChatService } from './chat.service';
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

/**
 * The chat path and signed identity (PLN-261012 SG-03 / SG-50).
 *
 * Two properties, both decided in `handleUserMessage` / `handoff` / `escalate`:
 *
 *  - SG-03: signed claims past their max age read as a guest AT EVERY DECISION SITE —
 *    the guest gate, the order-auth gate, the partner line in the prompt, the alert's
 *    partner label, region routing and the conversation stamps.
 *  - SG-50: every system / refusal turn the path stores carries `retrieval_trace.reason`
 *    from the closed vocabulary plus the `agentId` that was speaking, and never the
 *    visitor's words.
 */
const HOUR = 3_600_000;
const AGENT_ID = 10;
const QUESTION = 'Hạn hoàn tất đối soát là khi nào? (số điện thoại 0901234567)';

const signedClaims = (ageMs: number, over: Record<string, unknown> = {}) => ({
  hotelSn: '1721',
  role: 'receptionist',
  hotelName: 'A In Hotel Del Luna',
  hotelCode: 'HCM_001_001721',
  province: 'Hà Nội',
  signed: true,
  verifiedAt: new Date(Date.now() - ageMs).toISOString(),
  ...over,
});

interface Opts {
  /** Claims age; undefined = no claims at all (guest, v1 or a platform login). */
  claimsAgeMs?: number;
  identityLevel?: 'guest' | 'verified';
  customerId?: number | null;
  guestPolicy?: 'open' | 'login_guidance';
  grounding?: number;
  policy?: unknown;
  needsOrderData?: boolean;
  confidence?: number;
  blocked?: boolean;
  deny?: { type: string; label: string; mode: string } | null;
  intent?: string;
  consent?: string;
  wantsAgent?: boolean;
  agentId?: number | null;
}

function build(opts: Opts = {}) {
  const claims = opts.claimsAgeMs !== undefined ? signedClaims(opts.claimsAgeMs) : null;
  const session = {
    id: 5,
    sessionToken: 'tok-5',
    tenantId: 1,
    aiAgentId: null,
    channel: 'widget',
    customerId: opts.customerId === undefined ? (claims ? 100 : null) : opts.customerId,
    identityLevel: opts.identityLevel ?? (claims ? 'verified' : 'guest'),
    identityClaims: claims,
    language: 'VI',
    consentState: opts.consent ?? CONSENT_STATE.GRANTED,
    consentAt: new Date(),
    consentVersion: CONSENT_NOTICE_VERSION,
  } as unknown as Session;

  let current: Conversation | null = null;
  const createdConversations: Array<Partial<Conversation>> = [];
  const convRepo = {
    findOne: jest.fn(async () => current),
    save: jest.fn(async (c: Partial<Conversation>) => {
      current = { id: 77, tenantId: 1, status: CONVERSATION_STATUS.AI_ACTIVE, ...c } as Conversation;
      return current;
    }),
    create: jest.fn((c: Partial<Conversation>) => {
      createdConversations.push(c);
      return c;
    }),
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
    findOne: jest.fn(
      async () =>
        ({
          id: 1,
          commerceEnabled: 1,
          privacyPolicyUrl: null,
          consentNoticeVersion: null,
          identityPolicy: opts.policy ?? null,
        }) as unknown as Tenant,
    ),
  } as unknown as Repository<Tenant>;
  const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
  const publish = jest.fn();
  const bus = { publish } as unknown as EventBusService;
  const customerRepo = { findOne: jest.fn(async () => null) };
  const sessionService = new SessionService(sessionRepo, tenantRepo, customerRepo as never, bus, redis);

  const ragAnswer = jest.fn(async () => ({
    text: 'AI answer',
    confidence: opts.confidence ?? 0.9,
    citations: [{ id: 1, title: 'doc' }],
  }));
  const grounding = jest.fn(async () => opts.grounding ?? 0.9);
  const regionLookup = jest.fn(async () => ({ region: null, unmapped: null }));
  const recentForCustomer = jest.fn(async () => []);
  const moderate = jest.fn(async () => ({
    decision: opts.blocked ? MODERATION_DECISION.BLOCKED : MODERATION_DECISION.DELIVERED,
    text: 'AI answer',
  }));

  const svc = new ChatService(
    convRepo,
    msgRepo,
    sessionRepo,
    tenantRepo,
    { find: jest.fn(async () => []) } as unknown as Repository<User>,
    { update: jest.fn() } as never,
    {
      classifyIntent: jest.fn(async () => ({
        intent: opts.wantsAgent ? 'agent_request' : (opts.intent ?? 'general_inquiry'),
        needsOrderData: opts.needsOrderData ?? false,
        confidence: 0.9,
      })),
      answer: ragAnswer,
      answerWithoutKnowledge: jest.fn(async () => 'Xin chào!'),
      effectiveAgentId: jest.fn(async () => (opts.agentId === undefined ? AGENT_ID : opts.agentId)),
      agentGuestPolicy: jest.fn(async () => opts.guestPolicy ?? 'open'),
      groundingConfidence: grounding,
      guestGuidance: jest.fn(async () => null),
    } as unknown as RagService,
    { moderate } as unknown as ModerationService,
    { recentForCustomer } as never,
    sessionService,
    {
      route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
      denyMatch: jest.fn(async () => opts.deny ?? null),
      teamQuestion: jest.fn(async () => null),
      regionLookup,
    } as unknown as HandoffRouterService,
    bus,
  );

  /** The `retrieval_trace` of every system turn that was stored. */
  const systemTraces = () => saved.filter((m) => m.senderType === 'system').map((m) => m.retrievalTrace as Record<string, unknown>);
  /** The options object the answer call received (last argument). */
  const answerOpts = () => {
    const call = ragAnswer.mock.calls[0] as unknown[];
    return call[call.length - 1] as { guestOnly: boolean; partnerContext?: string };
  };
  return {
    svc,
    session,
    saved,
    publish,
    ragAnswer,
    grounding,
    regionLookup,
    recentForCustomer,
    convRepo,
    createdConversations,
    systemTraces,
    answerOpts,
  };
}

describe('SG-03 — lapsed signed claims read as a guest in the chat path', () => {
  it('claims inside the max age: not gated, partner line in the prompt, conversation stamped', async () => {
    const h = build({ claimsAgeMs: 7 * HOUR, guestPolicy: 'login_guidance' });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.needsAuth).toBe(false);
    expect(h.grounding).not.toHaveBeenCalled();
    expect(h.answerOpts().guestOnly).toBe(false);
    expect(h.answerOpts().partnerContext).toContain('hotelSn 1721');
    expect(h.createdConversations[0]).toMatchObject({
      hotelSn: '1721',
      actorRole: 'receptionist',
      aiAgentId: AGENT_ID,
    });
  });

  it('claims past the max age on a login_guidance agent: the guest gate asks them to sign in again', async () => {
    const h = build({ claimsAgeMs: 9 * HOUR, guestPolicy: 'login_guidance', grounding: 0.2 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.needsAuth).toBe(true);
    expect(res.authReason).toBe('login');
    expect(h.ragAnswer).not.toHaveBeenCalled();
    // The gate was measured on the PUBLIC scope only — the session was demoted to a guest.
    expect(h.grounding).toHaveBeenCalledWith(1, expect.any(String), AGENT_ID, { guestOnly: true, audience: 'public' });
  });

  it('…and the refusal is recorded as identity_expired, not as an ordinary guest gate', async () => {
    const h = build({ claimsAgeMs: 9 * HOUR, guestPolicy: 'login_guidance', grounding: 0.2 });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.systemTraces()).toEqual([
      expect.objectContaining({ reason: REFUSAL_REASON.IDENTITY_EXPIRED, agentId: AGENT_ID }),
    ]);
  });

  it('lapsed claims on an OPEN agent: still answered, but the prompt no longer names the hotel', async () => {
    const h = build({ claimsAgeMs: 9 * HOUR, guestPolicy: 'open' });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.needsAuth).toBe(false);
    expect(h.answerOpts().partnerContext).toBeUndefined();
  });

  it('lapsed claims leave the conversation unstamped (a hotel nobody vouches for is not recorded)', async () => {
    const h = build({ claimsAgeMs: 9 * HOUR });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.createdConversations[0]).toMatchObject({ hotelSn: null, actorRole: null, aiAgentId: AGENT_ID });
  });

  describe('the tenant policy sets the limit', () => {
    it('a longer tenant limit keeps 9 h-old claims valid', async () => {
      const h = build({ claimsAgeMs: 9 * HOUR, guestPolicy: 'login_guidance', policy: { maxAgeHours: 12 } });

      const res = await h.svc.handleUserMessage(h.session, QUESTION);

      expect(res.needsAuth).toBe(false);
      expect(h.answerOpts().partnerContext).toContain('1721');
    });

    it('a shorter tenant limit expires 3 h-old claims', async () => {
      const h = build({ claimsAgeMs: 3 * HOUR, guestPolicy: 'login_guidance', grounding: 0.2, policy: { maxAgeHours: 2 } });

      const res = await h.svc.handleUserMessage(h.session, QUESTION);

      expect(res.needsAuth).toBe(true);
    });
  });

  describe('the order-auth gate keys off the identity in force', () => {
    it('signed claims in force: the order question is answered from the customer\'s orders', async () => {
      const h = build({ claimsAgeMs: HOUR, needsOrderData: true });

      const res = await h.svc.handleUserMessage(h.session, 'Where is my order?');

      expect(res.needsAuth).toBe(false);
      expect(h.recentForCustomer).toHaveBeenCalledWith(1, 100, expect.any(Number));
    });

    it('lapsed claims: the customer is no longer treated as signed in — the order gate asks again', async () => {
      const h = build({ claimsAgeMs: 9 * HOUR, needsOrderData: true });

      const res = await h.svc.handleUserMessage(h.session, 'Where is my order?');

      expect(res.needsAuth).toBe(true);
      expect(res.authReason).toBe('order');
      expect(h.recentForCustomer).not.toHaveBeenCalled();
      expect(h.systemTraces()).toEqual([
        expect.objectContaining({ reason: REFUSAL_REASON.IDENTITY_EXPIRED, agentId: AGENT_ID }),
      ]);
    });

    it('a platform login (verified, bound customer, no claims) is never aged — Shopify tenants are untouched', async () => {
      const h = build({ identityLevel: 'verified', customerId: 7, needsOrderData: true });

      const res = await h.svc.handleUserMessage(h.session, 'Where is my order?');

      expect(res.needsAuth).toBe(false);
      expect(h.recentForCustomer).toHaveBeenCalledWith(1, 7, expect.any(Number));
    });
  });

  describe('hand-offs', () => {
    it('claims in force: the alert names the hotel and region lookup gets the claims', async () => {
      const h = build({ claimsAgeMs: HOUR, confidence: 0.1 });

      await h.svc.handleUserMessage(h.session, QUESTION);

      expect(h.publish).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ partnerLabel: 'A In Hotel Del Luna (1721) · receptionist' }),
      );
      expect(h.regionLookup).toHaveBeenCalledWith(1, expect.objectContaining({ hotelSn: '1721' }));
    });

    it('lapsed claims: no partner label on the alert, and the region is not looked up from them', async () => {
      const h = build({ claimsAgeMs: 9 * HOUR, confidence: 0.1 });

      await h.svc.handleUserMessage(h.session, QUESTION);

      const event = h.publish.mock.calls.map(([, e]) => e).find((e) => e?.reason === 'low_confidence');
      expect(event).toBeDefined();
      expect(event.partnerLabel).toBeUndefined();
      expect(h.regionLookup).toHaveBeenCalledWith(1, null);
    });

    it('escalate() (the "talk to an agent" button) follows the same rule', async () => {
      const h = build({ claimsAgeMs: 9 * HOUR });
      // A conversation exists for the button to escalate.
      await h.svc.handleUserMessage(h.session, QUESTION);
      h.publish.mockClear();

      await h.svc.escalate(h.session, 77);

      const event = h.publish.mock.calls.map(([, e]) => e).find((e) => e?.reason === 'user_request');
      expect(event.partnerLabel).toBeUndefined();
      expect(h.regionLookup).toHaveBeenLastCalledWith(1, null);
    });
  });

  it('a v1 identity (verified, no claims) is never aged and never gated', async () => {
    const h = build({ identityLevel: 'verified', customerId: 5, guestPolicy: 'login_guidance' });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.needsAuth).toBe(false);
    expect(h.grounding).not.toHaveBeenCalled();
  });
});

describe('SG-50 — conversation stamps', () => {
  it('a guest conversation is stamped with the effective agent only', async () => {
    const h = build({ agentId: 33 });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.createdConversations[0]).toMatchObject({ hotelSn: null, actorRole: null, aiAgentId: 33 });
  });

  it('a tenant with no AI agent at all stamps null, not undefined and not a crash', async () => {
    const h = build({ agentId: null });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.createdConversations[0]).toMatchObject({ aiAgentId: null });
  });

  it('getOrCreateConversation without a session (older callers) stamps nothing', async () => {
    const h = build({ claimsAgeMs: HOUR });

    await h.svc.getOrCreateConversation(5);

    expect(h.createdConversations[0]).not.toHaveProperty('hotelSn');
    expect(h.createdConversations[0]).not.toHaveProperty('aiAgentId');
  });

  it('an existing open conversation is reused and NOT restamped', async () => {
    const h = build({ claimsAgeMs: HOUR });
    await h.svc.handleUserMessage(h.session, QUESTION);
    h.convRepo.create = jest.fn() as never;

    await h.svc.handleUserMessage(h.session, 'and another question');

    expect(h.convRepo.create).not.toHaveBeenCalled();
  });

  it('conversationStamps() truncates to the column widths', async () => {
    const h = build({ claimsAgeMs: HOUR });
    (h.session.identityClaims as { hotelSn: string }).hotelSn = 'H'.repeat(50);

    const stamps = await h.svc.conversationStamps(h.session);

    expect(stamps.hotelSn).toHaveLength(32);
  });
});

describe('SG-50 — every refusal carries a closed-vocabulary reason and the speaking agent', () => {
  const reasons = (h: ReturnType<typeof build>) => h.systemTraces().map((t) => t.reason);

  it('consent not given: the turn is NOT processed or stored at all (fail-closed), so there is no row to trace', async () => {
    const h = build({ consent: CONSENT_STATE.PENDING });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.reply?.senderType).toBe('system');
    expect(h.saved).toHaveLength(0);
    expect(h.createdConversations).toHaveLength(0);
    expect(h.ragAnswer).not.toHaveBeenCalled();
  });

  it('guest gate → guest_gate, with the measured grounding and the bar, never the question', async () => {
    const h = build({ guestPolicy: 'login_guidance', grounding: 0.2 });

    await h.svc.handleUserMessage(h.session, QUESTION);

    const [trace] = h.systemTraces();
    expect(trace).toMatchObject({ reason: 'guest_gate', agentId: AGENT_ID, grounded: 0.2 });
    expect(typeof trace.threshold).toBe('number');
    expect(JSON.stringify(h.saved.filter((m) => m.senderType === 'system'))).not.toContain('0901234567');
    expect(JSON.stringify(trace)).not.toContain('đối soát');
  });

  it('order-auth gate → auth_gate', async () => {
    const h = build({ needsOrderData: true });

    await h.svc.handleUserMessage(h.session, 'Where is my order?');

    expect(h.systemTraces()).toEqual([expect.objectContaining({ reason: 'auth_gate', agentId: AGENT_ID })]);
  });

  it('moderation block → moderation', async () => {
    const h = build({ blocked: true });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(reasons(h)).toEqual(['moderation']);
    expect(h.systemTraces()[0]).toMatchObject({ agentId: AGENT_ID });
  });

  it('low-confidence hand-off → low_confidence', async () => {
    const h = build({ confidence: 0.1 });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.systemTraces()).toEqual([expect.objectContaining({ reason: 'low_confidence', agentId: AGENT_ID })]);
  });

  it('deny-list policy hand-off → policy_deny', async () => {
    const h = build({ deny: { type: 'refund', label: 'accounting', mode: 'silent' } });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.systemTraces()).toEqual([expect.objectContaining({ reason: 'policy_deny', agentId: AGENT_ID })]);
  });

  it('a typed "get me a person" → user_request (not a refusal, so it keeps its own word)', async () => {
    const h = build({ wantsAgent: true });

    await h.svc.handleUserMessage(h.session, 'connect me to a real person please');

    expect(h.systemTraces()).toEqual([expect.objectContaining({ reason: 'user_request', agentId: AGENT_ID })]);
  });

  it('the "talk to an agent" button → user_request with the agent', async () => {
    const h = build();
    await h.svc.handleUserMessage(h.session, QUESTION);

    await h.svc.escalate(h.session, 77);

    const last = h.systemTraces().pop();
    expect(last).toMatchObject({ reason: 'user_request', agentId: AGENT_ID });
  });

  it('a moderation block on the small-talk path → moderation too', async () => {
    const h = build({ intent: 'smalltalk', blocked: true });

    await h.svc.handleUserMessage(h.session, 'xin chào');

    expect(reasons(h)).toEqual(['moderation']);
  });

  it('the stored reason is ALWAYS a member of the closed vocabulary (or the one non-refusal word)', async () => {
    const scenarios: Opts[] = [
      { guestPolicy: 'login_guidance', grounding: 0.2 },
      { needsOrderData: true },
      { blocked: true },
      { confidence: 0.1 },
      { deny: { type: 'refund', label: 'accounting', mode: 'silent' } },
      { wantsAgent: true },
      { claimsAgeMs: 9 * HOUR, guestPolicy: 'login_guidance', grounding: 0.2 },
    ];
    for (const s of scenarios) {
      const h = build(s);
      await h.svc.handleUserMessage(h.session, QUESTION);
      for (const trace of h.systemTraces()) {
        expect(isRefusalReason(trace.reason) || trace.reason === 'user_request').toBe(true);
        expect(trace).toHaveProperty('agentId');
      }
    }
  });

  it('no trace contains a legacy escalation word any more', async () => {
    const h = build({ blocked: true });
    await h.svc.handleUserMessage(h.session, QUESTION);
    const h2 = build({ deny: { type: 'refund', label: 'accounting', mode: 'silent' } });
    await h2.svc.handleUserMessage(h2.session, QUESTION);

    expect(JSON.stringify([...h.systemTraces(), ...h2.systemTraces()])).not.toMatch(/moderation_blocked|"policy"/);
  });

  it('the alert event keeps the escalation word the channels and the console key on', async () => {
    const h = build({ blocked: true });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'moderation_blocked' }));
  });
});
