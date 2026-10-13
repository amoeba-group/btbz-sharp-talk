import { useEffect, useRef } from 'react';
import { useWidgetStore } from '../store/widgetStore';
import { postToHost } from '../lib/host-bridge';
import { shouldRecheckPilot, visibilityMessage } from '../lib/pilot';
import type { PilotWire } from '../lib/pilot';
import { fetchPilot } from '../services/sessionService';

/** How often a restricted widget checks whether it is due a re-check (the rule is in lib/pilot). */
const RECHECK_TICK_MS = 30_000;

/**
 * Take the pilot verdict out of a session response (`ensure`, `identify`).
 * Absent on an older API — the store then simply stays 'allowed'.
 */
export function adoptPilot(res: { pilot?: PilotWire | null }): void {
  useWidgetStore.getState().setPilot(res.pilot);
}

/**
 * Pilot allowlist, widget side (PLN-261012 SG-40).
 *
 *  1. Tell the host — the loader's iframe box, or a native app — whether this visitor
 *     is shown the widget: `ivy:visibility`. REVERSIBLE: it is sent on every change,
 *     so a host that switches hotel (the new identify answers "eligible") gets the
 *     widget back. The loader may be holding the frame hidden until the FIRST verdict,
 *     which is why an `allowed` verdict is announced too and not only a hide.
 *  2. While restricted, ask the server again from time to time and when the tab comes
 *     back, so a hotel added in the console is picked up without the host identifying
 *     again.
 *  3. A turn the server refused for pilot scope re-asks at once (`requestPilotRecheck`).
 *
 * None of this decides who is served. The server checks every turn; this only makes
 * the widget get out of the way.
 */
export function usePilotVisibility(): void {
  const view = useWidgetStore((s) => s.pilot);
  const known = useWidgetStore((s) => s.pilotKnown);
  const recheck = useWidgetStore((s) => s.pilotRecheck);
  const sessionToken = useWidgetStore((s) => s.sessionToken);
  const lastPosted = useRef<string | null>(null);

  useEffect(() => {
    if (!known) return;
    const msg = visibilityMessage(view);
    const key = `${msg.visible}|${msg.reason}|${msg.mode}`;
    if (lastPosted.current === key) return;
    lastPosted.current = key;
    postToHost(msg);
  }, [view, known]);

  const restricted = view.kind !== 'allowed';
  useEffect(() => {
    if (!restricted || !sessionToken) return;
    let cancelled = false;
    let lastCheck = Date.now();

    const ask = async () => {
      lastCheck = Date.now();
      try {
        const res = await fetchPilot(sessionToken);
        if (!cancelled) useWidgetStore.getState().setPilot(res.pilot);
      } catch {
        /* offline or the session is gone — keep what we know, try again later */
      }
    };
    const maybeAsk = () => {
      const state = {
        tabVisible: document.visibilityState !== 'hidden',
        msSinceLastCheck: Date.now() - lastCheck,
      };
      if (shouldRecheckPilot(useWidgetStore.getState().pilot, state)) void ask();
    };

    const timer = setInterval(maybeAsk, RECHECK_TICK_MS);
    document.addEventListener('visibilitychange', maybeAsk);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', maybeAsk);
    };
  }, [restricted, sessionToken]);

  // A refused turn re-reads the verdict now — it is the surest sign the widget is stale.
  const firstRecheck = useRef(true);
  useEffect(() => {
    if (firstRecheck.current) {
      firstRecheck.current = false;
      return;
    }
    if (!sessionToken) return;
    let cancelled = false;
    fetchPilot(sessionToken)
      .then((res) => {
        if (!cancelled) useWidgetStore.getState().setPilot(res.pilot);
      })
      .catch(() => {
        /* the next ensure / identify will say */
      });
    return () => {
      cancelled = true;
    };
    // sessionToken is read, not watched: only a bump of `recheck` triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recheck]);
}
