import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { useRatingSummary } from './statistics.hooks';

const VERDICTS = ['accurate', 'partial', 'inaccurate'] as const;
const BAR: Record<(typeof VERDICTS)[number], string> = {
  accurate: 'bg-success',
  partial: 'bg-warning',
  inaccurate: 'bg-error',
};

/** "85%" of rated answers that were accurate; em-dash when nothing was rated. */
function pct(n: number, total: number): string {
  return total ? `${Math.round((n / total) * 100)}%` : '—';
}

/**
 * Answer accuracy (PLN-261015 D7): verdicts agents gave AI answers and leads
 * gave agent answers, for the page's window. AI and human are shown apart —
 * one blended rate would hide which side needs the fix.
 */
export function AccuracySection({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation('statistics');
  const { data, isLoading, error } = useRatingSummary(from, to);

  if (isLoading) return <p className="text-sm text-gray-400">{t('accuracy.loading')}</p>;
  if (error) return <p className="text-sm text-error">{(error as Error).message}</p>;
  if (!data?.total) return <Card><p className="text-sm text-gray-500">{t('accuracy.empty')}</p></Card>;

  const reasons = Object.entries(data.byReason).sort((a, b) => b[1] - a[1]);
  const reasonMax = Math.max(1, ...reasons.map(([, n]) => n));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {(['ai', 'agent'] as const).map((sender) => {
          const s = data.bySender[sender] ?? { accurate: 0, partial: 0, inaccurate: 0 };
          const total = s.accurate + s.partial + s.inaccurate;
          return (
            <Card key={sender}>
              <p className="text-xs text-gray-500">{t(`accuracy.sender.${sender}`)}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{pct(s.accurate, total)}</p>
              <p className="text-[11px] text-gray-400">{t('accuracy.accurateOf', { n: total })}</p>
              <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
                {VERDICTS.map((v) =>
                  s[v] ? <div key={v} className={BAR[v]} style={{ width: `${(s[v] / total) * 100}%` }} /> : null,
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500">
                {VERDICTS.map((v) => (
                  <span key={v} className="flex items-center gap-1 tabular-nums">
                    <span className={`inline-block h-2 w-2 rounded-full ${BAR[v]}`} />
                    {t(`accuracy.verdict.${v}`)} {s[v]}
                  </span>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      {reasons.length > 0 && (
        <Card title={t('accuracy.reasonsTitle')}>
          <div className="space-y-2">
            {reasons.map(([r, n]) => (
              <div key={r} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-gray-600">{t(`accuracy.reason.${r}`, { defaultValue: r })}</span>
                <div className="h-2 flex-1 rounded-full bg-gray-100">
                  <div className="h-2 rounded-full bg-error/70" style={{ width: `${(n / reasonMax) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums text-gray-500">{n}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-400">{t('accuracy.reasonsHint')}</p>
        </Card>
      )}
    </div>
  );
}
