import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BellRing, UserCheck, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { useAgentAlerts, useAckAlert } from './live-chat.hooks';
import type { AgentAlert } from './live-chat.service';
import { useAuthStore } from '@/store/auth-store';
import { makeCan } from '@/lib/rbac';
import { useAlertSettings, useReadAlert } from '../alerts/alerts.hooks';
import { playChime, showDesktop } from '../alerts/alarm-signal';
import { reasonKey, useAlarmText } from '../alerts/alarm-format';

/**
 * Global escalation alarm modal (FR-S3, PLAN-Scenario-Handoff-Alert §3.5).
 *
 * Every agent sees every unacked alarm with whom it was addressed to
 * (PLN-261024 D1). Which ones pop up, and with sound or a desktop notice, is
 * each agent's own setting (D4). "Close" marks it read for this agent only;
 * "Open chat" goes to the conversation and — for its assignee, or anyone on a
 * broadcast — stops the page (D2).
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
  const { data: settings } = useAlertSettings(canHandle);
  const ack = useAckAlert();
  const read = useReadAlert();
  const { assignee, facts } = useAlarmText();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const announced = useRef<Set<string> | null>(null);

  const popup = settings?.popup ?? 'all';
  const candidates = useMemo(
    () =>
      (alerts ?? []).filter(
        (a) => !a.readByMe && !dismissed.has(a.id) && (popup === 'all' || (popup === 'mine' && (a.assignedToMe || a.broadcast))),
      ),
    [alerts, dismissed, popup],
  );
  const current: AgentAlert | undefined = popup === 'off' ? undefined : candidates[0];

  // Sound / desktop notice once per new alarm. The first load only records what
  // is already there — reopening the console must not replay a queue of chimes.
  useEffect(() => {
    if (!alerts) return;
    if (announced.current === null) {
      announced.current = new Set(alerts.map((a) => a.id));
      return;
    }
    const fresh = candidates.filter((a) => !announced.current!.has(a.id));
    alerts.forEach((a) => announced.current!.add(a.id));
    if (!fresh.length || popup === 'off') return;
    if (settings?.sound !== false) playChime();
    if (settings?.desktop) {
      const a = fresh[0];
      showDesktop(t('alarmTitle'), `${t('alarmBody', { id: a.conversationId })} — ${t(reasonKey(a.reason))}`, `alarm-${a.id}`, () =>
        navigate(`/live-chat?c=${a.conversationId}`),
      );
    }
  }, [alerts, candidates, popup, settings, navigate, t]);

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

  const dismiss = () => {
    setDismissed((prev) => new Set(prev).add(current.id));
    read.mutate(current.id);
  };

  const open = () => {
    setDismissed((prev) => new Set(prev).add(current.id));
    // ack also marks it read; the server only stops the page for its assignee (D2).
    ack.mutate(current.id);
    navigate(`/live-chat?c=${current.conversationId}`);
  };

  const line = facts(current);
  return (
    <Modal
      open
      onClose={dismiss}
      title={
        <span className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-red-500" />
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
        {line && <p className="text-gray-600">{line}</p>}
        <p className="flex flex-wrap items-center gap-2">
          {current.broadcast && !current.assignees?.length ? (
            <Users className="h-4 w-4 text-gray-400" aria-hidden />
          ) : (
            <UserCheck className="h-4 w-4 text-primary-500" aria-hidden />
          )}
          <span className="font-medium">{t('alarmCenter.assignee', { name: assignee(current) })}</span>
          {current.assignedToMe ? (
            <Badge tone="primary">{t('alarmCenter.toMe')}</Badge>
          ) : !current.canAck ? (
            <Badge tone="gray">{t('alarmCenter.toOther')}</Badge>
          ) : null}
          {current.ruleName && <span className="text-xs text-gray-400">{t('alarmCenter.rule', { name: current.ruleName })}</span>}
        </p>
        <p className="text-gray-500">{t(reasonKey(current.reason))}</p>
        {current.preview && (
          <blockquote className="rounded-md border-l-2 border-primary-400 bg-gray-50 px-3 py-2 text-gray-600">
            {current.preview}
          </blockquote>
        )}
      </div>
    </Modal>
  );
}
