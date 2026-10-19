import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  INTEGRATION_FIELDS,
  SELF_PLATFORM_PROVIDER,
  type GenericIntegrationProvider,
} from './integration-providers';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { FormRow, Input } from '@/components/Field';
import {
  useIntegration,
  useSaveIntegration,
  useSyncEcommerceOrders,
  useSyncEcommerceProducts,
  useTestIntegration,
} from './settings.hooks';

/** Providers with a catalogue + order pull (REQ-260826). */
const SYNCABLE = new Set(['odoo', 'woocommerce', 'haravan']);

function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/**
 * Config-driven e-commerce integration settings in a modal. Renders credential
 * inputs from the shared INTEGRATION_FIELDS schema for the given provider
 * (cafe24/woocommerce/odoo/haravan), with save + connection test. Secret fields
 * are write-only.
 */
export function IntegrationConfigModal({
  provider,
  open,
  onClose,
}: {
  provider: GenericIntegrationProvider;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useIntegration(provider);
  const save = useSaveIntegration(provider);
  const test = useTestIntegration(provider);
  // Product + order pull for the providers that support it (REQ-260826).
  const syncProducts = useSyncEcommerceProducts(provider);
  const syncOrders = useSyncEcommerceOrders(provider);
  const syncable = SYNCABLE.has(provider);
  // The tenant's own platform has no remote end: nothing to test, nothing to
  // sync, and saving it registers it (PLN-261019 D4).
  const self = provider === SELF_PLATFORM_PROVIDER;
  const specs = INTEGRATION_FIELDS[provider];

  const [values, setValues] = useState<Record<string, string>>({});

  // Seed non-secret inputs from the server once loaded; secret inputs stay blank.
  useEffect(() => {
    if (!data) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const s of specs) {
        if (!s.secret && next[s.key] === undefined) next[s.key] = data.fields[s.key] ?? '';
      }
      return next;
    });
  }, [data, specs]);

  const setField = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));

  const onSave = async () => {
    const config: Record<string, string> = {};
    for (const s of specs) {
      const v = (values[s.key] ?? '').trim();
      if (s.secret) {
        if (v) config[s.key] = v; // empty secret → keep stored value
      } else {
        config[s.key] = v;
      }
    }
    await save.mutateAsync(config);
    // Clear secret inputs after save (never re-shown).
    setValues((p) => {
      const next = { ...p };
      for (const s of specs) if (s.secret) next[s.key] = '';
      return next;
    });
  };

  const integ = data?.integration;
  const statusTone =
    integ?.status === 'connected' ? 'success' : integ?.status === 'error' ? 'error' : undefined;
  const configured = data?.credential.configured;
  const requiredMissing = specs.some(
    (s) => s.required && !s.secret && !(values[s.key] ?? '').trim(),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(`integrations.${provider}.title`)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
          <Button onClick={onSave} disabled={isLoading || save.isPending || requiredMissing}>
            {save.isPending ? tc('saving') : tc('save')}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-gray-500">{t(`integrations.${provider}.subtitle`)}</p>

      {specs.map((s) => (
        <FormRow key={s.key} label={t(`integrations.fields.${s.key}`) + (s.required ? ' *' : '')}>
          <Input
            type={s.secret ? 'password' : 'text'}
            value={values[s.key] ?? ''}
            onChange={(e) => setField(s.key, e.target.value)}
            placeholder={
              s.secret
                ? data?.secrets[s.key]
                  ? t('integrations.configured')
                  : ''
                : t(`integrations.ph.${s.key}`, { defaultValue: '' })
            }
            autoComplete="off"
          />
        </FormRow>
      ))}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!self && (
          <Button
            variant="secondary"
            onClick={() => test.mutate()}
            disabled={test.isPending || !configured}
          >
            {test.isPending ? t('integrations.testing') : t('integrations.testConnection')}
          </Button>
        )}
        {syncable && (
          <>
            <Button
              variant="secondary"
              onClick={() => syncProducts.mutate()}
              disabled={syncProducts.isPending || !configured}
            >
              {syncProducts.isPending ? t('integrations.syncing') : t('integrations.syncProducts')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => syncOrders.mutate()}
              disabled={syncOrders.isPending || !configured}
            >
              {syncOrders.isPending ? t('integrations.syncing') : t('integrations.syncOrders')}
            </Button>
          </>
        )}
      </div>
      {syncable && <p className="mt-2 text-xs text-gray-400">{t('integrations.syncHint')}</p>}

      <div className="mt-4 space-y-1 border-t border-gray-100 pt-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{t('integrations.connectionStatus')}:</span>
          {self ? (
            <Badge tone={configured ? 'info' : 'gray'}>
              {configured ? t('integrations.state.registered') : t('notSet')}
            </Badge>
          ) : statusTone ? (
            <Badge tone={statusTone}>{t(`integrations.state.${integ?.status}`)}</Badge>
          ) : (
            <Badge>{t('integrations.state.unknown')}</Badge>
          )}
        </div>
        <div className="text-gray-500">
          {t('integrations.credential')}: {configured ? t('connected') : t('notSet')}
        </div>
        {!self && integ?.detail && <div className="text-gray-500">{integ.detail}</div>}
        <div className="text-xs text-gray-400">
          {self ? t('platforms.registeredAt') : t('integrations.lastTested')}: {fmtDate(integ?.lastSyncAt)}
        </div>
      </div>
    </Modal>
  );
}
