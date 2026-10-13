import { HttpStatus } from '@nestjs/common';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import type { ErrorCodeEntry } from '../../global/constant/error-code.constant';

/**
 * Partner data lookup (PLN-261012 SG-30/31/32).
 *
 * The assistant answers a signed-in hotel user's questions about THEIR hotel's
 * live policies, rates, bookings and settlement. Everything in this module
 * exists to keep one property true: the hotel the data is read for comes from
 * identity claims our server verified — never from anything a user (or a model)
 * typed.
 */

/** The closed set of topics. A topic that is not here cannot be looked up. */
export const PARTNER_TOPIC = {
  POLICIES: 'policies',
  RATES: 'rates',
  BOOKINGS: 'bookings',
  SETTLEMENT: 'settlement',
} as const;
export type PartnerTopic = (typeof PARTNER_TOPIC)[keyof typeof PARTNER_TOPIC];

export const PARTNER_TOPICS = Object.values(PARTNER_TOPIC) as PartnerTopic[];

/** Which backend serves the lookups: fixtures, or the real HTTP API. */
export type PartnerApiMode = 'mock' | 'live';

/** Outcome stored in partner_lookup_logs.status. */
export const PARTNER_LOOKUP_STATUS = {
  OK: 'ok',
  /** Role not allowed / claims unusable — nothing was requested. */
  DENIED: 'denied',
  /** Parameters outside the closed schema — nothing was requested. */
  REJECTED: 'rejected',
  /** Upstream down, throttled, unconfigured, or the reply was unusable. */
  ERROR: 'error',
  /** Data was fetched but the drafted answer failed number verification. */
  UNVERIFIED: 'unverified',
} as const;
export type PartnerLookupStatus = (typeof PARTNER_LOOKUP_STATUS)[keyof typeof PARTNER_LOOKUP_STATUS];

/**
 * Reasons recorded on the customer-facing message trace (`reason`) when the
 * partner step refuses or degrades a turn. Kept as a closed set so the refusal
 * analytics of SG-50 can fold them into REFUSAL_REASON without guessing.
 */
export const PARTNER_REFUSAL_REASON = {
  ROLE_DENIED: 'partner_role_denied',
  CLAIMS_STALE: 'partner_claims_stale',
  PARAM_REJECTED: 'partner_param_rejected',
  UNAVAILABLE: 'partner_unavailable',
  UNVERIFIED: 'partner_unverified',
} as const;
export type PartnerRefusalReason = (typeof PARTNER_REFUSAL_REASON)[keyof typeof PARTNER_REFUSAL_REASON];

/**
 * An expected, classified failure of a lookup. Never escapes to the customer:
 * PartnerDataService turns it into a result, the step turns that into a notice.
 */
export class PartnerError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(
    readonly entry: ErrorCodeEntry,
    /** Short machine reason for the log (never user text). */
    readonly reason: string,
    httpStatus: number = HttpStatus.BAD_GATEWAY,
    /** Keys/ids that explain the rejection — must already be safe to log. */
    readonly detail?: Record<string, unknown>,
  ) {
    super(`${entry.code} ${reason}`);
    this.name = 'PartnerError';
    this.code = entry.code;
    this.httpStatus = httpStatus;
  }
}

export const partnerError = {
  unavailable: (reason: string, detail?: Record<string, unknown>) =>
    new PartnerError(ERROR_CODE.PARTNER_API_UNAVAILABLE, reason, HttpStatus.BAD_GATEWAY, detail),
  roleDenied: (reason: string, detail?: Record<string, unknown>) =>
    new PartnerError(ERROR_CODE.PARTNER_ROLE_DENIED, reason, HttpStatus.FORBIDDEN, detail),
  claimsStale: (reason: string, detail?: Record<string, unknown>) =>
    new PartnerError(ERROR_CODE.PARTNER_CLAIMS_STALE, reason, HttpStatus.UNAUTHORIZED, detail),
  topicUnknown: (reason: string, detail?: Record<string, unknown>) =>
    new PartnerError(ERROR_CODE.PARTNER_TOPIC_UNKNOWN, reason, HttpStatus.BAD_REQUEST, detail),
  paramRejected: (reason: string, detail?: Record<string, unknown>) =>
    new PartnerError(ERROR_CODE.PARTNER_PARAM_REJECTED, reason, HttpStatus.BAD_REQUEST, detail),
  invalid: (reason: string, detail?: Record<string, unknown>) =>
    new PartnerError(ERROR_CODE.PARTNER_RESPONSE_INVALID, reason, HttpStatus.BAD_GATEWAY, detail),
  notConfigured: (reason: string, detail?: Record<string, unknown>) =>
    new PartnerError(ERROR_CODE.PARTNER_NOT_CONFIGURED, reason, HttpStatus.SERVICE_UNAVAILABLE, detail),
  unverified: (reason: string, detail?: Record<string, unknown>) =>
    new PartnerError(ERROR_CODE.PARTNER_ANSWER_UNVERIFIED, reason, HttpStatus.UNPROCESSABLE_ENTITY, detail),
  rateLimited: (reason: string, detail?: Record<string, unknown>) =>
    new PartnerError(ERROR_CODE.PARTNER_RATE_LIMITED, reason, HttpStatus.TOO_MANY_REQUESTS, detail),
};

/** Longest free text from the partner we let into a prompt (it is untrusted). */
export const PARTNER_TEXT_MAX = 300;

/** Items of a list topic that go into the data block (the rest is summarised as a count). */
export const PARTNER_LIST_MAX = 10;
