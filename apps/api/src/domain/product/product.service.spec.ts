import { IsNull, Like } from 'typeorm';
import { ProductService } from './product.service';
import { ProductCache } from './entity/product-cache.entity';
import { BusinessException } from '../../global/exception/business.exception';

/** ProductService — tenant-scoped catalog reads (PLN-260807 F1). */
describe('ProductService', () => {
  function build(rows: Partial<ProductCache>[] = [], saves: Array<{ productHandle: string }> = []) {
    const repo = {
      findAndCount: jest.fn().mockResolvedValue([rows as ProductCache[], rows.length]),
      find: jest.fn(async (opts?: { where?: { handle?: unknown; status?: string }; take?: number }) => {
        // Recommendation queries hit find() twice (saved join, candidates); the
        // legacy suites only assert call args, so returning the full fixture with
        // basic filters applied keeps every caller honest enough.
        let out = rows as ProductCache[];
        const status = opts?.where?.status;
        if (status) out = out.filter((r) => r.status === undefined || r.status === status);
        const handleIn = opts?.where?.handle as { value?: string[] } | undefined;
        if (handleIn?.value) out = out.filter((r) => handleIn.value?.includes(r.handle));
        if (opts?.take) out = out.slice(0, opts.take);
        return out;
      }),
      findOne: jest.fn(async ({ where }: { where: { handle: string } }) =>
        (rows as ProductCache[]).find((r) => r.handle === where.handle) ?? null,
      ),
    };
    const saveRepo = {
      find: jest.fn().mockResolvedValue(saves),
    };
    const docRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    return {
      svc: new ProductService(repo as never, saveRepo as never, docRepo as never),
      repo,
      saveRepo,
      docRepo,
    };
  }

  describe('list', () => {
    it('filters by tenant + active status, newest first, paginated', async () => {
      const { svc, repo } = build([{ handle: 'a' }]);
      await svc.list(7, undefined, undefined, 2, 20);
      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: { tenantId: 7, status: 'active', companyId: IsNull() },
        order: { publishedAt: 'DESC', id: 'DESC' },
        skip: 20,
        take: 20,
      });
    });

    it('searches title OR tags with a contains-LIKE', async () => {
      const { svc, repo } = build();
      await svc.list(7, 'serum', undefined, 1, 20);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { tenantId: 7, status: 'active', companyId: IsNull(), title: Like('%serum%') },
            { tenantId: 7, status: 'active', companyId: IsNull(), tags: Like('%serum%') },
          ],
        }),
      );
    });

    it('applies an exact category filter alongside the search', async () => {
      const { svc, repo } = build();
      await svc.list(7, 'mask', 'Skin Care', 1, 20);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { tenantId: 7, status: 'active', companyId: IsNull(), category: 'Skin Care', title: Like('%mask%') },
            { tenantId: 7, status: 'active', companyId: IsNull(), category: 'Skin Care', tags: Like('%mask%') },
          ],
        }),
      );
    });

    it('a session without a tenant sees an empty catalog — no query issued', async () => {
      const { svc, repo } = build([{ handle: 'other-tenant-product' }]);
      expect(await svc.list(null, undefined, undefined, 1, 20)).toEqual([[], 0]);
      expect(repo.findAndCount).not.toHaveBeenCalled();
    });
  });

  describe('categories', () => {
    it('returns distinct non-empty categories of active rows, sorted', async () => {
      const { svc, repo } = build([
        { category: 'Serum' },
        { category: 'Mask' },
        { category: 'Serum' },
        { category: null },
        { category: '  ' },
      ]);
      expect(await svc.categories(7)).toEqual(['Mask', 'Serum']);
      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: 7, status: 'active', companyId: IsNull() },
        select: ['category'],
      });
    });

    it('is empty without a tenant', async () => {
      const { svc, repo } = build([{ category: 'Serum' }]);
      expect(await svc.categories(null)).toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('detail', () => {
    it('returns the row for the tenant + handle', async () => {
      const { svc } = build([{ handle: 'vita-c-serum', title: 'Vita C Serum' }]);
      const found = await svc.detail(7, 'vita-c-serum');
      expect(found.title).toBe('Vita C Serum');
    });

    it('404s on an unknown handle', async () => {
      const { svc } = build();
      await expect(svc.detail(7, 'nope')).rejects.toThrow(BusinessException);
    });

    it('404s without a tenant rather than searching cross-tenant', async () => {
      const { svc, repo } = build([{ handle: 'vita-c-serum' }]);
      await expect(svc.detail(null, 'vita-c-serum')).rejects.toThrow(BusinessException);
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('recommendations (A-10 v1 rules)', () => {
    // Fixture is pre-ordered newest-first — the stub repo does not sort, mirroring
    // the ORDER BY the service requests. All rows active.
    const catalog: Partial<ProductCache>[] = [
      { handle: 'new-toner', title: 'Toner', status: 'active', category: 'Toner', tags: 'hydration' },
      { handle: 'serum-b', title: 'Serum B', status: 'active', category: 'Serum', tags: 'brightening' },
      { handle: 'mask-vita', title: 'Mask', status: 'active', category: 'Mask', tags: 'vitamin-c, sheet' },
      { handle: 'serum-a', title: 'Serum A', status: 'active', category: 'Serum', tags: 'vitamin-c' },
    ];

    it('anonymous → newest actives capped at size', async () => {
      const { svc, repo } = build(catalog);
      const out = await svc.recommendations(7, null, 2);
      expect(out.map((p) => p.handle)).toEqual(['new-toner', 'serum-b']);
      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: 7, status: 'active', companyId: IsNull() },
        order: { publishedAt: 'DESC', id: 'DESC' },
        take: 2,
      });
    });

    it('zero-signal (customer with no saves) → newest actives', async () => {
      const { svc } = build(catalog, []);
      const out = await svc.recommendations(7, 42, 3);
      expect(out.map((p) => p.handle)).toEqual(['new-toner', 'serum-b', 'mask-vita']);
    });

    it('ranks category match (2) above tag-only match (1) above the newest fill', async () => {
      // Saved: serum-a (category Serum, tag vitamin-c).
      const { svc } = build(catalog, [{ productHandle: 'serum-a' }]);
      const out = await svc.recommendations(7, 42, 4);
      // serum-b: category Serum → 2; mask-vita: tag vitamin-c → 1; new-toner: 0 (fill).
      expect(out.map((p) => p.handle)).toEqual(['serum-b', 'mask-vita', 'new-toner']);
    });

    it('excludes handles the customer already saved', async () => {
      const { svc } = build(catalog, [{ productHandle: 'serum-a' }]);
      const out = await svc.recommendations(7, 42, 10);
      expect(out.map((p) => p.handle)).not.toContain('serum-a');
    });

    it('is empty without a tenant — no query issued', async () => {
      const { svc, repo, saveRepo } = build(catalog, [{ productHandle: 'serum-a' }]);
      expect(await svc.recommendations(null, 42, 10)).toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
      expect(saveRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('adminList (console)', () => {
    it('includes archived rows — the customer-facing list hides them, this one must not', async () => {
      const { svc, repo } = build([{ handle: 'a' }]);
      await svc.adminList(7, {}, 1, 20);
      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: { tenantId: 7 },
        order: { status: 'ASC', publishedAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 20,
      });
    });

    it('narrows to one status when asked, and ignores a value that is neither', async () => {
      const { svc, repo } = build([{ handle: 'a' }]);
      await svc.adminList(7, { status: 'archived' }, 1, 20);
      expect(repo.findAndCount.mock.calls[0][0].where).toEqual({
        tenantId: 7,
        status: 'archived',
      });

      await svc.adminList(7, { status: 'nonsense' }, 1, 20);
      expect(repo.findAndCount.mock.calls[1][0].where).toEqual({ tenantId: 7 });
    });

    it('searches title OR tags, keeping the other filters on both branches', async () => {
      const { svc, repo } = build([{ handle: 'a' }]);
      await svc.adminList(7, { q: ' 립 ', category: '립', status: 'active' }, 1, 20);
      expect(repo.findAndCount.mock.calls[0][0].where).toEqual([
        { tenantId: 7, category: '립', status: 'active', title: Like('%립%') },
        { tenantId: 7, category: '립', status: 'active', tags: Like('%립%') },
      ]);
    });

    it('returns nothing for a principal with no tenant, rather than everyone\'s catalogue', async () => {
      const { svc, repo } = build([{ handle: 'a' }]);
      await expect(svc.adminList(null, {}, 1, 20)).resolves.toEqual([[], 0]);
      expect(repo.findAndCount).not.toHaveBeenCalled();
    });
  });

  describe('adminSummary', () => {
    it('counts by status and reports the most recent sync', async () => {
      const { svc } = build([
        { handle: 'a', status: 'active', syncedAt: new Date('2026-08-08T01:00:00Z') },
        { handle: 'b', status: 'active', syncedAt: new Date('2026-08-08T03:00:00Z') },
        { handle: 'c', status: 'archived', syncedAt: null },
      ]);
      await expect(svc.adminSummary(7)).resolves.toEqual({
        total: 3,
        active: 2,
        archived: 1,
        lastSyncedAt: '2026-08-08T03:00:00.000Z',
      });
    });

    it('is empty for a principal with no tenant', async () => {
      const { svc } = build([{ handle: 'a', status: 'active' }]);
      await expect(svc.adminSummary(null)).resolves.toEqual({
        total: 0,
        active: 0,
        archived: 0,
        lastSyncedAt: null,
      });
    });
  });

  describe('knowledgeHandles', () => {
    it('resolves in ONE query for the whole page, keyed by handle', async () => {
      const { svc, docRepo } = build();
      docRepo.find.mockResolvedValue([{ externalKey: 'a' }, { externalKey: null }]);

      await expect(svc.knowledgeHandles(7, ['a', 'b'])).resolves.toEqual(new Set(['a']));
      expect(docRepo.find).toHaveBeenCalledTimes(1);
      expect(docRepo.find.mock.calls[0][0].where).toMatchObject({
        tenantId: 7,
        docGroup: 'product',
      });
    });

    it('does not query at all for an empty page', async () => {
      const { svc, docRepo } = build();
      await expect(svc.knowledgeHandles(7, [])).resolves.toEqual(new Set());
      expect(docRepo.find).not.toHaveBeenCalled();
    });
  });

});
