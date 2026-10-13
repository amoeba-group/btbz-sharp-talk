import { REFUSAL_REASON } from '@sharptalk/types';
import {
  HANDOFF_REASONS,
  OTHER_REASON,
  PILOT_DEFAULT_WINDOW_DAYS,
  PILOT_GROUP,
  PILOT_MAX_WINDOW_DAYS,
  PILOT_OUTCOME,
  PILOT_SILENT_HOTELS_MAX,
  PILOT_UNKNOWN_KEY,
  REFUSAL_ONLY_REASONS,
  UNKNOWN_REASON,
  UNRECORDED_REASONS,
  addConversation,
  chunk,
  classifyConversation,
  computeAdoption,
  dayKeyIn,
  emptyMessageStats,
  emptyModeration,
  emptyPartner,
  finalizeRow,
  groupKeyOf,
  newAccumulator,
  normalizeStoredReason,
  parseLatencySample,
  resolvePilotWindow,
  sortRows,
  toDate,
  toNumber,
  usableTimeZone,
} from './analytics-pilot.util';
import type { ConversationFacts, ConversationRow } from './analytics-pilot.util';
import { facts, row } from './testing/pilot-fixtures';

/**
 * Pilot analytics definitions (PLN-261012 SG-52). The point of these tests is that the NUMBERS MEAN
 * what the header of analytics-pilot.util.ts says: the pilot is judged on them, and a metric that
 * quietly means something else is worse than no metric.
 */
describe('AI-only resolved vs agent-closed — the definition the existing aiResolutionRate gets wrong', () => {
  it('a conversation the AI answered and nobody touched is AI-only resolved', () => {
    const v = classifyConversation(facts({ messages: { answers: 2 } }));
    expect(v.outcome).toBe(PILOT_OUTCOME.AI_ONLY);
    expect(v.handedOff).toBe(false);
    expect(v.handoffReason).toBeNull();
  });

  it('an AGENT-CLOSED conversation is NOT AI-only resolved, even though resolution.util scores it resolved', () => {
    // The thread ended, an agent wrote in it and closed it: resolution.util says
    // `agent_closed` / resolved = true. For a pilot asking what the AI did by itself that is a hand-off.
    const v = classifyConversation(
      facts({
        row: { status: 'ended', agentAssigned: true, escalated: true },
        messages: { answers: 3, agents: 2 },
      }),
    );
    expect(v.outcome).toBe(PILOT_OUTCOME.HANDOFF);
    expect(v.handedOff).toBe(true);
  });

  it('a human message alone is enough — even with escalated = 0 and no agent_id (an agent that joined a live thread)', () => {
    const v = classifyConversation(facts({ messages: { answers: 1, agents: 1 } }));
    expect(v.handedOff).toBe(true);
    expect(v.outcome).toBe(PILOT_OUTCOME.HANDOFF);
  });

  it('an escalation alone is enough (the customer waited and nobody answered yet)', () => {
    const v = classifyConversation(facts({ row: { escalated: true }, messages: { answers: 1 } }));
    expect(v.outcome).toBe(PILOT_OUTCOME.HANDOFF);
  });

  it('a hand-back to the AI does not erase the hand-off: agent_id cleared, escalated stays 1, the agent message stays', () => {
    const v = classifyConversation(
      facts({ row: { escalated: true, agentAssigned: false, status: 'ai_active' }, messages: { answers: 4, agents: 3 } }),
    );
    expect(v.handedOff).toBe(true);
  });

  it('a stored hand-off notice counts even when the escalation flag was lost (a half-written thread)', () => {
    const v = classifyConversation(
      facts({ reasons: [{ reason: REFUSAL_REASON.LOW_CONFIDENCE, turns: 1, firstId: 9 }], messages: { answers: 1 } }),
    );
    expect(v.handedOff).toBe(true);
    expect(v.handoffReason).toBe('low_confidence');
  });

  it('a sign-in prompt is NOT a hand-off, and not a resolution either: it is "refused"', () => {
    const v = classifyConversation(facts({ reasons: [{ reason: 'guest_gate', turns: 2, firstId: 3 }] }));
    expect(v.handedOff).toBe(false);
    expect(v.outcome).toBe(PILOT_OUTCOME.REFUSED);
    expect(v.refusals).toEqual({ guest_gate: 2 });
  });

  it('small talk with no grounded answer and no refusal is neither resolved nor refused: "no answer"', () => {
    const v = classifyConversation(facts({ messages: { ai: 1, answers: 0 } }));
    expect(v.outcome).toBe(PILOT_OUTCOME.NO_ANSWER);
  });

  it('a grounded answer wins over an earlier refusal in the same conversation (signed in later, then answered)', () => {
    const v = classifyConversation(
      facts({ reasons: [{ reason: 'guest_gate', turns: 1, firstId: 2 }], messages: { answers: 1 } }),
    );
    expect(v.outcome).toBe(PILOT_OUTCOME.AI_ONLY);
    expect(v.refusals).toEqual({ guest_gate: 1 }); // the prompt is still counted
  });
});

