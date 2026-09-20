import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { useJourneyStats } from './statistics.hooks';

/**
 * The seven stages in the order a shopper meets them (PLN-260920b).
 *
 * The shape of this component IS the point. The first three nest — every
 * conversation came from an opened widget, every open from an impression — so
 * they are drawn as a chain with the conversion between them. The last four do
 * not nest: an escalated conversation is still rated and still ends, so they
 * are drawn as shares OF conversations, side by side. Rendering all seven as
 * one chain would make "95% ended, 11% rated" look like a fault instead of two
 * unrelated facts.
 */
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const num = (v: number) => v.toLocaleString();

interface Props {
  from: string;
  to: string;
  /** Lets a stage hand the operator to the lens that explains it. */
  onGoToSection?: (section: string) => void;
}

export function JourneySection({ from, to, onGoToSection }: Props) {
  const { t } = useTranslation('statistics');
  const { data, isLoading, error } = useJourneyStats(from, to);
  const d = data;

  if (error) {
    return (
      <Card title={t('journey.title')}>
        <p className="px-5 py-8 text-center text-error">{(error as Error).message}</p>
      </Card>
    );
  }

  const breakdown: Array<{ key: string; value: number; section: string }> = [
    { key: 'aiHandled', value: d?.aiHandled ?? 0, section: 'agents' },
    { key: 'escalated', value: d?.escalated ?? 0, section: 'resolution' },
    { key: 'rated', value: d?.rated ?? 0, section: 'csat' },
    { key: 'ended', value: d?.ended ?? 0, section: 'resolution' },
  ];

  return (
    <div className="space-y-4">
      <Card title={t('journey.title')}>
        <div className="px-5 py-5">
          <p className="mb-4 text-xs text-gray-500">{t('journey.subtitle')}</p>

          {/* Stages that nest. */}
          <div className="flex flex-wrap items-center gap-2">
            <Stage label={t('journey.impressions')} value={num(d?.impressions ?? 0)} loading={isLoading} />
            <Conv value={pct(d?.openedSessions ?? 0, d?.impressions ?? 0)} label={t('journey.openRate')} />
            <Stage label={t('journey.access')} value={num(d?.openedSessions ?? 0)} loading={isLoading} />
            <Conv value={pct(d?.conversations ?? 0, d?.openedSessions ?? 0)} label={t('journey.chatRate')} />
            <Stage label={t('journey.conversations')} value={num(d?.conversations ?? 0)} loading={isLoading} />
          </div>

          {/* Stages that do not. */}
          <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="mb-3 text-xs font-medium text-gray-600">
              {t('journey.ofConversations', { count: d?.conversations ?? 0 })}
            </div>
            <ul className="space-y-2">
              {breakdown.map((b) => (
                <li key={b.key} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 text-gray-600">{t(`journey.${b.key}`)}</span>
                  <span className="w-16 shrink-0 text-right tabular-nums font-medium text-gray-900">
                    {num(b.value)}
                  </span>
                  <span className="w-14 shrink-0 text-right tabular-nums text-gray-500">
                    {pct(b.value, d?.conversations ?? 0)}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                    <span
                      className="block h-full rounded-full bg-primary-400"
                      style={{ width: d?.conversations ? `${(b.value / d.conversations) * 100}%` : '0%' }}
                    />
                  </span>
                  {onGoToSection && (
                    <button
                      type="button"
                      className="shrink-0 text-xs text-primary-600 hover:underline"
                      onClick={() => onGoToSection(b.section)}
                    >
                      {t('journey.details')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-gray-500">{t('journey.notExclusive')}</p>
          </div>

          <p className="mt-3 text-xs text-gray-500">{t('journey.collectionNote')}</p>
        </div>
      </Card>
    </div>
  );
}

function Stage({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="min-w-[120px] flex-1 rounded-lg border border-gray-200 px-4 py-3">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
        {loading ? '…' : value}
      </div>
    </div>
  );
}

function Conv({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-1 text-center">
      <div className="text-gray-300">→</div>
      <div className="text-sm font-medium tabular-nums text-gray-700">{value}</div>
      <div className="text-[11px] text-gray-400">{label}</div>
    </div>
  );
}
