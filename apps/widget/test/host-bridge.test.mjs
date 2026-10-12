/**
 * The host bridge (PLN-260820 W1).
 *
 * The widget talks to a storefront frame and to a mobile WebView through the
 * same message shapes; this file is what stops those two from drifting. It
 * compiles the REAL `src/lib/host-bridge.ts` with esbuild — the module the app
 * ships — rather than restating its rules, for the same reason the loader tests
 * run the real embed.js.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SOURCE = readFileSync(new URL('../src/lib/host-bridge.ts', import.meta.url), 'utf8');
const JS = transformSync(SOURCE, { loader: 'ts', format: 'esm' }).code;

let instance = 0;

/**
 * Load the bridge against a fake window.
 *
 * The unique suffix forces a FRESH module per test: the bridge keeps
 * module-level state (the subscriber set and the pre-mount queue), which is
 * right for a page that loads it once and wrong for tests that would otherwise
 * share one instance — Node caches data: modules by content.
 */
async function load(win) {
  const listeners = [];
  const w = {
    location: { search: '' },
    addEventListener: (type, fn) => type === 'message' && listeners.push(fn),
    removeEventListener: (type, fn) => {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    ...win,
  };
  if (!w.parent) w.parent = w; // standalone unless a test says otherwise
  globalThis.window = w;
  const mod = await import(
    `data:text/javascript,${encodeURIComponent(`${JS}\n//${(instance += 1)}`)}`,
  );
  return { mod, w, listeners };
}

test('a parent frame is detected and used', async () => {
  const sent = [];
  const parent = { postMessage: (msg) => sent.push(msg) };
  const { mod } = await load({ parent });

  assert.equal(mod.hostKind(), 'frame');
  assert.equal(mod.isNativeHost(), false);
  mod.postToHost({ type: 'ivy:ready' });
  assert.deepEqual(sent, [{ type: 'ivy:ready' }]);
});

test('React Native takes priority and receives JSON', async () => {
  const sent = [];
  const { mod } = await load({
    ReactNativeWebView: { postMessage: (data) => sent.push(data) },
  });

  assert.equal(mod.hostKind(), 'react-native');
  assert.equal(mod.isNativeHost(), true);
  mod.postToHost({ type: 'ivy:close-request' });
  // RN's bridge is string-only; a raw object arrives as "[object Object]".
  assert.deepEqual(JSON.parse(sent[0]), { type: 'ivy:close-request' });
});

test('iOS receives a structured value, not a string', async () => {
  const sent = [];
  const { mod } = await load({
    webkit: { messageHandlers: { shoptalk: { postMessage: (data) => sent.push(data) } } },
  });

  assert.equal(mod.hostKind(), 'ios');
  mod.postToHost({ type: 'ivy:ready' });
  assert.deepEqual(sent, [{ type: 'ivy:ready' }]);
});

test('Android receives JSON', async () => {
  const sent = [];
  const { mod } = await load({ ShopTalkAndroid: { postMessage: (data) => sent.push(data) } });

  assert.equal(mod.hostKind(), 'android');
  assert.deepEqual(JSON.parse(sent[0] ?? '{}'), {});
  mod.postToHost({ type: 'ivy:ready' });
  assert.deepEqual(JSON.parse(sent[sent.length - 1]), { type: 'ivy:ready' });
});

test('standalone posts nowhere and does not throw', async () => {
  const { mod } = await load({});
  assert.equal(mod.hostKind(), null);
  assert.equal(mod.hostPresent(), false);
  assert.doesNotThrow(() => mod.postToHost({ type: 'ivy:ready' }));
});

test('a host whose bridge throws does not take the widget down', async () => {
  const { mod } = await load({
    ReactNativeWebView: {
      postMessage() {
        throw new Error('bridge torn down');
      },
    },
  });
  assert.doesNotThrow(() => mod.postToHost({ type: 'ivy:ready' }));
});

test('frame messages are accepted only from the parent, over a trusted origin', async () => {
  const parent = { postMessage() {} };
  const { mod, w, listeners } = await load({ parent });
  const seen = [];
  mod.onHostMessage((msg, meta) => seen.push([msg, meta.origin]));

  const deliver = (event) => listeners.forEach((fn) => fn(event));
  deliver({ source: parent, origin: 'https://shop.example', data: { type: 'ivy:ready' } });
  deliver({ source: parent, origin: 'http://evil.example', data: { type: 'ivy:command' } }); // plain http
  deliver({ source: {}, origin: 'https://shop.example', data: { type: 'ivy:command' } }); // not the parent

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], [{ type: 'ivy:ready' }, 'https://shop.example']);
  assert.equal(typeof w.__shoptalkHost, 'function'); // native inbox installed too
});

