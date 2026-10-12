/**
 * Replacing the widget's live session (PLN-261012 SG-02 / REQ D-02, D-03).
 *
 * When the host logs out, identifies a different person or hotel, or an
 * identify fails on a signed-in session, the widget must stop showing and
 * fetching what belonged to the previous identity. The ORDER of the steps is
 * what matters — detach before any await, token last — so this compiles the real
 * `src/lib/session-swap.ts` and drives it with ports that record the calls.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

// session-swap.ts imports only a TYPE, so bundling it alone is enough.
const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/lib/session-swap.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const { isForkedSession, adoptForkedSession, resetToGuest } = await import(
  `data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`
);

const session = (token, over = {}) => ({ sessionToken: token, authenticated: false, customerName: null, ...over });

/** Ports that log every call, with a controllable network. */
function ports({ endBinding, startGuest } = {}) {
  const log = [];
  return {
    log,
    ports: {
      clearCache: () => log.push('clearCache'),
      detach: () => log.push('detach'),
      adopt: (res) => log.push(`adopt:${res.sessionToken}`),
      startGuest: () => {
        log.push('startGuest');
        return (startGuest ?? (async () => session('guest-2')))();
      },
      endBinding: (token) => {
        log.push(`endBinding:${token}`);
        return (endBinding ?? (async () => ({ loggedOut: true })))();
      },
    },
  };
}

test('identify answering on the token it was sent on is not a fork', () => {
  assert.equal(isForkedSession('tok', session('tok')), false);
});

test('identify answering with another token is a fork the widget must adopt', () => {
  assert.equal(isForkedSession('tok', session('tok-2')), true);
});

test('an answer without a token is never treated as a fork (older API, empty body)', () => {
  assert.equal(isForkedSession('tok', {}), false);
  assert.equal(isForkedSession('tok', { sessionToken: '' }), false);
  assert.equal(isForkedSession('tok', { sessionToken: null }), false);
});

test('adopting a forked session clears the cache first, then adopts it', () => {
  const { log, ports: p } = ports();
  adoptForkedSession(session('tok-2', { authenticated: true }), p);
  assert.deepEqual(log, ['clearCache', 'adopt:tok-2']);
});

test('reset to guest: detach and clear BEFORE anything is awaited', async () => {
  const { log, ports: p } = ports();

  const pending = resetToGuest('old', p);

  // Synchronously, before the event loop turns: nothing may still render or poll
  // with the old identity, and a host identify() that follows straight away must
  // find no token. Both network calls have already been started, none finished.
  assert.deepEqual(log, ['detach', 'clearCache', 'endBinding:old', 'startGuest']);
  assert.equal(await pending, true);
  assert.deepEqual(log, ['detach', 'clearCache', 'endBinding:old', 'startGuest', 'adopt:guest-2']);
});

test('reset to guest: the guest session is adopted last, once everything else is in place', async () => {
  const { log, ports: p } = ports();
  await resetToGuest('old', p);
  assert.equal(log[log.length - 1], 'adopt:guest-2');
});

test('a failed server logout does not stop the widget from resetting', async () => {
  const { log, ports: p } = ports({
    endBinding: async () => {
      throw new Error('network down');
    },
  });

  assert.equal(await resetToGuest('old', p), true);
  assert.deepEqual(log, ['detach', 'clearCache', 'endBinding:old', 'startGuest', 'adopt:guest-2']);
});

test('offline: no guest session comes back, but the old identity is already gone', async () => {
  const { log, ports: p } = ports({
    startGuest: async () => {
      throw new Error('network down');
    },
  });

  assert.equal(await resetToGuest('old', p), false);
  assert.deepEqual(log, ['detach', 'clearCache', 'endBinding:old', 'startGuest']);
});

test('a guest answer without a token is not adopted', async () => {
  const { log, ports: p } = ports({ startGuest: async () => ({}) });
  assert.equal(await resetToGuest('old', p), false);
  assert.ok(!log.some((l) => l.startsWith('adopt')));
});

test('logout before any session existed: nothing to end on the server, a guest is still opened', async () => {
  const { log, ports: p } = ports();

  assert.equal(await resetToGuest(null, p), true);

  assert.ok(!log.some((l) => l.startsWith('endBinding')));
  assert.deepEqual(log, ['detach', 'clearCache', 'startGuest', 'adopt:guest-2']);
});
