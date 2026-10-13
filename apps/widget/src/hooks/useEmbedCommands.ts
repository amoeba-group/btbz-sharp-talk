import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWidgetStore, type TabKey } from '../store/widgetStore';
import {
  ensureSession,
  identify as identifyRequest,
  logoutSession,
  setSessionLanguage,
  type IdentifyUser,
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
import {
  adoptForkedSession,
  isForkedSession,
  resetToGuest,
  type SessionSwapPorts,
} from '../lib/session-swap';
import { identityExpiry } from '../lib/identity-expiry';
import i18n, { LANG_STORAGE_KEY, SUPPORTED_LANGUAGES } from '../i18n/i18n';

const TABS: TabKey[] = ['chat', 'orders', 'notifications'];

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
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!hostPresent()) return; // standalone — no host to take commands from

    // A native host sends identify/locale the moment `ivy:ready` fires, which
    // routinely beats the session ensure round-trip. Both used to be silently
    // dropped when no token existed yet (found on-device, FIX-260828) — so the
    // last of each is parked here and replayed as soon as the token lands.
    let pendingIdentify: IdentifyUser | null = null;
    let pendingSessionLocale: string | null = null;

    // How the widget lets go of one session and takes up another (PLN-261012
    // SG-02). The order of the steps is in lib/session-swap.ts; this only wires
    // it to the real store, cache and API.
    const swap: SessionSwapPorts = {
      clearCache: () => queryClient.clear(),
      detach: () => {
        // No session, nothing to lapse: stop the timer and forget what was reported.
        identityExpiry.cancel();
        const s = useWidgetStore.getState();
        s.setSessionToken(null);
        s.setAuthenticated(false);
        s.setCustomerName(null);
        s.resetSessionScopedState();
      },
      adopt: (res, opts) => {
        const s = useWidgetStore.getState();
        s.setAuthenticated(!!res.authenticated);
        s.setCustomerName(res.customerName ?? null);
        // The consent the server decided: carried when the same person switched
        // hotel or role, pending for a different person — whom the notice is shown
        // to again instead of replaying the previous person's stored yes (the swap
        // module passes `replayConsent: false` for exactly those cases).
        adoptSessionConsent(res, { replay: opts?.replayConsent });
        identityExpiry.observe(res);
        // Token last: it re-keys the panels, which must find the rest in place.
        s.setSessionToken(res.sessionToken);
      },
      // The same inputs the first ensure sends. Leaving out the agent code, the
      // page and the access key meant a guest session opened after logout was
      // pinned to the default agent and could be refused on a restricted widget.
      startGuest: () =>
        ensureSession(
          null,
          useWidgetStore.getState().language,
          getShopDomain(),
          getParentOrigin(),
          getAgentCode(),
          getLandingPath(),
          getAccessKey(),
        ),
      endBinding: (token) => logoutSession(token),
    };

    async function runIdentify(token: string, user: IdentifyUser) {
      try {
        const res = await identifyRequest(token, user);
        // The widget moved to another session while this was in flight (the host
        // logged out, or identified someone else): the answer belongs to a
        // session nobody is looking at.
        if (useWidgetStore.getState().sessionToken !== token) return;
        if (isForkedSession(token, res)) {
          // A different person or hotel than the one this session was bound to:
          // the API opened a new session for them. Adopt it and start the panels
          // over — the old thread stays with the old identity.
          adoptForkedSession(res, swap);
        } else {
          const store = useWidgetStore.getState();
          store.setAuthenticated(res.authenticated);
          // Asked once per token elsewhere (useSessionProfile); the answer
          // already carries it, and it must follow the identity.
          store.setCustomerName(res.customerName ?? null);
          // The host just signed: re-arm the lapse timer for the new signature.
          identityExpiry.observe(res);
          // The menu is audience-filtered server-side (PLN-261001 V4): a
          // signed-in partner gets the business chips, not the sign-in ones. The
          // list was fetched once for a guest, so ask again now.
          void queryClient.invalidateQueries({ queryKey: ['scenario', token] });
        }
        postToHost({ type: 'ivy:event', event: 'identified', ok: true });
      } catch {
        postToHost({ type: 'ivy:event', event: 'identified', ok: false });
        // A rejected signature on a GUEST session leaves the visitor a guest:
        // they can still ask a question, which is the part that must never
        // depend on identity. On a session that is already signed in it is the
        // opposite — the host has moved on to someone this session was never
        // bound to (or to nobody) while the widget keeps showing the previous
        // person's thread. Fail closed: start over as a guest.
        const now = useWidgetStore.getState();
        if (now.sessionToken === token && now.authenticated) await resetToGuest(token, swap);
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
            // An identify still waiting for a token must not outlive the logout
            // that came after it — it would sign the visitor back in.
            pendingIdentify = null;
            // The server binding ends too, not only the local token (PLN-261012
            // SG-02): the session would otherwise keep its claims and open
            // conversation. The widget side is reset synchronously inside
            // resetToGuest, so an identify that follows straight away finds no
            // token and is parked until the fresh guest session exists. Tenant
            // config (theme, tabs, copy) does not change on logout and is
            // deliberately not re-applied.
            await resetToGuest(useWidgetStore.getState().sessionToken, swap);
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
    // queryClient is stable for the app's lifetime; the host subscription must
    // be installed exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
