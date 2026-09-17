/**
 * Every themed CSS property the builder can emit must be in the list that
 * clears them (FIX-260917).
 *
 * `applyTheme` sets variables on the root element and `THEMED_PROPERTIES` is
 * how they are removed again when a shop goes back to the default widget. The
 * two lists live in different packages, so a variable added to the builder and
 * forgotten here does not fail anything — it just never gets cleared, and the
 * shop keeps corners (or a font, or a panel size) it no longer has configured.
 * That is precisely what happened when the radius scale was added: four new
 * variables, zero errors, stale styling on every design switch.
 *
 * Reading both sources as text rather than importing them keeps this honest
 * without a build step, the same way the embed tests read the real loader.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUILDER = readFileSync(
  new URL('../../../packages/types/src/common/widget-theme.ts', import.meta.url),
  'utf8',
);
const APPLIER = readFileSync(new URL('../src/lib/theme.ts', import.meta.url), 'utf8');

/** The names THEMED_PROPERTIES covers, including its `--ivy-primary-${stop}` row. */
function clearedNames() {
  const block = APPLIER.match(/THEMED_PROPERTIES\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(block, 'THEMED_PROPERTIES list not found — did it move?');
  return new Set(block[1].match(/--ivy-[a-z0-9-]*/g) ?? []);
}

/** Static names the builder writes, plus the prefixes it writes dynamically. */
function emittedNames() {
  const statics = new Set();
  const prefixes = new Set();
  for (const m of BUILDER.matchAll(/--ivy-[a-z0-9-]*/g)) {
    const name = m[0];
    // `vars[`--ivy-radius-${step}`]` shows up here as the prefix `--ivy-radius-`.
    if (name.endsWith('-')) prefixes.add(name);
    else statics.add(name);
  }
  return { statics, prefixes };
}

test('every variable the theme builder writes can also be cleared', () => {
  const cleared = clearedNames();
  const { statics, prefixes } = emittedNames();

  const missing = [...statics].filter((n) => !cleared.has(n));
  assert.deepEqual(
    missing,
    [],
    `Add to THEMED_PROPERTIES in apps/widget/src/lib/theme.ts: ${missing.join(', ')}`,
  );

  for (const prefix of prefixes) {
    // Either the list spells the steps out (`--ivy-radius-sm`) or it builds
    // them the same dynamic way (`--ivy-primary-${stop}`); both cover it.
    const covered = [...cleared].some((n) => n.startsWith(prefix));
    assert.ok(
      covered,
      `The builder writes ${prefix}* dynamically but THEMED_PROPERTIES lists no such name — those variables would survive a switch back to the default widget.`,
    );
  }
});

test('the radius scale specifically is clearable', () => {
  // The regression this file was written for; kept explicit so a future
  // refactor of the generic check above cannot quietly drop it.
  const cleared = clearedNames();
  for (const step of ['sm', 'md', 'lg', 'xl']) {
    assert.ok(cleared.has(`--ivy-radius-${step}`), `--ivy-radius-${step} is not cleared`);
  }
});
