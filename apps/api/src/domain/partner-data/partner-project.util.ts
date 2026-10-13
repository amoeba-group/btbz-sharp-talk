import { PARTNER_TEXT_MAX, partnerError } from './partner-data.constants';
import { isCalendarDate } from './partner-params.util';

/**
 * Field-level validators for the topic projectors (PLN-261012 SG-31).
 *
 * A projector reads an upstream payload through these and builds a NEW object
 * from the fields it names — so anything upstream adds (a guest's name, a
 * phone number, an internal note) is dropped by construction, which is the PII
 * minimisation, and a malformed field becomes PARTNER_RESPONSE_INVALID instead
 * of a malformed prompt.
 */

export function asObject(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw partnerError.invalid('field_not_object', { field });
  return v as Record<string, unknown>;
}

export function asArray(v: unknown, field: string, max = 200): unknown[] {
  if (!Array.isArray(v)) throw partnerError.invalid('field_not_array', { field });
  if (v.length > max) throw partnerError.invalid('array_too_long', { field });
  return v;
}

export function asInt(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw partnerError.invalid('field_not_int', { field });
  }
  return v;
}

export function asIntOpt(v: unknown, field: string, min: number, max: number): number | undefined {
  return v === undefined || v === null ? undefined : asInt(v, field, min, max);
}

export function asEnum<T extends string>(v: unknown, values: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    throw partnerError.invalid('field_not_in_enum', { field });
  }
  return v as T;
}

/** "HH:mm", 24 h. */
export function asClock(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw partnerError.invalid('field_not_clock', { field });
  return v;
}

export function asClockOpt(v: unknown, field: string): string | undefined {
  return v === undefined || v === null ? undefined : asClock(v, field);
}

export function asDate(v: unknown, field: string): string {
  if (typeof v !== 'string' || !isCalendarDate(v)) throw partnerError.invalid('field_not_date', { field });
  return v;
}

export function asDateOpt(v: unknown, field: string): string | undefined {
  return v === undefined || v === null ? undefined : asDate(v, field);
}

/** ISO 8601 date-time with an offset; returned as given so the offset the hotel uses is kept. */
export function asDateTime(v: unknown, field: string): string {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) ||
    Number.isNaN(Date.parse(v))
  ) {
    throw partnerError.invalid('field_not_datetime', { field });
  }
  return v;
}

export function asDateTimeOpt(v: unknown, field: string): string | undefined {
  return v === undefined || v === null ? undefined : asDateTime(v, field);
}

/** An opaque identifier (booking code, room type code, payout reference). */
export function asCode(v: unknown, field: string, pattern: RegExp): string {
  if (typeof v !== 'string' || !pattern.test(v)) throw partnerError.invalid('field_not_code', { field });
  return v;
}

/**
 * Words that frame the prompt's data block. A policy note that contained them
 * could close the block early and start writing instructions; they are removed
 * from every free text we accept.
 */
const DELIMITERS =
  /PARTNER_DATA_START|PARTNER_DATA_END|PARTNER_DATA|PARTNER_CONTEXT|CONTEXT_START|CONTEXT_END|CUSTOMER_ORDERS_START|CUSTOMER_ORDERS_END|CITED\s*:/gi;

/**
 * Free text from the partner (a policy note, a room name). It is UNTRUSTED —
 * it ends up inside the prompt — so control characters and the block
 * delimiters are stripped, whitespace is collapsed and the length is capped.
 * The prompt additionally states that the block is data, not instructions.
 */
export function cleanText(v: unknown, max = PARTNER_TEXT_MAX): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']+', 'g'), ' ')
    .replace(DELIMITERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function cleanTextOpt(v: unknown, max = PARTNER_TEXT_MAX): string | undefined {
  const t = cleanText(v, max);
  return t || undefined;
}