describe('hand-off reason', () => {
  it('is the FIRST stored hand-off notice, by message order, not the alphabetically first', () => {
    const v = classifyConversation(
      facts({
        row: { escalated: true },
        reasons: [
          { reason: 'user_request', turns: 1, firstId: 40 },
          { reason: 'engine_unavailable', turns: 1, firstId: 12 },
        ],
      }),
    );
    expect(v.handoffReason).toBe('engine_unavailable');
  });

  it('partner causes are kept apart from generic low confidence', () => {
    const v = classifyConversation(
      facts({ row: { escalated: true }, reasons: [{ reason: 'partner_unavailable', turns: 1, firstId: 5 }] }),
    );
    expect(v.handoffReason).toBe('partner_unavailable');
  });

  it('a notice-only partner refusal is a refusal, not a hand-off', () => {
    const v = classifyConversation(facts({ reasons: [{ reason: 'partner_role_denied', turns: 1, firstId: 5 }] }));
    expect(v.handedOff).toBe(false);
    expect(v.refusals).toEqual({ partner_role_denied: 1 });
  });

  it('falls back to the escalation alert when no notice stored a reason (legacy thread)', () => {
    const v = classifyConversation(facts({ row: { escalated: true }, alertReason: 'moderation_blocked' }));
    expect(v.handoffReason).toBe('moderation'); // the legacy escalation word, mapped
  });

  it('an alert reason that is not a hand-off word does not become the reason', () => {
    const v = classifyConversation(facts({ row: { escalated: true }, alertReason: 'guest_gate' }));
    expect(v.handoffReason).toBe(UNKNOWN_REASON);
  });

  it('an escalation that left no trace anywhere is "unknown", never a guess', () => {
    const v = classifyConversation(facts({ row: { escalated: true } }));
    expect(v.handoffReason).toBe(UNKNOWN_REASON);
  });

  it('a stored notice beats the alert (it is the more precise one)', () => {
    const v = classifyConversation(
      facts({
        row: { escalated: true },
        reasons: [{ reason: 'partner_unverified', turns: 1, firstId: 5 }],
        alertReason: 'low_confidence',
      }),
    );
    expect(v.handoffReason).toBe('partner_unverified');
  });
});

