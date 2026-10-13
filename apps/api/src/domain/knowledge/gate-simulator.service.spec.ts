import { GATE_AS } from '@sharptalk/types';
import type { GateAs } from '@sharptalk/types';
import { ChatService } from '../chat/chat.service';
import { AGENT_ID, QUESTION, buildChat, makeRag, observedDecision } from '../chat/testing/gate-harness';
import type { World } from '../chat/testing/gate-harness';
import { GateSimulatorService } from './gate-simulator.service';
import { KnowledgeService } from './knowledge.service';

/**
 * The console's "Test as…" (PLN-261012 SG-51). It takes no decision of its own, so these pin what
 * it hands to the decision (the viewer must really reach retrieval), what it adds (tiers, the reply
 * text) and what it never does (a model call on a refusal).
 */
const world = (over: Partial<World> = {}): World => ({
  policy: 'login_guidance',
  tiers: true,
  guest: { confidence: 0.8, topSimilarity: 0.8, categories: ['sign-up'] },
  audience: { confidence: 0.8, topSimilarity: 0.7, categories: ['sign-up', 'cancellation'] },
  manager: { confidence: 0.2 },
  ...over,
});

const CATEGORY_ROWS = [
  { name: 'sign-up', docGroup: 'counsel', guestVisible: 1, minAudience: 'public' },
  { name: 'login', docGroup: 'counsel', guestVisible: 1, minAudience: null },
  { name: 'cancellation', docGroup: 'counsel', guestVisible: 0, minAudience: 'partner' },
  { name: 'payout', docGroup: 'counsel', guestVisible: 0, minAudience: 'manager' },
  { name: 'reconciliation', docGroup: 'counsel', guestVisible: 0, minAudience: null },
];

function build(w: World, language = 'VI') {
  const rag = makeRag(w);
  const askResult = { answer: 'Model answer', confidence: 0.77, blocked: false, sources: [{ id: 1, title: 'doc' }] };
  const ask = jest.fn(async () => askResult);
  const find = jest.fn(async (q: { where: { tenantId: number; name: { _value: string[] } } }) => {
    const names = (q.where.name as unknown as { _value: string[] })._value;
    return CATEGORY_ROWS.filter((r) => names.includes(r.name)).map((r) => ({ ...r, tenantId: q.where.tenantId }));
  });
  // The REAL ChatService reply helpers (no constructor): the very text the refusal branches send.
  const chat = Object.assign(Object.create(ChatService.prototype), { rag }) as ChatService;
  const svc = new GateSimulatorService(rag as never, chat, { ask } as unknown as KnowledgeService, { find } as never);
  return { svc, rag, ask, find, language };
}

const simulate = (svc: GateSimulatorService, as: GateAs, extra: Record<string, unknown> = {}, language = 'VI') =>
  svc.simulate(1, { question: QUESTION, language, as, aiAgentId: 5, ...extra });

describe('the viewer really reaches the decision and retrieval', () => {
  it.each([
    [GATE_AS.GUEST, { guestOnly: true, audience: 'public' }],
    [GATE_AS.PARTNER, { audience: 'partner' }],
    [GATE_AS.RECEPTIONIST, { audience: 'partner' }],
    [GATE_AS.MANAGER, { audience: 'manager' }],
  ] as const)('as %s: the retrieval is scoped %j', async (as, scope) => {
    // A policy-less world so every viewer is measured on its own scope.
    const h = build(world({ audience: { confidence: 0.8 }, manager: { confidence: 0.8 } }));

    await simulate(h.svc, as);

    // The agent the visitor would talk to is the EFFECTIVE one (`effectiveAgentId` resolved it).
    const scopes = h.rag.groundingReport.mock.calls.map((c) => [c[0], c[1], c[2], c[3]]);
    expect(scopes).toContainEqual([1, QUESTION, AGENT_ID, expect.objectContaining(scope)]);
  });

  it.each([
    [GATE_AS.GUEST, 'public', true],
    [GATE_AS.PARTNER, 'partner', false],
    [GATE_AS.RECEPTIONIST, 'partner', false],
    [GATE_AS.MANAGER, 'manager', false],
  ] as const)('as %s the allowed answer is produced for audience %s (guest scope: %s)', async (as, audience, guestOnly) => {
    const h = build(world({ manager: { confidence: 0.8 } }));

    const res = await simulate(h.svc, as, { group: 'counsel' });

    expect(res.gate.decision).toBe('allow');
    expect(h.ask).toHaveBeenCalledWith(1, QUESTION, 'VI', 'counsel', AGENT_ID, null, audience, guestOnly);
    expect(res.answer).toBe('Model answer');
    expect(res.sources).toEqual([{ id: 1, title: 'doc' }]);
  });

  it('with no agent picked it talks to the DEFAULT agent — what an unpinned visitor gets', async () => {
    const h = build(world());

    const res = await simulate(h.svc, GATE_AS.GUEST, { aiAgentId: null });

    expect(h.rag.effectiveAgentId).toHaveBeenCalledWith(1, null);
    expect(res.gate.agentId).toBe(AGENT_ID);
  });

  it('upper-cases the language the way the widget session codes are', async () => {
    const h = build(world());

    await simulate(h.svc, GATE_AS.PARTNER, {}, 'vi');

    expect(h.ask.mock.calls[0][2]).toBe('VI');
  });
});

