import { IDENTITY_ROLE } from '@sharptalk/types';
import type { IdentityRole } from '@sharptalk/types';
import { PARTNER_LIST_MAX, PARTNER_TOPIC, partnerError } from './partner-data.constants';
import type { PartnerTopic } from './partner-data.constants';
import type { PartnerCtx } from './partner-ctx';
import { validateParams } from './partner-params.util';
import type { ParamSpec, PartnerQuery } from './partner-params.util';
import { formatVnd, moneyOpt, priceBreakdown, settlementAmounts } from './money.util';
import type { Money, PriceBreakdown, SettlementAmounts } from './money.util';
import {
  asArray,
  asClock,
  asClockOpt,
  asCode,
  asDate,
  asDateOpt,
  asDateTime,
  asEnum,
  asInt,
  asIntOpt,
  asObject,
  cleanTextOpt,
} from './partner-project.util';

/**
 * The allow-list of partner topics (PLN-261012 SG-31): for each one, the roles
 * that may read it, its CLOSED parameter set, a projector that turns the
 * upstream payload into a whitelisted, PII-minimised view, and a formatter that
 * renders that view as the lines of the prompt's data block.
 *
 * Adding a topic is adding an entry here — and nowhere else is there a way to
 * reach the partner API.
 */

// ---- views -----------------------------------------------------------------

export type PolicyItem =
  | {
      type: 'cancellation';
      rules: Array<{ hoursBeforeCheckIn: number; refundPercent: number }>;
      noShowRefundPercent?: number;
      note?: string;
    }
  | { type: 'refund'; processingDays: number; method: string; note?: string }
  | {
      type: 'checkin_out';
      standardCheckIn: string;
      standardCheckOut: string;
      hourlyMaxHours?: number;
      overnightStart?: string;
      overnightEnd?: string;
      earlyCheckInFee?: Money;
      lateCheckOutFee?: Money;
      note?: string;
    };

export interface RateItem {
  roomType: string;
  roomTypeName?: string;
  rateType: string;
  date: string;
  includedHours?: number;
  extraHour?: Money;
  breakdown: PriceBreakdown;
}

export interface BookingItem {
  bookingCode: string;
  status: string;
  roomType: string;
  rateType: string;
  checkInAt: string;
  checkOutAt: string;
  guestCount?: number;
  paymentStatus: string;
  breakdown: PriceBreakdown;
}

export interface SettlementItem {
  period: string;
  status: string;
  bookingCount: number;
  amounts: SettlementAmounts;
  dueDate?: string;
  paidAt?: string;
  reference?: string;
}

export type TopicView =
  | { topic: 'policies'; items: PolicyItem[] }
  | { topic: 'rates'; items: RateItem[] }
  | { topic: 'bookings'; items: BookingItem[]; total: number }
  | { topic: 'settlement'; items: SettlementItem[]; total: number };

/** What a view renders to. */
export interface FormattedTopic {
  /** Lines of the PARTNER_DATA block for this topic. */
  lines: string[];
  /** Values (ids, amounts) the moderation PII masks must leave alone. */
  protect: string[];
}

export interface TopicDef {
  topic: PartnerTopic;
  /** Path on the partner API; the hotel is never part of it. */
  path: string;
  /** Roles that may read this topic — anyone else is PARTNER_ROLE_DENIED before a request is made. */
  roles: readonly IdentityRole[];
  params: Record<string, ParamSpec>;
  /** Cross-field rules of the closed parameter set. */
  refine?: (q: PartnerQuery) => void;
  /** How long a successful reply may be cached (seconds). */
  cacheTtlSec: number;
  project: (data: unknown, ctx: PartnerCtx, query: PartnerQuery) => TopicView;
  format: (view: TopicView, lang: string) => FormattedTopic;
}

// ---- shared bits -----------------------------------------------------------

const RATE_TYPES = ['hourly', 'overnight', 'daily'] as const;
const BOOKING_STATUS = ['confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'] as const;
const PAYMENT_STATUS = ['unpaid', 'paid', 'partially_refunded', 'refunded'] as const;
const SETTLEMENT_STATUS = ['pending', 'paid', 'disputed'] as const;
const REFUND_METHOD = ['original_payment', 'wallet', 'bank_transfer'] as const;
const POLICY_TYPES = ['cancellation', 'refund', 'checkin_out'] as const;
const ROOM_TYPE_CODE = /^[A-Za-z0-9_-]{1,32}$/;
const BOOKING_CODE = /^[A-Za-z0-9-]{6,24}$/;

