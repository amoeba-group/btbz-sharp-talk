import { generateSeedPassword, resolveSeedIdentity, SEED_DEFAULTS } from './seed-identity';
import { validatePassword } from '../global/util/password-policy.util';

/**
 * PLN-261012 SG-80 / REQ D-18 — the bootstrap seed is configurable, and a customer
 * deployment never boots with Amoeba's tenant, mailboxes or well-known password.
 */
describe('resolveSeedIdentity', () => {
  const fixed = (() => {
    let n = 0;
    return () => `Sd-fixed-${(n += 1)}!`;
  })();

  it('changes nothing for a developer who configures nothing (legacy values, legacy password)', () => {
    const id = resolveSeedIdentity({}, {}, fixed);
    expect(id).toMatchObject({
      tenantSlug: 'ivyusa',
      tenantName: 'ivyusa',
      tenantDomain: 'ivyusa.myshopify.com',
      adminEmail: 'admin@amoeba.group',
      masterEmail: 'dev@amoeba.group',
      adminPassword: SEED_DEFAULTS.devPassword,
      masterPassword: SEED_DEFAULTS.devPassword,
      passwordSource: 'dev-default',
      customTenant: false,
    });
  });

  it('keeps honouring SEED_PASSWORD (staging behaviour), including in production', () => {
    const id = resolveSeedIdentity({ NODE_ENV: 'production', SEED_PASSWORD: 'Str0ng-Pass-Value!' }, {}, fixed);
    expect(id.passwordSource).toBe('env');
    expect(id.adminPassword).toBe('Str0ng-Pass-Value!');
    expect(id.masterPassword).toBe('Str0ng-Pass-Value!');
  });

  it('SEED_ADMIN_PASSWORD beats SEED_PASSWORD, and an explicit option beats both', () => {
    const env = { SEED_PASSWORD: 'one', SEED_ADMIN_PASSWORD: 'two' };
    expect(resolveSeedIdentity(env, {}, fixed).adminPassword).toBe('two');
    expect(resolveSeedIdentity(env, { password: 'three' }, fixed)).toMatchObject({
      adminPassword: 'three',
      passwordSource: 'option',
    });
  });

  it('GENERATES a distinct password per account in production when none is configured — never the known default', () => {
    const id = resolveSeedIdentity({ NODE_ENV: 'production' }, {}, fixed);
    expect(id.passwordSource).toBe('generated');
    expect(id.adminPassword).not.toBe(SEED_DEFAULTS.devPassword);
    expect(id.masterPassword).not.toBe(SEED_DEFAULTS.devPassword);
    expect(id.adminPassword).not.toBe(id.masterPassword);
  });

  it('treats blank password variables as unset', () => {
    const id = resolveSeedIdentity({ NODE_ENV: 'production', SEED_PASSWORD: '  ', SEED_ADMIN_PASSWORD: '' }, {}, fixed);
    expect(id.passwordSource).toBe('generated');
  });

  it('reads a customer tenant and accounts from SEED_*', () => {
    const id = resolveSeedIdentity(
      {
        SEED_TENANT_SLUG: 'Go2Joy',
        SEED_TENANT_NAME: 'Go2Joy',
        SEED_TENANT_DOMAIN: 'https://App.Go2Joy.vn/hotel-admin?x=1',
        SEED_ADMIN_EMAIL: 'Ops@Go2Joy.vn',
        SEED_MASTER_EMAIL: 'cs-lead@go2joy.vn',
        SEED_PASSWORD: 'Str0ng-Pass-Value!',
      },
      {},
      fixed,
    );
    expect(id).toMatchObject({
      tenantSlug: 'go2joy',
      tenantName: 'Go2Joy',
      tenantDomain: 'app.go2joy.vn',
      adminEmail: 'ops@go2joy.vn',
      masterEmail: 'cs-lead@go2joy.vn',
      customTenant: true,
    });
    // Nothing of Amoeba's is left on a customer's seed.
    expect(JSON.stringify(id)).not.toMatch(/amoeba|ivyusa/i);
  });

  it('defaults the tenant name to the slug for a custom tenant', () => {
    expect(
      resolveSeedIdentity({ SEED_TENANT_SLUG: 'go2joy', SEED_TENANT_DOMAIN: 'app.go2joy.vn' }, {}, fixed).tenantName,
    ).toBe('go2joy');
  });

  it('refuses a custom tenant with no domain instead of inventing one', () => {
    expect(() => resolveSeedIdentity({ SEED_TENANT_SLUG: 'go2joy' }, {}, fixed)).toThrow(/SEED_TENANT_DOMAIN is required/);
  });

  it('in production, a custom tenant must name its own administrators (no Amoeba mailbox by omission)', () => {
    const base = { NODE_ENV: 'production', SEED_TENANT_SLUG: 'go2joy', SEED_TENANT_DOMAIN: 'app.go2joy.vn' };
    expect(() => resolveSeedIdentity(base, {}, fixed)).toThrow(/SEED_ADMIN_EMAIL and SEED_MASTER_EMAIL are required/);
    expect(() => resolveSeedIdentity({ ...base, SEED_ADMIN_EMAIL: 'a@go2joy.vn' }, {}, fixed)).toThrow(/required/);
    expect(
      resolveSeedIdentity({ ...base, SEED_ADMIN_EMAIL: 'a@go2joy.vn', SEED_MASTER_EMAIL: 'b@go2joy.vn' }, {}, fixed)
        .adminEmail,
    ).toBe('a@go2joy.vn');
    // Development is unchanged: the defaults are fine on a laptop.
    expect(resolveSeedIdentity({ SEED_TENANT_SLUG: 'go2joy', SEED_TENANT_DOMAIN: 'app.go2joy.vn' }, {}, fixed).adminEmail).toBe(
      'admin@amoeba.group',
    );
  });

  it('rejects invalid or reserved slugs and malformed emails', () => {
    const dom = { SEED_TENANT_DOMAIN: 'app.example.com' };
    expect(() => resolveSeedIdentity({ ...dom, SEED_TENANT_SLUG: 'Bad Slug!' }, {}, fixed)).toThrow(/valid tenant slug/);
    expect(() => resolveSeedIdentity({ ...dom, SEED_TENANT_SLUG: 'widget' }, {}, fixed)).toThrow(/reserved/);
    expect(() => resolveSeedIdentity({ SEED_ADMIN_EMAIL: 'nope' }, {}, fixed)).toThrow(/SEED_ADMIN_EMAIL/);
  });

  it('flags a tenant as custom for any of slug / name / domain', () => {
    expect(resolveSeedIdentity({ SEED_TENANT_NAME: 'Other' }, {}, fixed).customTenant).toBe(true);
    expect(resolveSeedIdentity({ SEED_TENANT_DOMAIN: 'shop.example.com' }, {}, fixed).customTenant).toBe(true);
    expect(resolveSeedIdentity({ SEED_ADMIN_EMAIL: 'a@b.co' }, {}, fixed).customTenant).toBe(false);
  });
});

describe('generateSeedPassword', () => {
  it('always satisfies the password policy and differs between calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const pw = generateSeedPassword();
      expect(validatePassword(pw).ok).toBe(true);
      expect(pw.length).toBeGreaterThanOrEqual(16);
      seen.add(pw);
    }
    expect(seen.size).toBe(50);
  });
});
