/**
 * The docked frame has to fit the window it hangs in (FIX-260920).
 *
 * Trigger mode starts the frame `offsetTop` down the page, but the open box was
 * still `min(<frame>px, 100vh)` — so a 68px offset pushed the bottom 68px past
 * the window, the panel looked unrelated to the window height, and the composer
 * went off-screen. The fix reserves the offset (plus the bit of breathing room
 * the panel's own gutter does not already provide) and leaves floating alone.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');
const WIDGET_ORIGIN = 'https://host.example';

/**
 * Boot the real loader against a stub page and hand back the iframe's inline
 * style plus a way to post the widget's own messages at it.
 */
function mount({ config = { shop: 's.myshopify.com', trigger: '#st-bell' }, hasTrigger = true } = {}) {
  const mounted = [];
  const handlers = {};
  const doc = {
    referrer: '',
    readyState: 'complete',
    documentElement: { lang: 'en' },
    body: { appendChild: (n) => mounted.push(n) },
    getElementById: () => null,
    // The storefront's opener. Without it the loader falls back to the floating
    // launcher on purpose (FIX-260916), which is a different geometry entirely.
    querySelector: (sel) => (hasTrigger && sel === '#st-bell' ? { tagName: 'BUTTON' } : null),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => ({ style: {}, setAttribute() {} }),
    getElementsByTagName: () => [],
    currentScript: { src: `${WIDGET_ORIGIN}/widget/embed.js` },
  };
  const win = {
    name: '',
    opener: null,
    innerWidth: 1280,
    SHARPTALK_WIDGET_CONFIG: config,
    location: {
      hostname: 'shop.example',
      pathname: '/',
      search: '',
      href: 'https://shop.example/',
      origin: 'https://shop.example',
    },
    addEventListener(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
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
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    console: win.console,
  };
  ctx.window.window = ctx.window;
  ctx.window.document = doc;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);

  const frame = mounted.find((n) => n && typeof n.src === 'string' && n.src.includes('embed=1'));
  assert.ok(frame, 'no iframe mounted');
  const send = (data, origin = WIDGET_ORIGIN) => {
    for (const fn of handlers.message || []) fn({ data, origin, source: null });
  };
  return { frame, send };
}

/** The widget reports its geometry, then the panel opens — the usual order. */
function openDocked({ offsetTop = 68, frameBox = { w: 420, h: 800 } } = {}) {
  const { frame, send } = mount();
  send({ type: 'ivy:launcher', position: 'right', size: 96, mode: 'trigger', offsetTop, trigger: '#st-bell', frame: frameBox });
  send({ type: 'ivy:resize', open: true });
  return { frame, send };
}

test('the docked frame reserves the header offset it starts below', () => {
  const { frame } = openDocked({ offsetTop: 68 });
  assert.equal(frame.style.top, '68px');
  // 68 offset + 5: the panel holds the other 20px of the 25px bottom gap itself.
  assert.equal(frame.style.height, 'min(800px, calc(100vh - 73px))');
  assert.equal(frame.style.width, 'min(420px, 100vw)');
});

test('a taller offset reserves more, not less', () => {
  const { frame } = openDocked({ offsetTop: 140 });
  assert.equal(frame.style.height, 'min(800px, calc(100vh - 145px))');
});

test('floating keeps the full window height', () => {
  const { frame, send } = mount({ config: { shop: 's.myshopify.com' }, hasTrigger: false });
  send({
    type: 'ivy:launcher',
    position: 'right',
    size: 96,
    mode: 'floating',
    offsetTop: 0,
    trigger: null,
    frame: { w: 444, h: 680 },
  });
  send({ type: 'ivy:resize', open: true });
  assert.equal(frame.style.height, 'min(680px, 100vh)');
  assert.equal(frame.style.top, 'auto');
});

test('an open panel follows a later theme change instead of collapsing', () => {
  // The old guard asked "is the inline width still the OPEN string?" to decide
  // whether the panel was closed. Recomputing OPEN made that question answer
  // "no" for an OPEN panel, which shut it mid-conversation.
  const { frame, send } = openDocked({ offsetTop: 68 });
  send({
    type: 'ivy:launcher',
    position: 'right',
    size: 96,
    mode: 'trigger',
    offsetTop: 120,
    trigger: '#st-bell',
    frame: { w: 420, h: 800 },
  });
  assert.equal(frame.style.height, 'min(800px, calc(100vh - 125px))');
  assert.notEqual(frame.style.width, '0px');
});

test('the card geometry is not hidden behind a viewport media query', () => {
  // The root cause: `.ivy-panel-desktop` (panel size + corner radius) sat inside
  // `@media (min-width: 640px)`, and inside the loader's iframe the viewport IS
  // the frame — 420px for a 380px panel, 520px at the largest panel a tenant can
  // set. The query never matched on a storefront, so every embed rendered the
  // mobile sheet: full bleed, square corners, configured size ignored.
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const rule = css.indexOf('.ivy-panel-desktop');
  assert.ok(rule > 0, '.ivy-panel-desktop is gone — did the class get renamed?');
  const opensBefore = (css.slice(0, rule).match(/@media[^{]*\{/g) || []).length;
  const closesBefore = (css.slice(0, rule).match(/\}/g) || []).length;
  assert.ok(
    opensBefore <= closesBefore,
    '.ivy-panel-desktop is inside a media query again — the page width the widget can see is its own iframe, not the store',
  );
});
