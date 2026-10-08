import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPlus, Printer } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useJourneyActions, useJourneyCard, useJourneyReport } from './journey.hooks';
import { JourneyReportSummaryView } from './report/JourneyReportSummaryView';
import { JourneyReportDiagnosis } from './report/JourneyReportDiagnosis';
import { JourneyMapTable } from './report/JourneyMapTable';
import { JourneyReportPrint } from './report/JourneyReportPrint';

/**
 * The body is model output that quotes shoppers, and the preview renders raw
 * HTML. A report needs none, so every `<` is shown as text rather than parsed.
 */
const asPlainMarkdown = (md: string) => md.replace(/</g, '&lt;');

/**
 * The report, with the conditions it was written under at the top.
 *
 * Those conditions are not decoration: reopened weeks later, a report is only
 * readable if it says what period, which sessions and which criteria version
 * produced it.
 */
export function JourneyReportModal({
  reportId,
  groupId,
  onClose,
}: {
  reportId: string | null;
  /** The group whose journey a picked next action is added to (PLN-261006). */
  groupId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('journey');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useJourneyReport(reportId);
  const actions = useJourneyActions(groupId ?? null);
  const card = useJourneyCard(groupId ?? null);
  // An action already on the journey from THIS report shows as added, so a
  // second click does not file it twice. Matched by title — no extra column.
  const addedTitles = useMemo(
    () =>
      new Set(
        (card.data?.tasks ?? [])
          .filter((task) => task.reportId != null && task.reportId === data?.id)
          .map((task) => task.title),
      ),
    [card.data, data?.id],
  );
  // The sentence the operator selected in the report. The report is prose in
  // the tenant's language, so a person picks the next action rather than a
  // parser guessing which lines are one (PLN-261006 P2).
  const [picked, setPicked] = useState('');
  const [tab, setTab] = useState<'report' | 'map'>('report');
  const printable = !!data && data.status === 'ready';
  const capture = () => {
    const text = window.getSelection()?.toString().replace(/\s+/g, ' ').trim() ?? '';
    setPicked(text.slice(0, 300));
  };

  return (
    <Modal
      open={!!reportId}
      onClose={onClose}
      size="lg"
      title={t('title')}
      footer={
        <>
          {printable && (
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" />
              {t('print.action')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>{tc('close')}</Button>
        </>
      }
    >
      {isLoading || !data ? (
        <p className="text-sm text-gray-500">{tc('loading')}</p>
      ) : (
        <>
          <div className="mb-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            {t('conditions', {
              period: data.periodFrom ? `${data.periodFrom} ~ ${data.periodTo ?? ''}` : t('period.whole'),
              sessions: data.sessionCount,
              version: data.criteriaVersion,
              model: data.model ?? '—',
            })}
          </div>
          {printable && <JourneyReportPrint report={data} />}
          {data.status !== 'failed' && data.metrics && (
            <JourneyReportSummaryView metrics={data.metrics} states={data.metricStates} />
          )}
          {data.status !== 'failed' && data.metrics && (
            <div role="tablist" aria-label={t('tabs.label')} className="mb-3 flex gap-1 border-b border-gray-200">
              {(['report', 'map'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                    tab === key
                      ? 'border-indigo-500 font-medium text-indigo-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t(`tabs.${key}`)}
                </button>
              ))}
            </div>
          )}
          {data.status !== 'failed' && data.metrics && tab === 'map' ? (
            <JourneyMapTable metrics={data.metrics} states={data.metricStates} content={data.content} />
          ) : data.status === 'failed' ? (
            <p className="text-sm text-red-600">{data.error}</p>
          ) : (
            <>
              {data.content && (
                <JourneyReportDiagnosis
                  content={data.content}
                  addedTitles={addedTitles}
                  adding={actions.addTask.isPending}
                  onAddAction={
                    groupId
                      ? (title) =>
                          actions.addTask.mutate({ title, source: 'report', report_id: Number(data.id) })
                      : undefined
                  }
                />
              )}
              {/* The prose stays one click away: it is what comparisons read,
                  and selecting a sentence still turns it into a next action. */}
              <details className="group mt-4" open={!data.content}>
                {data.content && (
                  <summary className="cursor-pointer select-none text-xs font-medium text-gray-500 hover:text-gray-700">
                    {t('diagnosis.original')}
                  </summary>
                )}
                <div className={data.content ? 'mt-2' : ''}>
                  {groupId && (
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-gray-200 p-2 text-xs text-gray-500">
                      <span className="min-w-0 flex-1 truncate">
                        {picked ? `“${picked}”` : t('tasks.pickHint')}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!picked || actions.addTask.isPending}
                        onClick={() =>
                          actions.addTask.mutate(
                            { title: picked, source: 'report', report_id: Number(data.id) },
                            { onSuccess: () => setPicked('') },
                          )
                        }
                      >
                        <ListPlus className="mr-1 h-3.5 w-3.5" />
                        {t('tasks.fromSelection')}
                      </Button>
                    </div>
                  )}
                  <article
                    data-color-mode="light"
                    // The preview's document-sized headings dwarf the summary above
                    // them inside a modal; a report reads as one page of sections.
                    className="[&_h1]:!text-lg [&_h1]:!border-0 [&_h2]:!text-base [&_h2]:!border-0 [&_h3]:!text-sm"
                    onMouseUp={capture}
                    onKeyUp={capture}
                  >
                    <MDEditor.Markdown
                      source={asPlainMarkdown(data.bodyMd ?? '')}
                      style={{ background: 'transparent', fontSize: 14 }}
                    />
                  </article>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
