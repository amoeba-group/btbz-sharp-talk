import { RagService } from './rag.service';
import type { RetrievalOpts } from './rag.service';

/**
 * Role-tiered knowledge access in retrieval (PLN-261012 SG-10, REQ D-06 / D-15).
 *
 * Like rag-retrieval-scope these assert the PREDICATES, not rows: both legs and the
 * vector re-hydration pass through `baseQuery`, so a rule dropped from it is bypassed
 * everywhere at once and nothing about the answer looks wrong — it just quietly
 * quotes a settlement topic to a receptionist. (The predicate is also executed against
 * real MySQL in the TCR's smoke run.)
 */

type Where = { sql: string; params?: Record<string, unknown> };

/** The SQL text of every predicate `baseQuery` adds, joined — what a snapshot compares. */
const sqlOf = (wheres: Where[]) => wheres.map((w) => w.sql).join(' | ');

describe('RagService — audience tiers', () => {
  function build(opts: { managerCategories?: number; noCategoryRepo?: boolean; countFails?: boolean } = {}) {
    const wheres: Where[] = [];
    const qb: Record<string, unknown> = {};
    for (const m of ['addSelect', 'setParameter', 'orderBy', 'addOrderBy', 'take']) qb[m] = () => qb;
    for (const m of ['where', 'andWhere']) {
      qb[m] = (sql: unknown, params?: Record<string, unknown>) => {
        if (typeof sql === 'string') wheres.push({ sql, params });
        return qb;
      };
    }
    qb.getMany = async () => [];
    const count = jest.fn(async () => {
      if (opts.countFails) throw new Error('db down');
      return opts.managerCategories ?? 0;
    });
    const search = jest.fn(async () => [] as Array<{ id: number; score: number }>);
    const embed = jest.fn(async () => ({ vectors: [[0.1, 0.2]], provider: 'voyage' }));
    const svc = new RagService(
      { createQueryBuilder: () => qb } as never,
      { findOne: async () => null } as never,
      { complete: jest.fn(), embed } as never,
      { enabled: true, search } as never,
      { getPersonaRules: jest.fn(), effectiveAgentId: jest.fn(async () => null) } as never,
      opts.noCategoryRepo ? undefined : ({ count } as never),
    );
    return { svc, wheres, count, search, embed };
  }

  /** Everything the keyword leg asks MySQL for one search, through the real retrieval path. */
  const searchSql = async (retrievalOpts: RetrievalOpts | undefined, agentId: number | null, tiers = 1) => {
    const { svc, wheres } = build({ managerCategories: tiers });
    await svc.retrieve(1, 'how do I reconcile', 6, agentId, retrievalOpts);
    return sqlOf(wheres);
  };

  describe('the manager-only exclusion (baseQuery)', () => {
    it.each([
      ['public', true],
      ['partner', true],
      ['manager', false],
      [undefined, false],
    ] as const)('audience %s → exclusion present: %s', async (audience, present) => {
      const sql = await searchSql(audience ? { audience } : undefined, null);
      expect(sql.includes("a.min_audience = 'manager'")).toBe(present);
    });

    it('is phrased as "NOT in the manager-only set", never as an allow-list', async () => {
      const sql = await searchSql({ audience: 'partner' }, null);
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('FROM kb_categories a');
      // The (group, name) pair, like the agent scope: the same name in another group is another category.
      expect(sql).toContain('a.doc_group = kb.doc_group');
      expect(sql).toContain('a.name = kb.category');
      // Uncategorised documents belong to no tier.
      expect(sql).toContain('kb.category IS NULL OR');
    });

    it('does NOT shed the restriction for catalogue-origin categories (unlike the agent scope)', async () => {
      // A security restriction fails closed: a category whose origin flips must keep it.
      const sql = await searchSql({ audience: 'partner' }, null);
      expect(sql).not.toContain("origin <> 'catalog'");
    });

    it('is tenant-scoped through its own parameter', async () => {
      const { svc, wheres } = build({ managerCategories: 1 });
      await svc.retrieve(7, 'q', 6, null, { audience: 'public' });
      const hit = wheres.find((w) => w.sql.includes("a.min_audience = 'manager'"));
      expect(hit?.params).toEqual({ audienceTenantId: 7 });
    });

    it('applies to a GUEST of an open agent (no guest scope at all) — the audience, not the gate, decides', async () => {
      const sql = await searchSql({ audience: 'public' }, 15);
      expect(sql).toContain("a.min_audience = 'manager'");
      expect(sql).not.toContain('guest_visible');
    });

    it('applies on top of the guest-gate scope (the gated path), both predicates present', async () => {
      const sql = await searchSql({ guestOnly: true, audience: 'public' }, 15);
      expect(sql).toContain('g.guest_visible = 1');
      expect(sql).toContain("a.min_audience = 'manager'");
    });

    it('is applied to the vector re-hydration through the same baseQuery', async () => {
      const { svc, wheres } = build({ managerCategories: 1 });
      await (
        svc as unknown as { baseQuery: (t: number, a?: number | null, o?: RetrievalOpts) => unknown }
      ).baseQuery(1, null, { audience: 'partner' });
      expect(sqlOf(wheres)).toContain("a.min_audience = 'manager'");
    });

    it('an operator tester with no audience sees everything, as before', async () => {
      const sql = await searchSql(undefined, null);
      expect(sql).not.toContain('kb_categories');
    });
  });

  describe('a tenant with no manager-only category is searched byte-identically', () => {
    // Frozen from the code BEFORE this change (agent scope + guest scope + the base rules). If this
    // ever needs editing for a tenant that never configured a tier, that tenant's retrieval changed.
    const TODAY_BASE = [
      'kb.active = 1',
      '(kb.tenantId = :tenantId OR kb.tenantId IS NULL)',
      `(kb.sourceId IS NULL OR kb.sourceId NOT IN
             (SELECT s.id FROM knowledge_sources s WHERE s.designated = 0))`,
    ];

    it('the base predicates are exactly today\'s (no audience at all)', async () => {
      const { svc, wheres } = build();
      await svc.retrieve(1, 'q', 6, null, undefined);
      expect(wheres.map((w) => w.sql)).toEqual(TODAY_BASE);
    });

    it.each(['public', 'partner', 'manager'] as const)(
      'audience %s on a tier-less tenant produces the SAME predicates as no audience',
      async (audience) => {
        const without = build({ managerCategories: 0 });
        await without.svc.retrieve(1, 'q', 6, 15, undefined);
        const withAudience = build({ managerCategories: 0 });
        await withAudience.svc.retrieve(1, 'q', 6, 15, { audience });
        expect(sqlOf(withAudience.wheres)).toBe(sqlOf(without.wheres));
        expect(withAudience.wheres.map((w) => w.params)).toEqual(without.wheres.map((w) => w.params));
      },
    );

    it('same for the gated path: only the guest scope is added, nothing about tiers', async () => {
      const { svc, wheres } = build({ managerCategories: 0 });
      await svc.retrieve(1, 'q', 6, 15, { guestOnly: true, audience: 'public' });
      expect(sqlOf(wheres)).toContain('g.guest_visible = 1');
      expect(sqlOf(wheres)).not.toContain('min_audience');
    });

    it('asks the tenant ONCE per search, and never for an operator view or a manager', async () => {
      const a = build({ managerCategories: 0 });
      await a.svc.retrieve(1, 'q', 6, null, { audience: 'partner' });
      expect(a.count).toHaveBeenCalledTimes(1);
      expect(a.count).toHaveBeenCalledWith({ where: { tenantId: 1, minAudience: 'manager' } });

      const b = build({ managerCategories: 1 });
      await b.svc.retrieve(1, 'q', 6, null, undefined);
      await b.svc.retrieve(1, 'q', 6, null, { audience: 'manager' });
      expect(b.count).not.toHaveBeenCalled();
    });
  });

  describe('hasAudienceTiers fails CLOSED', () => {
    it('is false only when the tenant truly has no manager-only category', async () => {
      expect(await build({ managerCategories: 0 }).svc.hasAudienceTiers(1)).toBe(false);
      expect(await build({ managerCategories: 2 }).svc.hasAudienceTiers(1)).toBe(true);
    });

    it('is true when the answer is unknown: no repository, or a failed read', async () => {
      expect(await build({ noCategoryRepo: true }).svc.hasAudienceTiers(1)).toBe(true);
      expect(await build({ countFails: true }).svc.hasAudienceTiers(1)).toBe(true);
    });

    it('a failed tier read keeps the exclusion in the query rather than dropping it', async () => {
      const { svc, wheres } = build({ countFails: true });
      await svc.retrieve(1, 'q', 6, null, { audience: 'partner' });
      expect(sqlOf(wheres)).toContain("a.min_audience = 'manager'");
    });
  });

  describe('over-fetch on the vector leg (D-15)', () => {
    it('is three times the unscoped depth, as a fixed constant', () => {
      expect(RagService.SCOPED_LEG_LIMIT).toBe(24);
    });

    const vectorLimit = async (
      retrievalOpts: RetrievalOpts | undefined,
      tiers: number,
    ): Promise<number> => {
      const { svc, search } = build({ managerCategories: tiers });
      await svc.retrieve(1, 'how do I reconcile', 6, 15, retrievalOpts);
      expect(search).toHaveBeenCalledTimes(1);
      return (search.mock.calls[0] as unknown[])[2] as number;
    };

    it('looks 24 deep when an audience scope is active', async () => {
      expect(await vectorLimit({ audience: 'partner' }, 1)).toBe(24);
      expect(await vectorLimit({ audience: 'public' }, 1)).toBe(24);
    });

    it('looks 24 deep for the guest gate scope', async () => {
      expect(await vectorLimit({ guestOnly: true }, 0)).toBe(24);
    });

    it('stays at 8 when no scope applies: the operator view, a manager, or a tier-less tenant', async () => {
      expect(await vectorLimit(undefined, 1)).toBe(8);
      expect(await vectorLimit({ audience: 'manager' }, 1)).toBe(8);
      expect(await vectorLimit({ audience: 'partner' }, 0)).toBe(8);
    });
  });

  describe('grounding and answering pass the audience to retrieval', () => {
    it('groundingConfidence carries the audience into the search', async () => {
      const { svc, wheres } = build({ managerCategories: 1 });
      await svc.groundingConfidence(1, 'payout deadline', 15, { audience: 'partner' });
      expect(sqlOf(wheres)).toContain("a.min_audience = 'manager'");
    });

    it('groundingConfidence with the manager audience sees the manager-only categories', async () => {
      const { svc, wheres } = build({ managerCategories: 1 });
      await svc.groundingConfidence(1, 'payout deadline', 15, { audience: 'manager' });
      expect(sqlOf(wheres)).not.toContain('min_audience');
    });
  });
});

