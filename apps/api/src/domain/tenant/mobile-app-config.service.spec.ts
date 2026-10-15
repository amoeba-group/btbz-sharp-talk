import { MobileAppConfigService } from './mobile-app-config.service';
import { MOBILE_APP_DEFAULTS } from '@sharptalk/types';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * Host-app surface settings (PLN-261015 S9). What matters: an entry can only
 * point at one of THIS tenant's agents, a save is stored normalised, and the
 * public read is keyed by shop and never leaks beyond look + table.
 */
describe('MobileAppConfigService', () => {
  const build = (opts: { stored?: unknown; agents?: string[]; tenantExists?: boolean } = {}) => {
    const tenantRepo = {
      findOne: jest.fn(async () =>
        opts.tenantExists === false ? null : { id: 7, shopDomain: 'https://www.go2joy.vn', mobileAppConfig: opts.stored ?? null },
      ),
      update: jest.fn(async () => undefined),
    };
    const agentRepo = { find: jest.fn(async () => (opts.agents ?? ['hotel-admin', 'hotel-partner']).map((code) => ({ code }))) };
    const audit = { write: jest.fn(async () => undefined) };
    const svc = new MobileAppConfigService(tenantRepo as never, agentRepo as never, audit as never);
    return { svc, tenantRepo, agentRepo, audit };
  };

  const body = (over: Record<string, unknown> = {}) =>
    ({
      app: { font: 'system', font_size: 15, menu_style: 'chip', header: 'native', brand: '#f26a1b' },
      entries: [
        { screen: 'Bookings', agent_code: 'hotel-admin', context_label: 'Mã đặt phòng' },
        { screen: 'guest-chat', agent_code: 'hotel-partner' },
      ],
      min_sdk: '0.2.0',
      ...over,
    }) as never;

  it('reads defaults for a tenant that never saved, and says so', async () => {
    const { svc } = build();
    expect(await svc.get(7)).toEqual({ configured: false, config: MOBILE_APP_DEFAULTS });
  });

  it('stores the config normalised (snake → camel, lowercase screen, #RRGGBB brand)', async () => {
    const { svc, tenantRepo } = build();
    const res = await svc.update(7, 1, body());
    expect(res.configured).toBe(true);
    expect(res.config.app).toEqual({ font: 'system', fontSize: 15, menuStyle: 'chip', header: 'native', brand: '#F26A1B' });
    expect(res.config.entries).toEqual([
      { screen: 'bookings', agentCode: 'hotel-admin', contextLabel: 'Mã đặt phòng' },
      { screen: 'guest-chat', agentCode: 'hotel-partner', contextLabel: null },
    ]);
    expect(tenantRepo.update).toHaveBeenCalledWith({ id: 7 }, { mobileAppConfig: res.config });
  });

  it('refuses an entry whose agent this tenant does not have — nothing is stored', async () => {
    const { svc, tenantRepo } = build({ agents: ['hotel-admin'] });
    await expect(svc.update(7, 1, body())).rejects.toBeInstanceOf(BusinessException);
    expect(tenantRepo.update).not.toHaveBeenCalled();
  });

  it('checks agents inside the caller tenant only', async () => {
    const { svc, agentRepo } = build();
    await svc.update(7, 1, body());
    expect(agentRepo.find).toHaveBeenCalledWith({ where: { tenantId: 7 } });
  });

  it('does not query agents when there are no entries', async () => {
    const { svc, agentRepo } = build();
    await svc.update(7, 1, body({ entries: [] }));
    expect(agentRepo.find).not.toHaveBeenCalled();
  });

  it('audits the change without failing the save if the audit write fails', async () => {
    const { svc, audit } = build();
    audit.write.mockRejectedValueOnce(new Error('audit down'));
    await expect(svc.update(7, 1, body())).resolves.toMatchObject({ configured: true });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, action: 'tenant.mobile_app_updated' }));
  });

  it('public read is null for an unknown shop, an empty shop, or a tenant that never configured', async () => {
    expect(await build({ tenantExists: false }).svc.publicFor('https://nope')).toBeNull();
    expect(await build().svc.publicFor('')).toBeNull();
    expect(await build().svc.publicFor('https://www.go2joy.vn')).toBeNull();
  });

  it('public read returns the stored config, normalised again on the way out', async () => {
    const stored = { app: { font: 'comic', fontSize: 99, brand: 'x' }, entries: [{ screen: 'home', agentCode: 'hotel-admin' }] };
    const cfg = await build({ stored }).svc.publicFor('https://www.go2joy.vn');
    expect(cfg?.app).toMatchObject({ font: 'system', fontSize: 16, brand: null });
    expect(cfg?.entries).toEqual([{ screen: 'home', agentCode: 'hotel-admin', contextLabel: null }]);
  });
});
