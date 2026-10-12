import { KbCategoryService } from './kb-category.service';
import { CATEGORY_ORIGIN, KbCategory } from './entity/kb-category.entity';
import { KbDocument } from './entity/kb-document.entity';

describe('KbCategoryService', () => {
  const row = (over: Partial<KbCategory> = {}): KbCategory =>
    ({
      id: 1,
      tenantId: 1,
      name: 'faq',
      label: null,
      origin: CATEGORY_ORIGIN.MANUAL,
      sortOrder: 10,
      hidden: 0,
      ...over,
    }) as KbCategory;

  const build = (
    rows: KbCategory[] = [],
    counts: Record<string, number> = {},
    agents: Array<{ id: number }> = [],
  ) => {
    const saved: any[] = [];
    const updates: any[] = [];
    const deletes: any[] = [];
    const repo = {
      find: jest.fn(async () => rows),
      findOne: jest.fn(async ({ where }: any) =>
        rows.find((r) =>
          where.id !== undefined ? String(r.id) === String(where.id) : r.name === where.name,
        ) ?? null,
      ),
      create: (d: any) => ({ ...d }),
      save: jest.fn(async (d: any) => {
        saved.push(d);
        return { id: 99, ...d };
      }),
      delete: jest.fn(async (w: any) => deletes.push(w)),
    };
    const docRepo = {
      count: jest.fn(async ({ where }: any) => counts[where.category] ?? 0),
      createQueryBuilder: () => ({
        select: function () { return this; },
        addSelect: function () { return this; },
        where: function () { return this; },
        andWhere: function () { return this; },
        groupBy: function () { return this; },
        getRawMany: async () =>
          Object.entries(counts).map(([category, count]) => ({ category, count: String(count) })),
      }),
    };
    const manager = {
      update: jest.fn(async (_e: unknown, where: any, set: any) => {
        updates.push({ where, set });
        return { affected: counts[where.category] ?? 0 };
      }),
      delete: jest.fn(async (_e: unknown, where: any) => deletes.push(where)),
    };
    const dataSource = { transaction: async (fn: any) => fn(manager) };
    return {
      svc: new KbCategoryService(
        repo as never,
        docRepo as never,
        // Agent rows exist only so scope ids can be checked against them.
        { find: jest.fn(async () => agents) } as never,
        dataSource as never,
      ),
      saved,
      updates,
      deletes,
    };
  };

  describe('list', () => {
    it('counts from the documents, not from the table', async () => {
      // A row whose documents were all moved must read 0, not its old total.
      const { svc } = build([row({ id: 1, name: 'faq' })], { faq: 3 });

      const out = await svc.list(1);

      expect(out[0]).toMatchObject({ name: 'faq', documentCount: 3 });
    });

    it('surfaces a category documents carry but no row describes', async () => {
      // Drift is the price of keeping the string on the document. Showing it
      // beats omitting those documents from the tenant's own category list.
      const { svc } = build([row({ id: 1, name: 'faq' })], { faq: 1, orphan: 4 });

      const out = await svc.list(1);

      expect(out.map((c) => c.name)).toEqual(['faq', 'orphan']);
      expect(out.find((c) => c.name === 'orphan')).toMatchObject({
        id: 'unregistered:orphan',
        documentCount: 4,
      });
    });
  });

  describe('setAgents (REQ-260826 R2)', () => {
    it('stores the agents a category is narrowed to', async () => {
      const { svc, saved } = build([row({ id: 1, name: 'policy_payment' })], {}, [
        { id: 3 },
        { id: 5 },
      ]);

      await svc.setAgents(1, 1, [3]);

      expect(saved[0].agentIds).toEqual([3]);
    });

    it('treats an empty list as "every agent", not as "nobody"', async () => {
      // A category no agent can read would be indistinguishable from a deleted
      // one while still counting documents in the console.
      const { svc, saved } = build([row({ id: 1, agentIds: [3] } as never)], {}, [{ id: 3 }]);

      await svc.setAgents(1, 1, []);

      expect(saved[0].agentIds).toBeNull();
    });

    it('refuses ids that are not this tenant’s agents', async () => {
      // Storing one would read as a narrowing nobody can satisfy: the category
      // goes dark while the console still shows it scoped.
      const { svc } = build([row({ id: 1 })], {}, [{ id: 3 }]);

      await expect(svc.setAgents(1, 1, [999])).rejects.toThrow();
    });

    it('drops unknown ids but keeps the valid ones', async () => {
      const { svc, saved } = build([row({ id: 1 })], {}, [{ id: 3 }]);

      await svc.setAgents(1, 1, [3, 999]);

      expect(saved[0].agentIds).toEqual([3]);
    });

    it('refuses to narrow a catalogue category', async () => {
      // Product knowledge is common to every persona by decision; accepting the
      // save would leave an operator believing they had restricted it.
      const { svc } = build([row({ id: 1, origin: CATEGORY_ORIGIN.CATALOG })], {}, [{ id: 3 }]);

      await expect(svc.setAgents(1, 1, [3])).rejects.toThrow();
    });
  });

  describe('list reports scope', () => {
    it('reports a catalogue category as unscoped whatever the column holds', async () => {
      // origin flips when a hand-made category takes catalogue documents, and a
      // stale narrowing left behind would contradict what retrieval does.
      const { svc } = build(
        [row({ id: 1, origin: CATEGORY_ORIGIN.CATALOG, agentIds: [3] } as never)],
        { faq: 2 },
      );

      const [cat] = await svc.list(1);

      expect(cat.agentIds).toEqual([]);
    });
  });

  describe('setGuestVisible (PLN-261001 v1.1 T2)', () => {
    it('opens and closes a category to unidentified visitors', async () => {
      const { svc, saved } = build([row({ id: 1, name: 'faq' })]);

      await svc.setGuestVisible(1, 1, true);
      expect(saved[0]).toMatchObject({ guestVisible: 1 });

      await svc.setGuestVisible(1, 1, false);
      expect(saved[1]).toMatchObject({ guestVisible: 0 });
    });

    it('refuses a catalogue category — product knowledge has no sign-in story', async () => {
      const { svc } = build([row({ id: 1, name: 'cat', origin: CATEGORY_ORIGIN.CATALOG })]);

      await expect(svc.setGuestVisible(1, 1, true)).rejects.toThrow();
    });

    it('reports the flag in the list and defaults it to closed', async () => {
      const { svc } = build([
        row({ id: 1, name: 'open', guestVisible: 1 } as never),
        row({ id: 2, name: 'closed' }),
      ]);

      const list = await svc.list(1, 'counsel');

      expect(list.find((c) => c.name === 'open')?.guestVisible).toBe(true);
      expect(list.find((c) => c.name === 'closed')?.guestVisible).toBe(false);
    });
  });

  describe('ensure', () => {
    it('never touches the guest flag of an existing category', async () => {
      const { svc, saved } = build([row({ id: 1, name: 'faq', guestVisible: 1 } as never)]);

      await svc.ensure(1, 'faq', CATEGORY_ORIGIN.MANUAL, 'counsel');

      expect(saved).toHaveLength(0);
    });

    it('never touches the scope of an existing category', async () => {
      // Sync ensures every category on every run: writing a default here would
      // quietly release the operator's scope at the next sync.
      const { svc, saved } = build([row({ id: 1, name: 'faq', agentIds: [3] } as never)]);

      await svc.ensure(1, 'faq', CATEGORY_ORIGIN.MANUAL);

      expect(saved).toHaveLength(0);
    });
  });

  describe('rename', () => {
    it('moves the row and its documents together', async () => {
      const { svc, updates } = build([row({ id: 1, name: 'faq' })], { faq: 13 });

      await svc.rename(1, 1, 'Questions');

      expect(updates).toEqual([
        { where: { id: 1 }, set: { name: 'Questions' } },
        { where: { tenantId: 1, category: 'faq' }, set: { category: 'Questions' } },
      ]);
    });

    it('refuses a catalogue-derived category', async () => {
      // Product sync compares the stored category to decide a document is
      // unchanged, so this rename would be undone at the next run. An edit that
      // reverts itself is worse than one that was never offered.
      const { svc, updates } = build([row({ id: 1, name: 'Nike', origin: CATEGORY_ORIGIN.CATALOG })]);

      await expect(svc.rename(1, 1, 'Nike Inc')).rejects.toThrow();
      expect(updates).toHaveLength(0);
    });

    it('refuses to rename onto an existing name — that is a merge', async () => {
      const { svc, updates } = build([row({ id: 1, name: 'faq' }), row({ id: 2, name: 'policy' })]);

      await expect(svc.rename(1, 1, 'policy')).rejects.toThrow();
      expect(updates).toHaveLength(0);
    });
  });

  describe('merge', () => {
    it('moves documents into the target and drops the emptied rows', async () => {
      const rows = [
        row({ id: 1, name: 'policy' }),
        row({ id: 2, name: 'policy_return' }),
        row({ id: 3, name: 'policy_claims' }),
      ];
      const { svc, updates, deletes } = build(rows, { policy_return: 2, policy_claims: 0 });

      const res = await svc.merge(1, [2, 3], 1);

      expect(res.moved).toBe(2);
      expect(updates.map((u) => u.where.category)).toEqual(['policy_return', 'policy_claims']);
      expect(updates.every((u) => u.set.category === 'policy')).toBe(true);
      expect(deletes).toHaveLength(2);
    });

    it('ignores the target appearing in its own source list', async () => {
      const { svc, updates } = build([row({ id: 1, name: 'policy' })]);

      expect(await svc.merge(1, [1], 1)).toEqual({ moved: 0 });
      expect(updates).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('refuses while documents are still filed under it', async () => {
      // Deleting would strand them: the string stays on the document either way.
      const { svc, deletes } = build([row({ id: 1, name: 'faq' })], { faq: 13 });

      await expect(svc.remove(1, 1)).rejects.toThrow();
      expect(deletes).toHaveLength(0);
    });

    it('removes an empty one', async () => {
      const { svc, deletes } = build([row({ id: 1, name: 'faq' })], {});

      await svc.remove(1, 1);

      expect(deletes).toHaveLength(1);
    });
  });

  describe('ensure', () => {
    it('registers a category a writer just invented', async () => {
      const { svc, saved } = build([]);

      await svc.ensure(1, 'Nike', CATEGORY_ORIGIN.CATALOG);

      expect(saved[0]).toMatchObject({ name: 'Nike', origin: 'catalog' });
    });

    it('is a no-op when the row already exists with the same origin', async () => {
      const { svc, saved } = build([
        row({ id: 1, name: 'Nike', origin: CATEGORY_ORIGIN.CATALOG }),
      ]);

      await svc.ensure(1, 'Nike', CATEGORY_ORIGIN.CATALOG);

      expect(saved).toHaveLength(0);
    });

    it('locks a hand-made category once product sync files a document under it', async () => {
      // Staging has two of these — `Kiss New York` holds 135 catalogue
      // documents and 26 hand-written ones. Left editable, a rename would be
      // undone for the catalogue half at the next sync and split the category.
      const { svc, saved } = build([row({ id: 1, name: 'Kiss New York' })]);

      await svc.ensure(1, 'Kiss New York', CATEGORY_ORIGIN.CATALOG);

      expect(saved[0]).toMatchObject({ name: 'Kiss New York', origin: 'catalog' });
    });

    it('does not demote a catalogue category when a human files one there', async () => {
      const { svc, saved } = build([
        row({ id: 1, name: 'Nike', origin: CATEGORY_ORIGIN.CATALOG }),
      ]);

      await svc.ensure(1, 'Nike', CATEGORY_ORIGIN.MANUAL);

      expect(saved).toHaveLength(0);
    });
  });
});
