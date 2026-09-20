import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { useAccessStats } from './statistics.hooks';
import type { AccessRow } from './statistics.service';

/**
 * What happened before the conversation (PLN-260920).
 *
 * Every other lens on this page starts from conversations, so the console could
 * only ever describe traffic that already turned into a chat. This one starts
 * from widget loads, which is where the two most actionable numbers live: how
 * often the widget was shown, and how often anyone opened it.
 *
 * The two drop-offs want different fixes, so they are shown apart:
 *  · shown → opened   the launcher is invisible, or not worth touching
 *  · opened → talked  it opened onto something that does not invite a question
 */

/** Impressions a row needs before "nobody opened it" means anything. */
const MIN_IMPRESSIONS_TO_FLAG = 100;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => v.toLocaleString();

interface RangeProps {
  from: string;
  to: string;
}

export function AccessSection({ from, to }: RangeProps) {
  const { t } = useTranslation('statistics');
  const { data, isLoading, error } = useAccessStats(from, to);
  const totals = data?.totals;

  /** Columns shared by the agent and page tables — the same funnel either way. */
  const funnelColumns = (label: string): Column<AccessRow>[] => [
    {
      key: 'key',
      header: label,
      render: (r) =>
        r.key === 'default' ? (
          <span>{t('access.defaultAgent')}</span>
        ) : r.key.startsWith('deleted:') ? (
          <span className="text-gray-400">
            {t('agents.deleted', { id: r.key.slice('deleted:#'.length) })}
          </span>
        ) : (
          <span className="break-all">{r.key}</span>
        ),
    },
    {
      key: 'impressions',
      header: t('access.impressions'),
      render: (r) => <span className="tabular-nums">{num(r.impressions)}</span>,
    },
    {
      key: 'opens',
      header: t('access.opens'),
      // Sessions first, raw opens greyed behind it: the session count is what
      // the rate divides by, and showing only "opens" invites reading a
      // toggle-happy visitor as many visitors.
      render: (r) => (
        <span className="tabular-nums">
          {num(r.openedSessions)}
          {r.opens !== r.openedSessions && (
            <span className="ml-1 text-xs text-gray-400">({num(r.opens)})</span>
          )}
        </span>
      ),
    },
    {
      key: 'openRate',
      header: t('access.openRate'),
      render: (r) => (
        <span className="tabular-nums">
          {pct(r.openRate)}
          {r.impressions >= MIN_IMPRESSIONS_TO_FLAG && r.openedSessions === 0 && (
            <span className="ml-1" title={t('access.neverOpened')}>
              ⚠
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'conversations',
      header: t('access.conversations'),
      render: (r) => <span className="tabular-nums">{num(r.conversations)}</span>,
    },
    {
      key: 'chatRate',
      header: t('access.chatRate'),
      render: (r) => (
        <span className="tabular-nums">{r.openedSessions ? pct(r.chatRate) : '—'}</span>
      ),
    },
  ];

  const pathRows: AccessRow[] = [
    ...(data?.byPath ?? []),
    ...(data?.otherPaths ? [{ ...data.otherPaths, key: '__others__' }] : []),
  ];

  return (
    <div className="space-y-4">
      <Card title={t('access.funnelTitle')}>
        <div className="px-5 py-4">
        <p className="mb-3 text-xs text-gray-500">{t('access.funnelSubtitle')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Stat label={t('access.impressions')} hint={t('access.impressionsHint')} value={num(totals?.impressions ?? 0)} />
          <Arrow value={totals ? pct(totals.openRate) : '—'} label={t('access.openRate')} />
          <Stat
            label={t('access.opens')}
            hint={t('access.opensHint', { count: totals?.opens ?? 0 })}
            value={num(totals?.openedSessions ?? 0)}
          />
          <Arrow value={totals ? pct(totals.chatRate) : '—'} label={t('access.chatRate')} />
          <Stat label={t('access.conversations')} hint={t('access.conversationsHint')} value={num(totals?.conversations ?? 0)} />
        </div>
        <ul className="mt-3 space-y-1 text-xs text-gray-500">
          {data?.collectingSince && (
            <li>{t('access.since', { date: data.collectingSince })}</li>
          )}
          <li>{t('access.appModeNote')}</li>
        </ul>
        </div>
      </Card>

      <Card title={t('access.byAgentTitle')}>
        <Table
          columns={funnelColumns(t('access.agent'))}
          data={data?.byAgent}
          rowKey={(r) => r.key}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyMessage={t('access.empty')}
        />
        <p className="px-5 pb-4 text-xs text-gray-500">{t('access.defaultAgentNote')}</p>
      </Card>

      <Card title={t('access.byPathTitle')}>
        <Table
          columns={funnelColumns(t('access.path'))}
          data={pathRows.map((r) =>
            r.key === '__others__'
              ? { ...r, key: t('access.otherPaths', { count: data?.otherPaths?.paths ?? 0 }) }
              : r,
          )}
          rowKey={(r) => r.key}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyMessage={t('access.noPaths')}
        />
        <p className="px-5 pb-4 text-xs text-gray-500">{t('access.pathNote')}</p>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-[140px] flex-1 rounded-lg border border-gray-200 px-4 py-3">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</div>
      <div className="mt-0.5 text-xs text-gray-400">{hint}</div>
    </div>
  );
}

/** The conversion between two stages, drawn where the drop-off happens. */
function Arrow({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-1 text-center">
      <div className="text-gray-300">→</div>
      <div className="text-sm font-medium tabular-nums text-gray-700">{value}</div>
      <div className="text-[11px] text-gray-400">{label}</div>
    </div>
  );
}
