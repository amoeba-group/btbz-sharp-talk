import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { CONSENT_STATE, CONVERSATION_STATUS, MODERATION_DECISION } from '@sharptalk/types';
import { Repository } from 'typeorm';
import { CLAIMS_IAT_WINDOW_SEC, EmbedService } from './embed.service';
import { EmbedController } from './embed.controller';
import { EmbedIdentifyRequest } from './dto/request/embed.request';
import { ChatService } from '../chat/chat.service';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { RagService } from '../chat/rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import { CONSENT_NOTICE_VERSION, SessionService } from '../session/session.service';
import { EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  OTHER_TENANT_SECRET,
  TENANT_SECRET,
  buildEmbedHarness,
  guestSessionRow,
  matchesWhere,
  signedV1,
  signedV2,
} from './embed-test-doubles-spec';

/**
 * UAT Phase 4 — the security suite for the signed-identity handshake
 * (PLN-261012 §3.1 / §7, REQ D-02..D-05).
 *
 * Each block states the attack, then pins the answer. For every fix that closed a gap the
 * test was run WITHOUT the fix and failed (recorded in TCR-261013-s1b-identity-audit).
 */
const INVALID = { errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code };
const nowSec = () => Math.floor(Date.now() / 1000);

describe('iat window — future-dated, boundary, NaN, non-integer', () => {
  const T0 = Date.parse('2026-10-13T08:00:00.000Z');
  beforeEach(() => jest.useFakeTimers().setSystemTime(T0));
  afterEach(() => jest.useRealTimers());
  const at = (offsetSec: number) => Math.floor(T0 / 1000) + offsetSec;

  it('a future-dated iat beyond the window is refused (a signature pre-made for tomorrow)', async () => {
    const h = buildEmbedHarness();

    await expect(
      h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A', { iat: at(CLAIMS_IAT_WINDOW_SEC + 60) })),
    ).rejects.toMatchObject(INVALID);
    await expect(
      h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A', { iat: at(86_400) })),
    ).rejects.toMatchObject(INVALID);
    expect(h.customers).toHaveLength(0);
  });

  describe('the exact ±window boundary', () => {
    it.each([
      ['now - window (the last accepted second in the past)', -CLAIMS_IAT_WINDOW_SEC, true],
      ['now - window - 1', -CLAIMS_IAT_WINDOW_SEC - 1, false],
      ['now + window (the last accepted second in the future)', CLAIMS_IAT_WINDOW_SEC, true],
      ['now + window + 1', CLAIMS_IAT_WINDOW_SEC + 1, false],
      ['now', 0, true],
    ])('%s', async (_name, offset, accepted) => {
      const h = buildEmbedHarness();
      const attempt = h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A', { iat: at(offset) }));

      if (accepted) await expect(attempt).resolves.toMatchObject({ identityLevel: 'verified' });
      else await expect(attempt).rejects.toMatchObject(INVALID);
    });

    it('the window is 600 seconds — the contract the SDK guide promises hosts', () => {
      expect(CLAIMS_IAT_WINDOW_SEC).toBe(600);
    });
  });

  describe('iat that is not a whole number of seconds', () => {
    const forge = (iat: unknown) => {
      // A hash is computed for the iat as the attacker would present it, so the ONLY thing
      // standing in the way is the service's own check.
      const hash = EmbedService.signV2(TENANT_SECRET, 'staff-A', '1721', 'receptionist', iat as number);
      return { sessionToken: 'tok', userId: 'staff-A', hash, claims: { hotelSn: '1721', role: 'receptionist' as const, iat: iat as number } };
    };

    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['a fraction', at(0) + 0.5],
      ['a numeric string', String(at(0))],
      ['null', null],
      ['undefined', undefined],
      ['an object', {}],
      ['an exponent form', 1.7e9],
    ])('%s is refused even with a signature that matches it', async (_name, iat) => {
      const h = buildEmbedHarness();

      await expect(h.service.identify(forge(iat))).rejects.toMatchObject(INVALID);

      expect(h.customers).toHaveLength(0);
      expect(h.sessions[0]).toMatchObject({ customerId: null, identityLevel: 'guest' });
    });
  });
});

