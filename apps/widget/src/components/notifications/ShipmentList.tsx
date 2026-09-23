import { useQueries } from '@tanstack/react-query';
import { ExternalLink, PackageSearch } from 'lucide-react';
import { useAnalytics } from '../../lib/analytics';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getTracking } from '../../services/orderService';
import { useOrders } from '../../hooks/useOrders';
import { Badge, toneForStatus } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { TrackingStepperH } from '../orders/TrackingStepperH';
import { isShipmentish, statusLabel } from '../orders/order-status';
import type { OrderSummary, Tracking } from '../../lib/types';

/**
 * How many shipments render their progress. Tracking is one request per order
 * (`GET /orders/:id/tracking`), so an unbounded list would fan out to a request
 * per row. Five is what the design shows before the shopper scrolls, and the
 * rest stay reachable through "see all orders".
 */
const TRACKED_MAX = 5;

/**
 * `orders.trackingSteps` is the one translation key that is an ARRAY, and
 * `returnObjects` hands back whatever the bundle holds. A locale that lost the
 * key, or defined it as a string, would make this a non-array — and the `.map`
 * downstream would throw, replacing the whole Shipping filter with an error
 * boundary. Validate rather than cast.
 */
function trackingStepLabels(t: TFunction): string[] {
  const raw = t('orders.trackingSteps', { returnObjects: true });
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
}

function ShipmentCard({
  order,
  tracking,
  loading,
  onOpen,
}: {
  order: OrderSummary;
  tracking: Tracking | undefined;
  loading: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const analytics = useAnalytics();
  const fallbackSteps = trackingStepLabels(t);
  const steps = tracking?.steps?.length ? tracking.steps : fallbackSteps;
  const delivered = !!tracking && tracking.stepIndex >= steps.length - 1;

  const summary = order.firstItemTitle
    ? order.itemCount > 1
      ? t('orders.itemsMore', { title: order.firstItemTitle, count: order.itemCount - 1 })
      : order.firstItemTitle
    : t('orders.itemCount', { count: order.itemCount });

  return (
    <div className="border-b border-gray-100 px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-base font-bold text-gray-900">{order.orderNumber}</span>
        {statusLabel(t, order) && (
          <Badge tone={toneForStatus(order.statusInternal ?? order.statusUi)}>
            {statusLabel(t, order)}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-700">{summary}</p>

      <div className="mt-4">
        {loading && !tracking ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <TrackingStepperH
            tracking={tracking ?? { status: '', carrier: null, trackingNumber: null, stepIndex: -1, steps: [] }}
            labels={fallbackSteps}
          />
        )}
      </div>

      {tracking && (
        <p
          className={`mt-3 text-center text-sm ${
            delivered ? 'text-gray-500' : 'font-bold text-warning'
          }`}
        >
          {delivered ? t('orders.shipmentDelivered') : t('orders.shipmentInTransit')}
        </p>
      )}

      {/* Same rule as the order detail's Track row (PLN-260923 P2): the
          carrier's own page when we have one, otherwise the order detail. */}
      {tracking?.trackingUrl ? (
        <a
          href={tracking.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => analytics.trackingView(order.id, true)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-st-md border border-gray-300 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50"
        >
          {t('orders.trackingCta')}
          <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
        </a>
      ) : (
        <button
          onClick={onOpen}
          className="mt-3 w-full rounded-st-md border border-gray-300 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50"
        >
          {t('orders.trackingCta')}
        </button>
      )}
    </div>
  );
}

/**
 * The Shipping filter of the notification tab (PLN-260817 W-2).
 *
 * This is the one filter that does NOT read the notification feed: the design
 * shows live shipment progress here, which lives on the order, not on the
 * notification row that announced it.
 */
export function ShipmentList({
  sessionToken,
  onOpenOrder,
}: {
  sessionToken: string | null;
  onOpenOrder: (orderId: string) => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useOrders(sessionToken);
  const shipments = (data ?? []).filter(isShipmentish).slice(0, TRACKED_MAX);

  const trackingQueries = useQueries({
    queries: shipments.map((o) => ({
      queryKey: ['tracking', o.id, sessionToken],
      queryFn: () => getTracking(o.id, sessionToken!),
      enabled: !!sessionToken,
      staleTime: 60_000,
    })),
  });

  if (isLoading) return <Spinner label={t('common.loading')} />;
  if (isError) return <p className="py-8 text-center text-sm text-gray-400">{t('common.error')}</p>;
  if (shipments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
        <PackageSearch className="h-6 w-6" />
        <span className="text-sm">{t('orders.noShipments')}</span>
      </div>
    );
  }

  return (
    <div>
      {shipments.map((order, i) => (
        <ShipmentCard
          key={order.id}
          order={order}
          tracking={trackingQueries[i]?.data}
          loading={!!trackingQueries[i]?.isLoading}
          onOpen={() => onOpenOrder(order.id)}
        />
      ))}
    </div>
  );
}
