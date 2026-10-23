import { RoutingCategoryService } from './routing-category.service';
import { BusinessException } from '../../global/exception/business.exception';

/** In-memory routing_categories; ids are strings like TypeORM's BIGINT PKs. */
function categoryRepo(seed: Array<{ tenantId: number; code: string; name?: string | null; sortOrder?: number }>) {
  let next = 100;
  const rows = seed.map((r) => ({ id: String(next++), name: null, sortOrder: 0, ...r }));
  const match = (r: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && '_value' in (v as object)) {
        return ((v as { _value: unknown[] })._value as unknown[]).map(String).includes(String(r[k]));
      }
      return String(r[k]) === String(v);
    });
  return {
    rows,
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((r) => match(r, where)).sort((a, b) => a.sortOrder - b.sortOrder),
    ),
    findOne: jest.fn(async ({ where, order }: { where: Record<string, unknown>; order?: Record<string, string> }) => {
      const hit = rows.filter((r) => match(r, where));
      if (order?.sortOrder === 'DESC') hit.sort((a, b) => b.sortOrder - a.sortOrder);
      return hit[0] ?? null;
    }),
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn(async (v: unknown) => {
      for (const row of Array.isArray(v) ? v : [v]) {
        if (!row.id) {
          row.id = String(next++);
          rows.push(row);
        }
      }
      return v;
    }),
    delete: jest.fn(async (where: Record<string, unknown>) => {
      const i = rows.findIndex((r) => match(r, where));
      if (i >= 0) rows.splice(i, 1);
    }),
  };
}

function build(opts: {
  categories?: Array<{ tenantId: number; code: string; name?: string | null; sortOrder?: number }>;
  rules?: Array<{ name?: string; regions?: string[] }>;
  units?: Array<{ name: string; regions: string[] | null }>;
  labels?: Array<{ name: string; regions: string[] | null }>;
}) {
  const repo = categoryRepo(opts.categories ?? []);
  const aiConfigRepo = {
    findOne: jest.fn(async () => ({ handoffConfig: { routingRules: opts.rules ?? [] } })),
  };
  const unitRepo = { find: jest.fn(async () => opts.units ?? []) };
  const labelRepo = { find: jest.fn(async () => opts.labels ?? []) };
  const audit = { write: jest.fn(async () => undefined) };
  const svc = new RoutingCategoryService(
    repo as never,
    aiConfigRepo as never,
    unitRepo as never,
    labelRepo as never,
    audit as never,
  );
  return { svc, repo, audit };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as BusinessException).errorCode;
  }
  return 'resolved';
};

