/**
 * Light structure for chat bubbles (user feedback 2026-10-07: a long run of
 * sentences in one bubble reads as unprofessional; the same content as a list
 * reads as help).
 *
 * Deliberately NOT a markdown renderer. The model is asked for exactly three
 * shapes — plain lines, `- ` bullets, `1. ` steps — plus `**label**` for a short
 * lead-in, and that is all this understands. Anything else stays literal text,
 * so a stray `#`, `|` or `<` from a knowledge document can never become markup.
 */

export type ReplyBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

const BULLET = /^\s*(?:[-*•▪]|–)\s+(.*)$/;
const STEP = /^\s*(\d{1,2})[.)]\s+(.*)$/;

/** Split a reply into paragraph / bullet-list / numbered-list blocks. */
export function parseReply(body: string): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: para.join('\n') });
      para = [];
    }
  };
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const bullet = line.match(BULLET);
    const step = line.match(STEP);
    if (bullet) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(bullet[1]);
      else blocks.push({ kind: 'ul', items: [bullet[1]] });
    } else if (step) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ol') last.items.push(step[2]);
      else blocks.push({ kind: 'ol', items: [step[2]] });
    } else if (!line.trim()) {
      // A blank line ends a paragraph; list runs end on their own.
      flushPara();
    } else {
      para.push(line);
    }
  }
  flushPara();
  return blocks;
}

export type InlineRun = { bold: boolean; text: string };

/**
 * `**label**` → bold run. Only balanced pairs count; a lone `**` is literal.
 * No other inline syntax — links in a reply arrive as plain URLs and citations
 * are rendered separately from their own structured field.
 */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = /\*\*([^*\n]+?)\*\*/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > at) runs.push({ bold: false, text: text.slice(at, m.index) });
    runs.push({ bold: true, text: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ bold: false, text: text.slice(at) });
  return runs.length ? runs : [{ bold: false, text }];
}

/** True when the reply has any structure worth rendering as blocks. */
export function hasStructure(body: string): boolean {
  return parseReply(body).some((b) => b.kind !== 'p') || /\*\*[^*\n]+?\*\*/.test(body);
}
