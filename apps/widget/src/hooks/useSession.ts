import { useEffect } from 'react';
import { useWidgetStore, type ConsentInfo } from '../store/widgetStore';
import { ensureSession, setConsent } from '../services/sessionService';
import { getShopDomain, getStoredSessionToken } from '../lib/api-client';
import { applyTheme, cacheTheme } from '../lib/theme';
import { apiOrigin } from '../lib/api-client';
import { clearStoredConsent, getStoredConsentRecord, setStoredConsent } from '../lib/consent';
import type { SessionResponse } from '../lib/types';
import i18n, {
  LANG_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
} from '../i18n/i18n';

/**
 * How long the embedded widget waits for the storefront identity handshake before
 * falling back to a guest session. Covers the storefront → Shopify → app proxy
 * round trip (~2s observed) without leaving chat unusable if the proxy is absent.
 */
const IDENTITY_WAIT_MS = 5000;

/** True when the user has manually picked a language (persisted to localStorage). */
function hasManualLanguageOverride(): boolean {
  try {
    return !!localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return false;
  }
}

/**
 * Origin of the page hosting this widget (PLN-260819 S1).
 *
 * `ancestorOrigins` is the browser's own answer and cannot be spoofed by the
 * host page; where it is missing (Firefox) the loader's reported value is used,
 * which is only as trustworthy as the page itself — which is why the allowlist
 * is a misconfiguration guard and not authentication.
 */
export function getParentOrigin(): string | undefined {
  try {
    const ancestors = window.location.ancestorOrigins;
    if (ancestors?.length) return ancestors[0];
    const reported = new URLSearchParams(window.location.search).get('parent');
    if (reported) return reported;
    // Not embedded at all (opened directly) — no parent to report.
    return window.parent === window ? undefined : document.referrer || undefined;
  } catch {
    return undefined;
  }
}

// Re-exported for existing importers (branding.ts); the definition moved to
// lib/api-client so the session storage key can be namespaced by shop.
export { getShopDomain };

/**
 * AI agent code the embed loader forwards from the page's snippet (`?agent=`,
 * PLN-260820). Decides which persona answers sessions born on this page;
 * absent (older loaders, direct open) = the tenant's default agent.
 */
