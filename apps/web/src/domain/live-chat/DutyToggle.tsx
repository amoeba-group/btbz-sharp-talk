import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useAgentProfile, useSetDuty } from './live-chat.hooks';

/**
 * "On duty / Off duty" switch in the Live chat header (PLN-261012 SG-60).
 *
 * Escalation alerts are routed to agents who are on duty AND have this console
 * open (the alert poll is the heartbeat), so the switch states plainly whether
 * the signed-in agent is in that pool. A user with no profile row yet reads as off
 * duty; the first switch-on creates the row server-side.
 */
export function DutyToggle() {
  const { t } = useTranslation('livechat');
  const { data: profile, isLoading } = useAgentProfile();
  const setDuty = useSetDuty();
  const onDuty = profile?.status === 'online';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={onDuty}
      disabled={isLoading || setDuty.isPending}
      onClick={() => setDuty.mutate(!onDuty)}
      title={t('duty.hint')}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
        onDuty
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
      )}
    >
      {setDuty.isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <span
          className={cn('h-2.5 w-2.5 rounded-full', onDuty ? 'bg-emerald-500' : 'bg-gray-400')}
          aria-hidden="true"
        />
      )}
      {onDuty ? t('duty.on') : t('duty.off')}
    </button>
  );
}
