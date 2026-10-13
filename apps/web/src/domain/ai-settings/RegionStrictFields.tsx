import { useTranslation } from 'react-i18next';
import { Input, Label, Select } from '@/components/Field';

/**
 * What the config API returns in place of a stored regional Slack webhook (PLN-261012 SG-67). A
 * webhook is a credential, so the server only ever sends this mask; sending it back unchanged
 * means "keep what is stored", clearing the field removes the webhook, typing a URL replaces it.
 * Must equal WEBHOOK_MASK in apps/api/src/domain/ai-engine/slack-webhook.util.ts.
 */
export const WEBHOOK_MASK = 'https://hooks.slack.com/services/••••••••';

export type RegionMode = 'prefer' | 'strict';
export const REGION_TEAMS = ['north', 'south'] as const;
export type RegionTeam = (typeof REGION_TEAMS)[number];
export type PerTeam = Record<RegionTeam, string>;

/**
 * Strict regional routing and the per-team channels (PLN-261012 SG-67), shown under the region
 * table: how hard the regional boundary is, how long an unclaimed conversation waits before it
 * may reach the other team, and each team's own off-hours mailbox and Slack webhook.
 */
export function RegionStrictFields({
  mode,
  onMode,
  widen,
  onWiden,
  emails,
  onEmails,
  hooks,
  onHooks,
}: {
  mode: RegionMode;
  onMode: (m: RegionMode) => void;
  widen: string;
  onWiden: (v: string) => void;
  emails: PerTeam;
  onEmails: (next: PerTeam) => void;
  hooks: PerTeam;
  onHooks: (next: PerTeam) => void;
}) {
  const { t } = useTranslation('aiSetting');
  return (
    <div className="space-y-3 border-t border-gray-100 pt-3">
      <div className="max-w-md">
        <Label>{t('handoff.regionModeLabel')}</Label>
        <Select value={mode} onChange={(e) => onMode(e.target.value as RegionMode)} aria-label={t('handoff.regionModeLabel')}>
          <option value="prefer">{t('handoff.regionModePrefer')}</option>
          <option value="strict">{t('handoff.regionModeStrict')}</option>
        </Select>
        <p className="mt-1 text-[11px] text-gray-400">
          {mode === 'strict' ? t('handoff.regionModeStrictHint') : t('handoff.regionModePreferHint')}
        </p>
      </div>

      {mode === 'strict' && (
        <div className="w-60">
          <Label>{t('handoff.regionWiden')}</Label>
          <Input
            type="number"
            min={0}
            max={1440}
            value={widen}
            onChange={(e) => onWiden(e.target.value)}
            aria-label={t('handoff.regionWiden')}
            placeholder="0"
          />
          <p className="mt-1 text-[11px] text-gray-400">{t('handoff.regionWidenHint')}</p>
        </div>
      )}

      <div>
        <Label>{t('handoff.regionContactsTitle')}</Label>
        <p className="mb-2 text-[11px] text-gray-400">{t('handoff.regionContactsHint')}</p>
        <div className="space-y-2">
          {REGION_TEAMS.map((team) => (
            <div key={team} className="grid grid-cols-[7rem_1fr_1fr] items-start gap-2">
              <span className="pt-2 text-sm text-gray-700">{t(`handoff.regionTeam.${team}`)}</span>
              <Input
                type="email"
                value={emails[team]}
                onChange={(e) => onEmails({ ...emails, [team]: e.target.value })}
                placeholder={t('handoff.regionEmailPh')}
                aria-label={t('handoff.regionEmail', { team: t(`handoff.regionTeam.${team}`) })}
              />
              <div>
                <Input
                  value={hooks[team]}
                  onChange={(e) => onHooks({ ...hooks, [team]: e.target.value })}
                  placeholder={t('handoff.regionSlackPh')}
                  autoComplete="off"
                  aria-label={t('handoff.regionSlack', { team: t(`handoff.regionTeam.${team}`) })}
                />
                {hooks[team] === WEBHOOK_MASK && (
                  <p className="mt-1 text-[11px] text-gray-400">{t('handoff.regionSlackSaved')}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
