/**
 * The closed frame follows the widget's greeting pill (PLN-261019 P2).
 *
 * While the pill shows beside the launcher the widget reports a wider closed
 * box; when it goes, the box shrinks back to the launcher square. The loader
 * clamps both and never remembers the wide one — a cached wide frame would
 * cover page content before the widget had said anything (FIX-260916 class).
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');
const WIDGET_ORIGIN = 'https://host.example';

function mount() {
  const mounted = [];
  const handlers = {};
  const stored = {};
  const doc = {
    referrer: '',
    readyState: 'complete',
    documentElement: { lang: 'en' },
    body: { appendChild: (n) => mounted.push(n) },
    getElementById: () => null,
    querySelector: () => null,
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
    SHARPTALK_WIDGET_CONFIG: { shop: 's.myshopify.com' },
    location: { hostname: 'shop.example', pathname: '/', search: '', href: 'https://shop.example/', origin: 'https://shop.example' },
    addEventListener(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    console: { error() {}, info() {}, warn() {} },
    localStorage: {
      getItem: (k) => (k in stored ? stored[k] : null),
      setItem: (k, v) => {
        stored[k] = String(v);
      },
      removeItem: (k) => {
        delete stored[k];
      },
    },
  };
  const ctx = {
    window: win,
    document: doc,
    // The loader reads the bare global, not window.localStorage.
    localStorage: win.localStorage,
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
  const launcher = (closed) => ({
    type: 'ivy:launcher', position: 'right', size: 96, mode: 'floating', offsetTop: 0, trigger: null,
    frame: { w: 444, h: 680 }, ...(closed ? { closed } : {}),
  });
  return { frame, send, stored, launcher };
}

test('a report without a closed box keeps the launcher square (older widgets)', () => {
  const { frame, send, launcher } = mount();
  send(launcher());
  assert.equal(frame.style.width, '96px');
  assert.equal(frame.style.height, '96px');
});

test('the pill widens the closed frame and its dismissal narrows it again', () => {
  const { frame, send, launcher } = mount();
  send(launcher({ w: 360, h: 96 }));
  assert.equal(frame.style.width, '360px');
  assert.equal(frame.style.height, '96px');
  send(launcher({ w: 96, h: 96 }));
  assert.equal(frame.style.width, '96px');
});

test('the closed box is clamped: never narrower than the button, never wider than the cap', () => {
  const { frame, send, launcher } = mount();
  send(launcher({ w: 10, h: 10 }));
  assert.equal(frame.style.width, '96px');
  assert.equal(frame.style.height, '96px');
  send(launcher({ w: 9999, h: 9999 }));
  assert.equal(frame.style.width, '360px');
  assert.equal(frame.style.height, '160px');
});

test('the wide closed box is not remembered across page loads', () => {
  const { send, stored, launcher } = mount();
  send(launcher({ w: 360, h: 96 }));
  const cached = JSON.parse(stored['ivy:launcher:s.myshopify.com']);
  assert.equal(cached.closed, undefined);
  assert.equal(cached.size, 96);
});

test('an open panel ignores the closed box entirely', () => {
  const { frame, send, launcher } = mount();
  send({ type: 'ivy:resize', open: true });
  send(launcher({ w: 360, h: 96 }));
  assert.equal(frame.style.width, 'min(444px, 100vw)');
});