const ALL_ROLES: readonly IdentityRole[] = [IDENTITY_ROLE.MANAGER, IDENTITY_ROLE.RECEPTIONIST, IDENTITY_ROLE.INTERNAL];

const MAX_RANGE_DAYS = 31;

function listOf<T>(data: unknown, key: string, each: (item: unknown, i: number) => T, max = 200): T[] {
  const d = asObject(data, 'data');
  return asArray(d[key], `data.${key}`, max).map(each);
}

function totalOf(data: unknown, shown: number): number {
  const page = (data as Record<string, unknown>).page;
  if (page === undefined || page === null) return shown;
  const total = asInt(asObject(page, 'data.page').total, 'data.page.total', 0, 1_000_000);
  // A total smaller than what came back would make "N more" negative.
  return Math.max(total, shown);
}

/** Render `-` only for a non-zero deduction ("-0" reads like a typo). */
const deduct = (n: number, lang: string) => (n === 0 ? formatVnd(0, lang) : `-${formatVnd(n, lang)}`);

function breakdownText(b: PriceBreakdown, lang: string): string {
  return (
    `base ${formatVnd(b.base, lang)}; extra ${formatVnd(b.extra, lang)}; ` +
    `direct discount ${deduct(b.directDiscount, lang)}; flash sale ${deduct(b.flashSale, lang)}; ` +
    `coupon ${deduct(b.coupon, lang)}; final ${formatVnd(b.final, lang)}`
  );
}

function breakdownMoney(b: PriceBreakdown): Money[] {
  return [b.base, b.extra, b.directDiscount, b.flashSale, b.coupon, b.final];
}

const NOTHING = (what: string) => `no ${what} data was found for this hotel for the requested filters`;

/** Amounts that must survive masking, as the strings the block prints (>= 5 chars: shorter ones match too much). */
function protectMoney(amounts: number[], lang: string): string[] {
  return amounts.map((a) => formatVnd(a, lang)).filter((s) => s.length >= 5);
}

// ---- policies --------------------------------------------------------------

const policies: TopicDef = {
  topic: PARTNER_TOPIC.POLICIES,
  path: '/v0/policies',
  roles: ALL_ROLES,
  params: { type: { kind: 'enum', values: POLICY_TYPES } },
  cacheTtlSec: 60,
  project(data) {
    const items = listOf<PolicyItem>(data, 'policies', (raw, i) => {
      const p = asObject(raw, `policies[${i}]`);
      const type = asEnum(p.type, POLICY_TYPES, `policies[${i}].type`);
      const note = cleanTextOpt(p.note);
      if (type === 'cancellation') {
        const rules = asArray(p.rules, `policies[${i}].rules`, 20).map((r, j) => {
          const o = asObject(r, `policies[${i}].rules[${j}]`);
          return {
            hoursBeforeCheckIn: asInt(o.hoursBeforeCheckIn, 'hoursBeforeCheckIn', 0, 24 * 365),
            refundPercent: asInt(o.refundPercent, 'refundPercent', 0, 100),
          };
        });
        return {
          type,
          rules,
          ...(p.noShowRefundPercent !== undefined
            ? { noShowRefundPercent: asInt(p.noShowRefundPercent, 'noShowRefundPercent', 0, 100) }
            : {}),
          ...(note ? { note } : {}),
        };
      }
      if (type === 'refund') {
        return {
          type,
          processingDays: asInt(p.processingDays, 'processingDays', 0, 365),
          method: asEnum(p.method, REFUND_METHOD, 'method'),
          ...(note ? { note } : {}),
        };
      }
      const early = moneyOpt(p.earlyCheckInFeeVnd, 'earlyCheckInFeeVnd');
      const late = moneyOpt(p.lateCheckOutFeeVnd, 'lateCheckOutFeeVnd');
      const hourly = asIntOpt(p.hourlyMaxHours, 'hourlyMaxHours', 1, 48);
      const overnightStart = asClockOpt(p.overnightStart, 'overnightStart');
      const overnightEnd = asClockOpt(p.overnightEnd, 'overnightEnd');
      return {
        type,
        standardCheckIn: asClock(p.standardCheckIn, 'standardCheckIn'),
        standardCheckOut: asClock(p.standardCheckOut, 'standardCheckOut'),
        ...(hourly !== undefined ? { hourlyMaxHours: hourly } : {}),
        ...(overnightStart ? { overnightStart } : {}),
        ...(overnightEnd ? { overnightEnd } : {}),
        ...(early !== undefined ? { earlyCheckInFee: early } : {}),
        ...(late !== undefined ? { lateCheckOutFee: late } : {}),
        ...(note ? { note } : {}),
      };
    }, 12);
    return { topic: 'policies', items };
  },
  format(view, lang) {
    if (view.topic !== 'policies') throw partnerError.invalid('view_topic_mismatch');
    if (!view.items.length) return { lines: [NOTHING('policy')], protect: [] };
    const money: number[] = [];
    const lines = view.items.map((p) => {
      if (p.type === 'cancellation') {
        const rules = p.rules
          .slice()
          .sort((a, b) => b.hoursBeforeCheckIn - a.hoursBeforeCheckIn)
          .map((r) => `cancelled at least ${r.hoursBeforeCheckIn} hours before check-in: ${r.refundPercent}% refunded`)
          .join('; ');
        const noShow = p.noShowRefundPercent !== undefined ? `; no-show: ${p.noShowRefundPercent}% refunded` : '';
        return `- cancellation policy: ${rules || 'no tiers published'}${noShow}${p.note ? `; note: ${p.note}` : ''}`;
      }
      if (p.type === 'refund') {
        return `- refund policy: processed within ${p.processingDays} days; method: ${p.method.replace(/_/g, ' ')}${p.note ? `; note: ${p.note}` : ''}`;
      }
      const parts = [`check-in from ${p.standardCheckIn}`, `check-out by ${p.standardCheckOut}`];
      if (p.hourlyMaxHours !== undefined) parts.push(`hourly stay up to ${p.hourlyMaxHours} hours`);
      if (p.overnightStart && p.overnightEnd) parts.push(`overnight stay ${p.overnightStart}-${p.overnightEnd}`);
      if (p.earlyCheckInFee !== undefined) {
        parts.push(`early check-in fee ${formatVnd(p.earlyCheckInFee, lang)}`);
        money.push(p.earlyCheckInFee);
      }
      if (p.lateCheckOutFee !== undefined) {
        parts.push(`late check-out fee ${formatVnd(p.lateCheckOutFee, lang)}`);
        money.push(p.lateCheckOutFee);
      }
      return `- check-in/check-out policy: ${parts.join('; ')}${p.note ? `; note: ${p.note}` : ''}`;
    });
    return { lines, protect: protectMoney(money, lang) };
  },
};

