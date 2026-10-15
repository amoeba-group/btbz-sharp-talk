/**
 * Host-app context + native chrome (PLN-261015).
 *
 * Compiles the REAL `src/lib/host-context.ts` and `src/lib/host-bridge.ts` with
 * esbuild, the modules the app ships, instead of restating their rules.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const compile = (rel) =>
  transformSync(readFileSync(new URL(rel, import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' }).code;
const asModule = (js) => import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const { parseHostContext } = await asModule(compile('../src/lib/host-context.ts'));

test('a context needs a usable screen, otherwise it removes the chip', () => {
  assert.equal(parseHostContext(null), null);
  assert.equal(parseHostContext(undefined), null);
  assert.equal(parseHostContext('bookings'), null);
  assert.equal(parseHostContext([]), null);
  assert.equal(parseHostContext({ ref: 'X' }), null);
  assert.equal(parseHostContext({ screen: '   ' }), null);
});

test('keeps the four known fields, trimmed, newlines flattened', () => {
  assert.deepEqual(
    parseHostContext({ screen: ' bookings ', ref: 'G2J-8841\r\nx', label: 'Chờ nhận phòng', prefill: 'Khách không đến', extra: 1 }),
    { screen: 'bookings', ref: 'G2J-8841 x', label: 'Chờ nhận phòng', prefill: 'Khách không đến' },
  );
});

test('omits absent optionals instead of sending empty strings', () => {
  assert.deepEqual(parseHostContext({ screen: 'home' }), {
    screen: 'home',
    ref: undefined,
    label: undefined,
    prefill: undefined,
  });
});

test('bounds every field', () => {
  const c = parseHostContext({ screen: 's'.repeat(999), ref: 'r'.repeat(999), prefill: 'p'.repeat(2000) });
  assert.equal(c.screen.length, 120);
  assert.equal(c.ref.length, 120);
  assert.equal(c.prefill.length, 500);
});

test('numbers are accepted as text (a booking id is often numeric)', () => {
  assert.equal(parseHostContext({ screen: 'bookings', ref: 8841 }).ref, '8841');
});

// ── chrome=native ────────────────────────────────────────────────────────────
let n = 0;
async function bridge(search) {
  const js = compile('../src/lib/host-bridge.ts');
  globalThis.window = { location: { search }, addEventListener() {}, removeEventListener() {} };
  globalThis.window.parent = globalThis.window;
  return asModule(js + `\n// ${++n}`);
}

test('native chrome only applies inside app mode', async () => {
  assert.equal((await bridge('?embed=1&mode=app&chrome=native')).isNativeChrome(), true);
  assert.equal((await bridge('?embed=1&mode=app')).isNativeChrome(), false);
  assert.equal((await bridge('?embed=1&chrome=native')).isNativeChrome(), false, 'a storefront frame cannot hide the widget header');
  assert.equal((await bridge('?mode=app&chrome=widget')).isNativeChrome(), false);
});
