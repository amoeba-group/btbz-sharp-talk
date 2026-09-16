/**
 * IVY USA TalkTalk — storefront embed loader (vanilla, dependency-free).
 *
 * Injects a floating <iframe> that hosts the widget in isolation from the store
 * theme. The iframe URL carries ?shop (tenant resolution) and ?locale; the widget
 * posts `ivy:resize` messages so this loader can grow/shrink the frame.
 *
 * It also brokers Shopify customer sign-in: the sandboxed widget asks
 * (`ivy:login`, carrying the tenant-configured mode). In `redirect` mode (the
 * default) this loader navigates the whole tab to the store's own login page and
 * leaves a one-shot reopen flag so the widget reopens on the orders tab when the
 * shopper returns. In `popup` mode it opens the login in a popup instead; when
 * that popup lands back on a storefront page (where this same script runs) it
 * reports completion so the loader re-resolves identity. Either way the widget
 * ends up with a customer-bound session token — no separate account system,
 * just the store's.
 *
 * It stays off the storefront's sign-in screens entirely (see the guard below) —
 * both because the launcher covers the form and because mounting there would
 * spend the reopen flag the login round trip depends on.
 *
 * Usage (Shopify theme / app-embed block):
 *   <script>window.SHARPTALK_WIDGET_CONFIG = {
 *     shop: "your-store.myshopify.com", locale: "en",
 *     widgetUrl: "https://widget.ivyusa.app",
 *     ga4Id: "G-XXXXXXXXXX",
 *     hideOnPaths: ["/signin"] };</script>   // optional: replace the sign-in
 *                                            // path list ([] turns it off)
 *   <script src="https://widget.ivyusa.app/embed.js" defer></script>
 *
 * The pre-rename global IVY_WIDGET_CONFIG is honoured forever: it is baked
 * into store themes we cannot redeploy (ivyusa, amoebaorder, go2joy). When
 * both are set, SHARPTALK_WIDGET_CONFIG wins.
 */
