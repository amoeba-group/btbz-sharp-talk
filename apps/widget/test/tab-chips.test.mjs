/**
 * Which chips each list tab shows (PLN-260923 P1).
 *
 * A tenant with only the Notifications list tab (ivyusa) gets the design's
 * single bar — All · Payment · Delivery · Event · Review — and Inquiries only
 * when it runs an issue workflow. Tenants with both list tabs keep their split
 * bars unchanged.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

// tab-chips.ts imports only a TYPE from the store, so bundling it alone is
// enough; esbuild drops the type import.
const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/components/notifications/tab-chips.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const mod = await import(`data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`);
const { chipsFor, defaultChip, chipBelongsTo } = mod;

const keys = (chips) => chips.map((c) => c.key);
const SINGLE = ['notifications', 'chat'];
const SPLIT = ['notifications', 'orders', 'chat'];

test('single list tab: the design bar, orders chip labelled Payment', () => {
  const chips = chipsFor('notifications', SINGLE);
  assert.deepEqual(keys(chips), ['all', 'orders', 'shipping', 'event', 'review']);
  assert.equal(chips[1].labelKey, 'notifications.filters.payment');
  assert.equal(defaultChip('notifications', SINGLE), 'all');
});

test('single list tab: Inquiries only for tenants with an issue workflow', () => {
  assert.deepEqual(keys(chipsFor('notifications', SINGLE, { inquiries: true })).at(-1), 'inquiries');
  assert.equal(chipBelongsTo('inquiries', 'notifications', SINGLE), false);
  assert.equal(chipBelongsTo('inquiries', 'notifications', SINGLE, { inquiries: true }), true);
});

test('both list tabs: split bars unchanged, Orders label kept', () => {
  assert.deepEqual(keys(chipsFor('notifications', SPLIT)), ['all', 'event']);
  const orders = chipsFor('orders', SPLIT);
  assert.deepEqual(keys(orders), ['orders', 'shipping', 'review', 'inquiries']);
  assert.equal(orders[0].labelKey, 'notifications.filters.orders');
});
