import { RagService } from './rag.service';

/**
 * Confidence when the vector leg should have run and did not (FIX-260930 D2).
 *
 * The gateway falls back to stub embeddings when Voyage fails, and the old
 * count formula then scored six full-text hits at 0.95 — a confident "I don't
 * have that information" with no agent paged (ivyusa turn 17740).
 */
describe('RagService.confidence — degraded vector leg', () => {
  const chunks = Array.from({ length: 6 }, (_, i) => ({ id: i, similarity: null })) as never[];
  const build = (qdrantEnabled: boolean) =>
    new RagService(
      {} as never,
      {} as never,
      {} as never,
      { enabled: qdrantEnabled } as never,
      {} as never,
    ) as unknown as { confidence: (c: unknown[], p: string | null) => number };

  const saved = process.env.VOYAGE_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = saved;
  });

  it.each(['stub', null])('withholds confidence when voyage is configured but the provider was %s', (p) => {
    process.env.VOYAGE_API_KEY = 'k';
    expect(build(true).confidence(chunks, p)).toBeLessThan(0.45);
  });

  it('keeps the count estimate when no real embeddings are configured (dev/stub)', () => {
    delete process.env.VOYAGE_API_KEY;
    expect(build(true).confidence(chunks, 'stub')).toBe(0.95);
  });

  it('keeps the count estimate when Qdrant is switched off by configuration', () => {
    process.env.VOYAGE_API_KEY = 'k';
    expect(build(false).confidence(chunks, null)).toBe(0.95);
  });

  it('scores a healthy voyage turn on similarity as before', () => {
    process.env.VOYAGE_API_KEY = 'k';
    const svc = build(true);
    expect(svc.confidence([{ similarity: 0.61 }], 'voyage')).toBeCloseTo(0.61);
    expect(svc.confidence([{ similarity: 0.44 }], 'voyage')).toBe(0.2);
  });
});
