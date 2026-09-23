import { useEffect, useState } from 'react';
import { BellOff, Check, ExternalLink, Lock, Star } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useWidgetStore, type TabKey } from '../../store/widgetStore';
import { AuthGate } from '../chat/AuthGate';
import { isAuthError } from '../../lib/errors';
import { useDeleteNotifications, useMarkRead, useNotifications } from '../../hooks/useNotifications';
import { listIssues, type IssueFeedItem } from '../../services/orderService';
import { myPageOrdersUrl } from '../../lib/platform';
import { Badge, toneForStatus } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { formatDate, groupByDate, relativeTime } from '../../lib/format';
import { NotificationIcon } from './NotificationIcon';
import { ShipmentList } from './ShipmentList';
import { OrderList } from '../orders/OrderList';
import { OrderDetailView } from '../orders/OrderDetail';
import { ReviewForm } from '../orders/ReviewForm';
import { ReviewItemList } from '../orders/ReviewItemList';
import { chipBelongsTo, chipsFor, defaultChip } from './tab-chips';
import { NOTIFICATION_SCOPE } from '../../lib/widget-tabs';
import type { NotificationItem } from '../../lib/types';


function Row({
  n,
  highlighted,
  onRead,
  onReview,
  selecting = false,
  selected = false,
  onToggle,
}: {
  n: NotificationItem;
  highlighted: boolean;
  onRead: (id: string) => void;
  onReview: (orderItemId: string) => void;
  /** Selection mode (PLN-260916 P3): rows show a check circle instead of the unread dot. */
  selecting?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const unread = !n.readAt;
  // A review request can only open the form when the notification carries the
  // item it refers to. Rows written before `refType`/`refId` existed have none,
  // so they render as plain rows rather than a button that cannot work.
  const reviewable = n.category === 'review' && n.refType === 'order_item' && !!n.refId;

  return (
    <div
      className={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3.5 text-left ${
        highlighted ? 'bg-highlight' : 'bg-white'
      }`}
    >
      <NotificationIcon category={n.category} hasLink={!!n.linkUrl} highlighted={highlighted} />
      {/* The mark-as-read target and the review action are SIBLINGS, never
          nested. A button inside a button is invalid HTML: browsers recover
          from it inconsistently and the inner control's keyboard behaviour
          stops being dependable. */}
      <div className="min-w-0 flex-1">
        <button
          onClick={() => unread && onRead(n.id)}
          className="w-full text-left"
          aria-label={unread ? t('notifications.markRead') : undefined}
        >
          <span className="flex items-center gap-2">
            {n.title && (
              <span className="truncate text-sm font-bold text-gray-900">{n.title}</span>
            )}
            {n.statusBadge && (
              <Badge tone={toneForStatus(n.statusBadge)}>{n.statusBadge}</Badge>
            )}
          </span>
          {n.body && <span className="mt-0.5 block text-sm text-gray-800">{n.body}</span>}
        </button>
        {reviewable && (
          <button
            type="button"
            onClick={() => onReview(n.refId!)}
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline"
          >
            <Star className="h-3.5 w-3.5 fill-warning text-warning" />
            {t('orders.writeReview')}
          </button>
        )}
        <p className="mt-1 text-xs text-gray-400">{relativeTime(n.createdAt, i18n.language)}</p>
      </div>
      {selecting ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={t('notifications.select')}
          onClick={() => onToggle?.(n.id)}
          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
            selected ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-gray-300 bg-white text-transparent'
          }`}
        >
          <Check className="h-3 w-3" />
        </button>
      ) : (
        unread && (
          <span className="mt-1.5 flex-shrink-0" aria-label={t('notifications.unread')}>
            <span className="block h-2 w-2 rounded-full bg-error" />
          </span>
        )
      )}
    </div>
  );
}

