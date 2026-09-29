import { Repository } from 'typeorm';
import { TenantService } from './tenant.service';
import { Tenant } from './entity/tenant.entity';
import { IntegrationCredential } from './entity/integration-credential.entity';
import { User } from '../user/entity/user.entity';
import { IntegrationService } from '../integration/integration.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * Save-time gate for the widget exposure restriction (PLN-260929 P1).
 *
 * The rules are refused HERE rather than dropped silently later: an operator
 * who mistypes their office CIDR should hear about it while they are looking at
 * the form, not discover it by finding the widget invisible at their desk.
 */
describe('TenantService.updateWidgetAccess', () => {
  let tenant: Tenant;
  let auditWrite: jest.Mock;
  let svc: TenantService;

  beforeEach(() => {
    tenant = {
      id: 1,
      uuid: 'u-1',
      shopDomain: 'acme.myshopify.com',
      slug: 'acme',
      name: 'Acme',
      status: 'active',
      widgetAccess: null,
      widgetAccessKey: null,
    } as Tenant;
    // The real AuditService.write returns a promise; the service chains .catch on
    // it, so a mock returning undefined would fail for the wrong reason.
    auditWrite = jest.fn(async () => undefined);

    const tenantRepo = {
      findOne: jest.fn(async () => tenant),
      save: jest.fn(async (t: Tenant) => t),
      update: jest.fn(async () => undefined),
    } as unknown as Repository<Tenant>;

    svc = new TenantService(
      tenantRepo,
      {} as Repository<IntegrationCredential>,
      {} as Repository<User>,
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      {} as IntegrationService,
      { write: auditWrite } as unknown as AuditService,
    );
  });

  const body = (over: Partial<Parameters<TenantService['updateWidgetAccess']>[2]> = {}) => ({
    enabled: true,
    ips: ['203.0.113.7'],
    urls: [],
    ...over,
  }) as Parameters<TenantService['updateWidgetAccess']>[2];

  it('stores a normalised restriction and audits it', async () => {
    const saved = await svc.updateWidgetAccess(1, 9, body({ urls: ['shop.example.com/test'] }));

    expect(saved.widgetAccess).toMatchObject({
      enabled: true,
      ips: ['203.0.113.7'],
      urls: ['shop.example.com/test'],
    });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.widget_access_updated' }),
    );
  });

  it('refuses an IP that is not an address or block', async () => {
    await expect(svc.updateWidgetAccess(1, 9, body({ ips: ['10.10.0.0/33'] }))).rejects.toThrow(
      BusinessException,
    );
    await expect(svc.updateWidgetAccess(1, 9, body({ ips: ['office wifi'] }))).rejects.toThrow(
      BusinessException,
    );
  });

  it('refuses a URL it cannot parse', async () => {
    await expect(
      svc.updateWidgetAccess(1, 9, body({ ips: [], urls: ['ftp://shop.example.com'] })),
    ).rejects.toThrow(BusinessException);
  });

  it('refuses turning it on with nothing allowed — that is a blackout, not a setting', async () => {
    await expect(svc.updateWidgetAccess(1, 9, body({ ips: [], urls: [] }))).rejects.toThrow(
      BusinessException,
    );
  });

  it('allows no IP/URL when an invite key exists — the key IS the rule', async () => {
    tenant.widgetAccessKey = 'abc123';
    const saved = await svc.updateWidgetAccess(1, 9, body({ ips: [], urls: [] }));
    expect(saved.widgetAccess?.enabled).toBe(true);
  });

  it('refuses a window that ends before it starts', async () => {
    await expect(
      svc.updateWidgetAccess(
        1,
        9,
        body({ starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-10-01T00:00:00Z' }),
      ),
    ).rejects.toThrow(BusinessException);
  });

  it('switching off stores the off state rather than deleting the lists', async () => {
    const saved = await svc.updateWidgetAccess(1, 9, body({ enabled: false }));
    expect(saved.widgetAccess).toMatchObject({ enabled: false, ips: ['203.0.113.7'] });
  });
});
