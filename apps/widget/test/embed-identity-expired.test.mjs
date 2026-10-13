/**
 * `ivy:event` in the storefront loader (PLN-261012 SG-03).
 *
 * The widget iframe has always posted `ivy:event` (`identified`), and the loader
 * dropped it — so a host could never learn that the signed identity it handed the
 * widget had lapsed. The loader now forwards `identity-expired` (and `identified`)
 * to `ShopTalk.on(...)`. These run the REAL `public/embed.js` against a stub page,
 * like embed-open-url.test.mjs, and pin the rules the forwarder must keep: only our
 * iframe, only the widget origin, only the named events.
 *
 * `embed-loader.spec.ts` (jest) fails on Windows as a baseline; these node tests are
 * the loader coverage that does run here.
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
      assign() {},
    },
    addEventListener: (type, fn) => type === 'message' && listeners.push(fn),
    open: () => null,
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
  const fromWidget = (data) => deliver({ origin: WIDGET_ORIGIN, source: frame.contentWindow, data });
  return { api: win.ShopTalk, frame, deliver, fromWidget };
}

test('identity-expired from the widget iframe reaches ShopTalk.on("identity-expired")', () => {
  const { api, fromWidget } = load();
  const seen = [];
  api.on('identity-expired', (payload) => seen.push(payload));

  fromWidget({ type: 'ivy:event', event: 'identity-expired' });

  assert.equal(seen.length, 1);
  // The loader runs in its own vm realm, so compare structure, not prototypes.
  assert.equal(JSON.stringify(seen[0]), '{}');
});

test('the host can unsubscribe with off()', () => {
  const { api, fromWidget } = load();
  const seen = [];
  const cb = () => seen.push(1);
  api.on('identity-expired', cb);
  api.off('identity-expired', cb);

  fromWidget({ type: 'ivy:event', event: 'identity-expired' });

  assert.equal(seen.length, 0);
});

test('every subscriber is called, and one that throws does not stop the rest', () => {
  const { api, fromWidget } = load();
  const seen = [];
  api.on('identity-expired', () => {
    throw new Error('host bug');
  });
  api.on('identity-expired', () => seen.push('second'));

  fromWidget({ type: 'ivy:event', event: 'identity-expired' });

  assert.deepEqual(seen, ['second']);
});

test('only the widget iframe may raise it — another frame or origin is ignored', () => {
  const { api, frame, deliver } = load();
  const seen = [];
  api.on('identity-expired', () => seen.push(1));

  // Right origin, wrong source (a sibling iframe spoofing the message).
  deliver({ origin: WIDGET_ORIGIN, source: {}, data: { type: 'ivy:event', event: 'identity-expired' } });
  // Right source, wrong origin.
  deliver({
    origin: 'https://evil.example',
    source: frame.contentWindow,
    data: { type: 'ivy:event', event: 'identity-expired' },
  });

  assert.equal(seen.length, 0);
});

test('identified is forwarded with its ok flag, for hosts that want to know a sign-in failed', () => {
  const { api, fromWidget } = load();
  const seen = [];
  api.on('identified', (p) => seen.push(p));

  fromWidget({ type: 'ivy:event', event: 'identified', ok: true });
  fromWidget({ type: 'ivy:event', event: 'identified', ok: false });
  fromWidget({ type: 'ivy:event', event: 'identified' });

  assert.equal(JSON.stringify(seen), JSON.stringify([{ ok: true }, { ok: false }, { ok: false }]));
});

test('events the loader does not name are not forwarded', () => {
  const { api, fromWidget } = load();
  const seen = [];
  for (const name of ['open', 'close', 'unread', 'identity-expired', 'identified', 'anything']) {
    api.on(name, () => seen.push(name));
  }

  fromWidget({ type: 'ivy:event', event: 'anything' });
  fromWidget({ type: 'ivy:event', event: 'open' }); // `open` is raised by ivy:resize, not by a widget event
  fromWidget({ type: 'ivy:event' });
  fromWidget({ type: 'ivy:event', event: { toString: () => 'identity-expired' } });

  assert.deepEqual(seen, []);
});

test('the new branch does not swallow the messages the loader already handled (resize, unread)', () => {
  const { api, fromWidget } = load();
  const seen = [];
  api.on('open', () => seen.push('open'));
  api.on('unread', (p) => seen.push(`unread:${p.count}`));

  fromWidget({ type: 'ivy:resize', open: true });
  fromWidget({ type: 'ivy:unread', count: 3 });

  assert.deepEqual(seen, ['open', 'unread:3']);
});