// ---- rates -----------------------------------------------------------------

const rates: TopicDef = {
  topic: PARTNER_TOPIC.RATES,
  path: '/v0/rates',
  roles: ALL_ROLES,
  params: {
    roomType: { kind: 'pattern', pattern: ROOM_TYPE_CODE },
    rateType: { kind: 'enum', values: RATE_TYPES },
    date: { kind: 'date' },
  },
  cacheTtlSec: 60,
  project(data) {
    const d = asObject(data, 'data');
    if (d.currency !== 'VND') throw partnerError.invalid('currency_not_vnd');
    const items = listOf<RateItem>(data, 'rates', (raw, i) => {
      const r = asObject(raw, `rates[${i}]`);
      const roomTypeName = cleanTextOpt(r.roomTypeName, 80);
      const includedHours = asIntOpt(r.includedHours, 'includedHours', 1, 48);
      const extraHour = moneyOpt(r.extraHourVnd, 'extraHourVnd');
      return {
        roomType: asCode(r.roomType, 'roomType', ROOM_TYPE_CODE),
        ...(roomTypeName ? { roomTypeName } : {}),
        rateType: asEnum(r.rateType, RATE_TYPES, 'rateType'),
        date: asDate(r.date, 'date'),
        ...(includedHours !== undefined ? { includedHours } : {}),
        ...(extraHour !== undefined ? { extraHour } : {}),
        breakdown: priceBreakdown(r.breakdown, `rates[${i}].breakdown`),
      };
    }, 60);
    return { topic: 'rates', items };
  },
  format(view, lang) {
    if (view.topic !== 'rates') throw partnerError.invalid('view_topic_mismatch');
    if (!view.items.length) return { lines: [NOTHING('rate')], protect: [] };
    const money: number[] = [];
    const shown = view.items.slice(0, PARTNER_LIST_MAX);
    const lines = shown.map((r) => {
      money.push(...breakdownMoney(r.breakdown));
      const hourly =
        r.rateType === 'hourly' && r.includedHours !== undefined
          ? `; includes ${r.includedHours} hours${r.extraHour !== undefined ? `, each extra hour ${formatVnd(r.extraHour, lang)}` : ''}`
          : '';
      if (r.extraHour !== undefined) money.push(r.extraHour);
      const name = r.roomTypeName ? `${r.roomTypeName} (${r.roomType})` : r.roomType;
      return `- ${name} | ${r.rateType} | ${r.date}: ${breakdownText(r.breakdown, lang)}${hourly}`;
    });
    if (view.items.length > shown.length) lines.push(`(${view.items.length - shown.length} more rates not shown)`);
    return { lines, protect: protectMoney(money, lang) };
  },
};

