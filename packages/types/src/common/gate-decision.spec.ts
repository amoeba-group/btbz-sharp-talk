import { AUDIENCE, audienceOf } from './audience';
import {
  EXPECT_GATE,
  GATE_AS,
  GATE_AS_OPTIONS,
  GATE_DECISION,
  gateMatchesExpectation,
  gateRefuses,
  isExpectGate,
  isGateAs,
  isGateDecision,
  simulatedIdentity,
} from './gate-decision';

describe('GATE_DECISION', () => {
  it('is exactly the agreed set (traces, golden grading and the calibration CLI speak it)', () => {
    expect(Object.values(GATE_DECISION).sort()).toEqual(
      ['allow', 'embedder_degraded', 'guest_gate', 'low_confidence', 'role_manager_only'].sort(),
    );
  });

  it('isGateDecision accepts members only', () => {
    expect(isGateDecision('allow')).toBe(true);
    expect(isGateDecision('refuse')).toBe(false); // an expectation, not a decision
    expect(isGateDecision(undefined)).toBe(false);
  });

  it('only "allow" does not refuse', () => {
    expect(gateRefuses(GATE_DECISION.ALLOW)).toBe(false);
    for (const d of Object.values(GATE_DECISION).filter((v) => v !== 'allow')) expect(gateRefuses(d)).toBe(true);
  });
});

describe('simulatedIdentity — the viewers of "Test as…"', () => {
  const NOW = new Date('2026-10-13T10:00:00Z');

  it.each([
    [GATE_AS.GUEST, AUDIENCE.PUBLIC],
    [GATE_AS.PARTNER, AUDIENCE.PARTNER],
    [GATE_AS.RECEPTIONIST, AUDIENCE.PARTNER],
    [GATE_AS.MANAGER, AUDIENCE.MANAGER],
  ])('%s reads as the %s tier through audienceOf (the same function chat uses)', (as, tier) => {
    expect(audienceOf(simulatedIdentity(as, NOW))).toBe(tier);
  });

  it('a guest has no claims and a bound customer of nobody; the others are verified', () => {
    expect(simulatedIdentity(GATE_AS.GUEST, NOW)).toMatchObject({ level: 'guest', claims: null, customerId: null, expired: false });
    expect(simulatedIdentity(GATE_AS.PARTNER, NOW)).toMatchObject({ level: 'verified', claims: null });
  });

  it('signed roles carry fresh SIGNED claims (audienceOf ignores unsigned ones)', () => {
    const r = simulatedIdentity(GATE_AS.RECEPTIONIST, NOW);
    expect(r.claims).toMatchObject({ signed: true, role: 'receptionist', verifiedAt: NOW.toISOString() });
    expect(simulatedIdentity(GATE_AS.MANAGER, NOW).claims).toMatchObject({ signed: true, role: 'manager' });
  });

  it('lists the options least privileged first and validates input', () => {
    expect(GATE_AS_OPTIONS).toEqual(['guest', 'partner', 'receptionist', 'manager']);
    expect(isGateAs('receptionist')).toBe(true);
    expect(isGateAs('admin')).toBe(false);
    expect(isGateAs(undefined)).toBe(false);
  });
});

describe('golden expectation', () => {
  it('"refuse" means ANY decision other than allow', () => {
    expect(gateMatchesExpectation(EXPECT_GATE.REFUSE, GATE_DECISION.GUEST_GATE)).toBe(true);
    expect(gateMatchesExpectation(EXPECT_GATE.REFUSE, GATE_DECISION.ROLE_MANAGER_ONLY)).toBe(true);
    expect(gateMatchesExpectation(EXPECT_GATE.REFUSE, GATE_DECISION.LOW_CONFIDENCE)).toBe(true);
    expect(gateMatchesExpectation(EXPECT_GATE.REFUSE, GATE_DECISION.EMBEDDER_DEGRADED)).toBe(true);
    expect(gateMatchesExpectation(EXPECT_GATE.REFUSE, GATE_DECISION.ALLOW)).toBe(false);
  });

  it('"allow" means exactly allow', () => {
    expect(gateMatchesExpectation(EXPECT_GATE.ALLOW, GATE_DECISION.ALLOW)).toBe(true);
    expect(gateMatchesExpectation(EXPECT_GATE.ALLOW, GATE_DECISION.GUEST_GATE)).toBe(false);
    expect(gateMatchesExpectation(EXPECT_GATE.ALLOW, GATE_DECISION.EMBEDDER_DEGRADED)).toBe(false);
  });

  it('isExpectGate accepts the two words only', () => {
    expect(isExpectGate('allow')).toBe(true);
    expect(isExpectGate('refuse')).toBe(true);
    expect(isExpectGate('guest_gate')).toBe(false);
    expect(isExpectGate(null)).toBe(false);
  });
});
