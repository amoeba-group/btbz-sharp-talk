import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { FiveAStage, JourneyReportContent, JourneyReportMetrics, ValueState } from '../journey.service';
import { ValueStateChip } from './JourneyReportSummaryView';

const STAGES: FiveAStage[] = ['aware', 'appeal', 'ask', 'act', 'advocate'];
type Lane = 'customer' | 'response' | 'pain' | 'opportunity';
const LANES: Lane[] = ['customer', 'response', 'pain', 'opportunity'];

/**
 * The same report as a journey map (PLN-261008 P3, draft B): 5A across, lanes
 * down.
 *
 * The first lane is the code's — touchpoint events and the value state — so a
 * column the support log cannot see says so instead of sitting empty. The
 * other lanes are the model's sentences from the structured report. There is
 * no emotion lane (REQ-261008 D4: nothing measures it), and hypotheses stay in
 * the report tab: they cite an utterance, not a stage.
 */
export function JourneyMapTable({
  metrics,
  states,
  content,
}: {
  metrics: JourneyReportMetrics;
  states: Record<string, ValueState> | null;
  content: JourneyReportContent | null;
}) {
  const { t } = useTranslation('journey');
  const events = new Map(metrics.stages5a.map((s) => [s.stage, s.events]));
  const cells = new Map((content?.stages ?? []).map((s) => [s.key, s]));
  const stateOf = (s: FiveAStage): ValueState => states?.[`stage.${s}`] ?? 'measured';

  const observed = (s: FiveAStage): ReactNode => {
    const n = events.get(s) ?? 0;
    if (stateOf(s) === 'not_observable') return <ValueStateChip state="not_observable" />;
    return n > 0 ? t('summary.events', { count: n }) : <span className="text-gray-400">{t('summary.noEvents')}</span>;
  };
  const lane = (s: FiveAStage, l: Lane): ReactNode => cells.get(s)?.[l] ?? <span className="text-gray-300">—</span>;
  const active = (s: FiveAStage) => (events.get(s) ?? 0) > 0 || !!cells.get(s)?.customer;

  return (
    <div>
      {!content && <p className="mb-2 text-xs text-gray-500">{t('map.noContent')}</p>}

      {/* Wide: the matrix. */}
      <div className="hidden overflow-x-auto sm:block print:block">
        <table className="w-full table-fixed border-collapse text-[12px] leading-snug">
          <thead>
            <tr>
              <th className="w-20 border-b border-gray-200 p-1.5" />
              {STAGES.map((s) => (
                <th
                  key={s}
                  scope="col"
                  className={`border-b border-gray-200 p-1.5 text-left font-semibold ${active(s) ? 'text-indigo-700' : 'text-gray-600'}`}
                >
                  {t(`fiveA.${s}`)}
                  {active(s) && <span className="ml-1 text-indigo-500">●</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label={t('map.observed')}>{STAGES.map((s) => observed(s))}</Row>
            {LANES.map((l) => (
              <Row key={l} label={t(`map.lane.${l}`)}>
                {STAGES.map((s) => lane(s, l))}
              </Row>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow: one card per step — a five-column table does not fit a phone. */}
      <ol className="space-y-2 sm:hidden print:hidden">
        {STAGES.map((s) => (
          <li key={s} className={`rounded-lg border p-2.5 ${active(s) ? 'border-indigo-200 bg-indigo-50/50' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-800">{t(`fiveA.${s}`)}</span>
              <span className="text-gray-500">{observed(s)}</span>
            </div>
            <dl className="mt-1.5 space-y-1 text-[12px]">
              {LANES.filter((l) => cells.get(s)?.[l]).map((l) => (
                <div key={l} className="flex gap-2">
                  <dt className="w-16 shrink-0 text-gray-500">{t(`map.lane.${l}`)}</dt>
                  <dd className="min-w-0 text-gray-800">{cells.get(s)?.[l]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-[11px] text-gray-400">{t('map.legend')}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode[] }) {
  return (
    <tr className="align-top">
      <th scope="row" className="border-b border-gray-100 p-1.5 text-left text-[11px] font-medium text-gray-500">
        {label}
      </th>
      {children.map((c, i) => (
        <td key={i} className="break-words border-b border-gray-100 p-1.5 text-gray-800">
          {c}
        </td>
      ))}
    </tr>
  );
}
