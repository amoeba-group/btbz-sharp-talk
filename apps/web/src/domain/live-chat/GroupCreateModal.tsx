import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ChannelBadge } from './ChannelBadge';
import { useGroups, useGroupActions } from './live-chat.hooks';
import type { AgentSession } from './live-chat.service';

/**
 * Group the selected sessions (REQ-260824): create a new timeline/project, or
 * add them to an existing group. Kind is a classifier only — the radio copy
 * explains the intent (individual vs client company), nothing else differs.
 */
export function GroupCreateModal({
  open,
  onClose,
  sessions,
  onDone,
  initialKind = 'timeline',
  initialTitle = '',
}: {
  /** Prefill from the same-person suggestion (PLN-261006 P1). */
  initialKind?: 'timeline' | 'project';
  initialTitle?: string;
  open: boolean;
  onClose: () => void;
  /** Selected list rows, already deduplicated by sessionId. */
  sessions: AgentSession[];
  onDone: () => void;
}) {
  const { t } = useTranslation('livechat');
  const [mode, setMode] = useState<'create' | 'add'>('create');
  const [kind, setKind] = useState<'timeline' | 'project'>(initialKind);
  const [title, setTitle] = useState(initialTitle);
  // The suggestion banner reopens this modal for a different customer; take
  // its prefill each time it opens rather than the first one only.
  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setTitle(initialTitle);
  }, [open, initialKind, initialTitle]);
  const [targetGroup, setTargetGroup] = useState('');
  const { data: groups } = useGroups(open);
  const actions = useGroupActions(null);

  const sessionIds = useMemo(
    () => sessions.map((s) => s.sessionId).filter((v): v is string => !!v),
    [sessions],
  );

  const labelOf = (s: AgentSession) =>
    s.alias || s.customerName || s.customerEmail || t('sessionLabel', { id: s.id.slice(0, 6) });

  const busy = actions.create.isPending || actions.addMembers.isPending;
  const canSubmit =
    !busy &&
    sessionIds.length > 0 &&
    (mode === 'create' ? sessionIds.length >= 1 && !!title.trim() : !!targetGroup);

  const submit = () => {
    if (!canSubmit) return;
    const after = () => {
      setTitle('');
      onDone();
    };
    if (mode === 'create') {
      actions.create.mutate({ kind, title: title.trim(), sessionIds }, { onSuccess: after });
    } else {
      actions.addMembers.mutate({ groupId: targetGroup, sessionIds }, { onSuccess: after });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('groups.modalTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('groups.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {mode === 'create' ? t('groups.create') : t('groups.addToGroup')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1">
          {(['create', 'add'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                mode === m
                  ? 'rounded-full bg-primary-500/10 px-3 py-1 text-xs font-medium text-primary-600'
                  : 'rounded-full px-3 py-1 text-xs text-gray-500 hover:bg-gray-100'
              }
            >
              {m === 'create' ? t('groups.modeCreate') : t('groups.modeAdd')}
            </button>
          ))}
        </div>

        {mode === 'create' ? (
          <>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-gray-600">{t('groups.kind')}</legend>
              {(['timeline', 'project'] as const).map((k) => (
                <label key={k} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="group-kind"
                    checked={kind === k}
                    onChange={() => setKind(k)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-gray-800">{t(`groups.kindLabel.${k}`)}</span>
                    <span className="block text-xs text-gray-500">{t(`groups.kindHint.${k}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {t('groups.title')}
              </label>
              <input
                value={title}
                maxLength={100}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('groups.titlePlaceholder')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
              />
            </div>
            {sessionIds.length < 1 && (
              <p className="text-xs text-amber-600">{t('groups.needTwo')}</p>
            )}
          </>
        ) : (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              {t('groups.pickGroup')}
            </label>
            <select
              value={targetGroup}
              onChange={(e) => setTargetGroup(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-primary-500"
            >
              <option value="">{t('groups.pickGroupPlaceholder')}</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>
                  [{t(`groups.kindLabel.${g.kind}`, { defaultValue: g.kind })}] {g.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-gray-600">
            {t('groups.selectedMembers', { count: sessions.length })}
          </p>
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
                <span className="truncate">{labelOf(s)}</span>
                <ChannelBadge channel={s.channel} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
