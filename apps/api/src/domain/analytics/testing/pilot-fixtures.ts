import {
  emptyMessageStats,
  emptyModeration,
  emptyPartner,
} from '../analytics-pilot.util';
import type {
  ConversationFacts,
  ConversationRow,
  LatencySample,
  MessageStats,
  ModerationStat,
  PartnerStat,
  ReasonStat,
} from '../analytics-pilot.util';

/**
 * Test builders for the pilot analytics (PLN-261012 SG-52). Excluded from the production build by
 * the `**\/testing/**` rule of tsconfig.build.json.
 */

let nextId = 1000;

/** A conversation row with sane defaults: a fresh, un-escalated, un-rated thread of one signed hotel user. */
export function row(over: Partial<ConversationRow> = {}): ConversationRow {
  nextId += 1;
  return {
    id: nextId,
    createdAt: new Date('2026-10-10T08:00:00Z'),
    hotelSn: '1721',
    actorRole: 'receptionist',
    aiAgentId: 3,
    escalated: false,
    agentAssigned: false,
    status: 'ai_active',
    csatRating: null,
    sessionId: nextId + 5000,
    customerId: null,
    language: 'VI',
    ...over,
  };
}

export interface FactsOverrides {
  row?: Partial<ConversationRow>;
  messages?: Partial<MessageStats>;
  reasons?: ReasonStat[];
  moderation?: Partial<ModerationStat>;
  partner?: Partial<PartnerStat>;
  latencies?: LatencySample[];
  alertReason?: string | null;
}

export function facts(over: FactsOverrides = {}): ConversationFacts {
  return {
    row: row(over.row),
    messages: { ...emptyMessageStats(), ...over.messages },
    reasons: over.reasons ?? [],
    moderation: { ...emptyModeration(), ...over.moderation },
    partner: { ...emptyPartner(), ...over.partner },
    latencies: over.latencies ?? [],
    alertReason: over.alertReason ?? null,
  };
}
