import { apiClient } from '../lib/api-client';
import type { ConsentResult, SessionResponse } from '../lib/types';

export function ensureSession(
  sessionToken: string | null,
  locale: string,
  shopDomain?: string,
  parentOrigin?: string,
  agentCode?: string,
  landingPath?: string,
  accessKey?: string,
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
    // Invite key for a restricted (test-mode) widget (PLN-260929). Absent for
    // everyone else, which is the normal case.
    access_key: accessKey ?? undefined,
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
 * Signed partner context (identify v2, PLN-261001 §1.2b): the hotel and role the
 * host's server put under the signature. `hotelName`/`hotelCode` are display
 * only. Passed through untouched — the widget never computes a hash.
 */
export interface IdentifyClaims {
  hotelSn: string;
  role: string;
  /** Unix seconds at signing; the API accepts ±10 minutes. */
  iat: number;
  hotelName?: string;
  hotelCode?: string;
}

export interface IdentifyUser {
  userId: string;
  hash: string;
  name?: string;
  email?: string;
  phone?: string;
  claims?: IdentifyClaims;
}

/**
 * Bind this session to a user the host application has already authenticated
 * (PLN-260819 S2). The hash is produced by the customer's own server; the widget
 * only carries it. With `claims` the hash must be the v2 signature over
 * `userId|hotelSn|role|iat` — the API refuses claims under a v1 hash (Q8).
 */
export function identify(sessionToken: string, user: IdentifyUser): Promise<SessionResponse> {
  const c = user.claims;
  return apiClient.post<SessionResponse>('/public/embed/identify', {
    session_token: sessionToken,
    user_id: user.userId,
    hash: user.hash,
    name: user.name,
    email: user.email,
    phone: user.phone,
    claims: c
      ? {
          hotel_sn: c.hotelSn,
          role: c.role,
          iat: c.iat,
          hotel_name: c.hotelName,
          hotel_code: c.hotelCode,
        }
      : undefined,
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
