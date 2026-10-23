/**
 * Tenants whose host may identify users WITHOUT a signature, as 'claimed'
 * (PLN-261022 unsigned). A stop-gap while a host builds its signing endpoint:
 * comma-separated tenant ids in EMBED_UNSIGNED_IDENTIFY_TENANT_IDS, set on
 * staging only. Unset or empty = nobody.
 *
 * Read per call (not cached) so the identify path, the thread gate and the
 * session response always agree on the same container env.
 */
export function unsignedIdentifyAllowed(tenantId: number | string | null | undefined): boolean {
  if (tenantId == null) return false;
  const id = Number(tenantId);
  return String(process.env.EMBED_UNSIGNED_IDENTIFY_TENANT_IDS ?? '')
    .split(',')
    .map((v) => v.trim())
    .some((v) => v !== '' && Number(v) === id);
}

/**
 * Whether a session may see its account's earlier conversations at all (the
 * tenant's continuity switch is checked separately): a verified customer, or
 * — on a tenant allowed to send unsigned identities — a claimed user id
 * (PLN-261022 P7). One rule for the session response and the thread endpoint.
 */
export function threadEligible(session: {
  tenantId?: number | null;
  customerId?: number | null;
  identityLevel?: string | null;
  identityAttributes?: Record<string, string> | null;
}): boolean {
  if (session.identityLevel === 'verified' && session.customerId != null) return true;
  return claimedUserId(session) != null && unsignedIdentifyAllowed(session.tenantId);
}

/** The user id a claimed session's host gave, or null for any other session. */
export function claimedUserId(session: {
  identityLevel?: string | null;
  identityAttributes?: Record<string, string> | null;
}): string | null {
  if (session.identityLevel !== 'claimed') return null;
  const id = session.identityAttributes?.user_id?.trim();
  return id ? id : null;
}
