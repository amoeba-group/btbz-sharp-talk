import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Flag, MessageSquare, MessageSquareOff, Package, ShoppingBag, Star, Truck } from 'lucide-react';
import { Button } from '@/components/Button';
import { useJourneyTimeline } from './journey.hooks';
import { journeyService } from './journey.service';
import type { JourneyTimelineItem } from './journey.service';

/** One icon per touchpoint family; the cjm stage picks it for events. */
function iconFor(i: JourneyTimelineItem) {
  if (i.kind === 'conversation_started') return MessageSquare;
  if (i.kind === 'conversation_ended') return MessageSquareOff;
  if (i.kind === 'csat') return Star;
  switch (i.stage) {
    case 'Browse':
      return Eye;
    case 'Purchase':
      return ShoppingBag;
    case 'Delivery':
      return Truck;
    case 'Post':
      return Package;
    default:
      return Flag;
  }
}

/**
 * Touchpoints across the group's sessions, newest first (PLN-261006 P4):
 * visits, product views, orders, deliveries, reviews (cjm events) and each
 * conversation's start, end and rating. Event payloads never reach the
 * console — the type and stage are enough to read the path.
 */
export function JourneyTimeline({ groupId }: { groupId: string }) {
  const { t, i18n } = useTranslation('journey');
  const { t: tc } = useTranslation('common');
  const first = useJourneyTimeline(groupId, true);
  const [more, setMore] = useState<JourneyTimelineItem[]>([]);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const items = [...(first.data?.items ?? []), ...more];
  const canLoadMore = hasMore ?? first.data?.hasMore ?? false;

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const page = await journeyService.timeline(groupId, last.at);
      setMore((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
    } finally {
      setLoading(false);
    }
  };

  const label = (i: JourneyTimelineItem) => {
    if (i.kind === 'cjm') {
      return t(`timeline.event.${i.eventType}`, {
        defaultValue: `${t(`timeline.stage.${i.stage}`, { defaultValue: i.stage ?? '' })} · ${i.eventType ?? ''}`,
      });
    }
    if (i.kind === 'csat') return t('timeline.csat', { n: i.csat });
    return t(`timeline.${i.kind}`, { channel: i.channel ?? '' });
  };

  if (first.isLoading) return <p className="mt-2 text-xs text-gray-500">{tc('loading')}</p>;
  if (!items.length) return <p className="mt-2 text-xs text-gray-400">{t('timeline.empty')}</p>;

  return (
    <div className="mt-2">
      <ol className="space-y-1.5 border-l border-gray-200 pl-3">
        {items.map((i, idx) => {
          const Icon = iconFor(i);
          return (
            <li key={`${i.kind}-${i.at}-${idx}`} className="relative text-xs text-gray-700">
              <Icon className="absolute -left-[19px] top-0.5 h-3 w-3 rounded-full bg-white text-gray-400" />
              <span className="text-gray-400">
                {new Date(i.at).toLocaleString(i18n.language, {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>{' '}
              {label(i)}
            </li>
          );
        })}
      </ol>
      {canLoadMore && (
        <Button size="sm" variant="secondary" className="mt-2 w-full" disabled={loading} onClick={loadMore}>
          {t('timeline.more')}
        </Button>
      )}
    </div>
  );
}
