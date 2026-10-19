import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { FormRow, Input } from '@/components/Field';
import { useCredentials, useUpdateCredential } from './settings.hooks';

const FULFILLMENT = 'fulfillment';

/**
 * Order-fulfillment webhook for a self-built store (PLN-260824 D5, moved into
 * the self-platform card by PLN-261019 D5).
 *
 * The pieces already existed — a generic fulfillment webhook and a per-tenant
 * signing secret — but only as an env var and an API; nothing in the console
 * ever showed them, so nobody could set one up without a developer.
 *
 * There is no rotate button because there is no rotate endpoint: replacing the
 * secret here overwrites it, and the sending system has to be updated in the
 * same breath. Saying that plainly beats a button that silently starts
 * rejecting inbound webhooks.
 */
export function FulfillmentWebhookBlock() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data } = useCredentials();
  const update = useUpdateCredential();
  const [secret, setSecret] = useState('');

  const cred = (data ?? []).find((c) => c.provider === FULFILLMENT);
  const webhookUrl = `${window.location.origin}/api/v1/webhooks/fulfillment`;

  const save = async () => {
    // The resolver reads `webhook_secret` out of the stored JSON, so the shape
    // matters as much as the value.
    await update.mutateAsync({
      provider: FULFILLMENT,
      body: { secret: JSON.stringify({ webhook_secret: secret.trim() }) },
    });
    setSecret('');
  };

  return (
    <div>
      <p className="text-sm font-semibold text-gray-800">{t('selfDev.webhookTitle')}</p>
      <p className="mb-3 mt-0.5 text-xs text-gray-500">{t('selfDev.hint')}</p>

      <FormRow label={t('selfDev.webhookUrl')}>
        <div className="flex items-center gap-2">
          <Input value={webhookUrl} readOnly className="font-mono text-xs" />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void navigator.clipboard?.writeText(webhookUrl)}
          >
            {tc('copy')}
          </Button>
        </div>
      </FormRow>

      <FormRow label={t('selfDev.secret')}>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              cred?.configured ? t('selfDev.secretStored') : t('selfDev.secretUnset')
            }
            // Off, or a password manager offers the console login for a field
            // that is not one — and saving that would quietly break the webhook.
            autoComplete="off"
            name="fulfillment-webhook-secret"
          />
          <Button size="sm" disabled={!secret.trim() || update.isPending} onClick={() => void save()}>
            {tc('save')}
          </Button>
          {cred?.configured ? (
            <Badge tone="success">{t('selfDev.configured')}</Badge>
          ) : (
            <Badge tone="warning">{t('selfDev.usingAppSecret')}</Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-amber-700">{t('selfDev.replaceWarning')}</p>
      </FormRow>
    </div>
  );
}
