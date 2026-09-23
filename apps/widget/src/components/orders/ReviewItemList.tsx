import { CheckCircle2, ExternalLink, Package, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWidgetStore } from '../../store/widgetStore';
import { useReviewItems } from '../../hooks/useOrders';
import { formatMoney, relativeTime } from '../../lib/format';
import { reviewLinkFor } from '../../../../../packages/types/src/common/widget-theme';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import type { ReviewItem } from '../../lib/types';

/**
 * One purchased line (Figma `05.Review`): order number with a Review badge, the
 * product and its price, then "Write a review" and the date.
 */
function Row({
  item,
  href,
  onWrite,
}: {
  item: ReviewItem;
  /** The store's review page for this product; null → the in-widget form. */
  href: string | null;
  onWrite: (orderItemId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const meta = [item.title, item.price != null ? formatMoney(item.price, item.currency) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-3.5">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100">
        {item.imageUrl ? (
          // Decorative: the title beside it already names the product.
          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Package className="h-4 w-4 text-gray-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900">{item.orderNumber}</span>
          <Badge tone="review">{t('orders.reviewItems.badge')}</Badge>
        </div>
        <p className="mt-0.5 truncate text-sm text-gray-800">{meta}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          {item.reviewed ? (
            <span className="inline-flex items-center gap-1 text-sm text-gray-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('orders.reviewItems.reviewed')}
            </span>
          ) : href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline"
            >
              <Star className="h-3.5 w-3.5 fill-warning text-warning" />
              {t('orders.writeReview')}
              <ExternalLink className="h-3 w-3 text-gray-400" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onWrite(item.orderItemId)}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline"
            >
              <Star className="h-3.5 w-3.5 fill-warning text-warning" />
              {t('orders.writeReview')}
            </button>
          )}
          <span className="flex-shrink-0 text-xs text-gray-400">
            {relativeTime(item.orderedAt, i18n.language)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The Review chip (PLN-260923 P3): what the shopper bought and received, each
 * with a way to review it. A line whose order carried a product URL links to
 * the store's own review page (through the tenant's template); one without
 * opens the widget's review form, so every line stays reviewable.
 */
export function ReviewItemList({
  sessionToken,
  onWrite,
}: {
  sessionToken: string | null;
  onWrite: (orderItemId: string) => void;
}) {
  const { t } = useTranslation();
  const template = useWidgetStore((s) => s.widgetTheme?.design?.reviewLinkTemplate ?? null);
  const { data, isLoading, isError } = useReviewItems(sessionToken);

  // Loading and error are said as such — an empty list while the request is in
  // flight would read as "nothing to review".
  if (isLoading) return <Spinner label={t('common.loading')} />;
  if (isError) return <p className="py-8 text-center text-sm text-gray-400">{t('common.error')}</p>;
  if (!data?.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
        <Star className="h-6 w-6" />
        <span className="text-sm">{t('orders.reviewItems.empty')}</span>
      </div>
    );
  }
  return (
    <div>
      {data.map((item) => (
        <Row
          key={item.orderItemId}
          item={item}
          href={reviewLinkFor(template, item.productUrl)}
          onWrite={onWrite}
        />
      ))}
    </div>
  );
}