describe('a signature from the wrong place', () => {
  it('a hash signed with ANOTHER tenant\'s secret is refused (v2 and v1)', async () => {
    const h = buildEmbedHarness();

    await expect(h.service.identify(signedV2(OTHER_TENANT_SECRET, 'tok', 'staff-A'))).rejects.toMatchObject(INVALID);
    await expect(h.service.identify(signedV1(OTHER_TENANT_SECRET, 'tok', 'staff-A'))).rejects.toMatchObject(INVALID);

    expect(h.customers).toHaveLength(0);
  });

  it('the same body signed with this tenant\'s secret IS accepted — the refusal is about the secret, nothing else', async () => {
    const h = buildEmbedHarness();

    await expect(h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'))).resolves.toMatchObject({ customerId: 100 });
  });

  it('claims presented under a v1 hash are refused outright, never "unsigned but displayed"', async () => {
    const h = buildEmbedHarness();
    const v1 = signedV1(TENANT_SECRET, 'tok', 'staff-A');

    await expect(
      h.service.identify({ ...v1, claims: { hotelSn: '1721', role: 'manager', iat: nowSec() } }),
    ).rejects.toMatchObject(INVALID);
    expect(h.sessions[0].identityClaims).toBeNull();
  });
});

describe('DTO tampering (the HTTP edge, run through the same ValidationPipe the app installs)', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });
  const meta = { type: 'body' as const, metatype: EmbedIdentifyRequest };
  const body = (over: Record<string, unknown> = {}, claimsOver: Record<string, unknown> = {}) => ({
    session_token: 'tok',
    user_id: 'staff-A',
    hash: 'a'.repeat(64),
    claims: { hotel_sn: '1721', role: 'receptionist', iat: nowSec(), ...claimsOver },
    ...over,
  });
  const accepts = (b: unknown) => expect(pipe.transform(b, meta)).resolves.toBeDefined();
  const rejects = (b: unknown) => expect(pipe.transform(b, meta)).rejects.toBeDefined();

  it('a well-formed v2 body passes (so the cases below fail for the reason they claim)', async () => {
    await accepts(body());
  });

  describe('role is a closed enum', () => {
    it.each(['admin', 'owner', 'MANAGER', 'Manager', 'receptionist ', '', 'manager|1', 'internal;drop'])('%j is refused', async (role) => {
      await rejects(body({}, { role }));
    });

    it.each(['manager', 'receptionist', 'internal'])('%s is accepted', async (role) => {
      await accepts(body({}, { role }));
    });

    it('a non-string role is refused', async () => {
      await rejects(body({}, { role: 1 }));
      await rejects(body({}, { role: ['manager'] }));
      await rejects(body({}, { role: { $ne: 'x' } }));
    });
  });

  describe('hotel_sn is capped at the stored width (32)', () => {
    it('32 characters pass, 33 do not', async () => {
      await accepts(body({}, { hotel_sn: 'h'.repeat(32) }));
      await rejects(body({}, { hotel_sn: 'h'.repeat(33) }));
    });

    it('a megabyte of hotel_sn is refused, not truncated or stored', async () => {
      await rejects(body({}, { hotel_sn: 'h'.repeat(1_000_000) }));
    });

    it('must be a string: a number, an array or null is refused', async () => {
      await rejects(body({}, { hotel_sn: 1721 }));
      await rejects(body({}, { hotel_sn: ['1721'] }));
      await rejects(body({}, { hotel_sn: null }));
    });

    it('is required', async () => {
      const b = body();
      delete (b.claims as Record<string, unknown>).hotel_sn;
      await rejects(b);
    });
  });

  describe('the other signed and unsigned fields keep their caps', () => {
    it('iat must be a whole number', async () => {
      await rejects(body({}, { iat: 1.5 }));
      await rejects(body({}, { iat: 'now' }));
      await rejects(body({}, { iat: null }));
    });

    it('hash <= 128, user_id <= 120, province <= 64, hotel_name <= 200, hotel_code <= 64', async () => {
      await rejects(body({ hash: 'a'.repeat(129) }));
      await rejects(body({ user_id: 'u'.repeat(121) }));
      await rejects(body({}, { province: 'p'.repeat(65) }));
      await rejects(body({}, { hotel_name: 'n'.repeat(201) }));
      await rejects(body({}, { hotel_code: 'c'.repeat(65) }));
      await accepts(body({ hash: 'a'.repeat(128), user_id: 'u'.repeat(120) }, { province: 'p'.repeat(64), hotel_name: 'n'.repeat(200), hotel_code: 'c'.repeat(64) }));
    });

    it('the session token and hash are required strings', async () => {
      await rejects(body({ session_token: undefined }));
      await rejects(body({ session_token: 42 }));
      await rejects(body({ hash: undefined }));
    });
  });

  it('unknown claim fields are dropped by the whitelist, never forwarded to the service', async () => {
    const parsed = (await pipe.transform(body({}, { signed: true, verified_at: '2020-01-01', customer_id: 99 }), meta)) as EmbedIdentifyRequest;

    expect(parsed.claims).not.toHaveProperty('signed');
    expect(parsed.claims).not.toHaveProperty('verified_at');
    expect(parsed.claims).not.toHaveProperty('customer_id');
  });
});

