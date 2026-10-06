import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, X } from 'lucide-react';
import { Button } from '@/components/Button';
import { ChannelBadge } from './ChannelBadge';
import { GroupCreateModal } from './GroupCreateModal';
import { useGroupActions, useRelatedSessions } from './live-chat.hooks';
import type { AgentSession } from './live-chat.service';

/**
 * Same-person suggestion (PLN-261006 P1). When the open conversation's
 * customer has other sessions — same customer row, or the same email on
 * another row — say so and offer to group them. Nothing is merged without the
 * operator's click: grouping by mistake would show one customer another
 * customer's conversations.
 *
 * Renders nothing for guests, for customers with a single session, and once
 * every sibling already shares a group with this one.
 */
export function RelatedSessionsBanner({
  conversationId,
  customerName,
  onOpenConversation,
}: {
  conversationId: string | null;
  customerName?: string | null;
  onOpenConversation: (conversationId: string) => void;
}) {
  const { t, i18n } = useTranslation('livechat');
  const { data } = useRelatedSessions(conversationId);
  const actions = useGroupActions(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  if (!conversationId || !data || !data.sessions.length || dismissed === conversationId) return null;

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { month: 'numeric', day: 'numeric' });
  // The current group, when this session already has one: the natural place
  // to add its siblings. A session in two groups gets the first (oldest kept).
  const target = data.currentGroups[0] ?? null;
  // Modal rows: only `id`/`sessionId`/`channel`/`alias` are read for display.
  const modalRows: AgentSession[] = [
    { id: conversationId, sessionId: data.sessionId, customerName: customerName ?? null },
    ...data.sessions.map((s) => ({
      id: s.conversationId,
      sessionId: s.sessionId,
      alias: s.alias,
      channel: s.channel,
      customerName: customerName ?? null,
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-primary-100 bg-primary-50/60 px-4 py-2 text-xs text-gray-700">
      <Users className="h-3.5 w-3.5 shrink-0 text-primary-500" />
      <span className="font-medium">{t('related.title', { count: data.sessions.length })}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {data.sessions.slice(0, 3).map((s) => (
          <button
            key={s.sessionId}
            type="button"
            onClick={() => onOpenConversation(s.conversationId)}
            title={s.matchedBy === 'email' ? t('related.byEmail') : t('related.byCustomer')}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 hover:border-primary-300"
          >
            {date(s.lastAt)}
            <ChannelBadge channel={s.channel} />
            {s.groups[0] && <span className="text-gray-400">· {s.groups[0].title}</span>}
          </button>
        ))}
        {data.sessions.length > 3 && (
          <span className="text-gray-400">{t('related.more', { count: data.sessions.length - 3 })}</span>
        )}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {target ? (
          <Button
            size="sm"
            disabled={actions.addMembers.isPending}
            onClick={() =>
              actions.addMembers.mutate({
                groupId: target.id,
                sessionIds: data.sessions.map((s) => s.sessionId),
              })
            }
          >
            {t('related.addTo', { title: target.title })}
          </Button>
        ) : (
          <Button size="sm" onClick={() => setModalOpen(true)}>
            {t('related.group')}
          </Button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(conversationId)}
          aria-label={t('related.dismiss')}
          title={t('related.dismiss')}
          className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </span>

      <GroupCreateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        sessions={modalRows}
        initialKind="timeline"
        initialTitle={customerName ?? ''}
        onDone={() => setModalOpen(false)}
      />
    </div>
  );
}
