import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CsatSurveyAnswers } from '../../services/chatService';
import {
  CSAT_COMMENT_MAX_CHARS,
  CSAT_REASON,
  CSAT_REASON_MAX_RATING,
  CSAT_REASON_VALUES,
} from '../../../../../packages/types/src/common/csat';

/**
 * Satisfaction prompt shown once a conversation ends (PLN-260810 P3), restyled
 * to the Master Shots' emoji card (PLN-260817 W-6, frame 67).
 *
 * Two tenant modes (PLN-261019-Csat-Survey-Disclosure):
 *  - `rating`  — the one-question card every tenant has had: tapping a face
 *                sends it straight away (a misclick can be corrected, D6).
 *  - `survey`  — "was it resolved?" → the same five faces in a segmented box →
 *                for an unhappy rating, a reason (+ free text for "other") →
 *                one [Submit]. Nothing is sent until the button, because the
 *                three answers travel together.
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
  mode = 'rating',
  onRate,
}: {
  conversationId: string;
  mode?: 'rating' | 'survey';
  onRate: (rating: number, survey?: CsatSurveyAnswers) => Promise<void>;
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
  // Survey answers held until [Submit].
  const [resolved, setResolved] = useState<boolean | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      /* not being able to remember is better than not being able to dismiss */
    }
    setDismissed(true);
  };

  const send = async (value: number, survey?: CsatSurveyAnswers) => {
    if (busy || submitted != null) return;
    setBusy(true);
    setFailed(false);
    try {
      await onRate(value, survey);
      setSubmitted(value);
    } catch {
      // Silent failure is banned (dev-kit §4.3): without this the face simply
      // stayed unselected and the shopper had no idea the rating never landed.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const survey = mode === 'survey';
  const askReason = survey && rating != null && rating <= CSAT_REASON_MAX_RATING;
  const canSubmit =
    survey &&
    resolved != null &&
    rating != null &&
    (!askReason || (reason != null && (reason !== CSAT_REASON.OTHER || comment.trim().length > 0)));

  const faces = (
    <div
      className={
        survey
          ? 'flex overflow-hidden rounded-st-md border border-gray-200'
          : 'flex justify-center gap-1'
      }
      role="radiogroup"
      aria-label={survey ? t('chat.csatSurvey.q2') : t('chat.csatQuestion')}
    >
      {FACES.map((face, i) => {
        const value = i + 1;
        const chosen = survey ? rating === value : submitted === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={t(`chat.csatLevel.${value}`)}
            disabled={busy || submitted != null}
            onClick={() => (survey ? setRating(value) : void send(value))}
            className={
              survey
                ? `st-csat-option flex flex-1 items-center justify-center py-2.5 transition-colors ${
                    i > 0 ? 'border-l border-gray-200' : ''
                  } ${chosen ? 'bg-primary-100' : 'bg-white hover:bg-gray-50'} ${
                    submitted != null ? 'cursor-default' : ''
                  }`
                : `st-csat-option flex flex-1 flex-col items-center gap-1 rounded-st-md px-1 py-1.5 transition-all ${
                    submitted == null ? 'hover:bg-gray-50' : 'cursor-default'
                  } ${submitted != null && !chosen ? 'opacity-30' : ''}`
            }
          >
            <span className="text-3xl leading-none">{face}</span>
            {!survey && (
              <span className="break-keep text-[10px] leading-tight text-gray-500">
                {t(`chat.csatLevel.${value}`)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  if (!survey) {
    return (
      <div className="st-csat rounded-st-lg border-2 border-primary-300 bg-white px-3 py-4 text-center">
        <p className="mb-3 text-sm text-gray-700">
          {submitted != null ? t('chat.csatThanks') : t('chat.csatQuestion')}
        </p>
        {faces}
        {failed && <p className="mt-2 text-xs text-error">{t('chat.csatFailed')}</p>}
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

  const radio = (
    name: string,
    value: string,
    checked: boolean,
    onPick: () => void,
    label: string,
  ) => (
    <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={busy || submitted != null}
        onChange={onPick}
        className="h-4 w-4 accent-primary-500"
      />
      {label}
    </label>
  );

  return (
    <div className="st-csat rounded-st-lg border border-gray-200 bg-white text-left shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <span className="text-sm font-semibold text-gray-900">{t('chat.csatSurvey.title')}</span>
        {submitted == null && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('chat.csatDismiss')}
            className="rounded-st-sm p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {submitted != null ? (
        <p className="px-4 py-5 text-center text-sm text-gray-700">{t('chat.csatThanks')}</p>
      ) : (
        <div className="space-y-4 px-4 py-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900">{t('chat.csatSurvey.q1')}</p>
            {radio('csat-resolved', 'yes', resolved === true, () => setResolved(true), t('chat.csatSurvey.q1Resolved'))}
            {radio('csat-resolved', 'no', resolved === false, () => setResolved(false), t('chat.csatSurvey.q1Unresolved'))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900">{t('chat.csatSurvey.q2')}</p>
            {faces}
            {rating != null && (
              <p className="text-xs text-gray-500">{t(`chat.csatLevel.${rating}`)}</p>
            )}
          </div>
          {askReason && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">{t('chat.csatSurvey.reasonTitle')}</p>
              {CSAT_REASON_VALUES.filter((r) => r !== CSAT_REASON.OTHER).map((r) =>
                radio('csat-reason', r, reason === r, () => setReason(r), t(`chat.csatSurvey.reasons.${r}`)),
              )}
              {radio(
                'csat-reason',
                CSAT_REASON.OTHER,
                reason === CSAT_REASON.OTHER,
                () => setReason(CSAT_REASON.OTHER),
                t('chat.csatSurvey.reasons.other'),
              )}
              {reason === CSAT_REASON.OTHER && (
                <div className="relative">
                  <textarea
                    value={comment}
                    maxLength={CSAT_COMMENT_MAX_CHARS}
                    rows={3}
                    disabled={busy}
                    placeholder={t('chat.csatSurvey.otherPlaceholder')}
                    onChange={(e) => setComment(e.target.value)}
                    className="w-full rounded-st-md border border-gray-200 px-3 py-2 pr-12 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-gray-400">
                    {comment.length}/{CSAT_COMMENT_MAX_CHARS}
                  </span>
                </div>
              )}
            </div>
          )}
          {failed && <p className="text-xs text-error">{t('chat.csatFailed')}</p>}
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={() =>
              void send(rating as number, {
                resolved: resolved as boolean,
                ...(askReason && reason ? { reason } : {}),
                ...(askReason && reason === CSAT_REASON.OTHER && comment.trim() ? { comment: comment.trim() } : {}),
              })
            }
            className="st-csat-submit w-full rounded-st-md bg-primary-500 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-40"
          >
            {t('chat.csatSurvey.submit')}
          </button>
        </div>
      )}
    </div>
  );
}
