// Go2Joy manual pages (apps/web/public/manual/go2joy): {doc}.{lang}.md -> {doc}.{lang}.html + index.html.
// Mermaid is rendered to inline SVG at build time, so the published pages need no script.
//   npm i --no-save marked@12 playwright  (once)
//   node scripts/go2joy-manual/build-manual.mjs apps/web/public/manual/go2joy apps/web/public/manual/go2joy
//   EXE=<chromium path> is optional (defaults to the playwright browser).
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright';

const [SRC, OUT] = process.argv.slice(2);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const LANGS = ['ko', 'en', 'vi'];
const LANG_NAME = { ko: '한국어', en: 'English', vi: 'Tiếng Việt' };
const DOCS = {
  integration: {
    date: '2026-10-22',
    ko: { title: 'Go2Joy 연동 요청 사항과 작업 체크리스트', short: '요청 사항·체크리스트', desc: '전체 연동 구조 그림, Go2Joy 요청 G1~G47(우선순위·상태), Go2Joy·SharpTalk 체크리스트, 일정 영향, 결정 요약' },
    en: { title: 'Go2Joy Integration Requests and Checklist', short: 'Requests & checklist', desc: 'Integration architecture diagrams, requests to Go2Joy G1–G47 (priority, status), Go2Joy and SharpTalk checklists, schedule impact, decisions' },
    vi: { title: 'Yêu cầu tích hợp Go2Joy và danh sách công việc', short: 'Yêu cầu & checklist', desc: 'Sơ đồ kiến trúc tích hợp, yêu cầu gửi Go2Joy G1–G47 (ưu tiên, trạng thái), checklist của Go2Joy và SharpTalk, ảnh hưởng tiến độ, các quyết định' },
  },
  plan: {
    ko: { title: 'SharpTalk for Go2Joy 프로젝트 계획서', short: '프로젝트 계획서', desc: '1단계 범위·이용 시나리오·시퀀스 다이어그램·일정·진행 현황·결정 사항' },
    en: { title: 'SharpTalk for Go2Joy Project Plan', short: 'Project plan', desc: 'Phase 1 scope, user scenarios, sequence diagrams, schedule, progress and open decisions' },
    vi: { title: 'Kế hoạch dự án SharpTalk for Go2Joy', short: 'Kế hoạch dự án', desc: 'Phạm vi giai đoạn 1, kịch bản sử dụng, sơ đồ tuần tự, lịch trình, tiến độ và các quyết định cần đưa ra' },
  },
  'kb-conflicts': {
    ko: { title: 'Go2Joy 지식 충돌 78건 분류', short: '지식 충돌 분류', desc: '스테이징 지식 충돌 78건의 분류·권장 조치·Go2Joy 결정 사항' },
    en: { title: 'Go2Joy Knowledge Conflict Triage (78 pairs)', short: 'Knowledge conflict triage', desc: 'Classification of 78 staging knowledge conflicts, recommended actions and decisions for Go2Joy' },
    vi: { title: 'Phân loại 78 xung đột tri thức Go2Joy', short: 'Phân loại xung đột tri thức', desc: 'Phân loại 78 xung đột tri thức trên staging, hành động đề xuất và các quyết định của Go2Joy' },
  },
  'notion-setup': {
    date: '2026-10-19',
    ko: { title: 'Go2Joy 노션 지식 연동 설정 가이드', short: '노션 연동 설정', desc: '노션 페이지를 SharpTalk 지식으로 쓰기 위해 Go2Joy 노션 관리자가 할 일 — 통합 연결·워크스페이스·ID 확인·토큰 교체 주의·자가 확인' },
    en: { title: 'Go2Joy Notion Knowledge Setup Guide', short: 'Notion setup', desc: 'What the Go2Joy Notion admin must do so SharpTalk can read Notion pages as knowledge: connect pages, check workspace and IDs, token caveats, self-check' },
    vi: { title: 'Hướng dẫn kết nối Notion với SharpTalk cho Go2Joy', short: 'Kết nối Notion', desc: 'Việc quản trị Notion của Go2Joy cần làm để SharpTalk đọc được trang Notion làm tri thức: kết nối trang, kiểm tra workspace và ID, lưu ý token, tự kiểm tra' },
  },
};
const UI = {
  ko: { home: '← Go2Joy 문서 목록', docs: '문서', lang: '언어', eyebrow: 'Go2Joy 전용 문서', foot: 'Amoeba(BitBiz) · SharpTalk for Go2Joy', idxTitle: 'SharpTalk for Go2Joy 문서', idxLead: 'Go2Joy와 함께 보는 1단계 계획·진행 문서입니다. 언어를 고르세요.', open: '열기' },
  en: { home: '← Go2Joy documents', docs: 'Documents', lang: 'Language', eyebrow: 'Documents for Go2Joy', foot: 'Amoeba(BitBiz) · SharpTalk for Go2Joy', idxTitle: 'SharpTalk for Go2Joy documents', idxLead: 'Phase 1 plan and progress documents shared with Go2Joy. Choose a language.', open: 'Open' },
  vi: { home: '← Tài liệu Go2Joy', docs: 'Tài liệu', lang: 'Ngôn ngữ', eyebrow: 'Tài liệu dành cho Go2Joy', foot: 'Amoeba(BitBiz) · SharpTalk for Go2Joy', idxTitle: 'Tài liệu SharpTalk for Go2Joy', idxLead: 'Tài liệu kế hoạch và tiến độ giai đoạn 1 chia sẻ với Go2Joy. Hãy chọn ngôn ngữ.', open: 'Mở' },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');
const css = fs.readFileSync(path.join(HERE, 'page.css'), 'utf8') + `
/* Diagrams are pre-rendered in mermaid's light theme: keep their card light in both themes. */
.diagram { background: #fbfaf8; border-color: #e3ddd4; }
.diagram svg { max-width: 100%; height: auto; }
@media (max-width: 700px) { .diagram svg { min-width: 620px; } }
/* Drawn SVG figures (fixed-size boxes): scroll sideways on phones rather than shrink the labels. */
figure:has(> img[src$=".svg"]) { overflow-x: auto; justify-items: stretch; }
figure > img[src$=".svg"] { width: 100%; max-height: none; background: #ffffff; }
@media (max-width: 700px) { figure > img[src$=".svg"] { min-width: 760px; max-width: none; } }
/* Labels were measured with browser defaults; inherit nothing that changes their size. */
.diagram { font-size: 16px; line-height: normal; word-break: normal; overflow-wrap: normal; letter-spacing: normal; }
.topnav { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; font-size: 13px; }
.topnav a { color: var(--accent-ink); text-decoration: none; }
.topnav a:hover { text-decoration: underline; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-block; padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; color: var(--fg) !important; }
.chip[aria-current="page"] { border-color: var(--accent); color: var(--accent-ink) !important; font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin: 18px 0 30px; }
.card { display: grid; gap: 6px; padding: 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); text-decoration: none; color: var(--fg); }
.card:hover { border-color: var(--accent); }
.card b { font-size: 16px; }
.card span { font-size: 13px; color: var(--muted); }
.langblock h2 { margin-top: 28px; }
`;
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@500;600;700&family=Noto+Sans+KR:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap">';
const shell = (lang, title, desc, inner) => `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${fonts}
<style>${css}</style>
</head>
<body>
${inner}
</body>
</html>
`;

function render(md, lang) {
  md = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  const r = new marked.Renderer();
  r.heading = (text, level, raw) => `<h${level} id="${slug(raw)}">${text}</h${level}>\n`;
  r.code = (code, l) => l === 'mermaid'
    ? `<div class="diagram"><pre class="mermaid">${esc(code)}</pre></div>\n`
    : `<div class="scroll"><pre class="code"><code>${esc(code)}</code></pre></div>\n`;
  r.table = (h, b) => `<div class="scroll"><table><thead>${h}</thead><tbody>${b}</tbody></table></div>\n`;
  r.image = (href, t, text) => `<figure><img src="${href.replace(/^img\/[^/]+\//, 'img/')}" alt="${esc(text)}" loading="lazy"></figure>`;
  r.link = (href, t, text) => {
    if (href.startsWith('#') || href.startsWith('http')) return `<a href="${href}">${text}</a>`;
    if (/RPT-261015-Go2Joy-KB-Conflict-Triage/.test(href)) return `<a href="kb-conflicts.${lang}.html">${text}</a>`;
    if (/PLN-261015-SharpTalk-for-Go2Joy/.test(href)) return `<a href="plan.${lang}.html">${text}</a>`;
    return `<span class="docref">${text}</span>`;
  };
  let body = marked.parse(md, { renderer: r, gfm: true });
  body = body.replace(/<p>(<figure>.*?<\/figure>)<\/p>\s*<p><em>(.*?)<\/em><\/p>/gs, (_, f, c) => f.replace('</figure>', `<figcaption>${c}</figcaption></figure>`));
  return body.replace('<blockquote>', '<blockquote class="lead">');
}

function page(doc, lang, body) {
  const m = DOCS[doc][lang], u = UI[lang];
  const langChips = LANGS.map((l) => `<a class="chip" href="${doc}.${l}.html"${l === lang ? ' aria-current="page"' : ''} hreflang="${l}">${LANG_NAME[l]}</a>`).join('');
  const docChips = Object.keys(DOCS).map((d) => `<a class="chip" href="${d}.${lang}.html"${d === doc ? ' aria-current="page"' : ''}>${esc(DOCS[d][lang].short)}</a>`).join('');
  return shell(lang, m.title, m.desc, `<header class="masthead"><div class="wrap">
  <nav class="topnav"><a href="./">${u.home}</a><span class="chips" aria-label="${u.docs}">${docChips}</span><span class="chips" aria-label="${u.lang}">${langChips}</span></nav>
  <p class="eyebrow">${u.eyebrow} · ${DOCS[doc].date || '2026-10-15'}</p>
  <p class="brand"><span class="mark">SharpTalk</span> for <span class="g2j">Go2Joy</span></p>
  <p class="domain">${esc(m.title)}</p>
</div></header>
<main class="wrap doc">${body}</main>
<footer class="wrap foot">${u.foot}</footer>`);
}

function index() {
  const blocks = LANGS.map((l) => `<section class="langblock" lang="${l}" id="${l}"><h2>${LANG_NAME[l]}</h2><p>${esc(UI[l].idxLead)}</p><div class="cards">${
    Object.keys(DOCS).map((d) => `<a class="card" href="${d}.${l}.html"><b>${esc(DOCS[d][l].title)}</b><span>${esc(DOCS[d][l].desc)}</span></a>`).join('')}</div></section>`).join('\n');
  // Browser language first; the order of sections is the only thing that changes.
  const script = `<script>(function(){try{var l=(navigator.language||'').slice(0,2);var s=document.getElementById(l);if(s&&s.previousElementSibling){s.parentNode.insertBefore(s,s.parentNode.firstElementChild);}}catch(e){}})();</script>`;
  return shell('en', 'SharpTalk for Go2Joy', UI.en.idxLead, `<header class="masthead"><div class="wrap">
  <p class="eyebrow">Go2Joy · 한국어 · English · Tiếng Việt</p>
  <p class="brand"><span class="mark">SharpTalk</span> for <span class="g2j">Go2Joy</span></p>
  <p class="domain">sharptalk.go2joy.vn</p>
</div></header>
<main class="wrap doc"><div id="langs">${blocks}</div></main>
<footer class="wrap foot">Amoeba(BitBiz) · SharpTalk for Go2Joy</footer>
${script}`);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.EXE });
const mermaidJs = await (await fetch('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js')).text();
for (const doc of Object.keys(DOCS)) for (const lang of LANGS) {
  const src = path.join(SRC, `${doc}.${lang}.md`);
  if (!fs.existsSync(src)) { console.log('skip', src); continue; }
  const body = render(fs.readFileSync(src, 'utf8'), lang);
  const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await p.setContent(`<!doctype html><meta charset="utf-8">${fonts}<style>body{font-family:'Noto Sans KR','Be Vietnam Pro',sans-serif}</style><main>${body}</main>`, { waitUntil: 'networkidle' });
  await p.evaluate(async () => { await document.fonts.load('16px "Noto Sans KR"'); await document.fonts.load('16px "Be Vietnam Pro"'); await document.fonts.ready; });
  await p.addScriptTag({ content: mermaidJs });
  const res = await p.evaluate(async () => {
    // eslint-disable-next-line no-undef
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict', fontFamily: '"Noto Sans KR", "Be Vietnam Pro", sans-serif' });
    const out = [];
    for (const [i, el] of [...document.querySelectorAll('pre.mermaid')].entries()) {
      try { const { svg } = await mermaid.render(`m${i}`, el.textContent); el.outerHTML = svg; out.push('ok'); }
      catch (e) { out.push('ERR ' + String(e.message || e).slice(0, 160)); }
    }
    return { out, html: document.querySelector('main').innerHTML };
  });
  await p.close();
  const bad = res.out.filter((x) => x !== 'ok');
  console.log(doc, lang, `diagrams ${res.out.length - bad.length}/${res.out.length}`, bad.join(' | '));
  fs.writeFileSync(path.join(OUT, `${doc}.${lang}.html`), page(doc, lang, res.html));
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'index.html'), index());
console.log('done');
