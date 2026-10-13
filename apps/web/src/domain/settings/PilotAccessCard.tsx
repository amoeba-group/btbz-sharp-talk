import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { LanguageTabs } from '../ai-settings/LanguageTabs';
import type { ScenarioLang } from '../ai-settings/ai-settings.service';
// Same source-path import as the other settings cards: a value import of the package
// entry point breaks the browser build (CJS `export *`).
import { PILOT_NOTICE_MAX_LENGTH } from '../../../../../packages/types/src/common/pilot-access';
import { usePilotAccess, useSavePilotAccess } from './pilot.hooks';
import { PilotHotelsPanel } from './PilotHotelsPanel';
import type { PilotAccessDraft } from './pilot.service';

/**
 * Pilot scope by hotel (PLN-261012 SG-40, wireframe W4).
 *
 * "Serve only the hotels on this list, and here is what everyone else sees." The
 * list is matched against the SIGNED hotel serial of each session on every chat
 * turn, by the server — this card only configures that, and what the widget does
 * about it (hide, or show a note). It sits next to the exposure restriction because
 * both answer "who sees the widget"; that one for a test window, this one for a
 * hotel-by-hotel rollout.
 *
 * The switch and wording are a draft saved with the Save button (sent whole); the
 * hotel list below acts immediately, each change toasted and audited.
 */
export function PilotAccessCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading, isError } = usePilotAccess();
  const save = useSavePilotAccess();

  const [draft, setDraft] = useState<PilotAccessDraft | null>(null);
  const [lang, setLang] = useState<ScenarioLang>('VI');

  const current: PilotAccessDraft = draft ?? {
    enabled: data?.enabled ?? false,
    guestAllowed: data?.guestAllowed ?? true,
    nonPilot: data?.nonPilot ?? 'hide',
    notice: data?.notice ?? {},
  };
  const dirty = draft !== null;
  const patch = (next: Partial<PilotAccessDraft>) => setDraft({ ...current, ...next });
  const active = data?.activeCount ?? 0;

  return (
    <Card
      title={t('pilot.title')}
      action={
        data ? (
          <Badge tone={data.enabled ? 'primary' : 'gray'}>
            {data.enabled ? t('pilot.badgeOn', { count: active }) : t('pilot.badgeOff')}
          </Badge>
        ) : undefined
      }
    >
      {isError && <p className="text-sm text-error">{t('pilot.loadError')}</p>}

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={current.enabled}
          disabled={isLoading}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="mt-1"
        />
        <span>
          <span className="text-sm font-medium text-gray-800">
            {current.enabled ? t('pilot.on') : t('pilot.off')}
          </span>
          <p className="mt-0.5 text-xs text-gray-500">{t('pilot.hint')}</p>
        </span>
      </label>

      {current.enabled && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          {/* --- hotels not on the list --- */}
          <fieldset>
            <legend className="text-sm font-medium text-gray-700">{t('pilot.nonPilot')}</legend>
            <div className="mt-1 space-y-1">
              {(['hide', 'notice'] as const).map((mode) => (
                <label key={mode} className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="pilot-non-pilot"
                    checked={current.nonPilot === mode}
                    onChange={() => patch({ nonPilot: mode })}
                    className="mt-1"
                  />
                  <span>
                    {t(`pilot.nonPilotMode.${mode}`)}
                    <span className="block text-xs text-gray-400">{t(`pilot.nonPilotMode.${mode}Hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* --- visitors with no signed hotel --- */}
          <div>
            <span className="text-sm font-medium text-gray-700">{t('pilot.guests')}</span>
            <label className="mt-1 flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={current.guestAllowed}
                onChange={(e) => patch({ guestAllowed: e.target.checked })}
                className="mt-1"
              />
              <span>
                {t('pilot.guestsAllowed')}
                <span className="block text-xs text-gray-400">{t('pilot.guestsHint')}</span>
              </span>
            </label>
          </div>

          {/* --- wording, per language --- */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">{t('pilot.notice')}</span>
              <LanguageTabs value={lang} onChange={setLang} filled={current.notice} />
            </div>
            <textarea
              rows={2}
              maxLength={PILOT_NOTICE_MAX_LENGTH}
              value={current.notice[lang] ?? ''}
              onChange={(e) => patch({ notice: { ...current.notice, [lang]: e.target.value } })}
              placeholder={t('pilot.noticePlaceholder')}
              aria-label={t('pilot.notice')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
            />
            <p className="text-xs text-gray-400">{t('pilot.noticeHint')}</p>
          </div>

          {active === 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700" role="alert">
              {t('pilot.noHotelsWarning')}
            </p>
          )}

          <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {t('pilot.summary', {
              count: active,
              guests: current.guestAllowed ? t('pilot.summaryGuestsYes') : t('pilot.summaryGuestsNo'),
              others: t(`pilot.summaryOthers.${current.nonPilot}`),
            })}
          </p>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate(
              {
                ...current,
                // Blank wording is "use the built-in line", not an empty notice.
                notice: Object.fromEntries(
                  Object.entries(current.notice).filter(([, v]) => (v ?? '').trim()),
                ),
              },
              { onSuccess: () => setDraft(null) },
            )
          }
        >
          {save.isPending ? tc('saving') : tc('save')}
        </Button>
      </div>

      {/* The list is shown even while the switch is off: a pilot is prepared before it
          is switched on. Its changes do not wait for Save. */}
      <PilotHotelsPanel total={data?.totalCount ?? 0} disabled={isLoading} />
    </Card>
  );
}
