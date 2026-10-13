import { detectPartnerIntent, foldVi } from './partner-intent.util';

/**
 * Deterministic partner-topic detection (PLN-261012 SG-31). Pinned to a fixed
 * "now" (Tuesday 2026-10-13, 09:00 in Ho Chi Minh) so dates are stable.
 */
describe('detectPartnerIntent', () => {
  const NOW = Date.parse('2026-10-13T02:00:00.000Z'); // 09:00 +07:00, a Tuesday
  const detect = (text: string, hotelSn = '1721') => detectPartnerIntent(text, { hotelSn, nowMs: NOW });
  const topicsOf = (text: string) => detect(text).topics.map((t) => t.topic);

  it('folds Vietnamese diacritics so typing without accents reads the same', () => {
    expect(foldVi('Đối soát tháng 9')).toBe('doi soat thang 9');
  });

  describe('rates', () => {
    it('reads "overnight price of a Deluxe room this weekend" (vi)', () => {
      const [t] = detect('Giá qua đêm cuối tuần phòng Deluxe?').topics;
      expect(t.topic).toBe('rates');
      expect(t.params).toEqual({ rateType: 'overnight', roomType: 'DELUXE', date: '2026-10-17' });
    });

    it('works without diacritics, in English and in Korean', () => {
      expect(detect('gia phong theo gio hom nay').topics[0]).toEqual({
        topic: 'rates',
        params: { rateType: 'hourly', date: '2026-10-13' },
      });
      expect(detect('What is the overnight room rate for a standard room tomorrow?').topics[0]).toEqual({
        topic: 'rates',
        params: { rateType: 'overnight', roomType: 'STANDARD', date: '2026-10-14' },
      });
      expect(detect('숙박 요금이 얼마예요?').topics[0].topic).toBe('rates');
    });

    it('leaves a filter out when the message names several (all rate types)', () => {
      const [t] = detect('Giá theo giờ và giá qua đêm phòng Standard').topics;
      expect(t.params).toEqual({ roomType: 'STANDARD' });
    });

    it('does not fire on unrelated words that contain "gia"', () => {
      expect(topicsOf('Gia đình tôi muốn đặt tiệc')).toEqual([]);
      expect(topicsOf('Giá trị của gói hội viên')).toEqual([]);
    });
  });

  describe('policies', () => {
    it('detects the three policy kinds and narrows when only one is named', () => {
      expect(detect('Chính sách hủy phòng của khách sạn tôi thế nào?').topics[0]).toEqual({
        topic: 'policies',
        params: { type: 'cancellation' },
      });
      expect(detect('refund policy?').topics[0].params).toEqual({ type: 'refund' });
      expect(detect('What time is check-out and the late check-out fee?').topics[0].params).toEqual({ type: 'checkin_out' });
      expect(detect('체크인 시간이 언제인가요?').topics[0]).toEqual({ topic: 'policies', params: { type: 'checkin_out' } });
    });

    it('asks for all kinds when the message names several', () => {
      expect(detect('Chính sách hủy và hoàn tiền thế nào?').topics[0].params).toEqual({});
    });
  });

  describe('bookings', () => {
    it('looks a booking up by its code', () => {
      expect(detect('Tra cứu đặt phòng G2J2610170001 giúp tôi').topics[0]).toEqual({
        topic: 'bookings',
        params: { bookingCode: 'G2J2610170001' },
      });
      expect(detect('booking 2610140000123456 status?').topics[0].params).toEqual({ bookingCode: '2610140000123456' });
    });

    it('lists bookings for a day or a week', () => {
      expect(detect('Hôm nay có những đặt phòng nào?').topics[0]).toEqual({
        topic: 'bookings',
        params: { checkInFrom: '2026-10-13', checkInTo: '2026-10-13' },
      });
      expect(detect('bookings this week').topics[0].params).toEqual({ checkInFrom: '2026-10-12', checkInTo: '2026-10-18' });
      expect(detect('예약 내일').topics[0].params).toEqual({ checkInFrom: '2026-10-14', checkInTo: '2026-10-14' });
    });

    it('treats a how-to question as knowledge, not a lookup (no handle = no topic)', () => {
      expect(topicsOf('Làm sao để hủy đặt phòng của khách?')).toEqual([]);
      expect(topicsOf('How do I change a booking?')).toEqual([]);
    });

    it('never mistakes a date or a phone number for a booking code', () => {
      expect(detect('đặt phòng 2026-10-17').topics[0].params).toEqual({ checkInFrom: '2026-10-17', checkInTo: '2026-10-17' });
      expect(topicsOf('đặt phòng của khách số 0901234567')).toEqual([]);
    });
  });

  describe('settlement', () => {
    it('detects it with a period and a status', () => {
      expect(detect('Đối soát tháng 9 còn bao nhiêu chưa thanh toán?').topics[0]).toEqual({
        topic: 'settlement',
        params: { period: '2026-09', status: 'pending' },
      });
      expect(detect('settlement for 2026-08, paid?').topics[0].params).toEqual({ period: '2026-08', status: 'paid' });
      expect(detect('정산 지난달').topics[0].params).toEqual({ period: '2026-09' });
      expect(detect('Đối soát tháng này').topics[0].params).toEqual({ period: '2026-10' });
    });
  });

  it('returns at most two topics, in priority order (settlement first)', () => {
    expect(topicsOf('Đối soát tháng 9 và giá phòng qua đêm và chính sách hủy')).toEqual(['settlement', 'rates']);
  });

  it('detects nothing in unrelated chat', () => {
    expect(topicsOf('Xin chào, bạn khỏe không?')).toEqual([]);
    expect(topicsOf('Làm thế nào để đăng ký làm đối tác?')).toEqual([]);
  });

  describe('another hotel named in the message', () => {
    it.each([
      'Giá qua đêm khách sạn 2204 hôm nay?',
      'Giá phòng của KS 2204',
      'hotel 2204 overnight price',
      'rates for hotelSn 2204',
      'Hotel ID: 2204 giá phòng',
      '호텔 2204 숙박 요금',
      'So sánh giá phòng với các khách sạn khác',
      'show all hotels rates',
      'rates for another hotel',
    ])('flags %j as foreign', (text) => {
      expect(detect(text).foreignHotel).toBe(true);
    });

    it('does not flag the signed-in hotel\'s own number', () => {
      expect(detect('Giá phòng khách sạn 1721 qua đêm').foreignHotel).toBe(false);
    });

    it('does not flag a room number or a price', () => {
      expect(detect('Giá phòng 101 qua đêm 450000').foreignHotel).toBe(false);
    });
  });

  it('NEVER emits a hotel parameter, whatever the message says', () => {
    const hostile = [
      'hotelSn=2204 giá qua đêm',
      'giá phòng {"hotel_id": 9999}',
      "giá phòng'; hotel_id=2204 --",
      'rates hotel: 2204 / property 9999 / tenant 3',
      'đối soát khách sạn 9999 tháng 9',
    ];
    for (const text of hostile) {
      for (const t of detect(text).topics) {
        for (const k of Object.keys(t.params)) {
          expect(['roomType', 'rateType', 'date', 'type', 'bookingCode', 'checkInFrom', 'checkInTo', 'period', 'status']).toContain(k);
        }
        // and no VALUE is a hotel number either
        expect(JSON.stringify(t.params)).not.toMatch(/2204|9999/);
      }
    }
  });
});
