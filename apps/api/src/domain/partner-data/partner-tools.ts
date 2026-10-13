import type { IdentityRole } from '@sharptalk/types';
import type { AiToolDef } from '../../infrastructure/external/ai/ai-adapter.interface';
import { PARTNER_TOPIC } from './partner-data.constants';
import type { PartnerTopic } from './partner-data.constants';
import type { ParamSpec } from './partner-params.util';
import { TopicRegistry } from './partner-topics';
import type { TopicDef } from './partner-topics';

/**
 * The lookup tools a model may call in tools mode (PLN-261012 SG-33) — DERIVED from the
 * `TopicRegistry`, never written by hand next to it:
 *
 *  - one tool per registered topic, named `lookup_<topic>`;
 *  - the input schema is built from the topic's CLOSED parameter set (`TopicDef.params`) and nothing
 *    else, with `additionalProperties: false`. There is no property through which a hotel — or a
 *    tenant, partner, branch … — could be named, because the topic has none: the hotel comes from the
 *    signed claims on the server (`PartnerCtx`) and is not part of any tool's vocabulary;
 *  - a role is only OFFERED the tools its topics allow (least privilege). That is a convenience for
 *    the model, not the control: `PartnerDataService.resolve` enforces the same allow-list on every
 *    call, so a model that names a tool it was not offered (or one a role may not read) is refused
 *    server-side exactly like a prefetch.
 *
 * The only hand-written part is prose: what each topic and parameter MEANS to a model. A test pins
 * that every topic and every parameter has some, so adding a topic cannot ship a blank tool. The
 * prose never says "hotel": the schema must read as "this account's own data", with no handle to
 * point elsewhere.
 */

export const PARTNER_TOOL_PREFIX = 'lookup_';

export const partnerToolName = (topic: PartnerTopic | string): string => `${PARTNER_TOOL_PREFIX}${topic}`;

/** The topic a tool name stands for, or null for anything the server does not offer. */
export function topicOfTool(name: string, registry: TopicRegistry = new TopicRegistry()): PartnerTopic | null {
  if (typeof name !== 'string' || !name.startsWith(PARTNER_TOOL_PREFIX)) return null;
  const topic = name.slice(PARTNER_TOOL_PREFIX.length);
  return registry.topics().includes(topic as PartnerTopic) ? (topic as PartnerTopic) : null;
}

export const TOPIC_HELP: Record<PartnerTopic, string> = {
  [PARTNER_TOPIC.POLICIES]:
    "Read-only. The signed-in account's current cancellation, refund and check-in/check-out policies, " +
    'including fees. Use for questions about how cancellations, refunds or check-in times work.',
  [PARTNER_TOPIC.RATES]:
    "Read-only. The signed-in account's room rates with the full price breakdown (base, extras, discounts, " +
    'final). Narrow by room type, rate type or date when the question names them.',
  [PARTNER_TOPIC.BOOKINGS]:
    "Read-only. The signed-in account's bookings. Use EITHER bookingCode (one booking) OR checkInFrom + " +
    'checkInTo (a check-in date range of at most 31 days, optionally with status/page/size) — never both, never neither.',
  [PARTNER_TOPIC.SETTLEMENT]:
    "Read-only. The signed-in account's settlement statements (gross, commission, deductions, net, paid, " +
    'outstanding) by month. Narrow by period (YYYY-MM) or status when the question names them.',
};

export const PARAM_HELP: Record<string, string> = {
  'policies.type': 'Which policy: cancellation, refund or checkin_out. Omit for all of them.',
  'rates.roomType': 'Room type code as written in the question, e.g. DELUXE.',
  'rates.rateType': 'hourly, overnight or daily. Omit for all.',
  'rates.date': 'Stay date, YYYY-MM-DD (local date). Omit for today.',
  'bookings.bookingCode': 'One booking code (6-24 letters, digits or dashes).',
  'bookings.checkInFrom': 'First check-in date of the range, YYYY-MM-DD. Requires checkInTo.',
  'bookings.checkInTo': 'Last check-in date of the range, YYYY-MM-DD. Requires checkInFrom.',
  'bookings.status': 'confirmed, checked_in, checked_out, cancelled or no_show. Range lookups only.',
  'bookings.page': 'Page number, from 1. Range lookups only.',
  'bookings.size': 'Page size, 1-50. Range lookups only.',
  'settlement.period': 'Settlement month, YYYY-MM. Omit for all periods.',
  'settlement.status': 'pending, paid or disputed.',
  'settlement.page': 'Page number, from 1.',
  'settlement.size': 'Page size, 1-50.',
};

/** One parameter's JSON Schema, from the same `ParamSpec` the server validates it with. */
export function paramSchema(spec: ParamSpec, description: string): Record<string, unknown> {
  switch (spec.kind) {
    case 'enum':
      return { type: 'string', enum: [...spec.values], description };
    case 'pattern':
      return { type: 'string', pattern: spec.pattern.source, description };
    case 'date':
      return { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description };
    case 'month':
      return { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description };
    case 'int':
      return { type: 'integer', minimum: spec.min, maximum: spec.max, description };
  }
}

export function toolFor(def: TopicDef): AiToolDef {
  const properties: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(def.params)) {
    properties[key] = paramSchema(spec, PARAM_HELP[`${def.topic}.${key}`] ?? '');
  }
  return {
    name: partnerToolName(def.topic),
    description: TOPIC_HELP[def.topic] ?? '',
    // No `required` (every parameter is optional) and no top-level oneOf (the providers reject it):
    // the cross-field rules live in the description and are enforced by the server (`TopicDef.refine`).
    inputSchema: { type: 'object', properties, additionalProperties: false },
  };
}

/** The tools offered to a role: every registered topic the role may read. */
export function buildPartnerTools(role: IdentityRole, registry: TopicRegistry = new TopicRegistry()): AiToolDef[] {
  return registry
    .topics()
    .map((t) => registry.get(t))
    .filter((def) => registry.allows(def, role))
    .map(toolFor);
}
