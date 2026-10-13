import {
  MANAGER_ONLY_EXCLUSION_SQL,
  audienceNeedsManagerExclusion,
  tenantHasManagerTier,
} from './kb-access.util';

describe('audienceNeedsManagerExclusion', () => {
  it('is true for every caller below manager, false for a manager and for "no audience" (the operator view)', () => {
    expect(audienceNeedsManagerExclusion('public')).toBe(true);
    expect(audienceNeedsManagerExclusion('partner')).toBe(true);
    expect(audienceNeedsManagerExclusion('manager')).toBe(false);
    expect(audienceNeedsManagerExclusion(undefined)).toBe(false);
    expect(audienceNeedsManagerExclusion(null)).toBe(false);
  });
});

describe('MANAGER_ONLY_EXCLUSION_SQL', () => {
  it('excludes by (tenant, group, name) against the manager tier, with uncategorised documents untouched', () => {
    expect(MANAGER_ONLY_EXCLUSION_SQL).toContain('kb.category IS NULL OR NOT EXISTS');
    expect(MANAGER_ONLY_EXCLUSION_SQL).toContain('a.tenant_id = :audienceTenantId');
    expect(MANAGER_ONLY_EXCLUSION_SQL).toContain('a.doc_group = kb.doc_group');
    expect(MANAGER_ONLY_EXCLUSION_SQL).toContain('a.name = kb.category');
    expect(MANAGER_ONLY_EXCLUSION_SQL).toContain("a.min_audience = 'manager'");
  });

  it('is not an allow-list and does not care about origin or guest_visible', () => {
    expect(MANAGER_ONLY_EXCLUSION_SQL).not.toMatch(/\bIN\s*\(/);
    expect(MANAGER_ONLY_EXCLUSION_SQL).not.toContain('origin');
    expect(MANAGER_ONLY_EXCLUSION_SQL).not.toContain('guest_visible');
  });
});

describe('tenantHasManagerTier', () => {
  it('counts manager-only categories of THIS tenant', async () => {
    const count = jest.fn(async () => 2);

    expect(await tenantHasManagerTier({ count }, 7)).toBe(true);
    expect(count).toHaveBeenCalledWith({ where: { tenantId: 7, minAudience: 'manager' } });
    expect(await tenantHasManagerTier({ count: async () => 0 }, 7)).toBe(false);
  });
});
