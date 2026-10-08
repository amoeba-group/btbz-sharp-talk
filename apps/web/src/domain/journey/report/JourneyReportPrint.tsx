import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { JourneyReportDetail } from '../journey.service';
import { JourneyReportSummaryView } from './JourneyReportSummaryView';
import { JourneyReportDiagnosis } from './JourneyReportDiagnosis';
import { JourneyMapTable } from './JourneyMapTable';

/**
 * What the printer gets (PLN-261008 P3, draft C) — the browser's "Save as
 * PDF" is the export; no PDF library.
 *
 * Rendered straight into <body> and hidden on screen: the modal sits inside the
 * app shell, behind a scroll box capped at 70vh, and printing it would cut the
 * report at the fold. Under `@media print` everything else on the page is
 * hidden instead (index.css `.journey-print-root`).
 */
export function JourneyReportPrint({ report }: { report: JourneyReportDetail }) {
  const { t } = useTranslation('journey');
  return createPortal(
    <div className="journey-print-root bg-white p-8 text-gray-900">
      <header className="mb-4 border-b border-gray-300 pb-3">
        <p className="text-xs uppercase tracking-wide text-gray-500">SharpTalk · {t('title')}</p>
        <p className="mt-1 text-xs text-gray-600">
          {t('conditions', {
            period: report.periodFrom ? `${report.periodFrom} ~ ${report.periodTo ?? ''}` : t('period.whole'),
            sessions: report.sessionCount,
            version: report.criteriaVersion,
            model: report.model ?? '—',
          })}
          {' · '}
          {t('print.printedAt', { at: new Date().toLocaleString() })}
        </p>
      </header>
      {report.metrics && <JourneyReportSummaryView metrics={report.metrics} states={report.metricStates} />}
      {report.content ? (
        <JourneyReportDiagnosis content={report.content} addedTitles={new Set()} adding={false} />
      ) : (
        <pre className="whitespace-pre-wrap font-sans text-sm">{report.bodyMd}</pre>
      )}
      {report.metrics && (
        <section className="journey-print-break mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('tabs.map')}</h3>
          <JourneyMapTable metrics={report.metrics} states={report.metricStates} content={report.content} />
        </section>
      )}
    </div>,
    document.body,
  );
}