describe('RoutingCategoryService (PLN-261024)', () => {
  it('lists the tenant rows only, in order, with where each code is used', async () => {
    const { svc } = build({
      categories: [
        { tenantId: 1, code: 'south', sortOrder: 20 },
        { tenantId: 1, code: 'north', name: 'Hà Nội', sortOrder: 10 },
        { tenantId: 2, code: 'north', sortOrder: 10 },
      ],
      rules: [{ name: 'North · booking', regions: ['North'] }, { regions: ['south_center'] }],
      units: [{ name: 'HN team', regions: ['north'] }],
      labels: [{ name: 'Consult', regions: ['north', 'south'] }],
    });
    const list = await svc.list(1);
    expect(list.map((c) => c.code)).toEqual(['north', 'south']);
    expect(list[0]).toMatchObject({
      name: 'Hà Nội',
      usage: { rules: ['North · booking'], units: ['HN team'], labels: ['Consult'] },
    });
    expect(list[1].usage).toEqual({ rules: [], units: [], labels: ['Consult'] });
  });

  it('create folds the code, appends at the end and audits; duplicates are E5108, bad shapes E5003', async () => {
    const { svc, audit } = build({ categories: [{ tenantId: 1, code: 'north', sortOrder: 10 }] });
    const created = await svc.create(1, 9, 'VIP Hotels', '  VIP  ');
    expect(created).toMatchObject({ code: 'vip_hotels', name: 'VIP', sortOrder: 20 });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'routing_category.created' }));
    expect(await codeOf(svc.create(1, 9, 'Vip-Hotels'))).toBe('E5108');
    expect(await codeOf(svc.create(1, 9, 'Hà Nội'))).toBe('E5003');
    // Another tenant may use the same code.
    expect(await codeOf(svc.create(2, 9, 'north'))).toBe('resolved');
  });

  it('update renames/reorders, clears an empty name, audits only real changes; a foreign id is E5109', async () => {
    const { svc, repo, audit } = build({
      categories: [
        { tenantId: 1, code: 'north', name: 'N', sortOrder: 10 },
        { tenantId: 1, code: 'south', sortOrder: 20 },
        { tenantId: 2, code: 'central', sortOrder: 10 },
      ],
    });
    const [n, s, foreign] = repo.rows.map((r) => r.id);
    const list = await svc.update(1, 9, [
      { id: n, name: '', sortOrder: 30 },
      { id: s, name: 'Miền Nam' },
    ]);
    expect(list.map((c) => [c.code, c.name])).toEqual([
      ['south', 'Miền Nam'],
      ['north', null],
    ]);
    expect(audit.write).toHaveBeenCalledTimes(1);
    await svc.update(1, 9, [{ id: s, name: 'Miền Nam' }]);
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(await codeOf(svc.update(1, 9, [{ id: foreign, name: 'x' }]))).toBe('E5109');
    expect(repo.rows.find((r) => r.id === foreign)?.name).toBeNull();
  });

  it('delete is refused (E5107, with where) while used; otherwise removed and audited', async () => {
    const { svc, repo, audit } = build({
      categories: [
        { tenantId: 1, code: 'north' },
        { tenantId: 1, code: 'central' },
      ],
      rules: [{ name: 'North rule', regions: ['north'] }],
    });
    const [north, central] = repo.rows.map((r) => r.id);
    let err: BusinessException | undefined;
    try {
      await svc.remove(1, 9, north);
    } catch (e) {
      err = e as BusinessException;
    }
    expect(err?.errorCode).toBe('E5107');
    expect(err?.details).toMatchObject({ rules: ['North rule'] });
    expect(repo.rows).toHaveLength(2);
    await expect(svc.remove(1, 9, central)).resolves.toEqual({ deleted: true });
    expect(repo.rows.map((r) => r.code)).toEqual(['north']);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'routing_category.deleted' }));
    expect(await codeOf(svc.remove(2, 9, north))).toBe('E5109');
  });

  it('assertCodes folds spellings and refuses codes outside the tenant list (E5109)', async () => {
    const { svc } = build({
      categories: [
        { tenantId: 1, code: 'north_center' },
        { tenantId: 2, code: 'south' },
      ],
    });
    await expect(svc.assertCodes(1, ['North Center', 'north_central'])).resolves.toEqual(['north_center']);
    await expect(svc.assertCodes(1, [])).resolves.toEqual([]);
    expect(await codeOf(svc.assertCodes(1, ['south']))).toBe('E5109');
  });

  it('visible + per-language names: new rows are offered by default, the widget label follows the session language (PLN-261024)', async () => {
    const { svc, repo } = build({ categories: [{ tenantId: 1, code: 'internal', name: '내부', sortOrder: 10 }] });
    const created = await svc.create(1, 9, 'payment', '결제', { names: { vi: ' Thanh toán ', en: 'Payment', xx: 'drop', ja: '' } });
    expect(created).toMatchObject({ visible: true, names: { en: 'Payment', vi: 'Thanh toán' } });
    const hidden = await svc.create(1, 9, 'refund', '', { visible: false });
    expect(hidden).toMatchObject({ visible: false, names: null });
    // `internal` was seeded hidden (column default 0).
    repo.rows[0].visible = 0;
    expect(await svc.visibleFor(1, 'VI')).toEqual([{ code: 'payment', label: 'Thanh toán' }]);
    expect(await svc.visibleFor(1, 'ko')).toEqual([{ code: 'payment', label: '결제' }]);
    // Turning visibility on/off and clearing names go through update.
    await svc.update(1, 9, [{ id: hidden.id, visible: true }, { id: created.id, names: {} }]);
    expect(await svc.visibleFor(1, 'en')).toEqual([
      { code: 'payment', label: '결제' },
      { code: 'refund', label: 'refund' },
    ]);
    expect(await svc.visibleRow(1, 'Refund')).toMatchObject({ code: 'refund' });
    expect(await svc.visibleRow(1, 'internal')).toBeNull();
    expect(await svc.visibleRow(2, 'refund')).toBeNull();
  });
});