(function () {
  // --- Auth popup return leg -------------------------------------------------
  // This loader is installed on every storefront page, so after the customer
  // signs in Shopify redirects the popup back to a storefront page where this
  // script runs again. Detect that we are that popup (our named window, with an
  // opener) and — instead of mounting a second widget — tell the opener sign-in
  // finished, then close. The opener is the same storefront origin, so a plain
  // postMessage suffices; the opener re-verifies identity server-side anyway.
  if (
    window.name === 'ivy_auth_popup' &&
    window.opener &&
    window.opener !== window
  ) {
    try {
      window.opener.postMessage(
        { type: 'ivy:auth-popup-done' },
        window.location.origin,
      );
    } catch (_) {
      /* opener gone — the opener's closed-poll fallback still recovers it */
    }
    // Let the message flush, then close. If the browser blocks programmatic
    // close (rare), the opener recovers via its closed-poll + identity re-fetch,
    // and this hint keeps the leftover tab from confusing the shopper.
    setTimeout(function () {
      try {
        window.close();
      } catch (_) {
        /* ignore */
      }
    }, 50);
    try {
      document.body.innerHTML =
        '<div style="font:14px system-ui,sans-serif;padding:24px;color:#333">' +
        'Signed in — you can close this window.</div>';
    } catch (_) {
      /* ignore */
    }
    return;
  }

  if (document.getElementById('ivy-talktalk-frame')) return; // idempotent

  // --- Public SDK surface (PLN-260819 S3) -----------------------------------
  // A page can either drop the script in with SHARPTALK_WIDGET_CONFIG (or the
  // pre-rename IVY_WIDGET_CONFIG — live on ivyusa and amoebaorder today, which
  // must keep working untouched) or drive it explicitly with SharpTalk.init().
  // The difference is only WHEN boot() runs: config-first pages boot on load,
  // init() pages boot when they say so. SharpTalk and ShopTalk are the same
  // object — either name drives the same widget.
  var api = (window.ShopTalk = window.SharpTalk = window.SharpTalk || window.ShopTalk || {});
  var queued = Array.isArray(api.q) ? api.q.slice() : [];
  var listeners = {};
  var booted = false;

  function emit(name, payload) {
    var fns = listeners[name];
    if (!fns) return;
    for (var i = 0; i < fns.length; i++) {
      try {
        fns[i](payload);
      } catch (_) {
        /* one bad handler must not stop the rest, or the widget itself */
      }
    }
  }

  var cfg = window.SHARPTALK_WIDGET_CONFIG || window.IVY_WIDGET_CONFIG || {};
  if (!window.SHARPTALK_WIDGET_CONFIG && window.IVY_WIDGET_CONFIG && window.console && console.info) {
    // Old installs keep working forever — this is a nudge, not a countdown.
    console.info('[SharpTalk] IVY_WIDGET_CONFIG still works, but new installs should use SHARPTALK_WIDGET_CONFIG.');
  }
  // Trigger mode (PLN-260916 P2): `cfg.trigger` is a CSS selector for the page's
  // own opener (a header bell). Present = no floating launcher, panel docked under
  // the header, unread count written into `cfg.badge` (default
  // `[data-sharptalk-badge]`). The tenant's theme can also switch this on.
  var triggerMode = !!cfg.trigger;
  var triggerOffset = 0;
  // Trigger mode hides the floating launcher, so a tenant who switches the mode
  // on before the storefront has the opener element would leave shoppers with no
  // way to open the widget at all (FIX-260916). The loader is the only side that
  // can see the page, so it checks — and falls back rather than stranding anyone.
  var triggerFellBack = false;
  var launcherSizePx = '96px';
  var isOpen = false;
  var openedAt = 0;
  var pageHost = (window.location.hostname || '').toLowerCase();
  var isCafe24Host = /(^|\.)cafe24\.com$/.test(pageHost);

  // --- Sign-in screens: never mount -----------------------------------------
  // Two reasons, and it is the second one that bites.
  //
  //  1. The launcher sits on top of the very form the shopper came to use.
  //  2. This script consumes the one-shot `ivy:reopen` flag WHEREVER it runs, and
  //     the mall's login page is the same origin — so mounting here spends the
  //     flag on the login screen, and the shopper comes back from a SUCCESSFUL
  //     sign-in to a closed widget. Sign-in looks broken when it is not
  //     (REQ-260819 §2-1).
  //
  // A flag rather than an early return, and boot() honours it: the page keeps a
  // complete `ShopTalk` object either way, so a storefront that drives the widget
  // through the SDK does not hit `init is not a function` on its own login page.
  // Nothing mounts, nothing is spent, and no guest session is opened for someone
  // who is trying to sign in — which is what "hidden" has to mean here, since
  // hiding a mounted widget with CSS would still burn the flag.
  //
  // Path prefixes, not regexes: the list is overridable per mall (`hideOnPaths`)
  // and a typo'd regex would fail silently. They are deliberately narrow — the
  // join TERMS step is /member/agreement, while /member/mall_agreement and
  // /member/privacy are policy pages a shopper may well want to ask about, and
  // /member/modify is a signed-in member editing their own profile.
  var CAFE24_SIGN_IN = [
    '/member/login',
    '/member/join',
    '/member/agreement',
    '/member/id/',
    '/member/passwd/',
  ];
  var DEFAULT_SIGN_IN = [
    '/account/login',
    '/account/register',
    '/account/reset',
    '/account/activate',
    '/challenge',
  ];
  var signInPaths;
  if (Array.isArray(cfg.hideOnPaths)) {
    signInPaths = cfg.hideOnPaths; // per-mall override, `[]` turns this off
  } else if (isCafe24Host || /^\/member\//.test(String(cfg.loginPath || '').toLowerCase())) {
    // A Cafe24 mall on a custom domain has no cafe24.com host to detect, but the
    // install snippet already names its login path — no new setting to get wrong.
    signInPaths = CAFE24_SIGN_IN;
  } else {
    signInPaths = DEFAULT_SIGN_IN;
  }
  // Drop a leading locale segment before matching. A Shopify store with markets
  // serves its login as /en-ca/account/login, and an anchored prefix would sail
  // straight past it — the same silent miss this guard exists to prevent.
  var herePath = (window.location.pathname || '').toLowerCase().replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/, '');
  // Our own Cafe24 popup counts too: it runs start -> authorize, and Cafe24 sends
  // it to the mall's OWN login page when the member is not signed in yet — a skin
  // page, so this script runs inside a 480x720 popup. (Unlike the Shopify leg
  // above we neither post nor close: that one IS the return leg, this one is
  // still mid-flow, and its ticket comes from our API origin.)
  var signInScreen = window.name === 'ivy_cafe24_auth';
  for (var si = 0; !signInScreen && si < signInPaths.length; si++) {
    if (herePath.indexOf(String(signInPaths[si]).toLowerCase()) === 0) signInScreen = true;
  }

  // Cafe24 malls rarely set data-shop and expose no window.Shopify — but the page
  // host IS the mall host, so fall back to it there. Without `shop` the widget
  // can't render its "my page" order-history link.
  var shop =
    cfg.shop || (window.Shopify && window.Shopify.shop) || (isCafe24Host ? pageHost : '');
  var base = String(cfg.widgetUrl || 'https://widget.ivyusa.app').replace(/\/+$/, '');
  // Origin only (scheme+host+port) — `base` may carry a sub-path (e.g. /widget),
  // but postMessage e.origin never includes a path, so compare against the origin.
  var baseOrigin = (function () {
    try {
      return new URL(base, window.location.href).origin;
    } catch (_) {
      return base;
    }
  })();
  var locale = String(cfg.locale || document.documentElement.lang || 'en').slice(0, 2);

  // ---- Traffic-source capture (UTM + referrer + landing) ---------------------
  // Read from the STORE page URL (the widget iframe can't see it) and forward on
  // the iframe src so the widget attributes analytics to the real source.
  function captureAttribution() {
    var out = [];
    try {
      var qs = new URLSearchParams(window.location.search);
      var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
      for (var i = 0; i < keys.length; i++) {
        var v = qs.get(keys[i]);
        if (v) out.push(keys[i] + '=' + encodeURIComponent(v.slice(0, 200)));
      }
      if (document.referrer) out.push('ivy_ref=' + encodeURIComponent(document.referrer.slice(0, 300)));
      out.push('ivy_land=' + encodeURIComponent(String(window.location.href).slice(0, 300)));
    } catch (_) {
      /* URL API unavailable — attribution is best-effort */
    }
    return out.join('&');
  }
  var attribution = captureAttribution();
  var ga4Id = cfg.ga4Id && /^G-[A-Z0-9]+$/i.test(cfg.ga4Id) ? cfg.ga4Id : '';

  // Shopify App Proxy subpath on the store (Partner dashboard → App setup → App
  // proxy). A storefront-relative fetch to it is signed by Shopify and carries a
  // verified logged_in_customer_id, letting the backend hand us a customer-bound
  // session token. Override with SHARPTALK_WIDGET_CONFIG.proxyPath if you use another.
  var proxyBase = String(cfg.proxyPath || '/apps/ivy').replace(/\/+$/, '');
  // ShopTalk API base (same origin as the widget by default). Cafe24 has no App
  // Proxy, so member sign-in runs through these public customer-auth endpoints.
  var apiBase = String(cfg.apiBase || baseOrigin + '/api/v1').replace(/\/+$/, '');
  // Storefront sign-in entrypoint. The login page + its return-URL parameter differ
  // per commerce platform, auto-detected from the storefront host so it works with
  // no per-mall config (cfg.loginPath / cfg.loginReturnParam still override, e.g. a
  // Cafe24 mall on a custom domain):
  //   Cafe24 classic mall (*.cafe24.com): /member/login.html?returnUrl=<page>
  //   Shopify (*.myshopify.com / other):  /account/login?return_url=<page>
  // Cafe24 has no credential-login API and its member session lives on the mall
  // origin (unreadable from this cross-origin iframe), so login must happen in the
  // top window here, then the reopen flag brings the widget back up (PLN-260807).
  var loginPath = String(cfg.loginPath || (isCafe24Host ? '/member/login.html' : '/account/login'));
  var loginReturnParam = String(
    cfg.loginReturnParam || (isCafe24Host ? 'returnUrl' : 'return_url'),
  );
  var identity = null; // resolved { authenticated, sessionToken } from the proxy
  var identityResolved = false; // the proxy answered (either way) — see below
  var widgetReady = false; // set once the widget iframe posts ivy:ready
  var authPopup = null; // the sign-in popup window, while one is in flight
  var authWatch = null; // interval id polling authPopup.closed
  var loginFinish = null; // resolver for the in-flight login, if any

  var CLOSED = { w: '96px', h: '96px' };
  // Which side the closed launcher sits on, and how big its frame must be
  // (PLN-260819 S4). The widget owns the setting and reports it; the loader owns
  // the box. Cached on the PARENT origin so the next visit places the frame
  // correctly on the first frame instead of sliding across after the widget
  // boots — the same trick the widget uses for the brand colour.
  var LAUNCHER_KEY = 'ivy:launcher:' + (shop || 'default');
  var launcher = (function () {
    try {
      var raw = localStorage.getItem(LAUNCHER_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && (parsed.position === 'left' || parsed.position === 'right') ? parsed : null;
    } catch (_) {
      return null;
    }
  })();

  function applyLauncher(next) {
    if (!next) return;
    launcher = next;
    applyFrame(next.frame);
    triggerMode = next.mode === 'trigger' || !!cfg.trigger;
    triggerOffset = Math.max(0, Math.min(240, Number(next.offsetTop) || 0));
    var px = Math.max(64, Math.min(160, Number(next.size) || 96)) + 'px';
    launcherSizePx = px;
    if (triggerFellBack) triggerMode = false;
    // Trigger mode: nothing to draw while closed, so the frame takes no room and
    // cannot intercept clicks on the page beneath it.
    CLOSED = triggerMode ? { w: '0px', h: '0px' } : { w: px, h: px };
    placeFrame();
    checkTrigger();
    if (next.position === 'left') {
      frame.style.left = '0';
      frame.style.right = 'auto';
    } else {
      frame.style.right = '0';
      frame.style.left = 'auto';
    }
    // Only resize while closed; mid-conversation the panel owns the box.
    if (frame.style.width !== OPEN.w) {
      frame.style.width = CLOSED.w;
      frame.style.height = CLOSED.h;
    }
    try {
      localStorage.setItem(LAUNCHER_KEY, JSON.stringify(next));
    } catch (_) {
      /* not remembering only costs a reposition on the next visit */
    }
  }
  // Must clear the panel's own width plus the gap it holds from the frame edge:
  // the panel is 404px at `right: 20px`, so anything under 424px clips it.
  // (PLN-260817 SI-6 — it was 420px against a 380px panel, with 20px to spare.)
  var OPEN = { w: 'min(444px, 100vw)', h: 'min(680px, 100vh)' };
  // Open-panel frame from the widget (PLN-260910 P2): the panel size is a tenant
  // setting, reported with the launcher and cached the same way. Bounded here
  // too — the loader never trusts a number it did not clamp.
  function applyFrame(f) {
    if (!f) return;
    var w = Math.max(400, Math.min(520, Number(f.w) || 444));
    var h = Math.max(560, Math.min(840, Number(f.h) || 680));
    OPEN = { w: 'min(' + w + 'px, 100vw)', h: 'min(' + h + 'px, 100vh)' };
  }
  if (launcher && launcher.frame) applyFrame(launcher.frame);

  // One-shot reopen flag: set when redirect-mode sign-in navigates the tab away,
  // consumed on the return visit so the widget reopens where the shopper left
  // off (sessionStorage = same tab only, which is exactly the redirect round trip).
  var REOPEN_KEY = 'ivy:reopen';
  function setReopenFlag(tab) {
    try {
      sessionStorage.setItem(REOPEN_KEY, tab);
    } catch (_) {
      /* storage unavailable — the shopper just reopens the widget manually */
    }
  }
  var reopenTab = (function () {
    // Leave it alone on a sign-in screen. The flag is one-shot and the login page
    // is the same origin, so reading it here is what made a successful sign-in
    // come back to a closed widget (REQ-260819 §2-1).
    if (signInScreen) return null;
    try {
      var v = sessionStorage.getItem(REOPEN_KEY);
      if (v) sessionStorage.removeItem(REOPEN_KEY);
      return v === 'orders' || v === 'chat' || v === 'notifications' ? v : null;
    } catch (_) {
      return null;
    }
  })();

  var frame = document.createElement('iframe');
  frame.id = 'ivy-talktalk-frame';
  frame.title = 'IVY USA Support';
  frame.setAttribute('allow', 'clipboard-write');
  frame.setAttribute('allowtransparency', 'true');
  // FE-L1: sandbox the widget iframe — grant only what it needs (its own
  // scripts, same-origin storage for the session, forms, popups for auth).
  frame.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox',
  );
  /**
   * The iframe URL is built at BOOT, not at script load: ShopTalk.init() can
   * change `shop`, `widgetUrl` and `locale`, and a src frozen before that would
   * send an init()-only install to the widget with no shop at all.
   */
  function frameSrc() {
    // Re-read from cfg so init()'s merge is reflected.
    var s0 = cfg.shop || shop;
    var l0 = String(cfg.locale || locale).slice(0, 2);
    var g0 = cfg.ga4Id && /^G-[A-Z0-9]+$/i.test(cfg.ga4Id) ? cfg.ga4Id : ga4Id;
    // AI agent code (PLN-260820): which persona answers sessions opened from
    // THIS page. Validated to the server's code shape; anything else is dropped
    // here so a malformed value degrades to the default agent, never a broken src.
    var a0 = String(cfg.agent || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(a0)) a0 = '';
    return (
      base +
      '/?embed=1&shop=' +
      encodeURIComponent(s0) +
      '&locale=' +
      encodeURIComponent(l0) +
      (a0 ? '&agent=' + encodeURIComponent(a0) : '') +
      (g0 ? '&ga4=' + encodeURIComponent(g0) : '') +
      (reopenTab ? '&reopen=' + encodeURIComponent(reopenTab) : '') +
      // The widget reports this to the API's embed allowlist. Browsers that expose
      // ancestorOrigins prefer their own answer over this one (PLN-260819 S1).
      '&parent=' + encodeURIComponent(window.location.origin) +
      // Phone-sized viewport: the widget keeps its close button even in trigger
      // mode, because a full-screen panel has no "outside" to click.
      (window.innerWidth < 640 ? '&compact=1' : '') +
      (attribution ? '&' + attribution : '')
    );
  }

  var s = frame.style;
  s.position = 'fixed';
  s.bottom = '0';
  s.right = '0';
  s.width = CLOSED.w;
  s.height = CLOSED.h;
  // Where the frame sits: bottom corner for the floating launcher, top-right
  // under the storefront header in trigger mode.
  function placeFrame() {
    if (triggerMode) {
      frame.style.top = triggerOffset + 'px';
      frame.style.bottom = 'auto';
    } else {
      frame.style.top = 'auto';
      frame.style.bottom = '0';
    }
    if (!isOpen) {
      frame.style.width = CLOSED.w;
      frame.style.height = CLOSED.h;
      frame.style.visibility = triggerMode ? 'hidden' : 'visible';
    }
  }
  if (triggerMode) CLOSED = { w: '0px', h: '0px' };
  placeFrame();
  s.border = '0';
  s.background = 'transparent';
  s.colorScheme = 'normal';
  s.zIndex = '2147483000';
  s.transition = 'width .2s ease, height .2s ease';

  function mount() {
    document.body.appendChild(frame);
  }

  /**
   * Put the frame on the page. Runs once, from whichever entry point comes
   * first: the legacy config-only install (bottom of this file) or ShopTalk.init().
   */
  function boot() {
    if (booted || signInScreen) return;
    booted = true;
    // `base` is resolved from cfg at load; if init() changed widgetUrl, honour it.
    if (cfg.widgetUrl) {
      base = String(cfg.widgetUrl).replace(/\/+$/, '');
      try {
        baseOrigin = new URL(base, window.location.href).origin;
      } catch (_) {
        baseOrigin = base;
      }
    }
    frame.src = frameSrc();
    if (launcher) applyLauncher(launcher);
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  function sendToWidget(msg) {
    if (frame.contentWindow) frame.contentWindow.postMessage(msg, base);
  }

  /**
   * Commands issued before the widget is listening.
   *
   * `open()` right after `init()` used to be dropped: the iframe had not loaded,
   * let alone mounted the React listener, so the postMessage went nowhere. The
   * widget announces itself with `ivy:ready`; until then commands wait here and
   * are replayed in order.
   */
  var commandQueue = [];
  function command(msg) {
    if (widgetReady) sendToWidget(msg);
    else commandQueue.push(msg);
  }
  function flushCommands() {
    var pending = commandQueue;
    commandQueue = [];
    for (var i = 0; i < pending.length; i++) sendToWidget(pending[i]);
  }

  // Report the proxy's answer to the widget, once both sides are ready: the proxy
  // has answered AND the widget has posted ivy:ready.
  //
  // The negative answer matters as much as the positive one. The widget boots much
  // faster than this round trip (storefront → Shopify → app), so without an
  // explicit "no customer" it cannot tell "still waiting" from "nobody is signed
  // in" — it used to give up and open a throwaway guest session on every page
  // load, which is where the chat thread went. Telling it either way lets it wait
  // for a verified session and only fall back to guest when there really is none.
  function maybeSendIdentity() {
    if (!widgetReady || !identityResolved || !frame.contentWindow) return;
    if (identity && identity.authenticated && identity.sessionToken) {
      sendToWidget({ type: 'ivy:session', token: identity.sessionToken });
    } else {
      sendToWidget({ type: 'ivy:identity', authenticated: false });
    }
  }

  // Ask the store (via the Shopify app proxy) whether a customer is logged in.
  // Resolves to the identity JSON, or null on any failure (proxy not set up,
  // logged-out, network). Never throws — callers treat null as anonymous.
  function fetchIdentity() {
    try {
      return fetch(proxyBase + '/identity?locale=' + encodeURIComponent(locale), {
        credentials: 'include',
        headers: { accept: 'application/json' },
      })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function stopAuthWatch() {
    if (authWatch) {
      clearInterval(authWatch);
      authWatch = null;
    }
    authPopup = null;
    loginFinish = null;
  }

  // Build the store's own login URL, returning the shopper to the current page
  // so this loader runs again in the popup. Every part is same-origin and
  // loader-derived — no caller/URL input flows in, so there's no open redirect.
  function buildLoginUrl() {
    // Return the shopper to the page they were on, so the reopen flag can bring the
    // widget back up on the orders tab. Only the platform-correct return param is
    // sent (Cafe24 classic wants `returnUrl`, not `return_to`); extra query, if any,
    // comes from cfg.loginExtraQuery.
    var returnTo = window.location.pathname + window.location.search;
    var url =
      window.location.origin +
      loginPath +
      (loginPath.indexOf('?') >= 0 ? '&' : '?') +
      loginReturnParam +
      '=' +
      encodeURIComponent(returnTo);
    if (cfg.loginExtraQuery) url += '&' + String(cfg.loginExtraQuery).replace(/^[?&]/, '');
    return url;
  }

  // Redirect-mode sign-in: navigate this whole tab to the store's login page.
  // Shopify's hosted login (New Customer Accounts) then returns the shopper to
  // the current page (`return_to`), where the identity handshake authenticates
  // the widget and the reopen flag brings it back up on the orders tab.
  function redirectToLogin() {
    // Cafe24 has no signed app-proxy identity, so a bare login to /member/login.html
    // would sign the shopper in on the mall but tell the widget nothing. Route through
    // the customer-auth flow instead: its authorize step handles the mall login when
    // needed, then the callback returns a one-time ticket the widget redeems (P-A2).
    if (isCafe24Host) {
      startCafe24Login();
      return;
    }
    setReopenFlag('orders');
    window.location.assign(buildLoginUrl());
  }

  // Begin Cafe24 member authentication: navigate the top window to the backend
  // start endpoint, which redirects to the mall's customer authorize. `return` is
  // the current page (fragment stripped) so the callback can bring us back here with
  // the sign-in ticket; the reopen flag reopens the widget on the orders tab.
  function startCafe24Login() {
    setReopenFlag('orders');
    var ret = window.location.href.split('#')[0];
    window.location.assign(
      apiBase +
        '/public/cafe24/customer-auth/start?shop=' +
        encodeURIComponent(window.location.hostname) +
        '&return=' +
        encodeURIComponent(ret),
    );
  }

  // Redeem a one-time Cafe24 sign-in ticket for a widget session token. Resolves to
  // true on success (identity set), false otherwise. Shared by the redirect-return
  // path and the popup path.
  function exchangeCafe24Ticket(ticket) {
    return fetch(apiBase + '/public/cafe24/customer-auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ticket: ticket }),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        // Unwrap the standard { success, data } envelope (or a bare body).
        var token = j && ((j.data && j.data.sessionToken) || j.sessionToken);
        if (token) {
          identity = { authenticated: true, sessionToken: token };
          return true;
        }
        return false;
      })
      .catch(function () {
        return false;
      });
  }

  // On return from a top-window Cafe24 sign-in, redeem the `#ivy_ticket`. Returns true
  // when a ticket was present. The ticket is stripped from the URL immediately so a
  // reload can't replay it (it is also one-time server-side).
  function consumeCafe24Ticket() {
    var m = /[#&]ivy_ticket=([^&]+)/.exec(window.location.hash || '');
    if (!m) return false;
    var ticket = decodeURIComponent(m[1]);
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (_) {
      /* history unavailable — the ticket is one-time server-side anyway */
    }
    exchangeCafe24Ticket(ticket).then(function () {
      identityResolved = true;
      maybeSendIdentity();
    });
    return true;
  }

  // In-widget sign-in: open the Cafe24 customer-auth in a popup so the storefront page
  // and the widget never navigate. The popup runs the mall login + authorize; its
  // callback posts the ticket back here (ivy:cafe24-ticket), which we redeem. Falls
  // back to a full-tab redirect when the popup is blocked.
  var cafe24TicketSeen = false;
  function openCafe24LoginPopup() {
    if (authPopup && !authPopup.closed) {
      authPopup.focus();
      return;
    }
    cafe24TicketSeen = false;
    var ret = window.location.href.split('#')[0];
    var url =
      apiBase +
      '/public/cafe24/customer-auth/start?mode=popup&shop=' +
      encodeURIComponent(window.location.hostname) +
      '&return=' +
      encodeURIComponent(ret);
    var w = 480;
    var h = 720;
    var x = Math.max(0, (window.outerWidth - w) / 2 + (window.screenX || 0));
    var y = Math.max(0, (window.outerHeight - h) / 2 + (window.screenY || 0));
    authPopup = window.open(
      url,
      'ivy_cafe24_auth',
      'width=' + w + ',height=' + h + ',left=' + Math.round(x) + ',top=' + Math.round(y),
    );
    if (!authPopup) {
      // Popup blocked — fall back to the full-tab flow so sign-in still works.
      startCafe24Login();
      return;
    }
    authWatch = setInterval(function () {
      if (!authPopup || authPopup.closed) {
        stopAuthWatch();
        // Closed without delivering a ticket → treat as cancelled.
        if (!cafe24TicketSeen) sendToWidget({ type: 'ivy:login-cancelled' });
      }
    }, 700);
  }

  // Open the sign-in popup and watch for its return. Called only in response to
  // an explicit ivy:login from our widget iframe (user clicked "Sign in").
  function openLoginPopup() {
    if (authPopup && !authPopup.closed) {
      authPopup.focus();
      return;
    }
    var w = 480;
    var h = 720;
    var x = Math.max(0, (window.outerWidth - w) / 2 + (window.screenX || 0));
    var y = Math.max(0, (window.outerHeight - h) / 2 + (window.screenY || 0));
    authPopup = window.open(
      buildLoginUrl(),
      'ivy_auth_popup',
      'width=' + w + ',height=' + h + ',left=' + Math.round(x) + ',top=' + Math.round(y),
    );
    if (!authPopup) {
      // Popup blocked — let the widget fall back to guest lookup gracefully.
      sendToWidget({ type: 'ivy:login-cancelled', reason: 'blocked' });
      return;
    }

    var resolved = false;
    loginFinish = function () {
      if (resolved) return;
      resolved = true;
      stopAuthWatch();
      // Re-resolve identity now that the customer may be logged in. One retry
      // absorbs cookie-propagation lag right after the OAuth callback.
      fetchIdentity()
        .then(function (j) {
          if (j && j.authenticated && j.sessionToken) return j;
          return new Promise(function (r) {
            setTimeout(r, 800);
          }).then(fetchIdentity);
        })
        .then(function (j) {
          if (j && j.authenticated && j.sessionToken) {
            identity = j;
            identityResolved = true;
            maybeSendIdentity();
          } else {
            // Popup closed without a completed sign-in (cancel, or not logged in).
            sendToWidget({ type: 'ivy:login-cancelled' });
          }
        })
        .catch(function () {
          sendToWidget({ type: 'ivy:login-cancelled' });
        });
    };

    // Fallback path: if the popup is closed without ever posting done (manual
    // close, or window.close blocked), resolve the same way.
    authWatch = setInterval(function () {
      if (!authPopup || authPopup.closed) loginFinish();
    }, 700);
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    // From the sign-in popup we opened (same-origin storefront page).
    if (d.type === 'ivy:auth-popup-done' && e.origin === window.location.origin) {
      if (loginFinish) loginFinish();
      return;
    }
    // Everything else must come from our widget iframe origin.
    if (e.origin !== baseOrigin) return;
    if (d.type === 'ivy:resize') {
      isOpen = !!d.open;
      if (isOpen) openedAt = Date.now();
      frame.style.width = d.open ? OPEN.w : CLOSED.w;
      frame.style.height = d.open ? OPEN.h : CLOSED.h;
      frame.style.visibility = !d.open && triggerMode ? 'hidden' : 'visible';
      emit(d.open ? 'open' : 'close', {});
    } else if (d.type === 'ivy:launcher') {
      applyLauncher({
        position: d.position,
        size: d.size,
        frame: d.frame,
        mode: d.mode,
        offsetTop: d.offsetTop,
      });
    } else if (d.type === 'ivy:unread') {
      setBadge(d.count);
      emit('unread', { count: Number(d.count) || 0 });
    } else if (d.type === 'ivy:ready') {
      widgetReady = true;
      maybeSendIdentity();
      flushCommands();
    } else if (d.type === 'ivy:login') {
      // Only the widget iframe may trigger sign-in. The widget forwards the
      // tenant-configured mode (console setting); anything but an explicit
      // 'popup' means redirect — the safer default (no popup blockers, and the
      // popup return leg doesn't fire when Shopify's hosted login keeps the
      // popup on shopify.com).
      if (e.source === frame.contentWindow) {
        if (isCafe24Host) {
          // Cafe24 supports both: popup keeps the storefront + widget in place;
          // redirect navigates the tab through the mall login. Honor the mode.
          if (d.mode === 'popup') openCafe24LoginPopup();
          else redirectToLogin();
        } else if (d.mode === 'popup') {
          openLoginPopup();
        } else {
          redirectToLogin();
        }
      }
    } else if (d.type === 'ivy:cafe24-ticket') {
      // The Cafe24 sign-in popup (served by our API origin) posts the one-time
      // ticket here. Redeem it, authenticate the widget, and close the popup — the
      // storefront page never navigated.
      cafe24TicketSeen = true;
      if (authPopup && !authPopup.closed) {
        try {
          authPopup.close();
        } catch (_) {
          /* ignore */
        }
      }
      stopAuthWatch();
      exchangeCafe24Ticket(d.ticket).then(function (ok) {
        identityResolved = true;
        if (ok) maybeSendIdentity();
        else sendToWidget({ type: 'ivy:login-cancelled' });
      });
    } else if (d.type === 'ivy:signin') {
      // Back-compat with widgets that predate the popup flow: the sandboxed
      // iframe cannot navigate the store page itself, so do it here. Uses the same
      // platform-configured login URL as the modern flow (not a hardcoded path).
      redirectToLogin();
    }
  });

  // Passive identity check on load: start authenticated if a customer is already
  // signed in. Any failure simply leaves the widget anonymous; never blocks render.
  // Either way we mark the question answered so the widget stops waiting.
  //
  // Skipped on a sign-in screen: there is no widget to answer, and asking would
  // spend a one-time sign-in ticket on a page that cannot use it.
  /**
   * Is the configured opener actually on this page?
   *
   * Checked repeatedly for a few seconds because storefront headers are often
   * rendered late (theme JS, a cart drawer, a framework hydration pass), and a
   * single check at boot would call a present element missing.
   */
  function triggerPresent() {
    if (!cfg.trigger) return false;
    try {
      return !!document.querySelector(String(cfg.trigger));
    } catch (_) {
      return false; // invalid selector — same outcome as a missing element
    }
  }
  var triggerChecks = 0;
  var triggerTimer = null;
  function checkTrigger() {
    if (!triggerMode || triggerFellBack || triggerPresent()) {
      if (triggerTimer) {
        clearTimeout(triggerTimer);
        triggerTimer = null;
      }
      return;
    }
    // No selector at all (theme switched the mode on, snippet never got the
    // `trigger` key): no element can appear later, so do not make shoppers wait.
    if (cfg.trigger && triggerChecks < 6) {
      triggerChecks++;
      if (!triggerTimer) {
        triggerTimer = setTimeout(function () {
          triggerTimer = null;
          checkTrigger();
        }, 600);
      }
      return;
    }
    // Give up and put the launcher back. The widget draws the button, so it has
    // to be told too — it cannot see the storefront from inside its iframe.
    triggerFellBack = true;
    triggerMode = false;
    CLOSED = { w: launcherSizePx, h: launcherSizePx };
    placeFrame();
    command({ type: 'ivy:command', action: 'trigger-missing' });
    if (window.console && console.warn) {
      console.warn(
        '[SharpTalk] launcher trigger ' +
          JSON.stringify(cfg.trigger || null) +
          ' was not found on this page — showing the floating launcher instead. ' +
          'Add the opener element to your theme, or switch the launcher mode back in the console.',
      );
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkTrigger);
  }

  // Storefront-side unread badge (trigger mode). Any element matching cfg.badge
  // (default `[data-sharptalk-badge]`) shows the count and hides at zero.
  function setBadge(count) {
    var n = Number(count) || 0;
    var sel = String(cfg.badge || '[data-sharptalk-badge]');
    var els;
    try {
      els = document.querySelectorAll(sel);
    } catch (_) {
      return;
    }
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = n > 99 ? '99+' : String(n);
      els[i].style.display = n > 0 ? '' : 'none';
    }
  }
  // Page-side opener: delegated, so a header rendered after this script still works.
  document.addEventListener('click', function (e) {
    if (!cfg.trigger || !e.target || !e.target.closest) return;
    var el;
    try {
      el = e.target.closest(String(cfg.trigger));
    } catch (_) {
      return;
    }
    if (!el) return;
    e.preventDefault();
    boot();
    // Explicit open/close rather than toggle: the loader already knows whether
    // the panel is open (it sizes the frame), and a toggle that is delivered
    // twice — a duplicated listener, a double-tap — lands on the wrong state.
    command({ type: 'ivy:command', action: isOpen ? 'close' : 'open' });
  });
  // Docked panel closes on a click outside it (the iframe swallows its own
  // clicks, so anything reaching the page is outside). Ignore the opener itself
  // and the first 300ms after opening so the opening click cannot also close it.
  document.addEventListener('pointerdown', function (e) {
    if (!triggerMode || !isOpen || Date.now() - openedAt < 300) return;
    if (cfg.trigger && e.target && e.target.closest) {
      try {
        if (e.target.closest(String(cfg.trigger))) return;
      } catch (_) {
        /* bad selector — treat as outside */
      }
    }
    command({ type: 'ivy:command', action: 'close' });
  });

  if (signInScreen) {
    /* nothing to resolve — nothing mounted */
  } else if (isCafe24Host) {
    // No app proxy on Cafe24 — identity arrives only via the customer-auth ticket on
    // the return leg. If there's no ticket, the shopper is simply anonymous.
    if (!consumeCafe24Ticket()) {
      identityResolved = true;
      maybeSendIdentity();
    }
  } else {
    fetchIdentity().then(function (j) {
      if (j && j.authenticated && j.sessionToken) identity = j;
      identityResolved = true;
      maybeSendIdentity();
    });
  }

  // --- Public API (PLN-260819 S3) -------------------------------------------
  //
  // Everything here is a thin wrapper over the postMessage protocol the loader
  // already speaks. The widget is the one that knows how to open a tab or call
  // the API; these methods just say when.

  /**
   * Explicit setup for host applications. Optional: a page that only sets
   * SHARPTALK_WIDGET_CONFIG (or the pre-rename IVY_WIDGET_CONFIG)
   * keeps booting on load exactly as before.
   *
   * Recognised keys mirror SHARPTALK_WIDGET_CONFIG (shop, widgetUrl, locale, ga4Id,
   * apiBase, loginPath, agent …). Calling it a second time is a no-op beyond
   * the queued-call drain, because the frame is already on the page.
   */
  api.init = function (options) {
    if (options && typeof options === 'object') {
      for (var k in options) {
        if (Object.prototype.hasOwnProperty.call(options, k)) cfg[k] = options[k];
      }
    }
    boot();
    return api;
  };

  api.open = function (tab) {
    boot();
    command({ type: 'ivy:command', action: 'open', tab: tab || null });
  };
  api.close = function () {
    boot();
    command({ type: 'ivy:command', action: 'close' });
  };
  api.toggle = function () {
    boot();
    command({ type: 'ivy:command', action: 'toggle' });
  };
  api.setLocale = function (next) {
    boot();
    command({ type: 'ivy:command', action: 'locale', locale: String(next || '').slice(0, 5) });
  };

  /**
   * Tell the widget who is signed in. `hash` is an HMAC of `userId` produced by
   * the host's OWN server — this loader never sees the secret, and a hash built
   * in the browser would prove nothing.
   */
  api.identify = function (user) {
    boot();
    if (!user || !user.userId || !user.hash) return;
    command({ type: 'ivy:identify', user: user });
  };

  api.logout = function () {
    boot();
    command({ type: 'ivy:command', action: 'logout' });
  };

  api.on = function (event, fn) {
    if (typeof fn !== 'function') return api;
    (listeners[event] = listeners[event] || []).push(fn);
    return api;
  };
  api.off = function (event, fn) {
    var fns = listeners[event];
    if (!fns) return api;
    listeners[event] = fns.filter(function (f) {
      return f !== fn;
    });
    return api;
  };

  api.version = '1';

  // Calls made before this script finished loading (the snippet may push onto
  // ShopTalk.q) are replayed in order, so a page never has to wait for us.
  for (var qi = 0; qi < queued.length; qi++) {
    var call = queued[qi];
    if (call && typeof api[call[0]] === 'function') {
      try {
        api[call[0]].apply(api, call.slice(1));
      } catch (_) {
        /* a bad queued call must not stop the rest */
      }
    }
  }

  // Config-first install: a page that configured the widget but never calls
  // init() still gets a widget, exactly as it did before this file grew an API.
  if (window.SHARPTALK_WIDGET_CONFIG || window.IVY_WIDGET_CONFIG) boot();
})();
