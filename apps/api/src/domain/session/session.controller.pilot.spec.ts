import { SESSION_IDENTITY } from '@sharptalk/types';
import type { PilotAccess } from '@sharptalk/types';
import { SessionController } from './session.controller';
import { SessionMapper } from './session.mapper';
import { EmbedController } from '../embed/embed.controller';
import { PilotService } from '../pilot/pilot.service';
import { PILOT_NOTICE } from '../pilot/pilot.messages';
import { IS_PUBLIC_KEY } from '../../global/decorator/public.decorator';
import type { Session } from './entity/session.entity';

/**
 * The pilot verdict the widget reads (PLN-261012 SG-40): `pilot` on the
 * `ensure` and `identify` responses, and the lightweight `POST /session/pilot`
 * re-check. The verdict comes from the same PilotService evaluation the chat
 * gate uses, so the widget hides for exactly the sessions the server refuses.
 */
describe('pilot verdict on the session responses', () => {
  const ON: PilotAccess = { enabled: true, guestAllowed: true, nonPilot: 'hide', notice: {} };
  const notice = {
    privacyPolicyUrl: null,
    consentNoticeVersion: '2026-07',
    widgetLoginMode: 'redirect',
    widgetTabs: ['chat'],
    widgetTabPosition: 'top',
    widgetTheme: null,
    widgetCopy: { displayName: null, firstVisit: {}, loginGreeting: {} },
  };

  const sessionRow = (hotelSn: string | null): Session =>
    ({
      id: 5,
      sessionToken: 'tok-5',
      tenantId: 1,
      channel: null,
      language: 'VI',
      customerId: hotelSn ? 40 : null,
      consentState: 'granted',
      consentVersion: '2026-07',
      consentAt: null,
      identityLevel: hotelSn ? SESSION_IDENTITY.VERIFIED : SESSION_IDENTITY.GUEST,
      identityClaims: hotelSn
        ? { hotelSn, role: 'manager', signed: true, verifiedAt: new Date().toISOString() }
        : null,
    }) as unknown as Session;

  function pilotWith(pilotAccess: PilotAccess | null, hotels: string[] = ['1721']) {
    return new PilotService(
      { findOne: jest.fn(async () => ({ id: 1, pilotAccess })) } as never,
      { find: jest.fn(async () => hotels.map((hotelSn) => ({ hotelSn }))) } as never,
      { get: async () => null, set: async () => undefined, del: async () => undefined } as never,
    );
  }

  const sessionService = (s: Session) =>
    ({
      ensure: jest.fn(async () => s),
      privacyNotice: jest.fn(async () => notice),
      customerDisplayName: jest.fn(async () => null),
      // The expiry-aware identity the controllers now pass to the mapper (SG-03).
      identityOf: jest.fn(async () => undefined),
      findByToken: jest.fn(async () => s),
    }) as never;

  describe('POST /session/ensure', () => {
    it('carries pilot: { eligible: null } for a tenant without a pilot list', async () => {
      const c = new SessionController(sessionService(sessionRow(null)), pilotWith(null));
      expect((await c.ensure({ shop_domain: 'x' })).pilot).toEqual({ eligible: null });
    });

    it('carries eligible true for a guest the tenant allows', async () => {
      const c = new SessionController(sessionService(sessionRow(null)), pilotWith(ON));
      expect((await c.ensure({ shop_domain: 'x' })).pilot).toEqual({ eligible: true });
    });

    it('carries eligible false, the mode and the notice for a guest the tenant does not allow', async () => {
      const c = new SessionController(
        sessionService(sessionRow(null)),
        pilotWith({ ...ON, guestAllowed: false, nonPilot: 'notice', notice: { VI: 'Chưa áp dụng.' } }),
      );
      expect((await c.ensure({ shop_domain: 'x' })).pilot).toEqual({ eligible: false, mode: 'notice', notice: 'Chưa áp dụng.' });
    });

    it('a resumed session that is signed in for a hotel off the list reads as not eligible', async () => {
      const c = new SessionController(sessionService(sessionRow('3307')), pilotWith(ON));
      expect((await c.ensure({ shop_domain: 'x', session_token: 'tok-5' })).pilot).toMatchObject({ eligible: false, mode: 'hide' });
    });

    it('still answers (as "no pilot list") when the verdict cannot be computed — a hint must not break page load', async () => {
      const broken = new PilotService({ findOne: jest.fn().mockRejectedValue(new Error('db down')) } as never, {} as never, {
        get: async () => null,
        set: async () => undefined,
      } as never);
      const c = new SessionController(sessionService(sessionRow(null)), broken);
      expect((await c.ensure({ shop_domain: 'x' })).pilot).toEqual({ eligible: null });
    });

    it('a controller built without the pilot module still answers, with eligible null', async () => {
      const c = new SessionController(sessionService(sessionRow(null)));
      expect((await c.ensure({ shop_domain: 'x' })).pilot).toEqual({ eligible: null });
    });
  });

  describe('POST /public/embed/identify', () => {
    const embedService = (s: Session) => ({ identify: jest.fn(async () => s) }) as never;

    it('answers a hotel on the list with eligible true', async () => {
      const c = new EmbedController(embedService(sessionRow('1721')), sessionService(sessionRow('1721')), pilotWith(ON));
      const res = await c.identify({ session_token: 'tok-5', user_id: 'u1', hash: 'h' });
      expect(res.pilot).toEqual({ eligible: true });
    });

    it('answers a hotel off the list with eligible false — the widget gets out of the way', async () => {
      const c = new EmbedController(embedService(sessionRow('3307')), sessionService(sessionRow('3307')), pilotWith(ON));
      const res = await c.identify({ session_token: 'tok-5', user_id: 'u1', hash: 'h' });
      expect(res.pilot).toEqual({ eligible: false, mode: 'hide', notice: PILOT_NOTICE.VI });
    });

    it('answers eligible null for a tenant without a pilot list', async () => {
      const c = new EmbedController(embedService(sessionRow('3307')), sessionService(sessionRow('3307')), pilotWith(null));
      const res = await c.identify({ session_token: 'tok-5', user_id: 'u1', hash: 'h' });
      expect(res.pilot).toEqual({ eligible: null });
    });
  });

  describe('POST /session/pilot — the re-check', () => {
    it('is public (the widget has no JWT) and answers { pilot } for the session token alone', async () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, SessionController.prototype.pilot)).toBe(true);
      const svc = sessionService(sessionRow('3307'));
      const c = new SessionController(svc, pilotWith(ON));
      expect(await c.pilot({ session_token: 'tok-5' })).toEqual({
        pilot: { eligible: false, mode: 'hide', notice: PILOT_NOTICE.VI },
      });
    });

    it('sees a hotel added in the console without a new session', async () => {
      const hotels = ['1721'];
      const pilot = new PilotService(
        { findOne: jest.fn(async () => ({ id: 1, pilotAccess: ON })) } as never,
        { find: jest.fn(async () => hotels.map((hotelSn) => ({ hotelSn }))) } as never,
        { get: async () => null, set: async () => undefined, del: async () => undefined } as never,
      );
      const c = new SessionController(sessionService(sessionRow('3307')), pilot);
      expect((await c.pilot({ session_token: 'tok-5' })).pilot.eligible).toBe(false);
      hotels.push('3307');
      expect((await c.pilot({ session_token: 'tok-5' })).pilot.eligible).toBe(true);
    });
  });

  describe('SessionMapper', () => {
    const base = sessionRow(null);

    it('adds `pilot` only when one is given — a response built without it keeps its old shape', () => {
      expect(SessionMapper.toResponse(base, notice as never)).not.toHaveProperty('pilot');
      expect(SessionMapper.toResponse(base, notice as never, null, undefined, { eligible: null })).toMatchObject({ pilot: { eligible: null } });
    });
  });
});
