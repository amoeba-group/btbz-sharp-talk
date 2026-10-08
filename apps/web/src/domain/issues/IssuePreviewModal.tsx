import { MessageBody } from '../../components/RichText';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useTenantKey } from '@/lib/use-tenant-key';
import { cn } from '@/lib/cn';
import { liveChatService } from '../live-chat/live-chat.service';
import type { IssueCard } from './issues-board.service';

/** Recent turns are the context a card needs; more is a reason to open it. */
const PREVIEW_LIMIT = 10;

const SENDER_TONE: Record<string, string> = {
  user: 'bg-gray-100 text-gray-800',
  ai: 'bg-primary-500/10 text-primary-800',
  agent: 'bg-emerald-50 text-emerald-800',
  system: 'bg-amber-50 text-amber-800',
};

function clockTime(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Read-only look at what an issue is about (PLN-260812 FR-4/5).
 *
 * The board used to jump straight to Live Chat on a card click, so checking one
 * card cost the board's scroll position and filters. Reading happens here;
 * leaving the board is now a deliberate button.
 *
 * It fetches through the normal conversation endpoint, which records the PII
 * access audit — a preview is still someone reading the transcript.
 */
export function IssuePreviewModal({ card, onClose }: { card: IssueCard | null; onClose: () => void }) {
  const { t } = useTranslation('livechat');
  const navigate = useNavigate();
  const tenantKey = useTenantKey();

  const { data, isLoading } = useQuery({
    queryKey: ['agent', tenantKey, 'conversation-preview', card?.conversationId],
    queryFn: () => liveChatService.conversation(card!.conversationId),
    enabled: !!card,
  });

  const messages = (data?.messages ?? []).slice(-PREVIEW_LIMIT);

  return (
    <Modal
      open={!!card}
      onClose={onClose}
      title={card ? t('preview.title', { no: card.issueNo }) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('preview.close')}
          </Button>
          <Button
            onClick={() => {
              if (card) navigate(`/live-chat?conversation=${card.conversationId}`);
            }}
          >
            {t('preview.openSession')}
          </Button>
        </>
      }
    >
      {card && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
            <Badge tone="info">{t(`issue.type.${card.type}`, { defaultValue: card.type })}</Badge>
            <Badge>{t(`issue.status.${card.status}`, { defaultValue: card.status })}</Badge>
            {card.priority === 'urgent' && <Badge tone="error">{t('board.urgent')}</Badge>}
            {card.slaState === 'overdue' && <Badge tone="error">SLA</Badge>}
            <span className="text-gray-400">·</span>
            <span>{card.assigneeName ?? t('board.noAssignee')}</span>
          </div>

          <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <span className="font-medium text-gray-700">
              {t('sessionLabel', { id: card.sessionId.slice(0, 6) })}
            </span>
            {card.sessionAlias && <span className="ml-1.5 text-gray-800">· {card.sessionAlias}</span>}
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {isLoading && <p className="text-sm text-gray-400">{t('preview.loading')}</p>}
            {!isLoading && messages.length === 0 && (
              <p className="text-sm text-gray-400">{t('noMessages')}</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <span>{t(`sender.${m.senderType}`, { defaultValue: m.senderType })}</span>
                  {m.senderName && <span>· {m.senderName}</span>}
                  <span className="ml-auto">{clockTime(m.createdAt)}</span>
                </div>
                <div
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-sm',
                    SENDER_TONE[m.senderType] ?? 'bg-gray-100 text-gray-800',
                  )}
                >
                  <MessageBody text={m.body} raw={m.senderType === 'user'} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
