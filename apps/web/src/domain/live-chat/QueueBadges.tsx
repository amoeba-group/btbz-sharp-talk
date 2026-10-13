import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/use-now';
// Source deep-import: the package entry point is CJS and fails the browser build for values.
import {
  formatWait,
  isOverdue,
  teamChips,
  unclaimedSummary,
  waitingSince,
} from '../../../../../packages/types/src/common/routing-queue';
import type { QueueCountsView } from './live-chat.service';

/**
 * How long a conversation has been waiting for a person (PLN-261012 SG-66): "Waiting 07:42", amber with a
 * warning mark once it has passed the unclaimed limit. Counts up by itself between polls; renders
 * nothing for a thread that is not waiting.
 */
export function WaitBadge({ status, escalatedAt }: { status?: string | null; escalatedAt?: string | null }) {
  const { t } = useTranslation('livechat');
  const since = waitingSince({ status, escalatedAt });
  const now = useNow(1000, !!since);
  if (!since) return null;
  const overdue = isOverdue(since, now);
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
        overdue ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600',
      )}
      title={overdue ? t('queue.unclaimedTitle') : t('queue.waitingTitle', { at: new Date(since).toLocaleString() })}
    >
      {overdue && <span aria-hidden="true">⚠ </span>}
      {t('queue.waiting', { time: formatWait(since, now) })}
    </span>
  );
}

/**
 * The "?" badge for a hotel whose signed province the region table does not list (PLN-261012 SG-65):
 * the conversation has no regional team, and the tooltip names the province so an operator knows which
 * spelling to add. Renders nothing once the thread has a region.
 */
export function RegionHintBadge({
  supportRegion,
  hint,
}: {
  supportRegion?: string | null;
  hint?: string | null;
}) {
  const { t } = useTranslation('livechat');
  if (supportRegion || !hint?.trim()) return null;
  return (
    <span
      className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700"
      title={t('region.hintTitle', { province: hint })}
      aria-label={t('region.hintTitle', { province: hint })}
    >
      ?
    </span>
  );
}

/**
 * "All teams 14 · CS 9 · Business 5" above the queue (PLN-261012 SG-66): one chip per team, each a
 * team filter, and — when something waits unclaimed — how many and for how long the oldest has waited.
 */
export function QueueChips({
  counts,
  active,
  onSelect,
}: {
  counts: QueueCountsView | undefined;
  active: string;
  onSelect: (team: string) => void;
}) {
  const { t } = useTranslation('livechat');
  const now = useNow(1000, !!counts && counts.unclaimed > 0);
  const summary = unclaimedSummary(counts, now);
  if (!counts) return null;
  return (
    <div className="space-y-1 border-b border-gray-100 px-2 py-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('queue.chipsLabel')}>
        {teamChips(counts, active).map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={chip.active}
            onClick={() => onSelect(chip.id)}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-1 text-xs',
              chip.active
                ? 'border-primary-400 bg-primary-500/10 text-primary-700'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            )}
          >
            {chip.id === 'all' ? t('team.filterAll') : t(`team.${chip.id}`, { defaultValue: chip.id })}
            <span className="ml-1 font-semibold tabular-nums">{chip.count}</span>
          </button>
        ))}
      </div>
      {summary && (
        <p className={cn('text-[11px]', summary.overdue ? 'font-medium text-red-600' : 'text-gray-500')}>
          {summary.overdue && <span aria-hidden="true">⚠ </span>}
          {t('queue.unclaimedSummary', { count: summary.count, time: summary.oldest })}
        </p>
      )}
    </div>
  );
}
