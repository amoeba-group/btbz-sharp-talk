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
    orders?: unknown[] | Error;
  }) {
    // `saved` collects the partial UPDATE payloads (status/detail/lastTestedAt).
    const saved: Record<string, unknown>[] = [];
    const credRepo = {
      findOne: jest.fn(async () => opts.cred),
      update: jest.fn(async (_where: unknown, patch: Record<string, unknown>) => { saved.push(patch); return { affected: 1 }; }),
      // Deliberately absent: save() would write the stale secret_enc back over
      // the refresh token the probe just rotated (see the service comment).
      save: jest.fn(async () => { throw new Error('save(cred) must not be used — it clobbers the rotated refresh token'); }),
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
      pullOrders: jest.fn(async () => {
        if (opts.orders instanceof Error) throw opts.orders;
        return opts.orders ?? [];
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
    // The patch never carries the secret: the token service owns that column.
    expect(saved[0]).not.toHaveProperty('secretEnc');
  });

  it('records through a partial update keyed by id, never through save(cred)', async () => {
    const { svc, saved } = build({
      cred: CRED(),
      conn: { mallId: 'zhangbayo', accessToken: 'a1' },
      products: [],
    });
    await svc.testConnection(16);
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0]).sort()).toEqual(['detail', 'lastTestedAt', 'status']);
  });

  it('refresh failed (getConnection null) → error asking to reconnect, recorded', async () => {
    const { svc, saved } = build({ cred: CRED(), conn: null });
    const res = await svc.testConnection(16);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/reconnect/);
    expect(saved[0].status).toBe('error');
  });

  it('catalogue 403 but orders readable (grant shrank) → still connected, via orders', async () => {
    const { svc, saved, client } = build({
      cred: CRED(),
      conn: { mallId: 'amoebaorder', accessToken: 'a1' },
      products: new Error('Cafe24 API error'),
      orders: [],
    });
    const res = await svc.testConnection(3);
    expect(res).toEqual({ ok: true, detail: 'Connected: amoebaorder.cafe24.com (orders reachable)' });
    expect(client.pullOrders).toHaveBeenCalledWith('amoebaorder', 'a1', expect.objectContaining({ limit: 1 }));
    expect(saved[0].status).toBe('connected');
  });

  it('every read refused (403 insufficient_scope, 5xx) → error naming the mall + both failures, recorded', async () => {
    const { svc, saved } = build({
      cred: CRED(),
      conn: { mallId: 'zhangbayo', accessToken: 'a1' },
      products: new Error('Cafe24 API error'),
      orders: new Error('Cafe24 API error'),
    });
    const res = await svc.testConnection(16);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/zhangbayo/);
    expect(res.detail).toMatch(/catalogue: Cafe24 API error; orders: Cafe24 API error/);
    expect(res.detail).toMatch(/re-authorise/);
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
