import { RagService } from './rag.service';

/**
 * What `aiAgentId = null` means at the answer() seam.
 *
 * Two callers pass null for opposite reasons: the console means "no scope, show
 * me everything I manage", and a widget turn means "this session is unpinned".
 * Resolving null to the default agent inside RAG collapsed the two, and the
 * console's own knowledge lookup lost every scoped category — a staging smoke
 * (T9) caught it after the unit tests passed. RAG now applies what it is given;
 * chat.service resolves before calling.
 */
describe('RagService.answer — agent scope is applied, not inferred', () => {
  function build() {
    const scopeArgs: Array<number | null | undefined> = [];
    const optsArgs: unknown[] = [];
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      {
        complete: jest.fn(async () => ({ text: 'ok', tokensIn: 1, tokensOut: 1, provider: 'stub' })),
        embed: jest.fn(),
      } as never,
      { enabled: false, search: jest.fn() } as never,
      {
        getPersonaRules: jest.fn(async () => ({ persona: 'P', rules: [] })),
        effectiveAgentId: jest.fn(async () => 1),
      } as never,
    );
    // Retrieval itself is covered by rag-retrieval-scope.spec.ts; here only the
    // value that reaches it matters.
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async (
      _t: number,
      _q: string,
      _l: number,
      _g: string | undefined,
      agentId: number | null | undefined,
      opts?: unknown,
    ) => {
      scopeArgs.push(agentId);
      optsArgs.push(opts);
      return { chunks: [], vectorProvider: null };
    };
    return { svc, scopeArgs, optsArgs };
  }

  it('passes null straight through — no scope for the operator view', async () => {
    const { svc, scopeArgs } = build();

    await svc.answer(1, 'q', 'EN', undefined, undefined, undefined, null);

    expect(scopeArgs).toEqual([null]);
  });

  it('passes the agent it was handed, without re-resolving it', async () => {
    const { svc, scopeArgs } = build();

    await svc.answer(1, 'q', 'EN', undefined, undefined, undefined, 15);

    expect(scopeArgs).toEqual([15]);
  });
});

/**
 * REQ-261012 D-01. A follow-up turn searches twice — once with the earlier
 * turns folded in, once with the message alone — and the guest scope has to
 * reach both. The second search used to be called without it, so a signed-out
 * visitor's follow-up could surface documents outside the public categories.
 */
describe('RagService.answer — the guest scope reaches every search of a turn', () => {
  function build() {
    const calls: Array<{ query: string; agentId: unknown; opts: unknown }> = [];
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      {
        complete: jest.fn(async () => ({ text: 'ok', tokensIn: 1, tokensOut: 1, provider: 'stub' })),
        embed: jest.fn(),
      } as never,
      { enabled: false, search: jest.fn() } as never,
      {
        getPersonaRules: jest.fn(async () => ({ persona: 'P', rules: [] })),
        effectiveAgentId: jest.fn(async () => 1),
      } as never,
    );
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async (
      _t: number,
      query: string,
      _l: number,
      _g: string | undefined,
      agentId: number | null | undefined,
      opts?: unknown,
    ) => {
      calls.push({ query, agentId, opts });
      return { chunks: [], vectorProvider: null };
    };
    return { svc, calls };
  }

  it('applies guestOnly to the contextual search AND to the message-alone search', async () => {
    const { svc, calls } = build();

    await svc.answer(
      1,
      'How do I change the payout bank account?',
      'EN',
      undefined,
      undefined,
      'How do I log in? How do I change the payout bank account?',
      15,
      undefined,
      undefined,
      { guestOnly: true },
    );

    expect(calls.map((c) => c.query)).toEqual([
      'How do I log in? How do I change the payout bank account?',
      'How do I change the payout bank account?',
    ]);
    for (const c of calls) {
      expect(c.opts).toEqual({ guestOnly: true });
      expect(c.agentId).toBe(15);
    }
  });

  it('runs a single search, scoped, when there is no earlier context', async () => {
    const { svc, calls } = build();

    await svc.answer(1, 'q', 'EN', undefined, undefined, undefined, 15, undefined, undefined, { guestOnly: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toEqual({ guestOnly: true });
  });

  it('leaves a signed-in turn unscoped by the guest rule on both searches', async () => {
    const { svc, calls } = build();

    await svc.answer(1, 'second', 'EN', undefined, undefined, 'first second', 15, undefined, undefined, undefined);

    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.opts).toBeUndefined();
  });
});
