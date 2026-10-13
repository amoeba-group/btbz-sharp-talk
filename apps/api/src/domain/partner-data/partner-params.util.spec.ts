import { PartnerError } from './partner-data.constants';
import { isCalendarDate, looksLikeHotelScopeKey, validateParams } from './partner-params.util';
import type { ParamSpec } from './partner-params.util';

/**
 * Closed parameter sets (PLN-261012 SG-31): exactly the keys a topic names,
 * each with a fixed shape — and no key through which a hotel could be chosen.
 */
describe('validateParams — closed parameter sets', () => {
  const specs: Record<string, ParamSpec> = {
    roomType: { kind: 'pattern', pattern: /^[A-Za-z0-9_-]{1,32}$/ },
    rateType: { kind: 'enum', values: ['hourly', 'overnight', 'daily'] },
    date: { kind: 'date' },
    period: { kind: 'month' },
    size: { kind: 'int', min: 1, max: 50 },
  };

  const rejected = (raw: unknown) => {
    try {
      validateParams(raw, specs);
    } catch (e) {
      expect(e).toBeInstanceOf(PartnerError);
      expect((e as PartnerError).code).toBe('E5104');
      return e as PartnerError;
    }
    throw new Error('expected the parameters to be rejected');
  };

  describe('a hotel identifier is refused whatever it looks like', () => {
    it.each([
      'hotelSn',
      'hotel_sn',
      'hotel_id',
      'hotelId',
      'HotelSN',
      'Hotel-SN',
      'hotel sn',
      'x-hotel',
      'hotel',
      'propertyId',
      'property_id',
      'tenantId',
      'tenant_id',
      'partnerId',
      'branch_id',
      'accommodationId',
      'lodgingId',
      'merchantId',
      'shopId',
      'sn',
      'hsn',
    ])('rejects %s with the hotel_param reason', (key) => {
      const e = rejected({ [key]: '2204', rateType: 'hourly' });
      expect(e.reason).toBe('hotel_param');
      expect(e.detail?.keys).toEqual([key]);
    });

    it('rejects it even next to otherwise valid parameters, and even with an empty value', () => {
      expect(rejected({ rateType: 'daily', hotelSn: '' }).reason).toBe('hotel_param');
    });

    it('never puts the VALUE in the error (only keys are safe to log)', () => {
      const e = rejected({ hotel_id: 'SECRET-2204' });
      expect(JSON.stringify(e.detail)).not.toContain('SECRET-2204');
      expect(e.message).not.toContain('SECRET-2204');
    });

    it('does not flag the legitimate keys', () => {
      for (const k of ['roomType', 'rateType', 'date', 'period', 'size', 'status', 'page', 'bookingCode', 'checkInFrom']) {
        expect(looksLikeHotelScopeKey(k)).toBe(false);
      }
    });
  });

  it('rejects any key outside the topic schema', () => {
    const e = rejected({ rateType: 'hourly', discountCode: 'X' });
    expect(e.reason).toBe('unknown_param');
    expect(e.detail?.keys).toEqual(['discountCode']);
  });

  it('rejects a prototype-pollution style key', () => {
    expect(rejected(JSON.parse('{"__proto__": {"x": 1}}')).reason).toBe('unknown_param');
    expect(rejected({ constructor: 'x' }).reason).toBe('unknown_param');
  });

  it('rejects params that are not a plain object', () => {
    expect(rejected([]).reason).toBe('params_not_object');
    expect(rejected('rateType=hourly').reason).toBe('params_not_object');
  });

  it('rejects non-scalar and wrongly typed values', () => {
    expect(rejected({ rateType: ['hourly'] }).reason).toBe('param_type');
    expect(rejected({ roomType: { a: 1 } }).reason).toBe('param_type');
    expect(rejected({ date: 20261017 }).reason).toBe('param_type');
    expect(rejected({ size: true }).reason).toBe('param_invalid');
  });

  it('rejects values outside their shape', () => {
    expect(rejected({ rateType: 'weekly' }).reason).toBe('param_invalid');
    expect(rejected({ roomType: 'bad type!' }).reason).toBe('param_invalid');
    expect(rejected({ date: '2026-02-30' }).reason).toBe('param_invalid');
    expect(rejected({ date: '17/10/2026' }).reason).toBe('param_invalid');
    expect(rejected({ period: '2026-13' }).reason).toBe('param_invalid');
    expect(rejected({ size: 51 }).reason).toBe('param_invalid');
    expect(rejected({ size: 0 }).reason).toBe('param_invalid');
  });

  it('returns normalised, key-sorted scalars and skips empty values', () => {
    const q = validateParams(
      { size: '20', rateType: ' Overnight ', roomType: 'DELUXE', date: '2026-10-17', period: '', missing: undefined },
      { ...specs, missing: { kind: 'int', min: 0, max: 1 } },
    );
    expect(q).toEqual({ date: '2026-10-17', rateType: 'overnight', roomType: 'DELUXE', size: 20 });
    expect(Object.keys(q)).toEqual(['date', 'rateType', 'roomType', 'size']);
  });

  it('treats undefined / null params as none', () => {
    expect(validateParams(undefined, specs)).toEqual({});
    expect(validateParams(null, specs)).toEqual({});
  });

  it('isCalendarDate rejects roll-over dates', () => {
    expect(isCalendarDate('2026-10-17')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-1-7')).toBe(false);
  });
});
