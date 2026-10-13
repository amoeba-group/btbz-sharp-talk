/**
 * The "Contact support" card must not show another company's phone number (w3c, ops-manual finding 8).
 *
 * Compiles the REAL `src/lib/contact-card.ts` (pure, no imports) and pins which rows are drawn, and
 * that no widget locale ships IVY's placeholder values any more.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/lib/contact-card.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const { contactMethods } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64')
);

test('an unconfigured tenant offers no phone, no e-mail and no hours line', () => {
  assert.deepEqual(contactMethods({ phone: '', email: '', hours: '', emailHours: '' }), {
    phone: false,
    email: false,
    hours: false,
    emailHours: false,
  });
  assert.deepEqual(contactMethods({}), { phone: false, email: false, hours: false, emailHours: false });
  assert.equal(contactMethods({ phone: '   ' }).phone, false);
});

test('a method with a value is drawn, the others are not', () => {
  const shown = contactMethods({ phone: '+84 28 0000 0000', email: '', hours: 'Mon-Fri 08:00-17:00', emailHours: '' });
  assert.equal(shown.phone, true);
  assert.equal(shown.email, false);
  assert.equal(shown.hours, true);
  assert.equal(shown.emailHours, false);
});

test('no widget locale bundles contact values at all (the card reads them with an empty default)', () => {
  const dir = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 6, 'expected the six widget locales');
  for (const f of files) {
    const src = readFileSync(dir + f, 'utf8');
    assert.ok(!src.includes('1588-0000'), `${f} still carries the placeholder phone`);
    assert.ok(!src.includes('help@ivy.com'), `${f} still carries the placeholder e-mail`);
    const block = src.slice(src.indexOf('  contact: {'), src.indexOf('  contact: {') + 700);
    // The keys are absent (the card reads them with an empty default), so i18n:check has no empty value to flag.
    assert.doesNotMatch(block, /\n    (phone|email|hours|emailHours): /, `${f}: contact values must not be bundled`);
  }
});
