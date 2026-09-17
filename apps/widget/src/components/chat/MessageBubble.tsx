import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../lib/types';
import { formatTime } from '../../lib/format';
import { MessageAttachments } from './MessageAttachments';

/**
 * Citation URLs come from tenant-editable KB sources — only allow http(s) so a
 * `javascript:` URL can never become a stored-XSS link in the storefront (FE-M1).
 */
function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const { t, i18n } = useTranslation();
  const mine = message.senderType === 'user';
  return (
    <div className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        {message.senderType === 'agent' && message.senderName && (
          <div className="mb-0.5 text-[11px] font-medium text-gray-500">{message.senderName}</div>
        )}
        {/* A file sent with no words is a valid turn (PLN-260814) — render the
            attachments alone rather than an empty bubble above them. */}
        {message.body?.trim() && (
          <div
            className={[
              // Evenly rounded on all four corners: the Master Shots drop the
              // speech-bubble tail entirely (frames 53/57/61).
              'st-message whitespace-pre-wrap break-words rounded-st-lg px-3.5 py-2.5 text-sm',
              mine ? 'st-message-user bg-primary-500 text-on-primary' : 'st-message-bot bg-gray-100 text-gray-800',
            ].join(' ')}
          >
            {message.body}
          </div>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <MessageAttachments attachments={message.attachments} mine={mine} />
        )}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-1.5 border-t border-gray-200 pt-1.5">
            <p className="mb-0.5 text-[10px] font-medium text-gray-500">{t('chat.citations')}</p>
            <ul className="space-y-0.5">
              {message.citations.map((c, i) => {
                // The server only fills `url` for a product on this tenant's own
                // storefront, so anything with a link is a product to recommend
                // and everything else stays plain reference text.
                const href = c.url ? safeHttpUrl(c.url) : null;
                return (
                  <li key={i} className="text-xs text-primary-600">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        🛍 {c.title || c.url}
                      </a>
                    ) : (
                      <span className="text-gray-500">· {c.title || c.url}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {/* The design shows no timestamps (PLN §7 D-1). Removing them outright
            would cost the shopper any sense of when something was said, so they
            are kept but held back until the bubble is hovered.
            On a touch screen there is no hover and a text-only bubble has no
            focusable child, so hiding them there would hide them for good —
            pointer-coarse devices always show them. */}
        <div
          className={`mt-0.5 text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${
            mine ? 'text-right' : 'text-left'
          }`}
        >
          {formatTime(message.createdAt, i18n.language)}
        </div>
      </div>
    </div>
  );
}
