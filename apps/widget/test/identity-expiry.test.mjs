/**
 * Telling the host its signed identity lapsed (PLN-261012 SG-03, REQ D-04).
 *
 * The widget turns three signals into ONE `identity-expired` event: the session
 * response's lapse time (a timer), a response that already says it lapsed, and a
 * poll / turn / rejected call that reports it. What matters is the ORDER and the
 * de-duplication — a host that signs again must be told about the NEXT lapse, a host
 * that ignores the first must not be spammed every 5 s poll — so this compiles the
 * real `src/lib/identity-expiry.ts` and drives it with a fake clock.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

// identity-expiry.ts imports the host bridge for its default singleton, and the bridge
// reaches for `window` at load. The notifier under test is pure and never touches it.
globalThis.window = { parent: null };
const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/lib/identity-expiry.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const { createIdentityExpiryNotifier } = await import(
  `data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`
);

/** A clock the test moves by hand; timers fire when it passes their due time. */
function fakeClock(start = Date.parse('2026-10-13T08:00:00.000Z')) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  return {
    clock: {
      now: () => now,
      setTimer: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { fn, due: now + ms });
        return id;
      },
      clearTimer: (id) => timers.delete(id),
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > target) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = target;
    },
    pending: () => timers.size,
    now: () => now,
  };
}

const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

function setup() {
  const c = fakeClock();
  const events = [];
  const n = createIdentityExpiryNotifier(() => events.push(c.now()), c.clock);
  return { c, n, events };
}

test('the host is told at the moment the claims lapse, not before', () => {
  const { c, n, events } = setup();
  n.observe({ sessionToken: 't1', identityExpiresAt: iso(c.now() + 8 * HOUR) });

  c.advance(8 * HOUR - 1000);
  assert.equal(events.length, 0, 'still inside the max age');

  c.advance(2000);
  assert.equal(events.length, 1);
});

test('a session that already lapsed (page reopened after a night) tells the host straight away', () => {
  const { c, n, events } = setup();
  n.observe({ sessionToken: 't1', identityExpired: true, identityExpiresAt: iso(c.now() - HOUR) });
  assert.equal(events.length, 1);
});

test('an expiry time already in the past fires immediately too', () => {
  const { c, n, events } = setup();
  n.observe({ sessionToken: 't1', identityExpiresAt: iso(c.now() - 1) });
  assert.equal(events.length, 1);
});

test('a poll flagging the lapse is reported once, not on every 5 s poll', () => {
  const { n, events } = setup();
  n.reportExpired('t1');
  n.reportExpired('t1');
  n.reportExpired('t1');
  assert.equal(events.length, 1);
});

test('the timer and a flagged poll for the same lapse tell the host once between them', () => {
  const { c, n, events } = setup();
  n.observe({ sessionToken: 't1', identityExpiresAt: iso(c.now() + HOUR) });
  c.advance(HOUR + 500);
  n.reportExpired('t1');
  assert.equal(events.length, 1);
});

test('a host that signs again is told about the NEXT lapse as well', () => {
  const { c, n, events } = setup();
  n.observe({ sessionToken: 't1', identityExpiresAt: iso(c.now() + HOUR) });
  c.advance(HOUR + 500);
  assert.equal(events.length, 1);

  // identify() answered with a fresher signature on the same session.
  n.observe({ sessionToken: 't1', identityExpiresAt: iso(c.now() + 8 * HOUR) });
  assert.equal(events.length, 1, 'signing again is not itself an expiry');

  c.advance(8 * HOUR + 500);
  assert.equal(events.length, 2);
});

test('a guest / v1 session (no expiry time) cancels the timer and reports nothing', () => {
  const { c, n, events } = setup();
  n.observe({ sessionToken: 't1', identityExpiresAt: iso(c.now() + HOUR) });
  n.observe({ sessionToken: 't1' });

  c.advance(10 * HOUR);
  assert.equal(events.length, 0);
  assert.equal(c.pending(), 0);
});

test('a different session starts clean: the old timer is replaced and the old report forgotten', () => {
  const { c, n, events } = setup();
  n.observe({ sessionToken: 't1', identityExpiresAt: iso(c.now() + HOUR) });
  c.advance(HOUR + 500);
  assert.equal(events.length, 1);

  n.observe({ sessionToken: 't2', identityExpiresAt: iso(c.now() + HOUR) });
  c.advance(HOUR + 500);
  assert.equal(events.length, 2);
});

test('cancel() (logout, swap) stops the timer and forgets what was reported', () => {
  const { c, n, events } = setup();
  n.observe({ sessionToken: 't1', identityExpiresAt: iso(c.now() + HOUR) });
  n.cancel();

  c.advance(2 * HOUR);
  assert.equal(events.length, 0);
  assert.equal(c.pending(), 0);

  // The same token can lapse and be reported again afterwards.
  n.reportExpired('t1');
  assert.equal(events.length, 1);
});

test('a rejected call with no session named still reaches the host', () => {
  const { n, events } = setup();
  n.reportExpired();
  assert.equal(events.length, 1);
});

test('a 30-day max age (beyond the 32-bit timer limit) is armed in slices and does not fire early', () => {
  const { c, n, events } = setup();
  const DAY = 24 * HOUR;
  n.observe({ sessionToken: 't1', identityExpiresAt: iso(c.now() + 30 * DAY) });

  // A naive setTimeout(…, 30 days) overflows and fires at once.
  assert.equal(events.length, 0);
  c.advance(29 * DAY);
  assert.equal(events.length, 0);
  c.advance(DAY + 1000);
  assert.equal(events.length, 1);
});

test('an unparseable expiry time is ignored — no timer, no event', () => {
  const { c, n, events } = setup();
  n.observe({ sessionToken: 't1', identityExpiresAt: 'not a date' });
  c.advance(100 * HOUR);
  assert.equal(events.length, 0);
  assert.equal(c.pending(), 0);
});
