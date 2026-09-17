import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Reply-pending indicator (PLN-260804).
 *
 * `ai` / `agent` mean a reply is actually being produced — the AI call is in
 * flight, or an agent has taken the thread — so the dots animate. `queued`
 * means the thread was handed off and is sitting in the queue with nobody on it
 * yet: animating "an agent is writing…" there promised a reply that could be
 * hours away (FIX-260806), so that state gets a still clock and honest wording.
 */
export function TypingBubble({ mode }: { mode: 'ai' | 'agent' | 'queued' }) {
  const { t } = useTranslation();
  const label =
    mode === 'queued'
      ? t('chat.waitingForAgent')
      : mode === 'agent'
        ? t('chat.typingAgent')
        : t('chat.typingAi');
  return (
    <div className="flex justify-start" role="status" aria-live="polite" aria-label={label}>
      <div className="flex max-w-[85%] items-center gap-2 rounded-st-xl rounded-bl-sm bg-gray-100 px-3 py-2">
        {mode === 'queued' ? (
          <Clock className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
        ) : (
          <span className="flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        )}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
    </div>
  );
}
