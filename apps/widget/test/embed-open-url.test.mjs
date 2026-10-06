/**
 * `ivy:open-url` in the storefront loader (PLN-261001 V2).
 *
 * The sandboxed widget cannot navigate the host page, so it asks the loader to
 * open the partner portal's sign-in / registration page. These run the REAL
 * `public/embed.js` against a stub page and pin the three rules the handler
 * must keep: only the widget iframe may ask, only http(s) is followed, and the
 * tenant's login mode picks redirect vs popup.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');
const WIDGET_ORIGIN = 'https://widget.example';

/** Load embed.js on a stub storefront and capture its window message listener. */
function load() {
  const listeners = [];
  const assigned = [];
  const opened = [];
  const frames = [];
  const win = {
    name: '',
    opener: null,
    IVY_WIDGET_CONFIG: { shop: 'partner.example.com' },
    location: {
      hostname: 'partner.example.com',
      pathname: '/',
      search: '',
      hash: '',
      href: 'https://partner.example.com/',
      origin: 'https://partner.example.com',
      assign: (url) => assigned.push(url),
    },
    addEventListener: (type, fn) => type === 'message' && listeners.push(fn),
    open: (url, target, features) => {
      opened.push({ url, target, features });
      return null;
    },
    outerWidth: 1280,
    outerHeight: 800,
    screenX: 0,
    screenY: 0,
  };
  const ctx = {
    window: win,
    document: {
      referrer: '',
      documentElement: { lang: 'vi' },
      body: { appendChild() {} },
      getElementById: () => null,
      addEventListener() {},
      createElement: (tag) => {
        const el = { tagName: tag, style: {}, setAttribute() {}, contentWindow: {} };
        if (tag === 'iframe') frames.push(el);
        return el;
      },
      currentScript: { src: `${WIDGET_ORIGIN}/widget/v1/embed.js` },
      getElementsByTagName: () => [],
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { replaceState() {} },
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

  const frame = frames[0];
  assert.ok(frame, 'the loader created its iframe');
  const deliver = (event) => listeners.forEach((fn) => fn(event));
  return { frame, deliver, assigned, opened };
}

const URL_OK = 'https://ha.example.com/sign-in';

test('the widget iframe can send the tab to the partner sign-in page', () => {
  const { frame, deliver, assigned, opened } = load();
  deliver({
    origin: WIDGET_ORIGIN,
    source: frame.contentWindow,
    data: { type: 'ivy:open-url', url: URL_OK },
  });
  assert.deepEqual(assigned, [URL_OK]);
  assert.equal(opened.length, 0);
});

test('popup mode opens a window instead of navigating', () => {
  const { frame, deliver, assigned, opened } = load();
  deliver({
    origin: WIDGET_ORIGIN,
    source: frame.contentWindow,
    data: { type: 'ivy:open-url', url: URL_OK, mode: 'popup' },
  });
  assert.equal(assigned.length, 0);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, URL_OK);
  assert.match(String(opened[0].features), /noopener/);
});

test('only the widget iframe may ask — another frame or origin is ignored', () => {
  const { frame, deliver, assigned, opened } = load();
  // Right origin, wrong source (a sibling iframe spoofing the message).
  deliver({ origin: WIDGET_ORIGIN, source: {}, data: { type: 'ivy:open-url', url: URL_OK } });
  // Right source, wrong origin.
  deliver({
    origin: 'https://evil.example',
    source: frame.contentWindow,
    data: { type: 'ivy:open-url', url: URL_OK },
  });
  assert.equal(assigned.length, 0);
  assert.equal(opened.length, 0);
});

test('only http(s) is followed — javascript: and relative URLs go nowhere', () => {
  const { frame, deliver, assigned, opened } = load();
  for (const url of ['javascript:alert(1)', '/relative', 'data:text/html,hi', '', undefined]) {
    deliver({
      origin: WIDGET_ORIGIN,
      source: frame.contentWindow,
      data: { type: 'ivy:open-url', url },
    });
  }
  assert.equal(assigned.length, 0);
  assert.equal(opened.length, 0);
});