function IssueFeed({
  issues,
  isLoading,
  isError,
}: {
  issues: IssueFeedItem[];
  isLoading: boolean;
  isError: boolean;
}) {
  const { t, i18n } = useTranslation();
  // "No inquiries" while the request is still in flight (or failed) tells the
  // shopper they have none — the same misreading the notification list was
  // fixed for. Say loading, or say error; never invent an empty result.
  if (isLoading) return <Spinner label={t('common.loading')} />;
  if (isError) {
    return <p className="py-8 text-center text-sm text-gray-400">{t('common.error')}</p>;
  }
  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
        <BellOff className="h-6 w-6" />
        <span className="text-sm">{t('orders.noInquiries')}</span>
      </div>
    );
  }
  return (
    <div>
      {issues.map((i) => (
        <div key={i.issueNo} className="border-b border-gray-100 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900">
              #{i.issueNo} · {t(`orders.issues.type.${i.type}`, { defaultValue: i.type })}
            </span>
            <Badge tone={toneForStatus(i.status)}>
              {t(`orders.issues.status.${i.status}`, { defaultValue: i.status })}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-gray-800">
            {t(`orders.issues.line.${i.status}`, { defaultValue: '' })}
          </p>
          {i.updatedAt && (
            <p className="mt-1 text-xs text-gray-400">{formatDate(i.updatedAt, i18n.language)}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The list-shaped tab. Rendered twice under some configurations — once as
 * "Notifications" and once as "Orders" — with the same rows and sub-views, only
 * a different set of chips (PLN-260817-Widget-Tab-Config W-5). Keeping it one
 * component is the point: a fix to a shipment card is a fix in both places.
 */
export function NotificationsTab({ tab = 'notifications' }: { tab?: TabKey } = {}) {
  const { t, i18n } = useTranslation();
  const sessionToken = useWidgetStore((s) => s.sessionToken);
  const authenticated = useWidgetStore((s) => s.authenticated);
  const setAuthenticated = useWidgetStore((s) => s.setAuthenticated);
  const queueChatMessage = useWidgetStore((s) => s.queueChatMessage);
  const visibleTabs = useWidgetStore((s) => s.visibleTabs);
  const storedFilter = useWidgetStore((s) => s.notificationFilter);
  const setStoredFilter = useWidgetStore((s) => s.setNotificationFilter);

  const hasIssueFeed = useWidgetStore((s) => s.issueFeed);
  const chipOpts = { inquiries: hasIssueFeed };
  const chips = chipsFor(tab, visibleTabs, chipOpts);
  // The store holds ONE selected chip so a deep link (`?reopen=orders`) can aim
  // at it. When two list tabs exist that chip belongs to only one of them, so
  // the other falls back to its own first chip instead of rendering a filter it
  // does not offer.
  const notifFilter = chipBelongsTo(storedFilter, tab, visibleTabs, chipOpts)
    ? storedFilter
    : defaultChip(tab, visibleTabs, chipOpts);
  const setNotifFilter = setStoredFilter;

  // Sub-views pushed over the list. Both used to be reachable only through the
  // Orders tab, which the two-tab IA removed (PLN-260817 S3).
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [reviewItem, setReviewItem] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const isShipping = notifFilter === 'shipping';
  const isInquiries = notifFilter === 'inquiries';
  // Purchased lines to review (PLN-260923 P3), not the review-notification feed.
  const isReviewList = notifFilter === 'review';
  // The order LIST, not a notification category — see tab-chips ORDER_CHIPS.
  const isOrderList = notifFilter === 'orders';
  // What "all" covers. With both list tabs on, each shows only its own half —
  // otherwise Notifications' "All" would repeat every order row the Orders tab
  // is already showing and the chip split would buy nothing.
  const bothListTabs =
    visibleTabs.includes('notifications') && visibleTabs.includes('orders');
  const scope = !bothListTabs
    ? undefined
    : tab === 'orders'
      ? NOTIFICATION_SCOPE.ORDER
      : NOTIFICATION_SCOPE.NOTICE;
  const { data, isLoading, isError, error } = useNotifications(
    sessionToken,
    isShipping || isInquiries || isOrderList || isReviewList ? 'all' : notifFilter,
    scope,
  );
  const markRead = useMarkRead(sessionToken);
  const queryClient = useQueryClient();
  // Selection mode (PLN-260916 P3): pick rows → delete selected / delete all.
  const removeNotifications = useDeleteNotifications(sessionToken);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelected = (id: string) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const exitSelecting = () => {
    setSelecting(false);
    setSelectedIds([]);
  };
  const deleteSelected = () => {
    if (selectedIds.length === 0) return;
    removeNotifications.mutate({ ids: selectedIds }, { onSuccess: exitSelecting });
  };
  const deleteAll = () => {
    if (!window.confirm(t('notifications.deleteAllConfirm'))) return;
    removeNotifications.mutate({ all: true }, { onSuccess: exitSelecting });
  };

  const {
    data: issueFeed,
    isLoading: issuesLoading,
    isError: issuesError,
  } = useQuery({
    queryKey: ['issues', sessionToken],
    queryFn: () => listIssues(sessionToken!),
    enabled: !!sessionToken && authenticated && isInquiries,
    refetchInterval: 15_000,
  });

  // Notifications are customer-scoped. Don't wait for a 401 to work that out: the
  // widget already knows whether the session is bound, and a query that never
  // settles (a retry react-query paused, a slow link) would otherwise leave the
  // shopper looking at "No notifications yet" — which reads as "you have none"
  // rather than "sign in first". `authLost` still covers the session going stale
  // mid-visit, where the server is the authority.
  const authLost = isError && isAuthError(error);
  useEffect(() => {
    if (authLost) setAuthenticated(false);
  }, [authLost, setAuthenticated]);

  if (!authenticated || authLost) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <Lock className="h-6 w-6 text-gray-300" />
        <AuthGate
          sessionToken={sessionToken}
          onSuccess={() => setAuthenticated(true)}
          onCancel={() => {}}
        />
      </div>
    );
  }

  if (openOrder) {
    return (
      <OrderDetailView
        orderId={openOrder}
        sessionToken={sessionToken}
        onBack={() => setOpenOrder(null)}
        onAsk={(orderNumber) => queueChatMessage(t('orders.askMessage', { orderNumber }))}
      />
    );
  }

  if (reviewItem) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <ReviewForm
          sessionToken={sessionToken}
          orderItemId={reviewItem}
          onClose={() => {
            setReviewItem(null);
            // The Review chip marks written lines; refresh it on the way back.
            void queryClient.invalidateQueries({ queryKey: ['review-items'] });
          }}
        />
      </div>
    );
  }

  const groups = groupByDate(data ?? [], i18n.language);
  // Exactly one row wears the highlight wash: the newest unread (PLN §7 D-5).
  // The design shows a single emphasised row and no rule for it; making every
  // unread row cream would turn a 20-row list into a cream block.
  const newestUnreadId = (data ?? []).find((n) => !n.readAt)?.id ?? null;
  const myPageUrl = myPageOrdersUrl();

  return (
    <div className="flex h-full flex-col">
      {/* Filter chips */}
      <div className="scroll-thin flex items-center gap-2 overflow-x-auto border-b border-gray-100 px-4 py-3">
        {chips.map((f) => (
          <button
            key={f.key}
            onClick={() => setNotifFilter(f.key)}
            className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              notifFilter === f.key
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t(f.labelKey)}
          </button>
        ))}
        {/* Selection mode toggle — only where the plain notification list renders. */}
        {!isOrderList && !isShipping && !isInquiries && !isReviewList && (data?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
            className="ml-auto flex-shrink-0 text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            {selecting ? t('notifications.cancelSelect') : t('notifications.select')}
          </button>
        )}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {isOrderList ? (
          <OrderList sessionToken={sessionToken} onOpenOrder={setOpenOrder} />
        ) : isShipping ? (
          <ShipmentList sessionToken={sessionToken} onOpenOrder={setOpenOrder} />
        ) : isReviewList ? (
          <ReviewItemList sessionToken={sessionToken} onWrite={setReviewItem} />
        ) : isInquiries ? (
          <IssueFeed
            issues={issueFeed ?? []}
            isLoading={issuesLoading}
            isError={issuesError}
          />
        ) : (
          <>
            {isLoading && <Spinner label={t('common.loading')} />}
            {isError && (
              <p className="py-8 text-center text-sm text-gray-400">{t('common.error')}</p>
            )}
            {!isLoading && !isError && groups.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
                <BellOff className="h-6 w-6" />
                <span className="text-sm">{t('notifications.empty')}</span>
              </div>
            )}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500">
                  {g.relative ? t(`notifications.groups.${g.relative}`) : g.label}
                </div>
                {g.items.map((n) => (
                  <Row
                    key={n.id}
                    n={n}
                    highlighted={n.id === newestUnreadId}
                    onRead={(id) => markRead.mutate(id)}
                    onReview={setReviewItem}
                    selecting={selecting}
                    selected={selectedIds.includes(n.id)}
                    onToggle={toggleSelected}
                  />
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* The widget shows a bounded recent window inline (10 orders / 30 days);
          the full, canonical history lives on the storefront's own my-page.
          The order LIST is excluded: it carries its own my-page link, shown only
          once its window is actually full, and two links to the same place —
          one of them promising "more" to someone already seeing everything —
          is worse than either alone. */}
      {/* Selection-mode actions (design: filled "delete selected", outlined "delete all"). */}
      {selecting && (
        <div className="space-y-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={deleteSelected}
            disabled={selectedIds.length === 0 || removeNotifications.isPending}
            className="w-full rounded-st-md bg-primary-500 py-2.5 text-sm font-medium text-on-primary hover:bg-primary-600 disabled:opacity-40"
          >
            {t('notifications.deleteSelected', { count: selectedIds.length })}
          </button>
          <button
            type="button"
            onClick={deleteAll}
            disabled={removeNotifications.isPending}
            className="w-full rounded-st-md border border-primary-500 py-2.5 text-sm font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-40"
          >
            {t('notifications.deleteAll')}
          </button>
        </div>
      )}

      <div className={`border-t border-gray-100 ${isOrderList || selecting ? 'hidden' : ''}`}>
        {!moreOpen ? (
          <button
            onClick={() => setMoreOpen(true)}
            className="flex w-full items-center justify-center py-2.5 text-xs font-medium text-primary-600 transition-colors hover:bg-gray-50"
          >
            {t('orders.more')}
          </button>
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-3 py-2.5 text-center">
            <span className="text-xs text-gray-500">{t('orders.moreInMyPage')}</span>
            {myPageUrl && (
              <a
                href={myPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:underline"
              >
                {t('orders.viewAllOnMall')}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
