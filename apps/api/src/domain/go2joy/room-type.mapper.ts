import type { CompanyPartnerInfo } from '../company/entity/company.entity';

/**
 * Partner API shapes → SharpTalk shapes (PLN-261023). Pure functions so the
 * mapping is testable without a network or a database.
 */

/** Hotel Info v2 `data` (fields we read). */
export interface PartnerHotelInfo {
  sn: number;
  name?: string | null;
  firstHours?: number | null;
  hourly?: boolean;
  overnight?: boolean;
  daily?: boolean;
  startHourly?: number | null;
  endHourly?: number | null;
  startOvernight?: number | null;
  endOvernight?: number | null;
  startDaily?: number | null;
  endDaily?: number | null;
  cancelBeforeHours?: number | null;
  startRightNowTonight?: number | null;
  endRightNowTonight?: number | null;
  cancellationPolicy?: {
    freeCancellationHourly?: number | null;
    freeCancellationOvernight?: number | null;
    freeCancellationDaily?: number | null;
    freeCancellationAfterBooking?: number | null;
  } | null;
}

/** Room Type Feed v1 item — the canonical room list: status + list prices. */
export interface PartnerRoomV1 {
  sn: number;
  name: string;
  status?: number | null;
  memo?: string | null;
  square?: number | null;
  firstHours?: number | null;
  additionalHours?: number | null;
  imageUrl?: string | null;
  firstHoursOrigin?: number | null;
  additionalOrigin?: number | null;
  overnightOrigin?: number | null;
  oneDayOrigin?: number | null;
  discount?: boolean;
  extraFee?: boolean;
  flashSale?: boolean;
}

/** Room Type Feed v2 item — adds the facility list, image list and a bed type v1 gets wrong. */
export interface PartnerRoomV2 {
  sn: number;
  bedType?: number | null;
  square?: number | null;
  imageList?: Array<{ imageUrl?: string; firstDisplay?: number }> | null;
  facilityList?: Array<{ name?: string; nameEn?: string }> | null;
  viewList?: Array<{ name?: string; nameEn?: string }> | null;
}

/** Stored in products_cache.attributes for a room type. */
export interface RoomTypeAttributes {
  roomSn: number;
  haStatus: number | null;
  firstHours: number | null;
  additionalHours: number | null;
  prices: { firstHours: number | null; additional: number | null; overnight: number | null; oneDay: number | null };
  extraFee: boolean;
  discount: boolean;
  flashSale: boolean;
  bedType: number | null;
  square: number | null;
  facilities: Array<{ vi: string | null; en: string | null }>;
  /** Room views (v2 `viewList`, PLN-261023 H3). Absent on rows synced before. */
  views?: Array<{ vi: string | null; en: string | null }>;
  images: string[];
  memo: string | null;
  /** Operator-entered — the API has no room count. Kept across syncs. */
  roomCount: number | null;
}

/** HA room status codes seen so far: 1 selling, 4 rejected, 5 stopped (meaning to be confirmed by Go2Joy). */
export const HA_ROOM_STATUS = { SELLING: 1, REJECTED: 4, STOPPED: 5 } as const;

const hour = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** 0 and negatives mean "not offered" in the feed. */
const price = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v : null);

/** A feed list of `{ name (vi), nameEn }` → `{ vi, en }`, dropping empty rows. */
const bilingual = (list: Array<{ name?: string; nameEn?: string }> | null | undefined) =>
  (list ?? [])
    .map((f) => ({ vi: f.name?.trim() || null, en: f.nameEn?.trim() || null }))
    .filter((f) => f.vi || f.en);

export function toPartnerInfo(info: PartnerHotelInfo): CompanyPartnerInfo {
  const c = info.cancellationPolicy;
  const rnStart = hour(info.startRightNowTonight);
  const rnEnd = hour(info.endRightNowTonight);
  return {
    name: info.name?.trim() || null,
    firstHours: hour(info.firstHours),
    hourly: { enabled: !!info.hourly, start: hour(info.startHourly), end: hour(info.endHourly) },
    overnight: { enabled: !!info.overnight, start: hour(info.startOvernight), end: hour(info.endOvernight) },
    daily: { enabled: !!info.daily, start: hour(info.startDaily), end: hour(info.endDaily) },
    cancellation: c
      ? {
          hourlyMinutes: hour(c.freeCancellationHourly),
          overnightMinutes: hour(c.freeCancellationOvernight),
          dailyMinutes: hour(c.freeCancellationDaily),
          afterBookingMinutes: hour(c.freeCancellationAfterBooking),
        }
      : null,
    cancelBeforeHours: hour(info.cancelBeforeHours),
    rightNowTonight: rnStart != null && rnEnd != null ? { start: rnStart, end: rnEnd } : null,
  };
}

export const roomHandle = (hotelSn: number, roomSn: number) => `hotel-${hotelSn}-rt-${roomSn}`;

/** The price a list shows: first hours, else overnight, else one day. */
export function representativePrice(a: RoomTypeAttributes['prices']): number | null {
  return a.firstHours ?? a.overnight ?? a.oneDay ?? null;
}

export function toRoomAttributes(
  v1: PartnerRoomV1,
  v2: PartnerRoomV2 | undefined,
  previousRoomCount: number | null,
): RoomTypeAttributes {
  const images = (v2?.imageList ?? [])
    .slice()
    .sort((a, b) => (b.firstDisplay ?? 0) - (a.firstDisplay ?? 0))
    .map((i) => i.imageUrl)
    .filter((u): u is string => !!u);
  return {
    roomSn: v1.sn,
    haStatus: typeof v1.status === 'number' ? v1.status : null,
    firstHours: hour(v1.firstHours),
    additionalHours: hour(v1.additionalHours),
    prices: {
      firstHours: price(v1.firstHoursOrigin),
      additional: price(v1.additionalOrigin),
      overnight: price(v1.overnightOrigin),
      oneDay: price(v1.oneDayOrigin),
    },
    extraFee: !!v1.extraFee,
    discount: !!v1.discount,
    flashSale: !!v1.flashSale,
    bedType: hour(v2?.bedType),
    square: hour(v2?.square ?? v1.square),
    facilities: bilingual(v2?.facilityList),
    views: bilingual(v2?.viewList),
    images: images.length ? images : v1.imageUrl ? [v1.imageUrl] : [],
    memo: v1.memo?.trim() || null,
    roomCount: previousRoomCount,
  };
}
