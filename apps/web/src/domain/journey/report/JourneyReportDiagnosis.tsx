import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ListPlus } from 'lucide-react';
import { Button } from '@/components/Button';
import type { JourneyReportContent } from '../journey.service';

/**
 * The report body as sections (REQ-261008 P2, draft C): conclusion first, then
 * what was asked and the words it was asked in, the hypotheses kept apart from
 * the facts, what in the data looks wrong, and what to do next.
 *
 * Every quote here is a sample the API copied verbatim; the model only chose
 * which one. Items whose evidence did not check out were removed before
 * storage, and the reader is told how many.
 */
export function JourneyReportDiagnosis({
  content,
  onAddAction,
  addedTitles,
  adding,
}: {
  content: JourneyReportContent;
  /** Absent when the report is opened without a group (no journey to add to). */
  onAddAction?: (title: string) => void;
  addedTitles: Set<string>;
  adding: boolean;
}) {
  const { t } = useTranslation('journey');
  const quote = new Map(content.quotes.map((q) => [q.id, q]));
  const summary = content.narrative.summary;

  return (
    <div className="space-y-5 text-sm text-gray-800">
      <header className="rounded-lg border-l-4 border-indigo-500 bg-indigo-50/60 px-4 py-3">
        <p className="text-base font-semibold leading-snug text-gray-900">{content.headline}</p>
        {content.subline && <p className="mt-1 text-gray-600">{content.subline}</p>}
        {summary && <p className="mt-2 text-gray-700">{summary}</p>}
        {content.dropped > 0 && (
          <p className="mt-2 text-xs text-gray-500">{t('diagnosis.dropped', { count: content.dropped })}</p>
        )}
      </header>

      {content.questions.length > 0 && (
        <Section title={t('diagnosis.questions')}>
          <ul className="space-y-3">
            {content.questions.map((q, i) => (
              <li key={i}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-gray-900">{q.text}</span>
                  {q.count != null && q.count > 0 && (
                    <span className="text-xs text-gray-500">{t('diagnosis.inSamples', { count: q.count })}</span>
                  )}
                  <AnsweredChip state={q.answered} />
                </div>
                {q.quoteIds.map((id) => {
                  const s = quote.get(id);
                  return s ? <QuoteLine key={id} quote={s} /> : null;
                })}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {content.hypotheses.length > 0 && (
        <Section title={t('diagnosis.hypotheses')} note={t('diagnosis.hypothesesNote')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {content.hypotheses.map((h, i) => (
              <div key={i} className="rounded-lg border border-dashed border-gray-300 p-3">
                <p className="text-xs font-medium text-gray-500">
                  {t('diagnosis.hypothesis', { n: i + 1 })}
                  {h.layer && ` · ${h.layer}`}
                </p>
                <dl className="mt-1.5 space-y-1 text-[13px]">
                  <Row label={t('diagnosis.evidence')}>“{quote.get(h.quoteId)?.text}”</Row>
                  <Row label={t('diagnosis.hypothesisLabel')}>{h.hypothesis}</Row>
                  <Row label={t('diagnosis.disproveIf')}>{h.disproveIf}</Row>
                </dl>
              </div>
            ))}
          </div>
        </Section>
      )}

      {content.dataFlags.length > 0 && (
        <Section title={t('diagnosis.dataFlags')}>
          <ol className="list-inside list-decimal space-y-1 text-gray-700">
            {content.dataFlags.map((f, i) => (
              <li key={i}>{f.text}</li>
            ))}
          </ol>
        </Section>
      )}

      {content.actions.length > 0 && (
        <Section title={t('diagnosis.actions')}>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {content.actions.map((a, i) => {
              const added = addedTitles.has(a.title);
              return (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="w-5 text-xs tabular-nums text-gray-400">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">{a.title}</p>
                    {a.successCriterion && (
                      <p className="text-xs text-gray-500">
                        {t('diagnosis.success', { criterion: a.successCriterion })}
                      </p>
                    )}
                  </div>
                  <UrgencyChip urgency={a.urgency} />
                  {onAddAction && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={added || adding}
                      onClick={() => onAddAction(a.title)}
                    >
                      {added ? <Check className="mr-1 h-3.5 w-3.5" /> : <ListPlus className="mr-1 h-3.5 w-3.5" />}
                      {added ? t('diagnosis.added') : t('diagnosis.addTask')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
        {note && <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 text-gray-800">{children}</dd>
    </div>
  );
}

export function QuoteLine({ quote }: { quote: JourneyReportContent['quotes'][number] }) {
  const { t } = useTranslation('journey');
  return (
    <blockquote className="mt-1.5 border-l-2 border-gray-300 pl-3 text-[13px] text-gray-700">
      “{quote.text}”
      <span className="ml-2 text-xs text-gray-400">
        {t(`diagnosis.who.${quote.who}`, { defaultValue: quote.who })} · {quote.at}
        {quote.truncated && ` · ${t('diagnosis.truncated')}`}
      </span>
    </blockquote>
  );
}

function AnsweredChip({ state }: { state: JourneyReportContent['questions'][number]['answered'] }) {
  const { t } = useTranslation('journey');
  const look = {
    answered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    unanswered: 'bg-amber-50 text-amber-800 border-amber-300',
    escalated: 'bg-sky-50 text-sky-700 border-sky-200',
  }[state];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${look}`}>
      {t(`diagnosis.answered.${state}`)}
    </span>
  );
}

function UrgencyChip({ urgency }: { urgency: JourneyReportContent['actions'][number]['urgency'] }) {
  const { t } = useTranslation('journey');
  const look = {
    now: 'bg-red-50 text-red-700 border-red-200',
    week: 'bg-amber-50 text-amber-800 border-amber-200',
    improve: 'bg-gray-50 text-gray-600 border-gray-200',
  }[urgency];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${look}`}>
      {t(`diagnosis.urgency.${urgency}`)}
    </span>
  );
}
