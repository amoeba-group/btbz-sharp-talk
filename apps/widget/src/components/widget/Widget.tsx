import { useEffect, useRef } from 'react';
import { CircleHelp, Headset, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWidgetStore, type TabKey } from '../../store/widgetStore';
import { useEnsureSession } from '../../hooks/useSession';
import { useEmbedIdentity } from '../../hooks/useEmbedIdentity';
import { useEmbedCommands } from '../../hooks/useEmbedCommands';
import { useLauncherReport } from '../../hooks/useLauncherReport';
import { useSessionProfile } from '../../hooks/useSessionProfile';
import { useUnreadCount } from '../../hooks/useNotifications';
import { usePurchaseSignal } from '../../hooks/usePurchaseSignal';
import { useAnalytics } from '../../lib/analytics';
import { WidgetPanel } from './WidgetPanel';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { LAUNCHER_CLASSES, resolveLauncher } from '../../lib/launcher';
import { assetUrl, logoUrl } from '../../lib/branding';
import { hostKind, isAppMode, postToHost } from '../../lib/host-bridge';

export function Widget() {
  const { t } = useTranslation();
  useEnsureSession();
  useEmbedIdentity();
  // Host-application commands: ShopTalk.open()/identify()/… (PLN-260819 S3).
  useEmbedCommands();
  // Report launcher geometry to the loader, which owns the iframe box (S4).
  useLauncherReport();
  useSessionProfile();
  usePurchaseSignal();
  const analytics = useAnalytics();
  const panelOpen = useWidgetStore((s) => s.panelOpen);
  const togglePanel = useWidgetStore((s) => s.togglePanel);
  const sessionToken = useWidgetStore((s) => s.sessionToken);
  const authenticated = useWidgetStore((s) => s.authenticated);
  const { data } = useUnreadCount(sessionToken, authenticated);
  const unread = data?.count ?? 0;
  const prevOpen = useRef(panelOpen);
  const theme = useWidgetStore((s) => s.widgetTheme);
  const launcher = resolveLauncher(theme);
  // Trigger mode only hides the button when the storefront actually has an opener;
  // the loader tells us when it does not (FIX-260916).
  const triggerUnavailable = useWidgetStore((s) => s.triggerUnavailable);
  const triggerHidesLauncher = launcher.mode === 'trigger' && !triggerUnavailable;
  const sizeClasses = LAUNCHER_CLASSES[launcher.size] ?? LAUNCHER_CLASSES.md;
  const brandMark = theme?.logo ? logoUrl(theme.logo) : null;
  const customIcon = theme?.design?.launcherIcon ? assetUrl(theme.design.launcherIcon) : null;
  // A host app opens the widget from its own button and owns the whole screen,
  // so there is no floating launcher and nothing to open into.
  const appMode = isAppMode();

  // Returning from a redirect-mode sign-in: the loader consumed its one-shot
  // flag and passed ?reopen=<tab>, so bring the widget straight back up where
  // the shopper left off instead of making them find it again.
  //
  // Which tab that is depends on the tenant's configuration, and the
  // configuration arrives from session/ensure AFTER first paint. Reading it on
  // mount resolved `?reopen=orders` against the seeded default — which has no
  // orders tab — so the shopper landed on Notifications even at tenants that
  // show one. The intent is captured once and resolved when the layout lands.
  const visibleTabs = useWidgetStore((s) => s.visibleTabs);
  const tabsResolved = useWidgetStore((s) => s.tabsResolved);
  const reopenIntent = useRef<string | null>(
    new URLSearchParams(window.location.search).get('reopen'),
  );
  // Once the shopper closes the panel, a late-arriving layout must not haul it
  // back open — the effect below re-runs on every layout change until spent.
  //
  // This must key off an actual open→closed TRANSITION. Testing `!panelOpen`
  // alone marked the widget dismissed on mount, because a widget starts closed
  // — which killed `?reopen=` entirely, the very flow it was meant to protect.
  const dismissed = useRef(false);
  const wasOpen = useRef(panelOpen);
  useEffect(() => {
    if (wasOpen.current && !panelOpen && reopenIntent.current) dismissed.current = true;
    wasOpen.current = panelOpen;
  }, [panelOpen]);

  useEffect(() => {
    const reopen = reopenIntent.current;
    if (!reopen || dismissed.current) return;
    const store = useWidgetStore.getState();

    // `reopen=orders` is baked into return URLs storefronts already handed out.
    // Every branch checks visibility first: selecting a tab this tenant hides
    // leaves the panel opening onto nothing, and `setTabLayout`'s own fallback
    // has already run by this point so nothing would correct it.
    const target: TabKey | null =
      reopen === 'orders'
        ? visibleTabs.includes('orders')
          ? 'orders'
          : visibleTabs.includes('notifications')
            ? 'notifications'
            : null
        : reopen === 'chat' || reopen === 'notifications'
          ? visibleTabs.includes(reopen as TabKey)
            ? (reopen as TabKey)
            : null
          : null;
    if (target) {
      store.setActiveTab(target);
      // Orders live under Shipping when there is no orders tab to land on.
      if (reopen === 'orders') store.setNotificationFilter('shipping');
    } else if (reopen !== 'orders' && reopen !== 'chat' && reopen !== 'notifications') {
      return; // not a tab we know — leave the widget alone entirely
    }
    store.setPanelOpen(true);
    // Only now is the intent spent. Consuming it on the first pass would freeze
    // the guess made against the seeded default: `?reopen=orders` would land on
    // Notifications and never be corrected when the tenant's real layout — which
    // does have an orders tab — arrived a moment later.
    if (tabsResolved) reopenIntent.current = null;
  }, [visibleTabs, tabsResolved, panelOpen]);

  // When embedded in a storefront iframe, tell the embed.js loader to grow/shrink
  // the frame as the panel opens/closes. targetOrigin '*' is safe here — the payload
  // is a non-sensitive open flag and the loader validates the message origin.
  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'ivy:resize', open: panelOpen }, '*');
    }
    // Engagement funnel: fire open/close only on an actual transition.
    if (panelOpen !== prevOpen.current) {
      if (panelOpen) analytics.widgetOpen();
      else analytics.widgetClose();
      prevOpen.current = panelOpen;
    }
  }, [panelOpen, analytics]);

  // Unread count for a storefront-side badge (trigger mode, PLN-260916 P2). The
  // loader writes it into `[data-sharptalk-badge]`; harmless when nothing listens.
  useEffect(() => {
    if (hostKind() !== 'frame') return;
    postToHost({ type: 'ivy:unread', count: unread });
  }, [unread]);

  return (
    <>
      {/* The launcher lives OUTSIDE this boundary on purpose: whatever happens to
          the panel, the shopper keeps a way to close and reopen the widget. */}
      {panelOpen && (
        <ErrorBoundary label="panel">
          <WidgetPanel />
        </ErrorBoundary>
      )}

      {/* Floating launcher — closed state only. While the panel is open the
          bottom-right X would duplicate the panel header's close button (and
          sit right under it on mobile), so closing is the header X / Esc. */}
      {!panelOpen && !appMode && !triggerHidesLauncher && (
        <button
          onClick={togglePanel}
          aria-label={t('a11y.openSupport')}
          aria-expanded={false}
          className={`st-launcher fixed bottom-5 z-10 flex items-center justify-center rounded-full bg-primary-500 text-on-primary shadow-lg transition-transform hover:scale-105 hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 active:scale-95 ${
            launcher.position === 'left' ? 'left-5' : 'right-5'
          } ${sizeClasses.button}`}
        >
          {customIcon ? (
            // An uploaded icon draws as-is (no brand mask): the tenant chose its colours.
            <img src={customIcon} alt="" className={`${sizeClasses.icon} object-contain`} />
          ) : launcher.icon === 'logo' && brandMark ? (
            // Cropped to a circle: an uploaded logo is rarely square, and letting
            // it letterbox inside the button looks like a rendering bug.
            <img src={brandMark} alt="" className={`${sizeClasses.button} rounded-full object-cover`} />
          ) : launcher.icon === 'question' ? (
            <CircleHelp className={sizeClasses.icon} />
          ) : launcher.icon === 'headset' ? (
            <Headset className={sizeClasses.icon} />
          ) : (
            <MessageCircle className={sizeClasses.icon} />
          )}
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white ring-2 ring-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}
    </>
  );
}
