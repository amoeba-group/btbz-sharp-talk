import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download } from 'lucide-react';
import { Card } from '@/components/Card';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/auth-store';
import { toast } from '@/store/toast-store';
import {
  PILOT_ANALYTICS_GROUPS,
  PILOT_ANALYTICS_MAX_WINDOW_DAYS,
  pilotPercent,
  pilotRangeTooLong,
  pilotTopReasons,
} from '../../../../../packages/types/src/common/pilot-analytics';
import type { PilotAnalyticsGroup } from '../../../../../packages/types/src/common/pilot-analytics';
import { usePilotStats } from './statistics.hooks';
import { statisticsService } from './statistics.service';
import type { PilotAdoption, PilotRow, PilotStage } from './statistics.service';

const STAGES: PilotStage[] = ['total', 'classify', 'retrieve', 'generate', 'moderate'];

/** Milliseconds as "1.2 s"; a dash when the stage never ran (a replayed answer has no search). */
const seconds = (ms: number | null): string => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);

const num = (n: number): string => n.toLocaleString();

/**
 * Statistics › Pilot (PLN-261012 SG-52, wireframe W7): the numbers the Go2Joy pilot is judged on, by
 * hotel, role or day, plus how many of the hotels on the pilot list actually chatted, and the CSV a
 * grader reads by hand.
 *
 * Every number here is computed by the server; this screen only lays it out. The definitions that matter
 * (what "AI-only resolved" means, why it differs from the Outcomes tab) are stated on the screen itself,
 * because a figure whose meaning has to be looked up elsewhere gets misread.
 */
