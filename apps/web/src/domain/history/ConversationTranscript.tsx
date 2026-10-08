import { MessageBody } from '../../components/RichText';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge';
import { useConversationDetail } from './history.hooks';
import type { ConversationMessage } from './history.service';

/**
 * Colour + label per sender, so a long thread is scannable at a glance. The
 * theme's success/warning tokens are single values with no 50-step, so the
 * tints come from Tailwind's stock palette.
 */
const SENDER_TONE: Record<string, { bg: string; label: string }> = {
  user: { bg: 'bg-gray-50', label: 'sender.user' },
  ai: { bg: 'bg-primary-50', label: 'sender.ai' },
  agent: { bg: 'bg-emerald-50', label: 'sender.agent' },
  system: { bg: 'bg-amber-50', label: 'sender.system' },
};

function fmtTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/**
 * The conversation transcript (SCR-104 §1). Beyond the messages it surfaces the
 * grounding stored with each AI turn — the documents cited and the confidence —
 * which has been persisted since the RAG work but was never readable anywhere.
 */
export function ConversationTranscript({
  conversationId,
  onOpenSource,
}: {
  conversationId: string;
  onOpenSource?: (documentId: string) => void;
}) {
  const { t } = useTranslation('history');
  const { data, isLoading, error } = useConversationDetail(conversationId);

  if (isLoading) return <p className="py-6 text-sm text-gray-400">{t('loadingThread')}</p>;
  if (error) return <p className="py-6 text-sm text-error">{(error as Error).message}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-gray-50 p-3 text-sm sm:grid-cols-4">
        <Meta label={t('customer')} value={data.customerName ?? '—'} />
        <Meta label={t('agent')} value={data.agentName ?? '—'} />
        <Meta label={t('channel')} value={data.channel ?? '—'} />
        <Meta label={t('language')} value={data.language?.toUpperCase() ?? '—'} />
        <Meta label={t('started')} value={fmtTime(data.startedAt ?? '')} />
        <Meta label={t('ended')} value={data.endedAt ? fmtTime(data.endedAt) : '—'} />
      </dl>

      <div className="space-y-2">
        {data.messages.length === 0 && <p className="text-sm text-gray-400">{t('noMessages')}</p>}
        {data.messages.map((m) => (
          <MessageBubble key={m.id} message={m} onOpenSource={onOpenSource} />
        ))}
      </div>

      <p className="border-t border-gray-100 pt-3 text-xs text-gray-400">{t('viewAudited')}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-gray-800">{value}</dd>
    </div>
  );
}

function MessageBubble({
  message,
  onOpenSource,
}: {
  message: ConversationMessage;
  onOpenSource?: (documentId: string) => void;
}) {
  const { t } = useTranslation('history');
  const tone = SENDER_TONE[message.senderType] ?? SENDER_TONE.system;
  const citations = message.trace?.citations ?? [];
  const confidence = message.trace?.confidence;

  return (
    <div className={`rounded-lg p-3 ${tone.bg}`}>
      <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
        <span className="font-medium text-gray-700">
          {message.senderName ?? t(tone.label)}
        </span>
        <span>{fmtTime(message.createdAt)}</span>
        {message.trace?.reason && <Badge tone="warning">{message.trace.reason}</Badge>}
      </div>
      <div className="text-sm text-gray-800">
        <MessageBody text={message.body} raw={message.senderType === 'user'} />
      </div>

      {(citations.length > 0 || confidence !== undefined) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/60 pt-2">
          <span className="text-[11px] text-gray-500">{t('grounding')}</span>
          {citations.map((c, i) => (
            <button
              key={`${c.id ?? i}`}
              type="button"
              disabled={!onOpenSource || c.id === undefined}
              onClick={() => c.id !== undefined && onOpenSource?.(String(c.id))}
              className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-700 enabled:hover:border-primary-400 disabled:cursor-default"
            >
              {c.title ?? `#${c.id}`}
              {typeof c.score === 'number' && (
                <span className="ml-1 tabular-nums text-gray-400">{c.score.toFixed(2)}</span>
              )}
            </button>
          ))}
          {confidence !== undefined && (
            <Badge tone={confidence >= 0.45 ? 'success' : 'warning'}>
              {t('confidence')} {confidence.toFixed(2)}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
