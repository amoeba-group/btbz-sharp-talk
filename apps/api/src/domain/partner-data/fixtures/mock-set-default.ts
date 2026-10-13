/**
 * Mock partner data (PLN-261012 SG-31) in the WIRE shape of
 * docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml — i.e. what the real API
 * would send, extra fields included.
 *
 * Fictional hotels only. Two of them are real-looking tenants of the demo
 * (1721, 2204); `9999` is a DECOY that exists to make a cross-hotel leak loud:
 * its numbers (777.777, 999.999 …) and booking codes are unmistakable, and no
 * test may ever see them while acting for another hotel.
 *
 * Some bookings carry fields the contract forbids (guestName, guestPhone,
 * internalNote): a real upstream might send them by mistake, and the projector
 * must drop them — see partner-topics.spec.ts.
 */

type Json = Record<string, unknown>;

export interface MockHotel {
  hotelName: string;
  policies: Json[];
  /** Rate templates; `date` and the weekend surcharge are filled per request. */
  rates: Array<{
    roomType: string;
    roomTypeName: string;
    rateType: 'hourly' | 'overnight' | 'daily';
    includedHours?: number;
    extraHourVnd?: number;
    baseVnd: number;
    weekendExtraVnd: number;
    directDiscountVnd: number;
    flashSaleVnd: number;
    couponVnd: number;
  }>;
  bookings: Json[];
  settlements: Json[];
}

export type MockSet = Record<string, MockHotel>;

const breakdown = (base: number, extra: number, direct: number, flash: number, coupon: number): Json => ({
  baseVnd: base,
  extraVnd: extra,
  directDiscountVnd: direct,
  flashSaleVnd: flash,
  couponVnd: coupon,
  finalVnd: base + extra - direct - flash - coupon,
});

