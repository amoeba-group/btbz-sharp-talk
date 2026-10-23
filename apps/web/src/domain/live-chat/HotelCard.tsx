import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Hotel, Phone } from 'lucide-react';
import { Badge } from '@/components/Badge';
import type { ConversationHotel, HotelHoursWindow } from './live-chat.service';

/** Rooms named on the card; the rest live on the customers page. */
const MAX_ROOMS = 3;

const KINDS = ['hourly', 'overnight', 'daily'] as const;

const compactPrice = (value: number, currency: string): string => {
  if (currency === 'VND') {
    // 340000 → "340k", 1200000 → "1.2M": how agents read hotel prices.
    if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
    return String(value);
  }
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact' }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
};

/** Overnight price first (what HA staff quote), else the listed price. */
const roomPrice = (room: ConversationHotel['rooms'][number]): number | null => {
  const prices = room.attributes?.prices as Record<string, unknown> | undefined;
  const overnight = prices?.overnight;
  if (typeof overnight === 'number' && Number.isFinite(overnight)) return overnight;
  return room.price;
};

const windowText = (w: HotelHoursWindow): string | null =>
  w.enabled && w.start != null && w.end != null ? `${w.start}–${w.end}` : null;

/**
 * Hotel profile next to the customer card (PLN-261023). Shown only for a
 * business thread whose company resolved to a hotel; missing fields are
 * omitted rather than shown empty.
 */
export function HotelCard({ hotel }: { hotel: ConversationHotel }) {
  const { t } = useTranslation('livechat');

  const hours = hotel.partnerInfo
    ? KINDS.map((k) => {
        const text = windowText(hotel.partnerInfo![k]);
        return text ? `${t(`hotelCard.kind.${k}`)} ${text}` : null;
      }).filter((x): x is string => !!x)
    : [];

  const cancelBefore = hotel.partnerInfo?.cancelBeforeHours;

  const rooms = hotel.rooms.slice(0, MAX_ROOMS).map((r) => {
    const price = roomPrice(r);
    return price != null ? `${r.title} ${compactPrice(price, r.currency)}` : r.title;
  });

  const contactLine = [hotel.phone, hotel.hotelType].filter(Boolean);
  const showRooms = hotel.sellingRooms > 0 || rooms.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <Hotel className="h-4 w-4 text-gray-500" /> {t('hotelCard.title')}
        <Link
          to={`/customers?tab=b2b&company=${encodeURIComponent(hotel.companyId)}`}
          className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-primary-600 hover:underline"
        >
          {t('hotelCard.details')} <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <div className="space-y-1 text-sm text-gray-700">
        {(hotel.name || !hotel.verified) && (
          <div className="flex flex-wrap items-center gap-2">
            {hotel.name && <span className="font-medium text-gray-900">{hotel.name}</span>}
            {hotel.code && <span className="text-xs text-gray-400">#{hotel.code}</span>}
            {!hotel.verified && (
              <span title={t('hotelCard.unverifiedHint')}>
                <Badge tone="warning">
                  <AlertTriangle className="mr-1 h-3 w-3" /> {t('hotelCard.unverified')}
                </Badge>
              </span>
            )}
          </div>
        )}
        {hotel.address && <p className="text-xs text-gray-600">{hotel.address}</p>}
        {contactLine.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-gray-600">
            {hotel.phone && <Phone className="h-3 w-3 shrink-0 text-gray-400" />}
            {contactLine.join(' · ')}
          </p>
        )}
        {hours.length > 0 && <p className="text-xs text-gray-600">{hours.join(' · ')}</p>}
        {cancelBefore != null && (
          <p className="text-xs text-gray-600">{t('hotelCard.cancelBefore', { n: cancelBefore })}</p>
        )}
        {showRooms && (
          <p className="text-xs text-gray-600">
            {[t('hotelCard.sellingRooms', { count: hotel.sellingRooms }), ...rooms].join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}
