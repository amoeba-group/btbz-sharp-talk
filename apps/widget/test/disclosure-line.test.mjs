/**
 * Tenant AI disclosure line (PLN-261023-Widget-Disclosure-Line-Copy D2):
 * `[…]` marks the part that links to the terms.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/lib/copy.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const { splitDisclosure } = await import(`data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`);

test('the bracketed words become the link — go2joy EN/VI/KO', () => {
  assert.deepEqual(splitDisclosure('Created by AI; apply [terms of service]'), {
    before: 'Created by AI; apply ',
    link: 'terms of service',
    after: '',
  });
  assert.deepEqual(splitDisclosure('Được tạo bởi AI, áp dụng [điều khoản dịch vụ]').link, 'điều khoản dịch vụ');
  assert.deepEqual(splitDisclosure('AI가 생성함, [서비스 이용 약관]이 적용됩니다'), {
    before: 'AI가 생성함, ',
    link: '서비스 이용 약관',
    after: '이 적용됩니다',
  });
});

test('no brackets → no inline link (the caller appends its own)', () => {
  assert.deepEqual(splitDisclosure('Answers are AI-generated'), {
    before: 'Answers are AI-generated',
    link: null,
    after: '',
  });
});

test('an empty or unmatched bracket stays text', () => {
  assert.equal(splitDisclosure('see [] here').link, null);
  assert.equal(splitDisclosure('see [terms here').link, null);
});

test('only the first pair links', () => {
  const out = splitDisclosure('[a] and [b]');
  assert.equal(out.link, 'a');
  assert.equal(out.after, ' and [b]');
});