export const DEFAULT_MOCK_SET: MockSet = {
  // --- A In Hotel Del Luna ----------------------------------------------------
  '1721': {
    hotelName: 'A In Hotel Del Luna',
    policies: [
      {
        type: 'cancellation',
        rules: [
          { hoursBeforeCheckIn: 24, refundPercent: 100 },
          { hoursBeforeCheckIn: 2, refundPercent: 50 },
          { hoursBeforeCheckIn: 0, refundPercent: 0 },
        ],
        noShowRefundPercent: 0,
        note: 'Hoàn tiền về phương thức thanh toán ban đầu.',
      },
      { type: 'refund', processingDays: 7, method: 'original_payment' },
      {
        type: 'checkin_out',
        standardCheckIn: '14:00',
        standardCheckOut: '12:00',
        hourlyMaxHours: 3,
        overnightStart: '22:00',
        overnightEnd: '12:00',
        earlyCheckInFeeVnd: 100000,
        lateCheckOutFeeVnd: 150000,
        note: 'Nhận phòng sớm tùy tình trạng phòng.',
      },
    ],
    rates: [
      { roomType: 'STANDARD', roomTypeName: 'Standard', rateType: 'hourly', includedHours: 2, extraHourVnd: 40000, baseVnd: 120000, weekendExtraVnd: 20000, directDiscountVnd: 10000, flashSaleVnd: 0, couponVnd: 0 },
      { roomType: 'STANDARD', roomTypeName: 'Standard', rateType: 'overnight', baseVnd: 350000, weekendExtraVnd: 50000, directDiscountVnd: 20000, flashSaleVnd: 30000, couponVnd: 0 },
      { roomType: 'STANDARD', roomTypeName: 'Standard', rateType: 'daily', baseVnd: 520000, weekendExtraVnd: 80000, directDiscountVnd: 0, flashSaleVnd: 0, couponVnd: 0 },
      { roomType: 'DELUXE', roomTypeName: 'Deluxe', rateType: 'hourly', includedHours: 2, extraHourVnd: 60000, baseVnd: 180000, weekendExtraVnd: 30000, directDiscountVnd: 0, flashSaleVnd: 15000, couponVnd: 0 },
      { roomType: 'DELUXE', roomTypeName: 'Deluxe', rateType: 'overnight', baseVnd: 450000, weekendExtraVnd: 50000, directDiscountVnd: 0, flashSaleVnd: 25000, couponVnd: 0 },
      { roomType: 'DELUXE', roomTypeName: 'Deluxe', rateType: 'daily', baseVnd: 690000, weekendExtraVnd: 110000, directDiscountVnd: 40000, flashSaleVnd: 0, couponVnd: 0 },
    ],
    bookings: [
      {
        bookingCode: 'G2J2610170001',
        status: 'confirmed',
        roomType: 'DELUXE',
        rateType: 'overnight',
        checkInAt: '2026-10-17T22:00:00+07:00',
        checkOutAt: '2026-10-18T12:00:00+07:00',
        guestCount: 2,
        paymentStatus: 'paid',
        breakdown: breakdown(450000, 50000, 0, 25000, 30000),
        // Forbidden by the contract; must never reach the prompt:
        guestName: 'Nguyen Van A',
        guestPhone: '0901234567',
        internalNote: 'khách VIP, gọi trước khi đến',
      },
      {
        bookingCode: 'G2J2610150042',
        status: 'checked_out',
        roomType: 'STANDARD',
        rateType: 'hourly',
        checkInAt: '2026-10-15T15:00:00+07:00',
        checkOutAt: '2026-10-15T18:00:00+07:00',
        guestCount: 1,
        paymentStatus: 'paid',
        breakdown: breakdown(120000, 0, 10000, 0, 0),
        guestName: 'Tran Thi B',
      },
      {
        // A 16-digit code: the default moderation mask (13-16 digits) would eat it.
        bookingCode: '2610140000123456',
        status: 'cancelled',
        roomType: 'STANDARD',
        rateType: 'overnight',
        checkInAt: '2026-10-14T22:00:00+07:00',
        checkOutAt: '2026-10-15T12:00:00+07:00',
        guestCount: 2,
        paymentStatus: 'refunded',
        breakdown: breakdown(350000, 0, 20000, 30000, 0),
      },
    ],
    settlements: [
      {
        period: '2026-09',
        status: 'pending',
        bookingCount: 120,
        grossVnd: 48500000,
        commissionVnd: 7275000,
        deductionVnd: 500000,
        netVnd: 40725000,
        paidVnd: 0,
        outstandingVnd: 40725000,
        dueDate: '2026-10-15',
        reference: 'STL-1721-202609',
      },
      {
        period: '2026-08',
        status: 'paid',
        bookingCount: 131,
        grossVnd: 52000000,
        commissionVnd: 7800000,
        deductionVnd: 0,
        netVnd: 44200000,
        paidVnd: 44200000,
        outstandingVnd: 0,
        dueDate: '2026-09-15',
        paidAt: '2026-09-15T10:00:00+07:00',
        reference: 'STL-1721-202608',
      },
    ],
  },

  // --- Khách sạn Biển Xanh ----------------------------------------------------
  '2204': {
    hotelName: 'Khách sạn Biển Xanh',
    policies: [
      {
        type: 'cancellation',
        rules: [
          { hoursBeforeCheckIn: 48, refundPercent: 100 },
          { hoursBeforeCheckIn: 12, refundPercent: 30 },
          { hoursBeforeCheckIn: 0, refundPercent: 0 },
        ],
        noShowRefundPercent: 0,
      },
      { type: 'refund', processingDays: 14, method: 'bank_transfer' },
      { type: 'checkin_out', standardCheckIn: '13:00', standardCheckOut: '11:00', hourlyMaxHours: 4 },
    ],
    rates: [
      { roomType: 'STANDARD', roomTypeName: 'Standard', rateType: 'overnight', baseVnd: 280000, weekendExtraVnd: 40000, directDiscountVnd: 0, flashSaleVnd: 0, couponVnd: 0 },
      { roomType: 'DELUXE', roomTypeName: 'Deluxe', rateType: 'overnight', baseVnd: 390000, weekendExtraVnd: 60000, directDiscountVnd: 10000, flashSaleVnd: 0, couponVnd: 0 },
    ],
    bookings: [
      {
        bookingCode: 'BX2610170009',
        status: 'confirmed',
        roomType: 'DELUXE',
        rateType: 'overnight',
        checkInAt: '2026-10-17T21:00:00+07:00',
        checkOutAt: '2026-10-18T11:00:00+07:00',
        guestCount: 2,
        paymentStatus: 'unpaid',
        breakdown: breakdown(390000, 60000, 10000, 0, 0),
      },
    ],
    settlements: [
      {
        period: '2026-09',
        status: 'pending',
        bookingCount: 64,
        grossVnd: 21300000,
        commissionVnd: 3195000,
        deductionVnd: 0,
        netVnd: 18105000,
        paidVnd: 10000000,
        outstandingVnd: 8105000,
        dueDate: '2026-10-15',
        reference: 'STL-2204-202609',
      },
    ],
  },

  // --- DECOY: nobody may ever see these while acting for another hotel -------
  '9999': {
    hotelName: 'Decoy Hotel (must never leak)',
    policies: [
      {
        type: 'cancellation',
        rules: [{ hoursBeforeCheckIn: 99, refundPercent: 77 }],
        noShowRefundPercent: 77,
        note: 'DECOY-POLICY-MARKER',
      },
    ],
    rates: [
      { roomType: 'DELUXE', roomTypeName: 'Deluxe', rateType: 'overnight', baseVnd: 777777, weekendExtraVnd: 11111, directDiscountVnd: 0, flashSaleVnd: 0, couponVnd: 0 },
      { roomType: 'STANDARD', roomTypeName: 'Standard', rateType: 'overnight', baseVnd: 999999, weekendExtraVnd: 11111, directDiscountVnd: 0, flashSaleVnd: 0, couponVnd: 0 },
    ],
    bookings: [
      {
        bookingCode: 'DECOY2610170001',
        status: 'confirmed',
        roomType: 'DELUXE',
        rateType: 'overnight',
        checkInAt: '2026-10-17T22:00:00+07:00',
        checkOutAt: '2026-10-18T12:00:00+07:00',
        paymentStatus: 'paid',
        breakdown: breakdown(777777, 0, 0, 0, 0),
      },
    ],
    settlements: [
      {
        period: '2026-09',
        status: 'pending',
        bookingCount: 999,
        grossVnd: 999999999,
        commissionVnd: 99999999,
        deductionVnd: 0,
        netVnd: 900000000,
        paidVnd: 0,
        outstandingVnd: 900000000,
        reference: 'DECOY-STL-9999',
      },
    ],
  },
};

/** Named fixture sets (golden questions pick one by name). */
export const MOCK_SETS: Record<string, MockSet> = {
  default: DEFAULT_MOCK_SET,
};
