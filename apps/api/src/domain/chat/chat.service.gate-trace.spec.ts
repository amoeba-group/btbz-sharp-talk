import { EVENTS } from '../../infrastructure/infrastructure.module';
import { AGENT_ID, buildChat, makeRag } from './testing/gate-harness';
import type { World } from './testing/gate-harness';

/**
 * A reason-coded trace for EVERY gate decision, the pass included (PLN-261012 SG-51, REQ D-13).
 *
 * Before: a gate PASS left no record at all (a leak was invisible), a hand-off carried only its
 * reason, and a guest-gate refusal had `grounded` / `threshold` but not what had been matched.
 * Now each carries the whitelisted measurement — the tier, the decision word, the figures, the vector
 * provider, the top-3 categories / documents — and NEVER the visitor's words.
 */
const SECRET = 'ZZ-SECRET-QUESTION-9981 phone 0901234567';

const world = (over: Partial<World> = {}): World => ({
  policy: 'login_guidance',
  tiers: true,
  guest: { confidence: 0.8, topSimilarity: 0.8, categories: ['sign-up', 'login'] },
  audience: { confidence: 0.8, topSimilarity: 0.8, categories: ['settlement'] },
  manager: { confidence: 0.2 },
  ...over,
});

const ask = async (w: World, viewer: Parameters<typeof buildChat>[1] = 'guest', text = SECRET) => {
  const rag = makeRag(w);
  const h = buildChat(rag, viewer);
  const result = await h.svc.handleUserMessage(h.session, text);
  return { ...h, rag, result, system: h.traces('system'), ai: h.traces('ai') };
};

describe('a gate PASS is recorded (the persisted AI turn)', () => {
  it('a guest of a login_guidance agent: allow, the tier, the bar, the measurement and the matched categories', async () => {
    const { ai, result } = await ask(world());

    expect(result.reply?.senderType).toBe('ai');
    expect(ai).toHaveLength(1);
    expect(ai[0]).toMatchObject({
      gate: 'allow',
      audience: 'public',
      grounded: 0.8,
      threshold: 0.45,
      topSimilarity: 0.8,
      vectorProvider: 'voyage',
      categories: ['sign-up', 'login'],
      docIds: [1, 2],
      // The answer's own trace is untouched next to it.
      confidence: 0.8,
      citations: [{ id: 1, title: 'doc' }],
    });
  });

  it('only whitelisted primitives, and never the question', async () => {
    const { ai, system } = await ask(world());

    const WHITELIST = new Set([
      // the answer turn's own keys
      'citations', 'confidence', 'latencyMs',
      // the gate extras
      'gate', 'audience', 'grounded', 'threshold', 'topSimilarity', 'vectorProvider', 'categories', 'docIds',
    ]);
    expect(Object.keys(ai[0]).filter((k) => !WHITELIST.has(k))).toEqual([]);
    expect(JSON.stringify([...ai, ...system])).not.toMatch(/ZZ-SECRET|0901234567/);
  });

  it('a guest of an OPEN agent: no gate was asked, so the turn carries nothing new (byte-identical)', async () => {
    const { ai } = await ask(world({ policy: 'open' }));

    expect(ai[0]).not.toHaveProperty('gate');
    expect(ai[0]).not.toHaveProperty('audience');
    expect(ai[0]).not.toHaveProperty('threshold');
  });

  it.each(['partner', 'receptionist', 'manager'] as const)('a signed-in %s is never gated: nothing new on the turn', async (viewer) => {
    const { ai } = await ask(world({ manager: { confidence: 0.8 } }), viewer);

    expect(ai[0]).not.toHaveProperty('gate');
  });
});

describe('a gate refusal carries the measurement (the persisted system turn)', () => {
  it('guest_gate: the closed-vocabulary reason AND what was measured, never the question', async () => {
    const { system, result } = await ask(world({ guest: { confidence: 0.2, topSimilarity: 0.31, categories: ['reconciliation'] } }));

    expect(result.needsAuth).toBe(true);
    expect(system).toHaveLength(1);
    expect(system[0]).toEqual({
      reason: 'guest_gate',
      agentId: AGENT_ID,
      gate: 'guest_gate',
      audience: 'public',
      grounded: 0.2,
      threshold: 0.45,
      topSimilarity: 0.31,
      vectorProvider: 'voyage',
      categories: ['reconciliation'],
      docIds: [1],
    });
    expect(JSON.stringify(system)).not.toMatch(/ZZ-SECRET|0901234567/);
  });

  it('a lapsed identity is still filed as identity_expired (the host re-signing fixes it), with the same extras', async () => {
    const rag = makeRag(world({ guest: { confidence: 0.2 } }));
    const h = buildChat(rag, 'manager');
    (h.session as unknown as { identityClaims: { verifiedAt: string } }).identityClaims.verifiedAt = new Date(Date.now() - 9 * 3_600_000).toISOString();

    await h.svc.handleUserMessage(h.session, SECRET);

    expect(h.traces('system')[0]).toMatchObject({ reason: 'identity_expired', gate: 'guest_gate', audience: 'public' });
  });
});

