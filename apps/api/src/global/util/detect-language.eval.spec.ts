import { detectLanguage } from './detect-language.util';
import { CorpusItem, CorpusLabel, LANGUAGE_CORPUS } from './detect-language.corpus';
import { VIETNAMESE_ASCII_LISTS, scoreUnaccentedVietnamese } from './vietnamese-ascii.util';

/**
 * Language-detection EVAL (PLN-261012 SG-53, NFR): a labelled corpus of 500+
 * realistic Hotel Admin partner utterances, an accuracy gate, and a printed
 * confusion summary.
 *
 * Unit tests in detect-language.util.spec.ts pin individual rules; this is the
 * measurement that answers "how often is it right on what Go2Joy will actually
 * type?". It is what found that unaccented Vietnamese read as English and that
 * Japanese / Chinese returned nothing.
 *
 * The gate is deliberately a little BELOW the measured numbers so an unrelated
 * edit to a word list cannot silently cost accuracy, while a real regression
 * trips it. Utterances a range detector cannot settle by design carry `limit`
 * in the corpus: they are listed and reported, and excluded from the gate.
 */

interface Outcome {
  item: CorpusItem;
  got: CorpusLabel;
  ok: boolean;
}

function run(bias?: (item: CorpusItem) => string | undefined): Outcome[] {
  return LANGUAGE_CORPUS.map((item) => {
    const got = detectLanguage(item.text, bias?.(item)) as CorpusLabel;
    return { item, got, ok: got === item.expect };
  });
}

const gated = (o: Outcome[]) => o.filter((x) => !x.item.limit);
const accuracy = (o: Outcome[]) => (o.length ? o.filter((x) => x.ok).length / o.length : 1);
const label = (l: CorpusLabel) => l ?? 'none';

function confusion(o: Outcome[]): string {
  const labels: CorpusLabel[] = ['VI', 'EN', 'KO', 'JA', 'ZH', 'ES', null];
  const rows = labels.map((truth) => {
    const cells = labels.map((got) => o.filter((x) => x.item.expect === truth && x.got === got).length);
    return `${label(truth).padEnd(5)}| ${cells.map((c) => String(c).padStart(4)).join(' ')}`;
  });
  return [`truth \\ got | ${labels.map((l) => label(l).padStart(4)).join(' ')}`, ...rows].join('\n');
}

describe('language detection eval (SG-53)', () => {
  const outcomes = run();

  it('has at least 500 labelled utterances covering every language and the edge cases', () => {
    expect(LANGUAGE_CORPUS.length).toBeGreaterThanOrEqual(500);
    const buckets = new Set(LANGUAGE_CORPUS.map((c) => c.bucket));
    for (const b of ['vi', 'vi-ascii', 'vi-slang', 'en', 'ko', 'ja', 'zh', 'es-marked', 'es-plain', 'edge-null', 'greeting', 'mixed']) {
      expect(buckets.has(b)).toBe(true);
    }
    // No utterance twice: a duplicate would double-count one lucky/unlucky case.
    const seen = new Set<string>();
    for (const c of LANGUAGE_CORPUS) {
      const key = `${c.bucket}|${c.text}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('prints the report', () => {
    const byBucket = new Map<string, Outcome[]>();
    for (const o of outcomes) byBucket.set(o.item.bucket, [...(byBucket.get(o.item.bucket) ?? []), o]);
    const lines = [...byBucket.entries()].map(([b, os]) => {
      const g = gated(os);
      const pct = (accuracy(os) * 100).toFixed(1).padStart(5);
      return `  ${b.padEnd(16)} ${String(os.length).padStart(4)} utterances  ${pct}% correct${g.length < os.length ? `  (${os.length - g.length} known limit)` : ''}`;
    });
    const g = gated(outcomes);
    const wrong = g.filter((x) => !x.ok);
    // eslint-disable-next-line no-console
    console.log(
      [
        `\nLanguage detection eval — ${LANGUAGE_CORPUS.length} utterances (${g.length} gated, ${LANGUAGE_CORPUS.length - g.length} known limits)`,
        `overall (gated): ${(accuracy(g) * 100).toFixed(1)}%   overall (all): ${(accuracy(outcomes) * 100).toFixed(1)}%`,
        ...lines,
        '\nConfusion (all utterances):',
        confusion(outcomes),
        wrong.length
          ? `\nMisses (gated):\n${wrong.map((w) => `  [${w.item.bucket}] expected ${label(w.item.expect)} got ${label(w.got)}: ${JSON.stringify(w.item.text)}`).join('\n')}`
          : '\nNo gated misses.',
      ].join('\n'),
    );
    expect(true).toBe(true);
  });

  describe('accuracy gate (utterances without a documented limit)', () => {
    it('is at least 97% overall', () => {
      expect(accuracy(gated(outcomes))).toBeGreaterThanOrEqual(0.97);
    });

    const MIN_BY_BUCKET: Record<string, number> = {
      vi: 0.98,
      'vi-ascii': 0.9,
      'vi-slang': 0.7,
      en: 0.98,
      ko: 0.98,
      ja: 0.95,
      zh: 0.95,
      'es-marked': 0.95,
      'edge-null': 0.95,
      greeting: 0.85,
      mixed: 0.9,
    };
    for (const [bucket, min] of Object.entries(MIN_BY_BUCKET)) {
      it(`bucket ${bucket} is at least ${Math.round(min * 100)}%`, () => {
        const os = gated(outcomes.filter((o) => o.item.bucket === bucket));
        expect(os.length).toBeGreaterThan(0);
        expect(accuracy(os)).toBeGreaterThanOrEqual(min);
      });
    }

    it('never calls English Vietnamese — the costlier error (a wrong switch is worse than a missed one)', () => {
      const falseVi = outcomes.filter((o) => o.item.expect === 'EN' && o.got === 'VI');
      expect(falseVi.map((o) => o.item.text)).toEqual([]);
    });

    it('never calls a Vietnamese utterance Korean, Japanese, Chinese or Spanish', () => {
      const bad = outcomes.filter(
        (o) => o.item.expect === 'VI' && o.got !== 'VI' && o.got !== 'EN' && o.got !== null,
      );
      expect(bad.map((o) => o.item.text)).toEqual([]);
    });
  });

  describe('on a Vietnamese session (the bias the chat path really passes)', () => {
    const vi = LANGUAGE_CORPUS.filter((c) => c.expect === 'VI');
    const withBias = run((item) => (item.expect === 'VI' ? 'VI' : undefined));

    it('keeps every Vietnamese utterance Vietnamese — even the shared-mark and one-word ones', () => {
      const wrong = withBias.filter((o) => o.item.expect === 'VI' && o.got !== 'VI' && o.got !== null);
      expect(wrong.map((o) => o.item.text)).toEqual([]);
      expect(vi.length).toBeGreaterThan(100);
    });
  });

  describe('the vocabulary lists behind the unaccented-Vietnamese check', () => {
    it('keep strong and weak words apart — a word is evidence or it is not', () => {
      const both = [...VIETNAMESE_ASCII_LISTS.STRONG].filter((w) => VIETNAMESE_ASCII_LISTS.WEAK.has(w));
      expect(both).toEqual([]);
    });

    it('score a Vietnamese sentence far above an English one that names a Vietnamese place', () => {
      const vi = scoreUnaccentedVietnamese('cho toi hoi gia phong qua dem');
      const en = scoreUnaccentedVietnamese('I would like to list a hotel in Phong Nha Ke Bang');
      expect(vi.density).toBeGreaterThan(0.6);
      expect(en.strong).toBeLessThan(2);
    });
  });
});
