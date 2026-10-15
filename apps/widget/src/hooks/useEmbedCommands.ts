import { useEffect } from 'react';
import { useWidgetStore, type TabKey } from '../store/widgetStore';
import {
  ensureSession,
  identify as identifyRequest,
  setSessionLanguage,
} from '../services/sessionService';
import {
  adoptSessionConsent,
  getAccessKey,
  getAgentCode,
  getLandingPath,
  getParentOrigin,
  getShopDomain,
} from './useSession';
import { hostPresent, onHostMessage, postToHost } from '../lib/host-bridge';
import { parseHostContext } from '../lib/host-context';
import { normalizeMobileAppConfig } from '../../../../packages/types/src/common/mobile-app-config';
import i18n, { LANG_STORAGE_KEY, SUPPORTED_LANGUAGES } from '../i18n/i18n';

const TABS: TabKey[] = ['chat', 'orders', 'notifications'];

type IdentifyUser = {
  userId: string;
  hash: string;
  name?: string;
  email?: string;
  phone?: string;
  attributes?: Record<string, string>;
};

/**
 * Host-application commands (PLN-260819 S3).
 *
 * The public `ShopTalk.open()/identify()/…` methods live in the loader, which
 * cannot reach into the widget's state — it forwards them here as postMessage.
 * This hook is the receiving half.
 *
 * Trust rules are the same as the identity handshake: only our embedder frame,
 * only over a secure origin. `identify` carries a hash the API verifies against
 * the tenant secret, so a hostile page can send one but cannot make it verify.
 */
