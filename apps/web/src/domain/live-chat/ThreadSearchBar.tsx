import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import { useMessageSearch } from './live-chat.hooks';
import { SearchHighlight } from './SearchHighlight';

interface Props {
  conversationId: string;
  /** Term carried over from the list's content search, if the room was opened from it. */
  initialTerm?: string;
  onClose: () => void;
  /** Every matching message id, and the one to show now (the page scrolls to it). */
  onChange: (state: { ids: string[]; active: string | null }) => void;
}

/**
 * Find in the open conversation (PLN-261023 S1). The server finds the matches —
 * also in messages the transcript has not loaded yet — and the page pages back
 * to the active one. Starts at the newest match; ↑ / Enter walks older.
 */
export function ThreadSearchBar({ conversationId, initialTerm = '', onClose, onChange }: Props) {
  const { t } = useTranslation('livechat');
  const [value, setValue] = useState(initialTerm);
  const [term, setTerm] = useState(initialTerm);
  const [index, setIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(value), 300);
    return () => clearTimeout(timer);
  }, [value]);

  const { data, isFetching, isError } = useMessageSearch(conversationId, term);
  const hits = term.trim().length >= 2 ? (data?.items ?? []) : [];
  // A new result set starts at the newest match.
  useEffect(() => setIndex(hits.length - 1), [data, term]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = index >= 0 && index < hits.length ? hits[index] : null;
  useEffect(() => {
    onChange({ ids: hits.map((h) => h.id), active: active?.id ?? null });
  }, [active?.id, hits.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const older = () => hits.length && setIndex((i) => (i <= 0 ? hits.length - 1 : i - 1));
  const newer = () => hits.length && setIndex((i) => (i >= hits.length - 1 ? 0 : i + 1));
  const total = data?.total ?? 0;

  return (
    <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) newer();
                else older();
              }
            }}
            placeholder={t('search.inRoomPlaceholder')}
            aria-label={t('search.inRoomPlaceholder')}
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-xs text-gray-700 outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400"
          />
        </div>
        <span className="w-20 shrink-0 text-center text-[11px] text-gray-500" aria-live="polite">
          {isFetching ? (
            <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
          ) : term.trim().length < 2 ? (
            t('search.minChars')
          ) : hits.length === 0 ? (
            t('search.noHits')
          ) : (
            t('search.position', { n: index + 1, total: hits.length < total ? `${hits.length}+` : total })
          )}
        </span>
        <button
          type="button"
          onClick={older}
          disabled={!hits.length}
          title={t('search.older')}
          aria-label={t('search.older')}
          className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-40"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={newer}
          disabled={!hits.length}
          title={t('search.newer')}
          aria-label={t('search.newer')}
          className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-40"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t('search.close')}
          aria-label={t('search.close')}
          className="rounded p-1 text-gray-500 hover:bg-gray-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {active && (
        <p className="mt-1 truncate text-[11px] text-gray-500">
          <SearchHighlight text={active.snippet} term={term} />
        </p>
      )}
      {isError && <p className="mt-1 text-[11px] text-error">{t('search.failed')}</p>}
    </div>
  );
}
