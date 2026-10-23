import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Combine } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ChannelBadge } from './ChannelBadge';
import { useMergeCandidates, useMergedRoomActions } from './live-chat.hooks';
import type { MergedRoomView } from './live-chat.service';

/**
 * Same-customer merged room in the conversation header
 * (PLN-261023-LiveChat-Merge-Same-Customer-Sessions).
 *
 * Not in a room: [Merge same customer (N)] when this conversation's customer
 * has other sessions — opens the merge dialog (wireframe ①).
 * In a room: [Merged N ▾] — the room's sessions, take one out, auto-join
 * on/off, dissolve, and merge the customer's remaining sessions (wireframe ②).
 * Nothing renders for a guest: merging is by confirmed identity only (D1).
 */
export function MergeRoomControl({
  conversationId,
  room,
  onOpenConversation,
}: {
  conversationId: string;
  room: MergedRoomView | null | undefined;
  onOpenConversation: (conversationId: string) => void;
}) {
  const { t, i18n } = useTranslation('livechat');
  const { data } = useMergeCandidates(conversationId);
  const actions = useMergedRoomActions();
  const [dialog, setDialog] = useState<'merge' | 'room' | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [autoJoin, setAutoJoin] = useState(true);

  // Sessions the dialog can still add: not this one, not already merged, not another customer's room.
  const addable = useMemo(
    () => (data?.sessions ?? []).filter((s) => !s.current && !s.inRoom && !s.otherRoom),
    [data],
  );

  // Fresh selection every time the dialog opens: everything addable except
  // sessions an operator took out before (D6) — bringing those back is a choice.
  useEffect(() => {
    if (dialog !== 'merge') return;
    setChecked(new Set(addable.filter((s) => !s.excluded).map((s) => s.sessionId)));
    setAutoJoin(room ? room.autoJoin : true);
  }, [dialog, addable, room]);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const matchLabel = (how: 'customer' | 'email' | 'claimed') => t(`merge.matchedBy.${how}`);

  if (!room && !addable.length) return null;

  const submit = () =>
    actions.merge.mutate(
      { conversationId, sessionIds: [...checked], autoJoin },
      { onSuccess: () => setDialog(null) },
    );

  return (
    <>
      {room ? (
        <button
          type="button"
          onClick={() => setDialog('room')}
          className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700 hover:border-primary-300"
          title={t('merge.manage')}
        >
          <Combine className="h-3.5 w-3.5" />
          {t('merge.badge', { count: room.sessions.length })}
          <ChevronDown className="h-3 w-3" />
        </button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setDialog('merge')}>
          <Combine className="h-4 w-4" /> {t('merge.open', { count: addable.length })}
        </Button>
      )}

      {/* ① merge dialog — session metadata only, nothing of the other sessions is shown before merging. */}
      <Modal
        open={dialog === 'merge'}
        onClose={() => setDialog(null)}
        size="md"
        title={t('merge.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t('groups.cancel')}
            </Button>
            <Button disabled={!checked.size || actions.merge.isPending} onClick={submit}>
              {t('merge.submit', { count: checked.size + (room ? room.sessions.length : 1) })}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-gray-500">{t('merge.hint')}</p>
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm">
          {(data?.sessions ?? [])
            .filter((s) => !s.otherRoom)
            .map((s) => {
              const fixed = s.current || s.inRoom;
              return (
                <li key={s.sessionId}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      disabled={fixed}
                      checked={fixed || checked.has(s.sessionId)}
                      onChange={(e) =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(s.sessionId);
                          else next.delete(s.sessionId);
                          return next;
                        })
                      }
                    />
                    <span className="font-medium">{s.alias || t('sessionLabel', { id: s.conversationId })}</span>
                    <ChannelBadge channel={s.channel} />
                    <span className="text-xs text-gray-500">
                      {s.open ? t('merge.inProgress') : t('merge.lastAt', { when: when(s.lastAt) })}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      {s.current && <Badge tone="primary">{t('merge.current')}</Badge>}
                      {s.inRoom && !s.current && <Badge tone="info">{t('merge.alreadyMerged')}</Badge>}
                      {s.excluded && <Badge tone="gray">{t('merge.excluded')}</Badge>}
                      {s.unverified ? (
                        <Badge tone="warning">{t('unverifiedCustomer')}</Badge>
                      ) : (
                        <span className="text-xs text-gray-400">{matchLabel(s.matchedBy)}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
        </ul>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={autoJoin} onChange={(e) => setAutoJoin(e.target.checked)} />
          {t('merge.autoJoin')}
        </label>
        <p className="mt-1 pl-6 text-xs text-gray-400">{t('merge.autoJoinHint')}</p>
      </Modal>

      {/* ② room menu */}
      {room && (
        <Modal
          open={dialog === 'room'}
          onClose={() => setDialog(null)}
          size="md"
          title={t('merge.manage')}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={actions.dissolve.isPending}
                onClick={() => actions.dissolve.mutate(room.id, { onSuccess: () => setDialog(null) })}
              >
                {t('merge.dissolve')}
              </Button>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                {t('close', { ns: 'common' })}
              </Button>
            </>
          }
        >
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm">
            {room.sessions.map((s) => (
              <li key={s.sessionId} className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                  onClick={() => {
                    setDialog(null);
                    onOpenConversation(s.conversationId);
                  }}
                >
                  <span className="font-medium">{s.alias || t('sessionLabel', { id: s.conversationId })}</span>
                  <ChannelBadge channel={s.channel} />
                  <span className="text-xs text-gray-500">
                    {s.open ? t('merge.inProgress') : t('merge.lastAt', { when: when(s.lastAt) })}
                  </span>
                  {s.auto && <Badge tone="gray">{t('merge.autoJoined')}</Badge>}
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={actions.remove.isPending}
                  onClick={() => actions.remove.mutate({ roomId: room.id, sessionId: s.sessionId })}
                  title={t('merge.removeHint')}
                >
                  {t('merge.remove')}
                </Button>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={room.autoJoin}
              disabled={actions.setAutoJoin.isPending}
              onChange={(e) => actions.setAutoJoin.mutate({ roomId: room.id, autoJoin: e.target.checked })}
            />
            {t('merge.autoJoin')}
          </label>
          {addable.length > 0 && (
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setDialog('merge')}>
              {t('merge.addMore', { count: addable.length })}
            </Button>
          )}
        </Modal>
      )}
    </>
  );
}
