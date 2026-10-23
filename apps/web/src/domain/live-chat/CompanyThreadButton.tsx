import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useTenantKey } from '@/lib/use-tenant-key';
import { useMergeCandidates, useMergedRoomActions } from './live-chat.hooks';
import { liveChatService } from './live-chat.service';

/**
 * "Business" badge + the company's other conversations (PLN-261022 stage 2,
 * wireframe 3.4). A partner hotel's staff change and sessions end; the agent
 * still sees what this hotel asked before. Picking one opens it here.
 *
 * For a business the hotel IS the customer (PLN-261023-LiveChat-Merge-Company-
 * Conversations F1): the list can also merge the checked conversations' sessions
 * into this conversation's merged room, with auto-join of the hotel's later
 * sessions. The server re-checks that every one belongs to the same hotel.
 */
export function CompanyThreadButton({
  conversationId,
  company,
  onOpen,
}: {
  conversationId: string;
  company?: { id: string; otherConversations: number } | null;
  onOpen: (conversationId: string) => void;
}) {
  const { t } = useTranslation('livechat');
  const { t: tc } = useTranslation('common');
  const tenantKey = useTenantKey();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [autoJoin, setAutoJoin] = useState(true);
  const list = useQuery({
    queryKey: ['company-conversations', tenantKey, conversationId],
    queryFn: () => liveChatService.companyConversations(conversationId),
    enabled: open && !!company,
  });
  // Where each session stands (merged here / taken out / another room) — same source as the header button.
  const candidates = useMergeCandidates(open && company ? conversationId : null);
  const actions = useMergedRoomActions();
  const stateOf = new Map((candidates.data?.sessions ?? []).map((s) => [s.sessionId, s]));
  const currentSession = candidates.data?.sessionId;

  // A fresh selection per opening; the switch starts from the room's own setting.
  useEffect(() => {
    if (!open) return;
    setChecked(new Set());
    setAutoJoin(candidates.data?.room ? candidates.data.room.autoJoin : true);
  }, [open, candidates.data?.room]);

  if (!company) return null;
  const fmt = (iso: string) => new Date(iso).toLocaleString();
  const toggle = (sessionId: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  const submit = () =>
    actions.merge.mutate(
      { conversationId, sessionIds: [...checked], autoJoin },
      { onSuccess: () => setOpen(false) },
    );

  return (
    <>
      <Badge tone="info">{t('company.badge')}</Badge>
      {company.otherConversations > 0 && (
        <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => setOpen(true)}>
          {t('company.earlier', { count: company.otherConversations })} ▸
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title={t('company.earlierTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tc('close')}
            </Button>
            <Button disabled={!checked.size || actions.merge.isPending} onClick={submit}>
              {t('company.mergeSelected', { count: checked.size })}
            </Button>
          </>
        }
      >
        {list.isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
        {list.error && <p className="text-sm text-error">{(list.error as Error).message}</p>}
        {list.data && (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm">
            {list.data.items.map((c) => {
              const state = stateOf.get(c.sessionId);
              const sameSession = c.sessionId === currentSession;
              const merged = !!state?.inRoom;
              // Same session as this conversation, already merged, or in another room: nothing to merge.
              const mergeable = !!state && !sameSession && !merged && !state.otherRoom;
              return (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    aria-label={t('company.selectForMerge', { id: c.id })}
                    disabled={!mergeable}
                    checked={merged || sameSession || checked.has(c.sessionId)}
                    onChange={(e) => toggle(c.sessionId, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    #{c.id} · {fmt(c.createdAt)}
                    {c.customerName && <span className="ml-2 text-xs text-gray-500">{c.customerName}</span>}
                  </span>
                  {sameSession && <Badge tone="primary">{t('merge.current')}</Badge>}
                  {merged && !sameSession && <Badge tone="info">{t('merge.alreadyMerged')}</Badge>}
                  {state?.excluded && <Badge tone="gray">{t('merge.excluded')}</Badge>}
                  <Badge tone={c.status === 'ended' ? 'gray' : 'primary'}>
                    {t(`company.status.${c.status}`, { defaultValue: c.status })}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setOpen(false);
                      onOpen(c.id);
                    }}
                  >
                    {t('company.open')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={autoJoin} onChange={(e) => setAutoJoin(e.target.checked)} />
          {t('company.autoJoin')}
        </label>
        <p className="mt-1 pl-6 text-xs text-gray-400">{t('merge.autoJoinHint')}</p>
      </Modal>
    </>
  );
}
