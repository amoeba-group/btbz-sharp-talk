import { EcommerceIntegrationService } from './ecommerce-integration.service';

/**
 * PLN-261019 D4 — the tenant's own platform ('self') rides the generic flow but
 * has no remote end: registering it is the connection, and nothing may probe
 * it into 'error'.
 */
describe('EcommerceIntegrationService — self-hosted platform', () => {
  beforeAll(() => {
    const crypto = require('../../global/util/crypto.util');
    jest.spyOn(crypto, 'encryptSecret').mockImplementation(() => Buffer.from('enc'));
    jest
      .spyOn(crypto, 'decryptSecret')
      .mockImplementation(() => JSON.stringify({ platform_name: 'Go2Joy', description: 'Hotel admin' }));
  });
  afterAll(() => jest.restoreAllMocks());

  function build(existing: Record<string, unknown> | null) {
    const saved: Record<string, unknown>[] = [];
    const credRepo = {
      findOne: jest.fn(async () => existing),
      create: (r: Record<string, unknown>) => r,
      save: jest.fn(async (r: Record<string, unknown>) => {
        saved.push(r);
        return r;
      }),
    };
    const integrationService = { upsert: jest.fn(), findByName: jest.fn() };
    const svc = new EcommerceIntegrationService(credRepo as never, integrationService as never);
    return { svc, saved, credRepo, integrationService };
  }

  it("save('self') registers it as connected immediately — there is nothing to test", async () => {
    const { svc, saved } = build(null);
    await svc.save(4, 'self', { platform_name: 'Go2Joy', description: 'Hotel admin' });
    expect(saved[0]).toMatchObject({ tenantId: 4, provider: 'self', status: 'connected' });
    expect(saved[0].lastTestedAt).toBeInstanceOf(Date);
    expect(typeof saved[0].detail).toBe('string');
  });

  it('re-saving a self platform keeps it connected (no reset to unknown)', async () => {
    const existing = { status: 'connected', detail: 'Registered', lastTestedAt: new Date(), secretEnc: Buffer.from('e') };
    const { svc, saved } = build(existing);
    await svc.save(4, 'self', { platform_name: 'Go2Joy Partner' });
    expect(saved[0].status).toBe('connected');
    expect(saved[0].lastTestedAt).toBeInstanceOf(Date);
  });

  it('an e-commerce provider still saves as unknown (gate unchanged)', async () => {
    const { svc, saved } = build(null);
    await svc.save(4, 'odoo', { url: 'https://x', db: 'd', username: 'u', api_key: 'k' });
    expect(saved[0].status).toBe('unknown');
  });

  it("getSettings('self') exposes the name and description as plain fields", async () => {
    const existing = { status: 'connected', detail: 'Registered', lastTestedAt: new Date(), secretEnc: Buffer.from('e') };
    const { svc } = build(existing);
    const res = await svc.getSettings(4, 'self');
    expect(res.fields).toEqual({ platform_name: 'Go2Joy', description: 'Hotel admin' });
    expect(res.secrets).toEqual({});
    expect(res.integration.status).toBe('connected');
  });

  it("test('self') never probes and never flips a registered platform to error", async () => {
    const probe = require('./ecommerce-probe.util');
    const spy = jest.spyOn(probe, 'probeEcommerce');
    const existing = { status: 'connected', detail: 'Registered', lastTestedAt: new Date(), secretEnc: Buffer.from('e') };
    const { svc, saved } = build(existing);
    const res = await svc.test(4, 'self');
    expect(res.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    spy.mockRestore();
  });

  it("test('self') on an unregistered tenant answers ok=false without writing", async () => {
    const { svc, saved } = build(null);
    const res = await svc.test(4, 'self');
    expect(res.ok).toBe(false);
    expect(saved).toHaveLength(0);
  });
});
