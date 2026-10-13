import { GATE_AS, GATE_DECISION, simulatedIdentity } from '@sharptalk/types';
import {
  ESCALATION_CONFIDENCE,
  GUEST_GATE_CONFIDENCE,
  decideGate,
  decideGuestGate,
  decideLowConfidence,
  gateTraceExtras,
  matchedCategoriesOf,
} from './gate-decision';
import { AGENT_ID, QUESTION, asGateRag, makeRag } from './testing/gate-harness';
import type { Measure, World } from './testing/gate-harness';

/**
 * The gate decision (PLN-261012 SG-51, REQ D-13 / D-16): one function for chat and the simulator.
 * These pin the decision itself; gate-parity.spec.ts pins that chat reaches the same one.
 */
const world = (over: Partial<World> = {}): World => ({
  policy: 'login_guidance',
  tiers: true,
  guest: { confidence: 0.8, topSimilarity: 0.8, categories: ['sign-up'] },
  audience: { confidence: 0.8, topSimilarity: 0.8, categories: ['sign-up', 'settlement'] },
  manager: { confidence: 0.2 },
  ...over,
});
const req = (as: (typeof GATE_AS)[keyof typeof GATE_AS], query = QUESTION) => ({
  tenantId: 1,
  agentId: AGENT_ID,
  identity: simulatedIdentity(as),
  query,
});

describe('the two bars', () => {
  it('the handoff bar is 0.45 and the guest bar defaults to it', () => {
    expect(ESCALATION_CONFIDENCE).toBe(0.45);
    expect(GUEST_GATE_CONFIDENCE).toBe(0.45);
  });
});

describe('decideGuestGate — question 1', () => {
  it('a signed-out guest of a login_guidance agent whose public scope grounds the question: allow, and measured', async () => {
    const rag = makeRag(world());

    const d = await decideGuestGate(asGateRag(rag), req(GATE_AS.GUEST));

    expect(d).toMatchObject({
      decision: GATE_DECISION.ALLOW,
      stage: 'guest',
      guestGated: true,
      audience: 'public',
      threshold: 0.45,
      grounded: 0.8,
      topSimilarity: 0.8,
      vectorProvider: 'voyage',
      degraded: false,
    });
    // Measured on the PUBLIC scope AND the audience (SG-10), on the effective agent.
    expect(rag.groundingReport).toHaveBeenCalledWith(1, QUESTION, AGENT_ID, { guestOnly: true, audience: 'public' }, undefined);
  });

  it('below the bar: guest_gate, with the matched categories and the similarity', async () => {
    const rag = makeRag(world({ guest: { confidence: 0.2, topSimilarity: 0.31, categories: ['reconciliation'] } }));

    const d = await decideGuestGate(asGateRag(rag), req(GATE_AS.GUEST));

    expect(d.decision).toBe(GATE_DECISION.GUEST_GATE);
    expect(d).toMatchObject({ grounded: 0.2, topSimilarity: 0.31, degraded: false });
    expect(d.matchedCategories).toEqual([{ category: 'reconciliation', group: 'counsel', similarity: 0.31, docCount: 1 }]);
  });

  it('the vector leg DOWN reads embedder_degraded, not guest_gate — the same closed gate, a different cause', async () => {
    const rag = makeRag(world({ guest: { confidence: 0.2, degraded: true, vectorProvider: null } }));

    const d = await decideGuestGate(asGateRag(rag), req(GATE_AS.GUEST));

    expect(d.decision).toBe(GATE_DECISION.EMBEDDER_DEGRADED);
    expect(d).toMatchObject({ guestGated: true, degraded: true, degradedReason: 'qdrant_error', grounded: 0.2 });
  });

  it('a guest of an OPEN agent is not gated: allow, nothing measured, the policy is the only read', async () => {
    const rag = makeRag(world({ policy: 'open', guest: { confidence: 0.2 } }));

    const d = await decideGuestGate(asGateRag(rag), req(GATE_AS.GUEST));

    expect(d).toMatchObject({ decision: 'allow', guestGated: false, grounded: null, audience: 'public', guestPolicy: 'open' });
    expect(rag.groundingReport).not.toHaveBeenCalled();
  });

  it.each([GATE_AS.PARTNER, GATE_AS.RECEPTIONIST, GATE_AS.MANAGER])(
    'a signed-in %s is never gated, however weak the public grounding — and the policy is not even read',
    async (as) => {
      const rag = makeRag(world({ guest: { confidence: 0.2 } }));

      const d = await decideGuestGate(asGateRag(rag), req(as));

      expect(d).toMatchObject({ decision: 'allow', guestGated: false, guestPolicy: null });
      expect(rag.agentGuestPolicy).not.toHaveBeenCalled();
      expect(rag.groundingReport).not.toHaveBeenCalled();
    },
  );

  it('lapsed claims are carried through so the refusal can be filed as identity_expired', async () => {
    const rag = makeRag(world({ guest: { confidence: 0.2 } }));

    const d = await decideGuestGate(asGateRag(rag), { ...req(GATE_AS.GUEST), identity: { level: 'guest', claims: null, expired: true } });

    expect(d).toMatchObject({ decision: 'guest_gate', identityExpired: true });
  });

  it('works on a bare groundingConfidence double (a RagService that predates the report): the number only', async () => {
    const rag = {
      agentGuestPolicy: jest.fn(async () => 'login_guidance'),
      groundingConfidence: jest.fn(async () => 0.2),
    };

    const d = await decideGuestGate(rag, req(GATE_AS.GUEST));

    expect(d).toMatchObject({ decision: 'guest_gate', grounded: 0.2, topSimilarity: null, vectorProvider: null, degraded: false });
    expect(rag.groundingConfidence).toHaveBeenCalledWith(1, QUESTION, AGENT_ID, { guestOnly: true, audience: 'public' });
  });

  it('assumeGuestPolicy measures a guest before the agent is switched to login_guidance (calibration)', async () => {
    const rag = makeRag(world({ policy: 'open', guest: { confidence: 0.2 } }));

    const d = await decideGuestGate(asGateRag(rag), req(GATE_AS.GUEST), { assumeGuestPolicy: 'login_guidance' });

    expect(d.decision).toBe('guest_gate');
    expect(rag.agentGuestPolicy).not.toHaveBeenCalled();
  });

  it('guestThreshold overrides the bar for a sweep: the same measurement, another verdict', async () => {
    const rag = makeRag(world({ guest: { confidence: 0.6 } }));

    expect((await decideGuestGate(asGateRag(rag), req(GATE_AS.GUEST), { guestThreshold: 0.55 })).decision).toBe('allow');
    expect((await decideGuestGate(asGateRag(rag), req(GATE_AS.GUEST), { guestThreshold: 0.65 })).decision).toBe('guest_gate');
  });
});

