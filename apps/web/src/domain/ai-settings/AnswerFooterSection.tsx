import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
import { LanguageTabs } from './LanguageTabs';
import { useAiConfig } from './ai-settings.hooks';
import { aiSettingsService } from './ai-settings.service';
import type { AnswerFooter, ScenarioLang } from './ai-settings.service';

const MAX_CHARS = 500;

/**
 * Contact footer appended to every knowledge answer (PLN-261007-Go2Joy-FAQ-Accuracy R4)
 * + the values PII masking must leave alone (R2).
 *
 * The model used to write the contact block itself: go2joy's support e-mail
 * came out masked in 48 of 50 answers, the northern hotline as "the number you
 * provided", and two long answers were cut off inside it. Written once here,
 * appended by the system after moderation, the block is identical every time.
 */
export function AnswerFooterSection() {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const config = useAiConfig();
  const qc = useQueryClient();
  const tenantKey = useTenantKey();

  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState<Partial<Record<string, string>>>({});
  const [protectedText, setProtectedText] = useState('');
  const [lang, setLang] = useState<ScenarioLang>('VI' as ScenarioLang);

  useEffect(() => {
    const f = config.data?.answerFooter;
    setEnabled(!!f?.enabled);
    setText(f?.text ?? {});
    setProtectedText((f?.protected ?? []).join('\n'));
  }, [config.data?.answerFooter]);

  const save = useMutation({
    mutationFn: (answer_footer: AnswerFooter) => aiSettingsService.updateConfig({ answer_footer }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-config', tenantKey] });
      toast.success(t('answerFooter.saved'));
    },
    onError: (e: Error) => toast.error(e.message || t('answerFooter.saveError'), { sticky: true }),
  });

  const current = text[lang] ?? '';
  const preview =
    current.trim() || text.EN?.trim() || Object.values(text).find((v) => v?.trim())?.trim() || '';

  return (
    <Card
      title={t('answerFooter.title')}
      action={
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('answerFooter.enabled')}
        </label>
      }
    >
      <p className="mb-3 text-xs text-gray-500">{t('answerFooter.hint')}</p>

      <LanguageTabs value={lang} onChange={setLang} filled={text} />
      <textarea
        className="mt-2 w-full rounded-lg border border-gray-300 p-2 text-sm"
        rows={4}
        maxLength={MAX_CHARS}
        value={current}
        onChange={(e) => setText({ ...text, [lang]: e.target.value })}
        placeholder={t('answerFooter.placeholder')}
        aria-label={t('answerFooter.title')}
      />
      <p className="mt-1 text-xs text-gray-500">
        {t('answerFooter.fallback')} · {current.length}/{MAX_CHARS}
      </p>

      <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-gray-500">{t('answerFooter.protectedTitle')}</h4>
      <textarea
        className="w-full rounded-lg border border-gray-300 p-2 font-mono text-xs"
        rows={3}
        value={protectedText}
        onChange={(e) => setProtectedText(e.target.value)}
        placeholder="support@example.com&#10;19133261136016"
        aria-label={t('answerFooter.protectedTitle')}
      />
      <p className="mt-1 text-xs text-gray-500">{t('answerFooter.protectedHint')}</p>

      {enabled && preview ? (
        <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
          <div className="mb-1 font-semibold text-gray-500">{t('answerFooter.preview')}</div>
          <div className="whitespace-pre-wrap">
            {t('answerFooter.previewBody')}
            {'\n\n'}
            {preview}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              enabled,
              text,
              protected: protectedText
                .split('\n')
                .map((v) => v.trim())
                .filter(Boolean),
            })
          }
        >
          {save.isPending ? tc('loading') : tc('save')}
        </Button>
      </div>
    </Card>
  );
}