describe('reason vocabulary', () => {
  it('every REFUSAL_REASON member is classified exactly once — a new member forces a decision here', () => {
    const all = Object.values(REFUSAL_REASON);
    for (const reason of all) {
      const inHandoff = HANDOFF_REASONS.has(reason);
      const inRefusal = REFUSAL_ONLY_REASONS.has(reason);
      expect({ reason, classified: inHandoff !== inRefusal }).toEqual({ reason, classified: true });
    }
    // and nothing is classified that the vocabulary does not have (user_request is the one extra word)
    for (const reason of [...HANDOFF_REASONS, ...REFUSAL_ONLY_REASONS]) {
      expect(reason === 'user_request' || all.includes(reason as never)).toBe(true);
    }
  });

  it('the five partner reasons split the way the partner step behaves: notices vs hand-offs', () => {
    expect(REFUSAL_ONLY_REASONS.has('partner_role_denied')).toBe(true);
    expect(REFUSAL_ONLY_REASONS.has('partner_claims_stale')).toBe(true);
    expect(REFUSAL_ONLY_REASONS.has('partner_param_rejected')).toBe(true);
    expect(HANDOFF_REASONS.has('partner_unavailable')).toBe(true);
    expect(HANDOFF_REASONS.has('partner_unverified')).toBe(true);
  });

  it('consent and pilot_denied are declared unrecorded (no row exists to count)', () => {
    expect([...UNRECORDED_REASONS].sort()).toEqual(['consent', 'pilot_denied']);
  });

  it.each([
    ['guest_gate', 'guest_gate'],
    ['  Guest_Gate ', 'guest_gate'],
    ['moderation_blocked', 'moderation'],
    ['policy', 'policy_deny'],
    ['user_request', 'user_request'],
    ['something_a_future_build_adds', OTHER_REASON],
  ])('normalizeStoredReason(%j) -> %s', (raw, expected) => {
    expect(normalizeStoredReason(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['   '], [42], [{ a: 1 }], [['guest_gate']]])(
    'a non-string / blank reason (%j) is null, not a crash',
    (raw) => {
      expect(normalizeStoredReason(raw)).toBeNull();
    },
  );

  it('free text cannot split a chart: an unknown word collapses into "other"', () => {
    expect(normalizeStoredReason('call me on 0901234567')).toBe(OTHER_REASON);
  });
});

describe('window', () => {
  const now = new Date('2026-10-13T10:00:00Z');

  it('defaults to the last 14 days ending now', () => {
    const w = resolvePilotWindow(undefined, undefined, now);
    expect(w).toMatchObject({ ok: true, days: PILOT_DEFAULT_WINDOW_DAYS });
    if (w.ok) {
      expect(w.to.toISOString()).toBe(now.toISOString());
      expect(w.from.toISOString()).toBe('2026-09-29T10:00:00.000Z');
    }
  });

  it('only `to`: the 14 days before it', () => {
    const to = new Date('2026-09-10T00:00:00Z');
    const w = resolvePilotWindow(undefined, to, now);
    expect(w.ok && w.from.toISOString()).toBe('2026-08-27T00:00:00.000Z');
  });

  it('only `from`: from -> now', () => {
    const w = resolvePilotWindow(new Date('2026-10-01T00:00:00Z'), undefined, now);
    expect(w.ok && w.to.toISOString()).toBe(now.toISOString());
  });

  it('accepts exactly the maximum and refuses one day more (an error, never a silent clamp)', () => {
    const to = new Date('2026-10-13T00:00:00Z');
    const at = new Date(to.getTime() - PILOT_MAX_WINDOW_DAYS * 86_400_000);
    const over = new Date(to.getTime() - (PILOT_MAX_WINDOW_DAYS + 1) * 86_400_000);
    expect(resolvePilotWindow(at, to, now)).toMatchObject({ ok: true, days: PILOT_MAX_WINDOW_DAYS });
    expect(resolvePilotWindow(over, to, now)).toEqual({ ok: false, reason: 'too_long' });
  });

  it('an inverted or empty range is invalid', () => {
    const t = new Date('2026-10-01T00:00:00Z');
    expect(resolvePilotWindow(t, new Date('2026-09-01T00:00:00Z'), now)).toEqual({ ok: false, reason: 'invalid' });
    expect(resolvePilotWindow(t, t, now)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a "from" in the future with no "to" is invalid, not an empty report', () => {
    expect(resolvePilotWindow(new Date('2026-11-01T00:00:00Z'), undefined, now)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('grouping', () => {
  const r = (over: Partial<ConversationRow>) => row(over);

  it('hotel / role: the stamp is the key; a missing stamp is the unknown group, never an error', () => {
    expect(groupKeyOf(PILOT_GROUP.HOTEL, r({ hotelSn: '1721' }), 'UTC')).toBe('1721');
    expect(groupKeyOf(PILOT_GROUP.HOTEL, r({ hotelSn: null }), 'UTC')).toBe(PILOT_UNKNOWN_KEY);
    expect(groupKeyOf(PILOT_GROUP.HOTEL, r({ hotelSn: '   ' }), 'UTC')).toBe(PILOT_UNKNOWN_KEY);
    expect(groupKeyOf(PILOT_GROUP.ROLE, r({ actorRole: 'receptionist' }), 'UTC')).toBe('receptionist');
    expect(groupKeyOf(PILOT_GROUP.ROLE, r({ actorRole: null }), 'UTC')).toBe(PILOT_UNKNOWN_KEY);
  });

  it('hotel serials are exact: "HN1" and "hn1" are two hotels', () => {
    expect(groupKeyOf(PILOT_GROUP.HOTEL, r({ hotelSn: 'HN1' }), 'UTC')).not.toBe(
      groupKeyOf(PILOT_GROUP.HOTEL, r({ hotelSn: 'hn1' }), 'UTC'),
    );
  });

  it('day is drawn in the tenant timezone: 20:00 UTC is already tomorrow in Ho Chi Minh', () => {
    const at = new Date('2026-10-12T20:00:00Z');
    expect(groupKeyOf(PILOT_GROUP.DAY, r({ createdAt: at }), 'UTC')).toBe('2026-10-12');
    expect(groupKeyOf(PILOT_GROUP.DAY, r({ createdAt: at }), 'Asia/Ho_Chi_Minh')).toBe('2026-10-13');
  });

  it('an unusable timezone falls back to UTC instead of throwing', () => {
    expect(dayKeyIn(new Date('2026-10-12T20:00:00Z'), 'Not/AZone')).toBe('2026-10-12');
    expect(usableTimeZone('Not/AZone')).toBe('UTC');
    expect(usableTimeZone(null)).toBe('UTC');
    expect(usableTimeZone(' Asia/Seoul ')).toBe('Asia/Seoul');
  });
});

describe('accumulation', () => {
  const add = (acc: ReturnType<typeof newAccumulator>, f: ConversationFacts) => addConversation(acc, f, classifyConversation(f));

  it('the four outcomes partition the conversations — for the row and for the total', () => {
    const acc = newAccumulator('1721');
    add(acc, facts({ messages: { answers: 1 } })); // ai only
    add(acc, facts({ messages: { answers: 1 } })); // ai only
    add(acc, facts({ row: { escalated: true } })); // hand-off
    add(acc, facts({ reasons: [{ reason: 'auth_gate', turns: 1, firstId: 1 }] })); // refused
    add(acc, facts({})); // no answer
    const out = finalizeRow(acc);
    expect(out.conversations).toBe(5);
    expect(out.aiOnlyResolved + out.handedOff + out.refused + out.noAnswer).toBe(out.conversations);
    expect(out).toMatchObject({ aiOnlyResolved: 2, handedOff: 1, refused: 1, noAnswer: 1 });
    expect(out.aiOnlyResolvedRate).toBe(0.4);
    expect(out.handoffRate).toBe(0.2);
  });

  it('counts hand-offs by reason per CONVERSATION and refusals per TURN, and keeps the two apart', () => {
    const acc = newAccumulator('x');
    add(acc, facts({ row: { escalated: true }, reasons: [{ reason: 'low_confidence', turns: 3, firstId: 4 }] }));
    add(acc, facts({ row: { escalated: true }, reasons: [{ reason: 'low_confidence', turns: 1, firstId: 4 }] }));
    add(acc, facts({ row: { escalated: true }, reasons: [{ reason: 'user_request', turns: 1, firstId: 4 }] }));
    add(acc, facts({ reasons: [{ reason: 'guest_gate', turns: 3, firstId: 4 }] }));
    add(acc, facts({ reasons: [{ reason: 'guest_gate', turns: 2, firstId: 4 }, { reason: 'role_manager_only', turns: 1, firstId: 9 }] }));
    const out = finalizeRow(acc);
    expect(out.handoffReasons).toEqual({ low_confidence: 2, user_request: 1 });
    expect(out.refusals).toEqual({ guest_gate: 5, role_manager_only: 1 });
    expect(out.guestGatePrompts).toBe(5);
    expect(out.roleManagerOnly).toBe(1);
  });

  it('average confidence and no-source rate are per ANSWER, not per conversation', () => {
    const acc = newAccumulator('x');
    add(acc, facts({ messages: { answers: 3, confidenceSum: 2.1, noSource: 1 } }));
    add(acc, facts({ messages: { answers: 1, confidenceSum: 0.5, noSource: 1 } }));
    const out = finalizeRow(acc);
    expect(out.answers).toBe(4);
    expect(out.avgConfidence).toBe(0.65);
    expect(out.noSourceRate).toBe(0.5);
    expect(out.noSourceAnswers).toBe(2);
  });

  it('no answers at all: the averages are null, not 0 and not NaN', () => {
    const out = finalizeRow(newAccumulator('x'));
    expect(out).toMatchObject({ conversations: 0, aiOnlyResolvedRate: null, handoffRate: null, avgConfidence: null, noSourceRate: null });
    expect(out.csat).toEqual({ rated: 0, avg: null });
  });

  it('CSAT averages the ratings given and says how many there were', () => {
    const acc = newAccumulator('x');
    add(acc, facts({ row: { csatRating: 5 } }));
    add(acc, facts({ row: { csatRating: 4 } }));
    add(acc, facts({ row: { csatRating: null } }));
    const out = finalizeRow(acc);
    expect(out.csat).toEqual({ rated: 2, avg: 4.5 });
  });

  it('moderation blocked / edited are summed from the conversations', () => {
    const acc = newAccumulator('x');
    add(acc, facts({ moderation: { blocked: 2, edited: 1 } }));
    add(acc, facts({ moderation: { blocked: 0, edited: 3 } }));
    expect(finalizeRow(acc).moderation).toEqual({ blocked: 2, edited: 4 });
  });

  it('distinct users counts customers once however often they chat; guests are counted as sessions, separately', () => {
    const acc = newAccumulator('x');
    add(acc, facts({ row: { customerId: 7, sessionId: 1 } }));
    add(acc, facts({ row: { customerId: 7, sessionId: 2 } }));
    add(acc, facts({ row: { customerId: 8, sessionId: 3 } }));
    add(acc, facts({ row: { customerId: null, sessionId: 4 } }));
    add(acc, facts({ row: { customerId: null, sessionId: 4 } }));
    const out = finalizeRow(acc);
    expect(out.distinctUsers).toBe(2);
    expect(out.anonymousSessions).toBe(1);
    // counts only: nothing in the row carries an id
    expect(JSON.stringify(out)).not.toMatch(/"customerId"|"sessionId"/);
  });

  it('partner lookups: totals, outcomes and topics', () => {
    const acc = newAccumulator('x');
    add(acc, facts({ partner: { ...emptyPartner(), lookups: 3, ok: 2, denied: 1, topics: { rates: 2, settlement: 1 } } }));
    add(acc, facts({ partner: { ...emptyPartner(), lookups: 2, unavailable: 1, unverified: 1, topics: { rates: 2 } } }));
    expect(finalizeRow(acc).partner).toEqual({
      lookups: 5, ok: 2, denied: 1, rejected: 0, unavailable: 1, unverified: 1, topics: { rates: 4, settlement: 1 },
    });
  });

  it('finalizing copies: a later fold does not rewrite a row that was already returned', () => {
    const acc = newAccumulator('x');
    add(acc, facts({ row: { escalated: true }, reasons: [{ reason: 'low_confidence', turns: 1, firstId: 1 }] }));
    const first = finalizeRow(acc);
    add(acc, facts({ row: { escalated: true }, reasons: [{ reason: 'low_confidence', turns: 1, firstId: 1 }] }));
    expect(first.handoffReasons).toEqual({ low_confidence: 1 });
  });
});

describe('latency percentiles per group', () => {
  it('P50 / P95 per stage over the AI turns of the group, nearest-rank', () => {
    const acc = newAccumulator('x');
    const samples = Array.from({ length: 20 }, (_, i) => ({
      total: (i + 1) * 100, classify: 50, retrieve: null, generate: (i + 1) * 80, moderate: 10,
    }));
    const f = facts({ latencies: samples });
    addConversation(acc, f, classifyConversation(f));
    const out = finalizeRow(acc);
    expect(out.latency.total).toMatchObject({ count: 20, p50: 1000, p95: 1900, max: 2000 });
    expect(out.latency.generate).toMatchObject({ count: 20, p50: 800, p95: 1520 });
    expect(out.latency.classify).toMatchObject({ count: 20, p50: 50, p95: 50 });
  });

  it('a stage that did not run is absent from its percentile — a replayed answer is not an instant retrieval', () => {
    const acc = newAccumulator('x');
    const f = facts({ latencies: [{ total: 900, classify: 100, retrieve: null, generate: null, moderate: 20 }] });
    addConversation(acc, f, classifyConversation(f));
    const out = finalizeRow(acc);
    expect(out.latency.retrieve).toEqual({ count: 0, p50: null, p95: null, max: null });
    expect(out.latency.generate.count).toBe(0);
    expect(out.latency.total.count).toBe(1);
  });

  it('a group with no latency at all (legacy rows) reports nulls, not zeros', () => {
    const out = finalizeRow(newAccumulator('x'));
    for (const stage of ['total', 'classify', 'retrieve', 'generate', 'moderate'] as const) {
      expect(out.latency[stage]).toEqual({ count: 0, p50: null, p95: null, max: null });
    }
  });

  it('ignores negative and non-finite samples instead of letting them poison a percentile', () => {
    const acc = newAccumulator('x');
    const f = facts({
      latencies: [
        { total: -5, classify: NaN, retrieve: Infinity, generate: 300, moderate: null },
        { total: 400, classify: null, retrieve: null, generate: null, moderate: null },
      ],
    });
    addConversation(acc, f, classifyConversation(f));
    const out = finalizeRow(acc);
    expect(out.latency.total).toMatchObject({ count: 1, p50: 400 });
    expect(out.latency.generate).toMatchObject({ count: 1, p50: 300 });
    expect(out.latency.classify.count).toBe(0);
  });

  it('parseLatencySample reads whatever the driver returns for a JSON number, and drops an empty object', () => {
    expect(parseLatencySample({ total: 1200, classify: '300', retrieve: null, generate: 'x', moderate: undefined })).toEqual({
      total: 1200, classify: 300, retrieve: null, generate: null, moderate: null,
    });
    expect(parseLatencySample({ total: null, classify: null })).toBeNull();
  });
});

describe('row order', () => {
  const mk = (key: string, conversations: number) => finalizeRow({ ...newAccumulator(key), conversations });
  it('hotel / role by volume, the unknown group after real keys on a tie', () => {
    const rows = sortRows(PILOT_GROUP.HOTEL, [mk('b', 5), mk('unknown', 5), mk('a', 5), mk('c', 9)]);
    expect(rows.map((r) => r.key)).toEqual(['c', 'a', 'b', 'unknown']);
  });
  it('day chronologically', () => {
    const rows = sortRows(PILOT_GROUP.DAY, [mk('2026-10-03', 9), mk('2026-10-01', 1), mk('2026-10-02', 5)]);
    expect(rows.map((r) => r.key)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });
});

describe('adoption — hotels active vs the pilot list', () => {
  it('"Active 9 / pilot list 12" and which listed hotels never chatted', () => {
    const listed = Array.from({ length: 12 }, (_, i) => String(1700 + i));
    const active = listed.slice(0, 9);
    const a = computeAdoption(true, listed, active);
    expect(a).toMatchObject({ pilotEnabled: true, listed: 12, listedActive: 9, listedSilent: 3, hotelsActive: 9, offListActive: 0 });
    expect(a.silentHotels).toEqual(['1709', '1710', '1711']);
  });

  it('a hotel that chatted but is not on the list is counted separately — it must not make adoption look better', () => {
    const a = computeAdoption(false, ['1', '2'], ['1', '99']);
    expect(a).toMatchObject({ listed: 2, listedActive: 1, listedSilent: 1, hotelsActive: 2, offListActive: 1 });
    expect(a.silentHotels).toEqual(['2']);
  });

  it('an empty list: nothing is silent, every active hotel is off-list', () => {
    expect(computeAdoption(false, [], ['1', '2'])).toMatchObject({ listed: 0, listedSilent: 0, offListActive: 2, silentHotels: [] });
  });

  it('serials are compared exactly (case and leading zeros matter, like the allowlist gate)', () => {
    const a = computeAdoption(true, ['HN1', '01721'], ['hn1', '1721']);
    expect(a.listedActive).toBe(0);
    expect(a.listedSilent).toBe(2);
    expect(a.offListActive).toBe(2);
  });

  it('duplicates on the list do not inflate it', () => {
    expect(computeAdoption(true, ['1', '1', '2'], []).listed).toBe(2);
  });

  it('names at most PILOT_SILENT_HOTELS_MAX hotels but counts them all, in natural order', () => {
    const listed = Array.from({ length: PILOT_SILENT_HOTELS_MAX + 50 }, (_, i) => String(i + 1));
    const a = computeAdoption(true, listed, []);
    expect(a.listedSilent).toBe(PILOT_SILENT_HOTELS_MAX + 50);
    expect(a.silentHotels).toHaveLength(PILOT_SILENT_HOTELS_MAX);
    expect(a.silentHotels.slice(0, 3)).toEqual(['1', '2', '3']); // numeric order, not '1','10','100'
  });
});

describe('driver value helpers', () => {
  it('toNumber', () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber('4.5')).toBe(4.5);
    expect(toNumber('')).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber({})).toBeNull();
  });
  it('toDate', () => {
    expect(toDate(new Date('2026-10-01T00:00:00Z'))?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(toDate('2026-10-01T00:00:00Z')?.getTime()).toBe(Date.parse('2026-10-01T00:00:00Z'));
    expect(toDate('garbage')).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(toDate(new Date('x'))).toBeNull();
  });
  it('chunk', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it('empty stat builders are fresh objects (no shared mutable state)', () => {
    expect(emptyMessageStats()).not.toBe(emptyMessageStats());
    expect(emptyModeration()).not.toBe(emptyModeration());
    expect(emptyPartner().topics).not.toBe(emptyPartner().topics);
  });
});
