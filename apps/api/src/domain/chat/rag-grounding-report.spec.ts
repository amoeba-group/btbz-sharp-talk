import { RagService } from './rag.service';

/**
 * `RagService.groundingReport()` (PLN-261012 SG-51): the confidence the guest gate and the handoff
 * decision have always compared, PLUS what the retrieval found. `groundingConfidence()` must stay
 * a thin wrapper that returns exactly the same figure in every regime — the gate's numbers are
 * frozen here — and the 0.2 sentinel must be told apart from a genuinely ungrounded question.
 */
describe('RagService.groundingReport', () => {
  const saved = { ...process.env };
  const chunk = (id: number, category: string | null, similarity: number | null, title = `doc ${id}`) => ({
    id,
    title,
    category,
    group: 'counsel',
    source: 'knowledge_store',
    url: null,
    snippet: 'Items can be returned within 30 days. Our return policy covers refunds.',
    similarity,
  });

  const build = (retrieved: { chunks: unknown[]; vectorProvider: string | null }, qdrantEnabled = true) => {
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      { complete: jest.fn() } as never,
      { enabled: qdrantEnabled, search: jest.fn() } as never,
      { getPersonaRules: jest.fn(), effectiveAgentId: jest.fn(async () => 1), getAnswerFooter: jest.fn(async () => null) } as never,
    );
    const retrieveHybrid = jest.fn(async () => retrieved);
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = retrieveHybrid;
    return { svc, retrieveHybrid };
  };

  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.RAG_MIN_SIMILARITY;
    delete process.env.VOYAGE_API_KEY;
  });
  afterAll(() => {
    process.env = saved;
  });

  describe('the confidence is the figure groundingConfidence() has always returned', () => {
    it.each([
      ['voyage, strong hit', { chunks: [chunk(1, 'a', 0.7)], vectorProvider: 'voyage' }, 0.7],
      ['voyage, borderline hit (>= RAG_MIN_SIMILARITY) is lifted to the 0.5 floor', { chunks: [chunk(1, 'a', 0.47)], vectorProvider: 'voyage' }, 0.5],
      ['voyage, near-duplicate is capped at 0.95', { chunks: [chunk(1, 'a', 0.99)], vectorProvider: 'voyage' }, 0.95],
      ['voyage, nothing near enough: the 0.2 "off-topic" value', { chunks: [chunk(1, 'a', 0.3)], vectorProvider: 'voyage' }, 0.2],
      ['voyage, the best of several hits counts', { chunks: [chunk(1, 'a', 0.3), chunk(2, 'b', 0.82), chunk(3, 'c', 0.5)], vectorProvider: 'voyage' }, 0.82],
      ['no vector leg configured: the count estimate (0.5 + 0.12 per document)', { chunks: [chunk(1, 'a', null), chunk(2, 'b', null)], vectorProvider: null }, 0.74],
      ['no documents at all', { chunks: [], vectorProvider: null }, 0.2],
    ])('%s', async (_name, retrieved, expected) => {
      const { svc } = build(retrieved, false);

      const report = await svc.groundingReport(4, 'q', 1, { guestOnly: true });

      expect(report.confidence).toBeCloseTo(expected as number, 10);
      // ...and the wrapper hands back exactly that number.
      expect(await svc.groundingConfidence(4, 'q', 1, { guestOnly: true })).toBe(report.confidence);
    });

    it('a real-embedding score is ALWAYS 0.2 or inside [0.5, 0.95] — the bimodal shape behind REQ D-16', async () => {
      const seen = new Set<number>();
      for (let s = 0; s <= 100; s++) {
        const { svc } = build({ chunks: [chunk(1, 'a', s / 100)], vectorProvider: 'voyage' });
        seen.add((await svc.groundingReport(4, 'q')).confidence);
      }
      for (const c of seen) expect(c === 0.2 || (c >= 0.5 && c <= 0.95)).toBe(true);
      // Nothing between 0.2 and 0.5: any GUEST_GATE_CONFIDENCE in (0.2, 0.5] closes the gate identically.
      expect([...seen].filter((c) => c > 0.2 && c < 0.5)).toEqual([]);
    });

    it('RAG_MIN_SIMILARITY moves the cut between the two modes, not the figure inside the upper one', async () => {
      process.env.RAG_MIN_SIMILARITY = '0.6';
      const { svc } = build({ chunks: [chunk(1, 'a', 0.55)], vectorProvider: 'voyage' });

      expect((await svc.groundingReport(4, 'q')).confidence).toBe(0.2);
    });
  });

  describe('what the retrieval found', () => {
    it('lists the documents in rank order with their category and similarity, and the best similarity', async () => {
      const { svc } = build({
        chunks: [chunk(7, 'Settlement', 0.62), chunk(9, 'Cancellation', 0.81), chunk(3, null, null)],
        vectorProvider: 'voyage',
      });

      const r = await svc.groundingReport(4, 'q');

      expect(r.chunks).toEqual([
        { id: 7, title: 'doc 7', category: 'Settlement', group: 'counsel', similarity: 0.62 },
        { id: 9, title: 'doc 9', category: 'Cancellation', group: 'counsel', similarity: 0.81 },
        { id: 3, title: 'doc 3', category: null, group: 'counsel', similarity: null },
      ]);
      expect(r.topSimilarity).toBe(0.81);
      expect(r.vectorProvider).toBe('voyage');
      expect(r.degraded).toBe(false);
      expect(r.degradedReason).toBeNull();
    });

    it('top-3 distinct category NAMES and top-3 document ids, for the trace', async () => {
      const { svc } = build({
        chunks: [chunk(1, 'A', 0.9), chunk(2, 'A', 0.8), chunk(3, 'B', 0.7), chunk(4, 'C', 0.6), chunk(5, 'D', 0.5)],
        vectorProvider: 'voyage',
      });

      const r = await svc.groundingReport(4, 'q');

      expect(r.categories).toEqual(['A', 'B', 'C']);
      expect(r.docIds).toEqual([1, 2, 3]);
    });

    it('passes the scope options and the agent through to retrieval unchanged', async () => {
      const { svc, retrieveHybrid } = build({ chunks: [], vectorProvider: null });

      await svc.groundingReport(4, 'how to sign up', 12, { guestOnly: true, audience: 'public' });

      expect(retrieveHybrid).toHaveBeenCalledWith(4, 'how to sign up', 6, undefined, 12, { guestOnly: true, audience: 'public' });
    });
  });

  describe('the vector leg down — the sentinel is told apart from "nothing grounds it"', () => {
    beforeEach(() => {
      process.env.VOYAGE_API_KEY = 'k'; // real embeddings expected: a non-voyage provider is a degradation
    });

    it.each([
      ['the gateway fell back to the stub embedder', 'stub', 'embedding_fallback'],
      ['the index search failed or was skipped', null, 'qdrant_error'],
    ])('%s: confidence stays 0.2 (the gate is NOT loosened) and degraded is set (%s)', async (_n, provider, reason) => {
      const { svc } = build({ chunks: [chunk(1, 'Return policy', null)], vectorProvider: provider });

      const r = await svc.groundingReport(4, 'What is your return policy?', 1);

      expect(r.confidence).toBe(0.2);
      expect(r.degraded).toBe(true);
      expect(r.degradedReason).toBe(reason);
      expect(await svc.groundingConfidence(4, 'What is your return policy?', 1)).toBe(0.2);
    });

    it('with `queries` (the answer path\'s view) the keyword leg may earn the capped 0.55 — the gate never passes them', async () => {
      const { svc } = build({ chunks: [chunk(1, 'Return policy', null)], vectorProvider: null });

      const lenient = await svc.groundingReport(4, 'return policy', 1, undefined, ['return policy']);

      expect(lenient.confidence).toBe(0.55);
      expect(lenient.degraded).toBe(true);
      expect((await svc.groundingReport(4, 'return policy', 1)).confidence).toBe(0.2);
    });

    it('a healthy turn on the same environment is not degraded', async () => {
      const { svc } = build({ chunks: [chunk(1, 'a', 0.7)], vectorProvider: 'voyage' });

      expect((await svc.groundingReport(4, 'q')).degraded).toBe(false);
    });

    it('Qdrant switched off by configuration is not a degradation (count estimate, as before)', async () => {
      const { svc } = build({ chunks: [chunk(1, 'a', null)], vectorProvider: null }, false);

      const r = await svc.groundingReport(4, 'q');

      expect(r.degraded).toBe(false);
      expect(r.confidence).toBeCloseTo(0.62);
    });
  });
});

