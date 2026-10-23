// PDFs of the Go2Joy manual pages that set `pdf: true` in build-manual.mjs:
// {doc}.{lang}.html -> {doc}.{lang}.pdf (A4, print colours, light theme).
//   node scripts/go2joy-manual/build-pdf.mjs apps/web/public/manual/go2joy work-request ha-identify
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [DIR, ...docs] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.EXE });
for (const doc of docs) for (const lang of ['ko', 'en', 'vi']) {
  const html = path.resolve(DIR, `${doc}.${lang}.html`);
  const p = await browser.newPage({ colorScheme: 'light' });
  await p.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' });
  await p.evaluate(async () => { await document.fonts.ready; });
  // The page nav and download chips are for the web page only.
  await p.addStyleTag({ content: '.topnav{display:none} .scroll{overflow:visible} table{font-size:11px} pre{white-space:pre-wrap;word-break:break-all}' });
  await p.pdf({ path: path.resolve(DIR, `${doc}.${lang}.pdf`), format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
  await p.close();
  console.log('pdf', doc, lang);
}
await browser.close();