describe('identify and logout are throttled (20 per minute per caller)', () => {
  it.each(['identify', 'logout'] as const)('%s carries the 20/60 s limit', (route) => {
    const handler = EmbedController.prototype[route];

    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(20);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(60_000);
  });
});

describe('EMBED_ORIGIN_ENFORCE at ensure() (the page that may hold a widget session)', () => {
  const tenant = { id: 1, shopDomain: 'go2joy.example', embedOrigins: ['https://hotel-admin.go2joy.example'], status: 'active', timezone: 'Asia/Ho_Chi_Minh', defaultLanguage: 'vi', widgetAccess: null };
  const build = () => {
    const sessionRepo = { findOne: jest.fn(async () => null), create: jest.fn((v) => v), save: jest.fn(async (s) => ({ id: 1, ...s })) };
    const svc = new SessionService(
      sessionRepo as unknown as Repository<Session>,
      { findOne: jest.fn(async () => tenant), findAndCount: jest.fn(async () => [[tenant], 1]) } as unknown as Repository<Tenant>,
      { findOne: jest.fn(async () => null) } as never,
      { publish: jest.fn() } as unknown as EventBusService,
      { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService,
    );
    return { svc, sessionRepo };
  };
  const ensure = (svc: SessionService, origin?: string) => svc.ensure(undefined, 'vi', 'go2joy.example', origin);
  let before: string | undefined;
  beforeEach(() => {
    before = process.env.EMBED_ORIGIN_ENFORCE;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.EMBED_ORIGIN_ENFORCE;
    else process.env.EMBED_ORIGIN_ENFORCE = before;
  });

  it('enforcing: an origin the tenant never allowed gets E5047 (403) and no session row', async () => {
    process.env.EMBED_ORIGIN_ENFORCE = 'true';
    const h = build();

    await expect(ensure(h.svc, 'https://evil.example')).rejects.toMatchObject({
      errorCode: ERROR_CODE.EMBED_ORIGIN_NOT_ALLOWED.code,
      status: 403,
    });
    expect(h.sessionRepo.save).not.toHaveBeenCalled();
  });

  it('enforcing: lookalikes are refused too (suffix, prefix, scheme and userinfo tricks)', async () => {
    process.env.EMBED_ORIGIN_ENFORCE = 'true';
    for (const origin of [
      'https://hotel-admin.go2joy.example.evil.example',
      'https://evilhotel-admin.go2joy.example',
      'http://hotel-admin.go2joy.example',
      'https://hotel-admin.go2joy.example@evil.example',
    ]) {
      await expect(ensure(build().svc, origin)).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_ORIGIN_NOT_ALLOWED.code });
    }
  });

  it('enforcing: the allowed origin gets its session', async () => {
    process.env.EMBED_ORIGIN_ENFORCE = 'true';
    const h = build();

    await expect(ensure(h.svc, 'https://hotel-admin.go2joy.example')).resolves.toMatchObject({ tenantId: 1 });
    expect(h.sessionRepo.save).toHaveBeenCalled();
  });

  it('enforcing: an older loader that reports NO origin still passes (the documented softening)', async () => {
    process.env.EMBED_ORIGIN_ENFORCE = 'true';

    await expect(ensure(build().svc, undefined)).resolves.toBeDefined();
  });

  it('observe mode (the default): the same bad origin is logged and allowed — nothing breaks on deploy', async () => {
    delete process.env.EMBED_ORIGIN_ENFORCE;

    await expect(ensure(build().svc, 'https://evil.example')).resolves.toBeDefined();
    process.env.EMBED_ORIGIN_ENFORCE = 'false';
    await expect(ensure(build().svc, 'https://evil.example')).resolves.toBeDefined();
  });
});

