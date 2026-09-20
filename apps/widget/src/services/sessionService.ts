import { apiClient } from '../lib/api-client';
import type { ConsentResult, SessionResponse } from '../lib/types';

export function ensureSession(
  sessionToken: string | null,
  locale: string,
  shopDomain?: string,
  parentOrigin?: string,
  agentCode?: string,
  landingPath?: string,
): Promise<SessionResponse> {
  return apiClient.post<SessionResponse>('/session/ensure', {
    session_token: sessionToken ?? undefined,
    locale,
    shop_domain: shopDomain ?? undefined,
    parent_origin: parentOrigin ?? undefined,
    // AI agent for sessions born on this page (PLN-260820); server falls back
    // to the tenant default on unknown codes.
    agent_code: agentCode ?? undefined,
    // Which storefront page showed the widget (PLN-260920). The server strips
    // the query string and keeps the path — see normalizeLandingPath.
    landing_path: landingPath ?? undefined,
  });
}

/**
 * Tell the server the shopper opened the panel (PLN-260920).
 *
 * Fire-and-forget by contract: the session row already records that the widget
 * was shown, and this is the counter that separates shown from opened. It must
 * never delay or break the panel, so the promise is swallowed here rather than
 * awaited at the call site.
 */
export function reportPanelOpened(sessionToken: string): void {
  void apiClient.post('/session/opened', { session_token: sessionToken }).catch(() => {});
}

/**
 * Bind this session to a user the host application has already authenticated
 * (PLN-260819 S2). The hash is produced by the customer's own server; the widget
 * only carries it.
 */
export function identify(
  sessionToken: string,
  user: { userId: string; hash: string; name?: string; email?: string; phone?: string },
): Promise<SessionResponse> {
  return apiClient.post<SessionResponse>('/public/embed/identify', {
    session_token: sessionToken,
    user_id: user.userId,
    hash: user.hash,
    name: user.name,
    email: user.email,
    phone: user.phone,
  });
}

export function setConsent(
  sessionToken: string,
  granted: boolean,
): Promise<ConsentResult> {
  return apiClient.post<ConsentResult>('/session/consent', {
    session_token: sessionToken,
    granted,
  });
}

/** Sync the backend session language. `language` is an uppercase code, e.g. 'EN'. */
export function setSessionLanguage(
  sessionToken: string,
  language: string,
): Promise<unknown> {
  return apiClient.post('/session/language', {
    session_token: sessionToken,
    language,
  });
}
