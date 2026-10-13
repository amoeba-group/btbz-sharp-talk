import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Label } from '@/components/Field';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
import { LanguageTabs } from './LanguageTabs';
import { useAiConfig } from './ai-settings.hooks';
import { aiSettingsService } from './ai-settings.service';
import type { ScenarioLang } from './ai-settings.service';
// Runtime values from the shared source: '@sharptalk/types' publishes CJS, which the
// bundler cannot trace a named export through (see apps/web/src/i18n/i18n.ts).
import {
  KB_UI_VERSION_MAX_LEN,
  KB_VERSION_CAVEAT_DEFAULTS,
  KB_VERSION_MISMATCH,
  KB_VERSION_NOTICE_MAX_LEN,
  kbVersionPolicyProblem,
} from '../../../../../packages/types/src/common/kb-version';
import type { KbVersionMismatchPolicy } from '../../../../../packages/types/src/common/kb-version';

const MODES: KbVersionMismatchPolicy[] = [
  KB_VERSION_MISMATCH.CAVEAT,
  KB_VERSION_MISMATCH.HIDE,
  KB_VERSION_MISMATCH.OFF,
];

/**
 * Reference UI version for knowledge documents (PLN-261012 SG-20, wireframe W2).
 *
 * The tenant names the product version its users run today; documents stamped
 * with another version either put one fixed sentence under the answer that cites
 * them (`caveat`), are left out of retrieval (`hide`), or change nothing (`off`).
 * The comparison is equality on a normalised label — NOT ordering — because the
 * version axis is not decided (Go2Joy's sources say v23.x, the requirements say
 * v0.4.1-v0.12.0). The help text says so, so an operator does not expect
 * "older than" to mean anything.
 */
export function KbVersionSection() {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const config = useAiConfig();
  const qc = useQueryClient();
  const tenantKey = useTenantKey();

  const [reference, setReference] = useState('');
  const [mode, setMode] = useState<KbVersionMismatchPolicy>(KB_VERSION_MISMATCH.CAVEAT);
  const [notice, setNotice] = useState<Partial<Record<string, string>>>({});
  const [lang, setLang] = useState<ScenarioLang>('VI' as ScenarioLang);

  useEffect(() => {
    const p = config.data?.kbVersionPolicy;
    setReference(p?.referenceVersion ?? '');
    setMode(p?.onMismatch ?? KB_VERSION_MISMATCH.CAVEAT);
    setNotice(p?.notice ?? {});
  }, [config.data?.kbVersionPolicy]);

  const save = useMutation({
    mutationFn: () => {
      const wording = Object.fromEntries(
        Object.entries(notice).filter(([, v]) => (v ?? '').trim()),
      ) as Partial<Record<ScenarioLang, string>>;
      return aiSettingsService.updateConfig({
        kb_version_policy: {
          referenceVersion: reference.trim(),
          onMismatch: mode,
          ...(Object.keys(wording).length ? { notice: wording } : {}),
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-config', tenantKey] });
      // The knowledge list's badge and mismatch filter measure against this.
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'version-policy'] });
      toast.success(t('kbVersion.saved'));
    },
    onError: (e: Error) => toast.error(e.message || t('kbVersion.saveError'), { sticky: true }),
  });

  const problem = kbVersionPolicyProblem({ referenceVersion: reference, onMismatch: mode });
  const current = notice[lang] ?? '';
  const builtIn = KB_VERSION_CAVEAT_DEFAULTS[lang] ?? KB_VERSION_CAVEAT_DEFAULTS.EN;

  return (
    <Card title={t('kbVersion.title')}>
      {config.isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
      {!config.isLoading && config.error && (
        <p className="text-sm text-error">
          {config.error instanceof Error ? config.error.message : tc('empty')}
        </p>
      )}
      {!config.isLoading && !config.error && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">{t('kbVersion.hint')}</p>

          <div>
            <Label>{t('kbVersion.reference')}</Label>
            <Input
              value={reference}
              maxLength={KB_UI_VERSION_MAX_LEN + 8}
              placeholder="v0.12.0"
              aria-label={t('kbVersion.reference')}
              aria-invalid={problem === 'reference_invalid'}
              onChange={(e) => setReference(e.target.value)}
              className="max-w-xs"
            />
            {problem === 'reference_invalid' && (
              <p className="mt-1 text-[11px] text-warning">{t('kbVersion.referenceInvalid')}</p>
            )}
            {problem === 'reference_required' && (
              <p className="mt-1 text-[11px] text-warning">{t('kbVersion.referenceRequired')}</p>
            )}
          </div>

          <fieldset className="space-y-2 border-t border-gray-100 pt-3">
            <legend className="mb-1 text-sm font-medium text-gray-600">{t('kbVersion.onMismatch')}</legend>
            {MODES.map((m) => (
              <label key={m} className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="kb-version-mode"
                  className="mt-1"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                <span>
                  <span className="font-medium">{t(`kbVersion.mode.${m}`)}</span>
                  <span className="block text-xs text-gray-500">{t(`kbVersion.modeHint.${m}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {mode === KB_VERSION_MISMATCH.CAVEAT && (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <div className="flex items-center gap-2">
                <Label>{t('kbVersion.notice')}</Label>
                <LanguageTabs value={lang} onChange={setLang} filled={notice} />
              </div>
              <textarea
                rows={2}
                maxLength={KB_VERSION_NOTICE_MAX_LEN}
                value={current}
                onChange={(e) => setNotice((prev) => ({ ...prev, [lang]: e.target.value }))}
                placeholder={builtIn}
                aria-label={t('kbVersion.notice')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
              />
              <p className="text-[11px] text-gray-400">
                {t('kbVersion.noticeHint')} · {current.length}/{KB_VERSION_NOTICE_MAX_LEN}
              </p>
            </div>
          )}

          <p className="text-[11px] text-gray-400">{t('kbVersion.retireNote')}</p>

          <div className="flex justify-end">
            <Button size="sm" disabled={save.isPending || problem !== null} onClick={() => save.mutate()}>
              {save.isPending ? tc('loading') : tc('save')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
