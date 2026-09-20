import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { useQuestionStats } from './statistics.hooks';
import { DIMENSION_TABS } from './statistics.service';
import type { Dimension, StatRow } from './statistics.service';
import { TrendChart } from './TrendChart';
import {
  AgentSection,
  ChannelSection,
  HourSection,
  ResolutionSection,
} from './BreakdownSections';
import { CsatSection } from './CsatSection';
import { JourneySection } from './JourneySection';
import { DateRangePicker, useDateRange } from '@/components/DateRangePicker';
import { AccessSection } from './AccessSection';

/** Below this confidence an answer is treated as shaky (matches RAG_MIN_SIMILARITY). */
const LOW_CONFIDENCE = 0.45;
/**
 * Tab order: what was asked first (questions), then where it came from, who
 * answered, how it ended, and when it happens.
 */
const SECTIONS = ['journey', 'questions', 'access', 'channels', 'agents', 'resolution', 'csat', 'hours'] as const;
type Section = (typeof SECTIONS)[number];

/** Tabs computed from conversations/messages, which the retention purge removes. */
const LOG_BACKED_SECTIONS: readonly Section[] = ['journey', 'access', 'channels', 'agents', 'resolution', 'hours'];

/** Days behind yesterday before the page says so. 1 = simply "no questions yesterday". */
const STALE_WARN_DAYS = 2;
/** Escalation rate above which a topic is worth a knowledge fix. */
const HIGH_ESCALATION = 0.25;

/**
 * Customer question statistics (SCR-104 §4). Four lenses over the same daily
 * snapshots — intent, cited knowledge, keyword, and similar-question cluster —
 * so the table and chart are one implementation and the tab only changes a
 * query parameter.
 */
export function StatisticsPage() {
  const { t } = useTranslation('statistics');
  const navigate = useNavigate();

  const [dimension, setDimension] = useState<Dimension>('intent');
  // Two sections share the window below: question analytics and CSAT
  // (PLN-260826-Dashboard-Integration-CSAT-Stats).
  const [section, setSection] = useState<Section>('journey');
  // Presets first (PLN-260920b): "last 30 days" is the question operators
  // actually ask, and the custom range stays for the ones presets cannot say.
  const dateRange = useDateRange('d30');
  const { from, to } = dateRange.range;

  const { data, isLoading, error } = useQuestionStats({ dimension, from, to });
  const total = data?.total ?? 0;

  /** A topic people ask about but the AI handles badly is where knowledge work pays off. */
  const needsAttention = (r: StatRow) =>
    r.escalationRate >= HIGH_ESCALATION ||
    (r.avgConfidence !== null && r.avgConfidence < LOW_CONFIDENCE);

  const columns: Column<StatRow>[] = [
    {
      key: 'label',
      header: t(`dimension.${dimension}`),
      render: (r) => (
        <span className="flex items-center gap-1.5">
          {needsAttention(r) && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />}
          <span className="truncate">{r.label || r.key}</span>
        </span>
      ),
    },
    { key: 'asked', header: t('asked'), render: (r) => <span className="tabular-nums">{r.asked}</span> },
    {
      key: 'share',
      header: t('share'),
      render: (r) => (
        <span className="tabular-nums">{total > 0 ? `${((r.asked / total) * 100).toFixed(1)}%` : '—'}</span>
      ),
    },
    {
      key: 'escalationRate',
      header: t('escalationRate'),
      render: (r) => (
        <span className={`tabular-nums ${r.escalationRate >= HIGH_ESCALATION ? 'text-error' : ''}`}>
          {`${(r.escalationRate * 100).toFixed(0)}%`}
        </span>
      ),
    },
    {
      key: 'noSource',
      header: t('noSource'),
      render: (r) => <span className="tabular-nums">{r.noSource}</span>,
    },
    {
      key: 'avgConfidence',
      header: t('avgConfidence'),
      render: (r) =>
        r.avgConfidence === null ? (
          <span className="text-gray-400">—</span>
        ) : (
          <Badge tone={r.avgConfidence >= LOW_CONFIDENCE ? 'success' : 'warning'}>
            {r.avgConfidence.toFixed(2)}
          </Badge>
        ),
    },
  ];

  // Only the document lens has somewhere specific to go: its key is a KB id.
  const onRowClick =
    dimension === 'document' ? (r: StatRow) => navigate(`/knowledge?doc=${r.key}`) : undefined;

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {SECTIONS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              section === key
                ? 'border-primary-600 font-medium text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(`section.${key}`)}
          </button>
        ))}
      </div>

      {/* How old the numbers are. Without it the page looks identical whether
          the snapshot ran this morning or a week ago — which is how a stalled
          job hides. A day with no questions writes no rows, so this says the
          date and lets the reader judge rather than crying failure. */}
      {section === 'questions' && data && data.staleDays >= STALE_WARN_DAYS && (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          {data.lastAggregated
            ? t('staleWarning', { date: data.lastAggregated, days: data.staleDays })
            : t('neverAggregated')}
        </p>
      )}

      <Card className="mb-4">
        <div className="px-5 py-4">
          <DateRangePicker {...dateRange} />
        </div>
      </Card>

      {section === 'csat' && <CsatSection from={from} to={to} />}
      {/* These four read the conversation log itself, so they end where it
          does. Claimed in the plan and easy to leave unsaid — an empty range
          past the window would otherwise read as "nothing happened". */}
      {LOG_BACKED_SECTIONS.includes(section) && (
        <p className="mb-3 text-xs text-gray-400">{t('retentionNote')}</p>
      )}
      {section === 'journey' && (
        <JourneySection from={from} to={to} onGoToSection={(sec) => setSection(sec as Section)} />
      )}
      {section === 'access' && <AccessSection from={from} to={to} />}
      {section === 'channels' && <ChannelSection from={from} to={to} />}
      {section === 'agents' && <AgentSection from={from} to={to} />}
      {section === 'resolution' && <ResolutionSection from={from} to={to} />}
      {section === 'hours' && <HourSection from={from} to={to} />}

      {section === 'questions' && (
      <>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {DIMENSION_TABS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDimension(d)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              dimension === d
                ? 'border-primary-600 font-medium text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(`tab.${d}`)}
          </button>
        ))}
      </div>

      <Card className="mb-4" title={t('trendTitle')}>
        <TrendChart data={data?.trend ?? []} />
      </Card>

      <Table
        columns={columns}
        data={data?.top}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        emptyMessage={t('empty')}
        rowKey={(r) => r.key}
        onRowClick={onRowClick}
      />

      <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
        <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        {t('attentionHint')}
      </p>
      <p className="mt-1 text-xs text-gray-400">{t('snapshotNote')}</p>
      </>
      )}
    </div>
  );
}
