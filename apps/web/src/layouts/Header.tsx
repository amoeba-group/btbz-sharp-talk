import { useEffect, useRef, useState } from 'react';
import { Globe, PanelLeft } from 'lucide-react';
import { AlarmBell } from '@/domain/alerts/AlarmBell';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '@/store/ui-store';
import {
  LANGUAGE_OPTIONS,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@/i18n/i18n';
import { cn } from '@/lib/cn';

/**
 * Locale picker. Exported for reuse on the public pages (landing / login),
 * which render outside AppLayout but still need it.
 *
 * A row of pills held three languages; six need a dropdown (PLN-260817 §2-2).
 * Languages whose translation is still awaiting native review carry a β so an
 * operator knows why a string might read oddly — unlike the widget, where the
 * shopper can do nothing with that information.
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation('nav');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = SUPPORTED_LANGUAGES.includes(i18n.language)
    ? (i18n.language as SupportedLanguage)
    : 'en';
  const active = LANGUAGE_OPTIONS.find((l) => l.code === current) ?? LANGUAGE_OPTIONS[0];
  const hasUnreviewed = LANGUAGE_OPTIONS.some((l) => !l.reviewed);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const change = (code: SupportedLanguage) => {
    setOpen(false);
    if (code === current) return;
    i18n.changeLanguage(code);
    document.documentElement.lang = code;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
    } catch {
      // ignore storage errors (e.g. private mode)
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language')}
        className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
      >
        <Globe className="h-4 w-4" aria-hidden="true" />
        {active.nativeLabel}
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-30 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {LANGUAGE_OPTIONS.map((lang) => (
            <li key={lang.code}>
              <button
                type="button"
                role="option"
                aria-selected={lang.code === current}
                onClick={() => change(lang.code as SupportedLanguage)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-gray-50',
                  lang.code === current ? 'font-semibold text-primary-600' : 'text-gray-700',
                )}
              >
                <span>{lang.nativeLabel}</span>
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  {!lang.reviewed && <span aria-hidden="true">β</span>}
                  {lang.code === current && <span aria-hidden="true">✓</span>}
                </span>
              </button>
            </li>
          ))}
          {hasUnreviewed && (
            <li className="mt-1 border-t border-gray-100 px-3 pb-0.5 pt-1.5 text-[11px] text-gray-400">
              {t('languageBetaHint')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Slim top bar: sidebar toggle + locale switcher. The signed-in user block
 * (identity / My Page / logout) lives pinned at the bottom of the Sidebar.
 */
export function Header() {
  const { t } = useTranslation('nav');
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <button
        onClick={toggleSidebar}
        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
        aria-label={t('toggleSidebar')}
      >
        <PanelLeft className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-2">
        {/* Alarm center bell (PLN-261024) — renders nothing without Live Chat. */}
        <AlarmBell />
        <LanguageSwitcher />
      </div>
    </header>
  );
}
