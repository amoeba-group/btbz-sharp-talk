import {
  PILOT_NOTE_MAX_LENGTH,
  SESSION_IDENTITY,
  normalizeHotelSn,
} from '@sharptalk/types';
import type { IdentityClaims, PilotAccess } from '@sharptalk/types';

/**
 * Reason recorded when a turn is refused for pilot scope (PLN-261012 SG-40). It
 * is the `pilot_denied` member of the REFUSAL_REASON taxonomy the plan (SG-50)
 * defines; kept as a literal here until that enum lands so the two cannot be
 * confused with a free-text reason.
 */
export const PILOT_DENIED = 'pilot_denied' as const;

/** The fields of a session the allowlist reads — nothing else about it matters. */
export interface PilotSessionView {
  identityLevel?: string | null;
  identityClaims?: IdentityClaims | null;
}

/**
 * The hotel this session is signed in for, or null when it is not signed in for
 * one. The ONLY source the allowlist trusts.
 *
 * Null (→ treated as a guest) for every way the claim cannot be relied on:
 *   - no claims at all: a guest, or a v1 identity (user id only, no hotel);
 *   - `signed` is not literally true: the claim rode along unsigned (a display
 *     name is not a key);
 *   - the session is not at the verified identity level;
 *   - the claim is older than `maxAgeHours` (a tenant that bounds how long a
 *     signature stays good — the identity policy). An unparseable `verifiedAt`
 *     counts as expired rather than as fresh.
 *
 * `hotelName` / `hotelCode` are display-only and never consulted.
 *
 * s1b (PLN-261012 SG-03/04) introduces the shared `effectiveIdentity` helper for
 * the same question; this is the small local stand-in the pilot gate was told to
 * use, so swapping it is one call site. `maxAgeHours` null/undefined = the claim
 * never expires on its own, which is the behaviour before a policy exists.
 */
export function signedHotelOf(
  session: PilotSessionView,
  opts: { now?: Date; maxAgeHours?: number | null } = {},
): string | null {
  const claims = session.identityClaims;
  if (!claims || claims.signed !== true) return null;
  if (session.identityLevel !== SESSION_IDENTITY.VERIFIED) return null;
  const hotelSn = typeof claims.hotelSn === 'string' ? claims.hotelSn.trim() : '';
  if (!hotelSn) return null;

  const maxAge = opts.maxAgeHours;
  if (typeof maxAge === 'number' && Number.isFinite(maxAge) && maxAge > 0) {
    const verifiedAt = Date.parse(String(claims.verifiedAt ?? ''));
    const now = (opts.now ?? new Date()).getTime();
    if (!Number.isFinite(verifiedAt) || now - verifiedAt > maxAge * 3_600_000) return null;
  }
  return hotelSn;
}

export interface PilotVerdict {
  /** The tenant has a pilot list in force and this session is subject to it. */
  applies: boolean;
  allowed: boolean;
  /** Who the rule saw: a signed hotel, or a visitor with none. Null when it does not apply. */
  audience: 'hotel' | 'guest' | null;
  hotelSn: string | null;
}

const NOT_APPLICABLE: PilotVerdict = { applies: false, allowed: true, audience: null, hotelSn: null };

/**
 * The whole rule, pure. `hotels` are the ACTIVE serials of the tenant.
 *
 *   feature off / never configured     → not applicable, served as before
 *   signed hotel                       → served iff it is on the list
 *   no signed hotel (guest, v1, stale) → served iff `guestAllowed`
 *
 * A hotel that is signed but absent from the list is NEVER rescued by
 * `guestAllowed`: that switch is about visitors who have not identified, and
 * letting an identified non-pilot hotel through it would make the list optional.
 */
export function decidePilot(
  cfg: PilotAccess | null,
  hotels: ReadonlySet<string> | readonly string[],
  hotelSn: string | null,
): PilotVerdict {
  if (!cfg || !cfg.enabled) return NOT_APPLICABLE;
  if (hotelSn == null) {
    return { applies: true, allowed: cfg.guestAllowed, audience: 'guest', hotelSn: null };
  }
  const listed = hotels instanceof Set ? hotels.has(hotelSn) : (hotels as readonly string[]).includes(hotelSn);
  return { applies: true, allowed: listed, audience: 'hotel', hotelSn };
}

// ---- list import (paste / CSV) --------------------------------------------

/** One data line of a pasted list or CSV, parsed. */
export interface ParsedHotelRow {
  /** 1-based line number in the pasted text, for the "line 7 is not a serial" message. */
  line: number;
  /** The first field as typed — shown back when it is not a valid serial. */
  raw: string;
  hotelSn: string | null;
  note: string | null;
}