export function useEmbedCommands(): void {
  useEffect(() => {
    if (!hostPresent()) return; // standalone — no host to take commands from

    // A native host sends identify/locale the moment `ivy:ready` fires, which
    // routinely beats the session ensure round-trip. Both used to be silently
    // dropped when no token existed yet (found on-device, FIX-260828) — so the
    // last of each is parked here and replayed as soon as the token lands.
    let pendingIdentify: IdentifyUser | null = null;
    let pendingSessionLocale: string | null = null;

    async function runIdentify(token: string, user: IdentifyUser) {
      const store = useWidgetStore.getState();
      try {
        const res = await identifyRequest(token, user);
        store.setAuthenticated(res.authenticated);
        // A tenant whose host terms cover AI support records a signed user as
        // consented on identify (PLN-261015 D9) — drop the banner right away.
        if (res.consentState === 'granted') adoptSessionConsent(res);
        postToHost({ type: 'ivy:event', event: 'identified', ok: true });
      } catch {
        // A rejected signature leaves the visitor a guest: they can still ask
        // a question, which is the part that must never depend on identity.
        postToHost({ type: 'ivy:event', event: 'identified', ok: false });
      }
    }

    const stopTokenWatch = useWidgetStore.subscribe((state, prev) => {
      const token = state.sessionToken;
      if (!token || token === prev.sessionToken) return;
      if (pendingSessionLocale) {
        setSessionLanguage(token, pendingSessionLocale.toUpperCase()).catch(() => {});
        pendingSessionLocale = null;
      }
      if (pendingIdentify) {
        const user = pendingIdentify;
        pendingIdentify = null;
        void runIdentify(token, user);
      }
    });

    async function onMessage(raw: Record<string, unknown>) {
      const d = raw as {
        type?: string;
        action?: string;
        tab?: string | null;
        locale?: string;
        user?: IdentifyUser;
        context?: unknown;
      };
      const store = useWidgetStore.getState();

      if (d.type === 'ivy:command') {
        switch (d.action) {
          case 'open':
            if (d.tab && TABS.includes(d.tab as TabKey)) store.setActiveTab(d.tab as TabKey);
            store.setPanelOpen(true);
            return;
          case 'close':
            store.setPanelOpen(false);
            return;
          case 'toggle':
            store.setPanelOpen(!store.panelOpen);
            return;
          case 'trigger-missing':
            // The storefront has no element to open the widget with, so draw the
            // floating launcher even though the tenant chose trigger mode.
            store.setTriggerUnavailable(true);
            return;
          case 'locale': {
            // Full language switch, exactly what the in-widget switcher does —
            // setLanguage alone changed the AI reply language but left the UI
            // in the auto-detected one (found on-device, FIX-260828). The host's
            // choice is persisted like a manual pick so the session-ensure sync
            // does not immediately override it with the server-side language.
            const code = (d.locale || '').toLowerCase();
            if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(code)) return;
            void i18n.changeLanguage(code);
            store.setLanguage(code);
            document.documentElement.lang = code;
            try {
              localStorage.setItem(LANG_STORAGE_KEY, code);
            } catch {
              /* ignore storage failures */
            }
            const token = useWidgetStore.getState().sessionToken;
            if (token) setSessionLanguage(token, code.toUpperCase()).catch(() => {});
            else pendingSessionLocale = code;
            return;
          }
          case 'settings':
            // The host's ⋮ menu → "Privacy": same panel as the header gear.
            store.setSettingsOpen(!store.settingsOpen);
            return;
          case 'end':
            // The host's ⋮ menu → "End conversation": same confirm as the in-thread link.
            store.setActiveTab('chat');
            store.setSettingsOpen(false);
            store.requestEnd();
            return;
          case 'back': {
            // Android back: close the preferences panel first, and say whether
            // that was all — otherwise the host closes the screen.
            const handled = store.settingsOpen;
            if (handled) store.setSettingsOpen(false);
            postToHost({ type: 'ivy:event', event: 'back', handled });
            return;
          }
          case 'app-config': {
            // The console's phone preview pushes the UNSAVED app settings so the
            // admin sees them live. Honoured only when the page was opened as a
            // preview (?appPreview=1) — a real app never takes its look from a
            // message, only from what the tenant saved.
            if (new URLSearchParams(window.location.search).get('appPreview') !== '1') return;
            store.setAppConfig(normalizeMobileAppConfig((d as { config?: unknown }).config ?? null));
            return;
          }
          case 'context': {
            // `context: null` removes the chip. Text is bounded; the server
            // treats it as background, never as a source of facts.
            const ctx = parseHostContext(d.context);
            store.setHostContext(ctx);
            if (ctx) store.setActiveTab('chat');
            return;
          }
          case 'logout': {
            // Clearing the token is not enough: useEnsureSession runs once on
            // mount, so nothing would re-open a session and the widget would sit
            // there unable to send anything. Open the guest session here.
            store.setSessionToken(null);
            store.setAuthenticated(false);
            store.setCustomerName(null);
            store.setHostContext(null);
            const fresh = await ensureSession(
              null,
              useWidgetStore.getState().language,
              getShopDomain(),
              getParentOrigin(),
              // The same inputs the first ensure sends. Without the agent code
              // the guest session opened after logout was pinned to the default
              // agent instead of the one the app chose (PLN-261015).
              getAgentCode(),
              getLandingPath(),
              getAccessKey(),
            ).catch(() => null);
            // Tenant config (theme, tabs, copy) does not change on logout, so it
            // is deliberately not re-applied — only the identity is reset.
            if (fresh?.sessionToken) store.setSessionToken(fresh.sessionToken);
            return;
          }
          default:
            return;
        }
      }

      if (d.type === 'ivy:identify' && d.user?.userId && d.user?.hash) {
        const token = useWidgetStore.getState().sessionToken;
        // identify binds an EXISTING session. Before one exists the request is
        // parked, not dropped — the token watcher above replays it.
        if (!token) {
          pendingIdentify = d.user;
          return;
        }
        await runIdentify(token, d.user);
      }
    }

    const stopMessages = onHostMessage((message) => {
      void onMessage(message);
    });
    return () => {
      stopMessages();
      stopTokenWatch();
    };
  }, []);
}
