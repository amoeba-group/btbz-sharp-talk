import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/auth-store';
import { makeCan } from '@/lib/rbac';
import { useAgentAlerts } from '../live-chat/live-chat.hooks';
import { useAlarmCenter, useReadAlert } from './alerts.hooks';
import { reasonKey, useAlarmText } from './alarm-format';
import { AlertSettingsModal } from './AlertSettingsModal';

/**
 * Header 🔔 (PLN-261024 alarm center, wireframe 2-2): the count of unacked
 * alarms this agent has not seen, and a drawer of the latest twenty.
 */
export function AlarmBell() {
  const { t } = useTranslation('livechat');
  const navigate = useNavigate();
  const principal = useAuthStore((s) => s.principal);
  const canHandle = makeCan(principal)('live_chat');
  const { data: feed } = useAgentAlerts(canHandle);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const recent = useAlarmCenter({ status: 'all', days: 7, size: 20, page: 1 }, open && canHandle);
  const read = useReadAlert();
  const { assignee, facts } = useAlarmText();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!canHandle) return null;
  const unread = (feed ?? []).filter((a) => !a.readByMe).length;
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100"
        aria-label={t('alarmCenter.bell', { count: unread })}
        data-testid="alarm-bell"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-semibold text-gray-800">{t('alarmCenter.title')}</span>
            <span className="flex items-center gap-3 text-xs">
              <button type="button" className="flex items-center gap-1 text-gray-500 hover:text-gray-700" onClick={() => setSettingsOpen(true)}>
                <Settings className="h-3.5 w-3.5" /> {t('alarmCenter.settings.title')}
              </button>
              <Link to="/live-chat/alerts" className="text-primary-600 hover:underline" onClick={() => setOpen(false)}>
                {t('alarmCenter.viewAll')} →
              </Link>
            </span>
          </div>
          <ul className="max-h-[420px] divide-y divide-gray-100 overflow-y-auto">
            {recent.isLoading && <li className="px-3 py-3 text-sm text-gray-400">…</li>}
            {!recent.isLoading && !(recent.data?.items ?? []).length && (
              <li className="px-3 py-6 text-center text-sm text-gray-400">{t('alarmCenter.empty')}</li>
            )}
            {(recent.data?.items ?? []).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50"
                  onClick={() => {
                    if (!a.readByMe) read.mutate(a.id);
                    setOpen(false);
                    navigate(`/live-chat?c=${a.conversationId}`);
                  }}
                >
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.readByMe ? 'bg-gray-200' : 'bg-red-500')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-800">
                      #{a.conversationId} · {t(reasonKey(a.reason))}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {[facts(a), t('alarmCenter.assignee', { name: assignee(a) })].filter(Boolean).join(' · ')}
                    </span>
                    <span className="block text-[11px] text-gray-400">
                      {when(a.createdAt)} ·{' '}
                      {a.status === 'new'
                        ? t('alarmCenter.statusNew')
                        : t('alarmCenter.statusAcked', { name: a.ackedBy?.name ?? '—' })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <AlertSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
