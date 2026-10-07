import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import type { Comparison } from './golden.service';

interface ComparisonModalProps {
  comparison: Comparison | null;
  onClose: () => void;
}

/**
 * Before/after for one config change, question by question.
 *
 * States facts — confidence moved, citations changed, wording changed — and
 * stops there. Naming a difference a "regression" without knowing how much the
 * answers move on their own would be a guess dressed as a finding.
 */
export function ComparisonModal({ comparison, onClose }: ComparisonModalProps) {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  if (!comparison) return null;

  const changed = comparison.items.filter((i) => i.textChanged).length;

  return (
    <Modal
      open={!!comparison}
      onClose={onClose}
      title={t('regression.compareTitle')}
      size="lg"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {tc('close')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          {t('regression.compareSummary', { changed, total: comparison.items.length })}
        </p>

        {/* Same config on both sides means the differences are the model's own
            variance — the single most important thing to say before any number. */}
        {comparison.sameConfig && (
          <p className="flex items-start gap-1 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {t('regression.sameConfigNotice')}
          </p>
        )}

        {/* Graded questions (PLN-261007 R7): regressions come first from the server. */}
        {comparison.items.some((i) => i.regressed || i.improved) && (
          <p className="text-xs">
            <span className="font-semibold text-red-700">
              {t('regression.regressedCount', { count: comparison.items.filter((i) => i.regressed).length })}
            </span>
            {' · '}
            <span className="text-green-700">
              {t('regression.improvedCount', { count: comparison.items.filter((i) => i.improved).length })}
            </span>
          </p>
        )}

        {comparison.items.map((item, i) => (
          <div
            key={i}
            className={`rounded-lg border p-3 ${item.regressed ? 'border-red-300 bg-red-50/40' : 'border-gray-200'}`}
          >
            <p className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-800">
              {item.regressed && <Badge tone="error">{t('regression.regressed')}</Badge>}
              {item.improved && <Badge tone="success">{t('regression.improved')}</Badge>}
              {!item.regressed && !item.improved && item.targetVerdict && (
                <Badge tone={item.targetVerdict === 'pass' ? 'success' : 'error'}>
                  {t(`regression.verdict_${item.targetVerdict}`)}
                </Badge>
              )}
              {item.question}
            </p>
            {item.targetFailedChecks.length > 0 && (
              <p className="mb-1.5 text-[11px] text-red-700">{item.targetFailedChecks.join(' · ')}</p>
            )}

            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              {item.confidenceDelta !== null && (
                <Badge tone={item.confidenceDelta === 0 ? 'gray' : item.confidenceDelta > 0 ? 'success' : 'warning'}>
                  {t('regression.confidence')} {item.base?.confidence?.toFixed(2) ?? '—'} →{' '}
                  {item.target?.confidence?.toFixed(2) ?? '—'}
                </Badge>
              )}
              <Badge tone={item.citationsChanged ? 'info' : 'gray'}>
                {item.citationsChanged ? t('regression.citationsChanged') : t('regression.citationsSame')}
              </Badge>
              {item.lengthDelta !== null && item.lengthDelta !== 0 && (
                <Badge tone="gray">
                  {t('regression.length')} {item.lengthDelta > 0 ? '+' : ''}
                  {item.lengthDelta}
                </Badge>
              )}
              {!item.textChanged && <Badge tone="gray">{t('regression.textSame')}</Badge>}
              {item.target?.blocked && <Badge tone="error">{t('regression.blocked')}</Badge>}
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <p className="mb-0.5 text-[10px] font-semibold uppercase text-gray-400">
                  {t('regression.before')}
                </p>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">
                  {item.base?.answer || '—'}
                </p>
              </div>
              <div>
                <p className="mb-0.5 text-[10px] font-semibold uppercase text-gray-400">
                  {t('regression.after')}
                </p>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-primary-50/40 p-2 text-xs text-gray-700">
                  {item.target?.answer || '—'}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
