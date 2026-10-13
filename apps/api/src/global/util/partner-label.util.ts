import type { IdentityClaims } from '@sharptalk/types';

/**
 * Short partner label for alert channels and ticket notes (REQ-261006 H4):
 * "Hotel Name (hotelSn) · role", or undefined for a guest, a v1 identity or claims that
 * are not signed. One place, so the escalation alert and the unclaimed re-alert
 * (PLN-261012 SG-63) cannot word it differently.
 */
export function partnerLabelOfClaims(
  claims: Pick<IdentityClaims, 'signed' | 'hotelSn' | 'hotelName' | 'role'> | null | undefined,
): string | undefined {
  if (!claims?.signed || !claims.hotelSn) return undefined;
  const name = claims.hotelName?.trim() || 'hotel';
  return `${name} (${claims.hotelSn}) · ${claims.role}`;
}