describe('decideLowConfidence — question 3', () => {
  const lowMeasure = (over: Partial<Measure> = {}) => ({
    confidence: 0.2,
    grounding: { topSimilarity: 0.3, categories: ['x'], docIds: [1], vectorProvider: 'voyage', degraded: false, ...over },
  });

  it('a receptionist whose MANAGER-scoped grounding clears the bar: role_manager_only, with the manager scope measured', async () => {
    const rag = makeRag(world({ manager: { confidence: 0.8, topSimilarity: 0.77, categories: ['payout'] } }));

    const d = await decideLowConfidence(asGateRag(rag), req(GATE_AS.RECEPTIONIST), lowMeasure());

    expect(d).toMatchObject({ decision: 'role_manager_only', audience: 'partner', grounded: 0.8, threshold: 0.45, topSimilarity: 0.77 });
    expect(d.matchedCategories.map((c) => c.category)).toEqual(['payout']);
    expect(rag.groundingReport).toHaveBeenCalledWith(1, QUESTION, AGENT_ID, { audience: 'manager' }, undefined);
  });

  it('a partner (v1, no signed role) gets the same tier check: only the TIER matters, not the role word', async () => {
    const rag = makeRag(world({ manager: { confidence: 0.8 } }));

    expect((await decideLowConfidence(asGateRag(rag), req(GATE_AS.PARTNER), lowMeasure())).decision).toBe('role_manager_only');
  });

  it('a manager is never pointed to the manager account, and a guest is not either', async () => {
    const rag = makeRag(world({ manager: { confidence: 0.8 } }));

    expect((await decideLowConfidence(asGateRag(rag), req(GATE_AS.MANAGER), lowMeasure())).decision).toBe('low_confidence');
    expect((await decideLowConfidence(asGateRag(rag), req(GATE_AS.GUEST), lowMeasure())).decision).toBe('low_confidence');
    expect(rag.groundingReport).not.toHaveBeenCalled();
  });

  it('a tenant with no manager-only category pays no extra retrieval', async () => {
    const rag = makeRag(world({ tiers: false, manager: { confidence: 0.8 } }));

    const d = await decideLowConfidence(asGateRag(rag), req(GATE_AS.RECEPTIONIST), lowMeasure());

    expect(d.decision).toBe('low_confidence');
    expect(rag.groundingReport).not.toHaveBeenCalled();
  });

  it('skipRoleTier (an engine outage, an answer-first deny rule) skips the check and still classifies', async () => {
    const rag = makeRag(world({ manager: { confidence: 0.8 } }));

    const d = await decideLowConfidence(asGateRag(rag), req(GATE_AS.RECEPTIONIST), lowMeasure(), { skipRoleTier: true });

    expect(d.decision).toBe('low_confidence');
    expect(rag.hasAudienceTiers).not.toHaveBeenCalled();
  });

  it('nothing grounded and the vector leg RAN: low_confidence', async () => {
    const d = await decideLowConfidence(asGateRag(makeRag(world({ tiers: false }))), req(GATE_AS.PARTNER), lowMeasure());

    expect(d).toMatchObject({ decision: 'low_confidence', grounded: 0.2, stage: 'answer', degraded: false, vectorProvider: 'voyage' });
  });

  it('nothing grounded because the vector leg was DOWN: embedder_degraded, never a verdict on the question', async () => {
    const d = await decideLowConfidence(
      asGateRag(makeRag(world({ tiers: false }))),
      req(GATE_AS.PARTNER),
      lowMeasure({ degraded: true, vectorProvider: null }),
    );

    expect(d).toMatchObject({ decision: 'embedder_degraded', stage: 'answer', degraded: true, grounded: 0.2 });
  });

  it('a double with no hasAudienceTiers reads as "no tiers" (as chat always did), not as an error', async () => {
    const rag = { agentGuestPolicy: jest.fn(), groundingConfidence: jest.fn(async () => 0.9) };

    const d = await decideLowConfidence(rag, req(GATE_AS.RECEPTIONIST), lowMeasure());

    expect(d.decision).toBe('low_confidence');
    expect(rag.groundingConfidence).not.toHaveBeenCalled();
  });
});

