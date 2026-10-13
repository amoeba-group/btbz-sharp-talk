import { PARTNER_TOPIC } from './partner-data.constants';
import type { PartnerTopic } from './partner-data.constants';
import { isCalendarDate } from './partner-params.util';

/**
 * Which partner topic (if any) a chat message asks about, and the closed
 * parameters it implies (PLN-261012 SG-31).
 *
 * DELIBERATELY DETERMINISTIC — keyword/regex over vi / en / ko, no model call:
 *  - the existing `classifyIntent` returns one label from a closed set shared by
 *    every tenant; adding a partner-topic field to that JSON would change the
 *    prompt (and the cost and the failure modes) for all of them, and its
 *    fallback on a parse error is a confident wrong label;
 *  - parameters must come out of OUR parser into the closed schema — a model
 *    asked for "the parameters" is exactly where a `hotelSn` would appear;
 *  - zero extra latency and fully testable. Recall is lower than a model's; the
 *    wave-2 tool-calling loop can raise it behind the same closed schema.
 * The lexicon is a heuristic written before Go2Joy's real vocabulary (R8) is
 * known — expect to extend it from the lookup logs.
 *
 * Nothing here ever emits a hotel parameter. What it does do is notice when the
 * message names ANOTHER hotel (or "all hotels"): the lookup would answer for the
 * signed-in hotel while the user believes it answered for the other one, so the
 * step refuses instead.
 */

export interface DetectedTopic {
  topic: PartnerTopic;
  params: Record<string, string | number>;
}

export interface PartnerIntent {
  /** At most two, in priority order (settlement, bookings, rates, policies). */
  topics: DetectedTopic[];
  /** The message points at a hotel other than the signed-in one (or at several). */
  foreignHotel: boolean;
}

/** Hotel business timezone for "today"/"this week" (the contract's Asia/Ho_Chi_Minh). */
const VN_OFFSET_MS = 7 * 3600_000;

const isoDate = (ms: number): string => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
const dayMs = 86_400_000;

