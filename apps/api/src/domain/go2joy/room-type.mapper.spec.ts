import { representativePrice, roomHandle, toPartnerInfo, toRoomAttributes } from './room-type.mapper';

/** Values from the 2026-10-23 staging-partner response for hotel 4118 (PLN-261023). */
describe('room-type.mapper', () => {
  it('maps Hotel Info hours and cancellation policy', () => {
    expect(
      toPartnerInfo({
        sn: 4118,
        name: ' Lá Hotel Quận 10 ',
        firstHours: 1,
        hourly: true,
        overnight: true,
        daily: true,
        startHourly: 7,
        endHourly: 21,
        startOvernight: 21,
        endOvernight: 12,
        startDaily: 14,
        endDaily: 12,
        cancellationPolicy: { freeCancellationHourly: 60, freeCancellationOvernight: 120, freeCancellationDaily: 120, freeCancellationAfterBooking: 5 },
      }),
    ).toEqual({
      name: 'Lá Hotel Quận 10',
      firstHours: 1,
      hourly: { enabled: true, start: 7, end: 21 },
      overnight: { enabled: true, start: 21, end: 12 },
      daily: { enabled: true, start: 14, end: 12 },
      cancellation: { hourlyMinutes: 60, overnightMinutes: 120, dailyMinutes: 120, afterBookingMinutes: 5 },
    });
  });

  it('merges v1 prices/status with v2 facilities/images and keeps the entered room count', () => {
    const a = toRoomAttributes(
      { sn: 11360, name: 'Standard Room', status: 1, square: 15, firstHours: 2, additionalHours: 1, imageUrl: 'v1.jpg',
        firstHoursOrigin: 60000, additionalOrigin: 65000, overnightOrigin: 340000, oneDayOrigin: 450000, extraFee: false },
      { sn: 11360, bedType: 2, square: 15, imageList: [{ imageUrl: 'b.jpg', firstDisplay: 0 }, { imageUrl: 'a.jpg', firstDisplay: 1 }],
        facilityList: [{ name: 'máy sấy', nameEn: 'dryer' }] },
      14,
    );
    expect(a).toMatchObject({
      roomSn: 11360,
      haStatus: 1,
      prices: { firstHours: 60000, additional: 65000, overnight: 340000, oneDay: 450000 },
      bedType: 2,
      facilities: [{ vi: 'máy sấy', en: 'dryer' }],
      images: ['a.jpg', 'b.jpg'],
      roomCount: 14,
    });
  });

  it('0 means "not offered"; the list price falls back first hours → overnight → one day', () => {
    const a = toRoomAttributes({ sn: 1, name: 'x', firstHoursOrigin: 0, overnightOrigin: 0, oneDayOrigin: 123000 }, undefined, null);
    expect(a.prices).toEqual({ firstHours: null, additional: null, overnight: null, oneDay: 123000 });
    expect(representativePrice(a.prices)).toBe(123000);
    expect(a.images).toEqual([]);
  });

  it('room handles are stable per hotel and room', () => {
    expect(roomHandle(4118, 11360)).toBe('hotel-4118-rt-11360');
  });
});