describe('decideGate — the whole decision (what the simulator and the calibration run)', () => {
  it('guest of a login_guidance agent, public knowledge grounds it: allow (and the measurement is the guest scope)', async () => {
    const d = await decideGate(asGateRag(makeRag(world())), req(GATE_AS.GUEST));

    expect(d).toMatchObject({ decision: 'allow', guestGated: true, grounded: 0.8, audience: 'public' });
  });

  it('guest, nothing public grounds it: guest_gate', async () => {
    const d = await decideGate(asGateRag(makeRag(world({ guest: { confidence: 0.2 } }))), req(GATE_AS.GUEST));

    expect(d.decision).toBe('guest_gate');
  });

  it('guest of an OPEN agent: judged on the audience scope like anyone — allow when grounded', async () => {
    const rag = makeRag(world({ policy: 'open', guest: { confidence: 0.2 }, audience: { confidence: 0.8, categories: ['faq'] } }));

    const d = await decideGate(asGateRag(rag), req(GATE_AS.GUEST));

    expect(d).toMatchObject({ decision: 'allow', guestGated: false, grounded: 0.8, threshold: 0.45, audience: 'public' });
    expect(d.matchedCategories.map((c) => c.category)).toEqual(['faq']);
    // Measured as the model path would be judged: audience scope, lenient confidence (queries given).
    expect(rag.groundingReport).toHaveBeenCalledWith(1, QUESTION, AGENT_ID, { audience: 'public' }, [QUESTION]);
  });

  it('guest of an OPEN agent, nothing grounds it: low_confidence (a hand-off), never guest_gate', async () => {
    const rag = makeRag(world({ policy: 'open', audience: { confidence: 0.2 }, tiers: false }));

    expect((await decideGate(asGateRag(rag), req(GATE_AS.GUEST))).decision).toBe('low_confidence');
  });

  it('receptionist asking a manager-only topic: role_manager_only', async () => {
    const rag = makeRag(world({ audience: { confidence: 0.2 }, manager: { confidence: 0.85, categories: ['payout'] } }));

    const d = await decideGate(asGateRag(rag), req(GATE_AS.RECEPTIONIST));

    expect(d.decision).toBe('role_manager_only');
  });

  it('the same question asked as a MANAGER is allowed — for a manager the audience scope IS the manager scope', async () => {
    // (One physical retrieval: `audience: 'manager'` — the world keys it as `manager`.)
    const rag = makeRag(world({ audience: { confidence: 0.2 }, manager: { confidence: 0.85 } }));

    const d = await decideGate(asGateRag(rag), req(GATE_AS.MANAGER));

    expect(d).toMatchObject({ decision: 'allow', audience: 'manager' });
    expect(rag.groundingReport).toHaveBeenCalledWith(1, QUESTION, AGENT_ID, { audience: 'manager' }, [QUESTION]);
  });

  it('vector leg down on a non-gated turn that the keyword leg can still answer (capped 0.55): allow', async () => {
    const rag = makeRag(world({ policy: 'open', audience: { confidence: 0.55, degraded: true, vectorProvider: null } }));

    const d = await decideGate(asGateRag(rag), req(GATE_AS.PARTNER));

    expect(d).toMatchObject({ decision: 'allow', degraded: true });
  });

  it('vector leg down and nothing from the keyword leg either: embedder_degraded', async () => {
    const rag = makeRag(world({ policy: 'open', tiers: false, audience: { confidence: 0.2, degraded: true, vectorProvider: null } }));

    expect((await decideGate(asGateRag(rag), req(GATE_AS.PARTNER))).decision).toBe('embedder_degraded');
  });

  it('a guest bar BELOW the handoff bar: passing the gate does not make a 0.4 grounding answerable', async () => {
    const rag = makeRag(world({ guest: { confidence: 0.4 }, tiers: false }));

    const d = await decideGate(asGateRag(rag), req(GATE_AS.GUEST), { guestThreshold: 0.3 });

    expect(d).toMatchObject({ decision: 'low_confidence', guestGated: true, grounded: 0.4 });
  });
});

