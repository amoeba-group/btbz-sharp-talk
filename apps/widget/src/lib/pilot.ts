/**
 * Pilot allowlist by hotel, widget side (PLN-261012 SG-40).
 *
 * The SERVER decides who is served — every chat turn is checked against the
 * hotel list. What lives here is only how the widget gets out of the way once the
 * server has said a visitor is not on the list: hide the launcher, or keep it and
 * show a note. Pure functions, no imports beyond types, so the rules (and the
 * wire message the loader reads) are testable on their own.
 */

/** The verdict as the API sends it (`pilot` on ensure / identify, and `/session/pilot`). */
export interface PilotWire {
  eligible: boolean | null;
  mode?: 'hide' | 'notice';
  notice?: string;
}

/** What the widget does about it. */
export type PilotView =
  | { kind: 'allowed' }
  /** `notice` rides along so a host app, which cannot "hide", can still show it. */
  | { kind: 'hide'; notice: string | null }
  | { kind: 'notice'; notice: string };

export const PILOT_ALLOWED: PilotView = { kind: 'allowed' };

/**
 * Wire verdict → view. Anything the widget cannot read — an older API that sends no
 * `pilot`, `eligible: null` (no list in force), a malformed value — is `allowed`:
 * the widget never hides on a guess, the server is the one that refuses.
 */
export function pilotViewOf(pilot: PilotWire | null | undefined): PilotView {
  if (!pilot || pilot.eligible !== false) return PILOT_ALLOWED;
  const notice = typeof pilot.notice === 'string' && pilot.notice.trim() ? pilot.notice : null;
  if (pilot.mode === 'notice' && notice) return { kind: 'notice', notice };
  // `notice` mode without text cannot show a note; hiding is the safe reading.
  return { kind: 'hide', notice };
}

/**
 * In a host app the WebView IS the screen, so "hide" would leave it blank. The
 * widget shows the note instead (the host still gets the visibility message and can
 * dismiss the screen itself). Without a note there is nothing to show — stay hidden.
 */
export function effectivePilotView(view: PilotView, appMode: boolean): PilotView {
  if (appMode && view.kind === 'hide' && view.notice) return { kind: 'notice', notice: view.notice };
  return view;
}

/**
 * The store's next pilot state for a verdict just received. `pilotKnown` flips on the
 * first response that carries ANY verdict (even "no list in force"): the loader may be
 * holding the frame hidden until it hears one. `closePanel` is set when the widget is
 * told to hide while open — it must not stay on screen. A host app cannot hide (its
 * WebView is the screen), so there it keeps the note instead of closing.
 */
export function reducePilot(
  prev: { pilot: PilotView; pilotKnown: boolean },
  wire: PilotWire | null | undefined,
  appMode: boolean,
): { pilot: PilotView; pilotKnown: boolean; closePanel: boolean } {
  const view = pilotViewOf(wire);
  return {
    // The previous object is kept when nothing changed, so subscribers do not re-render.
    pilot: samePilotView(prev.pilot, view) ? prev.pilot : view,
    pilotKnown: prev.pilotKnown || !!wire,
    closePanel: effectivePilotView(view, appMode).kind === 'hide',
  };
}

/** What the loader (and a native host) is told. `visible` is the only field it acts on. */
export interface VisibilityMessage {
  type: 'ivy:visibility';
  visible: boolean;
  reason: 'pilot' | null;
  mode: 'hide' | 'notice' | null;
}

/**
 * The `ivy:visibility` message for a view. A note keeps the launcher on the page, so
 * it is `visible: true` — with `reason`/`mode` so a host that wants to know the
 * visitor was restricted can tell.
 */
export function visibilityMessage(view: PilotView): VisibilityMessage {
  switch (view.kind) {
    case 'hide':
      return { type: 'ivy:visibility', visible: false, reason: 'pilot', mode: 'hide' };
    case 'notice':
      return { type: 'ivy:visibility', visible: true, reason: 'pilot', mode: 'notice' };
    default:
      return { type: 'ivy:visibility', visible: true, reason: null, mode: null };
  }
}

/** Compare two views by what they mean, not by object identity. */
export function samePilotView(a: PilotView, b: PilotView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'allowed') return true;
  return a.notice === (b as { notice: string | null }).notice;
}

/**
 * How often a restricted widget asks again whether it still is. A hotel added in the
 * console has to be able to bring the widget back without the host re-identifying;
 * 90 s keeps that to about the server's own 60 s cache plus a poll, and costs one
 * tiny request per restricted page, only while its tab is visible.
 */
export const PILOT_RECHECK_MS = 90_000;

/**
 * Whether a re-check is due. Only a RESTRICTED widget re-checks — an allowed one has
 * nothing to win by it (the server stops a removed hotel on its own, and the page's
 * next identify carries the news) — and never from a background tab.
 */
export function shouldRecheckPilot(
  view: PilotView,
  state: { tabVisible: boolean; msSinceLastCheck: number },
): boolean {
  if (view.kind === 'allowed') return false;
  if (!state.tabVisible) return false;
  return state.msSinceLastCheck >= PILOT_RECHECK_MS;
}
