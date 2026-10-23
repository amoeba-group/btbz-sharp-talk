import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BellRing } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useAgentAlerts, useAckAlert } from './live-chat.hooks';
import type { AgentAlert } from './live-chat.service';
import { useAuthStore } from '@/store/auth-store';
import { makeCan } from '@/lib/rbac';

/**
 * Global escalation alarm modal (FR-S3, PLAN-Scenario-Handoff-Alert §3.5).
 * Polls new alerts and pops a modal; "Open chat" acks the alert and deep-links
 * to the conversation in Live Chat so the agent can continue the thread
 * (FR-S4). Alerts already dismissed in this browser tab are not re-shown.
 */
export function EscalationAlarm() {
  const { t } = useTranslation('livechat');
  const navigate = useNavigate();
  const location = useLocation();
  // Only agents with conversation-handling capability may poll /agent/alerts;
  // platform admins and non-consult users would just get 403s every 10s.
  const principal = useAuthStore((s) => s.principal);
  const canHandle = makeCan(principal)('live_chat');
  const { data: alerts } = useAgentAlerts(canHandle);
  const ack = useAckAlert();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const current: AgentAlert | undefined = useMemo(
    () => (alerts ?? []).find((a) => !dismissed.has(a.id)),
    [alerts, dismissed],
  );

  // Don't interrupt an agent who is already in the conversation being alerted.
  const alreadyViewing =
    !!current &&
    location.pathname.endsWith('/live-chat') &&
    new URLSearchParams(location.search).get('c') === String(current.conversationId);

  useEffect(() => {
    if (alreadyViewing && current) {
      ack.mutate(current.id);
      setDismissed((prev) => new Set(prev).add(current.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyViewing, current?.id]);

  if (!canHandle || !current || alreadyViewing) return null;

  const reasonKey =
    current.reason === 'low_confidence'
      ? 'alarmReasonLowConfidence'
      : current.reason === 'moderation_blocked'
        ? 'alarmReasonModeration'
        : current.reason === 'category_selected'
          ? 'alarmReasonCategory'
          : 'alarmReasonUserRequest';

  const dismiss = () => {
    setDismissed((prev) => new Set(prev).add(current.id));
    ack.mutate(current.id);
  };

  const open = () => {
    setDismissed((prev) => new Set(prev).add(current.id));
    ack.mutate(current.id);
    navigate(`/live-chat?c=${current.conversationId}`);
  };

  return (
    <Modal
      open
      onClose={dismiss}
      title={
        <span className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-danger-500 text-red-500" />
          {t('alarmTitle')}
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={dismiss}>
            {t('alarmDismiss')}
          </Button>
          <Button onClick={open}>{t('alarmOpen')}</Button>
        </div>
      }
    >
      <div className="space-y-2 text-sm text-gray-700">
        <p>{t('alarmBody', { id: current.conversationId })}</p>
        <p className="text-gray-500">{t(reasonKey)}</p>
        {current.preview && (
          <blockquote className="rounded-md border-l-2 border-primary-400 bg-gray-50 px-3 py-2 text-gray-600">
            {current.preview}
          </blockquote>
        )}
      </div>
    </Modal>
  );
}