describe('a refusal is the gate\'s own text and costs no model call', () => {
  it('a signed-out visitor of a login_guidance agent: guest_gate, the sign-in prompt, nothing answered', async () => {
    const h = build(world({ guest: { confidence: 0.2, topSimilarity: 0.31, categories: ['reconciliation'] } }));

    const res = await simulate(h.svc, GATE_AS.GUEST);

    expect(h.ask).not.toHaveBeenCalled();
    expect(res.gate).toMatchObject({
      as: 'guest',
      audience: 'public',
      decision: 'guest_gate',
      stage: 'guest',
      refused: true,
      guestGated: true,
      guestPolicy: 'login_guidance',
      threshold: 0.45,
      confidence: 0.2,
      topSimilarity: 0.31,
      vectorProvider: 'voyage',
      degraded: false,
    });
    expect(res.gate.reply).toContain('đăng nhập');
    expect(res.answer).toBe(res.gate.reply);
    expect(res.sources).toEqual([]);
    expect(res.blocked).toBe(false);
    expect(res.confidence).toBe(0.2);
  });

  it('a receptionist asking a manager-only topic: role_manager_only, pointed to the manager account', async () => {
    const h = build(world({ policy: 'open', audience: { confidence: 0.2 }, manager: { confidence: 0.85, topSimilarity: 0.85, categories: ['payout'] } }));

    const res = await simulate(h.svc, GATE_AS.RECEPTIONIST);

    expect(res.gate).toMatchObject({ decision: 'role_manager_only', refused: true, audience: 'partner', confidence: 0.85 });
    expect(res.gate.reply).toContain('Quản lý');
    expect(h.ask).not.toHaveBeenCalled();
  });

  it('nothing grounds it for anyone: low_confidence, the stock hand-off notice', async () => {
    const h = build(world({ policy: 'open', tiers: false, audience: { confidence: 0.2 } }));

    const res = await simulate(h.svc, GATE_AS.PARTNER);

    expect(res.gate).toMatchObject({ decision: 'low_confidence', stage: 'answer', refused: true });
    expect(res.gate.reply).toEqual(expect.any(String));
    expect(res.gate.reply).not.toBe('');
  });

  it('the vector leg down at the guest gate: embedder_degraded, and the visitor still reads the sign-in prompt', async () => {
    const h = build(world({ guest: { confidence: 0.2, degraded: true, vectorProvider: null } }));

    const res = await simulate(h.svc, GATE_AS.GUEST);

    expect(res.gate).toMatchObject({ decision: 'embedder_degraded', stage: 'guest', degraded: true, degradedReason: 'qdrant_error' });
    expect(res.gate.reply).toContain('đăng nhập');
  });

  it('the vector leg down on a signed-in turn: embedder_degraded, and the hand-off notice (not a sign-in prompt)', async () => {
    const h = build(world({ policy: 'open', tiers: false, audience: { confidence: 0.2, degraded: true, vectorProvider: null } }));

    const res = await simulate(h.svc, GATE_AS.PARTNER);

    expect(res.gate).toMatchObject({ decision: 'embedder_degraded', stage: 'answer' });
    expect(res.gate.reply).not.toContain('đăng nhập');
  });

  it('a guest of an OPEN agent is simply answered (the policy is shown so the operator knows why)', async () => {
    const h = build(world({ policy: 'open', guest: { confidence: 0.2 } }));

    const res = await simulate(h.svc, GATE_AS.GUEST);

    expect(res.gate).toMatchObject({ decision: 'allow', guestGated: false, guestPolicy: 'open', refused: false, reply: null });
    expect(h.ask).toHaveBeenCalledWith(1, QUESTION, 'VI', undefined, AGENT_ID, null, 'public', false);
  });
});

