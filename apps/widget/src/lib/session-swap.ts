import type { SessionResponse } from './types';

/**
 * Replacing the widget's live session (PLN-261012 SG-02, REQ D-02 / D-03).
 *
 * Three things end the current session without the page reloading: the host
 * calls `logout()`, the host identifies a DIFFERENT person or hotel (the API then
 * answers with a new session token), or an `identify` fails on a session that was
 * already signed in. In all three the widget has to stop showing — and stop
 * fetching — what belonged to the previous identity, and it must do so in the same
 * way, which is why the sequence lives here once instead of three times in a hook.
 *
 * This file touches nothing global. The pieces that are not pure (the React Query
 * cache, the Zustand store, the API) come in as `ports`, so the ORDER of the
 * steps — the part that matters — is testable on its own.
 */
export interface SessionSwapPorts {
  /** Forget everything fetched for the previous session (the React Query cache). */
  clearCache(): void;
  /**
   * Stop using the current session this instant: no token, signed out, no name,
   * nothing queued. Must be synchronous — a host that calls `logout()` and then
   * `identify()` back to back relies on the second call finding no token and being
   * parked until the fresh session exists.
   */
  detach(): void;
  /**
   * Make `res` the live session: signed-in flag, display name, consent and, LAST,
   * the token. The token is what re-keys the panels, so everything they read
   * must already be in place when it changes.
   */
  adopt(res: SessionResponse): void;
  /** Open a guest session for this page (same inputs as the first ensure). */
  startGuest(): Promise<SessionResponse>;
  /** Ask the API to end the identity binding of `token` (`POST /public/embed/logout`). */
  endBinding(token: string): Promise<unknown>;
}

/**
 * `identify` answered with a different session than the one it was sent on: the
 * API forked because the signed-in person, hotel or role changed. The widget has
 * to adopt that session — staying on the old token would keep showing the
 * previous person's thread.
 */
export function isForkedSession(sentToken: string, res: Pick<SessionResponse, 'sessionToken'>): boolean {
  return !!res.sessionToken && res.sessionToken !== sentToken;
}

/** Switch to the session the API created for a new person or hotel. */
export function adoptForkedSession(res: SessionResponse, ports: SessionSwapPorts): void {
  ports.clearCache();
  ports.adopt(res);
}

/**
 * Drop the current session and start over as a guest.
 *
 * The widget side comes first and does not wait for the network: from the first
 * line nothing renders or polls with the old identity. Ending the server-side
 * binding is best effort — the old token is gone from this browser either way, so
 * a failed call leaves nothing reachable, only a session row that ages out. It runs
 * in parallel with opening the guest session so the visitor is not left without a
 * working chat while the logout round trip completes.
 *
 * Resolves `true` when a guest session is in place, `false` when the widget is left
 * without one (offline) — the same state a first load without a backend ends in.
 */
export async function resetToGuest(oldToken: string | null, ports: SessionSwapPorts): Promise<boolean> {
  ports.detach();
  ports.clearCache();
  const [, fresh] = await Promise.allSettled([
    oldToken ? ports.endBinding(oldToken) : Promise.resolve(null),
    ports.startGuest(),
  ]);
  if (fresh.status !== 'fulfilled' || !fresh.value?.sessionToken) return false;
  ports.adopt(fresh.value);
  return true;
}