// ---- bookings --------------------------------------------------------------

const bookings: TopicDef = {
  topic: PARTNER_TOPIC.BOOKINGS,
  path: '/v0/bookings',
  roles: ALL_ROLES,
  params: {
    bookingCode: { kind: 'pattern', pattern: BOOKING_CODE },
    checkInFrom: { kind: 'date' },
    checkInTo: { kind: 'date' },
    status: { kind: 'enum', values: BOOKING_STATUS },
    page: { kind: 'int', min: 1, max: 1000 },
    size: { kind: 'int', min: 1, max: 50 },
  },
  refine(q) {
    const byCode = q.bookingCode !== undefined;
    const hasRange = q.checkInFrom !== undefined || q.checkInTo !== undefined;
    if (byCode === hasRange) {
      // Neither, or both: the contract allows exactly one lookup form.
      throw partnerError.paramRejected('lookup_form', { keys: ['bookingCode', 'checkInFrom', 'checkInTo'] });
    }
    if (byCode) {
      if (q.status !== undefined || q.page !== undefined || q.size !== undefined) {
        throw partnerError.paramRejected('lookup_form', { keys: ['status', 'page', 'size'] });
      }
      return;
    }
    if (q.checkInFrom === undefined || q.checkInTo === undefined) {
      throw partnerError.paramRejected('range_incomplete', { keys: ['checkInFrom', 'checkInTo'] });
    }
    const from = Date.parse(`${q.checkInFrom}T00:00:00Z`);
    const to = Date.parse(`${q.checkInTo}T00:00:00Z`);
    if (!(from <= to) || (to - from) / 86_400_000 > MAX_RANGE_DAYS) {
      throw partnerError.paramRejected('range_invalid', { keys: ['checkInFrom', 'checkInTo'] });
    }
  },
  cacheTtlSec: 30,
  project(data) {
    const items = listOf<BookingItem>(data, 'bookings', (raw, i) => {
      const b = asObject(raw, `bookings[${i}]`);
      const guestCount = asIntOpt(b.guestCount, 'guestCount', 1, 50);
      // Whitelist: no guest name / phone / e-mail / ID document can be read
      // from here even if upstream sends one (PII minimisation).
      return {
        bookingCode: asCode(b.bookingCode, 'bookingCode', BOOKING_CODE),
        status: asEnum(b.status, BOOKING_STATUS, 'status'),
        roomType: asCode(b.roomType, 'roomType', ROOM_TYPE_CODE),
        rateType: asEnum(b.rateType, RATE_TYPES, 'rateType'),
        checkInAt: asDateTime(b.checkInAt, 'checkInAt'),
        checkOutAt: asDateTime(b.checkOutAt, 'checkOutAt'),
        ...(guestCount !== undefined ? { guestCount } : {}),
        paymentStatus: asEnum(b.paymentStatus, PAYMENT_STATUS, 'paymentStatus'),
        breakdown: priceBreakdown(b.breakdown, `bookings[${i}].breakdown`),
      };
    }, 60);
    return { topic: 'bookings', items, total: totalOf(data, items.length) };
  },
  format(view, lang) {
    if (view.topic !== 'bookings') throw partnerError.invalid('view_topic_mismatch');
    if (!view.items.length) return { lines: [NOTHING('booking')], protect: [] };
    const protect: string[] = [];
    const money: number[] = [];
    const shown = view.items.slice(0, PARTNER_LIST_MAX);
    const lines = shown.map((b) => {
      protect.push(b.bookingCode);
      money.push(...breakdownMoney(b.breakdown));
      const guests = b.guestCount !== undefined ? `; guests ${b.guestCount}` : '';
      return (
        `- booking ${b.bookingCode}: status ${b.status.replace(/_/g, ' ')}; room ${b.roomType}; ${b.rateType}; ` +
        `check-in ${b.checkInAt}; check-out ${b.checkOutAt}${guests}; payment ${b.paymentStatus.replace(/_/g, ' ')}; ` +
        breakdownText(b.breakdown, lang)
      );
    });
    lines.push(`total bookings matching: ${view.total}`);
    if (view.total > shown.length) lines.push(`(${view.total - shown.length} more bookings not shown)`);
    return { lines, protect: [...protect, ...protectMoney(money, lang)] };
  },
};

