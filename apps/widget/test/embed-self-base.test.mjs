/**
 * The loader must find the widget without being told where it is
 * (FIX-260917-Embed-Self-Base).
 *
 * The console's install snippet sets only `shop`. Before this, the loader fell
 * back to a hardcoded `https://widget.ivyusa.app` — a domain that never
 * shipped — so every store that pasted the snippet mounted an iframe pointing
 * at a name that does not resolve. Nothing threw; the widget just never
 * appeared. So the rule is now: a hosted loader knows its own address.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');

/** Run the real loader against a stub page and report the iframe URL it built. */
function mount({ scriptSrc = 'https://host.example/widget/v1/embed.js', config = {}, scripts } = {}) {
  const mounted = [];
  const doc = {
    referrer: '',
    documentElement: { lang: 'en' },
    body: { appendChild: (n) => mounted.push(n) },
    getElementById: () => null,
    addEventListener() {},
    createElement: () => ({ style: {}, setAttribute() {} }),
    getElementsByTagName: () => scripts ?? [],
  };
  if (scriptSrc !== null) doc.currentScript = { src: scriptSrc };

  const win = {
    name: '',
    opener: null,
    SHARPTALK_WIDGET_CONFIG: config,
    location: {
      hostname: 'shop.example',
      pathname: '/',
      search: '',
      href: 'https://shop.example/',
      origin: 'https://shop.example',
    },
    addEventListener() {},
    console: { error() {}, info() {}, warn() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const ctx = {
    window: win,
    document: doc,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { replaceState() {} },
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    URL,
    URLSearchParams,
    setTimeout,
    setInterval: () => 0,
    clearInterval() {},
    console: win.console,
  };
  ctx.window.window = ctx.window;
  ctx.window.document = doc;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const frame = mounted.find((n) => n && typeof n.src === 'string' && n.src.includes('embed=1'));
  return frame ? frame.src : null;
}

test('derives the widget host from its own script src', () => {
  const src = mount({ scriptSrc: 'https://host.example/widget/v1/embed.js', config: { shop: 's.myshopify.com' } });
  assert.ok(src, 'no iframe mounted');
  assert.ok(
    src.startsWith('https://host.example/widget/?'),
    `expected the widget base to be the loader's own directory, got ${src}`,
  );
});

test('the unversioned loader path resolves to the same base', () => {
  const src = mount({ scriptSrc: 'https://host.example/widget/embed.js', config: { shop: 's.myshopify.com' } });
  assert.ok(src.startsWith('https://host.example/widget/?'), src);
});

test('an explicit widgetUrl still wins — self-hosting may split the two', () => {
  const src = mount({
    scriptSrc: 'https://cdn.example/widget/v1/embed.js',
    config: { shop: 's.myshopify.com', widgetUrl: 'https://talk.mystore.com/widget' },
  });
  assert.ok(src.startsWith('https://talk.mystore.com/widget/?'), src);
});

test('never points at the dead default domain again', () => {
  // Comments stripped: the comment above selfBase() names the retired host on
  // purpose, to tell the next reader why the derivation exists. What must never
  // come back is the host as a VALUE.
  const code = SRC.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes('widget.ivyusa.app'), 'the retired fallback host is back in embed.js code');
});

test('falls back to the script tag when currentScript is unavailable', () => {
  // Older browsers and any loader executed from a callback have no
  // document.currentScript; the tag is still in the page.
  const src = mount({
    scriptSrc: null,
    scripts: [{ src: 'https://host.example/widget/v1/embed.js' }],
    config: { shop: 's.myshopify.com' },
  });
  assert.ok(src && src.startsWith('https://host.example/widget/?'), String(src));
});
