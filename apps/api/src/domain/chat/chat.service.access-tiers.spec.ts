import { Repository } from 'typeorm';
import {
  CONSENT_STATE,
  CONVERSATION_STATUS,
  MODERATION_DECISION,
  REFUSAL_REASON,
} from '@sharptalk/types';
import { ChatService } from './chat.service';
import { ChatMapper } from './chat.mapper';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { RagService } from './rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { CONSENT_NOTICE_VERSION, SessionService } from '../session/session.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import { EVENTS, EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';

/**
 * Role-tiered knowledge access on the chat path (PLN-261012 SG-10 / SG-11 / SG-06).
 *
 *  - SG-10  every retrieval of a turn carries `audienceOf(effectiveIdentity)`; a receptionist who
 *           asks a manager-only topic is pointed to the manager account instead of being handed to
 *           CS, with the closed-vocabulary reason, the "Talk to an agent" chip and no page.
 *  - SG-06  the reuse store is read with the viewer's rank and written with the generating rank.
 *  - SG-11  a thread never feeds the model turns held at a higher tier than the viewer's now.
 */
const HOUR = 3_600_000;
const AGENT_ID = 10;
const QUESTION = 'Hạn hoàn tất đối soát là khi nào?';

type Viewer = 'guest' | 'v1' | 'receptionist' | 'manager' | 'internal';

interface Cfg {
  viewer?: Viewer;
  /** Age of the signed claims; default fresh. */
  claimsAgeMs?: number;
  tiers?: boolean;
  guestPolicy?: 'open' | 'login_guidance';
  /** Confidence of the audience-scoped answer. */
  confidence?: number;
  /** Grounding by the audience that was asked about: the manager re-check and the gate. */
  groundingManager?: number;
  groundingGate?: number;
  intent?: string;
  engineDegraded?: boolean;
  deny?: { type: string; label: string; mode: string } | null;
  reused?: { reuseId: number; text: string; confidence: number; citations: unknown[] } | null;
  managerNotice?: Record<string, string>;
  /** The open conversation the session already has (stamp + earlier turns). */
  existing?: { id: number; actorRole: string | null; turns?: Array<{ senderType: string; body: string }> };
  language?: string;
}

function build(cfg: Cfg = {}) {
  const viewer = cfg.viewer ?? 'receptionist';
  const signed = viewer === 'receptionist' || viewer === 'manager' || viewer === 'internal';
  const claims = signed
    ? {
        hotelSn: '1721',
        role: viewer,
        hotelName: 'A In Hotel Del Luna',
        hotelCode: 'HCM_001_001721',
        province: 'Hà Nội',
        signed: true,
        verifiedAt: new Date(Date.now() - (cfg.claimsAgeMs ?? 0)).toISOString(),
      }
    : null;
  const session = {
    id: 5,
    sessionToken: 'tok-5',
    tenantId: 1,
    aiAgentId: null,
    channel: 'widget',
    customerId: viewer === 'guest' ? null : 100,
    identityLevel: viewer === 'guest' ? 'guest' : 'verified',
    identityClaims: claims,
    language: cfg.language ?? 'VI',
    consentState: CONSENT_STATE.GRANTED,
    consentAt: new Date(),
    consentVersion: CONSENT_NOTICE_VERSION,
  } as unknown as Session;

  const conversations: Array<Partial<Conversation>> = [];
  if (cfg.existing) {
    conversations.push({
      id: cfg.existing.id,
      sessionId: 5,
      tenantId: 1,
      status: CONVERSATION_STATUS.AI_ACTIVE,
      actorRole: cfg.existing.actorRole,
    });
  }
  let nextConv = 200; // distinct from the seeded conversation (77)
  const convRepo = {
    findOne: jest.fn(async (q: { where?: { sessionId?: number; id?: number } }) =>
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
  const earlier: Array<Partial<Message>> = (cfg.existing?.turns ?? []).map((t, i) => ({
    id: 10 + i,
    conversationId: cfg.existing!.id,
    senderType: t.senderType,
    body: t.body,
  }));
  let nextId = 100;
  const historyReads: number[] = [];
  const msgRepo = {
    save: jest.fn(async (m: Partial<Message>) => {
      const row = { ...m, id: nextId++ };
      saved.push(row);
      return row;
    }),
    create: (m: Partial<Message>) => m,
    update: jest.fn(),
    // History is read by conversation id only, newest first — what conversationHistory asks for.
    find: jest.fn(async (q: { where?: { conversationId?: number; senderType?: unknown } }) => {
      const id = q?.where?.conversationId;
      if (q?.where?.senderType && id != null) {
        historyReads.push(Number(id));
        return earlier.filter((m) => m.conversationId === id).sort((a, b) => Number(b.id) - Number(a.id));
      }
      return [];
    }),
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

  const ragAnswer = jest.fn(async () => ({
    text: 'AI answer',
    confidence: cfg.confidence ?? 0.9,
    citations: [{ id: 1, title: 'doc' }],
    ...(cfg.engineDegraded ? { engineDegraded: true } : {}),
  }));
  // The gate asks with guestOnly (public scope); the manager re-check asks with the manager audience.
  const grounding = jest.fn(async (_t: number, _q: string, _a: unknown, opts?: { audience?: string; guestOnly?: boolean }) => {
    if (opts?.audience === 'manager') return cfg.groundingManager ?? 0.8;
    return cfg.groundingGate ?? 0.9;
  });
  const hasAudienceTiers = jest.fn(async () => cfg.tiers ?? true);
  const reuse = {
    lookup: jest.fn(async () => cfg.reused ?? null),
    recordAiAnswer: jest.fn(async () => undefined),
    recordHit: jest.fn(async () => undefined),
    deactivate: jest.fn(async () => undefined),
  };

  const svc = new ChatService(
    convRepo,
    msgRepo,
    sessionRepo,
    tenantRepo,
    { find: jest.fn(async () => []) } as unknown as Repository<User>,
    { update: jest.fn() } as never,
    {
      classifyIntent: jest.fn(async () => ({ intent: cfg.intent ?? 'general_inquiry', needsOrderData: false, confidence: 0.9 })),
      answer: ragAnswer,
      answerWithoutKnowledge: jest.fn(async () => 'Xin chào!'),
      effectiveAgentId: jest.fn(async () => AGENT_ID),
      agentGuestPolicy: jest.fn(async () => cfg.guestPolicy ?? 'open'),
      groundingConfidence: grounding,
      hasAudienceTiers,
      guestGuidance: jest.fn(async () => (cfg.managerNotice ? { managerNotice: cfg.managerNotice } : null)),
    } as unknown as RagService,
    { moderate: jest.fn(async () => ({ decision: MODERATION_DECISION.DELIVERED, text: 'AI answer' })) } as unknown as ModerationService,
    { recentForCustomer: jest.fn(async () => []) } as never,
    sessionService,
    {
      route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
      denyMatch: jest.fn(async () => cfg.deny ?? null),
      teamQuestion: jest.fn(async () => null),
      regionLookup: jest.fn(async () => ({ region: null, unmapped: null })),
    } as unknown as HandoffRouterService,
    bus,
    { contactEmail: jest.fn(async () => null) } as never, // customerService
    redis,
    reuse as never, // answerReuse
  );

  const answerOpts = (n = 0) => {
    const call = ragAnswer.mock.calls[n] as unknown[];
    return call[call.length - 1] as { guestOnly: boolean; audience?: string };
  };
  const answerHistory = () => (ragAnswer.mock.calls[0] as unknown[])[8] as Array<{ role: string; content: string }>;
  const systemTraces = () => saved.filter((m) => m.senderType === 'system').map((m) => m.retrievalTrace as Record<string, unknown>);
  const escalations = () => publish.mock.calls.filter(([event]) => event === EVENTS.ESCALATION);
  return { svc, session, saved, convRepo, ragAnswer, grounding, hasAudienceTiers, reuse, answerOpts, answerHistory, systemTraces, escalations, conversations, historyReads, msgRepo };
}

describe('SG-10 — every retrieval of a turn carries the audience', () => {
  it.each([
    ['guest of an open agent', { viewer: 'guest' as const }, 'public'],
    ['v1-verified (no claims) — fail closed to partner', { viewer: 'v1' as const }, 'partner'],
    ['receptionist', { viewer: 'receptionist' as const }, 'partner'],
    ['manager', { viewer: 'manager' as const }, 'manager'],
    ['internal', { viewer: 'internal' as const }, 'manager'],
    ['manager whose claims LAPSED (8 h limit) reads as a guest', { viewer: 'manager' as const, claimsAgeMs: 9 * HOUR }, 'public'],
  ])('%s → answer() is told audience %s', async (_name, cfg, expected) => {
    const h = build(cfg);

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.answerOpts().audience).toBe(expected);
  });

  it('a guest of an OPEN agent is still scoped by audience (no guest gate involved)', async () => {
    const h = build({ viewer: 'guest', guestPolicy: 'open' });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.answerOpts()).toMatchObject({ guestOnly: false, audience: 'public' });
    expect(h.grounding).not.toHaveBeenCalled();
  });

  it('the gated path measures grounding on the guest scope AND the audience', async () => {
    const h = build({ viewer: 'guest', guestPolicy: 'login_guidance', groundingGate: 0.2 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.needsAuth).toBe(true);
    expect(h.grounding).toHaveBeenCalledWith(1, expect.any(String), AGENT_ID, { guestOnly: true, audience: 'public' });
  });

  it('a follow-up turn (earlier turns folded into the retrieval query) is scoped the same way', async () => {
    const h = build({
      viewer: 'receptionist',
      existing: {
        id: 77,
        actorRole: 'receptionist',
        turns: [
          { senderType: 'user', body: 'Làm sao nhận phòng cho khách?' },
          { senderType: 'ai', body: 'Bạn mở mục Đặt phòng rồi chọn Nhận phòng.' },
        ],
      },
    });

    await h.svc.handleUserMessage(h.session, 'còn trả phòng thì sao?');

    // rag.answer() runs BOTH searches of the follow-up on these opts (see rag-audience-scope.spec).
    expect(h.answerHistory()).toHaveLength(2);
    expect(h.answerOpts().audience).toBe('partner');
  });

  it('an out_of_scope label is second-guessed with the SAME audience', async () => {
    const h = build({ viewer: 'receptionist', intent: 'out_of_scope', groundingGate: 0.9 });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.grounding).toHaveBeenCalledWith(1, expect.any(String), AGENT_ID, { audience: 'partner' });
  });
});

describe('SG-10 — a receptionist asking a manager-only topic', () => {
  const asked = (cfg: Cfg = {}) => build({ viewer: 'receptionist', confidence: 0.2, ...cfg });

  it('is pointed to the manager account, with the "Talk to an agent" chip, and CS is NOT paged', async () => {
    const h = asked({ groundingManager: 0.8 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.escalate).toBe(false);
    expect(res.needsAuth).toBe(false);
    expect(res.reply?.senderType).toBe('system');
    expect(res.reply?.body).toContain('Quản lý');
    expect(res.followUps).toEqual([{ id: 'agent_connect', label: 'Gặp nhân viên hỗ trợ' }]);
    expect(h.escalations()).toHaveLength(0);
    // Nobody is paged and the thread is not flipped to WAITING.
    expect(h.convRepo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: CONVERSATION_STATUS.WAITING }));
  });

  it('records the closed-vocabulary reason, the role and what was required — never the question', async () => {
    const h = asked({ groundingManager: 0.8 });

    await h.svc.handleUserMessage(h.session, QUESTION);

    const [trace] = h.systemTraces();
    expect(trace).toMatchObject({
      reason: REFUSAL_REASON.ROLE_MANAGER_ONLY,
      agentId: AGENT_ID,
      actorRole: 'receptionist',
      requiredRole: 'manager',
    });
    expect(JSON.stringify(trace)).not.toContain('đối soát');
    // The chip survives the poll and a reload: it rides on the trace like the team question's.
    expect(trace.followUps).toEqual([{ id: 'agent_connect', label: 'Gặp nhân viên hỗ trợ' }]);
  });

  it('the chip survives the widget poll: the stored turn maps back to the same follow-up', async () => {
    const h = asked({ groundingManager: 0.8 });

    await h.svc.handleUserMessage(h.session, QUESTION);

    const stored = h.saved.find((m) => m.senderType === 'system')!;
    const wire = ChatMapper.toMessageResponse({ ...stored, createdAt: new Date() } as Message);
    expect(wire.quickReplies).toEqual([{ id: 'agent_connect', label: 'Gặp nhân viên hỗ trợ' }]);
    expect(wire.body).toContain('Quản lý');
  });

  it('asks the SECOND grounding question with the manager audience, on the same agent', async () => {
    const h = asked({ groundingManager: 0.8 });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.grounding).toHaveBeenCalledTimes(1);
    expect(h.grounding).toHaveBeenCalledWith(1, expect.any(String), AGENT_ID, { audience: 'manager' });
  });

  it('shows the content to nobody: the reply is the fixed line, not the model text', async () => {
    const h = asked({ groundingManager: 0.8 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.reply?.body).not.toContain('AI answer');
  });

  it.each([
    ['EN', "manager account"],
    ['ES', 'cuenta de gerente'],
    ['KO', '매니저 계정'],
    ['VI', 'tài khoản Quản lý'],
    ['JA', 'マネージャーアカウント'],
    ['ZH', '经理账户'],
  ])('speaks %s', async (language, fragment) => {
    const h = asked({ groundingManager: 0.8, language });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.reply?.body).toContain(fragment);
  });

  it('uses the tenant wording for the session language when it set one', async () => {
    const h = asked({ groundingManager: 0.8, managerNotice: { VI: 'Vui lòng hỏi tài khoản Quản lý của khách sạn.' } });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.reply?.body).toBe('Vui lòng hỏi tài khoản Quản lý của khách sạn.');
  });

  it('falls back to the built-in line for a language the tenant did not reword', async () => {
    const h = asked({ groundingManager: 0.8, managerNotice: { EN: 'Ask your manager.' } });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.reply?.body).toContain('tài khoản Quản lý');
  });

  it('does not apply when the manager audience would not ground it either: the usual handoff', async () => {
    const h = asked({ groundingManager: 0.2 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.escalate).toBe(true);
    expect(h.systemTraces()[0]).toMatchObject({ reason: REFUSAL_REASON.LOW_CONFIDENCE });
    expect(h.escalations()).toHaveLength(1);
  });

  it('does not apply for a tenant with no manager-only category: no second embed, the usual handoff', async () => {
    const h = asked({ tiers: false, groundingManager: 0.9 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.escalate).toBe(true);
    expect(h.grounding).not.toHaveBeenCalled();
  });

  it.each(['manager', 'internal'] as const)('a %s is never told to ask a manager (they can read it)', async (viewer) => {
    const h = build({ viewer, confidence: 0.2, groundingManager: 0.9 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.escalate).toBe(true);
    expect(h.grounding).not.toHaveBeenCalled();
  });

  it('a guest is handed off as before (they are told to sign in by the gate, not to ask a manager)', async () => {
    const h = build({ viewer: 'guest', confidence: 0.2, groundingManager: 0.9 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.escalate).toBe(true);
    expect(h.grounding).not.toHaveBeenCalled();
  });

  it('is not tried for an engine outage — an outage is not a missing permission', async () => {
    const h = asked({ engineDegraded: true, groundingManager: 0.9 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.escalate).toBe(true);
    expect(h.grounding).not.toHaveBeenCalled();
  });

  it('is not tried when an answer-first deny rule already requires the page', async () => {
    const h = asked({ groundingManager: 0.9, deny: { type: 'accounting', label: 'Accounting', mode: 'answer_then_handoff' } });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.grounding).not.toHaveBeenCalled();
    expect(h.escalations()).toHaveLength(1);
  });

  it('adds nothing on a confident answer: one retrieval, no re-check', async () => {
    const h = build({ viewer: 'receptionist', confidence: 0.9 });

    const res = await h.svc.handleUserMessage(h.session, QUESTION);

    expect(res.reply?.senderType).toBe('ai');
    expect(h.grounding).not.toHaveBeenCalled();
    expect(h.hasAudienceTiers).not.toHaveBeenCalled();
  });
});

describe('SG-06 — the reuse store, read and written by audience', () => {
  it.each([
    ['guest', { viewer: 'guest' as const }, 0],
    ['v1-verified', { viewer: 'v1' as const }, 1],
    ['receptionist', { viewer: 'receptionist' as const }, 1],
    ['manager', { viewer: 'manager' as const }, 2],
  ])('a %s turn looks the store up with viewer rank %s', async (_n, cfg, rank) => {
    const h = build(cfg);

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.reuse.lookup).toHaveBeenCalledWith(1, 'VI', expect.any(String), AGENT_ID, rank);
  });

  it.each([
    ['guest', { viewer: 'guest' as const }, 0],
    ['receptionist', { viewer: 'receptionist' as const }, 1],
    ['manager', { viewer: 'manager' as const }, 2],
  ])('a freshly generated %s answer is stored with rank %s', async (_n, cfg, rank) => {
    const h = build(cfg);

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.reuse.recordAiAnswer).toHaveBeenCalledTimes(1);
    expect(h.reuse.recordAiAnswer).toHaveBeenCalledWith(expect.objectContaining({ audienceRank: rank }));
  });

  it('an expired manager is stored as a guest (what they could read when it was generated)', async () => {
    const h = build({ viewer: 'manager', claimsAgeMs: 9 * HOUR });

    await h.svc.handleUserMessage(h.session, QUESTION);

    expect(h.reuse.recordAiAnswer).toHaveBeenCalledWith(expect.objectContaining({ audienceRank: 0 }));
  });
});

