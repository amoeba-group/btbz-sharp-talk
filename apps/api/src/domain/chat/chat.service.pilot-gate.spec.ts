import { Repository } from 'typeorm';
import { CONSENT_STATE, CONVERSATION_STATUS, MODERATION_DECISION, SESSION_IDENTITY } from '@sharptalk/types';
import type { IdentityClaims, PilotAccess } from '@sharptalk/types';
import { ChatService } from './chat.service';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { RagService } from './rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { CONSENT_NOTICE_VERSION, SessionService } from '../session/session.service';
import { HandoffRouterService } from '../handoff/handoff-router.service';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { PilotService } from '../pilot/pilot.service';
import { PILOT_NOTICE } from '../pilot/pilot.messages';

/**
 * The pilot allowlist at the chat entry points (PLN-261012 SG-40, REQ §3.5).
 *
 * `ChatService.handleUserMessage` is where a hotel outside the pilot list is
 * actually stopped: right after the consent gate, on the SIGNED hotel of the
 * session, with a soft localized reply — and with nothing stored, no model
 * called, no conversation opened. These run the real ChatService with the real
 * PilotService over in-memory repositories, so the matrix below is the one that
 * ships, and every refusal case asserts the absence of side effects, not just
 * the text of the reply.
 */
describe('ChatService pilot gate — handleUserMessage and escalate', () => {
  const HOURS = 3_600_000;

  interface Setup {
    pilotAccess?: PilotAccess | null;
    hotels?: string[];
    identityPolicy?: { maxAgeHours: number } | null;
  }

  const ON: PilotAccess = { enabled: true, guestAllowed: true, nonPilot: 'hide', notice: {} };

  let fixture: { pilotAccess: PilotAccess | null; hotels: string[]; identityPolicy: { maxAgeHours: number } | null };
  let classify: jest.Mock;
  let ragAnswer: jest.Mock;
  let moderate: jest.Mock;
  let msgSave: jest.Mock;
  let convSave: jest.Mock;
  let convFindOne: jest.Mock;
  let publish: jest.Mock;
  let route: jest.Mock;
  let redisStore: Map<string, string>;
  let pilot: PilotService;
  let svc: ChatService;
  let session: Session;

  const claims = (over: Partial<IdentityClaims> = {}): IdentityClaims => ({
    hotelSn: '1721',
    role: 'manager',
    signed: true,
    verifiedAt: new Date().toISOString(),
    ...over,
  });

  const makeSession = (over: Partial<Session> = {}): Session =>
    ({
      id: 5,
      sessionToken: 'tok-5',
      tenantId: 1,
      customerId: 40,
      channel: null,
      identityLevel: SESSION_IDENTITY.VERIFIED,
      identityClaims: claims(),
      language: 'VI',
      consentState: CONSENT_STATE.GRANTED,
      consentAt: null,
      consentVersion: CONSENT_NOTICE_VERSION,
      ...over,
    }) as unknown as Session;

  const guestSession = (over: Partial<Session> = {}) =>
    makeSession({ identityLevel: SESSION_IDENTITY.GUEST, identityClaims: null, customerId: null, ...over });

  /** `wired: false` builds the service WITHOUT the pilot gate — the "before" behaviour. */
  function build(setup: Setup = {}, wired = true) {
    fixture = {
      pilotAccess: setup.pilotAccess === undefined ? ON : setup.pilotAccess,
      hotels: setup.hotels ?? ['1721', '2204'],
      identityPolicy: setup.identityPolicy ?? null,
    };
    const conversation = { id: 77, sessionId: 5, tenantId: 1, status: CONVERSATION_STATUS.AI_ACTIVE } as Conversation;
    let nextMessageId = 100;
    msgSave = jest.fn(async (m: Message) => ({ ...m, id: m.id ?? nextMessageId++ }) as Message);
    convSave = jest.fn(async (c: Conversation) => c);
    convFindOne = jest.fn(async () => conversation);
    classify = jest.fn(async () => ({ intent: 'general_inquiry', needsOrderData: false, confidence: 0.8 }));
    ragAnswer = jest.fn(async () => ({ text: 'AI answer', confidence: 0.9, citations: [] }));
    moderate = jest.fn(async () => ({ decision: MODERATION_DECISION.DELIVERED, text: 'AI answer' }));
    publish = jest.fn();
    route = jest.fn(async () => ({ mode: 'agents', targetUserIds: [9] }));

    const convRepo = {
      findOne: convFindOne,
      save: convSave,
      create: (c: Partial<Conversation>) => c,
      update: jest.fn(),
      findOneOrFail: jest.fn(async () => conversation),
    } as unknown as Repository<Conversation>;
    const msgRepo = {
      save: msgSave,
      create: (m: Partial<Message>) => m,
      update: jest.fn(),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
    } as unknown as Repository<Message>;
    const sessionRepo = {
      findOne: jest.fn(async () => session),
      save: jest.fn(async (s: Session) => s),
    } as unknown as Repository<Session>;
    const tenantRepo = {
      findOne: jest.fn(async () => ({
        id: 1,
        privacyPolicyUrl: null,
        consentNoticeVersion: null,
        pilotAccess: fixture.pilotAccess,
        identityPolicy: fixture.identityPolicy,
      })),
    } as unknown as Repository<Tenant>;
    const userRepo = { find: jest.fn(async () => []) } as unknown as Repository<User>;
    const bus = { publish } as unknown as EventBusService;
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const sessionService = new SessionService(sessionRepo, tenantRepo, bus, redis);

    redisStore = new Map();
    const pilotRedis = {
      get: async (k: string) => redisStore.get(k) ?? null,
      set: async (k: string, v: string) => void redisStore.set(k, v),
      del: async (k: string) => void redisStore.delete(k),
    };
    pilot = new PilotService(
      tenantRepo,
      { find: jest.fn(async () => fixture.hotels.map((hotelSn) => ({ hotelSn }))) } as never,
      pilotRedis as never,
    );

    svc = new ChatService(
      convRepo,
      msgRepo,
      sessionRepo,
      tenantRepo,
      userRepo,
      { update: jest.fn() } as never,
      {
        classifyIntent: classify,
        answer: ragAnswer,
        effectiveAgentId: jest.fn(async () => 10),
        agentGuestPolicy: jest.fn(async () => 'open'),
        groundingConfidence: jest.fn(async () => 0.9),
        guestGuidance: jest.fn(async () => null),
      } as unknown as RagService,
      { moderate } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      sessionService,
      { route, denyMatch: jest.fn(async () => null), teamQuestion: jest.fn(async () => null), regionLookup: jest.fn(async () => ({ region: null })) } as unknown as HandoffRouterService,
      bus,
    );
    // Wired by field name rather than by position: other streams append their own
    // optional trailing constructor parameters, and the gate must not depend on
    // where in that list it ends up.
    if (wired) Object.assign(svc, { pilot });
  }

  /** The refusal leaves nothing behind. */
  function expectNothingStoredOrCalled() {
    expect(msgSave).not.toHaveBeenCalled();
    expect(convSave).not.toHaveBeenCalled();
    expect(convFindOne).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(ragAnswer).not.toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  }

  const ASK = 'Làm sao đổi giá phòng?';

  describe('the enforcement matrix', () => {
    it('a signed hotel on the pilot list is answered as always', async () => {
      session = makeSession();
      build();
      const out = await svc.handleUserMessage(session, ASK);

      expect(out.reply).toMatchObject({ senderType: 'ai', body: 'AI answer' });
      expect(out.pilotDenied).toBeUndefined();
      expect(ragAnswer).toHaveBeenCalled();
      expect(msgSave).toHaveBeenCalled();
    });

    it('a signed hotel NOT on the list gets a soft notice — nothing stored, no model, no conversation', async () => {
      session = makeSession({ identityClaims: claims({ hotelSn: '3307' }) });
      build();
      const out = await svc.handleUserMessage(session, ASK);

      expect(out).toEqual({
        conversationId: null,
        reply: { senderType: 'system', body: PILOT_NOTICE.VI },
        escalate: false,
        needsAuth: false,
        pilotDenied: true,
      });
      expectNothingStoredOrCalled();
    });

    it('answers the refusal in the session language, tenant wording first', async () => {
      session = makeSession({ identityClaims: claims({ hotelSn: '3307' }), language: 'EN' });
      build({ pilotAccess: { ...ON, nonPilot: 'notice', notice: { EN: 'Not available for your hotel yet (pilot).' } } });
      expect((await svc.handleUserMessage(session, ASK)).reply?.body).toBe('Not available for your hotel yet (pilot).');

      // A language the tenant left blank falls back to the built-in line in THAT language.
      session = makeSession({ identityClaims: claims({ hotelSn: '3307' }), language: 'KO' });
      expect((await svc.handleUserMessage(session, ASK)).reply?.body).toBe(PILOT_NOTICE.KO);
    });

    it('a guest is served while guestAllowed', async () => {
      session = guestSession();
      build();
      const out = await svc.handleUserMessage(session, ASK);
      expect(out.reply?.senderType).toBe('ai');
      expect(ragAnswer).toHaveBeenCalled();
    });

    it('a guest is refused when guestAllowed is off', async () => {
      session = guestSession();
      build({ pilotAccess: { ...ON, guestAllowed: false } });
      const out = await svc.handleUserMessage(session, ASK);
      expect(out).toMatchObject({ pilotDenied: true, conversationId: null, reply: { senderType: 'system' } });
      expectNothingStoredOrCalled();
    });

    it('a v1 identity (a user, no hotel) is a guest to the pilot — refused when guests are off, served when on', async () => {
      session = makeSession({ identityClaims: null }); // verified level, customer bound, but NO signed hotel
      build({ pilotAccess: { ...ON, guestAllowed: false } });
      expect(await svc.handleUserMessage(session, ASK)).toMatchObject({ pilotDenied: true });
      expectNothingStoredOrCalled();

      session = makeSession({ identityClaims: null });
      build();
      expect((await svc.handleUserMessage(session, ASK)).reply?.senderType).toBe('ai');
    });

    it('unsigned claims never count as a hotel — even one that IS on the list', async () => {
      // 1721 is listed. The claim is just not signed, so the session is a guest.
      session = makeSession({ identityClaims: claims({ hotelSn: '1721', signed: false }) });
      build({ pilotAccess: { ...ON, guestAllowed: false } });
      expect(await svc.handleUserMessage(session, ASK)).toMatchObject({ pilotDenied: true });
      expectNothingStoredOrCalled();
    });

    it('an expired identity is a guest (tenant identity policy), however good the hotel was', async () => {
      const stale = new Date(Date.now() - 5 * HOURS).toISOString();
      session = makeSession({ identityClaims: claims({ hotelSn: '1721', verifiedAt: stale }) });
      build({ pilotAccess: { ...ON, guestAllowed: false }, identityPolicy: { maxAgeHours: 2 } });
      expect(await svc.handleUserMessage(session, ASK)).toMatchObject({ pilotDenied: true });
      expectNothingStoredOrCalled();

      // Inside the policy window the same claim is trusted.
      session = makeSession({ identityClaims: claims({ hotelSn: '1721', verifiedAt: stale }) });
      build({ pilotAccess: { ...ON, guestAllowed: false }, identityPolicy: { maxAgeHours: 12 } });
      expect((await svc.handleUserMessage(session, ASK)).reply?.senderType).toBe('ai');
    });

    it('feature off: byte-identical — a hotel off the list is answered, nothing extra is asked', async () => {
      for (const pilotAccess of [null, { ...ON, enabled: false }]) {
        session = makeSession({ identityClaims: claims({ hotelSn: '3307' }) });
        build({ pilotAccess });
        const out = await svc.handleUserMessage(session, ASK);
        expect(out.reply?.senderType).toBe('ai');
        expect(out.pilotDenied).toBeUndefined();
        expect(ragAnswer).toHaveBeenCalled();
      }
    });

    it('the console preview sandbox and messenger channels are outside the rule', async () => {
      for (const channel of ['preview', 'zalo']) {
        session = guestSession({ channel });
        build({ pilotAccess: { ...ON, guestAllowed: false }, hotels: [] });
        const out = await svc.handleUserMessage(session, ASK);
        expect(out.reply?.senderType).toBe('ai');
        expect(out.pilotDenied).toBeUndefined();
      }
    });

    it('consent comes first: a hotel off the list that has not consented is pointed at the banner, not told "not available"', async () => {
      session = makeSession({ identityClaims: claims({ hotelSn: '3307' }), consentState: CONSENT_STATE.PENDING });
      build();
      const out = await svc.handleUserMessage(session, ASK);
      expect(out.pilotDenied).toBeUndefined();
      expect(out.reply?.body).not.toBe(PILOT_NOTICE.VI);
      expect(out.reply?.senderType).toBe('system');
    });
  });

  describe('a change to the list is live without the host re-identifying', () => {
    it('adding the hotel — the very next turn of the SAME session is served once the snapshot is dropped', async () => {
      session = makeSession({ identityClaims: claims({ hotelSn: '3307' }) });
      build();
      expect(await svc.handleUserMessage(session, ASK)).toMatchObject({ pilotDenied: true });

      fixture.hotels.push('3307');
      // Within the cache window the old answer stands...
      expect(await svc.handleUserMessage(session, ASK)).toMatchObject({ pilotDenied: true });
      // ...and the console's change drops the snapshot, so the next turn is served.
      await pilot.invalidate(1);
      const out = await svc.handleUserMessage(session, ASK);
      expect(out.reply?.senderType).toBe('ai');
      expect(session.identityClaims?.hotelSn).toBe('3307'); // the session itself never changed
    });

    it('removing the hotel stops it on the next turn after the same invalidation', async () => {
      session = makeSession();
      build();
      expect((await svc.handleUserMessage(session, ASK)).reply?.senderType).toBe('ai');
      fixture.hotels = fixture.hotels.filter((h) => h !== '1721');
      await pilot.invalidate(1);
      expect(await svc.handleUserMessage(session, ASK)).toMatchObject({ pilotDenied: true });
    });
  });

  describe('the "talk to an agent" path', () => {
    it('a hotel off the list does not page the support team — soft notice, nothing stored', async () => {
      session = makeSession({ identityClaims: claims({ hotelSn: '3307' }) });
      build();
      const out = await svc.escalate(session, 77);

      expect(out).toEqual({ escalated: false, choose: false, body: PILOT_NOTICE.VI, pilotDenied: true });
      expect(msgSave).not.toHaveBeenCalled();
      expect(route).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalledWith(EVENTS.ESCALATION, expect.anything());
    });

    it('a listed hotel still reaches a person', async () => {
      session = makeSession();
      build();
      const out = await svc.escalate(session, 77);
      expect(out).toMatchObject({ escalated: true, choose: false });
      expect(publish).toHaveBeenCalledWith(EVENTS.ESCALATION, expect.objectContaining({ conversationId: 77 }));
    });
  });

  describe('without the gate wired (the behaviour this feature must not change by itself)', () => {
    it('a service built without PilotService answers every hotel — a tenant that never opted in sees no difference', async () => {
      session = makeSession({ identityClaims: claims({ hotelSn: '3307' }) });
      build({ pilotAccess: ON }, false);
      const out = await svc.handleUserMessage(session, ASK);
      expect(out.reply?.senderType).toBe('ai');
      expect(out.pilotDenied).toBeUndefined();
    });
  });
});
