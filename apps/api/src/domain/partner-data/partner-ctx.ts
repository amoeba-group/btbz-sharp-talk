import { IDENTITY_ROLE } from '@sharptalk/types';
import type { IdentityClaims, IdentityRole } from '@sharptalk/types';
import { envNumber } from '../../global/util/env-number.util';
import { partnerError } from './partner-data.constants';

/**
 * Who a partner-data lookup is for (PLN-261012 SG-31).
 *
 * The brand makes the one rule enforceable by the compiler: `resolve()` takes a
 * `PartnerCtx`, a `PartnerCtx` can only come out of `partnerCtxOf`, and that
 * function only accepts a session whose identity claims were SIGNED and are
 * still fresh. There is no overload that takes a hotel id from a request, a
 * message or a model argument, so "look up hotel 2204 for me" has no code path.
 * (The brand stops accidents, not a hostile commit — code review does that.)
 */
declare const PARTNER_CTX_BRAND: unique symbol;

export interface PartnerCtx {
  readonly [PARTNER_CTX_BRAND]: true;
  readonly tenantId: number;
  /** From the verified claims. The only source of the hotel in any partner request. */
  readonly hotelSn: string;
  readonly role: IdentityRole;
  /** When SharpTalk verified the signed claims (epoch ms). */
  readonly verifiedAtMs: number;
}

/** A session, narrowed to what a lookup may read. */
export interface PartnerSessionLike {
  tenantId: number | null;
  identityClaims: IdentityClaims | null;
}

/** Claims older than this are treated as "signed out" for data lookups (default 8 h = SG-03's IDENTITY_MAX_AGE). */
export const partnerClaimsMaxAgeMs = (): number => envNumber('PARTNER_CLAIMS_MAX_AGE_SEC', 8 * 3600) * 1000;

const HOTEL_SN = /^[A-Za-z0-9_-]{1,32}$/;
const ROLES = new Set<string>(Object.values(IDENTITY_ROLE));

/**
 * SWAP POINT. The claims a lookup may rely on, or why there are none.
 *
 * PLN-261012 SG-03 (stream s1b) introduces a central `effectiveIdentity(session)`
 * that applies the tenant's maximum claim age everywhere. Until it lands this
 * local function does the same job for the partner path: signed, parseable
 * `verifiedAt`, not older than `partnerClaimsMaxAgeMs()`, not from the future.
 * When s1b merges, replace the body with a call to it and keep this signature.
 */
function effectiveClaims(
  session: PartnerSessionLike,
  nowMs: number,
): { claims: IdentityClaims; verifiedAtMs: number } {
  const claims = session.identityClaims;
  if (!claims || claims.signed !== true) throw partnerError.claimsStale('claims_unsigned');
  const verifiedAtMs = Date.parse(claims.verifiedAt);
  if (!Number.isFinite(verifiedAtMs)) throw partnerError.claimsStale('claims_verified_at_invalid');
  // A little clock tolerance, but "verified in the future" is never fresh.
  if (verifiedAtMs > nowMs + 60_000) throw partnerError.claimsStale('claims_from_future');
  if (nowMs - verifiedAtMs > partnerClaimsMaxAgeMs()) throw partnerError.claimsStale('claims_expired');
  return { claims, verifiedAtMs };
}

/**
 * The only constructor of `PartnerCtx`. Throws a classified `PartnerError`
 * (E5102 for anything wrong with the claims) — the chat step catches it and
 * answers with the "please sign in again" notice.
 */
export function partnerCtxOf(session: PartnerSessionLike, nowMs: number = Date.now()): PartnerCtx {
  const { claims, verifiedAtMs } = effectiveClaims(session, nowMs);
  const hotelSn = String(claims.hotelSn ?? '').trim();
  if (!HOTEL_SN.test(hotelSn)) throw partnerError.claimsStale('claims_hotel_invalid');
  if (!ROLES.has(claims.role)) throw partnerError.claimsStale('claims_role_invalid');
  if (session.tenantId == null) throw partnerError.claimsStale('session_without_tenant');
  return { tenantId: Number(session.tenantId), hotelSn, role: claims.role, verifiedAtMs } as PartnerCtx;
}
