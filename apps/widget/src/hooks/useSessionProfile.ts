import { useEffect, useRef } from 'react';
import { useWidgetStore } from '../store/widgetStore';
import { ensureSession } from '../services/sessionService';
import { adoptSessionConsent, adoptTenantConfig } from './useSession';

/**
 * Pulls the signed-in shopper's display name once a session becomes
 * authenticated, so the widget can greet them by name.
 *
 * Both ways a session gets bound to a customer land here, without either call
 * site needing to know about profiles: the storefront sign-in path (app-proxy
 * identity → token adopted via postMessage) and the guest order lookup. Neither
 * returns profile fields, so we re-`ensure` with the now-authenticated token —
 * that resumes the *same* session and returns its `customerName`.
 *
 * For a storefront-signed-in widget this is the ONLY /session/ensure it makes,
 * so it also carries the tenant configuration (tabs, theme, copy, login mode) —
 * see adoptTenantConfig. It therefore runs once per token even when the name is
 * already known: the name is a nicety, the tab layout is not.
 */
export function useSessionProfile() {
  const sessionToken = useWidgetStore((s) => s.sessionToken);
  const authenticated = useWidgetStore((s) => s.authenticated);
  const language = useWidgetStore((s) => s.language);
  const setCustomerName = useWidgetStore((s) => s.setCustomerName);

  // Ask at most once per token — a customer whose name is genuinely unknown
  // (profile backfill still pending) must not trigger a request per render.
  const askedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!authenticated || !sessionToken) return;
    if (askedFor.current === sessionToken) return;
    askedFor.current = sessionToken;

    let cancelled = false;
    ensureSession(sessionToken, language)
      .then((res) => {
        if (cancelled) return;
        // Adopt the name; token/auth state stays owned by the paths above.
        if (res.customerName) setCustomerName(res.customerName);
        // Tenant configuration keys off the shop, not the session — adopt all of
        // it here (a storefront-signed-in widget makes no other ensure call).
        adoptTenantConfig(res);
        // This re-ensure is the ONLY /session/ensure a storefront-signed-in
        // widget makes (useEnsureSession bails once authenticated), so the
        // verified session's consent state must be adopted — and a pending one
        // replayed from the local choice — here, or the shopper sees no banner
        // while the server still blocks chat as consent-pending.
        adoptSessionConsent(res);
      })
      .catch(() => {
        /* offline or session gone — greeting simply stays generic */
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, sessionToken, language, setCustomerName]);
}
