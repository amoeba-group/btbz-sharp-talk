import { postToHost } from './host-bridge';

/**
 * Tell the host app its signed identity has lapsed (PLN-261012 SG-03, REQ D-04).
 *
 * The API treats signed claims older than a tenant's max age as a guest. Until now
 * nothing told the HOST: the visitor simply started being asked to sign in again
 * mid-shift. Here the widget turns three signals into one `identity-expired` event
 * (forwarded by the loader to `ShopTalk.on('identity-expired', cb)`) so the host can
 * sign again and call `identify` silently, on the same session:
 *
 *  - the session response says when the claims lapse — a timer fires at that moment,
 *    before the visitor's next message ever hits the gate;
 *  - the session response says they already lapsed (a page reopened after a night);
 *  - a poll or a chat turn comes back flagged `identityExpired` (another tab, a missed
 *    timer, a laptop that slept through the deadline).
 *
 * Pure of React and of the DOM except for the injected `emit`/`now`/timers, so the
 * ORDER and the de-duplication — the part that matters — are tested on their own.
 */

/** `setTimeout` is signed 32-bit: a longer delay fires at once. Long waits are re-armed in slices. */
const MAX_TIMER_MS = 2_000_000_000;

export interface ExpiryClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const realClock: ExpiryClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The part of a session / poll / turn response this cares about. */
export interface ExpirySignal {
  sessionToken?: string | null;
  identityExpired?: boolean;
  identityExpiresAt?: string | null;
}

export function createIdentityExpiryNotifier(emit: () => void, clock: ExpiryClock = realClock) {
  let timer: unknown = null;
  /** The session the current schedule / notification belongs to. */
  let token: string | null = null;
  /** Already told the host for this signing — until a fresh signature resets it. */
  let notified = false;

  function clear(): void {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  }

  function fire(): void {
    clear();
    if (notified) return;
    notified = true;
    emit();
  }

  function arm(expiresMs: number): void {
    clear();
    const wait = expiresMs - clock.now();
    if (wait <= 0) return fire();
    // A moment of slack past the deadline: the server decides "strictly older than
    // the max age", so firing a hair early would ask the host to sign for a session
    // the API still honours, and the next poll would not yet say it lapsed.
    timer = clock.setTimer(
      () => (expiresMs - clock.now() > 0 ? arm(expiresMs) : fire()),
      Math.min(wait + 250, MAX_TIMER_MS),
    );
  }

  return {
    /**
     * A session response arrived (ensure, identify, fork adoption). Re-arms the timer
     * for THIS session; a new signature (a later `identityExpiresAt`) re-opens the
     * notification, so the next lapse is reported too.
     */
    observe(res: ExpirySignal): void {
      const sessionToken = res.sessionToken ?? null;
      if (sessionToken !== token) {
        token = sessionToken;
        notified = false;
      }
      if (res.identityExpired) {
        clear();
        fire();
        return;
      }
      if (!res.identityExpiresAt) {
        // Guest, v1 identity or platform login: nothing to age.
        clear();
        notified = false;
        return;
      }
      const at = Date.parse(res.identityExpiresAt);
      if (!Number.isFinite(at)) return clear();
      // A fresher signature than the one already reported.
      if (at > clock.now()) notified = false;
      arm(at);
    },

    /**
     * A poll, a chat turn or a rejected call (E5096) said the claims lapsed. `forToken`
     * names the session when the caller knows it; omitted = the one last observed.
     */
    reportExpired(forToken?: string | null): void {
      if (forToken && forToken !== token) {
        token = forToken;
        notified = false;
      }
      fire();
    },

    /** The session was dropped (logout, swap): stop the timer and forget what was reported. */
    cancel(): void {
      clear();
      token = null;
      notified = false;
    },
  };
}

/** The widget's one notifier: its event goes to the host, nowhere else. */
export const identityExpiry = createIdentityExpiryNotifier(() =>
  postToHost({ type: 'ivy:event', event: 'identity-expired' }),
);
