import { partnerError } from './partner-data.constants';

/**
 * Money in the partner-data path (PLN-261012 SG-31).
 *
 * The model must never do arithmetic on a price: it is asked to copy figures
 * out of a block the SERVER computed and formatted. So amounts here are
 * integer VND (no decimals, no floats — a 450000.5 from upstream is a defect,
 * not a rounding question), the breakdown identity is recomputed here and
 * checked against whatever the upstream reported, and the strings that reach
 * the prompt are produced by `formatVnd`, not by the model.
 */

/** Integer VND. Branded so a stray float cannot be passed where an amount is expected. */
export type Money = number & { readonly __vnd: true };

/** 100 billion VND — far above any single hotel amount; a bigger value is a unit error upstream. */
export const MONEY_MAX = 100_000_000_000;

/** An amount from upstream, or a PARTNER_RESPONSE_INVALID. */
export function money(value: unknown, field = 'amount'): Money {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MONEY_MAX) {
    throw partnerError.invalid('money_not_integer_vnd', { field });
  }
  return value as Money;
}

/** Optional amount: undefined/null stays undefined, anything else must be a valid amount. */
export function moneyOpt(value: unknown, field: string): Money | undefined {
  return value === undefined || value === null ? undefined : money(value, field);
}

export interface PriceBreakdown {
  base: Money;
  extra: Money;
  directDiscount: Money;
  flashSale: Money;
  coupon: Money;
  /** base + extra - directDiscount - flashSale - coupon, computed HERE. */
  final: Money;
}

/**
 * base + extra - direct discount - flash sale - coupon = final (SG-31).
 *
 * `final` is computed by this function. When upstream also sent a `finalVnd`
 * the two must agree — a mismatch means a component is missing or wrong on
 * their side, and showing either number would be a guess. A negative result
 * (discounts exceeding the price) is rejected for the same reason.
 */
export function priceBreakdown(raw: unknown, label: string): PriceBreakdown {
  if (!raw || typeof raw !== 'object') throw partnerError.invalid('breakdown_missing', { field: label });
  const r = raw as Record<string, unknown>;
  const base = money(r.baseVnd, `${label}.baseVnd`);
  const extra = money(r.extraVnd, `${label}.extraVnd`);
  const directDiscount = money(r.directDiscountVnd, `${label}.directDiscountVnd`);
  const flashSale = money(r.flashSaleVnd, `${label}.flashSaleVnd`);
  const coupon = money(r.couponVnd, `${label}.couponVnd`);
  const computed = base + extra - directDiscount - flashSale - coupon;
  if (computed < 0) throw partnerError.invalid('breakdown_negative', { field: label });
  if (r.finalVnd !== undefined && r.finalVnd !== computed) {
    throw partnerError.invalid('breakdown_invariant', { field: label });
  }
  return { base, extra, directDiscount, flashSale, coupon, final: computed as Money };
}

export interface SettlementAmounts {
  gross: Money;
  commission: Money;
  deduction: Money;
  /** gross - commission - deduction, computed HERE. */
  net: Money;
  paid: Money;
  /** net - paid, computed HERE. */
  outstanding: Money;
}

/**
 * gross - commission - deduction = net; net - paid = outstanding. Same stance
 * as `priceBreakdown`: recompute, compare with what upstream reported, drop on
 * disagreement. An overpaid period (paid > net) is not represented in v0 and is
 * rejected rather than shown as a negative balance.
 */
export function settlementAmounts(raw: unknown, label: string): SettlementAmounts {
  if (!raw || typeof raw !== 'object') throw partnerError.invalid('settlement_missing', { field: label });
  const r = raw as Record<string, unknown>;
  const gross = money(r.grossVnd, `${label}.grossVnd`);
  const commission = money(r.commissionVnd, `${label}.commissionVnd`);
  const deduction = money(r.deductionVnd, `${label}.deductionVnd`);
  const paid = money(r.paidVnd, `${label}.paidVnd`);
  const net = gross - commission - deduction;
  const outstanding = net - paid;
  if (net < 0 || outstanding < 0) throw partnerError.invalid('settlement_negative', { field: label });
  if (r.netVnd !== undefined && r.netVnd !== net) throw partnerError.invalid('settlement_invariant', { field: label });
  if (r.outstandingVnd !== undefined && r.outstandingVnd !== outstanding) {
    throw partnerError.invalid('settlement_invariant', { field: label });
  }
  return { gross, commission, deduction, net: net as Money, paid, outstanding: outstanding as Money };
}

/** `1200000` -> "1.200.000" (vi) or "1,200,000" (everything else). */
function group(n: number, sep: string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * The string the prompt carries and the model is told to copy verbatim.
 * Vietnamese reads "1.200.000 ₫"; the other UI languages read "1,200,000 VND".
 * `partner-numbers.util` normalises both back to the same integer, so a model
 * that restyles the separator is not penalised — only one that changes the value.
 */
export function formatVnd(amount: number, lang: string): string {
  const code = (lang || 'EN').toUpperCase();
  return code === 'VI' ? `${group(amount, '.')} ₫` : `${group(amount, ',')} VND`;
}

/** "-20.000 ₫" style for the deductions in a breakdown line. */
export function formatVndMinus(amount: number, lang: string): string {
  return `-${formatVnd(amount, lang)}`;
}
