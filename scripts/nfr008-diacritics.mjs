#!/usr/bin/env node
/**
 * NFR-008 — Vietnamese diacritics in monospace (PLN-261012 SG-53).
 *
 * Stacked Vietnamese tone marks (ễ ợ ữ ặ ậ …) are where monospace fonts
 * misbehave: the mark falls back to a proportional font (alignment breaks),
 * a decomposed sequence (e + ̂ + ̃) takes two cells, or the mark pokes out of the
 * line box and gets clipped. The widget's `RichText` inline code and the
 * console's `font-mono` textareas are the places Vietnamese text lands in a
 * monospace face. This renders them in a real Chrome and reports, per context:
 *
 *   - the platform fonts Chrome actually used (CDP CSS.getPlatformFontsForNode),
 *     so a silent fallback shows up by name;
 *   - whether a stacked-mark glyph occupies exactly one monospace cell, in
 *     precomposed (NFC) and decomposed (NFD) form;
 *   - whether the ink of the tallest/lowest mark stays inside the line box
 *     (clipping risk when an ancestor hides overflow);
 *
 * and writes PNG screenshots for a human to look at. It is a HARNESS: it applies
 * the same class lists to the same DOM shapes as the components, using the CSS the
 * real apps build — it does not drive the running app. What it shows depends on
 * the monospace fonts of the machine it runs on, so run it on the OS the users
 * have (Windows / macOS / Linux) and read the "fonts used" column.
 *
 *   node scripts/nfr008-diacritics.mjs                     # builds both CSS bundles, then renders
 *   node scripts/nfr008-diacritics.mjs --no-build          # reuse out/nfr008-diacritics/build
 *   node scripts/nfr008-diacritics.mjs --out some/dir
 *   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/nfr008-diacritics.mjs
 *
 * Output goes to out/nfr008-diacritics/ (gitignored): *.png, report.json, report.md.
 * Exit code 1 when a hard check fails (fallback font for a mark, or a width
 * mismatch beyond 0.5px); the line-box check only warns.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(ROOT, arg('--out', 'out/nfr008-diacritics'));
const BUILD = path.join(OUT, 'build');
const NO_BUILD = process.argv.includes('--no-build');
const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH || 'C:/Github/Work/node_modules/playwright';

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

// ----------------------------------------------------------------------------- CSS
function buildCss(app) {
  const dir = path.join(BUILD, app);
  if (!NO_BUILD) {
    log(`building ${app} CSS …`);
    execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], {
      cwd: path.join(ROOT, 'apps', app),
      // './' keeps asset URLs relative; only the stylesheet is used here.
      env: { ...process.env, VITE_BASE: './' },
      stdio: 'inherit',
      shell: true,
    });
  }
  const assets = path.join(dir, 'assets');
  const css = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith('.css')) : [];
  if (!css.length) throw new Error(`no built CSS in ${assets} (run without --no-build)`);
  return pathToFileURL(path.join(assets, css[0])).href;
}

// -------------------------------------------------------------------------- samples
/** Stacked marks first: these are the glyphs a monospace face is most likely to lack. */
const STACKED = 'ễ ợ ữ ặ ậ ẫ ỗ ở ử ỹ ỷ ỵ ẩ ẳ ẵ ế ề ể ệ ố ồ ổ ộ ớ ờ ỡ ứ ừ ự'.split(' ');
const UPPER = 'ỄỢỮẶẬẪỖỞỬỸ';
const SENTENCES = [
  'Nhập mã ĐỐI-SOÁT-2026 rồi chọn Xác nhận',
  'Quản lý khách sạn: Nguyễn Thị Hương',
  'ữ ợ ễ ặ ậ — tiếng Việt có dấu',
];

const nfc = (s) => s.normalize('NFC');
const nfd = (s) => s.normalize('NFD');

