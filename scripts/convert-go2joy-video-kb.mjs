#!/usr/bin/env node
/**
 * reference/hoteladminvideoguidevien.md → bulk-import CSV (PLN-260829-Go2Joy-Video-Guide-KB).
 *
 * The video guide is written as 51 task-unit sections (`### Video N — <vi> /
 * Video N — <en>`) whose every prose line carries both languages at once
 * (`VI<br>*EN*`). This slices each section into ONE article per language, so
 * the two editions upsert independently under the shared
 * (tenant, doc_group, external_key) axis — the same shape the text manual
 * already uses (scripts/convert-go2joy-kb.mjs, PR #433/#434).
 *
 * Usage: node scripts/convert-go2joy-video-kb.mjs [input.md] [output.csv] --lang vi|en
 *
 * Not carried over into knowledge (PLN D5): clip durations (metadata, not
 * knowledge) and the video index table (a duplicate of the articles). The
 * "Not verifiable" line IS kept — dropping it would let the KB assert results
 * the recording never actually showed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const langAt = argv.findIndex((a) => a.startsWith('--lang'));
// `--lang vi` puts the value in its OWN argv slot: without dropping it too, it
// is read as the input path and `node … --lang vi` dies on ENOENT.
const inlineLang = langAt >= 0 ? argv[langAt].split('=')[1] : undefined;
const lang = langAt < 0 ? 'vi' : (inlineLang ?? argv[langAt + 1]);
const consumed = new Set(langAt < 0 ? [] : inlineLang ? [langAt] : [langAt, langAt + 1]);
const positional = argv.filter((a, i) => !consumed.has(i) && !a.startsWith('--'));
const input = positional[0] ?? 'reference/hoteladminvideoguidevien.md';
const output = positional[1] ?? `go2joy-video-kb.${lang}.csv`;
if (!['vi', 'en'].includes(lang)) throw new Error(`unknown --lang "${lang}" (vi|en)`);

/**
 * Video N → its Notion block (PLN-261006-KB-Video-Links). Emitted as the
 * `video_ref` column so answers citing the article get a "watch video" link,
 * and so a regenerated CSV keeps those links instead of dropping them.
 */
const VIDEO_BLOCKS = new Map(
  JSON.parse(readFileSync('reference/go2joy-hotel-admin-video-blocks.json', 'utf8'))
    .blocks.filter((b) => b.video != null)
    .map((b) => [b.video, `notion:${b.blockId}`]),
);

/**
 * Category per video number (PLN D3). Deliberately a table of explicit ranges
 * rather than "read the first backticked menu of the screen path": video 25
 * starts from `Trang chủ` on its way to reconciliation and video 39 starts
 * from a home-screen banner on its way to a coupon — both would land in the
 * dashboard category. Labels reuse the tenant's existing per-language names
 * where one already exists.
 */
const CATEGORY_RANGES = [
  { to: 0, vi: 'Bảng điều khiển', en: 'Dashboard' },
  { to: 1, vi: 'Quản lý đánh giá', en: 'Review Management' },
  { to: 16, vi: 'Quản lý loại phòng', en: 'Room Type Management' },
  { to: 23, vi: 'Quản lý đặt phòng', en: 'Booking Management' },
  { to: 24, vi: 'Báo cáo', en: 'Reports' },
  { to: 31, vi: 'Quản lý đối soát', en: 'Reconciliation' },
  { to: 33, vi: 'Quản lý sản phẩm', en: 'Product Management' },
  { to: 41, vi: 'Quản lý khuyến mãi', en: 'Promotions & Coupons' },
  { to: 45, vi: 'Chiến dịch quảng cáo', en: 'Ad Campaigns' },
  { to: 50, vi: 'Quản lý nhân viên', en: 'Staff Management' },
  // Videos 51–62 were added to the Notion page after the first analysis
  // (PLN-261006-KB-Video-Links P4).
  { to: 53, vi: 'Quản lý tin nhắn', en: 'Messaging' },
  { to: 57, vi: 'Thiết lập thông tin khách sạn', en: 'Hotel Settings' },
  { to: 60, vi: 'Chính sách huỷ phòng', en: 'Cancellation Policy' },
  { to: 62, vi: 'Quản lý kênh đối tác', en: 'Partner Channels' },
];
const REFERENCE_CATEGORY = { vi: 'Tài liệu tham khảo', en: 'Reference' };
const categoryFor = (n) => {
  const hit = CATEGORY_RANGES.find((r) => n <= r.to);
  if (!hit) throw new Error(`no category range covers video ${n}`);
  return hit[lang];
};

/** Metadata, not knowledge — the only label dropped outright. */
const DROP_LABEL = 'Thời lượng / Duration';

