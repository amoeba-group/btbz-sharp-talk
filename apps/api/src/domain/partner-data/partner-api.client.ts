import type { PartnerCtx } from './partner-ctx';
import type { PartnerApiMode, PartnerTopic } from './partner-data.constants';
import { partnerError } from './partner-data.constants';
import type { PartnerQuery } from './partner-params.util';

/**
 * The reply shape every topic shares (docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml
 * `Envelope`). `data` stays `unknown` here on purpose: only the topic's own
 * projector, after the envelope checks, turns it into something the rest of the
 * code may read — so an unvalidated field can never reach the prompt.
 */
export interface PartnerEnvelope {
  apiVersion: string;
  /** Echo of the hotel the reply is about — compared with the context before anything else. */
  hotelSn: string;
  topic: string;
  generatedAt: string;
  data: unknown;
}

/**
 * Where partner data comes from. Two implementations: fixtures (`mock`) and the
 * real HTTP client (`live`).
 *
 * The hotel is deliberately NOT a parameter of `get`: it is read from `ctx`
 * (branded, built from verified claims) inside the client, which is the only
 * place that puts it on the wire. `query` is the topic's already-validated
 * closed parameter set.
 *
 * Returns `null` for "nothing there for this hotel" (HTTP 404 `not_found`) —
 * an answer, not a failure. Everything else that goes wrong throws a classified
 * `PartnerError`.
 */
export interface PartnerApiClient {
  readonly mode: PartnerApiMode;
  get(ctx: PartnerCtx, topic: PartnerTopic, query: PartnerQuery): Promise<PartnerEnvelope | null>;
}

/** DI token for the active client (chosen by PARTNER_API_MODE). */
export const PARTNER_API_CLIENT = Symbol('PARTNER_API_CLIENT');

/**
 * Structural check of the envelope and — before anything else — the echoed
 * hotel. A reply about a different hotel than the one we asked for is dropped
 * here, so a routing or caching bug on either side cannot put another hotel's
 * numbers in front of this user.
 */
export function validateEnvelope(raw: unknown, ctx: PartnerCtx, topic: PartnerTopic): PartnerEnvelope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw partnerError.invalid('envelope_not_object');
  const e = raw as Record<string, unknown>;
  if (typeof e.hotelSn !== 'string' && typeof e.hotelSn !== 'number') throw partnerError.invalid('envelope_no_hotel');
  // String() so a numeric 1721 from upstream still matches the "1721" claim.
  if (String(e.hotelSn) !== ctx.hotelSn) {
    throw partnerError.invalid('hotel_echo_mismatch', { topic });
  }
  if (e.topic !== topic) throw partnerError.invalid('envelope_topic_mismatch', { topic });
  if (typeof e.apiVersion !== 'string' || !e.apiVersion) throw partnerError.invalid('envelope_no_version');
  if (typeof e.generatedAt !== 'string' || Number.isNaN(Date.parse(e.generatedAt))) {
    throw partnerError.invalid('envelope_no_timestamp');
  }
  if (e.data === undefined || e.data === null || typeof e.data !== 'object') {
    throw partnerError.invalid('envelope_no_data');
  }
  return {
    apiVersion: e.apiVersion,
    hotelSn: String(e.hotelSn),
    topic,
    generatedAt: e.generatedAt,
    data: e.data,
  };
}