/**
 * REQ-261012 D-01 again, for the new scope: a follow-up turn searches twice (the earlier
 * turns folded in, then the message alone) and the audience must reach BOTH — the second
 * search once lost the guest scope exactly this way.
 */
describe('RagService.answer — the audience reaches every search of a turn', () => {
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

  it.each(['public', 'partner'] as const)(
    'applies audience %s to the contextual search AND to the message-alone search',
    async (audience) => {
      const { svc, calls } = build();
      await svc.answer(
        1,
        'How do I change the payout bank account?',
        'EN',
        undefined,
        undefined,
        'Check-in? How do I change the payout bank account?',
        15,
        undefined,
        undefined,
        { audience },
      );
      expect(calls.map((c) => c.query)).toEqual([
        'Check-in? How do I change the payout bank account?',
        'How do I change the payout bank account?',
      ]);
      for (const c of calls) expect(c.opts).toEqual({ audience });
    },
  );

  it('keeps the audience next to the guest scope on both searches', async () => {
    const { svc, calls } = build();
    await svc.answer(1, 'q2', 'EN', undefined, undefined, 'q1 q2', 15, undefined, undefined, {
      guestOnly: true,
      audience: 'public',
    });
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.opts).toEqual({ guestOnly: true, audience: 'public' });
  });
});
