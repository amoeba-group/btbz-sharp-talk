import { useEffect, useRef } from 'react';
import { Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWidgetStore } from '../../store/widgetStore';
import { isAppMode, postToHost } from '../../lib/host-bridge';
import { resolveLauncher } from '../../lib/launcher';

/**
 * What a hotel that is not on the tenant's pilot list sees when the tenant chose to
 * show a note instead of hiding the widget (PLN-261012 SG-40, wireframe W8). The
 * launcher is still there; opening it shows this — no tabs, no chat, no composer —
 * because the server would refuse every turn anyway.
 *
 * The text is the server's: the tenant's own wording for the session language, else
 * the built-in line. The widget carries no copy of its own for it.
 */
export function PilotNoticePanel({ notice }: { notice: string }) {
  const { t } = useTranslation();
  const setPanelOpen = useWidgetStore((s) => s.setPanelOpen);
  const displayName = useWidgetStore((s) => s.widgetCopy?.displayName);
  const theme = useWidgetStore((s) => s.widgetTheme);
  const triggerUnavailable = useWidgetStore((s) => s.triggerUnavailable);
  const panelRef = useRef<HTMLDivElement>(null);

  // Same geometry rules as the real panel: a host app owns the whole screen, a phone
  // gets the bottom sheet, trigger mode docks under the storefront header.
  const triggerMode = resolveLauncher(theme).mode === 'trigger' && !isAppMode() && !triggerUnavailable;
  const compact = new URLSearchParams(window.location.search).get('compact') === '1';
  const fullBleed = compact || isAppMode();
  const showClose = !triggerMode || compact;

  const dismiss = () => {
    if (isAppMode()) postToHost({ type: 'ivy:close-request' });
    else setPanelOpen(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={panelRef}
      className={[
        'st-panel st-pilot-notice flex flex-col overflow-hidden bg-white shadow-lg focus:outline-none',
        fullBleed
          ? 'fixed inset-x-0 bottom-0 top-0 rounded-none'
          : triggerMode
            ? 'fixed inset-auto top-0 right-5 ivy-panel-desktop'
            : 'fixed inset-auto bottom-5 right-5 ivy-panel-desktop',
      ].join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label={t('a11y.supportWidget')}
      tabIndex={-1}
    >
      <header className="st-header flex items-center justify-between bg-header-bg px-4 pb-2 pt-4">
        <span className="st-header-title truncate text-xl font-bold text-header-fg">
          {displayName || t('notificationCenter')}
        </span>
        {showClose && (
          <button
            onClick={dismiss}
            aria-label={t('a11y.close')}
            className="rounded-st-md p-1.5 text-header-dim hover:bg-header-fg/10 hover:text-header-fg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
        <Info className="h-8 w-8 text-primary-500" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-gray-700" role="status">
          {notice}
        </p>
      </div>
    </div>
  );
}
