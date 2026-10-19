/**
 * Satisfaction survey vocabulary (PLN-261019-Csat-Survey-Disclosure).
 *
 * `rating` is the one-question emoji card every tenant has had; `survey` adds
 * "was it resolved?" before the rating and, for an unhappy rating, a reason.
 * The reason codes are fixed platform-wide so the statistics stay comparable
 * across tenants and languages; the labels are widget i18n.
 */
export const CSAT_MODE = { RATING: 'rating', SURVEY: 'survey' } as const;
export type CsatMode = (typeof CSAT_MODE)[keyof typeof CSAT_MODE];
export const CSAT_MODE_VALUES = Object.values(CSAT_MODE) as CsatMode[];

export const CSAT_REASON = {
  UNCLEAR: 'unclear',
  SLOW: 'slow',
  NO_RESPONSE: 'no_response',
  SOFTWARE_ERROR: 'software_error',
  OTHER: 'other',
} as const;
export type CsatReason = (typeof CSAT_REASON)[keyof typeof CSAT_REASON];
export const CSAT_REASON_VALUES = Object.values(CSAT_REASON) as CsatReason[];

/** A reason is asked only below this rating (Figma: "Rất không hài lòng" / "Không hài lòng"). */
export const CSAT_REASON_MAX_RATING = 2;
export const CSAT_COMMENT_MAX_CHARS = 50;