/** Most data lines one request may carry — the list's own ceiling. */
export const PILOT_IMPORT_MAX_ROWS = 5000;
/** Bytes-ish ceiling on the pasted text; 5000 rows of serial + note fit well under it. */
export const PILOT_IMPORT_MAX_CHARS = 500_000;

/** First-row cells that mean "this is the header, not a hotel". */
const HEADER_CELLS = new Set(['hotel_sn', 'hotelsn', 'hotel sn', 'hotel_serial', 'serial', 'sn']);

/**
 * Split one line into at most two fields: the serial and the note.
 *
 * Delimiter: a tab if there is one, else the first comma or semicolon, else the
 * first run of whitespace — so a spreadsheet column, `1721,batch 1` and the
 * console's own `1721  Del Luna` all read the same way. The FIRST field is always
 * the serial and everything after the delimiter is the note, however it looks:
 * guessing that "1721, 2204, 3307" means three hotels would silently turn a note
 * into a hotel, and the preview exists precisely so nothing is guessed.
 * Double quotes around a field are honoured (`"1721","a, b"`).
 */
export function splitHotelLine(line: string): [string, string] {
  const trimmed = line.trim();
  const tab = trimmed.indexOf('\t');
  let at = -1;
  if (tab >= 0) at = tab;
  else {
    // A comma/semicolon inside a quoted first field is not the delimiter.
    let inQuotes = false;
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (c === ',' || c === ';')) {
        at = i;
        break;
      }
    }
  }
  if (at < 0) {
    const m = /^(\S+)\s+([\s\S]*)$/.exec(trimmed);
    return m ? [unquote(m[1]), unquote(m[2].trim())] : [unquote(trimmed), ''];
  }
  return [unquote(trimmed.slice(0, at).trim()), unquote(trimmed.slice(at + 1).trim())];
}

function unquote(value: string): string {
  const m = /^"(.*)"$/s.exec(value);
  return m ? m[1].replace(/""/g, '"') : value;
}

/**
 * Parse pasted text / a CSV file into rows. Blank lines and `#` comments are
 * skipped, a leading UTF-8 BOM is dropped (Excel writes one), and a first row
 * whose first cell is a known header name (`hotel_sn`, …) is skipped as the
 * header. The result may be empty — the caller decides that is an error.
 */
export function parseHotelInput(text: string): { rows: ParsedHotelRow[]; headerSkipped: boolean } {
  const lines = String(text ?? '')
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/);
  const rows: ParsedHotelRow[] = [];
  let headerSkipped = false;
  let sawData = false;
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const [first, note] = splitHotelLine(line);
    if (!sawData) {
      sawData = true;
      if (HEADER_CELLS.has(first.toLowerCase())) {
        headerSkipped = true;
        return;
      }
    }
    rows.push({
      line: index + 1,
      raw: first,
      hotelSn: normalizeHotelSn(first),
      note: note ? note.slice(0, PILOT_NOTE_MAX_LENGTH) : null,
    });
  });
  return { rows, headerSkipped };
}

export type PilotImportStatus = 'added' | 'reactivated' | 'existing' | 'duplicate' | 'invalid';

export interface PilotImportRowPlan {
  line: number;
  hotelSn: string | null;
  raw: string;
  note: string | null;
  status: PilotImportStatus;
}

export interface PilotImportPlan {
  rows: PilotImportRowPlan[];
  counts: Record<PilotImportStatus, number>;
}

/**
 * Decide what each parsed row would do, against the serials already stored
 * (`existing` maps serial → whether it is active). First occurrence wins: a
 * serial repeated later in the same input is a `duplicate` and does nothing, a
 * serial already listed and active is `existing`, one that is listed but paused
 * is `reactivated` (importing a hotel again is a clear "I want it on"), anything
 * else is `added`. Pure, so the dry-run and the real import cannot disagree.
 */
export function planHotelImport(
  rows: readonly ParsedHotelRow[],
  existing: ReadonlyMap<string, boolean>,
): PilotImportPlan {
  const counts: Record<PilotImportStatus, number> = {
    added: 0,
    reactivated: 0,
    existing: 0,
    duplicate: 0,
    invalid: 0,
  };
  const seen = new Set<string>();
  const plan: PilotImportRowPlan[] = rows.map((row) => {
    let status: PilotImportStatus;
    if (!row.hotelSn) status = 'invalid';
    else if (seen.has(row.hotelSn)) status = 'duplicate';
    else {
      seen.add(row.hotelSn);
      const known = existing.get(row.hotelSn);
      status = known === undefined ? 'added' : known ? 'existing' : 'reactivated';
    }
    counts[status] += 1;
    return { line: row.line, hotelSn: row.hotelSn, raw: row.raw, note: row.note, status };
  });
  return { rows: plan, counts };
}
