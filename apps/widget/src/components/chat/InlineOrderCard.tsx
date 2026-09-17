import { useTranslation } from 'react-i18next';
import { Badge, toneForStatus } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { formatMoney } from '../../lib/format';
import { useOrders } from '../../hooks/useOrders';
import type { OrderSummary } from '../../lib/types';

/** How many orders the in-thread answer shows before pointing elsewhere. */
const INLINE_MAX = 3;

/**
 * An order rendered inside the chat thread (PLN-260817 W-5, frame 57).
 *
 * "My orders" used to throw the shopper into a different tab mid-conversation.
 * The design answers in place instead, so the question and its answer stay in
 * one thread — which is also why these cards are not links: leaving is the
 * behaviour being removed.
 */
export function InlineOrderCard({ order }: { order: OrderSummary }) {
  const { t } = useTranslation();
  const summary = order.firstItemTitle
    ? order.itemCount > 1
      ? t('orders.itemsMore', { title: order.firstItemTitle, count: order.itemCount - 1 })
      : `${order.firstItemTitle}${order.total != null ? ` · ${formatMoney(order.total, order.currency)}` : ''}`
    : t('orders.itemCount', { count: order.itemCount });

  return (
    <div className="rounded-st-lg border border-gray-200 bg-white px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-gray-900">{order.orderNumber}</span>
        {order.statusUi && <Badge tone={toneForStatus(order.statusUi)}>{order.statusUi}</Badge>}
      </div>
      <p className="mt-1 text-sm text-gray-700">{summary}</p>
    </div>
  );
}

/**
 * The whole "My orders" answer: the bot's lead-in line plus the cards
 * (PLN-260817 W-5). Mounted only while the answer is on screen, so the orders
 * request is not made for shoppers who never ask.
 */
export function InlineOrdersAnswer({ sessionToken }: { sessionToken: string | null }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useOrders(sessionToken);
  const orders = (data ?? []).slice(0, INLINE_MAX);

  if (isLoading) return <Spinner label={t('common.loading')} />;
  if (isError) {
    return <p className="text-sm text-gray-400">{t('common.error')}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="max-w-[85%] rounded-st-lg bg-gray-100 px-3.5 py-2.5 text-sm text-gray-800">
        {orders.length ? t('orders.inlineLead') : t('orders.emptyRecent')}
      </div>
      {orders.map((o) => (
        <div key={o.id} className="pl-3">
          <InlineOrderCard order={o} />
        </div>
      ))}
    </div>
  );
}
