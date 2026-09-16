import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Settings, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWidgetStore, type TabKey } from '../../store/widgetStore';
import { isAppMode, postToHost } from '../../lib/host-bridge';
import { logoUrl } from '../../lib/branding';
import { resolveLauncher } from '../../lib/launcher';
import { LanguageSwitcher } from './LanguageSwitcher';
import { TopTabs } from './TopTabs';
import { BottomTabs } from './BottomTabs';
import { ChatTab } from '../chat/ChatTab';
import { NotificationsTab } from '../notifications/NotificationsTab';
import { OrdersTab } from '../orders/OrdersTab';
import { PreferencesPanel } from '../settings/PreferencesPanel';
import { ErrorBoundary } from '../ui/ErrorBoundary';

/**
 * What each tab key renders. `visibleTabs` comes from the server, so a key this
 * build does not know about is reachable — it must draw nothing rather than
 * calling `undefined`.
 */
const PANELS: Partial<Record<TabKey, () => ReactElement>> = {
  notifications: () => <NotificationsTab />,
  orders: () => <OrdersTab />,
  chat: () => <ChatTab />,
};

export function WidgetPanel() {
  const { t } = useTranslation();
  const activeTab = useWidgetStore((s) => s.activeTab);
  const setPanelOpen = useWidgetStore((s) => s.setPanelOpen);
  /**
   * In a host app the widget IS the screen: closing the panel would leave the
   * WebView showing nothing. Ask the host to dismiss it instead (PLN-260820).
   */
  const dismiss = () => {
    if (isAppMode()) postToHost({ type: 'ivy:close-request' });
    else setPanelOpen(false);
  };
  // Store-held so other surfaces (e.g. the consent banner's "privacy choices"
  // link) can open the settings/preferences area too.
  const showSettings = useWidgetStore((s) => s.settingsOpen);
  const setShowSettings = useWidgetStore((s) => s.setSettingsOpen);
  const displayName = useWidgetStore((s) => s.widgetCopy?.displayName);
  const customerName = useWidgetStore((s) => s.customerName);
  const theme = useWidgetStore((s) => s.widgetTheme);
  // Trigger mode (PLN-260916 P2): the storefront's own header element opens the
  // panel, which docks under that header. The design drops the language pill
  // and the X from the header; the loader closes on outside click / Esc, and on
  // a phone (loader adds ?compact=1) the X stays because there is no "outside".
  const triggerUnavailable = useWidgetStore((s) => s.triggerUnavailable);
  const triggerMode = resolveLauncher(theme).mode === 'trigger' && !isAppMode() && !triggerUnavailable;
  const compact = new URLSearchParams(window.location.search).get('compact') === '1';
  const showClose = !triggerMode || compact;
  // A greeting names the customer, so it wins over the brand mark: the shopper
  // being addressed matters more than the logo at that moment.
  const logo = theme?.logo && !customerName ? logoUrl(theme.logo) : null;
  const visibleTabs = useWidgetStore((s) => s.visibleTabs);
  const tabPosition = useWidgetStore((s) => s.tabPosition);
  const panelRef = useRef<HTMLDivElement>(null);

  // Tabs the shopper has opened at least once — mounted from then on.
  const [visited, setVisited] = useState<TabKey[]>([activeTab]);
  useEffect(() => {
    setVisited((v) => (v.includes(activeTab) ? v : [...v, activeTab]));
  }, [activeTab]);

  // Esc closes the panel; focus the panel on open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setPanelOpen]);

  // Mounted = visited AND still configured on. Dropping a tab the tenant
  // switched off matters beyond tidiness: a hidden panel keeps polling.
  const mounted = visibleTabs.filter((key) => visited.includes(key));

  return (
    <div
      ref={panelRef}
      className={[
        // st-* classes are the stable hooks tenant custom CSS may target (P5).
        'st-panel flex flex-col overflow-hidden bg-white shadow-lg focus:outline-none',
        // mobile: full-width bottom sheet; desktop: floating card
        'fixed inset-x-0 bottom-0 top-0 rounded-none',
        // In app mode the host app owns the whole screen, so the panel always
        // fills it — the sm: floating card left a landscape phone showing the
        // chat pinned to the right half of a blank page (found on-device,
        // FIX-260828).
        ...(isAppMode()
          ? []
          // Size and corners come from the design tokens (ivy-panel-desktop in
          // index.css) so a tenant's panel size reaches the panel and the loader alike.
          : triggerMode
            ? ['sm:inset-auto sm:top-0 sm:right-5 sm:bottom-auto ivy-panel-desktop']
            : ['sm:inset-auto sm:bottom-24 sm:right-5 sm:top-auto ivy-panel-desktop']),
      ].join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label={t('a11y.supportWidget')}
      tabIndex={-1}
    >
      {/* Header — white with a bold title (PLN-260817 W-1), not the coloured bar
          it used to be. The title is still the tenant's display name, never a
          fixed brand string. The language switcher and close button are absent
          from the design but kept deliberately (PLN §7 D-2): without the X, a
          shopper on a touch device has no way to dismiss the panel but Esc. */}
      <header className="st-header flex items-center justify-between bg-header-bg px-4 pb-2 pt-4">
        {/* Greet the shopper by name once they are known (frame 34, "Hi, Lisa");
            before that the tenant's own name identifies whose widget this is
            (frames 48/49). The two design variants are the two sign-in states,
            not a contradiction. `truncate` keeps a long name from pushing the
            three controls on the right off the header. */}
        {logo ? (
          // The name still exists for screen readers; a logo replaces the text
          // only visually. Height-capped so a tall upload cannot push the header
          // out of shape.
          <img
            src={logo}
            alt={displayName || t('notificationCenter')}
            className="max-h-8 max-w-[60%] object-contain"
          />
        ) : (
        <span className="st-header-title truncate text-xl font-bold text-header-fg">
          {customerName
            ? t('header.greeting', { name: customerName })
            : displayName || t('notificationCenter')}
        </span>
        )}
        <div className="flex flex-shrink-0 items-center gap-0.5">
          {!triggerMode && <LanguageSwitcher />}
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-label={t('settings')}
            className={`rounded-lg p-1.5 text-header-dim hover:bg-header-fg/10 hover:text-header-fg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
              showSettings ? 'bg-header-fg/10 text-header-fg' : ''
            }`}
          >
            <Settings className="h-5 w-5" />
          </button>
          {showClose && (
            <button
              onClick={dismiss}
              aria-label={t('a11y.close')}
              className="rounded-lg p-1.5 text-header-dim hover:bg-header-fg/10 hover:text-header-fg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </header>

      {/* Tab bar position is a tenant setting (PLN-260817-Widget-Tab-Config). */}
      {!showSettings && tabPosition === 'top' && <TopTabs />}

      {/* Body — visited tabs stay mounted and are hidden, never unmounted.
          ChatTab holds the thread (and its follow-up chips, escalation prompt and
          inline cards) in component state, so swapping tabs used to destroy it:
          coming back showed an empty conversation with nothing to act on.
          Mounting lazily keeps the cost of an unvisited tab at zero. */}
      <div className="min-h-0 flex-1">
        <div className={showSettings ? 'hidden' : 'h-full'}>
          {mounted.map((key) => (
            <div
              key={key}
              role="tabpanel"
              id={`ivy-tabpanel-${key}`}
              aria-labelledby={`ivy-tab-${key}`}
              className={activeTab === key ? 'h-full' : 'hidden'}
            >
              {/* One boundary per tab: a crash here must not cost the shopper
                  the other tabs, and re-entering the tab retries it. */}
              <ErrorBoundary label={key} resetKey={activeTab}>
                {PANELS[key]?.()}
              </ErrorBoundary>
            </div>
          ))}
        </div>
        {showSettings && (
          <ErrorBoundary label="settings">
            <PreferencesPanel onBack={() => setShowSettings(false)} />
          </ErrorBoundary>
        )}
      </div>

      {!showSettings && tabPosition === 'bottom' && <BottomTabs />}
    </div>
  );
}
