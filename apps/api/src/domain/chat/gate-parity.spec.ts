import { GATE_AS, GATE_AS_OPTIONS, simulatedIdentity } from '@sharptalk/types';
import type { GateAs, GateDecisionValue } from '@sharptalk/types';
import { decideGate } from './gate-decision';
import { AGENT_ID, QUESTION, asGateRag, buildChat, makeRag, observedDecision } from './testing/gate-harness';
import type { Measure, World } from './testing/gate-harness';

/**
 * Chat and the simulator cannot diverge (PLN-261012 SG-51). The same scripted world feeds a REAL
 * ChatService turn and `decideGate`; the chat outcome is read only from what a customer and the
 * stored trace can observe (needsAuth / escalate / the trace's reason and gate), never from the
 * decision function — an independent witness. Every audience x policy x tier x measurement is
 * walked, so a rule added to one path and not the other fails here.
 */

// Measurements a scope can yield. Degraded ones are the strict sentinel (0.2) or, for the answer
// scope only, the capped keyword confidence (0.55) a degraded vector leg may still earn.
const GUEST: Measure[] = [
  { confidence: 0.2 },
  { confidence: 0.2, degraded: true, vectorProvider: null },
  { confidence: 0.8, topSimilarity: 0.8 },
];
const AUDIENCE: Measure[] = [
  { confidence: 0.2 },
  { confidence: 0.2, degraded: true, vectorProvider: 'stub' },
  { confidence: 0.55, degraded: true, vectorProvider: null },
  { confidence: 0.8, topSimilarity: 0.8 },
];
const MANAGER: Measure[] = [{ confidence: 0.2 }, { confidence: 0.85, topSimilarity: 0.85, categories: ['payout'] }];

const label = (m: Measure) => `${m.confidence}${m.degraded ? 'D' : ''}`;

interface Case {
  name: string;
  world: World;
  viewer: GateAs;
}

function grid(): Case[] {
  const cases: Case[] = [];
  for (const viewer of GATE_AS_OPTIONS) {
    for (const policy of ['open', 'login_guidance'] as const) {
      for (const tiers of [true, false]) {
        for (const guest of GUEST) {
          for (const audience of AUDIENCE) {
            for (const manager of MANAGER) {
              // For a manager the audience scope IS the manager scope (one retrieval): script it once.
              if (viewer === GATE_AS.MANAGER && audience !== AUDIENCE[0]) continue;
              cases.push({
                name: `${viewer}|${policy}|tiers=${tiers}|guest=${label(guest)}|aud=${label(audience)}|mgr=${label(manager)}`,
                viewer,
                world: { policy, tiers, guest, audience, manager },
              });
            }
          }
        }
      }
    }
  }
  return cases;
}

const simulate = async (world: World, viewer: GateAs) => {
  const rag = makeRag(world);
  return decideGate(asGateRag(rag), { tenantId: 1, agentId: AGENT_ID, identity: simulatedIdentity(viewer), query: QUESTION });
};

const chatTurn = async (world: World, viewer: GateAs): Promise<GateDecisionValue> => {
  const rag = makeRag(world);
  const h = buildChat(rag, viewer);
  const result = await h.svc.handleUserMessage(h.session, QUESTION);
  return observedDecision(result, { system: h.traces('system'), ai: h.traces('ai') });
};

describe('chat and the simulator reach the same decision', () => {
  const cases = grid();

  it('walks a meaningful grid', () => {
    // 4 viewers x 2 policies x 2 tier states x 3 guest x 4 audience x 2 manager measurements, minus
    // the manager viewer's redundant audience variants (its audience scope IS the manager scope).
    expect(cases).toHaveLength(312);
  });

  it('for every audience, policy, tier and measurement', async () => {
    const diverged: string[] = [];
    const seen = new Set<GateDecisionValue>();
    for (const c of cases) {
      const world: World = c.world;
      // A manager viewer: the audience-scoped retrieval is the manager one.
      const effective: World = c.viewer === GATE_AS.MANAGER ? { ...world, audience: world.manager } : world;
      const [chat, sim] = await Promise.all([chatTurn(effective, c.viewer), simulate(effective, c.viewer)]);
      seen.add(sim.decision);
      if (chat !== sim.decision) diverged.push(`${c.name}: chat=${chat} simulator=${sim.decision}`);
    }
    expect(diverged).toEqual([]);
    // The grid really exercised every decision (a grid that never reaches one proves nothing about it).
    expect([...seen].sort()).toEqual(['allow', 'embedder_degraded', 'guest_gate', 'low_confidence', 'role_manager_only']);
  }, 120_000);

  describe.each(GATE_AS_OPTIONS)('as %s — the headline cases, spelled out', (viewer) => {
    it('signed-out knowledge only: a guest is gated, everyone signed in is not', async () => {
      const world: World = {
        policy: 'login_guidance',
        tiers: true,
        guest: { confidence: 0.2 },
        audience: { confidence: 0.8 },
        manager: { confidence: 0.8 },
      };
      const effective = viewer === GATE_AS.MANAGER ? { ...world, audience: world.manager } : world;

      const [chat, sim] = await Promise.all([chatTurn(effective, viewer), simulate(effective, viewer)]);

      expect(sim.decision).toBe(viewer === GATE_AS.GUEST ? 'guest_gate' : 'allow');
      expect(chat).toBe(sim.decision);
    });
  });

  it('a manager-only topic: refused to a receptionist and a partner, answered to a manager', async () => {
    const world: World = {
      policy: 'open',
      tiers: true,
      guest: { confidence: 0.2 },
      audience: { confidence: 0.2 },
      manager: { confidence: 0.85, topSimilarity: 0.85, categories: ['payout'] },
    };
    const got: Record<string, string> = {};
    for (const viewer of [GATE_AS.PARTNER, GATE_AS.RECEPTIONIST, GATE_AS.MANAGER] as const) {
      const effective = viewer === GATE_AS.MANAGER ? { ...world, audience: world.manager } : world;
      const [chat, sim] = await Promise.all([chatTurn(effective, viewer), simulate(effective, viewer)]);
      expect(chat).toBe(sim.decision);
      got[viewer] = sim.decision;
    }
    expect(got).toEqual({ partner: 'role_manager_only', receptionist: 'role_manager_only', manager: 'allow' });
  });
});
