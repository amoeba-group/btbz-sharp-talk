import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWidgetStore } from '../../store/widgetStore';
import { getThread } from '../../services/chatService';
import type { ThreadConversation } from '../../lib/types';
import { MessageBubble } from './MessageBubble';

/**
 * The signed-in account's earlier conversations (PLN-261022 stage 2,
 * wireframe 3.4). Shown above today's thread only when the session says it may
 * (`threadAvailable`: a host-verified user of a tenant with continuity on).
 * Pages of three, oldest at the top; loading a page keeps the reader where they
 * were instead of jumping. Everything resets with the session — a logout
 * starts a guest session, which carries no thread.
 */
export function EarlierConversations() {
  const { t, i18n } = useTranslation();
  const sessionToken = useWidgetStore((s) => s.sessionToken);
  const available = useWidgetStore((s) => s.threadAvailable);
  const [pages, setPages] = useState<ThreadConversation[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [colleagueCount, setColleagueCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPages([]);
    setHasMore(true);
    setColleagueCount(0);
    setError(false);
  }, [sessionToken, available]);

  if (!available || !sessionToken) return null;

  const load = async () => {
    if (loading) return;
    setLoading(true);
    setError(false);
    const scroller = anchorRef.current?.closest('[role="log"]') as HTMLElement | null;
    const beforeHeight = scroller?.scrollHeight ?? 0;
    try {
      const oldest = pages[0]?.conversationId ?? null;
      const res = await getThread(sessionToken, oldest);
      // Newest-first from the API; shown oldest-first above what is loaded.
      setPages((cur) => [...[...res.conversations].reverse(), ...cur]);
      setHasMore(res.hasMore);
      if (!pages.length) setColleagueCount(res.colleagueCount);
      // Keep the reader's place: the new content grew the list above them.
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop += scroller.scrollHeight - beforeHeight;
      });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' });
  const exhausted = !hasMore && pages.length === 0;

  return (
    <div ref={anchorRef} className="st-thread space-y-3">
      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="st-thread-load rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? t('chat.threadLoading') : t('chat.threadLoadPrevious')}
          </button>
        </div>
      )}
      {error && <p className="text-center text-[11px] text-red-500">{t('chat.threadLoadError')}</p>}
      {exhausted && <p className="text-center text-[11px] text-gray-400">{t('chat.threadNone')}</p>}
      {colleagueCount > 0 && pages.length > 0 && (
        <p className="st-thread-colleagues text-center text-[11px] text-gray-500">
          {t('chat.threadColleagues', { count: colleagueCount })}
        </p>
      )}
      {pages.map((c) => (
        <section key={c.conversationId} className="space-y-2" aria-label={t('chat.threadDivider', { date: day(c.createdAt) })}>
          <div className="st-thread-divider flex items-center gap-2 text-[11px] text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />
            <span>{t('chat.threadDivider', { date: day(c.createdAt) })}</span>
            <span className="h-px flex-1 bg-gray-200" />
          </div>
          {c.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </section>
      ))}
      {pages.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span className="h-px flex-1 bg-gray-300" />
        </div>
      )}
    </div>
  );
}