/** Lower-case, accents removed, đ -> d: Vietnamese typed with or without diacritics reads the same. */
export function foldVi(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

// ---- lexicon ---------------------------------------------------------------

const SETTLEMENT_RE =
  /doi soat|quyet toan|cong no|ky thanh toan|tien ve|chua (duoc )?thanh toan|da thanh toan|so du thanh toan|settlement|reconcil|payout|outstanding (balance|amount)|unpaid (balance|settlement)|commission (statement|report)/;
const SETTLEMENT_KO = /정산|미정산|정산금|지급\s*(예정|내역)/;

const BOOKING_NOUN_RE = /dat phong|dat cho|don dat|ma dat|ma booking|booking|reservation|check-?in (list|today)/;
const BOOKING_KO = /예약/;

const RATE_VI_RE =
  /gia (phong|theo gio|qua dem|theo ngay|ngay|gio|dem|cuoi tuan|ngay le|niem yet|hien tai|ban)|bang gia|phu thu|gia (la )?bao nhieu/;
const RATE_EN_RE = /\b(rate|rates|price|prices|pricing)\b|how much/;
const RATE_EN_CONTEXT = /room|night|hour|overnight|hourly|daily|deluxe|standard|superior|suite|surcharge|weekend/;
const RATE_KO = /(요금|가격)/;
const RATE_KO_CONTEXT = /(객실|숙박|대실|시간|일일|룸)/;

const POLICY_RE =
  /chinh sach (huy|hoan|nhan phong|tra phong|check)|phi huy|hoan tien|gio (nhan|tra) phong|(cancel+ation|refund|check-?in|check-?out) (policy|policies|fee|fees|time|times|rules?)|late check-?out|early check-?in/;
const POLICY_KO = /(취소|환불)\s*(정책|규정|수수료)|체크\s*인|체크\s*아웃|입실\s*시간|퇴실\s*시간/;

const HOURLY_RE = /theo gio|gia gio|hourly|per hour/;
const HOURLY_KO = /대실|시간제/;
const OVERNIGHT_RE = /qua dem|gia dem|overnight/;
const OVERNIGHT_KO = /숙박/;
const DAILY_RE = /theo ngay|gia ngay|daily|per day|day rate/;
const DAILY_KO = /일일/;

const ROOM_TYPES = ['standard', 'deluxe', 'superior', 'suite', 'family', 'twin', 'double', 'single', 'vip', 'premium', 'economy', 'studio'];

/** A hotel number typed in the message ("khách sạn 2204", "hotel #2204", "hotelSn 2204", "호텔 2204"). */
const HOTEL_NUMBER_RE = /(?:khach san|\bks\b|hotel ?(?:sn|id|no\.?|number)?|호텔)\s*(?:sn|id|so|no\.?|number|#|:)?\s*#?\s*(\d{3,8})\b/g;
const OTHER_HOTELS_RE =
  /khach san khac|cac khach san|tat ca khach san|moi khach san|other hotels?|another hotel|all (my )?hotels|every hotel|다른 호텔|모든 호텔/;

// ---- parameter extraction --------------------------------------------------

/** Monday of the week containing `ms` (hotel timezone). */
function weekStartMs(ms: number): number {
  const local = ms + VN_OFFSET_MS;
  const dow = new Date(local).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  return Math.floor(local / dayMs) * dayMs - sinceMonday * dayMs - VN_OFFSET_MS;
}

/** The next Saturday on or after `ms`. */
function nextSaturdayMs(ms: number): number {
  const local = ms + VN_OFFSET_MS;
  const dow = new Date(local).getUTCDay();
  return ms + ((6 - dow + 7) % 7) * dayMs;
}

/** A single date the message names ("hôm nay", "ngày mai", 2026-10-17, 17/10), or null. */
function singleDate(raw: string, folded: string, nowMs: number): string | null {
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isCalendarDate(iso[1])) return iso[1];
  const dm = folded.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(isoDate(nowMs).slice(0, 4));
    const candidate = `${String(year).padStart(4, '0')}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    if (isCalendarDate(candidate)) return candidate;
  }
  if (/hom nay|today|오늘/.test(folded) || /오늘/.test(raw)) return isoDate(nowMs);
  if (/ngay mai|tomorrow/.test(folded) || /내일/.test(raw)) return isoDate(nowMs + dayMs);
  if (/hom qua|yesterday/.test(folded) || /어제/.test(raw)) return isoDate(nowMs - dayMs);
  if (/cuoi tuan|weekend/.test(folded) || /주말/.test(raw)) return isoDate(nextSaturdayMs(nowMs));
  return null;
}

/** A check-in range the message names, or null. At most 31 days by construction. */
function dateRange(raw: string, folded: string, nowMs: number): { from: string; to: string } | null {
  if (/tuan nay|this week/.test(folded) || /이번\s*주/.test(raw)) {
    const start = weekStartMs(nowMs);
    return { from: isoDate(start), to: isoDate(start + 6 * dayMs) };
  }
  if (/tuan sau|next week/.test(folded) || /다음\s*주/.test(raw)) {
    const start = weekStartMs(nowMs) + 7 * dayMs;
    return { from: isoDate(start), to: isoDate(start + 6 * dayMs) };
  }
  const day = singleDate(raw, folded, nowMs);
  return day ? { from: day, to: day } : null;
}

/** "YYYY-MM" a settlement question names ("tháng 9", "9/2026", "this month", "지난달"), or null. */
function settlementPeriod(raw: string, folded: string, nowMs: number): string | null {
  const nowMonth = isoDate(nowMs).slice(0, 7);
  const prevMonth = (): string => {
    const [y, m] = nowMonth.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  };
  if (/thang truoc|last month|previous month/.test(folded) || /지난\s*달/.test(raw)) return prevMonth();
  if (/thang nay|this month/.test(folded) || /이번\s*달/.test(raw)) return nowMonth;
  const iso = raw.match(/\b(\d{4})-(0[1-9]|1[0-2])\b/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const my = folded.match(/\b(0?[1-9]|1[0-2])\s*[/-]\s*(\d{4})\b/);
  if (my) return `${my[2]}-${my[1].padStart(2, '0')}`;
  const vi = folded.match(/thang\s*(0?[1-9]|1[0-2])(?:\s*(?:nam)?\s*(\d{4}))?/);
  if (vi) return `${vi[2] ?? nowMonth.slice(0, 4)}-${vi[1].padStart(2, '0')}`;
  const ko = raw.match(/(\d{1,2})\s*월/);
  if (ko && Number(ko[1]) >= 1 && Number(ko[1]) <= 12) return `${nowMonth.slice(0, 4)}-${ko[1].padStart(2, '0')}`;
  return null;
}

/** A booking code: letters+digits (>= 6 chars) or 8+ digits — never a date. */
function bookingCode(raw: string): string | null {
  for (const m of raw.matchAll(/\b[A-Za-z0-9][A-Za-z0-9-]{5,23}\b/g)) {
    const t = m[0];
    if (isCalendarDate(t)) continue;
    // A Vietnamese mobile number is not a booking code, and must not travel as a query parameter.
    if (/^(0|84)\d{9,10}$/.test(t)) continue;
    const digits = t.replace(/\D/g, '').length;
    const hasLetter = /[A-Za-z]/.test(t);
    if ((hasLetter && digits >= 3) || (!hasLetter && digits >= 8)) return t;
  }
  return null;
}

function pickOne<T extends string>(found: T[]): T | undefined {
  return found.length === 1 ? found[0] : undefined;
}

// ---- detector --------------------------------------------------------------

export function detectPartnerIntent(
  text: string,
  opts: { hotelSn: string; nowMs?: number },
): PartnerIntent {
  const raw = (text ?? '').slice(0, 1000);
  const folded = foldVi(raw);
  const nowMs = opts.nowMs ?? Date.now();

  // Another hotel (or all of them) named in the message.
  let foreignHotel = OTHER_HOTELS_RE.test(folded) || OTHER_HOTELS_RE.test(raw.toLowerCase());
  for (const m of folded.matchAll(HOTEL_NUMBER_RE)) {
    if (m[1] !== opts.hotelSn) foreignHotel = true;
  }
  for (const m of raw.matchAll(/호텔\s*(\d{3,8})/g)) {
    if (m[1] !== opts.hotelSn) foreignHotel = true;
  }

  const topics: DetectedTopic[] = [];

  if (SETTLEMENT_RE.test(folded) || SETTLEMENT_KO.test(raw)) {
    const params: Record<string, string | number> = {};
    const period = settlementPeriod(raw, folded, nowMs);
    if (period) params.period = period;
    const statuses = (
      [
        [/chua (duoc )?thanh toan|outstanding|unpaid|pending|미정산|미지급/, 'pending'],
        [/da thanh toan|\bpaid\b|settled|정산\s*완료|지급\s*완료/, 'paid'],
        [/khieu nai|tranh chap|dispute/, 'disputed'],
      ] as Array<[RegExp, string]>
    )
      .filter(([re]) => re.test(folded) || re.test(raw))
      .map(([, s]) => s);
    const status = pickOne(statuses);
    if (status) params.status = status;
    topics.push({ topic: PARTNER_TOPIC.SETTLEMENT, params });
  }

  if (BOOKING_NOUN_RE.test(folded) || BOOKING_KO.test(raw)) {
    // A booking question needs a handle — a code or a date window — otherwise it
    // is a how-to ("how do I cancel a booking?") and belongs to the knowledge base.
    const code = bookingCode(raw);
    if (code) {
      topics.push({ topic: PARTNER_TOPIC.BOOKINGS, params: { bookingCode: code } });
    } else {
      const range = dateRange(raw, folded, nowMs);
      if (range) topics.push({ topic: PARTNER_TOPIC.BOOKINGS, params: { checkInFrom: range.from, checkInTo: range.to } });
    }
  }

  const ratesAsked =
    RATE_VI_RE.test(folded) ||
    (RATE_EN_RE.test(folded) && RATE_EN_CONTEXT.test(folded)) ||
    (RATE_KO.test(raw) && RATE_KO_CONTEXT.test(raw));
  if (ratesAsked) {
    const params: Record<string, string | number> = {};
    const types = (
      [
        [HOURLY_RE, HOURLY_KO, 'hourly'],
        [OVERNIGHT_RE, OVERNIGHT_KO, 'overnight'],
        [DAILY_RE, DAILY_KO, 'daily'],
      ] as Array<[RegExp, RegExp, string]>
    )
      .filter(([vi, ko]) => vi.test(folded) || ko.test(raw))
      .map(([, , t]) => t);
    const rateType = pickOne(types);
    if (rateType) params.rateType = rateType;
    const rooms = ROOM_TYPES.filter((r) => new RegExp(`\\b${r}\\b`).test(folded));
    const room = pickOne(rooms);
    if (room) params.roomType = room.toUpperCase();
    const date = singleDate(raw, folded, nowMs);
    if (date) params.date = date;
    topics.push({ topic: PARTNER_TOPIC.RATES, params });
  }

  if (POLICY_RE.test(folded) || POLICY_KO.test(raw)) {
    const params: Record<string, string | number> = {};
    const kinds = (
      [
        [/huy|cancel|취소/, 'cancellation'],
        [/hoan tien|refund|환불/, 'refund'],
        [/nhan phong|tra phong|check-?in|check-?out|체크|입실|퇴실/, 'checkin_out'],
      ] as Array<[RegExp, string]>
    )
      .filter(([re]) => re.test(folded) || re.test(raw))
      .map(([, k]) => k);
    const type = pickOne(kinds);
    if (type) params.type = type;
    topics.push({ topic: PARTNER_TOPIC.POLICIES, params });
  }

  return { topics: topics.slice(0, 2), foreignHotel };
}

/**
 * Does the message TALK ABOUT a partner topic at all (PLN-261012 SG-33)? Looser than
 * `detectPartnerIntent` on purpose: no handle (booking code / date window / room-type context) is
 * needed, because in tools mode the model — not this lexicon — decides whether a lookup is wanted and
 * with which arguments. It only gates the extra planning call: a message with none of these words
 * (a greeting, a how-to about something else) never costs a model round trip. Words only, never a
 * parameter: nothing here can name a hotel.
 */
export function looksLikePartnerQuestion(text: string): boolean {
  const raw = (text ?? '').slice(0, 1000);
  const folded = foldVi(raw);
  return (
    SETTLEMENT_RE.test(folded) ||
    SETTLEMENT_KO.test(raw) ||
    BOOKING_NOUN_RE.test(folded) ||
    BOOKING_KO.test(raw) ||
    RATE_VI_RE.test(folded) ||
    RATE_EN_RE.test(folded) ||
    RATE_KO.test(raw) ||
    POLICY_RE.test(folded) ||
    POLICY_KO.test(raw)
  );
}
