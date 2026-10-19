import { EcommerceIntegrationService } from './ecommerce-integration.service';
import { cafe24CredentialMode } from './ecommerce-integration.mapper';

/**
 * REQ/PLN-261019-Cafe24 — a Cafe24 credential comes from one of two flows and
 * the generic settings/test path must tell them apart: the OAuth blob
 * (`mallId`/`refreshToken`) is not "credentials missing", and testing it through
 * the manual probe must not overwrite the tenant's recorded state.
 */
describe('Cafe24 credential mode (D1/D3)', () => {
  const OAUTH = JSON.stringify({ mallId: 'zhangbayo', refreshToken: 'r1', scopes: ['mall.read_order'] });
  const MANUAL = JSON.stringify({ mall_id: 'zhangbayo', access_token: 'tok' });
  let blob = '{}';

  beforeAll(() => {
    const crypto = require('../../global/util/crypto.util');
    jest.spyOn(crypto, 'encryptSecret').mockImplementation((s: string) => Buffer.from(s));
    jest.spyOn(crypto, 'decryptSecret').mockImplementation(() => blob);
  });
  afterAll(() => jest.restoreAllMocks());

  function build(existing: Record<string, unknown> | null) {
    const saved: Record<string, unknown>[] = [];
    const credRepo = {
      findOne: jest.fn(async () => existing),
      create: (r: Record<string, unknown>) => r,
      save: jest.fn(async (r: Record<string, unknown>) => { saved.push(r); return r; }),
    };
    const svc = new EcommerceIntegrationService(credRepo as never, {} as never);
    return { svc, saved, credRepo };
  }

  it('cafe24CredentialMode(): oauth / manual / null', () => {
    expect(cafe24CredentialMode({ mallId: 'm', refreshToken: 'r' })).toBe('oauth');
    expect(cafe24CredentialMode({ mall_id: 'm', access_token: 't' })).toBe('manual');
    expect(cafe24CredentialMode({ mall_id: 'm' })).toBe('manual');
    expect(cafe24CredentialMode({})).toBeNull();
    expect(cafe24CredentialMode({ mallId: '', refreshToken: 'r' })).toBeNull();
  });

  it('getSettings(cafe24) on an OAuth blob reports mode=oauth and the mall under fields.mall_id', async () => {
    blob = OAUTH;
    const { svc } = build({ secretEnc: Buffer.from('e'), status: 'connected', detail: 'ok', lastTestedAt: null });
    const res = await svc.getSettings(16, 'cafe24');
    expect(res.mode).toBe('oauth');
    expect(res.fields.mall_id).toBe('zhangbayo');
    expect(res.secrets.access_token).toBe(false);
    expect(res.integration.status).toBe('connected');
  });

  it('getSettings(cafe24) on a manual blob reports mode=manual; no row → null', async () => {
    blob = MANUAL;
    const { svc } = build({ secretEnc: Buffer.from('e') });
    expect((await svc.getSettings(1, 'cafe24')).mode).toBe('manual');
    const none = build(null);
    expect((await none.svc.getSettings(1, 'cafe24')).mode).toBeNull();
  });

  it('getSettings(other provider) carries no mode field', async () => {
    blob = '{}';
    const { svc } = build(null);
    expect('mode' in (await svc.getSettings(1, 'odoo'))).toBe(false);
  });

  it('test(cafe24) on an OAuth blob returns the hint and records NOTHING', async () => {
    blob = OAUTH;
    const existing = { secretEnc: Buffer.from('e'), status: 'connected', detail: 'Connected: 짱바요몰', lastTestedAt: new Date(1) };
    const probe = require('./ecommerce-probe.util');
    const spy = jest.spyOn(probe, 'probeEcommerce');
    const { svc, saved } = build(existing);
    const res = await svc.test(16, 'cafe24');
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    expect(res.detail).toMatch(/Cafe24 OAuth/);
    expect(spy).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    expect(existing.status).toBe('connected');
    spy.mockRestore();
  });

  it('test(cafe24) on a manual blob still runs the probe and records the outcome', async () => {
    blob = MANUAL;
    const probe = require('./ecommerce-probe.util');
    const spy = jest.spyOn(probe, 'probeEcommerce').mockResolvedValue({ ok: true, detail: 'Connected' });
    const { svc, saved } = build({ secretEnc: Buffer.from('e'), status: 'unknown' });
    const res = await svc.test(1, 'cafe24');
    expect(res.ok).toBe(true);
    expect(saved[0].status).toBe('connected');
    spy.mockRestore();
  });

  it('save(cafe24) with a manual access token over an OAuth blob drops the OAuth keys (수동 전환)', async () => {
    blob = OAUTH;
    const { svc, saved } = build({ secretEnc: Buffer.from('e'), status: 'connected' });
    await svc.save(16, 'cafe24', { mall_id: 'zhangbayo', access_token: 'manual-tok' });
    const stored = JSON.parse((saved[0].secretEnc as Buffer).toString());
    expect(stored.refreshToken).toBeUndefined();
    expect(stored.mallId).toBeUndefined();
    expect(stored.access_token).toBe('manual-tok');
    expect(saved[0].status).toBe('unknown');
  });

  it('save(cafe24) without a token keeps an OAuth blob intact', async () => {
    blob = OAUTH;
    const { svc, saved } = build({ secretEnc: Buffer.from('e'), status: 'connected' });
    await svc.save(16, 'cafe24', { mall_id: 'zhangbayo', access_token: '' });
    const stored = JSON.parse((saved[0].secretEnc as Buffer).toString());
    expect(stored.refreshToken).toBe('r1');
  });
});
