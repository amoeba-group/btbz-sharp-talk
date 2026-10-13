import { generateCode } from '@sharptalk/common';
import { RESERVED_TENANT_SLUGS, TENANT_SLUG_PATTERN } from '../global/constant/reserved-slug.constant';
import { validatePassword } from '../global/util/password-policy.util';

/**
 * Who the bootstrap seed creates (PLN-261012 SG-80, REQ D-18).
 *
 * The seed used to hard-code Amoeba's own staging identity — tenant `ivyusa`, the
 * `admin@` / `dev@amoeba.group` accounts and the password `amb2026!@` — which is
 * right for a developer machine and wrong for a customer's own infrastructure:
 * a single-tenant install for Go2Joy would boot with Amoeba's tenant, Amoeba's
 * mailboxes as administrators, and a password every repository reader knows.
 *
 * Everything here defaults to the legacy values, so a developer who sets nothing
 * (and any existing staging environment) sees byte-identical behaviour. A customer
 * deployment sets the SEED_* variables, or — with NODE_ENV=production and no
 * password configured — gets a generated one-time password instead of the known
 * default.
 */
export const SEED_DEFAULTS = {
  tenantSlug: 'ivyusa',
  tenantName: 'ivyusa',
  tenantDomain: 'ivyusa.myshopify.com',
  adminEmail: 'admin@amoeba.group',
  masterEmail: 'dev@amoeba.group',
  /** Development convenience only; never used when NODE_ENV=production without an explicit value. */
  devPassword: 'amb2026!@',
} as const;

/**
 * Where the bootstrap password came from. Only `generated` changes semantics:
 * the other three are re-asserted on every seed run (the established behaviour),
 * but a RANDOM password must never overwrite an existing account's — that would
 * lock the operator out of an install they had already changed.
 */
export type SeedPasswordSource = 'option' | 'env' | 'dev-default' | 'generated';

export interface SeedIdentity {
  tenantSlug: string;
  tenantName: string;
  tenantDomain: string;
  adminEmail: string;
  masterEmail: string;
  adminPassword: string;
  masterPassword: string;
  passwordSource: SeedPasswordSource;
  /**
   * True when the tenant (slug, name or domain) moved off the legacy default —
   * i.e. this is somebody's own tenant, not Amoeba's sample one.
   */
  customTenant: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One policy-compliant random password; the loop only re-rolls an astronomically unlikely miss. */
export function generateSeedPassword(): string {
  for (let i = 0; i < 100; i += 1) {
    const candidate = `Sd${generateCode(14)}!`;
    if (validatePassword(candidate).ok) return candidate;
  }
  /* istanbul ignore next -- unreachable in practice */
  throw new Error('seed password generation failed');
}

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

/** `https://App.Go2Joy.vn/path` → `app.go2joy.vn` — the widget keys tenants by bare host. */
function normaliseDomain(raw: string): string {
  return raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
}

export function resolveSeedIdentity(
  env: NodeJS.ProcessEnv,
  opts: { password?: string } = {},
  random: () => string = generateSeedPassword,
): SeedIdentity {
  const slugRaw = clean(env.SEED_TENANT_SLUG).toLowerCase();
  const slug = slugRaw || SEED_DEFAULTS.tenantSlug;
  if (!TENANT_SLUG_PATTERN.test(slug)) {
    throw new Error(`SEED_TENANT_SLUG "${slug}" is not a valid tenant slug (lowercase letters, digits, single dashes).`);
  }
  if (RESERVED_TENANT_SLUGS.includes(slug)) {
    throw new Error(`SEED_TENANT_SLUG "${slug}" is reserved (it would shadow a console route).`);
  }
  const customSlug = slug !== SEED_DEFAULTS.tenantSlug;

  const domainRaw = normaliseDomain(clean(env.SEED_TENANT_DOMAIN));
  // A custom tenant has no Shopify store to borrow a domain from. The widget
  // identifies the tenant by this value, so inventing one would produce an install
  // that boots and then cannot match any storefront — fail loudly instead.
  if (customSlug && !domainRaw) {
    throw new Error(
      `SEED_TENANT_DOMAIN is required when SEED_TENANT_SLUG is set: the widget identifies the tenant by this host ` +
        `(for a non-storefront tenant use the app host, e.g. app.example.com).`,
    );
  }
  const tenantDomain = domainRaw || SEED_DEFAULTS.tenantDomain;

  // A production install of somebody else's tenant must not hand administrator
  // rights to Amoeba's mailboxes by omission. (Development keeps the defaults.)
  if (customSlug && env.NODE_ENV === 'production' && (!clean(env.SEED_ADMIN_EMAIL) || !clean(env.SEED_MASTER_EMAIL))) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_MASTER_EMAIL are required when SEED_TENANT_SLUG is set in production: ' +
        "the defaults are Amoeba's own mailboxes.",
    );
  }

  const adminEmail = clean(env.SEED_ADMIN_EMAIL).toLowerCase() || SEED_DEFAULTS.adminEmail;
  const masterEmail = clean(env.SEED_MASTER_EMAIL).toLowerCase() || SEED_DEFAULTS.masterEmail;
  for (const [key, value] of [['SEED_ADMIN_EMAIL', adminEmail], ['SEED_MASTER_EMAIL', masterEmail]] as const) {
    if (!EMAIL.test(value)) throw new Error(`${key} "${value}" is not an email address.`);
  }

  const tenantName = clean(env.SEED_TENANT_NAME) || (customSlug ? slug : SEED_DEFAULTS.tenantName);

  let adminPassword: string;
  let masterPassword: string;
  let passwordSource: SeedPasswordSource;
  const explicit = opts.password ?? (clean(env.SEED_ADMIN_PASSWORD) || clean(env.SEED_PASSWORD));
  if (explicit) {
    adminPassword = masterPassword = explicit;
    passwordSource = opts.password !== undefined ? 'option' : 'env';
  } else if (env.NODE_ENV === 'production') {
    // Two accounts, two secrets: handing both the same one-time password would
    // make the platform administrator's credential known to the tenant master.
    adminPassword = random();
    masterPassword = random();
    passwordSource = 'generated';
  } else {
    adminPassword = masterPassword = SEED_DEFAULTS.devPassword;
    passwordSource = 'dev-default';
  }

  return {
    tenantSlug: slug,
    tenantName,
    tenantDomain,
    adminEmail,
    masterEmail,
    adminPassword,
    masterPassword,
    passwordSource,
    customTenant:
      customSlug || tenantName !== SEED_DEFAULTS.tenantName || tenantDomain !== SEED_DEFAULTS.tenantDomain,
  };
}
