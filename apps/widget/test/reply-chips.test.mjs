/**
 * Chips under a reply that brought none (PLN-261001 S1).
 *
 * go2joy's hotel partners were offered My orders / Shipping & delivery /
 * Return or exchange after every answer — hard-coded store chips. A tenant
 * with no orders now gets its own scenario buttons there; stores are unchanged.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/components/chat/reply-chips.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const { replyChips, NON_COMMERCE_REPLY_CHIPS, teamChoiceOf, TEAM_CHIP_PREFIX } = await import(
  `data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`
);

const LABELS = { myOrders: 'My orders', shipping: 'Shipping', returns: 'Returns', agent: 'Talk to an agent' };
const btn = (id, label) => ({ id, label, action: 'message', enabled: true });
const PARTNER = [
  btn('partner_today_bookings', "View today's bookings"),
  btn('partner_check_in', 'How to check in a guest'),
  btn('partner_booking_dispute', 'Dispute a booking'),
  btn('partner_settlement', 'Settlement inquiry'),
];
const ids = (chips) => chips.map((c) => c.id);

test('a store keeps its order chips, whatever its scenario buttons are', () => {
  assert.deepEqual(ids(replyChips(true, PARTNER, LABELS)), [
    'my_orders',
    'shipping_policy',
    'return_exchange',
    'agent_connect',
  ]);
});

test('a tenant with no orders gets its first scenario buttons, then the agent', () => {
  const chips = replyChips(false, PARTNER, LABELS);
  assert.equal(chips.length, NON_COMMERCE_REPLY_CHIPS + 1);
  assert.deepEqual(ids(chips), [
    'partner_today_bookings',
    'partner_check_in',
    'partner_booking_dispute',
    'agent_connect',
  ]);
  // The click goes through the menu's own handler, so the button travels along.
  assert.equal(chips[0].button.action, 'message');
  assert.equal(chips[0].label, "View today's bookings");
});

test('no scenario buttons → only the agent chip, never the store chips', () => {
  assert.deepEqual(ids(replyChips(false, [], LABELS)), ['agent_connect']);
});

test('a disabled button is not offered', () => {
  const chips = replyChips(false, [{ ...PARTNER[0], enabled: false }, PARTNER[1]], LABELS);
  assert.deepEqual(ids(chips), ['partner_check_in', 'agent_connect']);
});

/**
 * Team chips (PLN-261007 Team Routing): the server writes `team:<id>`, the
 * widget sends `<id>` back as support_type. Anything else is a scenario chip.
 */
test('teamChoiceOf: strips the prefix and rejects other chips', () => {
  assert.equal(teamChoiceOf(`${TEAM_CHIP_PREFIX}business`), 'business');
  assert.equal(teamChoiceOf('team: cs '), 'cs');
  assert.equal(teamChoiceOf('team:'), null);
  assert.equal(teamChoiceOf('agent_connect'), null);
  assert.equal(teamChoiceOf('shipping_policy'), null);
});
