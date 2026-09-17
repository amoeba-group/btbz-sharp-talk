#!/usr/bin/env node
/**
 * No hardcoded corner radius in the widget panel (FIX-260917).
 *
 * The tenant's 모서리 setting used to reach exactly one CSS rule: the panel
 * shell. Every other surface carried a fixed Tailwind radius, so the setting
 * looked broken — 47 call sites had quietly opted out of a design token nobody
 * remembered to plumb. Migrating them once fixes today; this check is what
 * keeps the next component from opting out again, because the failure mode is
 * silent (nothing errors, the setting just does less than it says).
 *
 * Allowed and deliberately so:
 *   rounded-full   pills and circles — launcher, avatar, badge, chip. These are
 *                  semantic shapes, not decoration: a "slightly rounded" avatar
 *                  is a bug, not a theme.
 *   rounded-none   the mobile fullscreen panel, whose corners are off-screen.
 *   rounded-bl-sm  the message-bubble tail.
 *   components/storefront/**  the mock merchant page around the widget in dev.
 *                  It imitates a shop, so it must NOT follow our tenant theme.
 *
 *   npm run radius:check
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const PANEL = join(ROOT, 'apps/widget/src');
const SKIP_DIR = join(PANEL, 'components/storefront');
const BANNED = /\brounded-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee)?-?(?:sm|md|lg|xl|2xl|3xl)\b/g;
const ALLOWED = new Set(['rounded-bl-sm']);
const SUGGEST = {
  'rounded-sm': 'rounded-st-sm',
  'rounded-md': 'rounded-st-sm',
  'rounded-lg': 'rounded-st-md',
  'rounded-xl': 'rounded-st-lg',
  'rounded-2xl': 'rounded-st-xl',
  'rounded-3xl': 'rounded-st-xl',
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p.startsWith(SKIP_DIR)) continue;
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(p)) yield p;
  }
}

const findings = [];
for (const file of files(PANEL)) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const hit of line.match(BANNED) ?? []) {
        if (ALLOWED.has(hit)) continue;
        findings.push({ file: relative(ROOT, file), line: i + 1, hit });
      }
    });
}

if (findings.length) {
  console.error('Hardcoded corner radius in widget panel components:\n');
  for (const f of findings) {
    const fix = SUGGEST[f.hit] ?? 'rounded-st-md';
    console.error(`  ${f.file}:${f.line}  ${f.hit}  ->  ${fix}`);
  }
  console.error(
    `\n${findings.length} site(s). The panel follows the tenant's 모서리 setting through`,
  );
  console.error('the rounded-st-* scale; a fixed radius silently ignores it (FIX-260917).');
  console.error('Pills/circles keep rounded-full — they are shapes, not themed corners.');
  process.exit(1);
}

console.log('radius tokens: widget panel is clean (no hardcoded radius)');
