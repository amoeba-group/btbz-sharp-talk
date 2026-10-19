import { TenantService } from './tenant.service';
import { TenantMapper } from './tenant.mapper';
import { Tenant } from './entity/tenant.entity';
import { IntegrationCredential } from './entity/integration-credential.entity';

/**
 * PLN-261019 D1/D2 — Shopify connection state is per tenant. Before this, the
 * tile read the provider-keyed `integration_status` row, so a tenant with no
 * Shopify credential at all (go2joy) showed ivyusa's "connected · synced" state.
 */
describe('TenantService — Shopify status is per-tenant (PLN-261019)', () => {
  function build(cred: Partial<IntegrationCredential> | null) {
    const saved: IntegrationCredential[] = [];
    const tenant = { id: 4, shopDomain: 'https://www.go2joy.vn', name: 'go2joy', status: 'active' } as Tenant;
    const tenantRepo = { findOne: jest.fn(async () => tenant) };
    const credRepo = {
      findOne: jest.fn(async () => cred),
      save: jest.fn(async (r: IntegrationCredential) => {
        saved.push(r);
        return r;
      }),
    };
    const integrationService = {
      findByName: jest.fn(async () => ({ status: 'connected', detail: 'other tenant' })),
      upsert: jest.fn(),
    };
    const svc = new TenantService(
      tenantRepo as never,
      credRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      integrationService as never,
      {} as never,
      {} as never,
    );
    return { svc, tenant, credRepo, integrationService, saved };
  }

  it('getShopifyView never reads the global integration_status row', async () => {
    const { svc, integrationService } = build(null);
    const view = await svc.getShopifyView(4);
    expect(view.cred).toBeNull();
    expect(integrationService.findByName).not.toHaveBeenCalled();
  });

  it('no credential → the settings view has no connection state at all', async () => {
    const { svc, tenant } = build(null);
    const view = await svc.getShopifyView(4);
    const res = TenantMapper.toShopifySettings(tenant, view.cred);
    expect(res.credential.configured).toBe(false);
    expect(res.integration).toEqual({ status: null, lastSyncAt: null, detail: null });
  });

  it("a saved-but-untested credential shows 'unknown', with its own detail and time", async () => {
    const at = new Date('2026-10-19T03:00:00Z');
    const cred = { secretEnc: Buffer.from('e'), status: 'unknown', detail: null, lastTestedAt: null, updatedAt: at };
    const { svc, tenant } = build(cred);
    const res = TenantMapper.toShopifySettings(tenant, (await svc.getShopifyView(1)).cred);
    expect(res.credential).toEqual({ configured: true, updatedAt: at });
    expect(res.integration.status).toBe('unknown');
  });

  it('recordShopifyOutcome stamps status/detail/lastTestedAt on the tenant credential only', async () => {
    const cred = { secretEnc: Buffer.from('e'), status: 'unknown', detail: null, lastTestedAt: null };
    const { svc, saved, integrationService } = build(cred);
    await svc.recordShopifyOutcome(1, true, 'Synced 3 order(s)');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ status: 'connected', detail: 'Synced 3 order(s)' });
    expect(saved[0].lastTestedAt).toBeInstanceOf(Date);
    expect(integrationService.upsert).not.toHaveBeenCalled();
  });

  it('recordShopifyOutcome records a failure as error and clamps the detail', async () => {
    const cred = { secretEnc: Buffer.from('e'), status: 'connected', detail: 'ok', lastTestedAt: new Date() };
    const { svc, saved } = build(cred);
    await svc.recordShopifyOutcome(1, false, 'x'.repeat(300));
    expect(saved[0].status).toBe('error');
    expect((saved[0].detail as string).length).toBe(255);
  });

  it('a successful sync moves this tenant\'s cursor; a test or a failure leaves it alone (FIX-261019)', async () => {
    const was = new Date('2026-10-19T10:00:00Z');
    const cred = { secretEnc: Buffer.from('e'), status: 'connected', detail: null, lastTestedAt: null, lastSyncedAt: was };
    const { svc, saved } = build(cred);
    await svc.recordShopifyOutcome(1, true, 'Connected: shop'); // connection test → no syncedAt
    expect(saved[0].lastSyncedAt).toBe(was);
    await svc.recordShopifyOutcome(1, false, 'Sync failed', { syncedAt: new Date() });
    expect(saved[1].lastSyncedAt).toBe(was);
    const now = new Date('2026-10-19T12:00:00Z');
    await svc.recordShopifyOutcome(1, true, 'Synced 2 order(s)', { syncedAt: now });
    expect(saved[2].lastSyncedAt).toBe(now);
  });

  it('getShopifySyncCursor is per tenant and null when never synced', async () => {
    const { svc: never } = build({ secretEnc: Buffer.from('e'), lastSyncedAt: null });
    expect(await never.getShopifySyncCursor(1)).toBeNull();
    const at = new Date('2026-10-19T12:00:00Z');
    const { svc: synced, credRepo } = build({ secretEnc: Buffer.from('e'), lastSyncedAt: at });
    expect(await synced.getShopifySyncCursor(4)).toBe(at);
    expect(credRepo.findOne).toHaveBeenCalledWith({ where: { tenantId: 4, provider: 'shopify' } });
  });

  it('recordShopifyOutcome without a credential writes nothing (missing store ≠ error)', async () => {
    const { svc, credRepo } = build(null);
    await svc.recordShopifyOutcome(4, false, 'missing');
    expect(credRepo.save).not.toHaveBeenCalled();
  });
});
