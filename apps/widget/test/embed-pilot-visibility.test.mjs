/**
 * `ivy:visibility` in the storefront loader — the REVERSIBLE hide/show for the pilot
 * allowlist (PLN-261012 SG-40).
 *
 * `hideFrame()` (the exposure restriction) removes the iframe for good. A host that
 * switches hotel has to be able to bring the widget back, so the pilot uses a second
 * mechanism that only toggles `display` and leaves the frame — and its running widget —
 * alone. These run the REAL `public/embed.js` against a stub page and pin: only our own
 * iframe may say it, it is reversible, an older widget (which never says anything) and
 * an older loader (which ignores the message) both keep working, and the frame is held
 * hidden only when the server said the tenant keeps a pilot list.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');
const WIDGET_ORIGIN = 'https://widget.example';

/**
 * Load embed.js on a stub storefront.
 *
 * @param visibility body of GET /public/widget/visibility (the loader unwraps `data`)
 * @param stored     localStorage contents before the page loads
 */
function load({ visibility = { visible: true, restricted: false }, stored = {} } = {}) {
  const listeners = [];
  const frames = [];
  const removed = [];
  const timers = [];
  const storage = new Map(Object.entries(stored));

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
      body: {
        appendChild(node) {
          node.parentNode = {
            removeChild(n) {
              n.parentNode = null;
              removed.push(n);
            },
          };
        },
      },
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
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    history: { replaceState() {} },
    // The loader asks the visibility endpoint; everything else (the identity probe) fails quietly.
    fetch: (url) =>
      String(url).includes('/public/widget/visibility')
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ data: visibility }) })
        : Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    URL,
    URLSearchParams,
    // Captured, not real: the fail-open timer must be firable on demand, and a pending
    // real 10 s timer would hold the test run open.
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      if (t) t.cleared = true;
    },
    setInterval: () => 0,
    clearInterval() {},
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'embed.js' });

  const frame = frames[0];
  assert.ok(frame, 'the loader created its iframe');
  const deliver = (data, over = {}) =>
    listeners.forEach((fn) => fn({ origin: WIDGET_ORIGIN, source: frame.contentWindow, data, ...over }));
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const holdTimer = () => timers.find((t) => t.ms === 10000);
  return { frame, deliver, flush, removed, storage, win, holdTimer, sdk: win.ShopTalk };
}

const verdict = (visible, extra = {}) => ({ type: 'ivy:visibility', visible, ...extra });

test('hides the frame when the widget says the visitor is not served — without removing it', async () => {
  const { frame, deliver, removed } = load();
  deliver(verdict(false, { reason: 'pilot', mode: 'hide' }));
  assert.equal(frame.style.display, 'none');
  assert.equal(removed.length, 0, 'the iframe is still on the page, still running');
  assert.ok(frame.parentNode, 'still attached');
});

test('is REVERSIBLE: the same widget can show it again (a hotel switch in the host app)', () => {
  const { frame, deliver } = load();
  deliver(verdict(false, { reason: 'pilot', mode: 'hide' }));
  assert.equal(frame.style.display, 'none');
  deliver(verdict(true));
  assert.equal(frame.style.display, '', 'display is cleared, not set to "block" — the page keeps its own default');
  deliver(verdict(false, { reason: 'pilot', mode: 'hide' }));
  assert.equal(frame.style.display, 'none');
});

test('a note keeps the frame on the page — the launcher stays, the panel shows the notice', () => {
  const { frame, deliver } = load();
  deliver(verdict(true, { reason: 'pilot', mode: 'notice' }));
  assert.equal(frame.style.display, '');
});

test('only OUR iframe may say it: another frame, or another origin, is ignored', () => {
  const { frame, deliver } = load();
  deliver(verdict(false), { source: {} }); // right origin, a sibling frame
  deliver(verdict(false), { origin: 'https://evil.example' }); // right frame, wrong origin
  assert.equal(frame.style.display, undefined);
});

test('a message that is not a boolean verdict changes nothing', () => {
  const { frame, deliver } = load();
  for (const visible of ['false', 0, null, undefined, {}]) deliver({ type: 'ivy:visibility', visible });
  assert.equal(frame.style.display, undefined);
});

test('does not touch `visibility` — the launcher/size code owns that property', () => {
  const { frame, deliver } = load();
  frame.style.visibility = 'visible';
  deliver(verdict(false));
  assert.equal(frame.style.visibility, 'visible');
});

test('tells the host page through ShopTalk.on("visibility"), once per change', () => {
  const { deliver, sdk } = load();
  const seen = [];
  sdk.on('visibility', (e) => seen.push(e));
  deliver(verdict(true)); // first verdict, announced
  deliver(verdict(true)); // repeat, silent
  deliver(verdict(false, { reason: 'pilot', mode: 'hide' }));
  deliver(verdict(false, { reason: 'pilot', mode: 'hide' })); // repeat, silent
  deliver(verdict(true));
  assert.deepEqual(
    seen.map((e) => e.visible),
    [true, false, true],
  );
  // Objects built inside the vm context have another realm's prototype; compare by value.
  assert.deepEqual(JSON.parse(JSON.stringify(seen[1])), { visible: false, reason: 'pilot', mode: 'hide' });
  assert.deepEqual(JSON.parse(JSON.stringify(seen[0])), { visible: true, reason: null, mode: null });
});

