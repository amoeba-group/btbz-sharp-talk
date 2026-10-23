import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { groupMemberLabel } from './session-title';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';
import { ChannelBadge } from './ChannelBadge';
import { GroupSettingsModal } from './GroupSettingsModal';
import { MessageAttachments } from './MessageAttachments';
import { useGroup, useGroupMessages, useGroupActions } from './live-chat.hooks';
import { liveChatService } from './live-chat.service';
import type { ChatGroupMemberView, GroupMessage } from './live-chat.service';

function clockTime(value: string | undefined | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Group room (REQ-260824 R2/R3): one chronological stream over every member
 * session's conversations, each message attributed to its session, and a
 * strictly 1:1 composer — pick ONE member, send through the ordinary agent
 * path. No broadcast exists on purpose.
 */
export function GroupRoom({
  groupId,
  onDissolved,
}: {
  groupId: string;
  onDissolved: () => void;
}) {
  const { t } = useTranslation('livechat');
  const { data: group } = useGroup(groupId);
  const { data: feed, isLoading } = useGroupMessages(groupId);
  const actions = useGroupActions(groupId);

  const [recipient, setRecipient] = useState('');
  const [draft, setDraft] = useState('');
  const [older, setOlder] = useState<GroupMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);

  // Fresh room per group: locally-paged history must not leak across groups.
  useEffect(() => {
    setOlder([]);
    setRecipient('');
    setDraft('');
  }, [groupId]);

  const messages = [...older, ...(feed?.messages ?? [])];
  const hasMore = older.length ? true : feed?.hasMore ?? false;

  useEffect(() => {
    const last = messages[messages.length - 1]?.id ?? null;
    if (last && last !== lastIdRef.current) {
      lastIdRef.current = last;
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  const memberBySession = new Map<string, ChatGroupMemberView>(
    (group?.members ?? []).map((m) => [m.sessionId, m]),
  );
  // Same name and number as the conversation list (PLN-261023 S3).
  const memberLabel = (m: ChatGroupMemberView) => groupMemberLabel(m, (id) => t('sessionLabel', { id }));

  const loadOlder = async () => {
    const oldest = messages[0]?.id;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await liveChatService.groupMessages(groupId, oldest);
      setOlder((prev) => [...page.messages, ...prev]);
      if (!page.messages.length) setOlder((prev) => prev);
    } finally {
      setLoadingOlder(false);
    }
  };

  const recipientMember = recipient ? memberBySession.get(recipient) : undefined;
  const canSend = !!draft.trim() && !!recipientMember && !recipientMember.receiveOnly && !actions.send.isPending;

  const onSend = () => {
    if (!canSend) return;
    actions.send.mutate(
      { sessionId: recipient, body: draft.trim() },
      { onSuccess: () => setDraft('') },
    );
  };

  if (!group) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={group.kind === 'project' ? 'info' : 'primary'}>
            {t(`groups.kindLabel.${group.kind}`, { defaultValue: group.kind })}
          </Badge>
          <span className="truncate text-sm font-semibold text-gray-800">{group.title}</span>
          <span className="shrink-0 text-xs text-gray-400">
            {t('groups.memberCount', { count: group.members.length })}
          </span>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}>
          <Settings2 className="mr-1 h-3.5 w-3.5" /> {t('groups.settings')}
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {hasMore && (
          <div className="text-center">
            <Button size="sm" variant="ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('loadOlder')}
            </Button>
          </div>
        )}
        {isLoading && !messages.length && (
          <div className="p-6 text-center text-sm text-gray-400">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        )}
        {!isLoading && !messages.length && (
          <p className="p-6 text-center text-sm text-gray-400">{t('noMessages')}</p>
        )}
        {messages.map((m) => {
          const member = m.sessionId ? memberBySession.get(m.sessionId) : undefined;
          const fromCustomer = m.senderType === 'user';
          const isSystem = m.senderType === 'system';
          return (
            <div key={m.id} className={cn('flex flex-col', fromCustomer ? 'items-start' : 'items-end')}>
              <div
                className={cn(
                  'mb-0.5 flex items-center gap-1 text-[11px] text-gray-400',
                  !fromCustomer && 'flex-row-reverse',
                )}
              >
                <span className="truncate">
                  {fromCustomer
                    ? member
                      ? memberLabel(member)
                      : t('sender.user')
                    : m.senderName || t(`sender.${m.senderType}`, { defaultValue: m.senderType })}
                </span>
                <ChannelBadge channel={m.channel} />
                <span>{clockTime(m.createdAt)}</span>
              </div>
              <div
                className={cn(
                  'max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                  isSystem
                    ? 'bg-gray-50 text-gray-500'
                    : fromCustomer
                      ? 'bg-gray-100 text-gray-800'
                      : 'bg-primary-500/10 text-gray-800',
                )}
              >
                {m.body}
                <MessageAttachments attachments={m.attachments ?? []} outbound={!fromCustomer} />
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 1:1 composer — no recipient, no send. */}
      <div className="space-y-2 border-t border-gray-100 p-3">
        <div className="flex items-center gap-2">
          <label className="shrink-0 text-xs font-medium text-gray-600">
            {t('groups.recipient')}
          </label>
          <select
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-primary-500"
          >
            <option value="">{t('groups.recipientPlaceholder')}</option>
            {group.members.map((m) => (
              <option key={m.sessionId} value={m.sessionId} disabled={m.receiveOnly}>
                {memberLabel(m)} ({t(`channel.${m.channel}`, { defaultValue: m.channel })})
                {m.receiveOnly ? ` — ${t('channel.receiveOnlyShort')}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSend();
            }}
            placeholder={recipient ? t('replyPlaceholder') : t('groups.pickRecipientFirst')}
            disabled={!recipient}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
          />
          <Button onClick={onSend} disabled={!canSend} aria-label={t('send')}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <GroupSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        group={group}
        actions={actions}
        onDissolved={() => {
          setSettingsOpen(false);
          onDissolved();
        }}
      />
    </>
  );
}
