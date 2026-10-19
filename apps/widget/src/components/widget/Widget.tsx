import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Headset, MessageCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWidgetStore, type TabKey } from '../../store/widgetStore';
import { useEnsureSession } from '../../hooks/useSession';
import { reportPanelOpened } from '../../services/sessionService';
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
import { fill, pickCopy } from '../../lib/copy';
import { WIDGET_COPY_DEFAULTS } from '../../../../../packages/types/src/common/widget-copy';

/** Once dismissed (or the panel opened), the greeting pill stays away for the rest of the tab's session. */
const TEASER_SEEN_KEY = 'ivy:teaser-seen';
function teaserSeen(): boolean {
  try {
    return sessionStorage.getItem(TEASER_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
function markTeaserSeen(): void {
  try {
    sessionStorage.setItem(TEASER_SEEN_KEY, '1');
  } catch {
    /* no storage — the pill simply shows again next page */
  }
}

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
  // `bare` draws the uploaded icon as the whole button (PLN-261019 P2); the
  // normalizer already dropped it when there is no icon to draw.
  const bare = launcher.style === 'bare' && !!customIcon;
  // A host app opens the widget from its own button and owns the whole screen,
  // so there is no floating launcher and nothing to open into.
  const appMode = isAppMode();
  const launcherShown = !panelOpen && !appMode && !triggerHidesLauncher;

  // Greeting pill beside the launcher (PLN-261019 P2): appears after the
  // configured delay, once per tab session; opening the panel or closing the
  // pill counts as seen. The loader widens the closed frame while it shows and
  // narrows it again the moment it goes — a wide invisible frame would swallow
  // clicks on the page (FIX-260916 class).
  const widgetCopy = useWidgetStore((s) => s.widgetCopy);
  const language = useWidgetStore((s) => s.language);
  const setTeaserVisible = useWidgetStore((s) => s.setTeaserVisible);
  const teaserCfg = launcher.teaser?.enabled ? launcher.teaser : null;
  const [teaserDismissed, setTeaserDismissed] = useState(teaserSeen);
  const [teaserReady, setTeaserReady] = useState(false);
  useEffect(() => {
    if (!teaserCfg || teaserDismissed) return;
    const timer = window.setTimeout(() => setTeaserReady(true), teaserCfg.delaySec * 1000);
    return () => window.clearTimeout(timer);
  }, [teaserCfg, teaserDismissed]);
  const dismissTeaser = () => {
    markTeaserSeen();
    setTeaserDismissed(true);
  };
  useEffect(() => {
    if (panelOpen && teaserCfg && !teaserDismissed) dismissTeaser();
    // dismissTeaser is a stable closure over setters; the deps that matter are these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, teaserCfg, teaserDismissed]);
  const teaserVisible = launcherShown && !!teaserCfg && teaserReady && !teaserDismissed;
  useEffect(() => {
    setTeaserVisible(teaserVisible);
  }, [teaserVisible, setTeaserVisible]);
  const teaserText = fill(
    pickCopy(widgetCopy?.launcherTeaser, language) ??
      (WIDGET_COPY_DEFAULTS.launcherTeaser as Record<string, string>)[(language || 'en').toUpperCase()] ??
      WIDGET_COPY_DEFAULTS.launcherTeaser.EN,
    '{shop}',
    widgetCopy?.displayName || t('appName'),
  );

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
      if (panelOpen) {
        analytics.widgetOpen();
        // Same transition, first-party count (PLN-260920). GA4 only fires for
        // tenants who configured it and consented, but "was the widget opened"
        // is an operational number every tenant's console has to be able to
        // show — so it is reported here too, independently.
        const token = useWidgetStore.getState().sessionToken;
        if (token) reportPanelOpened(token);
      } else analytics.widgetClose();
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
      {launcherShown && (
        <div
          className={`fixed bottom-5 z-10 flex items-center gap-2 ${
            launcher.position === 'left' ? 'left-5 flex-row-reverse' : 'right-5'
          }`}
        >
          {teaserVisible && (
            <div
              role="status"
              className="st-teaser relative max-w-[260px] rounded-full bg-primary-500 text-on-primary shadow-lg"
            >
              <button
                type="button"
                onClick={togglePanel}
                className="block px-4 py-2.5 text-left text-sm font-medium leading-snug focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                {teaserText}
              </button>
              <button
                type="button"
                onClick={dismissTeaser}
                aria-label={t('a11y.closeTeaser')}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-gray-500 shadow ring-1 ring-black/10 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <button
            onClick={togglePanel}
            aria-label={t('a11y.openSupport')}
            aria-expanded={false}
            className={`st-launcher relative flex flex-shrink-0 items-center justify-center transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 active:scale-95 ${
              bare
                ? 'rounded-st-md'
                : 'rounded-full bg-primary-500 text-on-primary shadow-lg hover:bg-primary-600'
            } ${sizeClasses.button}`}
          >
            {customIcon ? (
              // An uploaded icon draws as-is (no brand mask): the tenant chose its
              // colours. In `bare` style it IS the button and fills it.
              <img src={customIcon} alt="" className={`${bare ? 'h-full w-full' : sizeClasses.icon} object-contain`} />
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
              // A bare mascot has no circle to hang the badge on, so it sits on
              // the page side — toward the teaser — instead of the window edge.
              <span
                className={`absolute -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white ring-2 ring-white ${
                  bare && launcher.position !== 'left' ? '-left-0.5' : '-right-0.5'
                }`}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        </div>
      )}
    </>
  );
}
