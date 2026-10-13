import { scrubPii } from '../../global/util/pii-scrub.util';
import { PILOT_EXPORT_MAX_ROWS } from './analytics-pilot.util';
import type { ConversationFacts, ConversationVerdict } from './analytics-pilot.util';

/**
 * CSV export of pilot conversations for MANUAL accuracy grading (PLN-261012 SG-52).
 *
 * One row per conversation, stable column order, UTF-8 WITH a byte-order mark (Excel opens a BOM-less
 * UTF-8 CSV as the system ANSI code page and turns every Vietnamese diacritic into mojibake — the
 * whole reason this export exists is a human reading Vietnamese answers).
 *
 * Two things this file refuses to do:
 *  - put PII into the file. The transcript is the customer's own words plus the AI's answers, so it
 *    goes through the same `scrubPii` that guards AI egress (emails, phones, cards, order refs,
 *    street addresses), plus the export-specific passes below (long ids, booking codes, URL query
 *    strings). The row itself carries no customer id, name or contact field at all.
 *  - let a cell be executed. A cell that starts with `=`, `+`, `-`, `@`, TAB or CR is a formula in
 *    Excel/Sheets ("CSV injection"); a customer who types `=HYPERLINK(...)` must not be able to run
 *    it on a grader's machine, so such cells get a leading apostrophe.
 */

/** UTF-8 byte-order mark — written once, first. */
export const CSV_BOM = '﻿';

/** The columns, in the order they are written. A change here is a change to a file people grade by hand. */
export const PILOT_CSV_COLUMNS = [
  'conversation_id',
  'started_at',
  'hotel_sn',
  'role',
  'ai_agent_id',
  'language',
  'outcome',
  'handoff_reason',
  'refusals',
  'csat',
  'message_count',
  'avg_confidence',
  'transcript',
] as const;

/** Each message is cut to this many characters (a pasted document is not a chat turn). */
export const TRANSCRIPT_MESSAGE_MAX_CHARS = 1_200;
/** A whole transcript — Excel's cell limit is 32 767 characters; this leaves room for the quoting. */
export const TRANSCRIPT_MAX_CHARS = 20_000;
/** Messages shown per conversation; the rest are summarised as a count. */
export const TRANSCRIPT_MAX_MESSAGES = 120;

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell. Numbers pass through; strings are formula-guarded, then quoted when they need it. */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One record, CRLF-terminated (RFC 4180; Excel is happiest with it). */
export function csvLine(cells: ReadonlyArray<string | number | null | undefined>): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

/** The first bytes of the file: the BOM, then the header record. */
export function pilotCsvHeader(): string {
  return CSV_BOM + csvLine(PILOT_CSV_COLUMNS);
}

/** Last record of a capped file, so a grader who never saw the response headers still knows. */
export function pilotCsvTruncationLine(cap: number = PILOT_EXPORT_MAX_ROWS): string {
  const cells: string[] = PILOT_CSV_COLUMNS.map(() => '');
  cells[0] = '#truncated';
  cells[1] = `the export stops at ${cap} conversations — narrow the date range or filter by hotel/role`;
  return csvLine(cells);
}

// ---- transcript ------------------------------------------------------------------------------

