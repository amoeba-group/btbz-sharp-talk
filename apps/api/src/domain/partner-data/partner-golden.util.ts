import { IDENTITY_ROLE } from '@sharptalk/types';
import type { IdentityRole } from '@sharptalk/types';

/**
 * The partner context a golden question runs under (PLN-261012 SG-31): which
 * hotel and role it pretends to be signed in as, and which fixture set answers.
 * Stored on `golden_questions.partner_ctx`.
 */
export interface GoldenPartnerCtx {
  hotelSn: string;
  role: IdentityRole;
  /** Name of a fixture set in MOCK_SETS; default `default`. */
  mockSet?: string;
}

const HOTEL_SN = /^[A-Za-z0-9_-]{1,32}$/;
const MOCK_SET_NAME = /^[a-z0-9_-]{1,32}$/;

/** Keep only a well-formed partner context; anything else is dropped, never stored. */
export function sanitizePartnerCtx(raw: unknown): GoldenPartnerCtx | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const hotelSn = typeof r.hotelSn === 'string' ? r.hotelSn.trim() : '';
  const role = typeof r.role === 'string' ? r.role.trim().toLowerCase() : '';
  const mockSet = typeof r.mockSet === 'string' && r.mockSet.trim() ? r.mockSet.trim().toLowerCase() : 'default';
  if (!HOTEL_SN.test(hotelSn)) return null;
  if (!(Object.values(IDENTITY_ROLE) as string[]).includes(role)) return null;
  if (!MOCK_SET_NAME.test(mockSet)) return null;
  return { hotelSn, role: role as IdentityRole, mockSet };
}

/**
 * The flat snake_case request fields (`partner_hotel_sn`, `partner_role`,
 * `partner_mock_set`) as a raw context for `sanitizePartnerCtx`.
 * `undefined` = the request did not mention it (leave as is); `null` = an empty
 * hotel, i.e. clear the context.
 */
export function partnerCtxFromBody(body: {
  partner_hotel_sn?: string;
  partner_role?: string;
  partner_mock_set?: string;
}): Record<string, unknown> | null | undefined {
  if (body.partner_hotel_sn === undefined) return undefined;
  if (!body.partner_hotel_sn.trim()) return null;
  return { hotelSn: body.partner_hotel_sn, role: body.partner_role, mockSet: body.partner_mock_set };
}
