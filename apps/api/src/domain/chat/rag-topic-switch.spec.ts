import { RagService } from './rag.service';

/**
 * FIX-261007-Topic-Switch — the current message is searched on its own too.
 * go2joy 17816: "How do I process a guest check-in?" after a staff-account
 * answer retrieved only staff documents through the contextual query.
 */
describe('RagService — topic switch keeps its own documents', () => {
  const d = (id: number, title = `d${id}`) => ({ id, title, category: 'guide', snippet: 's', similarity: 0.5 });

  describe('mergeOwnFirst', () => {
    it('puts the current message’s top hits first, then the context’s', () => {
      const own = [d(1), d(2), d(3), d(4)];
      const ctx = [d(10), d(11), d(12), d(13)];
      expect(RagService.mergeOwnFirst(own, ctx, 6).map((c) => c.id)).toEqual([1, 2, 3, 10, 11, 12]);
    });

    it('deduplicates by document id, bigint strings included', () => {
      const own = [d(1), d(2)];
      const ctx = [{ ...d(2), id: '2' as unknown as number }, d(3)];
      expect(RagService.mergeOwnFirst(own, ctx, 6).map((c) => Number(c.id))).toEqual([1, 2, 3]);
    });

    it('fills from the rest of the own list when the context runs short', () => {
      expect(RagService.mergeOwnFirst([d(1), d(2), d(3), d(4), d(5)], [d(9)], 6).map((c) => c.id)).toEqual([
        1, 2, 3, 9, 4, 5,
      ]);
    });
  });

  describe('answer()', () => {
    const build = () => {
      const queries: string[] = [];
      const complete = jest.fn(async () => ({ text: 'ok\nCITED: 1', tokensIn: 1, tokensOut: 1, provider: 'anthropic' }));
      const svc = new RagService(
        { createQueryBuilder: () => ({}) } as never,
        { findOne: async () => null } as never,
        { complete } as never,
        { enabled: false, search: jest.fn() } as never,
        { getPersonaRules: jest.fn(async () => ({ persona: 'P', rules: [] })), effectiveAgentId: jest.fn(async () => 1) } as never,
      );
      (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async (_t: number, q: string) => {
        queries.push(q);
        return q.includes('staff account')
          ? { chunks: [d(48, 'Creating a staff account')], vectorProvider: 'voyage' }
          : { chunks: [d(21, 'Processing a check-in')], vectorProvider: 'voyage' };
      };
      return { svc, queries, complete };
    };

    it('searches the context query and the message alone, and gives the model both', async () => {
      const { svc, queries, complete } = build();
      await svc.answer(
        4,
        'How do I process a guest check-in?',
        'EN',
        undefined,
        undefined,
        'How do I create a front desk staff account?\nHow do I process a guest check-in?',
      );
      expect(queries).toHaveLength(2);
      const system = (complete.mock.calls[0] as unknown as [{ system: string }])[0].system;
      expect(system).toContain('[1] [guide] Processing a check-in');
      expect(system).toContain('Creating a staff account');
    });

    it('searches once when there is no separate context query (console paths)', async () => {
      const { svc, queries } = build();
      await svc.answer(4, 'How do I process a guest check-in?', 'EN');
      expect(queries).toHaveLength(1);
    });
  });
});