const pick = (vi, en) => (lang === 'vi' ? vi : en);
/** `*text*` → `text` (the English half is italicised throughout the source). */
const unitalic = (s) => s.trim().replace(/^\*(.*)\*$/s, '$1').trim();

/**
 * One prose line carries both languages: `VI<br>*EN*`. A line without the
 * separator is the same string in both editions (a bare UI label, a dash).
 */
const discarded = [];
/** `<br>`, `<br/>`, `<br />` — a variant must split, never fall through. */
const BREAK = /<br\s*\/?>/i;

function halve(text) {
  const m = text.match(BREAK);
  if (!m) return text.trim();
  const at = m.index;
  const vi = text.slice(0, at).trim();
  const en = unitalic(text.slice(at + m[0].length));
  // Keep the half we drop: the only honest way to prove the two editions
  // really separated is to look for the other language in the output. Halves
  // that are byte-identical carry no evidence — a screen path built purely
  // from Vietnamese UI labels reads the same in the English edition.
  if (vi !== en) discarded.push(pick(en, vi));
  return pick(vi, en);
}

/**
 * List markers live on the Vietnamese half only, so the English half has to
 * get them back — otherwise the steps stop being a list in the EN edition.
 */
function halveListLine(line) {
  const m = line.match(/^(\s*(?:\d+\)|[-*])\s+)(.*)$/s);
  if (!m) return halve(line);
  const body = halve(m[2]);
  return body ? m[1] + body : '';
}

/** `- **VI라벨 / EN라벨**[ (VI꼬리) / *(EN꼬리)*][: 값]` */
function halveLabelLine(line) {
  const m = line.match(/^(\s*[-*]\s+)\*\*(.+?)\s\/\s(.+?)\*\*(.*)$/s);
  if (!m) return null;
  const [, marker, viLabel, enLabel, restRaw] = m;
  if (`${viLabel} / ${enLabel}` === DROP_LABEL) return '';

  let rest = restRaw;
  let tail = '';
  // Video 39 qualifies the label itself: `** (vi note) / *(en note)*:`
  const qualified = rest.match(/^\s+(.+?)\s\/\s(\*\(.+?\)\*)(.*)$/s);
  if (qualified) {
    tail = ` ${pick(qualified[1], unitalic(qualified[2]))}`;
    rest = qualified[3];
  }
  const value = rest.startsWith(':') ? halve(rest.slice(1)) : halve(rest);
  const label = `${marker}**${pick(viLabel, enLabel)}${tail}**`;
  return value ? `${label}: ${value}` : `${label}:`;
}

/** A markdown table row: header cells split on ` / `, body cells on `<br>`. */
function halveTableRow(line) {
  const cells = line.split('|');
  return cells
    .map((cell) => {
      const raw = cell.trim();
      if (!raw || /^:?-{2,}:?$/.test(raw)) return cell;
      if (raw.includes('<br>')) return ` ${halve(raw)} `;
      const slash = raw.indexOf(' / ');
      return slash < 0 ? ` ${raw} ` : ` ${pick(raw.slice(0, slash), raw.slice(slash + 3))} `;
    })
    .join('|');
}

/** Halves dropped while converting the most recent article (see the check below). */
let lastDropped = [];

