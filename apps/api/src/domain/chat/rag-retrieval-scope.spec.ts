import { RagService } from './rag.service';

/**
 * What an answer may be grounded in.
 *
 * These assert the predicates rather than the results: both retrieval legs pass
 * through `baseQuery`, so a rule dropped from it is bypassed everywhere at once
 * and nothing about the answer looks wrong — it just quietly cites something it
 * should not.
 */
describe('RagService retrieval scope', () => {
  function build() {
    const wheres: string[] = [];
    const qb: Record<string, unknown> = {};
    for (const m of ['where', 'andWhere', 'addSelect', 'setParameter', 'orderBy', 'addOrderBy', 'take']) {
      qb[m] = (arg: unknown) => {
        if (typeof arg === 'string') wheres.push(arg);
        return qb;
      };
    }
    qb.getMany = async () => [];
    const kbRepo = { createQueryBuilder: () => qb };
    const svc = new RagService(
      kbRepo as never,
      { findOne: async () => null } as never,
      { complete: jest.fn(), embed: jest.fn() } as never,
      { enabled: false, search: jest.fn() } as never,
      { getPersonaRules: jest.fn(), effectiveAgentId: jest.fn(async () => null) } as never,
    );
    return { svc, wheres };
  }

  const scopeOf = async (aiAgentId?: number | null) => {
    const { svc, wheres } = build();
    // Empty query takes the no-terms path, which still builds the same scope.
    await (
      svc as unknown as {
        retrieveFulltext: (t: number, q: string, l: number, a?: number | null) => Promise<unknown>;
      }
    ).retrieveFulltext(1, '', 5, aiAgentId);
    return wheres.join(' | ');
  };

  it('only reads active documents', async () => {
    expect(await scopeOf()).toContain('kb.active = 1');
  });

  it('stays inside the tenant, plus the global set', async () => {
    expect(await scopeOf()).toContain('kb.tenantId = :tenantId OR kb.tenantId IS NULL');
  });

  it('drops documents from a source the operator un-designated', async () => {
    // Un-designating is how an operator says "stop answering from this". Before
    // this predicate the flag sat on the source while retrieval looked only at
    // the document, so everything already ingested kept being cited.
    const scope = await scopeOf();

    expect(scope).toContain('knowledge_sources');
    expect(scope).toContain('designated = 0');
  });

  it('keeps documents that have no source at all', async () => {
    // Hand-written, catalogue-generated and gap-promoted documents carry no
    // source id; an IN-the-designated-set test would have removed all of them.
    expect(await scopeOf()).toContain('kb.sourceId IS NULL OR');
  });

  describe('per-agent category scope (REQ-260826 R2)', () => {
    it('adds nothing when no agent is answering', async () => {
      // The console and agent coaching retrieve without an agent and must keep
      // seeing everything the tenant has — you cannot fix what is hidden.
      expect(await scopeOf(null)).not.toContain('kb_categories');
    });

    it('excludes categories this agent is not listed in', async () => {
      const scope = await scopeOf(7);

      expect(scope).toContain('kb_categories');
      expect(scope).toContain('JSON_CONTAINS(c.agent_ids');
    });

    it('phrases it as exclusion of the scoped set, never as an allow-list', async () => {
      // The difference is what happens to everything nobody has scoped: with an
      // IN test a tenant that never opens the screen would lose its whole
      // knowledge base the moment one category was narrowed.
      const scope = await scopeOf(7);

      expect(scope).toContain('NOT EXISTS');
      expect(scope).toContain('JSON_LENGTH(c.agent_ids) > 0');
    });

    it('matches the excluded category as a (group, name) pair (PLN-260829 D2-e)', async () => {
      // The same string may exist in another group as a different category —
      // a name-only match would darken both when only one was narrowed.
      const scope = await scopeOf(7);
      expect(scope).toContain('c.doc_group = kb.doc_group');
      expect(scope).toContain('c.name = kb.category');
    });

    it('leaves uncategorised documents alone', async () => {
      expect(await scopeOf(7)).toContain('kb.category IS NULL OR');
    });

    it('never narrows catalogue categories', async () => {
      // Product knowledge is common to every persona by decision (REQ D3), and
      // origin flips when a hand-made category takes catalogue documents — so
      // the read side has to hold the line too, not just the save.
      expect(await scopeOf(7)).toContain("c.origin <> 'catalog'");
    });
  });

  describe('guest gate scope (PLN-261001 v1.1 T3)', () => {
    const scopeWith = async (opts?: { guestOnly?: boolean }) => {
      const { svc, wheres } = build();
      await (
        svc as unknown as {
          retrieveFulltext: (
            t: number,
            q: string,
            l: number,
            a?: number | null,
            o?: { guestOnly?: boolean },
          ) => Promise<unknown>;
        }
      ).retrieveFulltext(1, '', 5, 10, opts);
      return wheres.join(' | ');
    };

    it('an unidentified visitor of a gated agent only reads guest-visible categories', async () => {
      const scope = await scopeWith({ guestOnly: true });
      expect(scope).toContain('g.guest_visible = 1');
      // Uncategorised documents are NOT opened by the flag: nothing owns them.
      expect(scope).toContain('kb.category IS NOT NULL');
    });

    it('is not applied unless asked — every other caller keeps its scope byte-identical', async () => {
      expect(await scopeWith()).not.toContain('guest_visible');
      expect(await scopeWith({ guestOnly: false })).not.toContain('guest_visible');
    });
  });
});
