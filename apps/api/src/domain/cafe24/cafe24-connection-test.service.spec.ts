import { Cafe24ConnectionTestService } from './cafe24-connection-test.service';

/**
 * PLN-261019-Cafe24 D2 — the OAuth test mints a token the way the syncs do,
 * reads /admin/store, and records the outcome on the tenant's own row.
 */
describe('Cafe24ConnectionTestService.testConnection', () => {
  function build(opts: {
    cred: Record<string, unknown> | null;
    conn?: { mallId: string; accessToken: string } | null | Error;
    store?: { shop_name?: string } | null | Error;
  }) {
    const saved: Record<string, unknown>[] = [];
    const credRepo = {
      findOne: jest.fn(async () => opts.cred),
      save: jest.fn(async (r: Record<string, unknown>) => { saved.push(r); return r; }),
    };
    const tokenService = {
      getConnection: jest.fn(async () => {
        if (opts.conn instanceof Error) throw opts.conn;
        return opts.conn ?? null;
      }),
    };
    const client = {
      getStore: jest.fn(async () => {
        if (opts.store instanceof Error) throw opts.store;
        return opts.store ?? null;
      }),
    };
    const svc = new Cafe24ConnectionTestService(credRepo as never, tokenService as never, client as never);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    return { svc, saved, tokenService, client };
  }
  const CRED = () => ({ id: 14, tenantId: 16, provider: 'cafe24', secretEnc: Buffer.from('e'), status: 'error', detail: 'old', lastTestedAt: null });

  it('no credential → not connected, nothing written', async () => {
    const { svc, saved, tokenService } = build({ cred: null });
    const res = await svc.testConnection(16);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/not connected/);
    expect(saved).toHaveLength(0);
    expect(tokenService.getConnection).not.toHaveBeenCalled();
  });

  it('token + store OK → connected with the shop name, recorded on the row', async () => {
    const { svc, saved, client } = build({
      cred: CRED(),
      conn: { mallId: 'zhangbayo', accessToken: 'a1' },
      store: { shop_name: '짱바요몰' },
    });
    const res = await svc.testConnection(16);
    expect(res).toEqual({ ok: true, detail: 'Connected: 짱바요몰 (zhangbayo)' });
    expect(client.getStore).toHaveBeenCalledWith('zhangbayo', 'a1');
    expect(saved[0].status).toBe('connected');
    expect(saved[0].detail).toBe('Connected: 짱바요몰 (zhangbayo)');
    expect(saved[0].lastTestedAt).toBeInstanceOf(Date);
  });

  it('refresh failed (getConnection null) → error asking to reconnect, recorded', async () => {
    const { svc, saved } = build({ cred: CRED(), conn: null });
    const res = await svc.testConnection(16);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/reconnect/);
    expect(saved[0].status).toBe('error');
  });

  it('store request throws → error with the mall id, recorded', async () => {
    const { svc, saved } = build({
      cred: CRED(),
      conn: { mallId: 'zhangbayo', accessToken: 'a1' },
      store: new Error('E5082'),
    });
    const res = await svc.testConnection(16);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/zhangbayo/);
    expect(saved[0].status).toBe('error');
  });

  it('app keys missing (appConfig throws) → error, recorded, no store call', async () => {
    const { svc, saved, client } = build({ cred: CRED(), conn: new Error('Cafe24 app not configured') });
    const res = await svc.testConnection(16);
    expect(res.ok).toBe(false);
    expect(client.getStore).not.toHaveBeenCalled();
    expect(saved[0].status).toBe('error');
  });
});