function convertBody(lines) {
  discarded.length = 0;
  const out = [];
  for (const line of lines) {
    if (!line.trim()) {
      out.push('');
      continue;
    }
    if (line.trim().startsWith('|')) {
      out.push(halveTableRow(line));
      continue;
    }
    const labelled = halveLabelLine(line);
    if (labelled !== null) {
      if (labelled) out.push(labelled);
      continue;
    }
    const converted = halveListLine(line);
    if (converted) out.push(converted);
  }
  lastDropped = [...new Set(discarded)];
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const lines = readFileSync(input, 'utf8').split('\n');

// ---- 51 video articles -------------------------------------------------
// Boundary rule is explicit (PLN S1-2): only `### Video`, `## ` and a `---`
// rule end an article. Anything else is the article's own structure.
const VIDEO = /^### Video (\d+) — (.+)$/;
const articles = [];
let current = null;
const flush = () => {
  if (!current) return;
  current.content = convertBody(current.body);
  current.dropped = lastDropped;
  if (!current.content) throw new Error(`empty article: ${current.key}`);
  articles.push(current);
  current = null;
};

for (const line of lines) {
  const video = line.match(VIDEO);
  if (video) {
    flush();
    const n = Number(video[1]);
    const split = video[2].indexOf(` / Video ${n} — `);
    if (split < 0) throw new Error(`video ${n}: heading is not bilingual — did the format change?`);
    const vi = video[2].slice(0, split);
    const en = video[2].slice(split + ` / Video ${n} — `.length);
    current = {
      key: `GTJ-VID-${String(n).padStart(2, '0')}-${lang.toUpperCase()}`,
      videoRef: VIDEO_BLOCKS.get(n) ?? '',
      title: `Video ${n} — ${pick(vi, en)}`,
      category: categoryFor(n),
      body: [],
    };
    continue;
  }
  if (/^##\s/.test(line) || /^---\s*$/.test(line)) {
    flush();
    continue;
  }
  if (current) current.body.push(line);
}
flush();

if (articles.length !== 63) throw new Error(`expected 63 video articles, found ${articles.length}`);

// ---- reference article: analysis method + the divergence table ----------
const sectionAt = (prefix) => lines.findIndex((l) => l.startsWith(prefix));
const methodAt = sectionAt('## Phương pháp phân tích và giới hạn');
const divergeAt = sectionAt('## ⚠️ Những điểm tài liệu và video không khớp');
const indexAt = sectionAt('## Mục lục video');
if (methodAt < 0 || divergeAt < 0 || indexAt < 0) throw new Error('reference sections not found');

const headingHalf = (line) => {
  const text = line.replace(/^#+\s*/, '');
  const slash = text.indexOf(' / ');
  return slash < 0 ? text : pick(text.slice(0, slash), text.slice(slash + 3));
};
const methodHeading = headingHalf(lines[methodAt]);
const divergeHeading = headingHalf(lines[divergeAt]);
const methodBody = convertBody(lines.slice(methodAt + 1, divergeAt));
const methodDropped = lastDropped;
const divergeBody = convertBody(lines.slice(divergeAt + 1, indexAt));
const referenceContent = [`## ${methodHeading}`, methodBody, '', `## ${divergeHeading}`, divergeBody].join('\n');

articles.push({
  key: `GTJ-VIDREF-01-${lang.toUpperCase()}`,
  title: `${methodHeading} · ${divergeHeading.replace(/^⚠️\s*/, '')}`,
  category: REFERENCE_CATEGORY[lang],
  content: referenceContent,
  dropped: [...methodDropped, ...lastDropped],
});

// ---- CSV ---------------------------------------------------------------
const esc = (v) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const rows = [
  'category,title,content,external_key,source_url,video_ref',
  ...articles.map((a) => [a.category, a.title, a.content, a.key, '', a.videoRef ?? ''].map(esc).join(',')),
];
writeFileSync(output, '﻿' + rows.join('\n') + '\n', 'utf8');

// ---- self-check: no leftovers from the other language -------------------
// Proof of separation: nothing the other edition owns may survive here. A
// naive "is there an italic run" test would fire on the source's own
// required-field markers (`Tên đăng nhập *`), so compare against the actual
// discarded halves instead. Short ones are skipped — `—`, a bare UI label and
// the like are identical in both languages by nature.
// Compare LINE BY LINE, not by substring: this guide deliberately quotes the
// Vietnamese on-screen labels inside its English sentences ("UI labels are
// kept as the original Vietnamese strings"), so a containment test would
// condemn the very convention the source documents. A half that failed to
// split shows up as a whole line instead.
const bare = (l) => l.replace(/^\s*(?:\d+\)|[-*])\s+/, '').replace(/^\*\*[^*]+\*\*:\s*/, '').trim();
// Per ARTICLE, never across articles: two videos of the same screen share a
// screen-path line, so one article's dropped half legitimately equals another
// article's kept line.
const survivors = articles.flatMap((a) => {
  const own = new Set(`${a.title}\n${a.content}`.split('\n').map(bare));
  return (a.dropped ?? []).filter((d) => d.length > 12 && own.has(d)).map((d) => `${a.key}: ${d}`);
});
const leaked = articles.filter((a) => BREAK.test(a.content) || BREAK.test(a.title));
const overlong = articles.filter((a) => a.title.length > 255);
console.log(`${articles.length} articles (${lang}) → ${output}`);
const byCategory = new Map();
for (const a of articles) byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + 1);
for (const [c, n] of byCategory) console.log(`  ${String(n).padStart(2)}  ${c}`);
console.log(`  chars: ${articles.reduce((s, a) => s + a.content.length, 0)}`);
if (leaked.length || survivors.length) {
  console.error(`\nLEAK: ${leaked.length} article(s) with a raw line break, ${survivors.length} phrase(s) from the other language:`);
  for (const a of leaked.slice(0, 5)) console.error(`  ${a.key}`);
  for (const d of survivors.slice(0, 5)) console.error(`  "${d.slice(0, 80)}"`);
  process.exit(1);
}
const droppedTotal = articles.reduce((n, a) => n + (a.dropped?.length ?? 0), 0);
console.log(`  language separation: ${droppedTotal} distinct halves dropped, 0 survived`);
if (overlong.length) {
  console.error(`\nTITLE TOO LONG: ${overlong.map((a) => a.key).join(', ')}`);
  process.exit(1);
}