describe('matched categories carry their tier (the manager-tier exclusion is visible)', () => {
  it('a receptionist\'s matched list holds no manager-only category; a manager\'s does, labelled', async () => {
    const asReceptionist = build(world({ policy: 'open', audience: { confidence: 0.2, categories: ['sign-up', 'cancellation'] }, manager: { confidence: 0.2 } }));
    const asManager = build(world({ policy: 'open', manager: { confidence: 0.85, topSimilarity: 0.85, categories: ['payout', 'cancellation'] } }));

    const receptionist = await simulate(asReceptionist.svc, GATE_AS.RECEPTIONIST);
    const manager = await simulate(asManager.svc, GATE_AS.MANAGER);

    expect(receptionist.gate.matchedCategories.map((c) => c.tier)).not.toContain('manager');
    expect(manager.gate.matchedCategories).toEqual([
      expect.objectContaining({ category: 'payout', tier: 'manager' }),
      expect.objectContaining({ category: 'cancellation', tier: 'partner' }),
    ]);
  });

  it('reads the tier through kbAccessOf: a NULL min_audience reads by the guest_visible flag', async () => {
    const h = build(world({ guest: { confidence: 0.2, categories: ['login', 'reconciliation'] } }));

    const res = await simulate(h.svc, GATE_AS.GUEST);

    expect(res.gate.matchedCategories.map((c) => [c.category, c.tier])).toEqual([
      ['login', 'public'],
      ['reconciliation', 'partner'],
    ]);
  });

  it('a category with no row (documents filed under a name nobody created) has no tier', async () => {
    const h = build(world({ guest: { confidence: 0.2, categories: ['ghost'] } }));

    const res = await simulate(h.svc, GATE_AS.GUEST);

    expect(res.gate.matchedCategories).toEqual([expect.objectContaining({ category: 'ghost', tier: null })]);
  });

  it('reads the tiers in ONE query, scoped to the tenant', async () => {
    const h = build(world({ guest: { confidence: 0.2, categories: ['login', 'reconciliation'] } }));

    await simulate(h.svc, GATE_AS.GUEST);

    expect(h.find).toHaveBeenCalledTimes(1);
    expect(h.find.mock.calls[0][0].where.tenantId).toBe(1);
  });
});

describe('the reply is EXACTLY what chat sends (one source of text)', () => {
  it.each(['VI', 'EN', 'KO', 'ES', 'JA', 'ZH'])('guest_gate in %s equals the sign-in prompt a visitor reads', async (language) => {
    const w = world({ guest: { confidence: 0.2 } });
    const h = build(w);
    const sim = await simulate(h.svc, GATE_AS.GUEST, {}, language);

    const rag = makeRag(w);
    const chat = buildChat(rag, GATE_AS.GUEST);
    (chat.session as unknown as { language: string }).language = language;
    const result = await chat.svc.handleUserMessage(chat.session, QUESTION);

    expect(sim.gate.reply).toBe(result.reply?.body);
    expect(observedDecision(result, { system: chat.traces('system'), ai: chat.traces('ai') })).toBe(sim.gate.decision);
  });

  it.each(['VI', 'EN', 'KO'])('role_manager_only in %s equals the manager-account line', async (language) => {
    const w = world({ policy: 'open', audience: { confidence: 0.2 }, manager: { confidence: 0.85 } });
    const h = build(w);
    const sim = await simulate(h.svc, GATE_AS.RECEPTIONIST, {}, language);

    const chat = buildChat(makeRag(w), GATE_AS.RECEPTIONIST);
    (chat.session as unknown as { language: string }).language = language;
    const result = await chat.svc.handleUserMessage(chat.session, QUESTION);

    expect(sim.gate.reply).toBe(result.reply?.body);
  });

  it('a tenant\'s own sign-in wording (guest_guidance.notice) wins in both', async () => {
    const w = world({ guest: { confidence: 0.2 } });
    const rag = makeRag(w);
    rag.guestGuidance.mockResolvedValue({ notice: { VI: 'Vui lòng đăng nhập Hotel Admin để xem nội dung này.' } } as never);
    const chatForSim = Object.assign(Object.create(ChatService.prototype), { rag }) as ChatService;
    const svc = new GateSimulatorService(rag as never, chatForSim, { ask: jest.fn() } as unknown as KnowledgeService, { find: jest.fn(async () => []) } as never);

    const sim = await svc.simulate(1, { question: QUESTION, language: 'VI', as: GATE_AS.GUEST, aiAgentId: 5 });
    const real = buildChat(rag, GATE_AS.GUEST);
    const result = await real.svc.handleUserMessage(real.session, QUESTION);

    expect(sim.gate.reply).toBe('Vui lòng đăng nhập Hotel Admin để xem nội dung này.');
    expect(result.reply?.body).toBe(sim.gate.reply);
  });
});

describe('decide() — the measurement alone (golden runner, calibration CLI)', () => {
  it('runs no answer and builds no reply text', async () => {
    const h = build(world({ guest: { confidence: 0.2 } }));

    const { decision, agentId } = await h.svc.decide(1, { question: QUESTION, as: GATE_AS.GUEST, aiAgentId: 5 });

    expect(decision.decision).toBe('guest_gate');
    expect(agentId).toBe(AGENT_ID);
    expect(h.ask).not.toHaveBeenCalled();
  });

  it('assumeGuestPolicy measures a guest before the agent is switched to login_guidance', async () => {
    const h = build(world({ policy: 'open', guest: { confidence: 0.2 } }));

    const { decision } = await h.svc.decide(1, { question: QUESTION, as: GATE_AS.GUEST }, { assumeGuestPolicy: 'login_guidance' });

    expect(decision.decision).toBe('guest_gate');
  });
});
