import { RagService } from './rag.service';

/**
 * RagService.answer() reports where its time went (PLN-261012 SG-53): the search
 * and the answering model call, measured separately so ChatService can persist
 * them in the turn's trace.
 */
describe('RagService.answer — timings', () => {
  const build = (opts: { degraded?: boolean; searchMs?: number; modelMs?: number } = {}) => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      {
        complete: jest.fn(async () => {
          await wait(opts.modelMs ?? 0);
          return { text: 'Câu trả lời.\nCITED: 1', degraded: !!opts.degraded, tokensIn: 1, tokensOut: 1, provider: 'stub' };
        }),
      } as never,
      { enabled: false, search: jest.fn() } as never,
      { getPersonaRules: jest.fn(async () => ({ persona: 'P', rules: [] })), effectiveAgentId: jest.fn(async () => 1) } as never,
    );
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async () => {
      await wait(opts.searchMs ?? 0);
      return {
        chunks: [{ id: 1, title: 't', category: 'policy', snippet: 's', similarity: 0.7 }],
        vectorProvider: 'voyage',
      };
    };
    return svc;
  };

  it('returns retrieve and generate milliseconds, each covering only its own stage', async () => {
    const res = await build({ searchMs: 40, modelMs: 80 }).answer(4, 'Hoa hồng bao nhiêu?', 'VI');
    expect(res.timings).toBeDefined();
    // Timers may fire a millisecond early; the point is the split, not the exact value.
    expect(res.timings!.retrieveMs).toBeGreaterThanOrEqual(35);
    expect(res.timings!.generateMs).toBeGreaterThanOrEqual(75);
    expect(res.timings!.retrieveMs).toBeLessThan(res.timings!.generateMs + 40);
  });

  it('still reports them when the engine degraded and the answer is withheld', async () => {
    const res = await build({ degraded: true }).answer(4, 'Hoa hồng bao nhiêu?', 'VI');
    expect(res.confidence).toBe(0);
    expect(res.timings).toEqual({ retrieveMs: expect.any(Number), generateMs: expect.any(Number) });
  });
});
