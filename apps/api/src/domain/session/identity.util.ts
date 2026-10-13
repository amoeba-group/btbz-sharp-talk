import { SESSION_IDENTITY, normalizeIdentityPolicy } from '@sharptalk/types';
import type { IdentityClaims, IdentityPolicy, SessionIdentity } from '@sharptalk/types';
import type { Session } from './entity/session.entity';

/**
 * Signed identity, as a decision-maker should see it (PLN-261012 SG-03, REQ D-04).
 *
 * `identify` v2 stores the host's signed claims on the session together with the
 * moment we verified them (`verifiedAt`). Until now they were trusted for the life
 * of the session row — a receptionist who left the desk on Monday was still
 * "signed in" on Tuesday. Every place that DECIDES something from the identity
 * (the guest gate, the partner line in the prompt, region routing, the console
 * header, the order-auth gate, scenario audience) therefore asks
 * `effectiveIdentity()` instead of reading `session.identityClaims` /
 * `identityLevel` directly: claims older than the max age read as a guest.
 *
 * What is NOT aged: sessions without signed claims. A v1 identify (HMAC of the
 * user id alone), a Shopify app-proxy login and a Cafe24 login carry no
 * `verifiedAt` to age, and those platforms keep their own session lifecycle.
 * `identity_policy.refuseV1` is the lever for a tenant that wants v1 gone.
 */

const HOUR_MS = 3_600_000;

/** Platform default: one shift. Overridable with `IDENTITY_MAX_AGE_HOURS`. */
export const IDENTITY_MAX_AGE_HOURS_DEFAULT = 8;

/**
 * Platform max age in ms, or `null` when expiry is switched off.
 *
 * `IDENTITY_MAX_AGE_HOURS=0` is the operator kill switch (a bad rollout must be
 * reversible without a deploy). Anything that is not a plain non-negative number
 * falls back to the default — a typo must never switch a security control off.
 */
export function platformMaxAgeMs(raw: string | undefined = process.env.IDENTITY_MAX_AGE_HOURS): number | null {
  if (raw == null || String(raw).trim() === '') return IDENTITY_MAX_AGE_HOURS_DEFAULT * HOUR_MS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return IDENTITY_MAX_AGE_HOURS_DEFAULT * HOUR_MS;
  return hours === 0 ? null : hours * HOUR_MS;
}

/** Tenant override first (validated), then the platform default. `null` = never expires. */
export function resolveMaxAgeMs(
  policy: IdentityPolicy | null | undefined,
  rawEnv?: string,
): number | null {
  const hours = normalizeIdentityPolicy(policy)?.maxAgeHours;
  if (hours != null) return hours * HOUR_MS;
  return platformMaxAgeMs(rawEnv);
}

/** The identity facts a session may be acted on with right now. */
export interface EffectiveIdentity {
  level: SessionIdentity;
  /** Signed claims still in force; null for guests, v1 identities and lapsed claims. */
  claims: IdentityClaims | null;
  /** The bound customer, or null when the claims that bound it have lapsed. */
  customerId: number | null;
  /** True when the session HAS signed claims and they are older than the max age. */
  expired: boolean;
  /** When the claims lapse / lapsed (ISO 8601); null without signed claims or with expiry off. */
  expiresAt: string | null;
}

type IdentitySource = Pick<Session, 'identityClaims'> &
  Partial<Pick<Session, 'identityLevel' | 'customerId'>>;

/**
 * What the session may be treated as at `nowMs`.
 *
 * Fail-closed on a signed claim whose `verifiedAt` cannot be read: a stored value
 * we cannot date is one we cannot vouch for, so it reads as lapsed. The boundary is
 * "strictly older than the max age" — a claim exactly at the limit is still valid.
 * A `verifiedAt` in the future (clock skew between instances) is not aged.
 */
export function effectiveIdentity(
  session: IdentitySource,
  policy?: IdentityPolicy | null,
  nowMs: number = Date.now(),
  rawEnv?: string,
): EffectiveIdentity {
  const stored: SessionIdentity =
    session.identityLevel === SESSION_IDENTITY.VERIFIED ? SESSION_IDENTITY.VERIFIED : SESSION_IDENTITY.GUEST;
  const customerId = session.customerId != null ? Number(session.customerId) : null;
  const claims = session.identityClaims ?? null;

  // Nothing signed to age: report the stored identity untouched.
  if (!claims?.signed) {
    return { level: stored, claims, customerId, expired: false, expiresAt: null };
  }

  const maxAgeMs = resolveMaxAgeMs(policy, rawEnv);
  if (maxAgeMs == null) {
    return { level: stored, claims, customerId, expired: false, expiresAt: null };
  }

  const verifiedMs = Date.parse(String(claims.verifiedAt ?? ''));
  if (!Number.isFinite(verifiedMs)) {
    return { level: SESSION_IDENTITY.GUEST, claims: null, customerId: null, expired: true, expiresAt: null };
  }

  const expiresMs = verifiedMs + maxAgeMs;
  const expiresAt = new Date(expiresMs).toISOString();
  if (nowMs - verifiedMs > maxAgeMs) {
    return { level: SESSION_IDENTITY.GUEST, claims: null, customerId: null, expired: true, expiresAt };
  }
  return { level: stored, claims, customerId, expired: false, expiresAt };
}

/**
 * Reads a tenant's identity policy through a short per-instance cache.
 *
 * The policy is consulted on hot paths (every chat message, every widget poll of a
 * signed session) and changes a few times a year, so each service keeps its own
 * 15 s view instead of adding a tenant read per request. A console edit therefore
 * takes effect within that window. A failed read is NOT cached and reads as "no
 * policy" — the platform default applies, which is the safe direction (expiry on).
 */
export class IdentityPolicyCache {
  private readonly entries = new Map<number, { at: number; policy: IdentityPolicy | null }>();

  constructor(
    private readonly load: (tenantId: number) => Promise<unknown>,
    private readonly ttlMs = 15_000,
  ) {}

  async get(tenantId: number | null | undefined): Promise<IdentityPolicy | null> {
    if (tenantId == null) return null;
    const hit = this.entries.get(tenantId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.policy;
    try {
      const policy = normalizeIdentityPolicy(await this.load(tenantId));
      this.entries.set(tenantId, { at: Date.now(), policy });
      return policy;
    } catch {
      return null;
    }
  }

  /** Forget a tenant — for the writer that just changed its policy in this process. */
  invalidate(tenantId: number): void {
    this.entries.delete(tenantId);
  }
}
