import { useState } from 'react';
import { Star, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createReview } from '../../services/miscService';

export function ReviewForm({
  sessionToken,
  orderItemId,
  onClose,
}: {
  sessionToken: string | null;
  orderItemId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!sessionToken || rating === 0) return;
    setLoading(true);
    try {
      await createReview(sessionToken, orderItemId, rating, body);
      setDone(true);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-st-md border border-gray-200 bg-white p-4 text-center">
        <CheckCircle2 className="h-6 w-6 text-success" />
        <p className="text-sm font-medium text-gray-800">
          {t('review.thanks')}
        </p>
        <button
          onClick={onClose}
          className="text-xs text-primary-600 hover:underline"
        >
          {t('orders.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-st-md border border-gray-200 bg-white p-3">
      <div className="mb-2 text-sm font-semibold text-gray-800">
        {t('review.title')}
      </div>
      <div className="mb-1 text-xs text-gray-500">{t('review.rating')}</div>
      <div className="mb-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            onMouseEnter={() => setHover(v)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(v)}
            aria-label={t('review.stars', { count: v })}
            className="rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <Star
              className={`h-6 w-6 ${
                v <= (hover || rating)
                  ? 'fill-warning text-warning'
                  : 'text-gray-300'
              }`}
            />
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('review.placeholder')}
        rows={3}
        className="mb-2 w-full resize-none rounded-st-md border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <div className="flex gap-2">
        <button
          disabled={rating === 0 || loading}
          onClick={submit}
          className="flex-1 rounded-st-md bg-primary-500 px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-600 disabled:opacity-50"
        >
          {loading ? t('common.loading') : t('review.submit')}
        </button>
        <button
          onClick={onClose}
          className="rounded-st-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          {t('orders.back')}
        </button>
      </div>
    </div>
  );
}
