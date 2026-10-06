import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Input } from '@/components/Field';
import {
  useCompareJourneyReports,
  useCreateJourneyReport,
  useJourneyReports,
} from './journey.hooks';
import { JourneyReportModal } from './JourneyReportModal';
import type { JourneyReportSummary } from './journey.service';

/**
 * The group's right-hand panel (PLN-260825 W3).
 *
 * It replaces the AI briefing here and only here. A briefing answers "what is
 * this conversation about" — useful with one thread open. A group asks a
 * different question: what this relationship looks like across all of them.
 */
export function JourneyPanel({ groupId }: { groupId: string }) {
  const { t } = useTranslation('journey');
  const { t: tc } = useTranslation('common');
  const reports = useJourneyReports(groupId);
  const create = useCreateJourneyReport(groupId);
  const compare = useCompareJourneyReports(groupId);

  const [whole, setWhole] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const rows = reports.data ?? [];
  const ready = rows.filter((r) => r.status === 'ready');
  const pickedRows = ready.filter((r) => picked.includes(r.id));
  // Two reports written under different rules differ partly because of us.
  const versionsDiffer =
    pickedRows.length === 2 && pickedRows[0].criteriaVersion !== pickedRows[1].criteriaVersion;

  const label = (r: JourneyReportSummary) =>
    r.kind === 'comparison'
      ? t('kind.comparison')
      : r.periodFrom
        ? `${r.periodFrom} ~ ${r.periodTo ?? ''}`
        : t('period.whole');

  const tone = (s: string) => (s === 'ready' ? 'success' : s === 'failed' ? 'error' : 'warning');

  return (
    <Card title={t('title')}>
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={whole} onChange={() => setWhole(true)} />
          <span>{t('period.whole')}</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={!whole} onChange={() => setWhole(false)} />
          <span>{t('period.range')}</span>
        </label>
        {!whole && (
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-gray-400">~</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}

        <Button
          className="w-full"
          disabled={create.isPending || (!whole && (!from || !to))}
          onClick={() =>
            create.mutate(whole ? {} : { period_from: from, period_to: to })
          }
        >
          {t('generate')}
        </Button>
        {/* Said before they wait, not after: the work outlives this screen. */}
        <p className="text-xs text-gray-500">{t('asyncNote')}</p>
      </div>

      <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-gray-500">
        {t('past')}
      </h4>
      {reports.isLoading ? <p className="text-sm text-gray-500">{tc('loading')}</p> : null}
      {!reports.isLoading && !rows.length ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : null}

      <ul className="text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 border-b border-gray-100 py-2 last:border-0">
            <input
              type="checkbox"
              disabled={r.status !== 'ready'}
              checked={picked.includes(r.id)}
              onChange={(e) =>
                setPicked((prev) =>
                  e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id),
                )
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{r.createdAt.slice(0, 10)} · {label(r)}</span>
              {r.status === 'failed' && r.error ? (
                <span className="block truncate text-xs text-red-600">{r.error}</span>
              ) : null}
            </span>
            <Badge tone={tone(r.status)}>{t(`status.${r.status}`)}</Badge>
            <Button
              size="sm"
              variant="secondary"
              disabled={r.status !== 'ready'}
              onClick={() => setOpen(r.id)}
            >
              {tc('open')}
            </Button>
          </li>
        ))}
      </ul>

      {picked.length ? (
        <div className="mt-3 space-y-2">
          {versionsDiffer ? (
            <p className="text-xs text-amber-700">
              {t('compare.versionsDiffer', {
                a: pickedRows[0].criteriaVersion,
                b: pickedRows[1].criteriaVersion,
              })}
            </p>
          ) : null}
          <Button
            className="w-full"
            variant="secondary"
            disabled={picked.length !== 2 || compare.isPending}
            onClick={() => compare.mutate(picked, { onSuccess: () => setPicked([]) })}
          >
            {t('compare.action', { count: picked.length })}
          </Button>
        </div>
      ) : null}

      <JourneyReportModal reportId={open} groupId={groupId} onClose={() => setOpen(null)} />
    </Card>
  );
}