// ---- settlement ------------------------------------------------------------

const settlement: TopicDef = {
  topic: PARTNER_TOPIC.SETTLEMENT,
  path: '/v0/settlement',
  // Settlement is a manager's business: a receptionist is denied before any request is made.
  roles: [IDENTITY_ROLE.MANAGER, IDENTITY_ROLE.INTERNAL],
  params: {
    period: { kind: 'month' },
    status: { kind: 'enum', values: SETTLEMENT_STATUS },
    page: { kind: 'int', min: 1, max: 1000 },
    size: { kind: 'int', min: 1, max: 50 },
  },
  cacheTtlSec: 30,
  project(data) {
    const items = listOf<SettlementItem>(data, 'settlements', (raw, i) => {
      const s = asObject(raw, `settlements[${i}]`);
      const period = String(s.period ?? '');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw partnerError.invalid('field_not_period', { field: 'period' });
      const dueDate = asDateOpt(s.dueDate, 'dueDate');
      const paidAt = s.paidAt === undefined || s.paidAt === null ? undefined : asDateTime(s.paidAt, 'paidAt');
      const reference = typeof s.reference === 'string' && s.reference ? asCode(s.reference, 'reference', /^[A-Za-z0-9._-]{1,40}$/) : undefined;
      return {
        period,
        status: asEnum(s.status, SETTLEMENT_STATUS, 'status'),
        bookingCount: asInt(s.bookingCount, 'bookingCount', 0, 10_000_000),
        amounts: settlementAmounts(s, `settlements[${i}]`),
        ...(dueDate ? { dueDate } : {}),
        ...(paidAt ? { paidAt } : {}),
        ...(reference ? { reference } : {}),
      };
    }, 60);
    return { topic: 'settlement', items, total: totalOf(data, items.length) };
  },
  format(view, lang) {
    if (view.topic !== 'settlement') throw partnerError.invalid('view_topic_mismatch');
    if (!view.items.length) return { lines: [NOTHING('settlement')], protect: [] };
    const protect: string[] = [];
    const money: number[] = [];
    const shown = view.items.slice(0, PARTNER_LIST_MAX);
    const lines = shown.map((s) => {
      const a = s.amounts;
      money.push(a.gross, a.commission, a.deduction, a.net, a.paid, a.outstanding);
      if (s.reference) protect.push(s.reference);
      return (
        `- settlement period ${s.period}: status ${s.status}; bookings ${s.bookingCount}; gross ${formatVnd(a.gross, lang)}; ` +
        `commission ${deduct(a.commission, lang)}; deductions ${deduct(a.deduction, lang)}; net ${formatVnd(a.net, lang)}; ` +
        `paid ${formatVnd(a.paid, lang)}; outstanding ${formatVnd(a.outstanding, lang)}` +
        `${s.dueDate ? `; due ${s.dueDate}` : ''}${s.paidAt ? `; paid at ${s.paidAt}` : ''}${s.reference ? `; reference ${s.reference}` : ''}`
      );
    });
    if (view.total > shown.length) lines.push(`(${view.total - shown.length} more periods not shown)`);
    return { lines, protect: [...protect, ...protectMoney(money, lang)] };
  },
};

// ---- registry --------------------------------------------------------------

/**
 * The only way to reach a topic. `get` of anything not registered is
 * PARTNER_TOPIC_UNKNOWN — there is no "pass the path through" escape hatch.
 */
export class TopicRegistry {
  private readonly defs = new Map<string, TopicDef>(
    [policies, rates, bookings, settlement].map((d) => [d.topic, d] as const),
  );

  get(topic: string): TopicDef {
    const def = this.defs.get(topic);
    if (!def) throw partnerError.topicUnknown('topic_not_allowed');
    return def;
  }

  topics(): PartnerTopic[] {
    return [...this.defs.keys()] as PartnerTopic[];
  }

  /** Is this role allowed to read the topic? */
  allows(def: TopicDef, role: IdentityRole): boolean {
    return def.roles.includes(role);
  }

  /** Closed-schema validation + the topic's cross-field rules. */
  query(def: TopicDef, raw: unknown): PartnerQuery {
    const q = validateParams(raw, def.params);
    def.refine?.(q);
    return q;
  }
}

