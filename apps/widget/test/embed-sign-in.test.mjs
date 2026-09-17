/**
 * The storefront loader must not mount on a sign-in screen (REQ-260819).
 *
 * These run the REAL `public/embed.js` — the exact file storefronts download —
 * inside a small DOM stub, rather than re-stating its path rules here. A copy of
 * the rule is what this repo already got burned by once: three copies of "host →
 * mall id" drifted apart and a mall ended up bound to the wrong tenant
 * (FIX-260819 §G-6).
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');

/**
 * Load embed.js against a stub storefront page.
 *
 * Returns what the assertions actually care about: whether an iframe reached the
 * document, and what is left in sessionStorage afterwards.
 */
function load({
  host = 'amoebaorder.cafe24.com',
  path = '/',
  config = {},
  windowName = '',
  reopen = null,
} = {}) {
  // A real install always sets IVY_WIDGET_CONFIG (or calls ShopTalk.init) — the
  // loader deliberately does nothing without one, so `{}` is the neutral case.
  const mounted = [];
  const storage = new Map();
  if (reopen) storage.set('ivy:reopen', reopen);

  const href = 'https://' + host + path;
  const win = {
    name: windowName,
    opener: null,
    IVY_WIDGET_CONFIG: config,
    location: {
      hostname: host,
      pathname: path,
      search: '',
      hash: '',
      href,
      origin: 'https://' + host,
      assign() {},
    },
    addEventListener() {},
    outerWidth: 1280,
    outerHeight: 800,
    screenX: 0,
    screenY: 0,
    open: () => null,
  };

  const ctx = {
    window: win,
    document: {
      referrer: '',
      documentElement: { lang: 'ko' },
      body: {
        appendChild(node) {
          mounted.push(node);
        },
      },
      getElementById: () => null,
      addEventListener() {},
      createElement: () => ({ style: {}, setAttribute() {} }),
      // A real install always has one: the loader derives the widget host from
      // its own <script src> when the snippet omits widgetUrl (FIX-260917).
      currentScript: { src: 'https://widget.example/widget/v1/embed.js' },
      getElementsByTagName: () => [],
    },
    sessionStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    history: { replaceState() {} },
    // Identity lookup is fire-and-forget and irrelevant to mounting; never let it
    // reach the network from a test.
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    URL,
    URLSearchParams,
    setTimeout,
    setInterval: () => 0,
    clearInterval() {},
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'embed.js' });

  return {
    // A getter, not a snapshot: tests that call into the SDK afterwards need to
    // see what happened AFTER the call.
    get mounted() {
      return mounted.length > 0;
    },
    reopenLeft: storage.get('ivy:reopen') ?? null,
    sdk: win.ShopTalk,
  };
}

test('T-1 no widget on the Cafe24 mall login page', () => {
  assert.equal(load({ path: '/member/login.html' }).mounted, false);
});

test('T-2 the login page leaves the reopen flag for the page the shopper returns to', () => {
  // The point of the whole requirement. The flag is one-shot: whoever reads it
  // first wins, and the login page must not be that reader — otherwise sign-in
  // succeeds and the shopper still comes back to a closed widget.
  const { reopenLeft } = load({ path: '/member/login.html', reopen: 'orders' });
  assert.equal(reopenLeft, 'orders');
});

test('T-2b an ordinary page still consumes it — the flag mechanism is real', () => {
  const { mounted, reopenLeft } = load({ path: '/product/detail.html', reopen: 'orders' });
  assert.equal(mounted, true);
  assert.equal(reopenLeft, null);
});

test('T-3 ordinary storefront pages still mount', () => {
  assert.equal(load({ path: '/' }).mounted, true);
  assert.equal(load({ path: '/product/detail.html' }).mounted, true);
  assert.equal(load({ path: '/myshop/order/list.html' }).mounted, true);
});

test('T-4 policy and profile pages keep the widget on purpose', () => {
  // These live under /member/ but nobody is signing in on them: a shopper reading
  // the refund policy is exactly who should be able to ask about it.
  for (const p of ['/member/mall_agreement.html', '/member/privacy.html', '/member/modify.html']) {
    assert.equal(load({ path: p }).mounted, true, p);
  }
});

test('T-5 no widget inside our own Cafe24 sign-in popup', () => {
  // Cafe24 sends the popup to the mall login page when the member is not signed
  // in, and that page runs this same script — inside a 480x720 popup.
  assert.equal(load({ path: '/member/login.html', windowName: 'ivy_cafe24_auth' }).mounted, false);
  assert.equal(load({ path: '/', windowName: 'ivy_cafe24_auth' }).mounted, false);
});

test('T-6 Shopify sign-in screens too — the flag is spent there the same way', () => {
  const host = 'ambshop-dev.myshopify.com';
  for (const p of ['/account/login', '/account/register', '/challenge']) {
    assert.equal(load({ host, path: p }).mounted, false, p);
  }
  assert.equal(load({ host, path: '/account' }).mounted, true);
  assert.equal(load({ host, path: '/products/lipstick' }).mounted, true);
});

test('T-7 a Cafe24 mall on a custom domain is recognised by its configured login path', () => {
  const cfg = { shop: 'shop.example.com', loginPath: '/member/login.html' };
  assert.equal(load({ host: 'shop.example.com', path: '/member/login.html', config: cfg }).mounted, false);
  // Without that hint the same host gets the default (Shopify-shaped) list.
  assert.equal(load({ host: 'shop.example.com', path: '/member/login.html' }).mounted, true);
});

test('T-8 hideOnPaths overrides the defaults, and [] turns the behaviour off', () => {
  assert.equal(load({ path: '/member/login.html', config: { hideOnPaths: [] } }).mounted, true);
  assert.equal(load({ path: '/signin', config: { hideOnPaths: ['/signin'] } }).mounted, false);
  // An override replaces the defaults rather than adding to them.
  assert.equal(load({ path: '/member/login.html', config: { hideOnPaths: ['/signin'] } }).mounted, true);
});

test('T-9 a locale-prefixed storefront still matches', () => {
  // Shopify markets serve /en-ca/account/login; Cafe24 multilingual skins do the
  // same shape. An anchored prefix alone would let these through.
  const host = 'ambshop-dev.myshopify.com';
  assert.equal(load({ host, path: '/en-ca/account/login' }).mounted, false);
  assert.equal(load({ host, path: '/ko/account/login' }).mounted, false);
  assert.equal(load({ path: '/ko/member/login.html' }).mounted, false);
  // Only ONE segment is dropped, and only a locale-shaped one.
  assert.equal(load({ host, path: '/collections/account/login' }).mounted, true);
});

test('T-10 the SDK surface still exists on a sign-in screen', () => {
  // Hiding must not mean "the script bailed out". A storefront that drives the
  // widget through ShopTalk.init() runs the same snippet on its login page, and
  // an early return would leave it calling a method on {}.
  const page = load({ path: '/member/login.html' });
  for (const m of ['init', 'open', 'close', 'on', 'off', 'logout']) {
    assert.equal(typeof page.sdk[m], 'function', m);
  }
  assert.equal(page.mounted, false);
});

test('T-11 init() and open() are inert on a sign-in screen', () => {
  const page = load({ path: '/member/login.html' });
  page.sdk.init({ shop: 'amoebaorder.cafe24.com' });
  page.sdk.open();
  assert.equal(page.mounted, false);
});