describe('cross-hotel isolation after a fork — what the poll returns, what the prompt contains', () => {
  /**
   * The real EmbedService forks; the real ChatService answers; both read the SAME in-memory
   * stores. The property: hotel 2204's visitor can never be shown, or have the model shown,
   * anything from hotel 1721's thread — and the old token keeps seeing only its own.
   */
  function world() {
    const h = buildEmbedHarness({ sessions: [guestSessionRow({ id: 5, sessionToken: 'tok' })] });
    const messages: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    let nextConv = 1;
    let nextMsg = 1;

    const convRepo = {
      findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...h.conversations].reverse().find((c) => matchesWhere(c, where)) ?? null,
      ),
      save: jest.fn(async (c: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!c.id) {
          c.id = nextConv++;
          c.tenantId = 4;
          h.conversations.push(c);
        }
        return c;
      }),
      create: (c: Record<string, unknown>) => c,
      update: h.convRepo.update,
    } as unknown as Repository<Conversation>;
    const msgRepo = {
      save: jest.fn(async (m: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const row = { ...m, id: nextMsg++ };
        messages.push(row);
        return row;
      }),
      create: (m: Record<string, unknown>) => m,
      update: jest.fn(),
      find: jest.fn(async ({ where, take }: { where: Record<string, any>; take?: number }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const rows = messages
          .filter((m) => m.conversationId === where.conversationId)
          // The history read narrows by sender and by id; the poll read does neither.
          .filter((m) => !where.senderType || where.senderType.value.includes(m.senderType))
          .filter((m) => !where.id || m.id < where.id.value)
          .sort((a, b) => b.id - a.id);
        return take ? rows.slice(0, take) : rows;
      }),
      findOne: jest.fn(async () => null),
    } as unknown as Repository<Message>;

    // The session table as ChatService / SessionService see it (by id for consent reads).
    const sessionRepoForSessions = {
      findOne: jest.fn(async ({ where }: { where: { id?: number; sessionToken?: string } }) =>
        h.sessions.find((s) => (where.id != null ? s.id === where.id : s.sessionToken === where.sessionToken)) ?? null,
      ),
      save: jest.fn(async (s: Session) => s),
    } as unknown as Repository<Session>;
    const tenantRepo = {
      findOne: jest.fn(async () => ({ id: 4, commerceEnabled: 1, privacyPolicyUrl: null, consentNoticeVersion: null, identityPolicy: null }) as unknown as Tenant),
    } as unknown as Repository<Tenant>;
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const bus = { publish: jest.fn() } as unknown as EventBusService;
    const sessionService = new SessionService(sessionRepoForSessions, tenantRepo, { findOne: jest.fn(async () => null) } as never, bus, redis);

    const ragAnswer = jest.fn(async () => ({ text: 'secret answer for the hotel that asked', confidence: 0.9, citations: [{ id: 1, title: 'doc' }] }));
    const chat = new ChatService(
      convRepo,
      msgRepo,
      sessionRepoForSessions,
      tenantRepo,
      { find: jest.fn(async () => []) } as unknown as Repository<User>,
      { update: jest.fn() } as never,
      {
        classifyIntent: jest.fn(async () => ({ intent: 'general_inquiry', needsOrderData: false, confidence: 0.9 })),
        answer: ragAnswer,
        effectiveAgentId: jest.fn(async () => 9),
        agentGuestPolicy: jest.fn(async () => 'open'),
        groundingConfidence: jest.fn(async () => 0.9),
        guestGuidance: jest.fn(async () => null),
      } as unknown as RagService,
      { moderate: jest.fn(async ({ text }: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text })) } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      sessionService,
      { route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })), denyMatch: jest.fn(async () => null), teamQuestion: jest.fn(async () => null), regionLookup: jest.fn(async () => ({ region: null, unmapped: null })) } as unknown as HandoffRouterService,
      bus,
    );
    return { h, chat, ragAnswer, messages };
  }

  /** What `answer()` was given as conversation history on its Nth call. */
  const historyOf = (ragAnswer: jest.Mock, call: number) => (ragAnswer.mock.calls[call] as unknown[])[8] as Array<{ content: string }>;
  const optsOf = (ragAnswer: jest.Mock, call: number) => {
    const args = ragAnswer.mock.calls[call] as unknown[];
    return args[args.length - 1] as { partnerContext?: string };
  };

  async function aliceThenBob() {
    const w = world();
    const alice = (await w.h.service.identify(signedV2(TENANT_SECRET, 'tok', 'alice', { hotelSn: '1721' }))) as Session;
    // Alice consents (the notice was accepted on this session) and asks about hotel 1721.
    await w.chat.handleUserMessage(alice, 'Alice asks: what is the reconciliation deadline for hotel 1721?');
    const bob = (await w.h.service.identify(signedV2(TENANT_SECRET, 'tok', 'bob', { hotelSn: '2204' }))) as Session;
    return { ...w, alice, bob };
  }

  it('the fork is a different session, so Bob\'s poll starts empty — Alice\'s thread is not reachable from his token', async () => {
    const w = await aliceThenBob();

    expect(w.bob.sessionToken).not.toBe(w.alice.sessionToken);
    // The widget poll is `findLatestConversation(session.id)` — keyed on the session.
    expect(await w.chat.findLatestConversation(w.bob.id)).toBeNull();
    expect((await w.chat.findLatestConversation(w.alice.id))?.id).toBe(1);
  });

  it('Bob is not processed on Alice\'s consent: his first message is held back until HE accepts the notice', async () => {
    const w = await aliceThenBob();
    expect(w.bob.consentState).toBe(CONSENT_STATE.PENDING);

    const res = await w.chat.handleUserMessage(w.bob, 'Bob asks something');

    expect(res.reply?.senderType).toBe('system');
    expect(w.ragAnswer).toHaveBeenCalledTimes(1); // Alice's turn only
    expect(await w.chat.findLatestConversation(w.bob.id)).toBeNull();
  });

  it('once Bob consents, the prompt carries NONE of Alice\'s thread and names HIS hotel, not hers', async () => {
    const w = await aliceThenBob();
    Object.assign(w.h.sessions.find((s) => s.id === w.bob.id)!, {
      consentState: CONSENT_STATE.GRANTED,
      consentAt: new Date(),
      consentVersion: CONSENT_NOTICE_VERSION,
    });

    await w.chat.handleUserMessage(w.bob, 'Bob asks: and what about checkout?');

    const history = historyOf(w.ragAnswer, 1);
    const prompt = JSON.stringify(history);
    expect(prompt).not.toContain('Alice');
    expect(prompt).not.toContain('reconciliation');
    expect(prompt).not.toContain('secret answer');
    const partner = optsOf(w.ragAnswer, 1).partnerContext ?? '';
    expect(partner).toContain('hotelSn 2204');
    expect(partner).not.toContain('hotelSn 1721');
  });

  it('after the fork Bob\'s conversation is his own and stamped with his hotel; Alice\'s keeps hers', async () => {
    const w = await aliceThenBob();
    Object.assign(w.h.sessions.find((s) => s.id === w.bob.id)!, { consentState: CONSENT_STATE.GRANTED, consentAt: new Date(), consentVersion: CONSENT_NOTICE_VERSION });

    await w.chat.handleUserMessage(w.bob, 'Bob asks something');

    const [aliceConv, bobConv] = w.h.conversations;
    expect(aliceConv).toMatchObject({ sessionId: w.alice.id, hotelSn: '1721', actorRole: 'receptionist' });
    expect(bobConv).toMatchObject({ sessionId: w.bob.id, hotelSn: '2204', actorRole: 'receptionist' });
    expect(aliceConv.id).not.toBe(bobConv.id);
    // Nothing of Bob's ever landed in Alice's thread.
    expect(w.messages.filter((m) => m.conversationId === aliceConv.id).every((m) => !String(m.body).includes('Bob'))).toBe(true);
  });

  it('the old token keeps seeing only Alice\'s conversation after the fork', async () => {
    const w = await aliceThenBob();

    const old = await w.chat.findLatestConversation(w.alice.id);
    const oldMessages = await w.chat.listMessages(Number(old!.id));

    expect(oldMessages.length).toBeGreaterThan(0);
    expect(oldMessages.every((m) => m.conversationId === old!.id)).toBe(true);
    expect(JSON.stringify(oldMessages)).not.toContain('Bob');
  });

  it('the same person switching hotel gets a clean thread too (their consent is kept, their old hotel\'s history is not)', async () => {
    const w = world();
    const mgr1 = (await w.h.service.identify(signedV2(TENANT_SECRET, 'tok', 'mgr', { hotelSn: '1721', role: 'manager' }))) as Session;
    await w.chat.handleUserMessage(mgr1, 'Manager asks about hotel 1721 payouts');
    const mgr2 = (await w.h.service.identify(signedV2(TENANT_SECRET, 'tok', 'mgr', { hotelSn: '2204', role: 'manager' }))) as Session;
    expect(mgr2.consentState).toBe(CONSENT_STATE.GRANTED); // same data subject

    await w.chat.handleUserMessage(mgr2, 'Manager asks about hotel 2204 payouts');

    expect(JSON.stringify(historyOf(w.ragAnswer, 1))).not.toContain('1721');
    expect(optsOf(w.ragAnswer, 1).partnerContext).toContain('hotelSn 2204');
  });

  it('an expired claim stops naming the hotel in the prompt (no stale partner context survives a night)', async () => {
    const w = world();
    const alice = (await w.h.service.identify(signedV2(TENANT_SECRET, 'tok', 'alice', { hotelSn: '1721' }))) as Session;
    // Nine hours later.
    const row = w.h.sessions.find((s) => s.id === alice.id)!;
    row.identityClaims = { ...row.identityClaims, verifiedAt: new Date(Date.now() - 9 * 3_600_000).toISOString() };

    await w.chat.handleUserMessage(row as Session, 'still there?');

    expect(optsOf(w.ragAnswer, 0).partnerContext).toBeUndefined();
    expect(CONVERSATION_STATUS.AI_ACTIVE).toBe(w.h.conversations[0].status);
    expect(w.h.conversations[0]).toMatchObject({ hotelSn: null, actorRole: null });
  });
});
