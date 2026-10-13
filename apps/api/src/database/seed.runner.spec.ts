import * as bcrypt from 'bcryptjs';
import { runSeed } from './seed.runner';

/**
 * PLN-261012 SG-80 / REQ D-18 — the seed runner against an in-memory DataSource:
 * legacy behaviour is untouched by default, a customer identity comes from SEED_*,
 * and a generated password only ever lands on a NEW account.
 */
type Row = Record<string, unknown>;

class FakeRepo {
  rows: Row[] = [];
  private seq = 0;
  private matches(row: Row, where?: Row | Row[]): boolean {
    if (!where) return true;
    const alternatives = Array.isArray(where) ? where : [where];
    return alternatives.some((w) => Object.entries(w).every(([k, v]) => row[k] === v));
  }
  create(obj: Row): Row {
    return { ...obj };
  }
  async save(input: Row | Row[]): Promise<Row | Row[]> {
    const persist = (row: Row): Row => {
      if (row.id === undefined) {
        this.seq += 1;
        row.id = this.seq;
        this.rows.push(row);
      }
      return row;
    };
    return Array.isArray(input) ? input.map(persist) : persist(input);
  }
  async findOne(opts: { where?: Row | Row[] } = {}): Promise<Row | null> {
    return this.rows.find((r) => this.matches(r, opts.where)) ?? null;
  }
  async find(opts: { where?: Row | Row[] } = {}): Promise<Row[]> {
    return this.rows.filter((r) => this.matches(r, opts.where));
  }
  async count(opts: { where?: Row | Row[] } = {}): Promise<number> {
    return (await this.find(opts)).length;
  }
}

function fakeDataSource() {
  const repos = new Map<string, FakeRepo>();
  return {
    repos,
    ds: {
      getRepository: (entity: { name: string }) => {
        if (!repos.has(entity.name)) repos.set(entity.name, new FakeRepo());
        return repos.get(entity.name);
      },
      query: jest.fn(async () => undefined),
    } as never,
  };
}

const SEED_ENV_KEYS = [
  'NODE_ENV', 'SEED_TENANT_SLUG', 'SEED_TENANT_NAME', 'SEED_TENANT_DOMAIN', 'SEED_ADMIN_EMAIL',
  'SEED_MASTER_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_PASSWORD', 'SEED_DEMO_DATA', 'SEED_KB_PROFILE',
];

