/**
 * Bubble structure parser (user feedback 2026-10-07). Compiles the REAL
 * `src/lib/reply-format.ts` with esbuild, like the host-bridge tests.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SOURCE = readFileSync(new URL('../src/lib/reply-format.ts', import.meta.url), 'utf8');
const JS = transformSync(SOURCE, { loader: 'ts', format: 'esm' }).code;
const { parseReply, parseInline, hasStructure } = await import(
  `data:text/javascript,${encodeURIComponent(JS)}`
);

test('plain text stays one paragraph, line breaks kept', () => {
  assert.deepEqual(parseReply('Xin chào.\nTôi có thể giúp gì?'), [
    { kind: 'p', text: 'Xin chào.\nTôi có thể giúp gì?' },
  ]);
  assert.equal(hasStructure('Xin chào.\nTôi có thể giúp gì?'), false);
});

test('bullets become one list; a lead-in line stays a paragraph before it', () => {
  const body = 'Hạn đối soát:\n- Trước 16h30 thứ Tư → nhận tiền thứ Năm\n- Sau đó → thứ Năm tuần sau';
  assert.deepEqual(parseReply(body), [
    { kind: 'p', text: 'Hạn đối soát:' },
    { kind: 'ul', items: ['Trước 16h30 thứ Tư → nhận tiền thứ Năm', 'Sau đó → thứ Năm tuần sau'] },
  ]);
  assert.equal(hasStructure(body), true);
});

test('numbered steps become an ordered list; "1)" counts too', () => {
  const body = '1. Mở Hồ sơ cá nhân\n2) Chọn Đổi mật khẩu\n3. Lưu';
  assert.deepEqual(parseReply(body), [{ kind: 'ol', items: ['Mở Hồ sơ cá nhân', 'Chọn Đổi mật khẩu', 'Lưu'] }]);
});

test('a blank line separates paragraphs; lists end at the next plain line', () => {
  const body = 'Có hai cách.\n\n- A\n- B\nNếu cần, tôi nối bạn với nhân viên.';
  assert.deepEqual(parseReply(body), [
    { kind: 'p', text: 'Có hai cách.' },
    { kind: 'ul', items: ['A', 'B'] },
    { kind: 'p', text: 'Nếu cần, tôi nối bạn với nhân viên.' },
  ]);
});

test('only **bold** is inline markup; everything else is literal', () => {
  assert.deepEqual(parseInline('**Lưu ý:** không có phí'), [
    { bold: true, text: 'Lưu ý:' },
    { bold: false, text: ' không có phí' },
  ]);
  assert.deepEqual(parseInline('giá 2** phòng'), [{ bold: false, text: 'giá 2** phòng' }]);
  assert.deepEqual(parseInline('# not a heading | <b>x</b>'), [{ bold: false, text: '# not a heading | <b>x</b>' }]);
});

test('a price like "2. " at line start is still a step, but "2024." mid-line is not', () => {
  assert.equal(parseReply('2. Bước hai')[0].kind, 'ol');
  assert.equal(parseReply('Từ 2024. Áp dụng F+10')[0].kind, 'p');
});
