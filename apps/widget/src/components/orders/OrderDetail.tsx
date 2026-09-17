import { useEffect, useState } from 'react';
import { ArrowLeft, MessageSquare, Truck, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWidgetStore } from '../../store/widgetStore';
import { isAuthError } from '../../lib/errors';
import { useOrder, useTracking } from '../../hooks/useOrders';
import { useAnalytics } from '../../lib/analytics';
import { Badge, toneForStatus } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { formatMoney } from '../../lib/format';
import { TrackingStepper } from './TrackingStepper';
import { isDelivered as isOrderDeliveredStatus, statusLabel } from './order-status';
import { ReviewForm } from './ReviewForm';

export function OrderDetailView({
  orderId,
  sessionToken,
  onBack,
  onAsk,
}: {
  orderId: string;
  sessionToken: string | null;
  onBack: () => void;
  onAsk: (orderNumber: string) => void;
}) {
  const { t } = useTranslation();
  const analytics = useAnalytics();
  const { data, isLoading, isError, error } = useOrder(orderId, sessionToken);
  const setAuthenticated = useWidgetStore((s) => s.setAuthenticated);
  const [showTrack, setShowTrack] = useState(false);
  const [reviewItemId, setReviewItemId] = useState<string | null>(null);
  const tracking = useTracking(showTrack ? orderId : null, sessionToken);

  // Session no longer customer-bound → clear the flag; NotificationsTab (our
  // parent since the Orders tab was retired) then renders the sign-in prompt
  // instead of us showing a generic error.
  const authLost = isError && isAuthError(error);
  useEffect(() => {
    if (authLost) setAuthenticated(false);
  }, [authLost, setAuthenticated]);

  if (isLoading) return <Spinner label={t('common.loading')} />;
  if (authLost) return <Spinner label={t('common.loading')} />; // parent takes over
  if (isError || !data)
    return (
      <p className="py-8 text-center text-sm text-gray-400">
        {t('common.error')}
      </p>
    );

  // The API returns the order fields FLAT with `items` inline (OrderMapper.toDetail)
  // — there is no nested `order` object (FIX-Widget-OrderDetail-Shape-20260803).
  const order = data;
  const items = data.items ?? [];
  // Was a substring test on the platform's wording, which reads "delivery
  // failed" as delivered. Shared allowlist now, same as the list.
  const delivered = isOrderDeliveredStatus(order);

  return (
    <div className="scroll-thin h-full overflow-y-auto p-3">
      <button
        onClick={onBack}
        className="mb-3 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('orders.back')}
      </button>

      <div className="mb-3 rounded-st-md border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">
            #{order.orderNumber}
          </span>
          {/* Translated, like the list row. Showing "Confirmed" here while the
              row that led here said 결제완료 makes one order look like two. */}
          <Badge tone={toneForStatus(order.statusInternal ?? order.statusUi)}>
            {statusLabel(t, order)}
          </Badge>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-gray-500">{t('orders.total')}</span>
          <span className="font-semibold text-gray-900">
            {formatMoney(order.total, order.currency)}
          </span>
        </div>
      </div>

      <div className="mb-2 text-xs font-medium text-gray-400">
        {t('orders.items')}
      </div>
      <div className="mb-3 space-y-2">
        {items.map((it, i) => (
          <div
            key={it.id ?? i}
            className="rounded-st-md border border-gray-200 bg-white p-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-800">
                  {it.title}
                </div>
                {it.optionText && (
                  <div className="text-xs text-gray-500">{it.optionText}</div>
                )}
                <div className="text-xs text-gray-400">x{it.qty}</div>
              </div>
              <span className="flex-shrink-0 text-sm text-gray-700">
                {formatMoney(it.price, order.currency)}
              </span>
            </div>
            {delivered && it.id && (
              <button
                onClick={() => setReviewItemId(it.id!)}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
              >
                <Star className="h-3.5 w-3.5" />
                {t('orders.writeReview')}
              </button>
            )}
          </div>
        ))}
      </div>

      {reviewItemId && (
        <div className="mb-3">
          <ReviewForm
            sessionToken={sessionToken}
            orderItemId={reviewItemId}
            onClose={() => setReviewItemId(null)}
          />
        </div>
      )}

      {showTrack && tracking.data && (
        <div className="mb-3">
          <TrackingStepper tracking={tracking.data} />
        </div>
      )}
      {showTrack && tracking.isLoading && <Spinner />}

      {/* Pinned so the actions stay reachable on a long order instead of being
          pushed below the fold by the item list. */}
      <div className="sticky bottom-0 -mx-3 flex gap-2 border-t border-gray-100 bg-white px-3 pb-1 pt-2">
        <button
          onClick={() => {
            const next = !showTrack;
            setShowTrack(next);
            if (next) analytics.trackingView(orderId);
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-st-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Truck className="h-4 w-4" />
          {t('orders.track')}
        </button>
        <button
          onClick={() => onAsk(order.orderNumber)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-st-md bg-primary-500 px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-600"
        >
          <MessageSquare className="h-4 w-4" />
          {t('orders.ask')}
        </button>
      </div>
    </div>
  );
}
