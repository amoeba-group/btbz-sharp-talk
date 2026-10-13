import { PartnerError } from './partner-data.constants';
import { MONEY_MAX, formatVnd, money, moneyOpt, priceBreakdown, settlementAmounts } from './money.util';

/** The model must never do arithmetic on a price: the server computes and checks it (SG-31). */
describe('money util', () => {
  const invalid = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(PartnerError);
      expect((e as PartnerError).code).toBe('E5105');
      return (e as PartnerError).reason;
    }
    throw new Error('expected a PartnerError');
  };

  describe('money()', () => {
    it('accepts integer VND', () => {
      expect(money(0)).toBe(0);
      expect(money(450000)).toBe(450000);
      expect(money(MONEY_MAX)).toBe(MONEY_MAX);
    });

    it.each([450000.5, -1, NaN, Infinity, '450000', null, undefined, {}, MONEY_MAX + 1])(
      'rejects %p (floats, negatives, strings, unit errors are upstream defects)',
      (bad) => {
        expect(invalid(() => money(bad, 'x'))).toBe('money_not_integer_vnd');
      },
    );

    it('moneyOpt leaves absent values absent but still validates present ones', () => {
      expect(moneyOpt(undefined, 'x')).toBeUndefined();
      expect(moneyOpt(null, 'x')).toBeUndefined();
      expect(moneyOpt(100, 'x')).toBe(100);
      expect(invalid(() => moneyOpt(1.5, 'x'))).toBe('money_not_integer_vnd');
    });
  });

  describe('priceBreakdown() — base + extra − direct discount − flash sale − coupon = final', () => {
    const parts = { baseVnd: 450000, extraVnd: 50000, directDiscountVnd: 10000, flashSaleVnd: 25000, couponVnd: 30000 };

    it('computes the final amount itself', () => {
      const b = priceBreakdown(parts, 'r');
      expect(b.final).toBe(450000 + 50000 - 10000 - 25000 - 30000);
      expect(b.final).toBe(435000);
    });

    it('accepts an upstream finalVnd that agrees', () => {
      expect(priceBreakdown({ ...parts, finalVnd: 435000 }, 'r').final).toBe(435000);
    });

    it('drops a reply whose own finalVnd disagrees (invariant violated)', () => {
      expect(invalid(() => priceBreakdown({ ...parts, finalVnd: 440000 }, 'r'))).toBe('breakdown_invariant');
    });

    it('drops a reply whose discounts exceed the price', () => {
      expect(invalid(() => priceBreakdown({ ...parts, couponVnd: 999999 }, 'r'))).toBe('breakdown_negative');
    });

    it('drops a reply with a missing or non-integer component', () => {
      const { couponVnd: _omit, ...missing } = parts;
      expect(invalid(() => priceBreakdown(missing, 'r'))).toBe('money_not_integer_vnd');
      expect(invalid(() => priceBreakdown({ ...parts, extraVnd: 5000.5 }, 'r'))).toBe('money_not_integer_vnd');
      expect(invalid(() => priceBreakdown(null, 'r'))).toBe('breakdown_missing');
    });
  });

  describe('settlementAmounts() — gross − commission − deduction = net; net − paid = outstanding', () => {
    const row = { grossVnd: 48500000, commissionVnd: 7275000, deductionVnd: 500000, paidVnd: 10000000 };

    it('computes net and outstanding itself', () => {
      const a = settlementAmounts(row, 's');
      expect(a.net).toBe(40725000);
      expect(a.outstanding).toBe(30725000);
    });

    it('rejects a reported net or outstanding that does not follow', () => {
      expect(invalid(() => settlementAmounts({ ...row, netVnd: 40000000 }, 's'))).toBe('settlement_invariant');
      expect(invalid(() => settlementAmounts({ ...row, outstandingVnd: 1 }, 's'))).toBe('settlement_invariant');
    });

    it('rejects an overpaid period rather than showing a negative balance', () => {
      expect(invalid(() => settlementAmounts({ ...row, paidVnd: 50000000 }, 's'))).toBe('settlement_negative');
    });
  });

  describe('formatVnd()', () => {
    it('writes Vietnamese with dot grouping and the dong sign', () => {
      expect(formatVnd(1200000, 'VI')).toBe('1.200.000 ₫');
      expect(formatVnd(0, 'vi')).toBe('0 ₫');
      expect(formatVnd(450000, 'VI')).toBe('450.000 ₫');
    });

    it('writes every other language with comma grouping and VND', () => {
      expect(formatVnd(1200000, 'EN')).toBe('1,200,000 VND');
      expect(formatVnd(999, 'KO')).toBe('999 VND');
      expect(formatVnd(40725000, 'ZH')).toBe('40,725,000 VND');
    });
  });
});
