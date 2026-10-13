import { KB_VERSION_CAVEAT_DEFAULTS } from '@sharptalk/types';
import type { KbVersionPolicy } from '@sharptalk/types';
import { RagService } from './rag.service';

/**
 * KB UI-version stamping in retrieval and answers (PLN-261012 SG-20).
 *
 * `hide` is a retrieval predicate (asserted on the SQL, like rag-retrieval-scope);
 * the caveat is decided by a LIVE read of the cited documents' versions, so a
 * replayed answer — whose stored citations are days old — is covered too.
 */

const policy = (over: Partial<KbVersionPolicy> = {}): KbVersionPolicy => ({
  referenceVersion: 'v0.12.0',
  onMismatch: 'caveat',
  ...over,
});

describe('RagService KB UI version', () => {
  function build(stored: KbVersionPolicy | null, docs: Array<{ id: number; uiVersion: string | null }> = []) {
    const ands: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    const qb: Record<string, unknown> = {};
    for (const m of ['where', 'addSelect', 'setParameter', 'orderBy', 'addOrderBy', 'take']) qb[m] = () => qb;
    qb.andWhere = (sql: unknown, params?: Record<string, unknown>) => {
      if (typeof sql === 'string') ands.push({ sql, params });
      return qb;
    };
    qb.getMany = async () => [];
    const find = jest.fn(async () => docs);
    const kbRepo = { createQueryBuilder: () => qb, find };
    const getKbVersionPolicy = jest.fn(async () => stored);
    const svc = new RagService(
      kbRepo as never,
      { findOne: async () => null } as never,
      { complete: jest.fn(), embed: jest.fn() } as never,
      { enabled: false, search: jest.fn() } as never,
      { getKbVersionPolicy, getPersonaRules: jest.fn(), effectiveAgentId: jest.fn(async () => null) } as never,
    );
    return { svc, ands, find, getKbVersionPolicy };
  }

  /** What the keyword leg asks MySQL, as `retrieveHybrid` resolves the policy. */
  const searchPredicates = async (stored: KbVersionPolicy | null) => {
    const { svc, ands } = build(stored);
    await (
      svc as unknown as {
        retrieveHybrid: (...a: unknown[]) => Promise<unknown>;
      }
    ).retrieveHybrid(1, 'how do I reconcile', 6, undefined, null, undefined);
    return ands;
  };

  describe('hide (retrieval predicate)', () => {
    it('keeps unversioned documents and the reference version, nothing else', async () => {
      const ands = await searchPredicates(policy({ onMismatch: 'hide' }));
      const hit = ands.find((a) => a.sql.includes('ui_version'));
      expect(hit).toBeDefined();
      // Unversioned (NULL or blank) is never hidden: that is a console warning.
      expect(hit!.sql).toContain('kb.ui_version IS NULL');
      expect(hit!.sql).toContain("TRIM(kb.ui_version) = ''");
      // The reference is compared NORMALISED on both sides.
      expect(hit!.sql).toContain('LOWER(TRIM(kb.ui_version))');
      expect(hit!.params).toEqual({ uiVersionRef: '0.12.0' });
    });

    it('is applied to the vector re-hydration through the same baseQuery', async () => {
      const { svc, ands } = build(policy({ onMismatch: 'hide' }));
      // A vector-only hit is re-hydrated by id through baseQuery; with the scope
      // pinned it must carry the predicate too.
      await (
        svc as unknown as { baseQuery: (t: number, a?: number | null, o?: unknown) => unknown }
      ).baseQuery(1, null, { uiVersionReference: '0.12.0' });
      expect(ands.some((a) => a.sql.includes('ui_version'))).toBe(true);
    });

    it.each([
      ['no policy', null],
      ['caveat', policy({ onMismatch: 'caveat' })],
      ['off', policy({ onMismatch: 'off' })],
      ['hide without a reference (cannot be stored, but a hand-edited row)', policy({ onMismatch: 'hide', referenceVersion: '  ' })],
    ])('adds no predicate for %s — retrieval is byte-identical', async (_n, stored) => {
      const ands = await searchPredicates(stored as KbVersionPolicy | null);
      expect(ands.some((a) => a.sql.includes('ui_version'))).toBe(false);
    });

    it('lets a caller pin the scope without reading the policy', async () => {
      const { svc, getKbVersionPolicy } = build(null);
      const scope = await (
        svc as unknown as { withVersionScope: (t: number, o?: unknown) => Promise<unknown> }
      ).withVersionScope(1, { uiVersionReference: 'x' });
      expect(scope).toEqual({ uiVersionReference: 'x' });
      expect(getKbVersionPolicy).not.toHaveBeenCalled();
    });

    it('keeps the other scope flags when it adds the version', async () => {
      const { svc } = build(policy({ onMismatch: 'hide' }));
      const scope = await (
        svc as unknown as { withVersionScope: (t: number, o?: unknown) => Promise<unknown> }
      ).withVersionScope(1, { guestOnly: true });
      expect(scope).toEqual({ guestOnly: true, uiVersionReference: '0.12.0' });
    });
  });

  describe('versionCaveat (answer sentence)', () => {
    const cite = (...ids: number[]) => ids.map((id) => ({ id }));

    it('is the built-in sentence when a cited document carries another version', async () => {
      const { svc } = build(null, [{ id: 5, uiVersion: 'v0.9.2' }]);
      expect(await svc.versionCaveat(1, policy(), cite(5), 'EN')).toBe(KB_VERSION_CAVEAT_DEFAULTS.EN);
    });

    it.each(['EN', 'ES', 'KO', 'VI', 'JA', 'ZH'] as const)('speaks %s', async (lang) => {
      const { svc } = build(null, [{ id: 5, uiVersion: 'v0.9.2' }]);
      expect(await svc.versionCaveat(1, policy(), cite(5), lang)).toBe(KB_VERSION_CAVEAT_DEFAULTS[lang]);
    });

    it('uses the tenant wording for the session language', async () => {
      const { svc } = build(null, [{ id: 5, uiVersion: 'v0.9.2' }]);
      const custom = policy({ notice: { VI: 'Hướng dẫn này theo bản v0.9.2.' } });
      expect(await svc.versionCaveat(1, custom, cite(5), 'VI')).toBe('Hướng dẫn này theo bản v0.9.2.');
      expect(await svc.versionCaveat(1, custom, cite(5), 'EN')).toBe(KB_VERSION_CAVEAT_DEFAULTS.EN);
    });

    it('is silent for a document with no version', async () => {
      const { svc } = build(null, [{ id: 5, uiVersion: null }, { id: 6, uiVersion: '  ' }]);
      expect(await svc.versionCaveat(1, policy(), cite(5, 6), 'EN')).toBeNull();
    });

    it('is silent when every cited document is on the reference version, however it is spelled', async () => {
      const { svc } = build(null, [{ id: 5, uiVersion: '0.12.0' }, { id: 6, uiVersion: 'V0.12.0' }]);
      expect(await svc.versionCaveat(1, policy({ referenceVersion: 'v0.12.0' }), cite(5, 6), 'EN')).toBeNull();
    });

    it('says it ONCE however many cited documents mismatch', async () => {
      const { svc } = build(null, [
        { id: 5, uiVersion: 'v0.9.2' },
        { id: 6, uiVersion: 'v0.10.0' },
        { id: 7, uiVersion: 'v0.12.0' },
      ]);
      const text = await svc.versionCaveat(1, policy(), cite(5, 6, 7), 'EN');
      expect(text).toBe(KB_VERSION_CAVEAT_DEFAULTS.EN);
    });

    it('fires if just one of several cited documents mismatches', async () => {
      const { svc } = build(null, [
        { id: 5, uiVersion: 'v0.12.0' },
        { id: 6, uiVersion: 'v0.9.2' },
        { id: 7, uiVersion: null },
      ]);
      expect(await svc.versionCaveat(1, policy(), cite(5, 6, 7), 'EN')).not.toBeNull();
    });

    it('works on both axes the project has seen (v23.x and v0.x)', async () => {
      const a = build(null, [{ id: 5, uiVersion: 'v23.3.0' }]);
      expect(await a.svc.versionCaveat(1, policy({ referenceVersion: 'v23.4.0' }), cite(5), 'EN')).not.toBeNull();
      const b = build(null, [{ id: 5, uiVersion: 'v23.4.0' }]);
      expect(await b.svc.versionCaveat(1, policy({ referenceVersion: 'v23.4.0' }), cite(5), 'EN')).toBeNull();
    });

    it.each([
      ['no policy', null],
      ['off', policy({ onMismatch: 'off' })],
      // hide already kept other versions out of the context: nothing to warn about.
      ['hide', policy({ onMismatch: 'hide' })],
      ['no reference', policy({ referenceVersion: '' })],
    ])('does not even read the database for %s', async (_n, stored) => {
      const { svc, find } = build(null, [{ id: 5, uiVersion: 'v0.9.2' }]);
      expect(await svc.versionCaveat(1, stored as KbVersionPolicy | null, cite(5), 'EN')).toBeNull();
      expect(find).not.toHaveBeenCalled();
    });

    it('reads the versions LIVE in one batch, ignoring what a stored citation says', async () => {
      // A replayed answer's citations were stored days ago. The document was
      // re-stamped since; the stored `uiVersion` must not be believed.
      const { svc, find } = build(null, [{ id: 5, uiVersion: 'v0.9.2' }]);
      const stale = [{ id: 5, uiVersion: 'v0.12.0' }];
      expect(await svc.versionCaveat(1, policy(), stale, 'EN')).not.toBeNull();
      expect(find).toHaveBeenCalledTimes(1);
    });

    it('queries each distinct positive id once, inside the tenant (and the shared set)', async () => {
      const { svc, find } = build(null, []);
      await svc.versionCaveat(7, policy(), [{ id: 5 }, { id: '5' }, { id: 6 }, { id: -1 }, { id: 0 }, { id: 'x' }, {}], 'EN');
      const arg = find.mock.calls[0][0] as unknown as {
        where: Array<{ id: { _value: number[] }; tenantId: unknown }>;
        select: string[];
      };
      expect(arg.where).toHaveLength(2);
      // Synthetic board candidates (negative ids) and junk never reach the query.
      expect(arg.where[0].id._value).toEqual([5, 6]);
      expect(arg.where[0].tenantId).toBe(7);
      expect(arg.select).toEqual(['id', 'uiVersion']);
    });

    it('does nothing without citations (an agent-written reply stored without any)', async () => {
      const { svc, find } = build(null);
      expect(await svc.versionCaveat(1, policy(), [], 'EN')).toBeNull();
      expect(await svc.versionCaveat(1, policy(), undefined, 'EN')).toBeNull();
      expect(find).not.toHaveBeenCalled();
    });

    it('is silent when the cited documents are gone', async () => {
      const { svc } = build(null, []);
      expect(await svc.versionCaveat(1, policy(), cite(5), 'EN')).toBeNull();
    });
  });
});
