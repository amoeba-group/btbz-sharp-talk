import { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Label, Select } from '@/components/Field';
import { useRerouteConversation, useRoutingOptions } from './live-chat.hooks';

/** Region select values that are not a team: leave the region as it is / clear it. */
const KEEP = '__keep';
const CLEAR = '__clear';

/**
 * "Hand over to…" in the conversation header (PLN-261012 SG-64, wireframe W6): the customer picked
 * the wrong team, or the agent sees the chat belongs elsewhere. Opens a small dialog rather than acting
 * on a bare select — a stray click on a dropdown must not page another team. The dialog shows the
 * team the thread has now, offers the tenant's own team options (and the regional team when region
 * routing is on), and confirms with a toast that says who was asked.
 *
 * Hidden for a tenant that does not ask a team question (nothing to hand over to) and disabled once
 * the conversation has ended.
 */
export function RerouteControl({
  conversationId,
  status,
  supportType,
  supportRegion,
}: {
  conversationId: string;
  status?: string;
  supportType?: string | null;
  supportRegion?: string | null;
}) {
  const { t, i18n } = useTranslation('livechat');
  const { t: tc } = useTranslation('common');
  const { data: options } = useRoutingOptions(i18n.language);
  const reroute = useRerouteConversation(conversationId);
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState('');
  const [region, setRegion] = useState(KEEP);

  // Start each opening from the thread's current team, so confirming without a change is visibly a no-op.
  useEffect(() => {
    if (open) {
      setTeam(supportType ?? '');
      setRegion(KEEP);
    }
  }, [open, supportType]);

  if (!options?.enabled) return null;
  const ended = status === 'ended';
  const teamLabel = (id: string) => options.teams.find((o) => o.id === id)?.label ?? id;
  const regionName = (r: string) => t(`region.${r}`, { defaultValue: r });

  const submit = () => {
    reroute.mutate(
      {
        supportType: team,
        region: region === KEEP ? undefined : region === CLEAR ? null : region,
        teamLabel: teamLabel(team),
      },
      { onSuccess: () => setOpen(false) },
    );
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={ended}
        title={ended ? t('reroute.endedHint') : t('reroute.hint')}
      >
        <ArrowRightLeft className="h-4 w-4" /> {t('reroute.button')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('reroute.title')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={submit} disabled={!team || reroute.isPending}>
              {reroute.isPending ? tc('saving') : t('reroute.confirm')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p className="text-gray-500">{t('reroute.explain')}</p>
          <p className="text-xs text-gray-500">
            {t('reroute.current', {
              team: supportType ? teamLabel(supportType) : t('team.unassigned'),
              region: supportRegion ? regionName(supportRegion) : t('region.none'),
            })}
          </p>
          <div>
            <Label>{t('reroute.team')}</Label>
            <Select value={team} onChange={(e) => setTeam(e.target.value)} aria-label={t('reroute.team')}>
              <option value="" disabled>
                {t('reroute.teamPlaceholder')}
              </option>
              {options.teams.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          {options.regionEnabled && (
            <div>
              <Label>{t('reroute.region')}</Label>
              <Select value={region} onChange={(e) => setRegion(e.target.value)} aria-label={t('reroute.region')}>
                <option value={KEEP}>{t('reroute.regionKeep')}</option>
                {options.regions.map((r) => (
                  <option key={r} value={r}>
                    {regionName(r)}
                  </option>
                ))}
                <option value={CLEAR}>{t('reroute.regionClear')}</option>
              </Select>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
