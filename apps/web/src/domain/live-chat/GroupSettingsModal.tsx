import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ChannelBadge } from './ChannelBadge';
import type { useGroupActions } from './live-chat.hooks';
import type { ChatGroupDetail } from './live-chat.service';

/**
 * Group settings (REQ-260824 R4): rename, switch the classifier, remove
 * members (refused below two — dissolve instead), and dissolve. Dissolving
 * deletes only the group; the copy says so, because "delete" near a chat
 * list otherwise reads as losing conversations.
 */
export function GroupSettingsModal({
  open,
  onClose,
  group,
  actions,
  onDissolved,
}: {
  open: boolean;
  onClose: () => void;
  group: ChatGroupDetail;
  actions: ReturnType<typeof useGroupActions>;
  onDissolved: () => void;
}) {
  const { t } = useTranslation('livechat');
  const [title, setTitle] = useState(group.title);
  const [kind, setKind] = useState(group.kind);
  const [confirmDissolve, setConfirmDissolve] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(group.title);
      setKind(group.kind);
      setConfirmDissolve(false);
    }
  }, [open, group.title, group.kind]);

  const memberLabel = (m: ChatGroupDetail['members'][number]) =>
    m.alias || m.customerName || t('sessionLabel', { id: m.sessionId.slice(0, 6) });

  const dirty = title.trim() !== group.title || kind !== group.kind;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('groups.settingsTitle')}
      footer={
        <>
          {confirmDissolve ? (
            <Button
              variant="danger"
              disabled={actions.dissolve.isPending}
              onClick={() => actions.dissolve.mutate(undefined, { onSuccess: onDissolved })}
            >
              {t('groups.confirmDissolve')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmDissolve(true)}>
              {t('groups.dissolve')}
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            {t('groups.cancel')}
          </Button>
          <Button
            disabled={!dirty || !title.trim() || actions.update.isPending}
            onClick={() =>
              actions.update.mutate({ title: title.trim(), kind }, { onSuccess: onClose })
            }
          >
            {t('groups.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <div className="w-32">
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('groups.kind')}</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'timeline' | 'project')}
              className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm outline-none focus:border-primary-500"
            >
              <option value="timeline">{t('groups.kindLabel.timeline')}</option>
              <option value="project">{t('groups.kindLabel.project')}</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('groups.title')}</label>
            <input
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
            />
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-gray-600">
            {t('groups.memberCount', { count: group.members.length })}
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {group.members.map((m) => (
              <li
                key={m.sessionId}
                className="flex items-center justify-between gap-2 rounded-md border border-gray-100 px-2 py-1.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{memberLabel(m)}</span>
                  <ChannelBadge channel={m.channel} />
                </span>
                <button
                  type="button"
                  disabled={group.members.length <= 1 || actions.removeMember.isPending}
                  title={
                    group.members.length <= 1 ? t('groups.minMembersHint') : t('groups.removeMember')
                  }
                  aria-label={t('groups.removeMember')}
                  onClick={() => actions.removeMember.mutate(m.sessionId)}
                  className="rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-red-500 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          {group.members.length <= 1 && (
            <p className="mt-1 text-[11px] text-gray-400">{t('groups.minMembersHint')}</p>
          )}
        </div>

        <p className="text-[11px] text-gray-400">{t('groups.dissolveHint')}</p>
      </div>
    </Modal>
  );
}
