import { createCipheriv, randomBytes } from 'crypto';
import { PartnerCredentialService } from './partner-credential.service';
import { PartnerFlagService, partnerApiMode, partnerFlagCacheKey, partnerServerEnabled } from './partner-flag.service';
import { PartnerSettingsService } from './partner-settings.service';
import { PartnerDataController } from './partner-data.controller';

/** The tenant switch, the server switch and the stored connection (PLN-261012 SG-31/32). */
describe('partner data switches and credentials', () => {
  const ENV_KEYS = ['PARTNER_DATA_ENABLED', 'PARTNER_API_MODE', 'CRED_ENC_KEY'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => ENV_KEYS.forEach((k) => (saved[k] = process.env[k])));
  afterEach(() => ENV_KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

  const redisFake = () => {
    const store = new Map<string, string>();
    return {
      store,
      available: () => true,
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      del: jest.fn(async (k: string) => void store.delete(k)),
    };
  };

  describe('server-wide env', () => {
    it('is OFF unless explicitly on: blank, 0, false, junk — all off', () => {
      for (const v of [undefined, '', '0', 'false', 'off', 'no', 'maybe', ' ']) {
        if (v === undefined) delete process.env.PARTNER_DATA_ENABLED;
        else process.env.PARTNER_DATA_ENABLED = v;
        expect(partnerServerEnabled()).toBe(false);
      }
      for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
        process.env.PARTNER_DATA_ENABLED = v;
        expect(partnerServerEnabled()).toBe(true);
      }
    });

    it('PARTNER_API_MODE is mock unless exactly `live` (a typo can never reach a real API)', () => {
      for (const v of [undefined, '', 'mock', 'LIVE1', 'prod', 'liv']) {
        if (v === undefined) delete process.env.PARTNER_API_MODE;
        else process.env.PARTNER_API_MODE = v;
        expect(partnerApiMode()).toBe('mock');
      }
      process.env.PARTNER_API_MODE = ' Live ';
      expect(partnerApiMode()).toBe('live');
    });
  });

  describe('PartnerFlagService', () => {
    const build = (tenantFlag: number | null, redis = redisFake()) => {
      const findOne = jest.fn(async () => (tenantFlag === null ? null : { id: 1, partnerDataEnabled: tenantFlag }));
      const update = jest.fn(async () => undefined);
      return { svc: new PartnerFlagService({ findOne, update } as never, redis as never), findOne, update, redis };
    };

    it('needs BOTH the env and the tenant switch', async () => {
      delete process.env.PARTNER_DATA_ENABLED;
      expect(await build(1).svc.isEnabled(1)).toBe(false); // tenant on, env off
      process.env.PARTNER_DATA_ENABLED = '1';
      expect(await build(0).svc.isEnabled(1)).toBe(false); // env on, tenant off
      expect(await build(null).svc.isEnabled(1)).toBe(false); // unknown tenant
      expect(await build(1).svc.isEnabled(1)).toBe(true);
    });

    it('with the env off it does not even read the database', async () => {
      delete process.env.PARTNER_DATA_ENABLED;
      const b = build(1);
      await b.svc.isEnabled(1);
      expect(b.findOne).not.toHaveBeenCalled();
    });

    it('caches the tenant flag and drops the cache when it is changed', async () => {
      process.env.PARTNER_DATA_ENABLED = '1';
      const b = build(1);
      await b.svc.isEnabled(1);
      await b.svc.isEnabled(1);
      expect(b.findOne).toHaveBeenCalledTimes(1);
      await b.svc.setTenantFlag(1, false);
      expect(b.update).toHaveBeenCalledWith({ id: 1 }, { partnerDataEnabled: 0 });
      expect(b.redis.del).toHaveBeenCalledWith(partnerFlagCacheKey(1));
    });

    it('an unreadable flag is "off", never an exception', async () => {
      process.env.PARTNER_DATA_ENABLED = '1';
      const svc = new PartnerFlagService({ findOne: jest.fn(async () => { throw new Error('db down'); }) } as never, { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as never);
      expect(await svc.isEnabled(1)).toBe(false);
    });
  });

  describe('PartnerSettingsService / controller', () => {
    const build = (flag: boolean, cred: { secretEnc: Buffer | null; status: string } | null) => {
      const flags = {
        tenantFlag: jest.fn(async () => flag),
        setTenantFlag: jest.fn(async () => undefined),
        // Lookup mode (PLN-261012 SG-33): no override unless a test sets one.
        tenantMode: jest.fn(async () => null),
        setTenantMode: jest.fn(async () => undefined),
        serverEnabled: () => true,
        mode: () => 'mock' as const,
      };
      const audit = { write: jest.fn(async () => ({})) };
      const svc = new PartnerSettingsService(flags as never, audit as never, { findOne: jest.fn(async () => cred) } as never);
      return { svc, flags, audit };
    };

    it('reads the switch, the server state and whether a connection is saved', async () => {
      const { svc } = build(true, { secretEnc: Buffer.from('x'), status: 'connected' });
      const mode = { dataMode: null, effectiveMode: 'prefetch', serverMode: 'prefetch', toolsAllowed: true };
      expect(await svc.get(1)).toEqual({ enabled: true, serverEnabled: true, mode: 'mock', configured: true, connectionStatus: 'connected', ...mode });
      const none = build(false, null);
      expect(await none.svc.get(1)).toEqual({ enabled: false, serverEnabled: true, mode: 'mock', configured: false, connectionStatus: null, ...mode });
    });

    it('turning it on or off is audited', async () => {
      const { svc, flags, audit } = build(false, null);
      await svc.setEnabled(1, 9, true);
      expect(flags.setTenantFlag).toHaveBeenCalledWith(1, true);
      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 1, actorType: 'user', actorId: 9, action: 'partner_data.enabled', target: 'tenant:1' }));
      await svc.setEnabled(1, 9, false);
      expect(audit.write).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'partner_data.disabled' }));
    });

    it('the controller only lets a tenant user through and passes the actor on', async () => {
      const { svc } = build(false, null);
      const spy = jest.spyOn(svc, 'setEnabled');
      const ctrl = new PartnerDataController(svc);
      await ctrl.updateSettings({ actorType: 'user', userId: 9, tenantId: 1 } as never, { enabled: true });
      expect(spy).toHaveBeenCalledWith(1, 9, true);
      await expect(ctrl.updateSettings({ actorType: 'admin' } as never, { enabled: true })).rejects.toBeDefined();
      await expect(ctrl.getSettings({ actorType: 'admin' } as never)).rejects.toBeDefined();
    });
  });

  describe('PartnerCredentialService', () => {
    const encrypt = (obj: unknown): Buffer => {
      const key = Buffer.from(process.env.CRED_ENC_KEY as string, 'base64');
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), enc]);
    };
    beforeEach(() => {
      process.env.CRED_ENC_KEY = randomBytes(32).toString('base64');
    });

    it('decrypts the tenant\'s connection (AES-256-GCM) and returns base URL, key and optional signing secret', async () => {
      const findOne = jest.fn(async () => ({ secretEnc: encrypt({ base_url: ' https://partner.example/api ', api_key: 'K', signing_secret: 'S' }) }));
      const svc = new PartnerCredentialService({ findOne } as never);
      expect(await svc.get(1)).toEqual({ baseUrl: 'https://partner.example/api', apiKey: 'K', signingSecret: 'S' });
      expect(findOne).toHaveBeenCalledWith({ where: { tenantId: 1, provider: 'go2joy_partner_api' } });
    });

    it('is null when nothing is saved, a field is missing, or the blob cannot be decoded', async () => {
      expect(await new PartnerCredentialService({ findOne: async () => null } as never).get(1)).toBeNull();
      expect(await new PartnerCredentialService({ findOne: async () => ({ secretEnc: encrypt({ base_url: 'https://x' }) }) } as never).get(1)).toBeNull();
      expect(await new PartnerCredentialService({ findOne: async () => ({ secretEnc: Buffer.from('not ciphertext at all, really') }) } as never).get(1)).toBeNull();
    });

    it('remembers "nothing saved yet" only briefly, so a freshly saved connection is picked up', async () => {
      const now = jest.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);
      let saved: { secretEnc: Buffer } | null = null;
      const findOne = jest.fn(async () => saved);
      const svc = new PartnerCredentialService({ findOne } as never);
      expect(await svc.get(1)).toBeNull();
      saved = { secretEnc: encrypt({ base_url: 'https://x', api_key: 'K' }) };
      expect(await svc.get(1)).toBeNull(); // inside the short window
      now.mockReturnValue(1_006_000); // 6 s later
      expect(await svc.get(1)).toEqual({ baseUrl: 'https://x', apiKey: 'K' });
      now.mockRestore();
    });

    it('caches per tenant for a minute and can be invalidated', async () => {
      const findOne = jest.fn(async () => ({ secretEnc: encrypt({ base_url: 'https://x', api_key: 'K' }) }));
      const svc = new PartnerCredentialService({ findOne } as never);
      await svc.get(1);
      await svc.get(1);
      expect(findOne).toHaveBeenCalledTimes(1);
      svc.invalidate(1);
      await svc.get(1);
      expect(findOne).toHaveBeenCalledTimes(2);
    });
  });
});
