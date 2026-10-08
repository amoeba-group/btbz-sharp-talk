import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { FiveAStage, JourneyReportMetrics, ValueState } from '../journey.service';

/**
 * The figures at the top of a report (REQ-261008 P1, draft A).
 *
 * Every number here is one the API counted; nothing is parsed out of the
 * prose. A figure that is not a number gets a chip saying why — "not
 * applicable" and "not measured" call for opposite next steps, and a bare "—"
 * leaves the reader to guess which one it is.
 */
export function JourneyReportSummaryView({
  metrics,
  states,
}: {
  metrics: JourneyReportMetrics;
  states: Record<string, ValueState> | null;
}) {
  const { t } = useTranslation('journey');
  const state = (key: string): ValueState => states?.[key] ?? 'measured';

  const conversations = metrics.conversations;
  const primaryShare =
    metrics.primaryChannel && metrics.sessionCount
      ? Math.round(
          ((metrics.channels.find((c) => c.channel === metrics.primaryChannel)?.sessions ?? 0) /
            metrics.sessionCount) *
            100,
        )
      : null;
  const split = metrics.aiMessages != null && metrics.humanMessages != null;
  const resolutionRate = conversations ? Math.round((metrics.resolved / conversations) * 100) : null;

  return (
    <section className="mb-4 space-y-3" aria-label={t('summary.label')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          label={t('summary.conversations')}
          value={conversations}
          note={
            primaryShare != null
              ? t('summary.primaryChannel', { channel: metrics.primaryChannel, pct: primaryShare })
              : undefined
          }
        />
        <KpiTile
          label={t('summary.messages')}
          value={metrics.messages}
          note={
            split
              ? t('summary.messageSplit', {
                  customer: metrics.customerMessages,
                  ai: metrics.aiMessages,
                  human: metrics.humanMessages,
                })
              : t('summary.messageSplitLegacy', {
                  customer: metrics.customerMessages,
                  agent: metrics.agentMessages,
                })
          }
        />
        <KpiTile
          label={t('summary.resolutionRate')}
          value={resolutionRate != null ? `${resolutionRate}%` : null}
          state={state('resolutionRate')}
          note={t('summary.unresolvedCount', { count: metrics.unresolved })}
          tone={conversations && metrics.resolved === 0 ? 'warn' : undefined}
        />
        <KpiTile label={t('summary.avgLoops')} value={metrics.avgLoops} state={state('avgLoops')} />
        <KpiTile label={t('summary.handoffs')} value={metrics.handoffs} />
        <KpiTile
          label={t('summary.medianResolution')}
          value={
            metrics.medianResolutionMinutes != null
              ? t('summary.minutes', { count: metrics.medianResolutionMinutes })
              : null
          }
          state={state('medianResolutionMinutes')}
          note={
            state('medianResolutionMinutes') === 'not_applicable'
              ? t('summary.noneResolved')
              : undefined
          }
        />
      </div>

      {conversations > 0 && <ResolutionBar metrics={metrics} />}

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">{t('summary.path')}</p>
        <ol className="grid grid-cols-5 gap-1">
          {metrics.stages5a.map((s) => (
            <StageCell key={s.stage} stage={s.stage} events={s.events} state={state(`stage.${s.stage}`)} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function KpiTile({
  label,
  value,
  state = 'measured',
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  state?: ValueState;
  note?: string;
  tone?: 'warn';
}) {
  const shown = value != null && state === 'measured';
  return (
    <div
      className={`rounded-lg border p-2.5 ${tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
    >
      <p className="text-[11px] text-gray-500">{label}</p>
      <div className="mt-0.5 min-h-[28px] text-lg font-semibold text-gray-900">
        {shown ? value : <ValueStateChip state={state} />}
      </div>
      {note && <p className="mt-0.5 truncate text-[11px] text-gray-500 print:overflow-visible print:whitespace-normal" title={note}>{note}</p>}
    </div>
  );
}

/** "—" alone cannot say whether a value is zero-by-definition, unrecorded, or unseeable. */
export function ValueStateChip({ state }: { state: ValueState }) {
  const { t } = useTranslation('journey');
  const look: Record<ValueState, string> = {
    measured: 'border-gray-200 text-gray-600',
    not_applicable: 'border-gray-200 bg-gray-100 text-gray-600',
    not_measured: 'border-amber-300 bg-amber-50 text-amber-800',
    not_observable: 'border-dashed border-gray-300 text-gray-500',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${look[state]}`}
      title={t(`valueState.${state}.hint`)}
    >
      {t(`valueState.${state}.label`)}
    </span>
  );
}

function ResolutionBar({ metrics }: { metrics: JourneyReportMetrics }) {
  const { t } = useTranslation('journey');
  const total = metrics.resolved + metrics.unresolved;
  if (!total) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const reasons = (by: Record<string, number>) =>
    Object.entries(by)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => t('summary.reasonCount', { reason: t(`reason.${k}`, { defaultValue: k }), count: n }))
      .join(' · ');
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-gray-600">
        <span className="font-medium text-gray-500">{t('summary.resolution')}</span>
        <span>
          {t('summary.resolvedCount', { count: metrics.resolved })}
          {metrics.resolved > 0 && ` (${reasons(metrics.resolvedBy)})`}
          {' · '}
          {t('summary.unresolvedCount', { count: metrics.unresolved })}
          {metrics.unresolved > 0 && ` (${reasons(metrics.unresolvedBy)})`}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden>
        <div className="bg-emerald-500" style={{ width: pct(metrics.resolved) }} />
        <div className="bg-amber-400" style={{ width: pct(metrics.unresolved) }} />
      </div>
    </div>
  );
}

function StageCell({ stage, events, state }: { stage: FiveAStage; events: number; state: ValueState }) {
  const { t } = useTranslation('journey');
  const observed = events > 0;
  return (
    <li
      className={`rounded-md border px-2 py-1.5 text-center ${
        observed ? 'border-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white'
      }`}
    >
      <p className={`text-xs font-medium ${observed ? 'text-indigo-700' : 'text-gray-600'}`}>
        {t(`fiveA.${stage}`)}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">
        {state === 'not_observable' ? (
          <ValueStateChip state={state} />
        ) : observed ? (
          t('summary.events', { count: events })
        ) : (
          t('summary.noEvents')
        )}
      </p>
      {stage === 'advocate' && observed && (
        <p className="text-[10px] text-gray-400">{t('summary.advocateCandidate')}</p>
      )}
    </li>
  );
}
