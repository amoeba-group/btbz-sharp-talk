import { PartnerFlagService, parsePartnerMode, partnerEnvMode, partnerModeCacheKey, partnerToolsAllowed } from './partner-flag.service';
import { PartnerSettingsService } from './partner-settings.service';
import { PartnerDataController } from './partner-data.controller';
import { looksLikePartnerQuestion, detectPartnerIntent } from './partner-intent.util';

/** PLN-261012 SG-33 — how the lookup mode is chosen: env default, tenant override, kill switch. */
describe('partner data lookup mode', () => {
  const KEYS = ['PARTNER_DATA_MODE', 'PARTNER_TOOLS_ENABLED', 'PARTNER_DATA_ENABLED'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => KEYS.forEach((k) => ((saved[k] = process.env[k]), delete process.env[k])));
  afterEach(() => KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

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
  const build = (stored: unknown, redis = redisFake()) => {
    const findOne = jest.fn(async () => (stored === 'missing' ? null : { id: 1, partnerDataMode: stored }));
    const update = jest.fn(async () => undefined);
    return { svc: new PartnerFlagService({ findOne, update } as never, redis as never), findOne, update, redis };
  };

  describe('the env', () => {
    it('PARTNER_DATA_MODE is prefetch unless exactly `tools` (a typo can never turn tools on)', () => {
      for (const v of [undefined, '', 'prefetch', 'tool', 'TOOLSS', 'on', '1', 'true']) {
        if (v === undefined) delete process.env.PARTNER_DATA_MODE;
        else process.env.PARTNER_DATA_MODE = v;
        expect(partnerEnvMode()).toBe('prefetch');
      }
      process.env.PARTNER_DATA_MODE = ' Tools ';
      expect(partnerEnvMode()).toBe('tools');
    });

    it('PARTNER_TOOLS_ENABLED only ever PERMITS: blank / junk / 1 allow, 0 / false / no / off forbid', () => {
      for (const v of [undefined, '', '1', 'true', 'yes', 'maybe', ' ']) {
        if (v === undefined) delete process.env.PARTNER_TOOLS_ENABLED;
        else process.env.PARTNER_TOOLS_ENABLED = v;
        expect(partnerToolsAllowed()).toBe(true);
      }
      for (const v of ['0', 'false', 'FALSE', 'no', 'off', ' off ']) {
        process.env.PARTNER_TOOLS_ENABLED = v;
        expect(partnerToolsAllowed()).toBe(false);
      }
    });

    it('a stored value that is not exactly a known mode is "no override"', () => {
      expect(parsePartnerMode('tools')).toBe('tools');
      expect(parsePartnerMode('prefetch')).toBe('prefetch');
      for (const v of [null, undefined, '', 'TOOLS', 'tool', 'on', 1, {}]) expect(parsePartnerMode(v)).toBeNull();
    });
  });

  describe('PartnerFlagService.dataMode', () => {
    it('default prefetch; env tools makes it the default; the tenant override wins in both directions', async () => {
      expect(await build(null).svc.dataMode(1)).toBe('prefetch');
      process.env.PARTNER_DATA_MODE = 'tools';
      expect(await build(null).svc.dataMode(1)).toBe('tools');
      expect(await build('prefetch').svc.dataMode(1)).toBe('prefetch');
      delete process.env.PARTNER_DATA_MODE;
      expect(await build('tools').svc.dataMode(1)).toBe('tools');
    });

    it('the kill switch forces prefetch for everyone and does not even read the database', async () => {
      process.env.PARTNER_TOOLS_ENABLED = '0';
      process.env.PARTNER_DATA_MODE = 'tools';
      const b = build('tools');
      expect(await b.svc.dataMode(1)).toBe('prefetch');
      expect(b.findOne).not.toHaveBeenCalled();
    });

    it('an unknown tenant, or a garbage stored value, follows the server default', async () => {
      expect(await build('missing').svc.dataMode(1)).toBe('prefetch');
      process.env.PARTNER_DATA_MODE = 'tools';
      expect(await build('banana').svc.dataMode(1)).toBe('tools');
    });

    it('an unreadable override is the server default, never an exception', async () => {
      const redis = redisFake();
      const svc = new PartnerFlagService({ findOne: jest.fn(async () => { throw new Error('db down'); }), update: jest.fn() } as never, redis as never);
      await expect(svc.dataMode(1)).resolves.toBe('prefetch');
    });

    it('caches the override — including "no override" — and drops the cache when it changes', async () => {
      const b = build('tools');
      await b.svc.tenantMode(1);
      await b.svc.tenantMode(1);
      expect(b.findOne).toHaveBeenCalledTimes(1);
      expect(b.redis.store.get(partnerModeCacheKey(1))).toBe('tools');

      const none = build(null);
      await none.svc.tenantMode(1);
      await none.svc.tenantMode(1);
      expect(none.findOne).toHaveBeenCalledTimes(1); // '-' cached: a prefetch deployment does not query every turn
      expect(none.redis.store.get(partnerModeCacheKey(1))).toBe('-');

      await b.svc.setTenantMode(1, 'prefetch');
      expect(b.update).toHaveBeenCalledWith({ id: 1 }, { partnerDataMode: 'prefetch' });
      expect(b.redis.del).toHaveBeenCalledWith(partnerModeCacheKey(1));
      await b.svc.setTenantMode(1, null);
      expect(b.update).toHaveBeenLastCalledWith({ id: 1 }, { partnerDataMode: null });
    });
  });

  describe('settings service + controller', () => {
    const buildSettings = (over: { override?: 'tools' | 'prefetch' | null; support?: { supported: boolean; reason: string } | Error } = {}) => {
      const flags = {
        tenantFlag: jest.fn(async () => true),
        setTenantFlag: jest.fn(async () => undefined),
        tenantMode: jest.fn(async () => over.override ?? null),
        setTenantMode: jest.fn(async () => undefined),
        serverEnabled: () => true,
        mode: () => 'mock' as const,
      };
      const audit = { write: jest.fn(async () => ({})) };
      const gateway = {
        toolSupport: jest.fn(async () => {
          if (over.support instanceof Error) throw over.support;
          return { ...(over.support ?? { supported: true, reason: 'ok' }), provider: 'anthropic', engineId: 1 };
        }),
      };
      const svc = new PartnerSettingsService(flags as never, audit as never, { findOne: jest.fn(async () => null) } as never, gateway as never);
      return { svc, flags, audit, gateway };
    };

    it('reports the override, the effective mode, the server default and whether the engine can run tools', async () => {
      process.env.PARTNER_DATA_MODE = 'tools';
      const got = await buildSettings({ override: null }).svc.get(1);
      expect(got).toMatchObject({ dataMode: null, effectiveMode: 'tools', serverMode: 'tools', toolsAllowed: true, toolsSupport: { supported: true, reason: 'ok' } });

      const overridden = await buildSettings({ override: 'prefetch', support: { supported: false, reason: 'capability_missing' } }).svc.get(1);
      expect(overridden).toMatchObject({ dataMode: 'prefetch', effectiveMode: 'prefetch', toolsSupport: { supported: false, reason: 'capability_missing' } });
    });

    it('the kill switch shows as effective prefetch with toolsAllowed=false', async () => {
      process.env.PARTNER_TOOLS_ENABLED = '0';
      const got = await buildSettings({ override: 'tools' }).svc.get(1);
      expect(got).toMatchObject({ dataMode: 'tools', effectiveMode: 'prefetch', toolsAllowed: false });
    });

    it('an unreadable engine is "unknown" (field omitted), not a failed page', async () => {
      const got = await buildSettings({ support: new Error('db') }).svc.get(1);
      expect(got).not.toHaveProperty('toolsSupport');
    });

    it('setDataMode stores the mode (`inherit` clears it) and audits the change with the previous value', async () => {
      const b = buildSettings({ override: 'prefetch' });
      await b.svc.setDataMode(1, 9, 'tools');
      expect(b.flags.setTenantMode).toHaveBeenCalledWith(1, 'tools');
      expect(b.audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 1, actorType: 'user', actorId: 9, action: 'partner_data.mode_changed', target: 'tenant:1', metadata: expect.objectContaining({ from: 'prefetch', to: 'tools' }) }),
      );
      await b.svc.setDataMode(1, 9, 'inherit');
      expect(b.flags.setTenantMode).toHaveBeenLastCalledWith(1, null);
    });

    it('the controller needs at least one field, keeps the switch-only client working, and applies both when both are sent', async () => {
      const b = buildSettings();
      const ctrl = new PartnerDataController(b.svc);
      const user = { actorType: 'user', userId: 9, tenantId: 1 } as never;
      await expect(ctrl.updateSettings(user, {})).rejects.toMatchObject({ errorCode: 'E5003' });

      await ctrl.updateSettings(user, { enabled: true });
      expect(b.flags.setTenantFlag).toHaveBeenCalledWith(1, true);
      expect(b.flags.setTenantMode).not.toHaveBeenCalled();

      await ctrl.updateSettings(user, { data_mode: 'tools' });
      expect(b.flags.setTenantMode).toHaveBeenCalledWith(1, 'tools');

      await ctrl.updateSettings(user, { enabled: false, data_mode: 'inherit' });
      expect(b.flags.setTenantFlag).toHaveBeenLastCalledWith(1, false);
      expect(b.flags.setTenantMode).toHaveBeenLastCalledWith(1, null);
    });
  });

  describe('looksLikePartnerQuestion (the gate in front of the extra planning call)', () => {
    it.each([
      'Báo cáo booking tuần qua thế nào?',
      'Đối soát tháng này còn bao nhiêu?',
      'Chính sách hủy phòng là gì?',
      'Giá phòng Deluxe hôm nay',
      'What are your rates for a suite?',
      'How much is an overnight room?',
      'What is the cancellation policy?',
      'Show me last month settlement',
      '이번 주 예약 현황',
      '정산 내역 알려줘',
      '객실 요금이 얼마예요?',
    ])('talks about a topic: %s', (text) => {
      expect(looksLikePartnerQuestion(text)).toBe(true);
    });

    it.each(['Xin chào!', 'Cảm ơn bạn nhiều', 'Hello there', 'How do I reset my password?', '안녕하세요', '', 'ok'])('does not: %s', (text) => {
      expect(looksLikePartnerQuestion(text)).toBe(false);
    });

    it('is a superset of the detector: whatever detectPartnerIntent pins to a topic, it also admits', () => {
      for (const text of [
        'Giá phòng Deluxe qua đêm hôm nay',
        'Đặt phòng G2J2610170001 đang ở trạng thái nào?',
        'Đối soát tháng 9 còn bao nhiêu chưa thanh toán?',
        'Chính sách hủy phòng và hoàn tiền',
        'What is the overnight room rate on 2026-10-17?',
        '이번 주 예약',
      ]) {
        expect(detectPartnerIntent(text, { hotelSn: '1721' }).topics.length).toBeGreaterThan(0);
        expect(looksLikePartnerQuestion(text)).toBe(true);
      }
    });

    it('never produces or carries a parameter: it is a yes/no on words', () => {
      expect(typeof looksLikePartnerQuestion('booking 2610140000123456 hotel 9999')).toBe('boolean');
    });
  });
});
