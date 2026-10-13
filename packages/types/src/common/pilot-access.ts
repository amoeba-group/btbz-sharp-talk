/**
 * Pilot allowlist by hotel (PLN-261012 SG-40, REQ §3.5).
 *
 * Go2Joy opens the agent to a short list of hotels first and widens it as the
 * pilot goes well. The list is keyed by the signed `hotelSn` (see
 * `IdentityClaims`), never by anything the visitor typed, and it is enforced by
 * the SERVER on every turn — the widget hiding itself is a courtesy on top, not
 * the control.
 *
 * Two stores carry it, on purpose:
 *   - `tenants.pilot_access` (JSON, this file): the switch and how a hotel that
 *     is not on the list is treated;
 *   - `tenant_pilot_hotels` (a table): the list itself, because it needs CSV
 *     import, per-row audit and a size beyond what a JSON column should hold.
 *
 * NULL / absent `pilot_access` = never configured = the feature does not exist
 * for that tenant, which is every tenant today.
 */

import { SESSION_LANGUAGE_CODES, type SessionLanguage } from './language';

/** What a hotel that is not on the list sees. */
export const PILOT_NON_PILOT = { HIDE: 'hide', NOTICE: 'notice' } as const;
export type PilotNonPilot = (typeof PILOT_NON_PILOT)[keyof typeof PILOT_NON_PILOT];

export interface PilotAccess {
  /** Off = the tenant behaves exactly as it did before this feature existed. */
  enabled: boolean;
  /**
   * Visitors with no signed hotel (the login page, a v1 identity, an expired
   * identity). Default true: the sign-in help page is where a partner who is not
   * yet logged in lands, and hiding it there would hide the way in.
   */
  guestAllowed: boolean;
  /** `hide` removes the widget; `notice` keeps the launcher and shows a note. */
  nonPilot: PilotNonPilot;
  /** Per-language note for `notice` (and for the chat reply). Blank = built-in copy. */
  notice: Partial<Record<SessionLanguage, string>>;
}

export const PILOT_ACCESS_DEFAULTS: PilotAccess = {
  enabled: false,
  guestAllowed: true,
  nonPilot: PILOT_NON_PILOT.HIDE,
  notice: {},
};

/** A notice is one or two sentences; anything longer is a pasted document. */
export const PILOT_NOTICE_MAX_LENGTH = 500;
/** Most hotels one tenant may list. Far above a pilot, below "load it all". */
export const PILOT_HOTEL_LIMIT = 5000;
/** The longest note a hotel row may carry. */
export const PILOT_NOTE_MAX_LENGTH = 255;
/** `hotelSn` as the host signs it: a serial such as `1721`; alphanumerics tolerated. */
export const PILOT_HOTEL_SN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * A hotel serial as stored and compared: trimmed text. Compared EXACTLY — no
 * case folding, no leading-zero stripping — because the signed claim is compared
 * the same way and "1721" and "01721" are different keys to the host.
 * Null = not a usable serial.
 */
export function normalizeHotelSn(value: unknown): string | null {
  let text: string;
  if (typeof value === 'string') text = value.trim();
  else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) text = String(value);
  else return null;
  return PILOT_HOTEL_SN_PATTERN.test(text) ? text : null;
}

function normalizeNotice(value: unknown): Partial<Record<SessionLanguage, string>> {
  if (!value || typeof value !== 'object') return {};
  const out: Partial<Record<SessionLanguage, string>> = {};
  for (const lang of SESSION_LANGUAGE_CODES) {
    const raw = (value as Record<string, unknown>)[lang];
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (text) out[lang] = text.slice(0, PILOT_NOTICE_MAX_LENGTH);
  }
  return out;
}

/**
 * The stored shape, defaults filled in. Null when nothing was ever stored, so a
 * caller can tell "never configured" from "configured and switched off". Unknown
 * keys, unknown languages and out-of-range values are dropped rather than
 * trusted: the API refuses them at save time, so this is only the last line.
 */
export function readPilotAccess(stored: unknown): PilotAccess | null {
  if (!stored || typeof stored !== 'object') return null;
  const raw = stored as Partial<PilotAccess>;
  return {
    enabled: raw.enabled === true,
    guestAllowed: raw.guestAllowed !== false,
    nonPilot: raw.nonPilot === PILOT_NON_PILOT.NOTICE ? PILOT_NON_PILOT.NOTICE : PILOT_NON_PILOT.HIDE,
    notice: normalizeNotice(raw.notice),
  };
}

/** The tenant's own note for this language, or null → use the built-in wording. */
export function pilotNoticeFor(
  access: Pick<PilotAccess, 'notice'> | null | undefined,
  language: string | null | undefined,
): string | null {
  const key = String(language ?? '').toUpperCase() as SessionLanguage;
  return access?.notice?.[key]?.trim() || null;
}

/**
 * What the widget learns from `POST /session/ensure`, `/public/embed/identify`
 * and `/session/pilot` (SG-40). `eligible` is a tri-state:
 *   - `null`  — the tenant does not use a pilot list: show the widget as always;
 *   - `true`  — this visitor may be served;
 *   - `false` — they may not; `mode` says whether to hide or show `notice`.
 * `mode` and `notice` accompany `false` only (the notice is resolved for the
 * session language, tenant wording first, so the widget carries no copy of it).
 */
export interface PilotStatus {
  eligible: boolean | null;
  mode?: PilotNonPilot;
  notice?: string;
}
