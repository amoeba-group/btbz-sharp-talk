import { AiSettingService } from './ai-setting.service';

/** PLN-261007 D1/S5 — which engine a tenant may point its functions at. */
describe('AiSettingService — engine selection', () => {
  const ENGINES: Record<string, Record<string, unknown>> = {
    own: { id: 5, tenantId: 4, provider: 'anthropic', status: 'enabled', tenantSelectable: 0 },
    otherTenant: { id: 6, tenantId: 9, provider: 'anthropic', status: 'enabled', tenantSelectable: 0 },
    platformOpen: { id: 2, tenantId: null, provider: 'anthropic', status: 'enabled', tenantSelectable: 1 },
    platformClosed: { id: 3, tenantId: null, provider: 'openai', status: 'enabled', tenantSelectable: 0 },
    stub: { id: 1, tenantId: null, provider: 'stub', status: 'enabled', tenantSelectable: 1 },
    disabled: { id: 7, tenantId: 4, provider: 'anthropic', status: 'disabled', tenantSelectable: 0 },
  };
  const build = () => {
    const saved: Array<Record<string, unknown>> = [];
    const repo = {
      findOne: jest.fn(async () => null),
      create: (d: Record<string, unknown>) => d,
      save: jest.fn(async (d: Record<string, unknown>) => {
        saved.push(d);
        return d;
      }),
    };
    const settingRepo = {
      ...repo,
      manager: { transaction: async (fn: (m: unknown) => Promise<void>) => fn({ getRepository: () => repo }) },
    };
    const engineRepo = {
      findOne: jest.fn(async ({ where }: { where: { id: number } }) =>
        Object.values(ENGINES).find((e) => e.id === where.id) ?? null,
      ),
    };
    return { svc: new AiSettingService(settingRepo as never, engineRepo as never, {} as never), saved };
  };

  it('applies its own engine to all six functions', async () => {
    const { svc, saved } = build();
    await svc.applyToAll(4, 5);
    expect(saved.map((s) => s.func)).toEqual(['chat', 'rag', 'summary', 'assist', 'moderation', 'coach']);
    expect(new Set(saved.map((s) => s.engineId))).toEqual(new Set([5]));
  });

  it('accepts a platform engine the operator opened', async () => {
    const { svc, saved } = build();
    await svc.applyToAll(4, 2);
    expect(saved).toHaveLength(6);
  });

  it.each([
    ['another tenant’s engine', 6, 404],
    ['a closed platform engine (billing, D1)', 3, 400],
    ['the stub', 1, 400],
    ['a disabled engine', 7, 400],
    ['an unknown id', 999, 404],
  ])('refuses %s', async (_label, id, status) => {
    const { svc, saved } = build();
    await expect(svc.applyToAll(4, id)).rejects.toMatchObject({ status });
    expect(saved).toHaveLength(0);
  });

  it('per-function assignment follows the same rule', async () => {
    const { svc } = build();
    await expect(svc.upsert(4, 'rag', { engine_id: 3 })).rejects.toMatchObject({ status: 400 });
  });
});
