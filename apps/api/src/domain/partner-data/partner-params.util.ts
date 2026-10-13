import { partnerError } from './partner-data.constants';

/**
 * Closed parameter sets for partner-data topics (PLN-261012 SG-31).
 *
 * "Closed" is the point: a topic accepts exactly the keys its spec names, each
 * with a fixed shape, and nothing else. In particular there is no key through
 * which a hotel can be chosen — the hotel comes from the signed claims — so a
 * `hotelSn` / `hotel_id` / `propertyId`-looking key (however it is cased or
 * punctuated) is refused with its own reason instead of being quietly ignored.
 * Ignoring it would be the dangerous reading: the caller believes they asked
 * about another hotel, and gets (and may repeat) their own.
 */

export type ParamSpec =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'pattern'; pattern: RegExp }
  /** YYYY-MM-DD, a real calendar date. */
  | { kind: 'date' }
  /** YYYY-MM. */
  | { kind: 'month' }
  | { kind: 'int'; min: number; max: number };

/** A validated, normalised query: scalar values only, keys sorted. */
export type PartnerQuery = Record<string, string | number>;

/**
 * Keys that name a hotel/tenant/partner scope in any spelling. Tested on the key
 * lower-cased with everything but letters and digits removed, so `hotel_id`,
 * `Hotel-SN`, `hotelSn`, `hotel sn`, `propertyID` and `x-hotel` all match.
 */
const HOTEL_SCOPE_KEY =
  /hotel|propert|accommodation|lodging|tenant|partner|branch|merchant|outlet|shopid|storeid|^sn$|^hsn$|serial/;

export function looksLikeHotelScopeKey(key: string): boolean {
  return HOTEL_SCOPE_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

/** True for a real YYYY-MM-DD (rejects 2026-02-30, which Date would roll forward). */
export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function valueOf(spec: ParamSpec, key: string, raw: unknown): string | number {
  if (spec.kind === 'int') {
    const n = typeof raw === 'string' && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < spec.min || n > spec.max) {
      throw partnerError.paramRejected('param_invalid', { keys: [key] });
    }
    return n;
  }
  if (typeof raw !== 'string') throw partnerError.paramRejected('param_type', { keys: [key] });
  const v = raw.trim();
  switch (spec.kind) {
    case 'enum': {
      const lower = v.toLowerCase();
      if (!spec.values.includes(lower)) throw partnerError.paramRejected('param_invalid', { keys: [key] });
      return lower;
    }
    case 'pattern':
      if (!spec.pattern.test(v)) throw partnerError.paramRejected('param_invalid', { keys: [key] });
      return v;
    case 'date':
      if (!isCalendarDate(v)) throw partnerError.paramRejected('param_invalid', { keys: [key] });
      return v;
    case 'month':
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw partnerError.paramRejected('param_invalid', { keys: [key] });
      return v;
  }
}

/**
 * Validate `raw` against a closed `specs` map. Throws PARTNER_PARAM_REJECTED
 * (E5104) with a reason of `hotel_param`, `unknown_param`, `param_type`,
 * `param_invalid` or `params_not_object`. The error detail carries KEYS only —
 * never values — so it is safe to log.
 */
export function validateParams(raw: unknown, specs: Record<string, ParamSpec>): PartnerQuery {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw partnerError.paramRejected('params_not_object');

  const keys = Object.keys(raw as object);
  // Hotel-scoped keys first, and all of them at once: the log line then says
  // exactly which attempt it was, and nothing partial is ever used.
  const hotelKeys = keys.filter(looksLikeHotelScopeKey);
  if (hotelKeys.length) throw partnerError.paramRejected('hotel_param', { keys: hotelKeys.slice(0, 5) });

  const unknown = keys.filter((k) => !Object.prototype.hasOwnProperty.call(specs, k));
  if (unknown.length) throw partnerError.paramRejected('unknown_param', { keys: unknown.slice(0, 5) });

  const out: PartnerQuery = {};
  for (const key of keys.sort()) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === '') continue;
    out[key] = valueOf(specs[key], key, value);
  }
  return out;
}
