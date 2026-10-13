import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import { useAuthStore } from '@/store/auth-store';
import { useIdentityPolicy, useSaveIdentityPolicy } from './settings.hooks';

/**
 * Bounds the API accepts for the claims max age (whole hours). Mirrors
 * IDENTITY_MAX_AGE_HOURS_MIN/MAX in `@sharptalk/types`; the console does not import
 * values from that package (its CJS barrel breaks the browser bundle), and the API
 * re-checks anyway — this only saves the operator a round trip.
 */
const MIN_HOURS = 1;
const MAX_HOURS = 720;

interface Draft {
  /** false = follow the platform default; true = use `hours`. */
  custom: boolean;
  hours: string;
  refuseV1: boolean;
}

/**
 * Signed sign-in policy (PLN-261012 SG-03 / SG-04): how long the identity the host's
 * own server signs for the widget stays trusted, and whether a sign-in without hotel
 * and role (v1) is accepted at all. Lives next to the embed secret because it is the
 * other half of the same handshake. MASTER edits it; a DIRECTOR sees what is in force.
 */
export function IdentityPolicyCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useIdentityPolicy();
  const save = useSaveIdentityPolicy();
  const isMaster = useAuthStore((s) => s.principal?.rank) === 'master';
  const [draft, setDraft] = useState<Draft | null>(null);

  const stored: Draft = {
    custom: data?.maxAgeHours != null,
    hours: data?.maxAgeHours != null ? String(data.maxAgeHours) : '',
    refuseV1: data?.refuseV1 ?? false,
  };
  const current = draft ?? stored;
  const patch = (next: Partial<Draft>) => setDraft({ ...current, ...next });

  const hours = Number(current.hours);
  const hoursOk =
    !current.custom || (current.hours.trim() !== '' && Number.isInteger(hours) && hours >= MIN_HOURS && hours <= MAX_HOURS);

  const platformLabel =
    data?.platformDefaultHours != null
      ? t('identityPolicy.maxAgeDefault', { hours: data.platformDefaultHours })
      : t('identityPolicy.maxAgeDefaultNever');
  const inForce =
    data?.effectiveHours != null
      ? t('identityPolicy.inForce', { hours: data.effectiveHours })
      : t('identityPolicy.inForceNever');

  return (
    <Card title={t('identityPolicy.title')}>
      {isLoading ? (
        <p className="text-sm text-gray-400">{tc('loading')}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">{t('identityPolicy.description')}</p>

          {/* --- claims max age --- */}
          <div>
            <span className="text-sm font-medium text-gray-700">{t('identityPolicy.maxAge')}</span>
            <div className="mt-1 space-y-1">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="identity-max-age"
                  checked={!current.custom}
                  disabled={!isMaster}
                  onChange={() => patch({ custom: false })}
                />
                {platformLabel}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="identity-max-age"
                  checked={current.custom}
                  disabled={!isMaster}
                  onChange={() => patch({ custom: true, hours: current.hours || '8' })}
                />
                {t('identityPolicy.maxAgeCustom')}
                <Input
                  type="number"
                  min={MIN_HOURS}
                  max={MAX_HOURS}
                  step={1}
                  value={current.hours}
                  disabled={!isMaster || !current.custom}
                  aria-label={t('identityPolicy.maxAge')}
                  onChange={(e) => patch({ hours: e.target.value })}
                  className="w-24"
                />
                {t('identityPolicy.hours')}
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-400">{t('identityPolicy.maxAgeHint')}</p>
            {!hoursOk && <p className="mt-1 text-xs text-red-600">{t('identityPolicy.invalidHours')}</p>}
          </div>

          {/* --- v1 refusal --- */}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={current.refuseV1}
              disabled={!isMaster}
              onChange={(e) => patch({ refuseV1: e.target.checked })}
            />
            <span>
              <span className="text-sm font-medium text-gray-800">{t('identityPolicy.refuseV1')}</span>
              <p className="mt-0.5 text-xs text-gray-500">{t('identityPolicy.refuseV1Hint')}</p>
            </span>
          </label>

          <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">{inForce}</p>
          {!isMaster && <p className="text-xs text-gray-500">{t('identityPolicy.masterOnly')}</p>}

          <div className="flex justify-end">
            <Button
              disabled={!isMaster || draft === null || !hoursOk || save.isPending}
              onClick={() =>
                save.mutate(
                  { maxAgeHours: current.custom ? hours : null, refuseV1: current.refuseV1 },
                  { onSuccess: () => setDraft(null) },
                )
              }
            >
              {tc('save')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
