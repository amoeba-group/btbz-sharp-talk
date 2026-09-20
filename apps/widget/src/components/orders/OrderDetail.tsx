import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, MessageSquare, Package, Star, Truck } from 'lucide-react';
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

/**
 * One line of the money block. Labels sit left, values right; `strong` is the
 * Total row and `negative` the discount, which the design paints red.
 */
function MoneyRow({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span
        className={
          negative
            ? 'font-semibold text-error'
            : strong
              ? 'font-semibold text-gray-900'
              : 'text-gray-500'
        }
      >
        {label}
      </span>
      <span
        className={
          negative
            ? 'font-semibold text-error'
            : strong
              ? 'font-semibold text-gray-900'
              : 'text-gray-700'
        }
      >
        {value}
      </span>
    </div>
  );
}

/**
 * A full-width action row (PLN-260920 §2): the design replaced the two pinned
 * buttons with rows, so tracking and "ask" read as a list rather than a toolbar.
 */
function ActionRow({
  icon,
  label,
  open,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** Tracking expands in place; undefined = a row that navigates instead. */
  open?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      className="flex w-full items-center gap-2.5 py-3 text-sm font-medium text-gray-800 hover:text-gray-900"
    >
      <span className="text-gray-400">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {open === true ? (
        <ChevronDown className="h-4 w-4 text-gray-300" />
      ) : (
        <ChevronRight className="h-4 w-4 text-gray-300" />
      )}
    </button>
  );
}

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
    <div className="flex h-full flex-col">
      {/* Centred title with the back arrow beside it (Figma 345-17800). The
          spacer keeps the title optically centred without absolute positioning. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-2.5">
        <button
          onClick={onBack}
          aria-label={t('orders.back')}
          className="rounded-st-md p-1 text-gray-500 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="flex-1 text-center text-sm font-semibold text-gray-900">
          {t('orders.detail')}
        </h2>
        <span className="h-6 w-6" aria-hidden="true" />
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* Order number + status. The design shows the number alone, but the
            badge stays: the list row that led here shows one, and dropping it
            here makes the same order look like two (PLN §2-1). */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900">
            #{order.orderNumber}
          </span>
          <Badge tone={toneForStatus(order.statusInternal ?? order.statusUi)}>
            {statusLabel(t, order)}
          </Badge>
        </div>

        <ul className="divide-y divide-gray-50">
          {items.map((it, i) => {
            // Option text is only present on orders that arrived through the
            // webhook path; the scheduled GraphQL sync cannot read it without
            // the read_products scope (PLN §1). Absent → the line just carries
            // the quantity rather than an empty separator.
            const meta = [it.optionText, t('orders.qty', { count: it.qty })]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={it.id ?? i} className="flex gap-3 py-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-st-md bg-gray-100">
                  <Package className="h-5 w-5 text-gray-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-sm text-gray-900">
                      {it.title}
                    </span>
                    <span className="flex-shrink-0 text-sm text-gray-900">
                      {formatMoney(it.price, order.currency)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400">{meta}</div>
                  {delivered && it.id && (
                    <button
                      onClick={() => setReviewItemId(it.id!)}
                      className="mt-1.5 flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
                    >
                      <Star className="h-3.5 w-3.5" />
                      {t('orders.writeReview')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {reviewItemId && (
          <div className="my-3">
            <ReviewForm
              sessionToken={sessionToken}
              orderItemId={reviewItemId}
              onClose={() => setReviewItemId(null)}
            />
          </div>
        )}

        {/* Money. Only Total is always known; the breakdown rows appear as the
            sync fills them in and stay hidden otherwise — a missing subtotal
            must not read as zero (PLN §2-3). */}
        {order.discountTotal != null && order.discountTotal > 0 && (
          <div className="mt-1 border-t border-gray-100 pt-2">
            <MoneyRow
              label={t('orders.discount')}
              value={`-${formatMoney(order.discountTotal, order.currency)}`}
              negative
            />
          </div>
        )}
        <div className="mt-1 border-t border-gray-100 pt-2">
          {order.subtotal != null && (
            <MoneyRow
              label={`${t('orders.subtotal')} · ${t('orders.itemCount', {
                count: order.itemQty ?? items.length,
              })}`}
              value={formatMoney(order.subtotal, order.currency)}
            />
          )}
          {order.shippingTotal != null && (
            <MoneyRow
              label={t('orders.shipping')}
              value={
                order.shippingTotal === 0
                  ? t('orders.shippingFree')
                  : formatMoney(order.shippingTotal, order.currency)
              }
            />
          )}
          <MoneyRow
            label={t('orders.total')}
            value={`${order.currency ?? ''} ${formatMoney(order.total, order.currency)}`.trim()}
            strong
          />
        </div>

        <div className="mt-2 border-t border-gray-100">
          <ActionRow
            icon={<Truck className="h-4 w-4" />}
            label={t('orders.track')}
            open={showTrack}
            onClick={() => {
              const next = !showTrack;
              setShowTrack(next);
              if (next) analytics.trackingView(orderId);
            }}
          />
          {showTrack && tracking.isLoading && <Spinner />}
          {showTrack && tracking.data && (
            <div className="pb-3">
              <TrackingStepper tracking={tracking.data} />
            </div>
          )}
          <div className="border-t border-gray-100">
            <ActionRow
              icon={<MessageSquare className="h-4 w-4" />}
              label={t('orders.askRow')}
              onClick={() => onAsk(order.orderNumber)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
