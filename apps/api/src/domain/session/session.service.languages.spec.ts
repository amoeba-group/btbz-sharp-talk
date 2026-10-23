import { SessionService } from './session.service';
import { Session } from './entity/session.entity';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * PLN-261019-Widget-Language-Follow-Selection — a tenant's offered languages
 * bound every way a session language can be set: start (D1), hand pick (D3),
 * detection (D5) and re-open of an older session (D6).
 */
describe('SessionService offered languages (PLN-261019)', () => {
  const GO2JOY = {
    id: 4,
    timezone: 'Asia/Ho_Chi_Minh',
    defaultLanguage: 'vi',
    widgetLanguages: ['vi', 'en'],
  };

  function build(tenant: Record<string, unknown>, existing: Partial<Session> | null = null) {
    const sessionRepo = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((x: Partial<Session>) => ({ ...x }) as Session),
      save: jest.fn((x: Session) => Promise.resolve({ id: 99, ...x })),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const redis = { available: () => false, del: jest.fn(), get: jest.fn(), set: jest.fn() };
    const svc = new SessionService(
      sessionRepo as never,
      { findOne: jest.fn().mockResolvedValue(tenant) } as never,
      {} as never,
      { publish: jest.fn().mockResolvedValue(undefined) } as never,
      redis as never,
    );
    return { svc, sessionRepo, redis };
  }

  describe('start language (D1)', () => {
    it('a browser language the tenant offers is honoured', async () => {
      const { svc } = build(GO2JOY);
      expect((await svc.findOrCreateForCustomer(4, 7, 'vi-VN')).language).toBe('VI');
    });

    it('a browser language the tenant does not offer starts in English, not the tenant default', async () => {
      const { svc } = build(GO2JOY);
      expect((await svc.findOrCreateForCustomer(4, 7, 'ko-KR')).language).toBe('EN');
    });

    it('no preference (English browser) still takes the tenant default when offered', async () => {
      const { svc } = build(GO2JOY);
      expect((await svc.findOrCreateForCustomer(4, 7, 'en-US')).language).toBe('VI');
    });

    it('a tenant default outside the list is skipped; so is the timezone language', async () => {
      const { svc } = build({ ...GO2JOY, defaultLanguage: 'ko', widgetLanguages: ['en', 'es'] });
      expect((await svc.findOrCreateForCustomer(4, 7, 'en')).language).toBe('EN');
    });

    it('NULL list = every language, exactly as before the column existed', async () => {
      const { svc } = build({ ...GO2JOY, widgetLanguages: null });
      expect((await svc.findOrCreateForCustomer(4, 7, 'ko-KR')).language).toBe('KO');
    });
  });

  describe('a chosen language (PLN-261023 — host page or visitor pick)', () => {
    it('opens a new session in English when English was chosen, and locks it', async () => {
      const { svc } = build(GO2JOY);
      const s = await svc.ensure(undefined, 'en', 'https://www.go2joy.vn', undefined, undefined, undefined, undefined, true);
      expect(s.language).toBe('EN');
      expect(s.languageLocked).toBe(1);
    });

    it('without the flag English is still "no preference" → tenant default', async () => {
      const { svc } = build(GO2JOY);
      const s = await svc.ensure(undefined, 'en', 'https://www.go2joy.vn');
      expect(s.language).toBe('VI');
      expect(s.languageLocked).toBe(0);
    });

    it('a chosen language the tenant does not offer falls back to detection', async () => {
      const { svc } = build(GO2JOY);
      const s = await svc.ensure(undefined, 'ko', 'https://www.go2joy.vn', undefined, undefined, undefined, undefined, true);
      expect(s.language).toBe('EN');
      expect(s.languageLocked).toBe(0);
    });

    it('moves a resumed session to the chosen language', async () => {
      const existing = { id: 1, tenantId: 4, sessionToken: 't', language: 'VI', languageLocked: 0 };
      const { svc, sessionRepo } = build(GO2JOY, { ...existing });
      const s = await svc.ensure('t', 'en', undefined, undefined, undefined, undefined, undefined, true);
      expect(s.language).toBe('EN');
      expect(sessionRepo.update).toHaveBeenCalledWith({ id: 1 }, { language: 'EN', languageLocked: 1 });
    });
  });

  describe('hand pick (D3)', () => {
    const session = { id: 1, tenantId: 4, sessionToken: 't', language: 'EN', languageLocked: 0 };

    it('rejects a language outside the list with E3004 and leaves the session alone', async () => {
      const { svc, sessionRepo } = build(GO2JOY, session);
      await expect(svc.setLanguage('t', 'KO')).rejects.toBeInstanceOf(BusinessException);
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('accepts an offered language and locks it', async () => {
      const { svc } = build(GO2JOY, { ...session });
      const saved = await svc.setLanguage('t', 'vi');
      expect(saved.language).toBe('VI');
      expect(saved.languageLocked).toBe(1);
    });
  });

  describe('detection (D5)', () => {
    it('does not move a session to a language the tenant does not offer', async () => {
      const { svc, sessionRepo } = build(GO2JOY);
      const session = { id: 1, tenantId: 4, sessionToken: 't', language: 'VI', languageLocked: 0 } as Session;
      await svc.applyDetectedLanguage(session, 'KO');
      expect(session.language).toBe('VI');
      expect(sessionRepo.update).not.toHaveBeenCalled();
    });

    it('still moves within the list', async () => {
      const { svc, sessionRepo } = build(GO2JOY);
      const session = { id: 1, tenantId: 4, sessionToken: 't', language: 'VI', languageLocked: 0 } as Session;
      await svc.applyDetectedLanguage(session, 'EN');
      expect(session.language).toBe('EN');
      expect(sessionRepo.update).toHaveBeenCalledWith({ id: 1 }, { language: 'EN' });
    });
  });

  describe('re-open of an older session (D6)', () => {
    it('realigns a Korean session on a VI/EN tenant to English and drops its lock', async () => {
      const existing = { id: 1, tenantId: 4, sessionToken: 't', language: 'KO', languageLocked: 1 };
      const { svc, sessionRepo, redis } = build(GO2JOY, existing);
      const s = await svc.ensure('t', 'ko');
      expect(s.language).toBe('EN');
      expect(s.languageLocked).toBe(0);
      expect(sessionRepo.update).toHaveBeenCalledWith({ id: 1 }, { language: 'EN', languageLocked: 0 });
      expect(redis.del).toHaveBeenCalled();
    });

    it('leaves a session already inside the list untouched, lock included', async () => {
      const existing = { id: 1, tenantId: 4, sessionToken: 't', language: 'VI', languageLocked: 1 };
      const { svc, sessionRepo } = build(GO2JOY, existing);
      const s = await svc.ensure('t', 'ko');
      expect(s.language).toBe('VI');
      expect(s.languageLocked).toBe(1);
      expect(sessionRepo.update).not.toHaveBeenCalled();
    });

    it('does nothing for a tenant offering every language', async () => {
      const existing = { id: 1, tenantId: 4, sessionToken: 't', language: 'KO', languageLocked: 0 };
      const { svc, sessionRepo } = build({ ...GO2JOY, widgetLanguages: null }, existing);
      expect((await svc.ensure('t', 'ko')).language).toBe('KO');
      expect(sessionRepo.update).not.toHaveBeenCalled();
    });
  });
});