test('a change of reason or mode with the same visibility is still announced (shown, then shown with a notice)', () => {
  const { deliver, sdk } = load();
  const seen = [];
  sdk.on('visibility', (e) => seen.push(JSON.parse(JSON.stringify(e))));
  deliver(verdict(true));
  deliver(verdict(true, { reason: 'pilot', mode: 'notice' }));
  deliver(verdict(true, { reason: 'pilot', mode: 'notice' })); // repeat, silent
  assert.deepEqual(seen, [
    { visible: true, reason: null, mode: null },
    { visible: true, reason: 'pilot', mode: 'notice' },
  ]);
});

test('a handler that throws does not break the loader or the other handlers', () => {
  const { frame, deliver, sdk } = load();
  let second = 0;
  sdk.on('visibility', () => {
    throw new Error('bad host handler');
  });
  sdk.on('visibility', () => second++);
  deliver(verdict(false));
  assert.equal(second, 1);
  assert.equal(frame.style.display, 'none');
});

test('holds the frame hidden when the server says the tenant keeps a pilot list, until the widget answers', async () => {
  const { frame, deliver, flush, storage } = load({ visibility: { visible: true, restricted: false, pilot: { enabled: true } } });
  await flush();
  assert.equal(frame.style.display, 'none', 'hidden until the verdict');
  assert.equal(storage.get('st:pilot:partner.example.com'), '1', 'remembered, so the next visit does not flash');

  deliver(verdict(true)); // this visitor may be served
  assert.equal(frame.style.display, '');
});

test('stays hidden when the verdict is "not served", and the widget can still bring it back', async () => {
  const { frame, deliver, flush } = load({ visibility: { visible: true, restricted: false, pilot: { enabled: true } } });
  await flush();
  deliver(verdict(false, { reason: 'pilot', mode: 'hide' }));
  assert.equal(frame.style.display, 'none');
  deliver(verdict(true)); // the host identified a pilot hotel
  assert.equal(frame.style.display, '');
});

test('a verdict that arrives BEFORE the server hint is not undone by it', async () => {
  const { frame, deliver, flush } = load({ visibility: { visible: true, restricted: false, pilot: { enabled: true } } });
  deliver(verdict(true)); // the widget was quicker than the visibility endpoint
  await flush();
  assert.equal(frame.style.display, '');
});

test('a repeat visit starts hidden from the remembered flag, before any request returns', () => {
  const { frame } = load({ stored: { 'st:pilot:partner.example.com': '1' } });
  assert.equal(frame.style.display, 'none');
});

test('the remembered flag is cleared when the tenant stops using a pilot list', async () => {
  const { storage, flush } = load({
    visibility: { visible: true, restricted: false, pilot: { enabled: false } },
    stored: { 'st:pilot:partner.example.com': '1' },
  });
  await flush();
  assert.equal(storage.has('st:pilot:partner.example.com'), false);
});

test('fails OPEN: a widget that never answers (older build) is shown after a while, not hidden forever', async () => {
  const { frame, flush, holdTimer } = load({ visibility: { visible: true, restricted: false, pilot: { enabled: true } } });
  await flush();
  assert.equal(frame.style.display, 'none');
  const timer = holdTimer();
  assert.ok(timer, 'a fail-open timer was armed');
  timer.fn();
  assert.equal(frame.style.display, '', 'revealed — the server refuses non-pilot hotels on every turn regardless');
});

test('the fail-open timer is cancelled once the widget has answered', async () => {
  const { deliver, flush, holdTimer } = load({ visibility: { visible: true, restricted: false, pilot: { enabled: true } } });
  await flush();
  const timer = holdTimer();
  deliver(verdict(false));
  assert.equal(timer.cleared, true);
});

test('a tenant with no pilot list is untouched: nothing hides, nothing is remembered, no timer', async () => {
  for (const visibility of [
    { visible: true, restricted: false },
    { visible: true, restricted: false, pilot: { enabled: false } },
  ]) {
    const { frame, flush, storage, holdTimer } = load({ visibility });
    await flush();
    assert.equal(frame.style.display, undefined);
    assert.equal(storage.has('st:pilot:partner.example.com'), false);
    assert.equal(holdTimer(), undefined);
  }
});

test('an older widget that never posts ivy:visibility leaves a pilot-less install exactly as before', async () => {
  const { frame, flush } = load();
  await flush();
  assert.equal(frame.style.display, undefined);
});

test('the exposure restriction still removes the frame for good — and a later verdict cannot resurrect it', async () => {
  const { frame, deliver, flush, removed } = load({ visibility: { visible: false, restricted: true } });
  await flush();
  assert.equal(removed.length, 1, 'removed by hideFrame()');
  assert.equal(frame.parentNode, null);
  deliver(verdict(true));
  assert.equal(frame.style.display, undefined, 'the pilot code does not touch a frame the restriction removed');
});

test('it is a small, additive protocol: the old messages still work next to it', () => {
  const { frame, deliver } = load();
  deliver({ type: 'ivy:resize', open: true });
  assert.notEqual(frame.style.width, undefined);
  deliver(verdict(false));
  deliver({ type: 'ivy:resize', open: false });
  assert.equal(frame.style.display, 'none', 'a resize does not re-show a frame the pilot hid');
});
