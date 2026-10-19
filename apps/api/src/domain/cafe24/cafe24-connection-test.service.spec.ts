import { Cafe24ConnectionTestService } from './cafe24-connection-test.service';

/**
 * PLN-261019-Cafe24 D2 — the OAuth test mints a token the way the syncs do,
 * reads one catalogue row (/products?limit=1 — the store resource needs a scope
 * the app never requests), and records the outcome on the tenant's own row.
 */
describe('Cafe24ConnectionTestService.testConnection', () => {
  function build(opts: {
    cred: Record<string, unknown> | null;
    conn?: { mallId: string; accessToken: string } | null | Error;
    products?: unknown[] | Error;
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
      pullProducts: jest.fn(async () => {
        if (opts.products instanceof Error) throw opts.products;
        return opts.products ?? [];
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

  it('token + one catalogue row OK → connected, recorded on the row (even an empty catalogue)', async () => {
    const { svc, saved, client } = build({
      cred: CRED(),
      conn: { mallId: 'zhangbayo', accessToken: 'a1' },
      products: [],
    });
    const res = await svc.testConnection(16);
    expect(res).toEqual({ ok: true, detail: 'Connected: zhangbayo.cafe24.com (catalogue reachable)' });
    expect(client.pullProducts).toHaveBeenCalledWith('zhangbayo', 'a1', { limit: 1 });
    expect(saved[0].status).toBe('connected');
    expect(saved[0].detail).toBe('Connected: zhangbayo.cafe24.com (catalogue reachable)');
    expect(saved[0].lastTestedAt).toBeInstanceOf(Date);
  });

  it('refresh failed (getConnection null) → error asking to reconnect, recorded', async () => {
    const { svc, saved } = build({ cred: CRED(), conn: null });
    const res = await svc.testConnection(16);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/reconnect/);
    expect(saved[0].status).toBe('error');
  });

  it('catalogue request throws (403 insufficient_scope, 5xx) → error with the mall id, recorded', async () => {
    const { svc, saved } = build({
      cred: CRED(),
      conn: { mallId: 'zhangbayo', accessToken: 'a1' },
      products: new Error('Cafe24 API error'),
    });
    const res = await svc.testConnection(16);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/zhangbayo/);
    expect(saved[0].status).toBe('error');
  });

  it('app keys missing (appConfig throws) → error, recorded, no catalogue call', async () => {
    const { svc, saved, client } = build({ cred: CRED(), conn: new Error('Cafe24 app not configured') });
    const res = await svc.testConnection(16);
    expect(res.ok).toBe(false);
    expect(client.pullProducts).not.toHaveBeenCalled();
    expect(saved[0].status).toBe('error');
  });
});