test('http://localhost is trusted, for development', async () => {
  const parent = { postMessage() {} };
  const { mod, listeners } = await load({ parent });
  const seen = [];
  mod.onHostMessage((msg) => seen.push(msg));

  listeners.forEach((fn) =>
    fn({ source: parent, origin: 'http://localhost:5174', data: { type: 'ivy:ready' } }),
  );
  assert.equal(seen.length, 1);
});

test('the native inbox delivers, ignores malformed payloads, and unsubscribes', async () => {
  const { mod, w } = await load({ ReactNativeWebView: { postMessage() {} } });
  const seen = [];
  const stop = mod.onHostMessage((msg, meta) => seen.push([msg, meta.origin]));

  w.__shoptalkHost(JSON.stringify({ type: 'ivy:identify', user: { userId: 'u1' } }));
  w.__shoptalkHost('not json at all'); // must not throw
  w.__shoptalkHost(JSON.stringify('a string, not an object'));

  assert.equal(seen.length, 1);
  assert.equal(seen[0][0].type, 'ivy:identify');
  // Native messages carry no origin — the channel identifies the host, and the
  // identity inside still has to be signed.
  assert.equal(seen[0][1], null);

  stop();
  // Still callable after unmount: throwing here would surface inside the host
  // app's WebView, where nobody can see it.
  assert.doesNotThrow(() => w.__shoptalkHost(JSON.stringify({ type: 'ivy:ready' })));
  assert.equal(seen.length, 1);
});

test('a message sent before anything is listening is not lost', async () => {
  // The host app calls identify() as it opens the screen, which routinely beats
  // React mounting.
  const { mod, w } = await load({ ReactNativeWebView: { postMessage() {} } });
  w.__shoptalkHost(JSON.stringify({ type: 'ivy:identify', user: { userId: 'early' } }));

  const seen = [];
  mod.onHostMessage((msg) => seen.push(msg));
  // Delivery is deferred one tick so every hook of the same commit subscribes
  // first (FIX-260828).
  assert.equal(seen.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].user.userId, 'early');
});

test('a queued message reaches every subscriber, not just the first', async () => {
  // The regression seen on-device: identify queued pre-mount was flushed into
  // the identity hook alone, so the command hook that acts on it never saw it.
  const { mod, w } = await load({ ReactNativeWebView: { postMessage() {} } });
  w.__shoptalkHost(JSON.stringify({ type: 'ivy:identify', user: { userId: 'early' } }));

  const first = [];
  const second = [];
  mod.onHostMessage((msg) => first.push(msg));
  mod.onHostMessage((msg) => second.push(msg));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);

  // A live (post-flush) message still reaches both, immediately.
  w.__shoptalkHost(JSON.stringify({ type: 'ivy:ready' }));
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
});

test('openHostUrl asks a frame host to navigate, in the given login mode', async () => {
  // PLN-261001 V2: the sandboxed widget never navigates the storefront itself.
  const sent = [];
  const parent = { postMessage: (msg) => sent.push(msg) };
  const { mod, w } = await load({ parent, open: () => assert.fail('must not open from the iframe') });
  w.open = () => assert.fail('must not open from the iframe');

  assert.equal(mod.openHostUrl('https://ha.example.com/sign-in', 'popup'), true);
  assert.deepEqual(sent, [{ type: 'ivy:open-url', url: 'https://ha.example.com/sign-in', mode: 'popup' }]);
  // Mode defaults to redirect — the loader's safer path (no popup blockers).
  mod.openHostUrl('https://ha.example.com/sign-up');
  assert.equal(sent[1].mode, 'redirect');
});

test('openHostUrl hands a native host the same message', async () => {
  const sent = [];
  const { mod } = await load({ ReactNativeWebView: { postMessage: (data) => sent.push(data) } });
  mod.openHostUrl('https://ha.example.com/sign-in');
  assert.deepEqual(JSON.parse(sent[sent.length - 1]), {
    type: 'ivy:open-url',
    url: 'https://ha.example.com/sign-in',
    mode: 'redirect',
  });
});

test('openHostUrl standalone opens a new tab, and refuses non-http URLs everywhere', async () => {
  const opened = [];
  const { mod } = await load({ open: (url, target, features) => opened.push([url, target, features]) });
  assert.equal(mod.openHostUrl('https://ha.example.com/sign-in'), true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], 'https://ha.example.com/sign-in');
  assert.match(String(opened[0][2]), /noopener/);

  // A `javascript:` value saved into tenant config must not run anywhere.
  assert.equal(mod.openHostUrl('javascript:alert(1)'), false);
  assert.equal(mod.openHostUrl('/relative'), false);
  assert.equal(opened.length, 1);
});

test('app mode is read from the URL', async () => {
  const a = await load({ location: { search: '?mode=app&shop=x' } });
  assert.equal(a.mod.isAppMode(), true);

  const b = await load({ location: { search: '?embed=1' } });
  assert.equal(b.mod.isAppMode(), false);
});
