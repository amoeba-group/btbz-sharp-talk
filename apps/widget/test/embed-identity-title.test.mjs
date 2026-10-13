/**
 * Identity probe and iframe title are configurable (PLN-261012 SG-82).
 *
 * The loader used to ask `/apps/ivy/identity` on EVERY page it was installed on.
 * That path exists only behind a Shopify App Proxy, so on a Hotel Admin (or any
 * non-Shopify host) it was a guaranteed 404 — sent with cookies, on every page
 * load, and one more `connect-src 'self'` a strict CSP had to allow for nothing.
 * The iframe title was likewise hard-coded to "IVY USA Support".
 *
 * These run the real loader in a vm sandbox. The Windows-baseline-failing
 * `embed-loader.spec.ts` (jest, CRLF-sensitive string checks) is NOT what covers
 * this: behaviour is asserted here instead.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');

/** Run the real loader against a stub page; report the fetches and the iframe. */
function load({ config, shopify = false, hostname = 'admin.hotel.example', init } = {}) {
  const fetches = [];
  const messages = [];
  const handlers = [];
  const mounted = [];
  const doc = {
    referrer: '',
    documentElement: { lang: 'vi' },
    body: { appendChild: (n) => mounted.push(n) },
    getElementById: () => null,
    addEventListener() {},
    createElement: () => ({
      style: {},
      setAttribute() {},
      contentWindow: { postMessage: (m) => messages.push(m) },
    }),
    getElementsByTagName: () => [],
    currentScript: { src: 'https://talk.example/widget/v1/embed.js' },
  };
  const win = {
    name: '',
    opener: null,
    location: {
      hostname,
      pathname: '/dashboard',
      search: '',
      href: `https://${hostname}/dashboard`,
      origin: `https://${hostname}`,
    },
    addEventListener: (type, fn) => type === 'message' && handlers.push(fn),
    console: { error() {}, info() {}, warn() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  if (config) win.SHARPTALK_WIDGET_CONFIG = config;
  if (shopify) win.Shopify = { shop: 'x.myshopify.com' };
  const ctx = {
    window: win,
    document: doc,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { replaceState() {} },
    fetch: (url, opts) => {
      fetches.push({ url: String(url), opts });
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    },
    URL,
    URLSearchParams,
    setTimeout,
    setInterval: () => 0,
    clearInterval() {},
    console: win.console,
  };
  win.window = win;
  win.document = doc;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  if (init) win.SharpTalk.init(init);
  const frame = mounted.find((n) => n && n.id === 'ivy-talktalk-frame') ?? null;
  const widgetReady = () =>
    handlers.forEach((h) =>
      h({ origin: 'https://talk.example', source: frame?.contentWindow, data: { type: 'ivy:ready' } }),
    );
  // Everything the loader fetched except the server-side visibility check.
  const identityFetches = () => fetches.filter((f) => !/\/public\/widget\/visibility/.test(f.url));
  return { fetches, identityFetches, messages, frame, widgetReady, win };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test('a non-Shopify host makes NO identity request by default', async () => {
  const h = load({ config: { shop: 'go2joy' } });
  await tick();
  assert.deepEqual(h.identityFetches(), []);
});

test('…and still tells the widget nobody is signed in, so it stops waiting', async () => {
  const h = load({ config: { shop: 'go2joy' } });
  await tick();
  h.widgetReady();
  assert.ok(
    h.messages.some((m) => m.type === 'ivy:identity' && m.authenticated === false),
    'the widget must receive an explicit anonymous answer',
  );
});

test('a Shopify storefront keeps probing the App Proxy exactly as before', async () => {
  const h = load({ config: { shop: 's.myshopify.com' }, shopify: true, hostname: 'store.example' });
  await tick();
  assert.equal(h.identityFetches().length, 1);
  assert.equal(h.identityFetches()[0].url, '/apps/ivy/identity?locale=vi');
  assert.equal(h.identityFetches()[0].opts.credentials, 'include');
});

test('a *.myshopify.com host counts as Shopify even without the global', async () => {
  const h = load({ config: { shop: 's' }, hostname: 'amoeba.myshopify.com' });
  await tick();
  assert.equal(h.identityFetches().length, 1);
});

test('proxyPath still names a custom App Proxy subpath (and enables the probe)', async () => {
  const h = load({ config: { shop: 's', proxyPath: '/apps/custom/' } });
  await tick();
  assert.equal(h.identityFetches()[0].url, '/apps/custom/identity?locale=vi');
});

test('identityPath points the probe at the host\'s own endpoint', async () => {
  const h = load({ config: { shop: 'go2joy', identityPath: '/api/whoami' } });
  await tick();
  assert.equal(h.identityFetches()[0].url, '/api/whoami?locale=vi');
  const q = load({ config: { shop: 'go2joy', identityPath: '/api/whoami?v=2' } });
  await tick();
  assert.equal(q.identityFetches()[0].url, '/api/whoami?v=2&locale=vi');
});

test('identityProbe:false silences even a Shopify page; identityProbe:true forces it elsewhere', async () => {
  const off = load({ config: { shop: 's', identityProbe: false }, shopify: true });
  await tick();
  assert.deepEqual(off.identityFetches(), []);
  const on = load({ config: { shop: 'go2joy', identityProbe: true } });
  await tick();
  assert.equal(on.identityFetches()[0].url, '/apps/ivy/identity?locale=vi');
});

test('the visibility check is unaffected', async () => {
  const h = load({ config: { shop: 'go2joy' } });
  await tick();
  assert.ok(h.fetches.some((f) => f.url.startsWith('https://talk.example/api/v1/public/widget/visibility?shop=go2joy')));
});

test('the iframe title defaults to the shipped wording', () => {
  assert.equal(load({ config: { shop: 'x' } }).frame.title, 'IVY USA Support');
});

test('title from SHARPTALK_WIDGET_CONFIG names the iframe', () => {
  assert.equal(load({ config: { shop: 'x', title: 'Go2Joy hỗ trợ' } }).frame.title, 'Go2Joy hỗ trợ');
});

test('title passed to init() is applied at boot (init merges after the frame exists)', () => {
  const h = load({ init: { shop: 'x', title: 'Go2Joy Support' } });
  assert.equal(h.frame.title, 'Go2Joy Support');
});

test('an over-long title is cut, not trusted', () => {
  assert.equal(load({ config: { shop: 'x', title: 'a'.repeat(500) } }).frame.title.length, 120);
});
