import {
  REFUSAL_REASON,
  buildHandoffTrace,
  buildRefusalTrace,
  isRefusalReason,
} from './refusal-reason';

/**
 * The closed refusal vocabulary (PLN-261012 SG-50). Analytics group by these
 * strings, so the set is pinned here: adding or renaming one has to be a decision.
 */
describe('REFUSAL_REASON', () => {
  it('is exactly the agreed closed set', () => {
    expect(Object.values(REFUSAL_REASON).sort()).toEqual(
      [
        'auth_gate',
        'consent',
        'embedder_degraded',
        'engine_unavailable',
        'guest_gate',
        'identity_expired',
        'low_confidence',
        'moderation',
        'pilot_denied',
        'policy_deny',
        'role_manager_only',
      ].sort(),
    );
  });

  it('isRefusalReason accepts members only', () => {
    expect(isRefusalReason('guest_gate')).toBe(true);
    expect(isRefusalReason('moderation_blocked')).toBe(false); // the escalation word, not a refusal word
    expect(isRefusalReason('user_request')).toBe(false);
    expect(isRefusalReason(undefined)).toBe(false);
    expect(isRefusalReason(7)).toBe(false);
  });
});

describe('buildRefusalTrace', () => {
  it('carries the reason and the speaking agent', () => {
    expect(buildRefusalTrace(REFUSAL_REASON.GUEST_GATE, 12)).toEqual({ reason: 'guest_gate', agentId: 12 });
  });

  it('no agent configured reads as null, never undefined', () => {
    expect(buildRefusalTrace(REFUSAL_REASON.AUTH_GATE, undefined).agentId).toBeNull();
    expect(buildRefusalTrace(REFUSAL_REASON.AUTH_GATE, null).agentId).toBeNull();
  });

  it('keeps the whitelisted extras and caps strings', () => {
    const t = buildRefusalTrace(REFUSAL_REASON.ROLE_MANAGER_ONLY, 1, {
      actorRole: 'receptionist',
      requiredRole: 'x'.repeat(100),
      expired: true,
      threshold: 0.45,
      topSimilarity: 0.31,
    });
    expect(t).toMatchObject({ actorRole: 'receptionist', expired: true, threshold: 0.45, topSimilarity: 0.31 });
    expect(t.requiredRole).toHaveLength(32);
  });

  it('DROPS anything that is not whitelisted — a trace must never carry the visitor\'s words', () => {
    const t = buildRefusalTrace(REFUSAL_REASON.GUEST_GATE, 1, {
      // Cast: the type already forbids these, the runtime must too.
      ...({ query: 'my phone is 0901234567', text: 'secret', body: 'x' } as object),
    });
    expect(Object.keys(t).sort()).toEqual(['agentId', 'reason']);
    expect(JSON.stringify(t)).not.toContain('0901234567');
  });

  it('ignores non-finite numbers and empty strings', () => {
    const t = buildRefusalTrace(REFUSAL_REASON.LOW_CONFIDENCE, 1, {
      threshold: NaN,
      topSimilarity: Infinity,
      actorRole: '',
    });
    expect(t).toEqual({ reason: 'low_confidence', agentId: 1 });
  });
});

describe('buildHandoffTrace', () => {
  it.each([
    ['low_confidence', 'low_confidence'],
    ['moderation_blocked', 'moderation'],
    ['policy', 'policy_deny'],
    ['engine_unavailable', 'engine_unavailable'],
    ['user_request', 'user_request'],
  ])('maps the escalation word %s to the stored reason %s', (escalation, stored) => {
    expect(buildHandoffTrace(escalation, 3)).toEqual({ reason: stored, agentId: 3 });
  });

  it('an unknown escalation word falls back to low_confidence, never to a free-text reason', () => {
    expect(buildHandoffTrace('something_new', 3).reason).toBe('low_confidence');
  });
});