describe('matchedCategoriesOf', () => {
  it('groups documents by (group, category) in rank order with the best similarity', () => {
    const chunks = [
      { id: 1, title: 'a', category: 'Settlement', group: 'counsel', similarity: 0.5 },
      { id: 2, title: 'b', category: 'Cancellation', group: 'counsel', similarity: 0.7 },
      { id: 3, title: 'c', category: 'Settlement', group: 'counsel', similarity: 0.62 },
      { id: 4, title: 'd', category: null, group: 'counsel', similarity: 0.9 },
      { id: 5, title: 'e', category: 'Settlement', group: 'product', similarity: null },
    ];

    expect(matchedCategoriesOf(chunks)).toEqual([
      { category: 'Settlement', group: 'counsel', similarity: 0.62, docCount: 2 },
      { category: 'Cancellation', group: 'counsel', similarity: 0.7, docCount: 1 },
      { category: 'Settlement', group: 'product', similarity: null, docCount: 1 },
    ]);
  });
});

describe('gateTraceExtras — what is stored, and what never is', () => {
  it('a measured decision: the word, the tier, the figures, the provider, top-3 categories and documents', async () => {
    const rag = makeRag(world({ guest: { confidence: 0.2, topSimilarity: 0.31, categories: ['a', 'b', 'c', 'd'] } }));
    const d = await decideGuestGate(asGateRag(rag), req(GATE_AS.GUEST));

    expect(gateTraceExtras(d)).toEqual({
      gate: 'guest_gate',
      audience: 'public',
      grounded: 0.2,
      threshold: 0.45,
      topSimilarity: 0.31,
      vectorProvider: 'voyage',
      categories: ['a', 'b', 'c'],
      docIds: [1, 2, 3],
    });
  });

  it('a degraded measurement stores the provider as "degraded" (the AI-turn convention of SG-84)', async () => {
    const rag = makeRag(world({ guest: { confidence: 0.2, degraded: true, vectorProvider: 'stub' } }));

    expect(gateTraceExtras(await decideGuestGate(asGateRag(rag), req(GATE_AS.GUEST)))).toMatchObject({
      gate: 'embedder_degraded',
      vectorProvider: 'degraded',
    });
  });

  it('a decision that measured nothing carries no figures and no provider', async () => {
    const d = await decideGuestGate(asGateRag(makeRag(world({ policy: 'open' }))), req(GATE_AS.GUEST));

    expect(gateTraceExtras(d)).toEqual({ gate: 'allow', audience: 'public' });
  });

  it('NEVER carries the question — not even when the question is all the decision was given', async () => {
    const secret = 'my phone is 0901234567 and my card is 4111111111111111';
    const rag = makeRag(world({ guest: { confidence: 0.2 } }));
    const d = await decideGate(asGateRag(rag), req(GATE_AS.GUEST, secret));

    expect(JSON.stringify(gateTraceExtras(d))).not.toMatch(/0901234567|4111111111111111|phone/);
    expect(JSON.stringify(d.summary)).not.toContain('0901234567');
  });
});