/** A customer-side URL keeps its path; the query string and fragment (tokens, ids) go. */
const URL_QUERY_RE = /(https?:\/\/[^\s?#]+)[?#]\S*/gi;
/**
 * A phone written with spaces, dots or dashes in ANY grouping ("0901 234 567", "090.123.4567", "+84 90 1234567"):
 * a leading 0 / +84 and 8-10 more digits. The shared scrubber only knows the 3-3-4 Vietnamese grouping, and the
 * common 4-3-3 one is exactly what a hotel receptionist types — this file leaves the system, so it is closed here
 * rather than by widening the shared AI-egress scrubber (whose behaviour other gates are tuned against).
 */
const PHONE_LIKE_RE = /(?<![\w.])(?:\+84|0)(?:[ .-]?\d){8,10}(?!\d)/g;
/** 9+ digits in a row (an id, an unformatted phone number). Amounts with separators never match. */
const LONG_DIGITS_RE = /\b\d{9,}\b/g;
/** A code mixing letters and 5+ digits (BK1234567, HTL-20261013-01): a booking / transaction id. */
const MIXED_CODE_RE = /\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d{5,})[A-Za-z0-9_-]{6,}\b/g;

/**
 * The text of one message, safe to hand to a grader. `scrubPii` first (the shared minimiser), then the
 * passes that only make sense for a file that leaves the system: ids, booking codes, URL queries.
 * Plain money amounts and short numbers (rates, counts) are KEPT — grading a partner-data answer
 * is the point, and a figure is not an identifier.
 */
export function scrubTranscriptText(text: string): string {
  if (!text) return '';
  let out = scrubPii(text).text;
  out = out.replace(PHONE_LIKE_RE, '[PHONE]');
  out = out.replace(URL_QUERY_RE, '$1');
  out = out.replace(LONG_DIGITS_RE, '[ID]');
  out = out.replace(MIXED_CODE_RE, '[ID]');
  return out;
}

export interface TranscriptMessage {
  id: number;
  senderType: string;
  body: string;
  /** Closed-vocabulary reason on a system turn, when it has one. */
  reason?: string | null;
  /** Grounding confidence of an AI answer. */
  confidence?: number | null;
}

const SENDER_LABEL: Record<string, string> = { user: 'USER', ai: 'AI', agent: 'AGENT', system: 'SYSTEM' };

/**
 * The conversation as lines `LABEL [note]: text`: the note is the AI's confidence or the system turn's
 * reason, both machine values, so a grader sees WHY the bot said what it said without the trace.
 */
export function buildTranscript(messages: readonly TranscriptMessage[]): string {
  const lines: string[] = [];
  let length = 0;
  let shown = 0;
  for (const m of messages) {
    if (shown >= TRANSCRIPT_MAX_MESSAGES || length >= TRANSCRIPT_MAX_CHARS) break;
    const label = SENDER_LABEL[m.senderType] ?? String(m.senderType).toUpperCase().slice(0, 8);
    const note =
      m.senderType === 'ai' && typeof m.confidence === 'number' && Number.isFinite(m.confidence)
        ? ` [${m.confidence.toFixed(2)}]`
        : m.senderType === 'system' && m.reason
          ? ` [${String(m.reason).replace(/[^a-z0-9_]/gi, '').slice(0, 40)}]`
          : '';
    let body = scrubTranscriptText(String(m.body ?? '')).replace(/\s+/g, ' ').trim();
    if (body.length > TRANSCRIPT_MESSAGE_MAX_CHARS) body = `${body.slice(0, TRANSCRIPT_MESSAGE_MAX_CHARS)}…`;
    const line = `${label}${note}: ${body}`;
    lines.push(line);
    length += line.length + 1;
    shown += 1;
  }
  const hidden = messages.length - shown;
  if (hidden > 0) lines.push(`… (${hidden} more messages not shown)`);
  let transcript = lines.join('\n');
  if (transcript.length > TRANSCRIPT_MAX_CHARS) transcript = `${transcript.slice(0, TRANSCRIPT_MAX_CHARS)}…`;
  return transcript;
}

// ---- row ---------------------------------------------------------------------------------------

/** `reason:turns;reason:turns`, keys sorted so two exports of the same data are byte-identical. */
function refusalsCell(refusals: Record<string, number>): string {
  return Object.keys(refusals)
    .sort()
    .map((k) => `${k}:${refusals[k]}`)
    .join(';');
}

/** One conversation → one record, in {@link PILOT_CSV_COLUMNS} order. */
export function pilotCsvRow(f: ConversationFacts, v: ConversationVerdict, transcript: string): string {
  const avgConfidence =
    f.messages.answers > 0 ? Math.round((f.messages.confidenceSum / f.messages.answers) * 1000) / 1000 : null;
  return csvLine([
    f.row.id,
    f.row.createdAt.toISOString(),
    f.row.hotelSn,
    f.row.actorRole,
    f.row.aiAgentId,
    f.row.language,
    v.outcome,
    v.handoffReason,
    refusalsCell(v.refusals),
    f.row.csatRating,
    f.messages.total,
    avgConfidence,
    transcript,
  ]);
}
