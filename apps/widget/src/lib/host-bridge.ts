/**
 * The channel back to whatever is hosting this widget (PLN-260820 W1).
 *
 * On a storefront the host is a parent frame and the channel is postMessage. In
 * a mobile app there is no parent frame at all — `window.parent === window` —
 * which is why every host-facing hook used to switch itself off inside a
 * WebView. Native hosts inject a bridge object instead, and call back in
 * through a global.
 *
 * The message shapes are deliberately identical in both directions and on all
 * platforms. An app-only protocol would mean two implementations of the same
 * feature, and a fix made on the web would quietly not reach the app.
 */

export type HostKind = 'frame' | 'react-native' | 'ios' | 'android' | null;

/** Global the native side calls to deliver a message into the widget. */
const NATIVE_INBOX = '__shoptalkHost';

interface NativeGlobals {
  ReactNativeWebView?: { postMessage: (data: string) => void };
  webkit?: { messageHandlers?: { shoptalk?: { postMessage: (data: unknown) => void } } };
  ShopTalkAndroid?: { postMessage: (data: string) => void };
  [NATIVE_INBOX]?: (payload: string) => void;
}

function globals(): NativeGlobals {
  return window as unknown as NativeGlobals;
}

/**
 * Which host we are talking to, or null when running standalone (opened
 * directly in a browser tab, or in tests).
 */
export function hostKind(): HostKind {
  const g = globals();
  if (g.ReactNativeWebView?.postMessage) return 'react-native';
  if (g.webkit?.messageHandlers?.shoptalk?.postMessage) return 'ios';
  if (g.ShopTalkAndroid?.postMessage) return 'android';
  if (window.parent !== window) return 'frame';
  return null;
}

export function hostPresent(): boolean {
  return hostKind() !== null;
}

/** True for the three WebView hosts — used where a browser-only signal makes no sense. */
export function isNativeHost(): boolean {
  const kind = hostKind();
  return kind === 'react-native' || kind === 'ios' || kind === 'android';
}

/**
 * Send a message to the host. Silent when there is no host: a standalone widget
 * announcing itself to nobody is not an error worth surfacing.
 */
export function postToHost(message: unknown): void {
  const g = globals();
  try {
    switch (hostKind()) {
      case 'react-native':
        g.ReactNativeWebView?.postMessage(JSON.stringify(message));
        return;
      case 'ios':
        // WKWebView's bridge takes a structured value, not a string.
        g.webkit?.messageHandlers?.shoptalk?.postMessage(message);
        return;
      case 'android':
        g.ShopTalkAndroid?.postMessage(JSON.stringify(message));
        return;
      case 'frame':
        window.parent.postMessage(message, '*');
        return;
      default:
        return;
    }
  } catch {
    // A host that tears its bridge down mid-message must not take the widget
    // with it — the conversation keeps working without the host.
  }
}

/**
 * Open a tenant-supplied page OUTSIDE the widget (PLN-261001 V2): the partner
 * portal's sign-in or registration. The widget iframe is sandboxed and must
 * not navigate the host page itself, so a storefront frame asks its loader
 * (`ivy:open-url`, which the loader honours only from this iframe, in the
 * tenant's login mode — whole-tab redirect or popup) and a native host gets the
 * same message to hand to the system browser. Standalone opens a new tab.
 *
 * Only http(s) ever leaves here. The URL comes from tenant configuration, and
 * a `javascript:` value saved by mistake must not run in the storefront.
 * Returns false when nothing was done.
 */
export function openHostUrl(url: string, mode: 'redirect' | 'popup' = 'redirect'): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (hostKind() !== null) {
    postToHost({ type: 'ivy:open-url', url, mode });
    return true;
  }
  try {
    // noopener/noreferrer: the destination is tenant-supplied.
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // Popup blocked — nothing else the widget can do from inside its frame.
  }
  return true;
}

export interface HostMessage {
  type?: string;
  [key: string]: unknown;
}

/**
 * Only https (or localhost, for development) may drive the widget from a parent
 * frame — the same rule the identity handshake has always applied, kept here so
 * every caller inherits it rather than repeating it.
 */
function isTrustedOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol === 'https:') return true;
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * Listen for host messages. Returns an unsubscribe function.
 *
 * Native messages carry no origin: the only code that can reach
 * `window.__shoptalkHost` is the app that owns this WebView, which is a
 * stronger guarantee than an origin string. Identity still has to be signed
 * (PLN-260819 S2) — the channel proves who is speaking, never who the user is.
 */
type Handler = (message: HostMessage, meta: { origin: string | null }) => void;

const handlers = new Set<Handler>();
/**
 * Messages the native host sent before anything was listening.
 *
 * A host app calls `identify()` as it opens the screen, which routinely beats
 * React mounting. Queuing is the same fix the storefront loader needed for its
 * commands — and it is also why the global is installed once, at module load,
 * rather than per subscription: a host calling it after unmount would otherwise
 * hit "not a function" inside a WebView with no console to show it.
 */
const pending: HostMessage[] = [];
/** Long enough for a real burst, short enough not to hold a leak. */
const MAX_PENDING = 20;

let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Flush the pre-mount queue on the next tick, to EVERY handler subscribed by
 * then. It used to flush synchronously into the one handler that subscribed
 * first — which on a real device meant a native identify sent before mount was
 * delivered only to the identity hook and never reached the command hook that
 * acts on it (found on-device, FIX-260828). One tick lets every hook of the
 * same render commit subscribe before anything is handed out.
 */
function scheduleFlush(): void {
  if (flushTimer !== null || pending.length === 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (handlers.size === 0) return; // subscriber vanished — keep holding
    const queued = pending.splice(0, pending.length);
    for (const message of queued) {
      for (const handler of handlers) handler(message, { origin: null });
    }
  }, 0);
}

function deliver(message: HostMessage, origin: string | null): void {
  if (handlers.size === 0) {
    if (pending.length < MAX_PENDING) pending.push(message);
    return;
  }
  for (const handler of handlers) handler(message, { origin });
}

function installNativeInbox(): void {
  const g = globals();
  if (g[NATIVE_INBOX]) return;
  g[NATIVE_INBOX] = (payload: string) => {
    try {
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (parsed && typeof parsed === 'object') deliver(parsed as HostMessage, null);
    } catch {
      // A malformed injection is ignored rather than thrown: the native side
      // has no console to see the exception in.
    }
  };
}
installNativeInbox();

export function onHostMessage(handler: Handler): () => void {
  const onWindowMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.source === window) return;
    if (!isTrustedOrigin(event.origin)) return;
    deliver((event.data ?? {}) as HostMessage, event.origin);
  };
  window.addEventListener('message', onWindowMessage);
  handlers.add(handler);

  // Anything the host said while nobody was listening arrives next tick, in
  // order, to all subscribers — see scheduleFlush.
  scheduleFlush();

  return () => {
    window.removeEventListener('message', onWindowMessage);
    handlers.delete(handler);
  };
}

/**
 * App mode: the host app owns the frame, so the widget drops its launcher,
 * opens straight into the conversation, and asks the host to dismiss it instead
 * of closing into a blank screen.
 */
export function isAppMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('mode') === 'app';
  } catch {
    return false;
  }
}
