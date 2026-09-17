import { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_OPTIONS, LANG_STORAGE_KEY } from '../../i18n/i18n';
import { useWidgetStore } from '../../store/widgetStore';
import { setSessionLanguage } from '../../services/sessionService';

/**
 * Language picker for the widget header.
 *
 * Three languages fitted as a row of pills; six do not — the panel is 380px on
 * desktop and the row pushed the tenant's display name out of the header. So
 * the current language is shown as one compact button and the rest live in a
 * popover (PLN-260817 §2-1). Languages awaiting native review carry no marker
 * here: telling a shopper their translation is unreviewed costs trust without
 * changing any decision they can make.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const sessionToken = useWidgetStore((s) => s.sessionToken);
  const setLanguage = useWidgetStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = (i18n.language || 'en').split('-')[0];
  const active = LANGUAGE_OPTIONS.find((l) => l.code === current) ?? LANGUAGE_OPTIONS[0];

  // Close on outside click / Esc, the same way the settings popover behaves.
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

  function changeTo(code: string) {
    setOpen(false);
    if (code === current) return;
    void i18n.changeLanguage(code);
    setLanguage(code);
    document.documentElement.lang = code;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, code);
    } catch {
      /* ignore storage failures */
    }
    if (sessionToken) {
      setSessionLanguage(sessionToken, code.toUpperCase()).catch(() => {});
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('a11y.language')}
        // White-on-translucent until PLN-260817 turned the header white, at which
        // point this button vanished into it. Now a neutral control like the gear
        // and close buttons beside it.
        className="flex items-center gap-1 rounded-st-md px-1.5 py-1.5 text-[11px] font-medium text-header-dim hover:bg-header-fg/10 hover:text-header-fg focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        {active.shortLabel}
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-10 mt-1 min-w-[9rem] overflow-hidden rounded-st-md bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          {LANGUAGE_OPTIONS.map((lang) => {
            const selected = lang.code === current;
            return (
              <li key={lang.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => changeTo(lang.code)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${
                    selected ? 'font-semibold text-primary-600' : 'text-gray-700'
                  }`}
                >
                  {lang.nativeLabel}
                  {selected && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
