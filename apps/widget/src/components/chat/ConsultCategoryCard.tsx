import { useState } from 'react';
import { Headphones } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Consult-category picker (PLN-261024-Widget-Handoff-Consult-Category-Picker).
 *
 * `before`: the shopper asked for an agent — the pick is sent with the request,
 * so the routing rule for that category decides who is paged.
 * `after`: the AI already handed off and agents were paged; a pick still steers
 * the conversation to that category's team while nobody has accepted it.
 * Skipping is always possible (D7) and connects exactly as before.
 * Inline in the thread like the other cards: the widget iframe has no modals.
 */
export function ConsultCategoryCard({
  mode,
  categories,
  onPick,
  onSkip,
}: {
  mode: 'before' | 'after';
  categories: Array<{ code: string; label: string }>;
  onPick: (code: string) => Promise<void> | void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function pick(code: string) {
    if (busy) return;
    setBusy(true);
    try {
      await onPick(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-st-md border border-gray-200 bg-gray-50 p-3" data-testid="consult-category-card">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <Headphones className="h-4 w-4 shrink-0 text-primary-500" />
        {mode === 'before' ? t('chat.consultCategory.title') : t('chat.consultCategory.titleAfter')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <button
            key={c.code}
            type="button"
            disabled={busy}
            onClick={() => void pick(c.code)}
            className="rounded-full border border-primary-400 bg-white px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-500/10 disabled:opacity-50"
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-2 text-right">
        <button type="button" disabled={busy} onClick={onSkip} className="text-xs text-gray-500 hover:underline disabled:opacity-50">
          {t('chat.consultCategory.skip')} →
        </button>
      </div>
    </div>
  );
}
