import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ProviderGrid } from '@/domain/settings/ProviderGrid';
import { PARTNER_DATA_PROVIDERS } from '@/domain/settings/integration-providers';
import { usePartnerDataSettings, useSavePartnerDataSettings } from './partner-data.hooks';
import { buildPartnerPatch, methodOf, toolsWarning } from './partner-data-patch';
import type { LookupMethodChoice } from './partner-data-patch';

/**
 * Tenant switch for the partner data lookup (PLN-261012 SG-31), with the
 * connection to the partner API right under it.
 *
 * Off by default. Turning it on lets a signed-in hotel user's questions about
 * THEIR hotel's rates, policies, bookings and settlement be answered from the
 * partner API — the hotel always comes from the signed identity, never from the
 * chat message. Two honest notices: the server-wide env switch can still be off
 * (then this switch does nothing), and the default mode is built-in SAMPLE data.
 *
 * Since SG-33 the tenant can also choose HOW a question is looked up: the standard
 * way (the server fetches what a keyword detector names) or AI-assisted (the
 * assistant picks the read-only lookups, behind the same checks). When the AI engine
 * cannot do that, the card says the standard lookup is what actually runs.
 */
export function PartnerDataCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = usePartnerDataSettings();
  const save = useSavePartnerDataSettings();
  // null = untouched: show what the server has.
  const [draft, setDraft] = useState<boolean | null>(null);
  const [methodDraft, setMethodDraft] = useState<LookupMethodChoice | null>(null);

  const enabled = draft ?? data?.enabled ?? false;
  const method = methodDraft ?? methodOf(data);
  const patch = buildPartnerPatch(data, { enabled: draft, method: methodDraft });
  const warning = toolsWarning(data, method);

  const onSave = () => {
    if (!patch) return;
    save.mutate(patch, {
      onSuccess: () => {
        setDraft(null);
        setMethodDraft(null);
      },
    });
  };

  const modeName = (m: 'prefetch' | 'tools') => t(m === 'tools' ? 'partnerData.modeTools' : 'partnerData.modePrefetch');
  const choices: Array<{ value: LookupMethodChoice; label: string; hint?: string }> = [
    { value: 'inherit', label: t('partnerData.methodInherit', { mode: modeName(data?.serverMode ?? 'prefetch') }) },
    { value: 'prefetch', label: t('partnerData.methodPrefetch') },
    { value: 'tools', label: t('partnerData.methodTools') },
  ];

  return (
    <Card
      title={t('partnerData.title')}
      action={
        data ? (
          <Badge tone={data.mode === 'live' ? 'success' : 'warning'}>
            {data.mode === 'live' ? t('partnerData.modeLive') : t('partnerData.modeMock')}
          </Badge>
        ) : undefined
      }
    >
      <p className="mb-4 text-sm text-gray-500">{t('partnerData.subtitle')}</p>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={isLoading || save.isPending}
          onChange={(e) => setDraft(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="text-sm font-medium text-gray-800">{t('partnerData.enable')}</span>
          <p className="mt-0.5 text-xs text-gray-500">{t('partnerData.hint')}</p>
        </span>
      </label>

      {data && !data.serverEnabled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {t('partnerData.serverOff')}
        </p>
      )}
      {data && data.mode === 'live' && !data.configured && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {t('partnerData.notConfigured')}
        </p>
      )}

      <fieldset className="mt-5" disabled={isLoading || save.isPending}>
        <legend className="mb-2 text-sm font-medium text-gray-700">{t('partnerData.methodTitle')}</legend>
        <div className="space-y-2">
          {choices.map((c) => (
            <label key={c.value} className="flex items-start gap-2 text-sm text-gray-800">
              <input
                type="radio"
                name="partner-lookup-method"
                value={c.value}
                checked={method === c.value}
                onChange={() => setMethodDraft(c.value)}
                className="mt-1"
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {warning && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {t(warning === 'off' ? 'partnerData.toolsOff' : 'partnerData.toolsUnsupported')}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button onClick={onSave} disabled={!patch || save.isPending}>
          {save.isPending ? tc('saving') : tc('save')}
        </Button>
      </div>

      <div className="mt-5 border-t border-gray-100 pt-4">
        <p className="mb-3 text-sm font-medium text-gray-700">{t('partnerData.connection')}</p>
        <ProviderGrid providers={PARTNER_DATA_PROVIDERS} />
      </div>
    </Card>
  );
}