describe('embedder_degraded is told apart from low_confidence (the 0.2 sentinel is not a verdict)', () => {
  it('guest gate, vector leg DOWN: the visitor still gets the sign-in prompt, the trace says embedder_degraded', async () => {
    const down = await ask(world({ guest: { confidence: 0.2, degraded: true, vectorProvider: null } }));
    const ungrounded = await ask(world({ guest: { confidence: 0.2 } }));

    // Customer-visible behaviour is identical (the gate stays closed under an outage)...
    expect(down.result.reply?.body).toBe(ungrounded.result.reply?.body);
    expect(down.result.needsAuth).toBe(true);
    // ...the stored reason stays the analytics word, and the decision is the new fact.
    expect(down.system[0]).toMatchObject({ reason: 'guest_gate', gate: 'embedder_degraded', vectorProvider: 'degraded', grounded: 0.2 });
    expect(ungrounded.system[0]).toMatchObject({ reason: 'guest_gate', gate: 'guest_gate', vectorProvider: 'voyage' });
  });

  it('hand-off, vector leg DOWN: reason stays low_confidence (analytics counts a hand-off), gate says embedder_degraded', async () => {
    const down = await ask(world({ policy: 'open', tiers: false, audience: { confidence: 0.2, degraded: true, vectorProvider: null } }), 'partner');
    const ungrounded = await ask(world({ policy: 'open', tiers: false, audience: { confidence: 0.2 } }), 'partner');

    expect(down.result.escalate).toBe(true);
    expect(down.system[0]).toMatchObject({ reason: 'low_confidence', gate: 'embedder_degraded', vectorProvider: 'degraded' });
    expect(ungrounded.system[0]).toMatchObject({ reason: 'low_confidence', gate: 'low_confidence', vectorProvider: 'voyage' });
  });
});

describe('a low-confidence hand-off carries calibration data too', () => {
  it('the measurement, the bar and the matched categories ride on the stored notice', async () => {
    const { system, result, publish } = await ask(
      world({ policy: 'open', tiers: false, audience: { confidence: 0.2, topSimilarity: 0.28, categories: ['payout', 'settlement'] } }),
      'partner',
    );

    expect(result.escalate).toBe(true);
    expect(system[0]).toEqual({
      reason: 'low_confidence',
      agentId: AGENT_ID,
      gate: 'low_confidence',
      audience: 'partner',
      grounded: 0.2,
      threshold: 0.45,
      topSimilarity: 0.28,
      vectorProvider: 'voyage',
      categories: ['payout', 'settlement'],
      docIds: [1],
    });
    // The alert channels keep the escalation word they have always keyed on.
    const event = publish.mock.calls.find(([name]) => name === EVENTS.ESCALATION)?.[1];
    expect(event).toMatchObject({ reason: 'low_confidence' });
  });

  it('an engine outage keeps its own reason and carries no gate decision (it is not about the knowledge)', async () => {
    const rag = makeRag(world({ policy: 'open', audience: { confidence: 0.2 } }));
    rag.answer.mockImplementationOnce(async () => ({ text: '', confidence: 0, citations: [], engineDegraded: true }) as never);
    const h = buildChat(rag, 'partner');

    await h.svc.handleUserMessage(h.session, SECRET);

    expect(h.traces('system')[0]).toMatchObject({ reason: 'engine_unavailable' });
    expect(h.traces('system')[0]).not.toHaveProperty('gate');
  });
});

describe('role_manager_only keeps its trace and gains the measurement', () => {
  it('actor role, required role, the chip — and the manager-scope figures and matched categories', async () => {
    const { system, result } = await ask(
      world({ policy: 'open', audience: { confidence: 0.2 }, manager: { confidence: 0.83, topSimilarity: 0.83, categories: ['payout'] } }),
      'receptionist',
    );

    expect(result.escalate).toBe(false);
    expect(system[0]).toMatchObject({
      reason: 'role_manager_only',
      agentId: AGENT_ID,
      actorRole: 'receptionist',
      requiredRole: 'manager',
      gate: 'role_manager_only',
      audience: 'partner',
      grounded: 0.83,
      threshold: 0.45,
      topSimilarity: 0.83,
      categories: ['payout'],
      followUps: [{ id: 'agent_connect', label: expect.any(String) }],
    });
    expect(JSON.stringify(system)).not.toMatch(/ZZ-SECRET|0901234567/);
  });
});
