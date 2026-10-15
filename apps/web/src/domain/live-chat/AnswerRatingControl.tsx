import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, CircleX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ANSWER_RATING_REASONS } from './live-chat.service';
import type { AnswerRatingValue, AnswerRatingView } from './live-chat.service';
import { useRateAnswer } from './live-chat.hooks';

const OPTIONS: Array<{ value: AnswerRatingValue; icon: typeof Check; tone: string }> = [
  { value: 'accurate', icon: Check, tone: 'text-success' },
  { value: 'partial', icon: CircleAlert, tone: 'text-warning' },
  { value: 'inaccurate', icon: CircleX, tone: 'text-error' },
];

/**
 * Accuracy verdict on one AI/agent answer (PLN-261015 D7, wireframe §6.9).
 *
 * Collapsed it is a single link (or the current verdict); opened it offers the
 * three verdicts, a reason and a note. A non-accurate AI verdict becomes a
 * knowledge-gap proposal server-side, which the save toast says.
 */
export function AnswerRatingControl({
  conversationId,
  messageId,
  current,
  onDark = false,
}: {
  conversationId: string;
  messageId: string;
  current?: AnswerRatingView | null;
  /** The agent bubble is solid primary; the AI bubble is a light tint. */
  onDark?: boolean;
}) {
  const { t } = useTranslation('livechat');
  const rate = useRateAnswer(conversationId);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<AnswerRatingValue | null>(current?.rating ?? null);
  const [reason, setReason] = useState(current?.reason ?? '');
  const [note, setNote] = useState(current?.note ?? '');

  const linkTone = onDark ? 'text-white/80' : 'text-primary-600';
  if (!open) {
    const shown = current ? OPTIONS.find((o) => o.value === current.rating) : null;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('mt-1 flex items-center gap-1 text-[11px] underline-offset-2 hover:underline', linkTone)}
      >
        {shown ? (
          <>
            <shown.icon className={cn('h-3 w-3', onDark ? '' : shown.tone)} /> {t(`rating.value.${shown.value}`)}
            {current?.reason ? ` · ${t(`rating.reason.${current.reason}`)}` : ''}
          </>
        ) : (
          t('rating.action')
        )}
      </button>
    );
  }

  const save = () => {
    if (!rating) return;
    rate.mutate(
      { messageId, rating, reason: rating === 'accurate' ? undefined : reason, note },
      { onSuccess: () => setOpen(false) },
    );
  };

  return (
    <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-white p-2 text-gray-700">
      <div className="flex flex-wrap gap-1">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setRating(o.value)}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
              rating === o.value ? 'border-primary-500 bg-primary-500/10 text-primary-700' : 'border-gray-200',
            )}
          >
            <o.icon className={cn('h-3 w-3', o.tone)} /> {t(`rating.value.${o.value}`)}
          </button>
        ))}
      </div>
      {rating && rating !== 'accurate' && (
        <select
          aria-label={t('rating.reasonLabel')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">{t('rating.reasonLabel')}</option>
          {ANSWER_RATING_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`rating.reason.${r}`)}
            </option>
          ))}
        </select>
      )}
      <input
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('rating.notePh')}
        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="text-[11px] text-gray-500 hover:underline" onClick={() => setOpen(false)}>
          {t('rating.cancel')}
        </button>
        <button
          type="button"
          disabled={!rating || rate.isPending}
          onClick={save}
          className="rounded-md bg-primary-500 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {t('rating.save')}
        </button>
      </div>
    </div>
  );
}
