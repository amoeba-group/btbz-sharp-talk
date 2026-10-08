/**
 * Lightweight markdown for chat messages (PLN-261008-Chat-Markdown-Render).
 *
 * AI replies are written in markdown — 54% use **bold**, many use lists and
 * `code` — and every chat surface showed the markers raw. This handles only
 * what replies use, with no dependency (the widget ships inside customers'
 * pages), and returns data, not HTML: renderers build React elements from it,
 * so a message can never inject markup. Headings, tables, images and HTML are
 * deliberately not interpreted and stay visible as typed.
 *
 * Pure and dependency-free: the widget and console deep-import this file, the
 * API uses `stripLiteMarkdown` through the package.
 */
export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: MdInline[] }
  | { t: 'em'; c: MdInline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; v: string };

export interface MdListItem {
  c: MdInline[];
  /** One level of nesting ("1. step" → "   - detail"). */
  children?: MdList;
}

export interface MdList {
  t: 'list';
  ordered: boolean;
  start: number;
  items: MdListItem[];
}

export type MdBlock = { t: 'p'; lines: MdInline[][] } | MdList;

const URL_RE = /https?:\/\/[^\s<>()\[\]]+/;
const TRAILING_PUNCT = /[.,;:!?)\]]+$/;

interface Hit {
  idx: number;
  len: number;
  node: MdInline;
}

/**
 * Each rule finds its earliest match in `s`. No lookbehind anywhere: the
 * widget runs in customers' browsers, and Safari before 16.4 rejects a
 * lookbehind regex at parse time — the whole widget bundle would fail to load.
 * Word boundaries before a single marker are captured as a prefix group and
 * skipped instead.
 */
type Rule = (s: string) => Hit | null;

const simple =
  (re: RegExp, build: (m: RegExpExecArray) => MdInline): Rule =>
  (s) => {
    const m = re.exec(s);
    return m ? { idx: m.index, len: m[0].length, node: build(m) } : null;
  };

/** `*em*` / `_em_` only at word boundaries, so "2 * 3 * 4" and "file_name_v2" stay text. */
const emphasis = (mark: '*' | '_'): Rule => {
  const m = mark === '*' ? '\\*' : '_';
  const re = new RegExp(`(^|[^\\w${m}])${m}(?=[^\\s${m}])([^${m}\\n]*?[^\\s${m}])${m}(?![\\w${m}])`);
  return (s) => {
    const x = re.exec(s);
    if (!x) return null;
    const lead = x[1].length;
    return { idx: x.index + lead, len: x[0].length - lead, node: { t: 'em', c: parseInline(x[2]) } };
  };
};

const RULES: Rule[] = [
  simple(/`([^`\n]+)`/, (m) => ({ t: 'code', v: m[1] })),
  simple(/\*\*(?=\S)([\s\S]*?\S)\*\*/, (m) => ({ t: 'strong', c: parseInline(m[1]) })),
  simple(/__(?=\S)([\s\S]*?\S)__/, (m) => ({ t: 'strong', c: parseInline(m[1]) })),
  emphasis('*'),
  emphasis('_'),
  (s) => {
    const m = URL_RE.exec(s);
    if (!m) return null;
    // Trailing punctuation belongs to the sentence, not the address.
    const href = m[0].replace(TRAILING_PUNCT, '');
    return { idx: m.index, len: href.length, node: { t: 'link', href, v: href } };
  },
];

/** Inline markers within one line (or one bold span). */
export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = [];
  let rest = s;
  while (rest) {
    let best: Hit | null = null;
    for (const rule of RULES) {
      const h = rule(rest);
      if (h && (best === null || h.idx < best.idx)) best = h;
    }
    if (!best) {
      out.push({ t: 'text', v: rest });
      break;
    }
    if (best.idx > 0) out.push({ t: 'text', v: rest.slice(0, best.idx) });
    out.push(best.node);
    rest = rest.slice(best.idx + best.len);
  }
  return out;
}

const BULLET = /^(\s*)([-*•])\s+(.*)$/;
const NUMBER = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;

/** Text → blocks: paragraphs (line breaks kept) and lists, blank line = new paragraph. */
export function parseLiteMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: MdInline[][] | null = null;
  let list: MdList | null = null;

  const closePara = () => {
    if (para?.length) blocks.push({ t: 'p', lines: para });
    para = null;
  };
  const closeList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of (text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) {
      closePara();
      closeList();
      continue;
    }
    const b = BULLET.exec(raw);
    const n = b ? null : NUMBER.exec(raw);
    const hit = b ?? n;
    if (hit) {
      closePara();
      const indent = hit[1].replace(/\t/g, '  ').length;
      const ordered = !!n;
      const item: MdListItem = { c: parseInline(hit[3]) };
      const current = list as MdList | null;
      if (indent >= 2 && current && current.items.length) {
        const parent = current.items[current.items.length - 1];
        if (!parent.children) parent.children = { t: 'list', ordered, start: ordered ? Number(hit[2]) : 1, items: [] };
        parent.children.items.push(item);
        continue;
      }
      if (!current || current.ordered !== ordered) {
        closeList();
        list = { t: 'list', ordered, start: ordered ? Number(hit[2]) : 1, items: [] };
      }
      (list as unknown as MdList).items.push(item);
      continue;
    }
    // A continuation line indented under a list item stays with that item.
    const open = list as MdList | null;
    if (open && /^\s{2,}\S/.test(raw) && open.items.length) {
      const last = open.items[open.items.length - 1];
      last.c.push({ t: 'text', v: '\n' }, ...parseInline(raw.trim()));
      continue;
    }
    closeList();
    para = para ?? [];
    para.push(parseInline(raw));
  }
  closePara();
  closeList();
  return blocks;
}

function flatten(c: MdInline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' || n.t === 'link' ? n.v : flatten(n.c))).join('');
}

function listText(l: MdList, depth: number): string[] {
  return l.items.flatMap((it, i) => [
    `${'  '.repeat(depth)}${l.ordered ? `${l.start + i}.` : '•'} ${flatten(it.c)}`,
    ...(it.children ? listText(it.children, depth + 1) : []),
  ]);
}

/**
 * Markers removed, structure kept as plain text — for one-line previews and
 * channels that cannot show formatting (Kakao, Zalo, e-mail …):
 * "- **Email:** a@b" → "• Email: a@b".
 */
export function stripLiteMarkdown(text: string): string {
  return parseLiteMarkdown(text)
    .map((b) => (b.t === 'p' ? b.lines.map(flatten).join('\n') : listText(b, 0).join('\n')))
    .join('\n\n');
}
