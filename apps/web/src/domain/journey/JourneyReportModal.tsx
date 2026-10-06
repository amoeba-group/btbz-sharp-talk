import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPlus } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useJourneyActions, useJourneyReport } from './journey.hooks';

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
  // The sentence the operator selected in the report. The report is prose in
  // the tenant's language, so a person picks the next action rather than a
  // parser guessing which lines are one (PLN-261006 P2).
  const [picked, setPicked] = useState('');
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
      footer={<Button variant="secondary" onClick={onClose}>{tc('close')}</Button>}
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
          {data.status === 'failed' ? (
            <p className="text-sm text-red-600">{data.error}</p>
          ) : (
            <>
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
                className="prose prose-sm max-w-none whitespace-pre-wrap"
                onMouseUp={capture}
                onKeyUp={capture}
              >
                {data.bodyMd}
              </article>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
