import { RagService } from './rag.service';

/**
 * Group preference may reorder, never evict (PLN-260929 S9).
 *
 * "What is your return policy?" labelled product_inquiry came back with six
 * products and none of the policy sections that answer it; the model then said
 * it had no information, at 0.95 confidence (staging, ivyusa, 2026-09-29).
 */
describe('RagService.rankWithPreference', () => {
  // RRF-like scores: neighbouring ranks ~0.0003 apart, as in production.
  const doc = (id: string, group: string, rrf: number) => ({ id, doc: { docGroup: group }, rrf });
  // Policy sections interleaved with catalogue hits, the way hybrid retrieval
  // returned them: the best policy section is plain rank 3.
  const order = ['prod0', 'prod1', 'p1', 'prod2', 'p2', 'prod3', 'p3', 'prod4', 'prod5', 'prod6', 'prod7'];
  const policyFirst = order.map((id, i) => doc(id, id.startsWith('prod') ? 'product' : 'counsel', 0.0164 - i * 0.0003));

  it('keeps the best unbiased documents when the preferred group would crowd them out', () => {
    const ids = RagService.rankWithPreference(policyFirst, 6, 'product').map((e) => e.id);

    expect(ids).toContain('p1');
    expect(ids).toHaveLength(6);
    // The rest of the slots still honour the preference.
    expect(ids.filter((id) => id.startsWith('prod'))).toHaveLength(5);
  });

  it('shows what the plain bonus did: every policy section evicted', () => {
    const bonus = 0.002;
    const naive = [...policyFirst]
      .map((e) => ({ ...e, s: e.rrf + (e.doc.docGroup === 'product' ? bonus : 0) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((e) => e.id);
    expect(naive.some((id) => id.startsWith('p') && !id.startsWith('prod'))).toBe(false);
  });

  it('orders the result by the biased score, so a preferred document still leads', () => {
    const out = RagService.rankWithPreference(policyFirst, 6, 'product');
    const scores = out.map((e) => e.rrf);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(out[0].id).toBe('prod0');
  });

  it('is the plain top-k without a preference', () => {
    const ids = RagService.rankWithPreference(policyFirst, 4).map((e) => e.id);
    expect(ids).toEqual(['prod0', 'prod1', 'p1', 'prod2']);
  });

  it('changes nothing when the preferred group already ranks first', () => {
    const productFirst = [doc('a', 'product', 0.02), doc('b', 'product', 0.019), doc('c', 'counsel', 0.001)];
    expect(RagService.rankWithPreference(productFirst, 2, 'product').map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('copes with fewer candidates than slots', () => {
    expect(RagService.rankWithPreference([doc('x', 'counsel', 0.01)], 6, 'product')).toHaveLength(1);
  });
});