export function getAgentCode(): string | undefined {
  try {
    return new URLSearchParams(window.location.search).get('agent') ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalize the session/ensure consent fields into the store snapshot and keep
 * the localStorage cache in line with the server (server is source of truth).
 */
export function consentInfoFromSession(res: SessionResponse): ConsentInfo {
  const state =
    res.consentState === 'granted' || res.consentState === 'declined'
      ? res.consentState
      : 'pending';
  return {
    state,
    consentAt: res.consentAt ?? null,
    noticeVersion: res.consentNoticeVersion ?? null,
    privacyPolicyUrl: res.privacyPolicyUrl ?? null,
    noticeOutdated: !!res.noticeOutdated,
  };
}

/**
 * Adopt a session's consent state into the store, replaying a version-matching
 * local choice onto a fresh (always-pending) session via POST /session/consent
 * instead of re-prompting — see lib/consent.ts. Shared by the anonymous ensure
 * path and the authenticated profile re-ensure (useSessionProfile): a verified
 * session minted by the app-proxy sign-in starts just as 'pending' as a guest
 * one, and skipping it left signed-in shoppers with a hidden banner AND a
 * consent-blocked chat ("cannot process chat messages until you accept…").
 */
export function adoptSessionConsent(res: SessionResponse): void {
  const { setConsentInfo } = useWidgetStore.getState();
  const consentInfo = consentInfoFromSession(res);
  const stored = getStoredConsentRecord();
  const replay =
    consentInfo.state === 'pending' &&
    !consentInfo.noticeOutdated &&
    stored != null &&
    stored.version != null &&
    stored.version === consentInfo.noticeVersion
      ? stored
      : null;
  if (replay) {
    // Optimistic: hide the banner now; the server session is re-recorded
    // below. On failure fall back to 'pending' so the banner (fail-closed
    // recorder) takes over again.
    setConsentInfo({
      ...consentInfo,
      state: replay.state === 'granted' ? 'granted' : 'declined',
      consentAt: replay.at,
    });
    void setConsent(res.sessionToken, replay.state === 'granted').catch(() =>
      setConsentInfo(consentInfo),
    );
  } else {
    setConsentInfo(consentInfo);
  }
  syncStoredConsent(consentInfo);
}

function syncStoredConsent(info: ConsentInfo): void {
  // A pending state no longer clears the cache: embedded anonymous widgets get
  // a fresh (pending) session every page load, and the cached choice is exactly
  // what lets auto-replay skip re-asking. Only a stale notice version (bump →
  // re-consent policy, PRV-M4) invalidates the local record.
  if (info.noticeOutdated) clearStoredConsent();
  else if (info.state !== 'pending') setStoredConsent(info.state === 'granted', info.noticeVersion);
}

/**
 * Ensures a session token exists once the widget mounts.
 * Stores token + authenticated flag in the Zustand store.
 */
export function useEnsureSession() {
  // Token/auth state is read via getState() inside the effect: this runs once on
  // mount and must see the live value after the async identity wait, not the
  // value captured at render time.
  const language = useWidgetStore((s) => s.language);
  const setSessionToken = useWidgetStore((s) => s.setSessionToken);
  const setAuthenticated = useWidgetStore((s) => s.setAuthenticated);
  const setCustomerName = useWidgetStore((s) => s.setCustomerName);
  const setLanguage = useWidgetStore((s) => s.setLanguage);
  const setAiProcessingRegion = useWidgetStore((s) => s.setAiProcessingRegion);
  const setLoginMode = useWidgetStore((s) => s.setLoginMode);
  const setTabLayout = useWidgetStore((s) => s.setTabLayout);
  const setWidgetCopy = useWidgetStore((s) => s.setWidgetCopy);
  const setWidgetTheme = useWidgetStore((s) => s.setWidgetTheme);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const embedded = window.parent !== window;

    function start() {
      if (cancelled) return;
      // A verified session already arrived from the storefront handshake — it is
      // customer-bound and carries the shopper's history, so don't open another.
      if (useWidgetStore.getState().authenticated) return;
      run();
    }

    // When embedded, the identity round trip (storefront → Shopify → app) finishes
    // well after the widget mounts. Opening a guest session immediately meant a
    // signed-in shopper started on a throwaway session on every page load — which
    // is where their chat thread went. Wait for the loader's verdict, with a
    // timeout so a store without the app proxy (or an older embed.js that never
    // reports) still gets a working guest session.
    if (embedded && useWidgetStore.getState().embedIdentity === 'pending') {
      unsubscribe = useWidgetStore.subscribe((s) => {
        if (s.embedIdentity !== 'pending') {
          unsubscribe?.();
          unsubscribe = undefined;
          start();
        }
      });
      timer = setTimeout(() => {
        unsubscribe?.();
        unsubscribe = undefined;
        start();
      }, IDENTITY_WAIT_MS);
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        unsubscribe?.();
      };
    }

    run();

    function run() {
    // Resume hint: the store token is always null at bootstrap; a persisted
    // token (standalone only — embedded loads must not resume a previous
    // customer's session) is passed to ensure for validation, and only the
    // token the backend returns reaches the store/queries.
    const resumeToken =
      useWidgetStore.getState().sessionToken ?? (embedded ? null : getStoredSessionToken());
    ensureSession(resumeToken, language, getShopDomain(), getParentOrigin(), getAgentCode())
      .then((res) => {
        if (cancelled) return;
        // Tenant widget config is safe to adopt regardless of which session wins
        // below (it keys off the shop, not the session).
        if (res.widgetLoginMode) setLoginMode(res.widgetLoginMode);
        // Tab layout is tenant configuration (PLN-260817-Widget-Tab-Config).
        // Guarded: a server that predates the setting sends neither field, and
        // the store's seeded default is the right answer in that case.
        if (res.widgetTabs?.length) {
          setTabLayout(res.widgetTabs, res.widgetTabPosition ?? 'top');
        }
        // Brand theme (PLN-260818). Applied even when null — that clears any
        // cached theme from a tenant that has since turned theming off.
        applyTheme(res.widgetTheme ?? null);
        setWidgetTheme(res.widgetTheme ?? null);
        cacheTheme(getShopDomain(), res.widgetTheme ?? null);
        // Console preview (PLN-260910 P3 D-15): a signed ?preview= token paints
        // an unapplied design over the live one — never cached, never for shoppers.
        const previewToken = new URLSearchParams(window.location.search).get('preview');
        if (previewToken) {
          fetch(`${apiOrigin()}/public/widget/preview-theme?token=${encodeURIComponent(previewToken)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((body) => {
              const theme = body?.data?.theme ?? null;
              if (theme && !cancelled) {
                applyTheme(theme);
                setWidgetTheme(theme);
              }
            })
            .catch(() => {
              /* an expired token simply shows the live widget */
            });
        }
        if (res.widgetCopy) setWidgetCopy(res.widgetCopy);
        // The app-proxy handshake (useEmbedIdentity) may have adopted a
        // customer-bound token while this anonymous ensure was in flight. Don't
        // clobber it: re-read the live store and bail if already authenticated.
        if (useWidgetStore.getState().authenticated) return;
        if (res.sessionToken && res.sessionToken !== useWidgetStore.getState().sessionToken) {
          setSessionToken(res.sessionToken);
        }
        setAuthenticated(!!res.authenticated);
        if (res.customerName) setCustomerName(res.customerName);

        // Server-side consent is the source of truth for the notice banner
        // (an outdated notice re-prompts regardless of the local cache); a
        // fresh pending session replays a version-matching local choice
        // instead of re-asking — see adoptSessionConsent below.
        adoptSessionConsent(res);

        // Tie default UI language to the backend session, unless the user
        // has manually overridden it.
        const code = (res.language || '').toLowerCase();
        if (
          (SUPPORTED_LANGUAGES as readonly string[]).includes(code) &&
          !hasManualLanguageOverride()
        ) {
          void i18n.changeLanguage(code);
          setLanguage(code);
        }
        // Deployment-level: where inference runs, named in the AI disclosure (G7).
        setAiProcessingRegion((res.aiProcessingRegion || 'US').toUpperCase());
      })
      .catch(() => {
        /* offline / backend not running — widget still renders */
      });
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
