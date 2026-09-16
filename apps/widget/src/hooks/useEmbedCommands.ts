import { useEffect } from 'react';
import { useWidgetStore, type TabKey } from '../store/widgetStore';
import {
  ensureSession,
  identify as identifyRequest,
  setSessionLanguage,
} from '../services/sessionService';
import { getParentOrigin, getShopDomain } from './useSession';
import { hostPresent, onHostMessage, postToHost } from '../lib/host-bridge';
import i18n, { LANG_STORAGE_KEY, SUPPORTED_LANGUAGES } from '../i18n/i18n';

const TABS: TabKey[] = ['chat', 'orders', 'notifications'];

type IdentifyUser = { userId: string; hash: string; name?: string; email?: string; phone?: string };

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
          case 'logout': {
            // Clearing the token is not enough: useEnsureSession runs once on
            // mount, so nothing would re-open a session and the widget would sit
            // there unable to send anything. Open the guest session here.
            store.setSessionToken(null);
            store.setAuthenticated(false);
            store.setCustomerName(null);
            const fresh = await ensureSession(
              null,
              useWidgetStore.getState().language,
              getShopDomain(),
              getParentOrigin(),
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
