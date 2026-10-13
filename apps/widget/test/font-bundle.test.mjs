/**
 * The self-hosted base font and its switch (PLN-261012 SG-82).
 *
 * The widget iframe used to hard-link Pretendard from jsDelivr. Now index.html
 * links a same-origin /base-font.css whose content a deployment chooses with
 * WIDGET_FONT_CSS_URL; the Pretendard files are bundled so "no third-party
 * request" is one env var away. These pin the parts that fail silently: a CSS
 * that points at a file that is not there just yields system fonts, with no error.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const at = (rel) => new URL(rel, import.meta.url);
const read = (rel) => readFileSync(at(rel), 'utf8').replace(/\r\n/g, '\n');

test('every file the bundled stylesheet references exists and is a real woff2', () => {
  const css = read('../public/fonts/pretendard/pretendard.css');
  const urls = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 4, 'the four weights the widget uses');
  for (const rel of urls) {
    const file = at(`../public/fonts/pretendard/${rel}`);
    assert.ok(existsSync(file), `${rel} is missing`);
    assert.equal(readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', `${rel} is not a woff2`);
  }
});

test('covers the weights the widget actually renders (400 / 500 / 600 / 700)', () => {
  const css = read('../public/fonts/pretendard/pretendard.css');
  for (const w of [400, 500, 600, 700]) assert.match(css, new RegExp(`font-weight: ${w};`));
});

test('the OFL licence travels with the fonts', () => {
  const licence = read('../public/fonts/pretendard/LICENSE.txt');
  assert.match(licence, /SIL Open Font License, Version 1\.1/);
});

test('index.html links the same-origin base font, not a CDN', () => {
  const html = read('../index.html');
  assert.match(html, /<link rel="stylesheet" href="\/base-font\.css" \/>/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/, 'a CDN link in index.html would defeat WIDGET_FONT_CSS_URL');
});

test('the shipped default of base-font.css is still Pretendard from jsDelivr (no behaviour change)', () => {
  const css = read('../public/base-font.css');
  assert.match(css, /@import url\('https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard@v1\.3\.9\/dist\/web\/static\/pretendard\.css'\);/);
});

test('both widget nginx templates agree and wire the two env switches', () => {
  const prod = read('../../../docker/production/nginx.widget.conf');
  const self = read('../../../docker/self-hosted/nginx.widget.conf');
  assert.equal(prod, self, 'production and self-hosted widget confs drifted apart');
  assert.match(prod, /default "\$\{WIDGET_FRAME_ANCESTORS\}";/);
  assert.match(prod, /map "\$\{WIDGET_FONT_CSS_URL\}" \$widget_font_css/);
  assert.match(prod, /location = \/widget\/base-font\.css/);
  // Blank must mean "no header at all": an empty add_header value is not sent.
  assert.match(prod, /""\s+"";\s*\n\s*default "frame-ancestors \$widget_frame_ancestors";/);
  assert.match(prod, /add_header Content-Security-Policy \$widget_csp_frame_ancestors always;/);
});

test('both Dockerfiles install the template and default both variables so an unconfigured container is unchanged', () => {
  for (const env of ['production', 'self-hosted']) {
    const df = read(`../../../docker/${env}/Dockerfile.widget`);
    assert.match(df, /\/etc\/nginx\/templates\/default\.conf\.template/);
    assert.match(df, /WIDGET_FRAME_ANCESTORS=""/);
    assert.match(df, /WIDGET_FONT_CSS_URL="https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard@v1\.3\.9\//);
  }
});
