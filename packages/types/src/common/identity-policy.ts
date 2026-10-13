/**
 * Per-tenant policy for the signed identity a host app hands the widget
 * (`tenants.identity_policy`, PLN-261012 SG-03 / SG-04).
 *
 * Both fields are opt-in or have a platform default, and a tenant with no stored
 * policy behaves exactly as the platform default says:
 *  - `maxAgeHours` overrides how long signed claims stay trusted (platform default
 *    `IDENTITY_MAX_AGE_HOURS`, 8). Older claims are treated as a guest until the
 *    host signs again.
 *  - `refuseV1` rejects `identify` calls that carry no claims. A v1 signature
 *    (HMAC of the user id alone) never expires and cannot say which hotel or role
 *    the person acts for, so a tenant that has moved to v2 can switch it off.
 */
export interface IdentityPolicy {
  maxAgeHours?: number | null;
  refuseV1?: boolean;
}

/** Bounds the console and the API accept for `maxAgeHours` (whole hours). */
export const IDENTITY_MAX_AGE_HOURS_MIN = 1;
export const IDENTITY_MAX_AGE_HOURS_MAX = 720;

/**
 * Coerce stored or submitted input into a policy, or `null` when it carries no
 * setting at all — NULL in the column means "never configured", which must read
 * as today's behaviour. A malformed or out-of-range `maxAgeHours` is dropped
 * rather than trusted: an hour count of 0 or 1e9 would silently switch the
 * expiry off, which is the one thing this field must not be able to do by accident.
 */
export function normalizeIdentityPolicy(input: unknown): IdentityPolicy | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const hours = Number(raw.maxAgeHours);
  const maxAgeHours =
    raw.maxAgeHours != null &&
    Number.isInteger(hours) &&
    hours >= IDENTITY_MAX_AGE_HOURS_MIN &&
    hours <= IDENTITY_MAX_AGE_HOURS_MAX
      ? hours
      : null;
  const refuseV1 = raw.refuseV1 === true;
  if (maxAgeHours == null && !refuseV1) return null;
  return {
    ...(maxAgeHours != null ? { maxAgeHours } : {}),
    ...(refuseV1 ? { refuseV1: true } : {}),
  };
}
