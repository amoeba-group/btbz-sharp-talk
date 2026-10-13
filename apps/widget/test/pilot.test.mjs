/**
 * Pilot allowlist, widget-side rules (PLN-261012 SG-40).
 *
 * The server refuses every turn from a hotel that is not on the list; the widget only
 * decides how to get out of the way. These compile the REAL `src/lib/pilot.ts` and pin
 * what it reads (the `pilot` verdict the API sends), what it tells the loader
 * (`ivy:visibility`), and when a restricted widget re-asks. Pure functions, no DOM.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

// pilot.ts imports nothing, so bundling it alone is enough.
const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/lib/pilot.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const {
  PILOT_ALLOWED,
  PILOT_RECHECK_MS,
  effectivePilotView,
  pilotViewOf,
  reducePilot,
  samePilotView,
  shouldRecheckPilot,
  visibilityMessage,
} = await import(`data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`);

test('no verdict, no list in force, or an older API all read as "allowed" — the widget never hides on a guess', () => {
  assert.deepEqual(pilotViewOf(undefined), { kind: 'allowed' });
  assert.deepEqual(pilotViewOf(null), { kind: 'allowed' });
  assert.deepEqual(pilotViewOf({ eligible: null }), { kind: 'allowed' });
  assert.deepEqual(pilotViewOf({ eligible: true }), { kind: 'allowed' });
  assert.deepEqual(pilotViewOf({}), { kind: 'allowed' });
  assert.deepEqual(pilotViewOf({ eligible: 'false' }), { kind: 'allowed' }, 'only a literal false restricts');
});

test('not eligible + mode hide → hide (the note rides along for a host app)', () => {
  assert.deepEqual(pilotViewOf({ eligible: false, mode: 'hide', notice: 'Not for your hotel' }), {
    kind: 'hide',
    notice: 'Not for your hotel',
  });
  assert.deepEqual(pilotViewOf({ eligible: false, mode: 'hide' }), { kind: 'hide', notice: null });
});

test('not eligible + mode notice + text → a notice panel', () => {
  assert.deepEqual(pilotViewOf({ eligible: false, mode: 'notice', notice: 'Chưa áp dụng.' }), {
    kind: 'notice',
    notice: 'Chưa áp dụng.',
  });
});

test('mode notice with nothing to say falls back to hide — an empty panel helps nobody', () => {
  assert.deepEqual(pilotViewOf({ eligible: false, mode: 'notice' }), { kind: 'hide', notice: null });
  assert.deepEqual(pilotViewOf({ eligible: false, mode: 'notice', notice: '   ' }), { kind: 'hide', notice: null });
  assert.deepEqual(pilotViewOf({ eligible: false, mode: 'notice', notice: 42 }), { kind: 'hide', notice: null });
});

test('an unknown mode is read as hide', () => {
  assert.equal(pilotViewOf({ eligible: false, mode: 'block' }).kind, 'hide');
  assert.equal(pilotViewOf({ eligible: false }).kind, 'hide');
});

test('a host app cannot hide its own screen — "hide" shows the note there when there is one', () => {
  const hide = pilotViewOf({ eligible: false, mode: 'hide', notice: 'Not for your hotel' });
  assert.deepEqual(effectivePilotView(hide, true), { kind: 'notice', notice: 'Not for your hotel' });
  assert.deepEqual(effectivePilotView(hide, false), hide);
  const bare = pilotViewOf({ eligible: false, mode: 'hide' });
  assert.deepEqual(effectivePilotView(bare, true), bare, 'no note, nothing to show');
  assert.deepEqual(effectivePilotView(PILOT_ALLOWED, true), PILOT_ALLOWED);
});

test('ivy:visibility — allowed is visible, hide is not, a note keeps the launcher', () => {
  assert.deepEqual(visibilityMessage({ kind: 'allowed' }), { type: 'ivy:visibility', visible: true, reason: null, mode: null });
  assert.deepEqual(visibilityMessage({ kind: 'hide', notice: null }), { type: 'ivy:visibility', visible: false, reason: 'pilot', mode: 'hide' });
  assert.deepEqual(visibilityMessage({ kind: 'notice', notice: 'x' }), { type: 'ivy:visibility', visible: true, reason: 'pilot', mode: 'notice' });
});

test('the message carries no notice text or hotel data — only what a host needs to act', () => {
  for (const view of [{ kind: 'hide', notice: 'secret wording' }, { kind: 'notice', notice: 'secret wording' }]) {
    assert.ok(!JSON.stringify(visibilityMessage(view)).includes('secret'));
  }
});

test('samePilotView compares meaning, not identity', () => {
  assert.equal(samePilotView({ kind: 'allowed' }, { kind: 'allowed' }), true);
  assert.equal(samePilotView({ kind: 'hide', notice: 'a' }, { kind: 'hide', notice: 'a' }), true);
  assert.equal(samePilotView({ kind: 'hide', notice: 'a' }, { kind: 'hide', notice: 'b' }), false);
  assert.equal(samePilotView({ kind: 'hide', notice: 'a' }, { kind: 'notice', notice: 'a' }), false);
  assert.equal(samePilotView({ kind: 'allowed' }, { kind: 'hide', notice: null }), false);
});

test('reducePilot: the first response with ANY verdict marks it known — the loader may be waiting for it', () => {
  const start = { pilot: PILOT_ALLOWED, pilotKnown: false };
  assert.equal(reducePilot(start, undefined, false).pilotKnown, false, 'an older API says nothing');
  assert.equal(reducePilot(start, { eligible: null }, false).pilotKnown, true, '"no list" is still an answer');
  assert.equal(reducePilot({ ...start, pilotKnown: true }, undefined, false).pilotKnown, true, 'never goes back');
});

test('reducePilot: a hide while open closes the panel; a note and an allow do not', () => {
  const start = { pilot: PILOT_ALLOWED, pilotKnown: true };
  assert.equal(reducePilot(start, { eligible: false, mode: 'hide' }, false).closePanel, true);
  assert.equal(reducePilot(start, { eligible: false, mode: 'notice', notice: 'x' }, false).closePanel, false);
  assert.equal(reducePilot(start, { eligible: true }, false).closePanel, false);
});

test('reducePilot: in a host app a hide keeps the panel (it is the screen) when there is a note', () => {
  const start = { pilot: PILOT_ALLOWED, pilotKnown: true };
  assert.equal(reducePilot(start, { eligible: false, mode: 'hide', notice: 'x' }, true).closePanel, false);
  assert.equal(reducePilot(start, { eligible: false, mode: 'hide' }, true).closePanel, true);
});

test('reducePilot keeps the SAME object when nothing changed, so subscribers do not re-render', () => {
  const hidden = { kind: 'hide', notice: 'x' };
  const next = reducePilot({ pilot: hidden, pilotKnown: true }, { eligible: false, mode: 'hide', notice: 'x' }, false);
  assert.equal(next.pilot, hidden);
});

test('reducePilot: a host switching hotel — hide, then allowed again — is reversible', () => {
  let state = { pilot: PILOT_ALLOWED, pilotKnown: false };
  state = reducePilot(state, { eligible: false, mode: 'hide', notice: 'n' }, false);
  assert.equal(state.pilot.kind, 'hide');
  state = reducePilot(state, { eligible: true }, false);
  assert.equal(state.pilot.kind, 'allowed');
});

test('re-check: only a RESTRICTED widget re-asks, only from a visible tab, only when due', () => {
  const hide = { kind: 'hide', notice: null };
  const note = { kind: 'notice', notice: 'x' };
  assert.equal(shouldRecheckPilot(PILOT_ALLOWED, { tabVisible: true, msSinceLastCheck: PILOT_RECHECK_MS * 10 }), false);
  assert.equal(shouldRecheckPilot(hide, { tabVisible: false, msSinceLastCheck: PILOT_RECHECK_MS * 10 }), false);
  assert.equal(shouldRecheckPilot(hide, { tabVisible: true, msSinceLastCheck: PILOT_RECHECK_MS - 1 }), false);
  assert.equal(shouldRecheckPilot(hide, { tabVisible: true, msSinceLastCheck: PILOT_RECHECK_MS }), true);
  assert.equal(shouldRecheckPilot(note, { tabVisible: true, msSinceLastCheck: PILOT_RECHECK_MS }), true);
});

test('the re-check interval is about the server cache (60 s) plus a poll, not a hammer', () => {
  assert.ok(PILOT_RECHECK_MS >= 60_000 && PILOT_RECHECK_MS <= 300_000);
});
