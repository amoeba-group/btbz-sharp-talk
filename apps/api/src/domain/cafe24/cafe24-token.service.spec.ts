import { randomBytes } from 'node:crypto';
import { Cafe24TokenService } from './cafe24-token.service';
import { encryptSecret, decryptSecret } from '../../global/util/crypto.util';

/**
 * What the mall grants can shrink without anything changing on our side, and
 * until the refresh read it back the record kept claiming the original set —
 * so the first sign was a 403 half an hour later that the record contradicted.
 */
describe('Cafe24TokenService.refresh — recorded scopes', () => {
  const OLD_ENV = process.env;
  let saved: any[];
  let warns: string[];

  const build = (credScopes: string[]) => {
    const cred: any = {
      id: 1,
      tenantId: 3,
      provider: 'cafe24',
      secretEnc: encryptSecret(
        JSON.stringify({ mallId: 'amoebaorder', refreshToken: 'r1', scopes: credScopes }),
      ),
    };
    saved = [];
    const repo = {
      findOne: jest.fn(async () => cred),
      save: jest.fn(async (c: any) => {
        saved.push(JSON.parse(decryptSecret(c.secretEnc)));
        return c;
      }),
    };
    const svc = new Cafe24TokenService(repo as never);
    warns = [];
    jest.spyOn((svc as any).logger, 'warn').mockImplementation((m: string) => warns.push(m));
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    return { svc, cred };
  };

  const respond = (body: Record<string, unknown>) => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => body })) as never;
  };

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      CAFE24_CLIENT_ID: 'cid',
      CAFE24_CLIENT_SECRET: 'sec',
      // The credential is stored encrypted; any 32-byte key works as long as
      // the same one round-trips within the test.
      CRED_ENC_KEY: randomBytes(32).toString('base64'),
    };
  });
  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('writes back the scopes the mall actually granted', async () => {
    const { svc, cred } = build(['mall.read_order', 'mall.read_product']);
    respond({ access_token: 'a1', expires_in: 7200, scopes: ['mall.read_product'] });

    await (svc as any).refresh(3, JSON.parse(decryptSecret(cred.secretEnc)), cred);

    expect(saved[0].scopes).toEqual(['mall.read_product']);
  });

  it('names the lost scope and the fix, since the 403 it causes explains neither', async () => {
    const { svc, cred } = build(['mall.read_order', 'mall.read_product']);
    respond({ access_token: 'a1', scopes: ['mall.read_product'] });

    await (svc as any).refresh(3, JSON.parse(decryptSecret(cred.secretEnc)), cred);

    expect(warns.join(' ')).toContain('mall.read_order');
    expect(warns.join(' ')).toContain('re-authorise');
  });

  it('saves a scope change even when the refresh token did not rotate', async () => {
    // Saving only on rotation was how the stale record survived: an unrotated
    // refresh carried the old scopes forward untouched.
    const { svc, cred } = build(['mall.read_order']);
    respond({ access_token: 'a1', refresh_token: 'r1', scopes: ['mall.read_product'] });

    await (svc as any).refresh(3, JSON.parse(decryptSecret(cred.secretEnc)), cred);

    expect(saved).toHaveLength(1);
    expect(saved[0].scopes).toEqual(['mall.read_product']);
    expect(saved[0].refreshToken).toBe('r1');
  });

  it('leaves the record alone when the response says nothing about scopes', async () => {
    // Absence is not a revocation — dropping the record would lose the only
    // thing we know about the grant.
    const { svc, cred } = build(['mall.read_order']);
    respond({ access_token: 'a1', refresh_token: 'r2' });

    await (svc as any).refresh(3, JSON.parse(decryptSecret(cred.secretEnc)), cred);

    expect(saved[0].scopes).toEqual(['mall.read_order']);
    expect(saved[0].refreshToken).toBe('r2');
    expect(warns.join(' ')).not.toContain('no longer grants');
  });
});

/**
 * FIX-261019 — the access-token cache must die with the credential it came
 * from. A console reconnect rewrites `secret_enc`; serving the previous
 * grant's token after that made re-authorising a mall look like a no-op.
 */
describe('Cafe24TokenService.getConnection — cache follows the credential', () => {
  const OLD_ENV = process.env;
  let fetchCalls: number;
  const respond = (token: string) => {
    global.fetch = jest.fn(async () => {
      fetchCalls++;
      return { ok: true, json: async () => ({ access_token: token, expires_in: 7200, refresh_token: 'same' }) };
    }) as never;
  };
  const blob = (refreshToken: string) =>
    encryptSecret(JSON.stringify({ mallId: 'amoebaorder', refreshToken, scopes: ['mall.read_order'] }));

  beforeEach(() => {
    process.env = { ...OLD_ENV, CAFE24_CLIENT_ID: 'cid', CAFE24_CLIENT_SECRET: 'sec', CRED_ENC_KEY: randomBytes(32).toString('base64') };
    fetchCalls = 0;
  });
  afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks(); });

  function build() {
    const cred: any = { id: 3, tenantId: 3, provider: 'cafe24', secretEnc: blob('same') };
    const repo = { findOne: jest.fn(async () => cred), save: jest.fn(async (c: any) => c) };
    const svc = new Cafe24TokenService(repo as never);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    return { svc, cred };
  }

  it('reuses the cached token while the stored credential is unchanged', async () => {
    const { svc } = build();
    respond('a1');
    expect((await svc.getConnection(3))?.accessToken).toBe('a1');
    expect((await svc.getConnection(3))?.accessToken).toBe('a1');
    expect(fetchCalls).toBe(1);
  });

  it('refreshes again once the credential row was rewritten (console reconnect)', async () => {
    const { svc, cred } = build();
    respond('a1');
    await svc.getConnection(3);
    // The OAuth callback stores a brand-new refresh token for the same tenant.
    cred.secretEnc = blob('fresh-from-reconnect');
    respond('a2');
    expect((await svc.getConnection(3))?.accessToken).toBe('a2');
    expect(fetchCalls).toBe(2);
  });

  it('a rotation the service saved itself does NOT invalidate its own cache', async () => {
    const { svc } = build();
    global.fetch = jest.fn(async () => {
      fetchCalls++;
      return { ok: true, json: async () => ({ access_token: 'a1', expires_in: 7200, refresh_token: 'rotated' }) };
    }) as never;
    await svc.getConnection(3); // rotates → saves new secretEnc → cache keyed to it
    await svc.getConnection(3);
    expect(fetchCalls).toBe(1);
  });
});
