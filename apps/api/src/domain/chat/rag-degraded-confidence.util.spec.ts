import {
  VECTOR_DOWN_GROUNDING_CONFIDENCE,
  degradedConfidenceCap,
  degradedFulltextConfidence,
  degradedMinCoverage,
  distinctiveTerms,
  lexicalCoverage,
} from './rag-degraded-confidence.util';

/**
 * PLN-261012 SG-84 / D-19 — what a turn is worth when only the keyword leg ran.
 * The history this guards: FIX-260930 D2 scored six unrelated products at 0.95 and answered
 * "I don't have that information"; the fix over-corrected to "always hand off".
 */
describe('distinctiveTerms', () => {
  it('drops stopwords and one-letter noise but keeps the topic words', () => {
    expect(distinctiveTerms('What is your return policy?')).toEqual(['return', 'policy']);
  });

  it('splits Vietnamese on syllables and drops the question filler', () => {
    expect(distinctiveTerms('Tôi có thể thanh toán cho Go2Joy như nào?')).toEqual(['thể', 'thanh', 'toán', 'go2joy']);
  });

  it('cuts an unspaced CJK run into overlapping bigrams', () => {
    const terms = distinctiveTerms('환불정책이 뭐에요');
    expect(terms).toEqual(expect.arrayContaining(['환불', '불정', '정책', '책이']));
  });

  it('is bounded: a pasted paragraph cannot make coverage unreachable', () => {
    const long = Array.from({ length: 80 }, (_, i) => `topicword${i}`).join(' ');
    expect(distinctiveTerms(long)).toHaveLength(12);
  });
});

describe('lexicalCoverage', () => {
  it('is the share of terms found in title, category or body', () => {
    const chunk = { title: 'Return policy', category: 'policy', snippet: 'You can return items within 30 days.' };
    expect(lexicalCoverage(['return', 'policy', 'warranty'], chunk)).toBeCloseTo(2 / 3);
    expect(lexicalCoverage([], chunk)).toBe(0);
  });
});

describe('degradedFulltextConfidence', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const policy = { title: 'Return policy', category: 'policy', snippet: 'Items can be returned within 30 days. Our return policy covers refunds.' };
  const noise = [
    { title: 'Hydrating Cleanser', category: 'product', snippet: 'A gentle face wash. Free shipping, easy exchange.' },
    { title: 'Night Cream', category: 'product', snippet: 'Rich moisturiser for dry skin.' },
  ];

  it('answers from the keyword leg when a document contains the question\'s own words — at a CAPPED confidence', () => {
    const r = degradedFulltextConfidence([policy], ['What is your return policy?']);

    expect(r.result).toBe('fulltext_answer');
    expect(r.confidence).toBe(degradedConfidenceCap());
    // Above the chat handoff bar (0.45) so it is delivered; far below a healthy score and under the
    // answer-reuse bar (0.75), so it is never replayed as a verified answer.
    expect(r.confidence).toBeGreaterThan(0.45);
    expect(r.confidence).toBeLessThan(0.75);
  });

  it('hands off when nothing was found', () => {
    expect(degradedFulltextConfidence([], ['What is your return policy?'])).toMatchObject({
      confidence: VECTOR_DOWN_GROUNDING_CONFIDENCE,
      result: 'withheld',
    });
  });

  it('hands off on FULLTEXT NOISE — the FIX-260930 D2 case: unrelated products for a policy question', () => {
    const r = degradedFulltextConfidence(noise, ['What is your return policy?']);

    expect(r.result).toBe('withheld');
    expect(r.confidence).toBe(VECTOR_DOWN_GROUNDING_CONFIDENCE);
  });

  it('needs most of the distinctive words, not one lucky match', () => {
    const oneWord = { title: 'Shipping', category: null, snippet: 'Free return label included.' };
    expect(degradedFulltextConfidence([oneWord], ['What is your return policy for opened products?']).result).toBe('withheld');
  });

  it('takes the best coverage over the message AND the context-enriched query (a follow-up borrows its topic)', () => {
    // retrievalQuery() joins the earlier turns and the current message with newlines.
    const r = degradedFulltextConfidence([policy], ['and for my young son?', 'What is your return policy?\nand for my young son?']);
    expect(r.result).toBe('fulltext_answer');
  });

  it('without a query there is no lexical evidence: the strict sentinel (what the guest gate relies on)', () => {
    expect(degradedFulltextConfidence([policy])).toMatchObject({ confidence: VECTOR_DOWN_GROUNDING_CONFIDENCE, result: 'withheld' });
  });

  it('answers a Vietnamese FAQ whose title is the question', () => {
    const faq = {
      title: 'Câu hỏi: Tôi có thể thanh toán cho Go2Joy như nào?',
      category: 'Thanh toán',
      snippet: 'Quý khách thanh toán qua chuyển khoản vào tài khoản Go2Joy.',
    };
    expect(degradedFulltextConfidence([faq], ['Tôi có thể thanh toán cho Go2Joy như nào?']).result).toBe('fulltext_answer');
  });

  it('is configurable, and a cap at or under the handoff bar restores the old "always hand off"', () => {
    process.env.RAG_DEGRADED_CONFIDENCE_CAP = '0.2';
    expect(degradedFulltextConfidence([policy], ['What is your return policy?']).confidence).toBe(0.2);

    process.env.RAG_DEGRADED_CONFIDENCE_CAP = '0.6';
    process.env.RAG_DEGRADED_MIN_COVERAGE = '0.99';
    expect(degradedMinCoverage()).toBe(0.99);
    expect(degradedFulltextConfidence([{ title: 'Shipping', category: null, snippet: 'return' }], ['What is your return policy?']).result).toBe('withheld');
  });
});