// ---------------------------------------------------------------------------- HTML
function page(widgetCss) {
  const rows = (fn) => [nfc, nfd].map(fn).join('');
  const sentence = (s, f) => `<p>${f(s)}</p>`;
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<link rel="stylesheet" href="${widgetCss}">
<style>
  body { margin: 16px; background: #fff; font-family: sans-serif; }
  .ctx { margin: 0 0 24px; }
  .ctx > h2 { font: 600 12px sans-serif; color: #555; margin: 0 0 6px; }
  .frame { width: 404px; }
  .cell-probe { display: inline-block; white-space: pre; }
</style></head><body>

<!-- 1. Widget chat bubble with inline code, exactly as MessageBubble > RichText renders it. -->
<section class="ctx" data-ctx="widget-bubble-code">
  <h2>widget · bubble inline code (text-sm, code text-[0.92em])</h2>
  <div class="frame"><div class="group flex justify-start"><div class="max-w-[85%]">
    <div class="st-message break-words rounded-st-lg px-3.5 py-2.5 text-sm st-message-bot bg-gray-100 text-gray-800">
      ${rows((f) => `<p class="[&:not(:first-child)]:mt-2">Mã: <code data-probe data-form="${f === nfc ? 'NFC' : 'NFD'}" class="rounded-st-xs bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">${f(STACKED.join(' '))}</code></p>
      <p class="[&:not(:first-child)]:mt-2"><code data-probe data-form="${f === nfc ? 'NFC' : 'NFD'}" class="rounded-st-xs bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">${f(UPPER)}</code></p>`)}
      ${SENTENCES.map((s) => sentence(s, (x) => `<code class="rounded-st-xs bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">${nfc(x)}</code>`)).join('')}
    </div></div></div></div>
</section>

<!-- 2. Console textareas (font-mono text-xs / text-sm). -->
<section class="ctx" data-ctx="console-textarea-xs">
  <h2>console · textarea font-mono text-xs (AnswerFooterSection, RegressionSection)</h2>
  ${rows((f) => `<textarea data-probe data-form="${f === nfc ? 'NFC' : 'NFD'}" rows="3" class="web mb-2 w-full rounded-lg border border-gray-300 p-2 font-mono text-xs" style="width:420px" readonly>${f(STACKED.join(' ') + '\n' + UPPER + '\n' + SENTENCES.join('\n'))}</textarea>`)}
</section>
<section class="ctx" data-ctx="console-textarea-sm">
  <h2>console · textarea font-mono text-sm (JourneyCriteriaCard, UsageTypeEditor)</h2>
  ${rows((f) => `<textarea data-probe data-form="${f === nfc ? 'NFC' : 'NFD'}" rows="3" class="web mb-2 w-full rounded-lg border border-gray-300 p-2 font-mono text-sm" style="width:420px" readonly>${f(STACKED.join(' ') + '\n' + UPPER + '\n' + SENTENCES.join('\n'))}</textarea>`)}
</section>

<!-- 3. Console inline code chip (web RichText). -->
<section class="ctx" data-ctx="console-code-chip">
  <h2>console · RichText inline code (rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em])</h2>
  <div class="text-sm" style="width:420px">${rows((f) => `<p>Mã: <code data-probe data-form="${f === nfc ? 'NFC' : 'NFD'}" class="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">${f(STACKED.join(' '))}</code></p>`)}</div>
</section>

<!-- Cell-width probes: N copies of 'e' against N stacked-mark glyphs, same font as each context. -->
<section id="probes"></section>
</body></html>`;
}

// --------------------------------------------------------------------------- measure
/** Runs in the page: widths against plain 'e', and ink extent against the line box. */
function measureInPage(sel) {
  const el = document.querySelector(sel);
  const cs = getComputedStyle(el);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const lineHeight = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
  const mk = (txt) => {
    const s = document.createElement('span');
    s.style.cssText = `font:${font};white-space:pre;position:absolute;visibility:hidden;left:-9999px`;
    s.textContent = txt;
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return w;
  };
  const N = 10;
  const marks = ['ễ', 'ợ', 'ữ', 'ặ', 'ậ', 'ẫ', 'ỗ', 'ở', 'ử', 'ỹ'];
  const plain = mk('e'.repeat(N));
  const perGlyph = marks.map((m) => ({ glyph: m, nfc: mk(m.normalize('NFC').repeat(N)) / plain, nfd: mk(m.normalize('NFD').repeat(N)) / plain }));
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = font;
  let asc = 0;
  let desc = 0;
  for (const m of marks.concat('ỆỢỮẶẬ'.split(''))) {
    const t = ctx.measureText(m);
    asc = Math.max(asc, t.actualBoundingBoxAscent);
    desc = Math.max(desc, t.actualBoundingBoxDescent);
  }
  const fb = ctx.measureText('ễ');
  return {
    font,
    lineHeight,
    inkAscent: asc,
    inkDescent: desc,
    fontAscent: fb.fontBoundingBoxAscent,
    fontDescent: fb.fontBoundingBoxDescent,
    // 1.0 = every glyph takes exactly one cell like 'e'.
    nfcRatios: perGlyph.map((g) => +g.nfc.toFixed(3)),
    nfdRatios: perGlyph.map((g) => +g.nfd.toFixed(3)),
    cellPx: plain / N,
  };
}

async function main() {
  const widgetCss = buildCss('widget');
  const webCss = buildCss('web');
  // The web stylesheet is appended for the console contexts (`.web` marks them);
  // Tailwind utility names overlap, so load it second and scope by DOM, not by sheet.
  const html = page(widgetCss).replace('</head>', `<link rel="stylesheet" href="${webCss}"></head>`);
  const htmlPath = path.join(OUT, 'harness.html');
  fs.writeFileSync(htmlPath, html);

  const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 560, height: 1400 }, deviceScaleFactor: 2, locale: 'vi-VN' });
  const pg = await context.newPage();
  await pg.goto(pathToFileURL(htmlPath).href);
  await pg.waitForLoadState('load');
  const version = browser.version();

  const cdp = await context.newCDPSession(pg);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });

  const report = { chrome: version, platform: process.platform, contexts: [], failures: [], warnings: [] };
  const ctxs = await pg.$$eval('[data-ctx]', (els) => els.map((e) => e.getAttribute('data-ctx')));
  for (const name of ctxs) {
    const probes = await pg.$$(`[data-ctx="${name}"] [data-probe]`);
    for (const probe of probes) {
      const form = await probe.getAttribute('data-form');
      const id = `p${Math.random().toString(36).slice(2, 8)}`;
      await probe.evaluate((el, i) => el.setAttribute('id', i), id);
      const m = await pg.evaluate(measureInPage, `#${id}`);
      let fonts = [];
      try {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${id}` });
        const res = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        fonts = res.fonts.map((f) => ({ family: f.familyName, glyphs: f.glyphCount }));
      } catch {
        /* a textarea's inner editor is not always reachable — the width ratios still decide */
      }
      const families = [...new Set(fonts.map((f) => f.family))];
      // Within half a pixel of one cell per glyph.
      const cellOk = (arr) => arr.every((r) => Math.abs(r - 1) * m.cellPx <= 0.5);
      const row = {
        context: name,
        form,
        fontsUsed: families.length ? fonts : 'n/a (not reachable for this node)',
        fallbackFamilies: families.length > 1 ? families : [],
        cellPx: +m.cellPx.toFixed(2),
        nfcOneCell: cellOk(m.nfcRatios),
        nfdOneCell: cellOk(m.nfdRatios),
        nfcRatios: m.nfcRatios,
        nfdRatios: m.nfdRatios,
        inkWithinLine: m.inkAscent + m.inkDescent <= m.lineHeight,
        inkPx: +(m.inkAscent + m.inkDescent).toFixed(1),
        lineHeightPx: +m.lineHeight.toFixed(1),
        font: m.font,
      };
      report.contexts.push(row);
      if (row.fallbackFamilies.length) report.failures.push(`${name} ${form}: a fallback font renders part of the text (${families.join(', ')})`);
      if (form === 'NFC' && !row.nfcOneCell) report.failures.push(`${name}: a precomposed mark is not one monospace cell wide (${m.nfcRatios.join(' ')})`);
      // NFD is informational: IMEs that emit decomposed text are rarer, and what to do is a product decision.
      if (form === 'NFD' && !row.nfdOneCell) report.warnings.push(`${name}: decomposed (NFD) marks are not one cell wide — normalise to NFC on input if this matters`);
      if (!row.inkWithinLine) report.warnings.push(`${name} ${form}: tall marks (${row.inkPx}px ink) exceed the ${row.lineHeightPx}px line box — clipped if an ancestor hides overflow`);
    }
    const target = await pg.$(`[data-ctx="${name}"]`);
    await target.screenshot({ path: path.join(OUT, `${name}.png`) });
    log('screenshot', `${name}.png`);
  }
  await browser.close();

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const md = [
    `# NFR-008 Vietnamese diacritics in monospace`,
    ``,
    `Chrome ${version} on ${process.platform}. Fonts depend on this machine — read "fonts used".`,
    ``,
    `| context | form | fonts used (glyphs) | 1 cell NFC | 1 cell NFD | ink / line box |`,
    `|---|---|---|---|---|---|`,
    ...report.contexts.map((r) =>
      `| ${r.context} | ${r.form} | ${Array.isArray(r.fontsUsed) ? r.fontsUsed.map((f) => `${f.family} (${f.glyphs})`).join(', ') : r.fontsUsed} | ${r.nfcOneCell ? 'yes' : '**NO**'} | ${r.nfdOneCell ? 'yes' : 'no'} | ${r.inkPx}px / ${r.lineHeightPx}px${r.inkWithinLine ? '' : ' **over**'} |`,
    ),
    ``,
    report.failures.length ? `## Failures\n${report.failures.map((f) => `- ${f}`).join('\n')}` : `## Failures\nnone`,
    ``,
    report.warnings.length ? `## Warnings\n${report.warnings.map((f) => `- ${f}`).join('\n')}` : `## Warnings\nnone`,
    ``,
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  log(md);
  log(`\nwritten to ${path.relative(process.cwd(), OUT) || OUT}`);
  process.exit(report.failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