describe('runSeed identity (PLN-261012 SG-80)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of SEED_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of SEED_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('unconfigured: the legacy ivyusa tenant, amoeba accounts and development password', async () => {
    const { ds, repos } = fakeDataSource();
    const result = await runSeed(ds);
    expect(result).toMatchObject({
      tenantSlug: 'ivyusa',
      adminEmail: 'admin@amoeba.group',
      masterEmail: 'dev@amoeba.group',
      passwordSource: 'dev-default',
      generated: {},
    });
    const tenant = repos.get('Tenant')!.rows[0];
    expect(tenant).toMatchObject({ slug: 'ivyusa', name: 'ivyusa', shopDomain: 'ivyusa.myshopify.com' });
    const admin = repos.get('AdminUser')!.rows[0];
    expect(await bcrypt.compare('amb2026!@', admin.passwordHash as string)).toBe(true);
    // Demo data and the US-cosmetics KB are still on for the default tenant.
    expect(repos.get('KbDocument')!.rows.length).toBeGreaterThan(0);
    expect(repos.get('Customer')!.rows.length).toBe(1);
  }, 30000);

  it('configured: a customer tenant with no Amoeba identity, demo data or sample KB', async () => {
    Object.assign(process.env, {
      SEED_TENANT_SLUG: 'go2joy',
      SEED_TENANT_NAME: 'Go2Joy',
      SEED_TENANT_DOMAIN: 'app.go2joy.vn',
      SEED_ADMIN_EMAIL: 'ops@go2joy.vn',
      SEED_MASTER_EMAIL: 'cs-lead@go2joy.vn',
      SEED_PASSWORD: 'Str0ng-Seed-Pass!',
    });
    const { ds, repos } = fakeDataSource();
    const result = await runSeed(ds);
    expect(result).toMatchObject({ tenantSlug: 'go2joy', adminEmail: 'ops@go2joy.vn', passwordSource: 'env' });
    expect(repos.get('Tenant')!.rows[0]).toMatchObject({ slug: 'go2joy', name: 'Go2Joy', shopDomain: 'app.go2joy.vn' });
    expect(repos.get('User')!.rows[0]).toMatchObject({ email: 'cs-lead@go2joy.vn', rank: 'master' });
    // SEED_DEMO_DATA / SEED_KB_PROFILE were left blank: a custom tenant gets neither.
    expect(repos.get('KbDocument')?.rows.length ?? 0).toBe(0);
    expect(repos.get('Customer')?.rows.length ?? 0).toBe(0);
    // Nothing of Amoeba's reaches any persisted tenant/account row.
    const everything = JSON.stringify([
      ...repos.get('Tenant')!.rows,
      ...repos.get('AdminUser')!.rows.map((r) => ({ ...r, passwordHash: undefined })),
      ...repos.get('User')!.rows.map((r) => ({ ...r, passwordHash: undefined })),
    ]);
    expect(everything).not.toMatch(/amoeba|ivyusa/i);
  }, 30000);

  it('an explicit SEED_KB_PROFILE / SEED_DEMO_DATA still wins on a custom tenant', async () => {
    Object.assign(process.env, {
      SEED_TENANT_SLUG: 'go2joy',
      SEED_TENANT_DOMAIN: 'app.go2joy.vn',
      SEED_PASSWORD: 'Str0ng-Seed-Pass!',
      SEED_KB_PROFILE: 'us-cosmetics',
      SEED_DEMO_DATA: 'true',
    });
    const { ds, repos } = fakeDataSource();
    await runSeed(ds);
    expect(repos.get('KbDocument')!.rows.length).toBeGreaterThan(0);
    expect(repos.get('Customer')!.rows.length).toBe(1);
  }, 30000);

  it('production with no password: generates one per account, once — and never overwrites an existing account', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      SEED_TENANT_SLUG: 'go2joy',
      SEED_TENANT_DOMAIN: 'app.go2joy.vn',
      SEED_ADMIN_EMAIL: 'ops@go2joy.vn',
      SEED_MASTER_EMAIL: 'cs-lead@go2joy.vn',
    });
    const { ds, repos } = fakeDataSource();

    const first = await runSeed(ds);
    expect(first.passwordSource).toBe('generated');
    expect(first.generated.admin).toBeTruthy();
    expect(first.generated.master).toBeTruthy();
    expect(first.generated.admin).not.toBe(first.generated.master);
    expect(first.generated.admin).not.toBe('amb2026!@');
    const admin = repos.get('AdminUser')!.rows[0];
    expect(await bcrypt.compare(first.generated.admin!, admin.passwordHash as string)).toBe(true);
    expect(admin.mustChangePassword).toBe(1);

    // The operator changes the admin password, then a restart re-runs the seed.
    const changed = await bcrypt.hash('Operator-Chosen-1!', 4);
    admin.passwordHash = changed;
    const second = await runSeed(ds);
    expect(second.generated).toEqual({});
    expect(repos.get('AdminUser')!.rows[0].passwordHash).toBe(changed);
    expect(repos.get('AdminUser')!.rows).toHaveLength(1);
    expect(repos.get('Tenant')!.rows).toHaveLength(1);
  }, 30000);

  it('an explicit password is re-asserted on every run (the established behaviour is unchanged)', async () => {
    process.env.SEED_PASSWORD = 'Str0ng-Seed-Pass!';
    const { ds, repos } = fakeDataSource();
    await runSeed(ds);
    const admin = repos.get('AdminUser')!.rows[0];
    admin.passwordHash = await bcrypt.hash('somebody-changed-it', 4);
    await runSeed(ds);
    expect(await bcrypt.compare('Str0ng-Seed-Pass!', repos.get('AdminUser')!.rows[0].passwordHash as string)).toBe(true);
  }, 30000);

  it('a custom tenant without SEED_TENANT_DOMAIN fails before writing anything', async () => {
    process.env.SEED_TENANT_SLUG = 'go2joy';
    const { ds, repos } = fakeDataSource();
    await expect(runSeed(ds)).rejects.toThrow(/SEED_TENANT_DOMAIN is required/);
    expect(repos.size).toBe(0);
  });
});