describe('SG-11 — a role change never lets one role’s history reach another', () => {
  const manager = [
    { senderType: 'user', body: 'Hạn đối soát?' },
    { senderType: 'ai', body: 'Đối soát hoàn tất vào ngày 5 hằng tháng, tiền về tài khoản ngân hàng đã đăng ký.' },
  ];

  it('a receptionist on a NEW session (the fork) starts a new conversation and the model sees no earlier turns', async () => {
    // The manager's thread (conversation 77) belongs to session 5. After the identify fork the
    // receptionist is session 6: its own, empty conversation. History is read per conversation id.
    const h = build({ viewer: 'receptionist', existing: { id: 77, actorRole: 'manager', turns: manager } });
    const receptionist = { ...h.session, id: 6, sessionToken: 'tok-6' } as Session;

    await h.svc.handleUserMessage(receptionist, 'Làm sao đổi tài khoản ngân hàng?');

    expect(h.conversations).toHaveLength(2);
    expect(h.conversations[1]).toMatchObject({ sessionId: 6, actorRole: 'receptionist' });
    expect(h.historyReads).not.toContain(77);
    expect(h.answerHistory()).toEqual([]);
  });

  it('claims that lapse mid-conversation: the guest does not inherit the manager’s turns', async () => {
    const h = build({ viewer: 'manager', claimsAgeMs: 9 * HOUR, existing: { id: 77, actorRole: 'manager', turns: manager } });

    await h.svc.handleUserMessage(h.session, 'Còn tiền hoa hồng thì sao?');

    expect(h.answerOpts().audience).toBe('public');
    expect(h.answerHistory()).toEqual([]);
  });

  it('a receptionist inheriting a thread opened by a manager gets no history either', async () => {
    const h = build({ viewer: 'receptionist', existing: { id: 77, actorRole: 'manager', turns: manager } });

    await h.svc.handleUserMessage(h.session, 'Còn tiền hoa hồng thì sao?');

    expect(h.answerHistory()).toEqual([]);
  });

  it('the same role keeps its history (the guard is not a blanket)', async () => {
    const h = build({ viewer: 'manager', existing: { id: 77, actorRole: 'manager', turns: manager } });

    await h.svc.handleUserMessage(h.session, 'Còn tiền hoa hồng thì sao?');

    expect(h.answerHistory()).toHaveLength(2);
  });

  it('a manager continuing a receptionist’s thread keeps it (it can only be a LOWER tier)', async () => {
    const h = build({ viewer: 'manager', existing: { id: 77, actorRole: 'receptionist', turns: manager } });

    await h.svc.handleUserMessage(h.session, 'Còn tiền hoa hồng thì sao?');

    expect(h.answerHistory()).toHaveLength(2);
  });

  it('a tenant with no manager-only category keeps the history whatever the stamps say (byte-identical)', async () => {
    const h = build({ viewer: 'manager', claimsAgeMs: 9 * HOUR, tiers: false, existing: { id: 77, actorRole: 'manager', turns: manager } });

    await h.svc.handleUserMessage(h.session, 'Còn tiền hoa hồng thì sao?');

    expect(h.answerHistory()).toHaveLength(2);
  });

  it('an unstamped thread (a guest, a v1 identity, a thread from before the stamps) is never guarded', async () => {
    const h = build({ viewer: 'guest', existing: { id: 77, actorRole: null, turns: manager } });

    await h.svc.handleUserMessage(h.session, 'Còn tiền hoa hồng thì sao?');

    expect(h.answerHistory()).toHaveLength(2);
  });
});