/**
 * CHARACTERISATION (not a change) of a residual of REQ D-16 found while building SG-51: real
 * embeddings ran, but NO vector hit survived the scope — Qdrant knows nothing about categories, so a
 * guest's top-24 neighbours may all be out of scope — and the chunks come from the keyword leg alone.
 * `confidence()` only reads a similarity when one exists; otherwise it falls to the count estimate, and
 * the ngram FULLTEXT index matches almost any text, so the figure is 0.5 + 0.12 per document (>= 0.62):
 * above any guest bar a calibration would pick. `groundingConfidence()` keeps these numbers exactly (the
 * brief); `gate:calibrate` warns about the samples it affects.
 */
describe('RagService.groundingReport — keyword-only grounding under REAL embeddings', () => {
  const kwChunk = (id: number) => ({ id, title: `t${id}`, category: 'Public FAQ', group: 'counsel', source: 'knowledge_store', url: null, snippet: 's', similarity: null });
  const build = (chunks: unknown[], vectorProvider: string | null) => {
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      { complete: jest.fn() } as never,
      { enabled: true, search: jest.fn() } as never,
      { getPersonaRules: jest.fn(), effectiveAgentId: jest.fn() } as never,
    );
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async () => ({ chunks, vectorProvider });
    return svc;
  };
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('voyage ran, only keyword hits survived the scope: the count estimate (0.62 for one document), no similarity', async () => {
    delete process.env.VOYAGE_API_KEY;

    const r = await build([kwChunk(1)], 'voyage').groundingReport(4, 'a question the public documents do not answer', 1, { guestOnly: true });

    expect(r.confidence).toBeCloseTo(0.62);
    expect(r.topSimilarity).toBeNull();
    expect(r.vectorProvider).toBe('voyage');
    expect(r.degraded).toBe(false);
  });

  it('...whereas a real in-scope vector hit below the floor reads 0.2: the difference the calibration warns about', async () => {
    const weak = { ...kwChunk(1), similarity: 0.3 };

    expect((await build([weak], 'voyage').groundingReport(4, 'q', 1, { guestOnly: true })).confidence).toBe(0.2);
    expect((await build([kwChunk(1), kwChunk(2)], 'voyage').groundingReport(4, 'q', 1, { guestOnly: true })).confidence).toBeCloseTo(0.74);
  });
});
