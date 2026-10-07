#!/usr/bin/env node
/**
 * Convert a SharpTalk manual markdown (the subset used under apps/web/public/manual)
 * into the hand-built HTML template used by the other manuals.
 *
 *   node scripts/manual-md2html.mjs apps/web/public/manual/custom-widget.ko.md
 *
 * The head/style block is copied verbatim from knowledge-ai.{lang}.html so the
 * look stays identical; everything below <body> is generated from the markdown.
 * Per-document strings (eyebrow, lead, "see also") live in DOC_META below.
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: manual-md2html.mjs <manual>.<lang>.md'); process.exit(1); }
const dir = path.dirname(file);
const base = path.basename(file, '.md'); // custom-widget.ko
const [doc, lang] = base.split('.');
const md = fs.readFileSync(file, 'utf8');
const template = fs.readFileSync(path.join(dir, `knowledge-ai.${lang}.html`), 'utf8');
const head = template.slice(0, template.indexOf('<body>') + '<body>'.length);

const NAV = {
  ko: { list: '← 매뉴얼 목록', md: 'MD 원문', toc: '목차', navLabel: '매뉴얼 내비게이션', tocLabel: '목차', langs: { ko: '한국어', en: 'English', vi: 'Tiếng Việt' }, seeAlso: '함께 보기 →' },
  en: { list: '← All manuals', md: 'Raw MD', toc: 'Contents', navLabel: 'Manual navigation', tocLabel: 'Contents', langs: { ko: '한국어', en: 'English', vi: 'Tiếng Việt' }, seeAlso: 'See also →' },
  vi: { list: '← Danh sách sổ tay', md: 'Bản MD', toc: 'Mục lục', navLabel: 'Điều hướng sổ tay', tocLabel: 'Mục lục', langs: { ko: '한국어', en: 'English', vi: 'Tiếng Việt' }, seeAlso: 'Xem thêm →' },
};
const DOC_META = {
  'custom-widget': {
    ko: { eyebrow: 'SharpTalk 사용자설명서 · 커스텀 위젯', title: '샵톡 커스텀 위젯 만들기 매뉴얼', next: '<a href="user-manual.ko.html">통합 사용자 매뉴얼</a> 14장(테넌트 설정)·16장(플랫폼 관리자), <a href="quick-setup.ko.html">간단 세팅 매뉴얼</a> 5장(위젯 설치·테마).' },
    en: { eyebrow: 'SharpTalk User Guides · Custom widgets', title: 'SharpTalk Custom Widget Manual', next: '<a href="user-manual.en.html">Complete User Manual</a> Ch. 14 (tenant settings) · Ch. 16 (platform admin), <a href="quick-setup.en.html">Quick Setup Manual</a> Ch. 5 (widget install · theme).' },
    vi: { eyebrow: 'Tài liệu SharpTalk · Widget tùy chỉnh', title: 'Sổ tay tạo widget tùy chỉnh SharpTalk', next: '<a href="user-manual.vi.html">Sổ tay tổng hợp</a> chương 14 (cài đặt tenant) · chương 16 (quản trị nền tảng), <a href="quick-setup.vi.html">Sổ tay cài đặt nhanh</a> chương 5 (cài widget · chủ đề).' },
  },
  'cafe24-integration': {
    ko: { eyebrow: 'SharpTalk 사용자설명서 · 카페24 연동', title: '샵톡 카페24 연동 작업 가이드', next: '<a href="platform-integration.ko.html">커머스 연동 자격증명 가이드</a>(값 발급 위치), <a href="quick-setup.ko.html">간단 세팅 매뉴얼</a>(테넌트 개설·위젯 설치), <a href="knowledge-ai.ko.html">지식 등록·AI 설정 매뉴얼</a>(카탈로그 동기화 이후).' },
    en: { eyebrow: 'SharpTalk User Guides · Cafe24 integration', title: 'SharpTalk Cafe24 Integration Guide', next: '<a href="platform-integration.en.html">Commerce Integration Credentials</a> (where values come from), <a href="quick-setup.en.html">Quick Setup Manual</a> (tenant creation · widget install), <a href="knowledge-ai.en.html">Knowledge &amp; AI Settings Manual</a> (after catalog sync).' },
    vi: { eyebrow: 'Tài liệu SharpTalk · Tích hợp Cafe24', title: 'Hướng dẫn tích hợp Cafe24 cho SharpTalk', next: '<a href="platform-integration.vi.html">Hướng dẫn thông tin xác thực</a> (nơi lấy các giá trị), <a href="quick-setup.vi.html">Sổ tay cài đặt nhanh</a> (tạo tenant · cài widget), <a href="knowledge-ai.vi.html">Sổ tay tri thức &amp; AI</a> (sau khi đồng bộ catalog).' },
  },
};
const nav = NAV[lang];
const meta = DOC_META[doc]?.[lang];
if (!nav || !meta) { console.error(`no template strings for ${doc}/${lang}`); process.exit(1); }

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(（])\*([^*\s][^*]*?)\*(?=[\s).,，。:：）]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${h.replace(/\.md$/, '.html')}">${t}</a>`);
  return s;
}

const lines = md.split('\n');
let i = 0;
let title = '';
const metaLines = [];
const sections = []; // {num, title, html[]}
let cur = null;
let lead = '';
const out = (h) => (cur ? cur.html.push(h) : null);
const isTable = (l) => /^\|.*\|\s*$/.test(l);

// ---- header: "# title", "> meta" lines, then the lead paragraph until "---"
while (i < lines.length) {
  const l = lines[i];
  if (l.startsWith('# ')) { title = l.slice(2).trim(); i++; continue; }
  if (l.startsWith('> ')) { metaLines.push(l.slice(2).trim()); i++; continue; }
  if (l.trim() === '---') { i++; break; }
  if (l.trim()) lead += (lead ? ' ' : '') + l.trim();
  i++;
}
// skip the markdown TOC block ("## 목차" list) up to the next "---"
if (lines[i]?.startsWith('## ')) {
  while (i < lines.length && lines[i].trim() !== '---') i++;
  i++;
}

function flushPara(buf) {
  if (buf.length) { out(`  <p>${inline(buf.join(' '))}</p>`); buf.length = 0; }
}

const para = [];
let inFaq = false;
let faqOpen = false;
const closeFaq = () => { if (faqOpen) { out('  </dl>'); faqOpen = false; } };

while (i < lines.length) {
  const l = lines[i];
  // section
  let m = l.match(/^## (\d+)\.\s+(.*)$/);
  if (m) {
    flushPara(para); closeFaq();
    cur = { num: m[1], title: m[2].trim(), html: [] };
    sections.push(cur);
    inFaq = /FAQ/i.test(cur.title);
    i++; continue;
  }
  m = l.match(/^### (.*)$/);
  if (m) { flushPara(para); closeFaq(); out(`  <h3>${inline(m[1].trim())}</h3>`); i++; continue; }
  if (l.trim() === '---' || l.trim() === '') { flushPara(para); i++; continue; }
  // fenced code
  if (l.startsWith('```')) {
    flushPara(para); closeFaq();
    const buf = []; i++;
    while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
    i++;
    out(`  <pre><code>${esc(buf.join('\n'))}</code></pre>`);
    continue;
  }
  // figure
  m = l.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
  if (m) {
    flushPara(para); closeFaq();
    out(`  <figure class="shot"><img src="${m[2]}" alt="${esc(m[1])}" loading="lazy"><figcaption>${esc(m[1])}</figcaption></figure>`);
    i++; continue;
  }
  // callout: "💡 **팁**: text" / "⚠️ **label**: text" / "⚠️ text"
  m = l.match(/^(💡|⚠️)\s*(?:\*\*([^*]+)\*\*\s*[:：]?\s*)?(.*)$/);
  if (m) {
    flushPara(para); closeFaq();
    const buf = [m[3]]; i++;
    while (i < lines.length && lines[i].trim() && !/^(💡|⚠️|#|!\[|```|\||- |\d+\. |\*\*Q\.)/.test(lines[i])) buf.push(lines[i++].trim());
    const warn = m[1] === '⚠️';
    const label = m[2] ? `${m[1]} ${m[2]}` : (warn ? '⚠️' : '💡');
    out(`  <div class="callout${warn ? ' warn' : ''}"><span class="c-label">${esc(label)}</span>\n    <p>${inline(buf.join(' '))}</p></div>`);
    continue;
  }
  // table
  if (isTable(l)) {
    flushPara(para); closeFaq();
    const rows = [];
    while (i < lines.length && isTable(lines[i])) rows.push(lines[i++]);
    const cells = (r) => r.trim().slice(1, -1).split('|').map((c) => c.trim());
    const body = rows.filter((r) => !/^\|\s*-{3,}/.test(r));
    const [h, ...rest] = body;
    let t = '  <div class="tablewrap"><table>\n';
    t += `    <tr>${cells(h).map((c) => `<th>${inline(c)}</th>`).join('')}</tr>\n`;
    for (const r of rest) t += `    <tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>\n`;
    t += '  </table></div>';
    out(t);
    continue;
  }
  // lists
  if (/^- \[ \] /.test(l)) {
    flushPara(para); closeFaq();
    const items = [];
    while (i < lines.length && /^- \[ \] /.test(lines[i])) items.push(lines[i++].replace(/^- \[ \] /, ''));
    out(`  <ul class="check">\n${items.map((x) => `    <li>${inline(x)}</li>`).join('\n')}\n  </ul>`);
    continue;
  }
  if (/^- /.test(l)) {
    flushPara(para); closeFaq();
    const items = [];
    while (i < lines.length && (/^- /.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
      if (/^- /.test(lines[i])) items.push(lines[i].slice(2)); else items[items.length - 1] += ' ' + lines[i].trim();
      i++;
    }
    out(`  <ul>\n${items.map((x) => `    <li>${inline(x)}</li>`).join('\n')}\n  </ul>`);
    continue;
  }
  if (/^\d+\. /.test(l)) {
    flushPara(para); closeFaq();
    const items = [];
    while (i < lines.length && (/^\d+\. /.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
      if (/^\d+\. /.test(lines[i])) items.push(lines[i].replace(/^\d+\. /, '')); else items[items.length - 1] += ' ' + lines[i].trim();
      i++;
    }
    out(`  <ol class="steps">\n${items.map((x) => `    <li>${inline(x)}</li>`).join('\n')}\n  </ol>`);
    continue;
  }
  // FAQ entries: "**Q. …**" followed by answer lines
  m = inFaq && l.match(/^\*\*(Q\..*)\*\*\s*$/);
  if (m) {
    flushPara(para);
    if (!faqOpen) { out('  <dl class="faq">'); faqOpen = true; }
    const ans = []; i++;
    while (i < lines.length && lines[i].trim() && !/^\*\*Q\./.test(lines[i])) ans.push(lines[i++].trim());
    out(`    <dt>${inline(m[1])}</dt>\n    <dd>${inline(ans.join(' '))}</dd>`);
    continue;
  }
  // bold-only line = sub-heading
  m = l.match(/^\*\*([^*]+)\*\*\s*$/);
  if (m && !inFaq) { flushPara(para); out(`  <p><strong>${inline(m[1])}</strong></p>`); i++; continue; }
  para.push(l.trim()); i++;
}
flushPara(para); closeFaq();

const langLinks = ['ko', 'en', 'vi'].map((l) => (l === lang ? `<span class="cur">${nav.langs[l]}</span>` : `<a href="${doc}.${l}.html">${nav.langs[l]}</a>`)).join('');
let html = head + '\n\n<div class="shell">\n';
html += `<nav class="pagenav" aria-label="${nav.navLabel}"><a href="./">${nav.list}</a><span>·</span>${langLinks}<span>·</span><a href="${doc}.${lang}.md">${nav.md}</a></nav>\n`;
html += '<header class="hero">\n';
html += `  <div class="eyebrow">${esc(meta.eyebrow)}</div>\n  <h1>${esc(meta.title)}</h1>\n`;
html += `  <div class="meta">${metaLines.slice(0, 2).map((x) => `<span>${inline(x).replace(/<\/?strong>/g, '')}</span>`).join('')}</div>\n`;
html += `  <p class="lead">${inline(lead)}</p>\n</header>\n\n`;
html += `<nav class="toc" aria-label="${nav.tocLabel}">\n  <div class="toc-label">${nav.toc}</div>\n`;
for (const s of sections) html += `  <a href="#ch${s.num}"><span class="n">${s.num}</span>${esc(s.title.replace(/\s*[—-]\s*.*$/, ''))}</a>\n`;
html += '</nav>\n\n<main>\n\n';
for (const s of sections) {
  html += `<section id="ch${s.num}">\n  <div class="ch"><span class="num">${String(s.num).padStart(2, '0')}</span><h2>${inline(s.title)}</h2></div>\n`;
  html += s.html.join('\n') + '\n</section>\n\n';
}
html += `<div class="next">\n  <strong>${nav.seeAlso}</strong> ${meta.next}\n</div>\n\n</main>\n</div>\n\n</body>\n</html>\n`;
// title tag
html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
const outFile = path.join(dir, `${base}.html`);
fs.writeFileSync(outFile, html);
console.log('wrote', outFile, `${sections.length} sections`);
