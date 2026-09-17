import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Satisfaction prompt shown once a conversation ends (PLN-260810 P3), restyled
 * to the Master Shots' emoji card (PLN-260817 W-6, frame 67).
 *
 * The design shows FOUR faces; this keeps FIVE (PLN §7 D-7). The rating is
 * persisted on a 1–5 scale and `csat_avg` is already being recorded against it,
 * so dropping to four would either leave a hole in the scale or silently change
 * what every historical average means. The emoji treatment is the part that was
 * asked for; the scale behind it is data.
 *
 * Dismissal is a first-class outcome, not a failure: skipping removes the card
 * and remembers that decision per conversation, so a shopper who does not want
 * to rate is not asked again every time they reopen the widget.
 */
const FACES = ['😞', '😕', '😐', '😊', '😍'];

export function CsatCard({
  conversationId,
  onRate,
}: {
  conversationId: string;
  onRate: (rating: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const storageKey = `ivy.csat.dismissed.${conversationId}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      // Private mode / blocked storage: showing the card is the safe default.
      return false;
    }
  });
  const [submitted, setSubmitted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      /* not being able to remember is better than not being able to dismiss */
    }
    setDismissed(true);
  };

  const submit = async (rating: number) => {
    if (busy || submitted != null) return;
    setBusy(true);
    setFailed(false);
    try {
      await onRate(rating);
      setSubmitted(rating);
    } catch {
      // Silent failure is banned (dev-kit §4.3): without this the face simply
      // stayed unselected and the shopper had no idea the rating never landed.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-st-lg border-2 border-primary-300 bg-white px-3 py-4 text-center">
      <p className="mb-3 text-sm text-gray-700">
        {submitted != null ? t('chat.csatThanks') : t('chat.csatQuestion')}
      </p>
      <div
        className="flex justify-center gap-1"
        role="radiogroup"
        aria-label={t('chat.csatQuestion')}
      >
        {FACES.map((face, i) => {
          const rating = i + 1;
          const chosen = submitted === rating;
          return (
            <button
              key={rating}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={t(`chat.csatLevel.${rating}`)}
              disabled={busy || submitted != null}
              onClick={() => void submit(rating)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-st-md px-1 py-1.5 transition-all ${
                submitted == null ? 'hover:bg-gray-50' : 'cursor-default'
              } ${submitted != null && !chosen ? 'opacity-30' : ''}`}
            >
              <span className="text-3xl leading-none">{face}</span>
              <span className="break-keep text-[10px] leading-tight text-gray-500">
                {t(`chat.csatLevel.${rating}`)}
              </span>
            </button>
          );
        })}
      </div>
      {failed && (
        <p className="mt-2 text-xs text-error">{t('chat.csatFailed')}</p>
      )}
      {submitted == null && (
        <button
          type="button"
          onClick={dismiss}
          className="mt-3 text-xs text-gray-400 underline-offset-2 hover:underline"
        >
          {t('chat.csatDismiss')}
        </button>
      )}
    </div>
  );
}
