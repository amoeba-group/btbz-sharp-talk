import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Label } from '@/components/Field';
import { useAiConfig, useUpdateAiConfig } from './ai-settings.hooks';
import { LanguageTabs } from './LanguageTabs';
import type { GuestGuidance, ScenarioLang } from './ai-settings.service';

/** The link template is only useful with the placeholder the API substitutes. */
const HOTEL_PLACEHOLDER = '{hotelSn}';

/**
 * Guest sign-in guidance (PLN-261001 W2 + W8).
 *
 * One tenant-wide block because it is one set of facts: where a visitor signs
 * in or registers, what the assistant says when a question needs a signed-in
 * partner (per language, blank = the built-in prompt), and how the console
 * jumps from a signed partner session into the tenant's own system. Which
 * agents actually ask visitors to sign in is set per agent (W1) — this card
 * only decides what they are told once one does.
 *
 * W8 lives here rather than on the Embed card: the value is stored in the same
 * `guest_guidance` JSON and saved by the same capability, so splitting it
 * across two pages would mean two save paths for one row.
 */
export function GuestGuidanceSection() {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data: config, isLoading, error } = useAiConfig();
  const updateConfig = useUpdateAiConfig();

  const [loginUrl, setLoginUrl] = useState('');
  const [signupUrl, setSignupUrl] = useState('');
  const [notice, setNotice] = useState<Partial<Record<ScenarioLang, string>>>({});
  const [lang, setLang] = useState<ScenarioLang>('VI');
  const [hostLinkTemplate, setHostLinkTemplate] = useState('');

  useEffect(() => {
    const g = config?.guestGuidance;
    setLoginUrl(g?.loginUrl ?? '');
    setSignupUrl(g?.signupUrl ?? '');
    setNotice(g?.notice ?? {});
    setHostLinkTemplate(g?.hostLinkTemplate ?? '');
  }, [config]);

  const isHttps = (value: string) => !value.trim() || /^https:\/\/\S+$/i.test(value.trim());
  const loginOk = isHttps(loginUrl);
  const signupOk = isHttps(signupUrl);
  const templateOk =
    !hostLinkTemplate.trim() ||
    (isHttps(hostLinkTemplate) && hostLinkTemplate.includes(HOTEL_PLACEHOLDER));
  const valid = loginOk && signupOk && templateOk;

  const save = () => {
    const trimmedNotice = Object.fromEntries(
      Object.entries(notice).filter(([, v]) => (v ?? '').trim()),
    ) as Partial<Record<ScenarioLang, string>>;
    const guidance: GuestGuidance = {
      loginUrl: loginUrl.trim() || null,
      signupUrl: signupUrl.trim() || null,
      notice: trimmedNotice,
      hostLinkTemplate: hostLinkTemplate.trim() || null,
    };
    updateConfig.mutate({ guest_guidance: guidance });
  };

  return (
    <Card title={t('guest.title')}>
      {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
      {!isLoading && error && (
        <p className="text-sm text-error">{error instanceof Error ? error.message : tc('empty')}</p>
      )}
      {!isLoading && !error && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">{t('guest.hint')}</p>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>{t('guest.loginUrl')}</Label>
              <Input
                type="url"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
                placeholder="https://partner.example.com/sign-in"
                aria-label={t('guest.loginUrl')}
              />
              {!loginOk && <p className="mt-1 text-[11px] text-warning">{t('guest.httpsOnly')}</p>}
            </div>
            <div>
              <Label>{t('guest.signupUrl')}</Label>
              <Input
                type="url"
                value={signupUrl}
                onChange={(e) => setSignupUrl(e.target.value)}
                placeholder="https://partner.example.com/sign-up"
                aria-label={t('guest.signupUrl')}
              />
              {!signupOk && <p className="mt-1 text-[11px] text-warning">{t('guest.httpsOnly')}</p>}
            </div>
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <div className="flex items-center gap-2">
              <Label>{t('guest.notice')}</Label>
              <LanguageTabs value={lang} onChange={setLang} filled={notice} />
            </div>
            <textarea
              rows={2}
              value={notice[lang] ?? ''}
              onChange={(e) => setNotice((prev) => ({ ...prev, [lang]: e.target.value }))}
              placeholder={t('guest.noticePlaceholder')}
              aria-label={t('guest.notice')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
            />
            <p className="text-[11px] text-gray-400">{t('guest.noticeHint')}</p>
          </div>

          {/* W8: console deep link into the tenant's system for a signed partner. */}
          <div className="space-y-1 border-t border-gray-100 pt-3">
            <Label>{t('guest.hostLinkTemplate')}</Label>
            <Input
              value={hostLinkTemplate}
              onChange={(e) => setHostLinkTemplate(e.target.value)}
              placeholder="https://partner.example.com/hotel?hotelSn={hotelSn}"
              aria-label={t('guest.hostLinkTemplate')}
            />
            {!templateOk ? (
              <p className="text-[11px] text-warning">{t('guest.hostLinkTemplateInvalid')}</p>
            ) : (
              <p className="text-[11px] text-gray-400">{t('guest.hostLinkTemplateHint')}</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button size="sm" disabled={updateConfig.isPending || !valid} onClick={save}>
              {t('save')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
