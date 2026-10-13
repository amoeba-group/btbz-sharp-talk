/**
 * Post-generation number check (PLN-261012 SG-31).
 *
 * A model asked to restate a price will, now and then, do arithmetic or round
 * or "helpfully" convert — and a wrong amount in a partner's chat window is
 * worse than no answer. So after the answer is drafted (and moderated) every
 * number in it is compared with the numbers of the trusted data block the
 * server built; one the block does not contain means the answer is withheld
 * and the turn degrades to "we will confirm, an agent follows up".
 *
 * Two tiers, because this runs on free prose that legitimately mixes the data
 * with knowledge-base text:
 *  - STRICT — amounts (a currency marker, a compact "1,5 triệu"/"450k", a
 *    thousands-grouped "1.200.000") and long numbers (5+ digits: ids, unformatted
 *    amounts). Must be in the data block (or echoed from the user's question).
 *  - SMALL — everything else (dates, hours, counts, percentages). Must be in the
 *    data block, the question, or a cited knowledge-base passage.
 * Numbered list markers ("1. ", "2) ") are not numbers.
 *
 * Normalisation makes "1.200.000 ₫", "1,200,000 VND", "1200000" and "1,2 triệu"
 * the same value, so restyling is free; changing the value is not.
 * Not covered: numbers spelled out in words ("two nights") — a known limit.
 */

/** Multipliers for a compact amount ("450k", "1,5 triệu", "300 nghìn", "2만"). */
const MULTIPLIER: Record<string, number> = {
  k: 1e3,
  nghìn: 1e3,
  ngàn: 1e3,
  천: 1e3,
  tr: 1e6,
  triệu: 1e6,
  m: 1e6,
  million: 1e6,
  만: 1e4,
  억: 1e8,
};
/** Plain currency markers: the value is an amount, nothing to multiply. */
const CURRENCY = new Set(['đồng', 'vnđ', 'vnd', '₫', 'đ', '원', 'won']);

const UNIT_ALTERNATION = [...Object.keys(MULTIPLIER), ...CURRENCY].sort((a, b) => b.length - a.length).join('|');
// Number, then an optional unit that must END at a word boundary — so "5 đêm" is
// 5 (not 5 đ) and "24h" is 24. `u` for the Vietnamese/Korean letters.
const TOKEN = new RegExp(`(\\d[\\d.,]*\\d|\\d)(?:[ \\u00a0]?(${UNIT_ALTERNATION})(?![\\p{L}\\d]))?`, 'giu');

export interface NumberToken {
  raw: string;
  /** Canonical value: digits only for integers, "int.frac" for decimals. */
  norm: string;
  strict: boolean;
}

/** Digits of an integer string without leading zeros (keeps a single "0"). */
const intNorm = (digits: string): string => digits.replace(/^0+(?=\d)/, '');

/** "1.234,56" / "1,234.56" / "1.200.000" / "4,5" / "007" -> canonical value + whether it is thousands-grouped. */
function canonical(num: string): { norm: string; grouped: boolean } {
  // Thousands groups only: 1.200.000 / 1,200,000 / 12.345
  if (/^\d{1,3}([.,]\d{3})+$/.test(num)) return { norm: intNorm(num.replace(/[.,]/g, '')), grouped: true };
  // Both separators: the LAST one is the decimal mark ("1.234,56" vi, "1,234.56" en).
  const lastDot = num.lastIndexOf('.');
  const lastComma = num.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    const whole = intNorm(num.slice(0, dec).replace(/[.,]/g, ''));
    const frac = num.slice(dec + 1).replace(/0+$/, '');
    return { norm: frac ? `${whole}.${frac}` : whole, grouped: true };
  }
  // One separator, not thousands: a decimal ("4,5", "3.14").
  if (/^\d+[.,]\d+$/.test(num)) {
    const [w, f] = num.split(/[.,]/);
    const frac = f.replace(/0+$/, '');
    return { norm: frac ? `${intNorm(w)}.${frac}` : intNorm(w), grouped: false };
  }
  // Anything odd ("1.2.3"): keep the digits — it will simply not match a clean value.
  return { norm: intNorm(num.replace(/\D/g, '')), grouped: false };
}

/** Numbers of a text, list markers removed. */
export function numberTokens(text: string): NumberToken[] {
  const body = (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]\s+)?\d{1,2}[.)]\s+/, ''))
    .join('\n');
  const out: NumberToken[] = [];
  for (const m of body.matchAll(TOKEN)) {
    const unit = m[2]?.toLowerCase();
    const { norm, grouped } = canonical(m[1]);
    let value = norm;
    let marked = false;
    if (unit) {
      if (CURRENCY.has(unit)) {
        marked = true;
      } else {
        const mult = MULTIPLIER[unit];
        const n = Math.round(Number(norm) * mult);
        if (Number.isFinite(n)) {
          value = String(n);
          marked = true;
        }
      }
    }
    const digits = value.replace(/\D/g, '');
    out.push({
      raw: m[0].trim(),
      norm: value,
      // An amount (marker / compact / grouped) or a long number must be matched strictly.
      strict: marked || grouped || (!value.includes('.') && digits.length >= 5),
    });
  }
  return out;
}

export interface NumberCheckInput {
  /** The server-built data block — the only source of truth for strict numbers. */
  block: string;
  /** The customer's own message: numbers they wrote may be echoed back. */
  question?: string;
  /** Cited knowledge-base passages: they may supply small numbers (hours, percentages). */
  kbTexts?: string[];
}

export interface NumberCheck {
  ok: boolean;
  /** The offending numbers as written (capped), for the log. */
  unverified: string[];
}

export function verifyNumbers(answer: string, input: NumberCheckInput): NumberCheck {
  const fromBlock = new Set(numberTokens(input.block).map((t) => t.norm));
  const fromQuestion = new Set(numberTokens(input.question ?? '').map((t) => t.norm));
  const fromKb = new Set((input.kbTexts ?? []).flatMap((k) => numberTokens(k).map((t) => t.norm)));

  const bad: string[] = [];
  for (const t of numberTokens(answer)) {
    const known = fromBlock.has(t.norm) || fromQuestion.has(t.norm) || (!t.strict && fromKb.has(t.norm));
    if (!known) bad.push(t.raw);
  }
  return { ok: bad.length === 0, unverified: bad.slice(0, 8) };
}