export function PilotSection({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation('statistics');
  const rank = useAuthStore((s) => s.principal?.rank);
  // The server enforces this (403); hiding the button just spares everyone else a refusal.
  const canExport = rank === 'master' || rank === 'director';

  const [group, setGroup] = useState<PilotAnalyticsGroup>('hotel');
  const [exporting, setExporting] = useState(false);
  const [showSilent, setShowSilent] = useState(false);

  // A range the server is known to refuse is not sent: the screen says why instead of showing an error it caused.
  const tooLong = pilotRangeTooLong(from, to);
  const { data, isLoading, error, refetch } = usePilotStats({ group, from, to }, !tooLong);

  const err = error as (Error & { code?: string }) | null;
  const errorText = err
    ? t(`pilot.error.${err.code ?? 'unknown'}`, { defaultValue: err.message, max: PILOT_ANALYTICS_MAX_WINDOW_DAYS })
    : null;

  const onExport = async () => {
    setExporting(true);
    try {
      const { truncated } = await statisticsService.exportPilotCsv(from, to);
      if (truncated) toast.warning(t('pilot.exportTruncated', { max: data?.meta.exportMaxRows ?? 5000 }));
      else toast.success(t('pilot.exportDone'));
    } catch {
      // Errors stay until dismissed (UX standard): a failed export is the one thing the user must not miss.
      toast.error(t('pilot.exportFailed'), { sticky: true });
    } finally {
      setExporting(false);
    }
  };

  const totals = data?.totals;
  const rows: PilotRow[] = data && totals && totals.conversations > 0 ? [totals, ...data.rows] : [];
  const isTotal = (r: PilotRow) => r === totals;

  const keyCell = (r: PilotRow) =>
    isTotal(r) ? (
      <span className="font-semibold text-gray-900">{t('pilot.total')}</span>
    ) : r.unknown ? (
      <span className="text-gray-400">{t('pilot.unknown')}</span>
    ) : (
      <span className="tabular-nums">{r.key}</span>
    );

  const reasonLine = (map: Record<string, number>, limit: number) =>
    pilotTopReasons(map, limit).map((x) => (
      <span key={x.reason} className="block text-xs text-gray-500">
        {t(`pilot.reason.${x.reason}`, { defaultValue: x.reason })} · {x.count}
      </span>
    ));

  const keyHeader = t(`pilot.group.${group}`);

  const resultColumns: Column<PilotRow>[] = [
    { key: 'key', header: keyHeader, render: keyCell },
    {
      key: 'conversations',
      header: t('pilot.col.conversations'),
      render: (r) => <span className="tabular-nums">{num(r.conversations)}</span>,
    },
    {
      key: 'aiOnly',
      header: t('pilot.col.aiOnly'),
      render: (r) => (
        <span className="tabular-nums">
          {pilotPercent(r.aiOnlyResolvedRate)}
          <span className="ml-1 text-xs text-gray-400">({num(r.aiOnlyResolved)})</span>
        </span>
      ),
    },
    {
      key: 'handoff',
      header: t('pilot.col.handoff'),
      render: (r) => (
        <div className="tabular-nums">
          <span className={r.handoffRate != null && r.handoffRate >= 0.25 ? 'text-error' : undefined}>
            {pilotPercent(r.handoffRate)}
          </span>
          <span className="ml-1 text-xs text-gray-400">({num(r.handedOff)})</span>
          {reasonLine(r.handoffReasons, 2)}
        </div>
      ),
    },
    {
      key: 'other',
      header: t('pilot.col.other'),
      render: (r) => (
        <span className="tabular-nums text-gray-600">
          {num(r.refused)} / {num(r.noAnswer)}
        </span>
      ),
    },
    {
      key: 'confidence',
      header: t('pilot.col.confidence'),
      render: (r) => (
        <span className="tabular-nums">{r.avgConfidence == null ? '—' : r.avgConfidence.toFixed(2)}</span>
      ),
    },
    {
      key: 'noSource',
      header: t('pilot.col.noSource'),
      render: (r) => <span className="tabular-nums">{pilotPercent(r.noSourceRate)}</span>,
    },
    {
      key: 'csat',
      header: t('pilot.col.csat'),
      render: (r) =>
        r.csat.avg == null ? (
          <span className="text-gray-400">—</span>
        ) : (
          <span className="tabular-nums">
            {t('pilot.cell.csat', { avg: r.csat.avg.toFixed(2), count: r.csat.rated })}
          </span>
        ),
    },
  ];

  const operationsColumns: Column<PilotRow>[] = [
    { key: 'key', header: keyHeader, render: keyCell },
    {
      key: 'guestGate',
      header: t('pilot.col.guestGate'),
      render: (r) => <span className="tabular-nums">{num(r.guestGatePrompts)}</span>,
    },
    {
      key: 'refusals',
      header: t('pilot.col.refusals'),
      render: (r) => {
        // Sign-in prompts have their own column; this one is every other reason a customer was turned away.
        const others = Object.fromEntries(Object.entries(r.refusals).filter(([reason]) => reason !== 'guest_gate'));
        return pilotTopReasons(others, 2).length ? (
          <div>{reasonLine(others, 2)}</div>
        ) : (
          <span className="text-gray-400">—</span>
        );
      },
    },
    {
      key: 'moderation',
      header: t('pilot.col.moderation'),
      render: (r) => (
        <span className="tabular-nums">
          {num(r.moderation.blocked)} / {num(r.moderation.edited)}
        </span>
      ),
    },
    {
      key: 'partner',
      header: t('pilot.col.partner'),
      render: (r) => (
        <span
          className="tabular-nums"
          title={Object.entries(r.partner.topics)
            .map(([topic, n]) => `${topic}: ${n}`)
            .join(', ')}
        >
          {num(r.partner.ok)} / {num(r.partner.denied + r.partner.rejected)} /{' '}
          {num(r.partner.unavailable + r.partner.unverified)}
        </span>
      ),
    },
    {
      key: 'users',
      header: t('pilot.col.users'),
      render: (r) => (
        <span className="text-xs text-gray-600">
          {t('pilot.cell.users', { users: num(r.distinctUsers), guests: num(r.anonymousSessions) })}
        </span>
      ),
    },
    {
      key: 'latency',
      header: t('pilot.col.latency'),
      render: (r) => (
        <span className="tabular-nums">
          {seconds(r.latency.total.p50)} / {seconds(r.latency.total.p95)}
        </span>
      ),
    },
  ];

  const retry = (
    <Button variant="secondary" size="sm" onClick={() => void refetch()}>
      {t('pilot.retry')}
    </Button>
  );

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t('pilot.title')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('pilot.subtitle')}</p>
          </div>
          {canExport && (
            <div className="flex flex-col items-end gap-1">
              <Button variant="secondary" size="sm" disabled={exporting || tooLong} onClick={() => void onExport()}>
                <Download className="h-4 w-4" />
                {exporting ? t('pilot.exporting') : t('pilot.export')}
              </Button>
              <p className="max-w-sm text-right text-xs text-gray-400">{t('pilot.exportHint')}</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">{t('pilot.groupBy')}</span>
          {PILOT_ANALYTICS_GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(g)}
              aria-pressed={group === g}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                group === g
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50',
              )}
            >
              {t(`pilot.group.${g}`)}
            </button>
          ))}
        </div>
      </Card>

      {tooLong ? (
        <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t('pilot.windowTooLong', { max: PILOT_ANALYTICS_MAX_WINDOW_DAYS })}
        </p>
      ) : (
        <>
          {data?.meta.truncated && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t('pilot.truncatedNote', { max: data.meta.maxConversations, scanned: data.meta.scanned })}
            </p>
          )}

          {data && <AdoptionCard adoption={data.adoption} showSilent={showSilent} onToggle={() => setShowSilent((v) => !v)} />}

          <Table<PilotRow>
            columns={resultColumns}
            data={rows}
            loading={isLoading}
            error={errorText}
            emptyMessage={t('pilot.empty')}
            rowKey={(r) => `${isTotal(r) ? 'total:' : 'row:'}${r.key}`}
          />
          {errorText && <div className="flex justify-end">{retry}</div>}

          {rows.length > 0 && (
            <>
              <Table<PilotRow>
                columns={operationsColumns}
                data={rows}
                rowKey={(r) => `${isTotal(r) ? 'total:' : 'row:'}${r.key}`}
              />

              <Card title={t('pilot.latencyTitle')}>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="py-1 pr-4 font-medium">{t('pilot.stageCol')}</th>
                        <th className="py-1 pr-4 font-medium">{t('pilot.samples')}</th>
                        <th className="py-1 pr-4 font-medium">P50</th>
                        <th className="py-1 pr-4 font-medium">P95</th>
                      </tr>
                    </thead>
                    <tbody>
                      {STAGES.map((stage) => {
                        const l = totals?.latency[stage];
                        return (
                          <tr key={stage} className="border-t border-gray-100">
                            <td className="py-1.5 pr-4 text-gray-700">{t(`pilot.stage.${stage}`)}</td>
                            <td className="py-1.5 pr-4 tabular-nums">{num(l?.count ?? 0)}</td>
                            <td className="py-1.5 pr-4 tabular-nums">{seconds(l?.p50 ?? null)}</td>
                            <td className="py-1.5 pr-4 tabular-nums">{seconds(l?.p95 ?? null)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          <details className="rounded-lg border border-gray-200 bg-white px-5 py-3 text-sm text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-800">{t('pilot.definitions.title')}</summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>{t('pilot.definitions.aiOnly')}</li>
              <li>{t('pilot.definitions.handoff')}</li>
              <li>{t('pilot.definitions.other')}</li>
              <li>{t('pilot.definitions.confidence')}</li>
              <li>{t('pilot.definitions.window', { zone: data?.window.timezone ?? 'UTC' })}</li>
            </ul>
          </details>
          {data && data.meta.unrecordedReasons.length > 0 && (
            <p className="text-xs text-gray-400">
              {t('pilot.notRecorded', {
                reasons: data.meta.unrecordedReasons.map((r) => t(`pilot.reason.${r}`, { defaultValue: r })).join(', '),
              })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** "Active 9 / pilot list 12", and which listed hotels never chatted. */
function AdoptionCard({
  adoption: a,
  showSilent,
  onToggle,
}: {
  adoption: PilotAdoption;
  showSilent: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('statistics');
  // With a list, "active" is the listed hotels that chatted — an unlisted hotel must not make adoption look better.
  const active = a.listed > 0 ? a.listedActive : a.hotelsActive;
  return (
    <Card title={t('pilot.adoption.title')}>
      <p className="text-sm font-medium text-gray-800 tabular-nums">
        {t('pilot.adoption.line', { active, listed: a.listed })}
      </p>
      {a.offListActive > 0 && (
        <p className="mt-1 text-xs text-gray-500">{t('pilot.adoption.outside', { count: a.offListActive })}</p>
      )}
      {a.listed === 0 && <p className="mt-1 text-xs text-gray-500">{t('pilot.adoption.noList')}</p>}
      {a.listed > 0 && !a.pilotEnabled && <p className="mt-1 text-xs text-gray-500">{t('pilot.adoption.listOff')}</p>}
      {a.listed > 0 &&
        (a.listedSilent === 0 ? (
          <p className="mt-2 text-xs text-success">{t('pilot.adoption.allActive')}</p>
        ) : (
          <div className="mt-2">
            <button
              type="button"
              onClick={onToggle}
              className="text-xs font-medium text-primary-700 hover:underline"
              aria-expanded={showSilent}
            >
              {t('pilot.adoption.silent', { count: a.listedSilent })} ·{' '}
              {showSilent ? t('pilot.adoption.hideSilent') : t('pilot.adoption.showSilent')}
            </button>
            {showSilent && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {a.silentHotels.map((h) => (
                  <span key={h} className="rounded bg-gray-100 px-2 py-0.5 text-xs tabular-nums text-gray-700">
                    {h}
                  </span>
                ))}
                {a.listedSilent > a.silentHotels.length && (
                  <span className="px-1 py-0.5 text-xs text-gray-500">
                    {t('pilot.adoption.silentMore', { count: a.listedSilent - a.silentHotels.length })}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
    </Card>
  );
}
