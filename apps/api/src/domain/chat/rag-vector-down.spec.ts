import { RagService } from './rag.service';
import { m, metrics } from '../../infrastructure/observability/app-metrics';

/**
 * PLN-261012 SG-84 / D-19 — with the vector leg down, the keyword leg may still answer (capped),
 * nothing found still hands off, and the guest gate is NOT loosened by the outage.
 */
describe('RagService — vector leg unavailable', () => {
  const saved = { ...process.env };
  const policyDoc = {
    id: 1,
    title: 'Return policy',
    category: 'policy',
    snippet: 'Items can be returned within 30 days. Our return policy covers refunds.',
    similarity: null,
  };
  const noiseDocs = [
    { id: 2, title: 'Hydrating Cleanser', category: 'product', snippet: 'A gentle face wash. Easy exchange.', similarity: null },
    { id: 3, title: 'Night Cream', category: 'product', snippet: 'Rich moisturiser.', similarity: null },
  ];

  const build = (retrieved: { chunks: unknown[]; vectorProvider: string | null }, completeResult: Record<string, unknown> = {}) => {
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      {
        complete: jest.fn(async () => ({ text: 'You can return items within 30 days.\nCITED: 1', tokensIn: 5, tokensOut: 5, provider: 'anthropic', ...completeResult })),
      } as never,
      { enabled: true, search: jest.fn() } as never,
      {
        getPersonaRules: jest.fn(async () => ({ persona: 'P', rules: [] })),
        effectiveAgentId: jest.fn(async () => 1),
        getAnswerFooter: jest.fn(async () => null),
      } as never,
    );
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async () => retrieved;
    return svc;
  };

  beforeEach(() => {
    process.env = { ...saved };
    process.env.VOYAGE_API_KEY = 'k'; // real embeddings expected → a non-voyage provider is a degradation
    metrics.reset();
  });
  afterAll(() => {
    process.env = saved;
  });

  describe('answer()', () => {
    it.each([
      ['qdrant_error', null],
      ['embedding_fallback', 'stub'],
    ])('answers from the keyword leg at a CAPPED confidence, and records %s in the trace', async (reason, provider) => {
      const svc = build({ chunks: [policyDoc], vectorProvider: provider });

      const res = await svc.answer(4, 'What is your return policy?', 'EN');

      expect(res.confidence).toBeGreaterThan(0.45); // delivered — not the old blanket handoff
      expect(res.confidence).toBeLessThanOrEqual(0.55);
      expect(res.vectorDegraded).toBe(reason);
      expect(res.engineDegraded).toBeUndefined();
      expect(m.vectorDegradedTurns.get({ reason, result: 'fulltext_answer' })).toBe(1);
    });

    it('still hands off (sentinel 0.2) when the keyword leg found nothing', async () => {
      const res = await build({ chunks: [], vectorProvider: null }).answer(4, 'What is your return policy?', 'EN');

      expect(res.confidence).toBe(0.2);
      expect(res.vectorDegraded).toBe('qdrant_error');
      expect(m.vectorDegradedTurns.get({ reason: 'qdrant_error', result: 'withheld' })).toBe(1);
    });

    it('still hands off on keyword NOISE — unrelated products for a policy question (FIX-260930 D2)', async () => {
      const res = await build({ chunks: noiseDocs, vectorProvider: null }).answer(4, 'What is your return policy?', 'EN');

      expect(res.confidence).toBe(0.2);
    });

    it('a healthy turn is untouched: no degradation field, similarity-based confidence', async () => {
      const res = await build({ chunks: [{ ...policyDoc, similarity: 0.7 }], vectorProvider: 'voyage' }).answer(4, 'What is your return policy?', 'EN');

      expect(res.confidence).toBeCloseTo(0.7);
      expect(res).not.toHaveProperty('vectorDegraded');
      expect(m.vectorDegradedTurns.sum()).toBe(0);
    });

    it('is not "degraded" when Qdrant is switched off by configuration (count estimate, as before)', async () => {
      const svc = build({ chunks: [policyDoc], vectorProvider: null });
      (svc as unknown as { qdrant: { enabled: boolean } }).qdrant.enabled = false;

      const res = await svc.answer(4, 'What is your return policy?', 'EN');

      expect(res.confidence).toBeCloseTo(0.62);
      expect(res).not.toHaveProperty('vectorDegraded');
    });

    it('flags an engine outage separately from missing knowledge: no text, zero confidence, engineDegraded', async () => {
      const svc = build({ chunks: [policyDoc], vectorProvider: 'voyage' }, { degraded: true, provider: 'stub' });

      const res = await svc.answer(4, 'What is your return policy?', 'EN');

      expect(res).toMatchObject({ text: '', confidence: 0, engineDegraded: true });
    });

    it('an order-grounded answer keeps its floor even with the vector leg down', async () => {
      const res = await build({ chunks: [], vectorProvider: null }).answer(4, 'where is my order', 'EN', 'ORDER #1 shipped');

      expect(res.confidence).toBe(0.6);
    });

    it('the cap is an operator knob; at 0.2 the old "vector down → always hand off" is back', async () => {
      process.env.RAG_DEGRADED_CONFIDENCE_CAP = '0.2';

      const res = await build({ chunks: [policyDoc], vectorProvider: null }).answer(4, 'What is your return policy?', 'EN');

      expect(res.confidence).toBe(0.2);
    });

    it('weighs the context-enriched query too: a follow-up borrows its topic from the earlier turn', async () => {
      const svc = build({ chunks: [policyDoc], vectorProvider: null });

      const res = await svc.answer(4, 'and for my young son?', 'EN', undefined, undefined, 'What is your return policy?\nand for my young son?');

      expect(res.confidence).toBeGreaterThan(0.45);
    });
  });

  describe('groundingConfidence() — the guest gate and the out-of-scope override (unchanged by an outage)', () => {
    it('stays at the strict sentinel even when the keyword leg found a perfectly matching document', async () => {
      const svc = build({ chunks: [policyDoc], vectorProvider: null });

      // Same chunk that answer() above trusts at 0.55 — but a GATE must fail closed.
      expect(await svc.groundingConfidence(4, 'What is your return policy?', 1, { guestOnly: true })).toBe(0.2);
      expect(await svc.groundingConfidence(4, 'What is your return policy?', 1)).toBe(0.2);
    });
  });
});
