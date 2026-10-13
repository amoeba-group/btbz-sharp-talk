import { KbCategoryService } from './kb-category.service';
import { CATEGORY_ORIGIN, KbCategory } from './entity/kb-category.entity';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Who may read a category (PLN-261012 SG-10, wireframe W1).
 *
 * `setAccess()` writes BOTH columns — `guest_visible` (the single public flag the guest gate
 * reads) and `min_audience` (the tier retrieval and answer reuse read) — so they cannot
 * disagree; the older /guest-visible endpoint keeps working and clears `manager` when it
 * opens a category to guests; every tier change is audited; and narrowing to manager-only
 * retires the stored replays that may quote the category.
 */
describe('KbCategoryService — access tiers', () => {
  const row = (over: Partial<KbCategory> = {}): KbCategory =>
    ({
      id: 1,
      tenantId: 1,
      name: 'settlement',
      label: null,
      docGroup: 'counsel',
      origin: CATEGORY_ORIGIN.MANUAL,
      sortOrder: 10,
      hidden: 0,
      guestVisible: 0,
      minAudience: null,
      agentIds: null,
      ...over,
    }) as KbCategory;

  function build(rows: KbCategory[], opts: { audit?: boolean; reuse?: boolean; reuseFails?: boolean } = {}) {
    const repo = {
      find: jest.fn(async () => rows),
      findOne: jest.fn(async ({ where }: { where: { id?: number } }) => rows.find((r) => String(r.id) === String(where.id)) ?? null),
      save: jest.fn(async (d: KbCategory) => ({ ...d })),
    };
    const manager = { update: jest.fn(async () => ({ affected: 2 })), delete: jest.fn() };
    const dataSource = { transaction: async (fn: (m: unknown) => unknown) => fn(manager) };
    const audit = { write: jest.fn(async () => ({})) };
    const reuse = {
      deactivateAll: jest.fn(async () => {
        if (opts.reuseFails) throw new Error('reuse store down');
        return 5;
      }),
    };
    const svc = new KbCategoryService(
      repo as never,
      { count: jest.fn(async () => 0) } as never,
      {} as never,
      dataSource as never,
      opts.audit === false ? undefined : (audit as never),
      opts.reuse === false ? undefined : (reuse as never),
    );
    return { svc, repo, audit, reuse, manager };
  }

  describe('setAccess writes both columns', () => {
    it.each([
      ['public', { guestVisible: 1, minAudience: 'public' }],
      ['partner', { guestVisible: 0, minAudience: 'partner' }],
      ['manager', { guestVisible: 0, minAudience: 'manager' }],
    ])('%s', async (tier, expected) => {
      const { svc, repo } = build([row({ guestVisible: tier === 'public' ? 0 : 1 } as never)]);

      const saved = await svc.setAccess(1, 1, tier, { userId: 42 });

      expect(saved).toMatchObject(expected);
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining(expected));
    });

    it('moves manager -> public in one save: guest_visible=1 AND min_audience=public', async () => {
      const { svc } = build([row({ guestVisible: 0, minAudience: 'manager' })]);

      expect(await svc.setAccess(1, 1, 'public', { userId: 42 })).toMatchObject({ guestVisible: 1, minAudience: 'public' });
    });

    it.each([undefined, null, '', 'Manager', 'admin', 2, true])('refuses %j with E5135 and saves nothing', async (bad) => {
      const { svc, repo, audit } = build([row()]);

      await expect(svc.setAccess(1, 1, bad, { userId: 42 })).rejects.toMatchObject({ errorCode: ERROR_CODE.KB_ACCESS_INVALID.code });
      expect(repo.save).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('refuses a catalogue category: product knowledge has no tier story', async () => {
      const { svc, repo } = build([row({ origin: CATEGORY_ORIGIN.CATALOG })]);

      await expect(svc.setAccess(1, 1, 'manager', { userId: 42 })).rejects.toThrow();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('looks the category up inside the caller’s tenant (the real repository then finds nothing for another tenant’s id)', async () => {
      const { svc, repo } = build([row()]);

      await svc.setAccess(7, 1, 'partner');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 1, tenantId: 7 } });
    });
  });

  describe('audit: kb.category_access_changed', () => {
    it('writes ONE row naming the console user, the category and both tiers', async () => {
      const { svc, audit } = build([row()]);

      await svc.setAccess(1, 1, 'manager', { userId: 42 });

      expect(audit.write).toHaveBeenCalledTimes(1);
      expect(audit.write).toHaveBeenCalledWith({
        tenantId: 1,
        actorType: 'user',
        actorId: 42,
        action: 'kb.category_access_changed',
        target: 'kb_category:1',
        metadata: { category: 'settlement', from: 'partner', to: 'manager' },
      });
    });

    it('reads a legacy row (NULL min_audience) by its guest_visible flag', async () => {
      const { svc, audit } = build([row({ guestVisible: 1, minAudience: null })]);

      await svc.setAccess(1, 1, 'manager', { userId: 42 });

      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ metadata: { category: 'settlement', from: 'public', to: 'manager' } }));
    });

    it('a repeated PUT that changes nothing is not audited (but a legacy NULL still gets the explicit value)', async () => {
      const { svc, audit, repo } = build([row({ guestVisible: 0, minAudience: null })]);

      await svc.setAccess(1, 1, 'partner', { userId: 42 });

      expect(audit.write).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ minAudience: 'partner' }));
    });

    it('without a console user the actor is the system', async () => {
      const { svc, audit } = build([row()]);

      await svc.setAccess(1, 1, 'manager');

      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'system', actorId: 0 }));
    });

    it('a failing audit write does not undo or fail the change; and it works without an audit service', async () => {
      const failing = build([row()]);
      failing.audit.write.mockRejectedValueOnce(new Error('audit down'));
      await expect(failing.svc.setAccess(1, 1, 'manager', { userId: 42 })).resolves.toMatchObject({ minAudience: 'manager' });

      await expect(build([row()], { audit: false }).svc.setAccess(1, 1, 'manager', { userId: 42 })).resolves.toMatchObject({ minAudience: 'manager' });
    });
  });

  describe('stored replays', () => {
    it('narrowing TO manager-only retires every stored answer of the tenant', async () => {
      const { svc, reuse } = build([row()]);

      await svc.setAccess(1, 1, 'manager', { userId: 42 });

      expect(reuse.deactivateAll).toHaveBeenCalledWith(1);
    });

    it.each(['public', 'partner'])('moving to %s does not (nothing was narrowed)', async (tier) => {
      const { svc, reuse } = build([row({ guestVisible: 0, minAudience: 'manager' })]);

      await svc.setAccess(1, 1, tier, { userId: 42 });

      expect(reuse.deactivateAll).not.toHaveBeenCalled();
    });

    it('a repeated manager-only PUT does not retire anything again', async () => {
      const { svc, reuse } = build([row({ minAudience: 'manager' })]);

      await svc.setAccess(1, 1, 'manager', { userId: 42 });

      expect(reuse.deactivateAll).not.toHaveBeenCalled();
    });

    it('a reuse-store outage does not fail the change (it is saved; replays age out by TTL)', async () => {
      const { svc } = build([row()], { reuseFails: true });

      await expect(svc.setAccess(1, 1, 'manager', { userId: 42 })).resolves.toMatchObject({ minAudience: 'manager' });
    });

    it('works without a reuse store (older positional doubles)', async () => {
      await expect(build([row()], { reuse: false }).svc.setAccess(1, 1, 'manager', { userId: 42 })).resolves.toBeDefined();
    });
  });

  describe('the older /guest-visible endpoint stays compatible', () => {
    it('opening a manager-only category to guests clears manager (both columns coherent) and says so in the audit row', async () => {
      const { svc, audit } = build([row({ guestVisible: 0, minAudience: 'manager' })]);

      const saved = await svc.setGuestVisible(1, 1, true, { userId: 42 });

      expect(saved).toMatchObject({ guestVisible: 1, minAudience: 'public' });
      // ONE row — the existing guest_visible action, extended with the tier it also moved.
      expect(audit.write).toHaveBeenCalledTimes(1);
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'kb.category_guest_visible_changed',
          metadata: { category: 'settlement', from: false, to: true, accessFrom: 'manager', accessTo: 'public' },
        }),
      );
    });

    it('closing an explicit public category demotes it to partner; manager and partner stay as they are', async () => {
      expect((await build([row({ guestVisible: 1, minAudience: 'public' })]).svc.setGuestVisible(1, 1, false)).minAudience).toBe('partner');
      expect((await build([row({ guestVisible: 0, minAudience: 'manager' })]).svc.setGuestVisible(1, 1, false)).minAudience).toBe('manager');
      expect((await build([row({ guestVisible: 0, minAudience: 'partner' })]).svc.setGuestVisible(1, 1, false)).minAudience).toBe('partner');
    });

    it('a legacy row (NULL min_audience) is left NULL: the flag alone decides, no backfill', async () => {
      const opened = await build([row({ guestVisible: 0, minAudience: null })]).svc.setGuestVisible(1, 1, true);
      expect(opened).toMatchObject({ guestVisible: 1, minAudience: null });
    });

    it('an ordinary flip keeps its audit row byte-identical to before (no tier keys)', async () => {
      const { svc, audit } = build([row({ guestVisible: 0, minAudience: null })]);

      await svc.setGuestVisible(1, 1, true, { userId: 42 });

      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ metadata: { category: 'settlement', from: false, to: true } }));
    });
  });

  describe('list reports the tier the console shows', () => {
    it('access = manager wins; legacy rows read by guest_visible; unregistered strings are partner', async () => {
      const rows = [
        row({ id: 1, name: 'a', minAudience: 'manager' }),
        row({ id: 2, name: 'b', guestVisible: 1, minAudience: null }),
        row({ id: 3, name: 'c', guestVisible: 0, minAudience: null }),
        row({ id: 4, name: 'd', guestVisible: 1, minAudience: 'manager' }),
      ];
      const { svc } = build(rows);
      (svc as unknown as { countsFor: unknown }).countsFor = async () => new Map([['orphan', 3]]);

      const list = await svc.list(1, 'counsel');

      expect(list.map((c) => [c.name, c.access])).toEqual([
        ['a', 'manager'],
        ['b', 'public'],
        ['c', 'partner'],
        ['d', 'manager'],
        ['orphan', 'partner'],
      ]);
    });
  });

  describe('merge never silently widens a manager-only category', () => {
    it('refuses to move manager-only documents into a category more people can read (E5136)', async () => {
      const { svc, manager } = build([
        row({ id: 1, name: 'faq', minAudience: 'partner' }),
        row({ id: 2, name: 'settlement', minAudience: 'manager' }),
      ]);

      await expect(svc.merge(1, [2], 1)).rejects.toMatchObject({ errorCode: ERROR_CODE.KB_CATEGORY_MERGE_WIDENS.code });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('allows it when the destination is manager-only too', async () => {
      const { svc } = build([
        row({ id: 1, name: 'payout', minAudience: 'manager' }),
        row({ id: 2, name: 'settlement', minAudience: 'manager' }),
      ]);

      await expect(svc.merge(1, [2], 1)).resolves.toEqual({ moved: 2 });
    });

    it('a tenant with no manager-only category merges exactly as before, whatever the other tiers', async () => {
      const { svc } = build([
        row({ id: 1, name: 'faq', guestVisible: 1, minAudience: null }),
        row({ id: 2, name: 'old', guestVisible: 0, minAudience: null }),
      ]);

      await expect(svc.merge(1, [2], 1)).resolves.toEqual({ moved: 2 });
    });
  });

  describe('a category created by an import stays fail-closed', () => {
    it('ensure() never writes the tier or the public flag', async () => {
      const created: Array<Record<string, unknown>> = [];
      const repo = {
        findOne: jest.fn(async () => null),
        create: (d: Record<string, unknown>) => ({ ...d }),
        save: jest.fn(async (d: Record<string, unknown>) => {
          created.push(d);
          return d;
        }),
      };
      const svc = new KbCategoryService(repo as never, {} as never, {} as never, {} as never);

      await svc.ensure(1, 'Settlement', CATEGORY_ORIGIN.MANUAL, 'counsel');

      expect(created).toHaveLength(1);
      expect(created[0]).not.toHaveProperty('minAudience');
      expect(created[0]).not.toHaveProperty('guestVisible');
    });

    it('ensure() on an existing manager-only row leaves its tier alone', async () => {
      const existing = row({ minAudience: 'manager' });
      const repo = { findOne: jest.fn(async () => existing), save: jest.fn() };
      const svc = new KbCategoryService(repo as never, {} as never, {} as never, {} as never);

      await svc.ensure(1, 'settlement', CATEGORY_ORIGIN.MANUAL, 'counsel');

      expect(repo.save).not.toHaveBeenCalled();
      expect(existing.minAudience).toBe('manager');
    });
  });
});
