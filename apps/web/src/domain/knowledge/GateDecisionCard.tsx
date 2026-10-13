import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge';
// Source deep-import (a value import from '@sharptalk/types' fails the browser build — see language.ts).
import { gateDecisionTone, gateNoteKeys } from '../../../../../packages/types/src/common/gate-decision';
import type { GateReport } from './knowledge.service';

/**
 * The gate's decision for a simulated viewer ("Test as…", PLN-261012 SG-51, wireframe W3): what
 * the viewer would be told, how well the knowledge it may read grounded the question against which
 * bar, which categories it matched (with the tier that decides who may read them) and whether the
 * vector leg was even up. Purely presentational — every word comes from the API's decision, which
 * is the one chat itself uses.
 */
export function GateDecisionCard({ gate }: { gate: GateReport }) {
  const { t } = useTranslation('knowledge');
  const notes = gateNoteKeys(gate);
  const tier = (v: string | null) => (v ? t(`qa.gate.tier_${v}`, { defaultValue: v }) : t('qa.gate.tierNone'));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3" data-testid="gate-decision-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium text-gray-500">{t('qa.gate.title')}</p>
        <Badge tone={gateDecisionTone(gate.decision)}>{t(`qa.gate.decision_${gate.decision}`)}</Badge>
        <Badge tone="gray">{t(`qa.as_${gate.as}`)}</Badge>
      </div>

      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
        <div className="flex gap-1.5">
          <dt className="text-gray-400">{t('qa.gate.confidence')}</dt>
          <dd className="tabular-nums">
            {gate.confidence == null
              ? t('qa.gate.notMeasured')
              : `${gate.confidence.toFixed(2)} / ${t('qa.gate.bar')} ${gate.threshold.toFixed(2)}`}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-gray-400">{t('qa.gate.topSimilarity')}</dt>
          <dd className="tabular-nums">{gate.topSimilarity == null ? '—' : gate.topSimilarity.toFixed(2)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-gray-400">{t('qa.gate.provider')}</dt>
          <dd>
            {gate.degraded
              ? t('qa.gate.providerDegraded')
              : (gate.vectorProvider ?? t('qa.gate.providerNone'))}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-gray-400">{t('qa.gate.audience')}</dt>
          <dd>{t(`qa.gate.tier_${gate.audience}`)}</dd>
        </div>
      </dl>

      <div className="mt-2">
        <p className="mb-1 text-[11px] text-gray-400">{t('qa.gate.categories')}</p>
        {gate.matchedCategories.length === 0 ? (
          <p className="text-xs text-gray-400">{t('qa.gate.noCategories')}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {gate.matchedCategories.map((c) => (
              <li
                key={`${c.group ?? ''}|${c.category ?? ''}`}
                className="flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700"
              >
                <span>{c.category}</span>
                <Badge tone={c.tier === 'manager' ? 'warning' : c.tier === 'public' ? 'success' : 'gray'}>
                  {tier(c.tier)}
                </Badge>
                {c.similarity != null && (
                  <span className="tabular-nums text-gray-400">{c.similarity.toFixed(2)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {gate.reply && (
        <div className="mt-2 rounded border border-warning/30 bg-warning/5 p-2">
          <p className="mb-0.5 text-[11px] text-gray-400">{t('qa.gate.reply')}</p>
          <p className="whitespace-pre-wrap text-sm text-gray-800">{gate.reply}</p>
        </div>
      )}

      {notes.map((key) => (
        <p
          key={key}
          className={`mt-2 rounded p-2 text-xs ${key === 'degraded' ? 'bg-error/5 text-error' : 'bg-gray-50 text-gray-600'}`}
        >
          {t(`qa.gate.note_${key}`)}
        </p>
      ))}
    </div>
  );
}
