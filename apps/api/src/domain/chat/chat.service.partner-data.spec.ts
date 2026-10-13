import { Repository } from 'typeorm';
import { CONSENT_STATE, CONVERSATION_STATUS, MODERATION_DECISION } from '@sharptalk/types';
import type { IdentityClaims } from '@sharptalk/types';
import { ChatService } from './chat.service';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { RagService } from './rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { AnswerReuseService } from '../answer-reuse/answer-reuse.service';
import { CONSENT_NOTICE_VERSION, SessionService } from '../session/session.service';
import { EVENTS, EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { MockGo2JoyClient } from '../partner-data/mock-go2joy.client';
import { PartnerDataService } from '../partner-data/partner-data.service';
import { PartnerDataStep } from '../partner-data/partner-data.step';
import type { PartnerFlagService } from '../partner-data/partner-flag.service';
import type { PartnerLookupLogService } from '../partner-data/partner-lookup-log.service';
import { DEFAULT_MOCK_SET } from '../partner-data/fixtures/mock-set-default';

/**
 * Partner data inside handleUserMessage (PLN-261012 SG-31). A signed-in hotel
 * user's rate / booking / settlement question is grounded in server-built data;
 * these pin what must hold around it: reuse is bypassed at BOTH sites, evidence
 * never reaches `citations`, long ids survive the PII mask, an invented number
 * withholds the answer, and a tenant without the feature sees no change at all.
 */
describe('ChatService — partner data', () => {
  const NOW = Date.parse('2026-10-13T02:00:00.000Z'); // Tuesday 09:00 +07:00
  // The detector and the claims check read Date.now(): pin it so "this weekend" and claim age are stable.
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  const KB_CITATIONS = [{ id: 3340, title: 'Chính sách hủy phòng', category: 'Policy', snippet: 'Hoàn tiền trong 7 ngày làm việc.', similarity: 0.8 }];

  const claims = (over: Partial<IdentityClaims> = {}): IdentityClaims => ({
    hotelSn: '1721',
    role: 'manager',
    hotelName: 'A In Hotel Del Luna',
    signed: true,
    verifiedAt: new Date(NOW - 60_000).toISOString(),
    ...over,
  });

  interface BuildOpts {
    claims?: IdentityClaims | null;
    stepOn?: boolean; // false = the step exists but the feature is off
    noStep?: boolean; // true = a ChatService built without the step at all (a spec that predates it)
    answerText?: string;
    reuseHit?: boolean;
    status?: string;
    /** What the (shop-centric) classifier says; default a neutral `other`. */
    intent?: string;
    /** How well the knowledge base grounds the message (retrieval only). */
    grounding?: number;
  }

  const build = (opts: BuildOpts = {}) => {
    const session = {
      id: 5,
      sessionToken: 'tok-5',
      tenantId: 1,
      customerId: null,
      identityLevel: 'verified',
      language: 'VI',
      languageLocked: 1,
      consentState: CONSENT_STATE.GRANTED,
      consentAt: new Date(),
      consentVersion: CONSENT_NOTICE_VERSION,
      identityClaims: opts.claims === undefined ? claims() : opts.claims,
    } as unknown as Session;
    const conversation = { id: 77, sessionId: 5, tenantId: 1, status: opts.status ?? CONVERSATION_STATUS.AI_ACTIVE } as Conversation;

    const saved: Array<Partial<Message>> = [];
    let nextId = 100;
    const msgRepo = {
      save: jest.fn(async (m: Partial<Message>) => {
        const row = { ...m, id: nextId++ };
        saved.push(row);
        return row;
      }),
      create: (m: Partial<Message>) => m,
      update: jest.fn(),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
    } as unknown as Repository<Message>;
    const convRepo = {
      findOne: jest.fn(async () => conversation),
      save: jest.fn(async (c: Conversation) => c),
      create: (c: Partial<Conversation>) => c,
      update: jest.fn(),
      findOneOrFail: jest.fn(async () => conversation),
    } as unknown as Repository<Conversation>;
    const sessionRepo = { findOne: jest.fn(async () => session), save: jest.fn(async (s: Session) => s) } as unknown as Repository<Session>;
    const tenantRepo = {
      findOne: jest.fn(async () => ({ id: 1, privacyPolicyUrl: null, consentNoticeVersion: null, commerceEnabled: 0 }) as Tenant),
    } as unknown as Repository<Tenant>;
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const bus = { publish: jest.fn() } as unknown as EventBusService;

    const rag = {
      classifyIntent: jest.fn(async () => ({ intent: opts.intent ?? 'other', needsOrderData: false, confidence: opts.intent ? 0.9 : 0.8 })),
      answer: jest.fn(async () => ({ text: opts.answerText ?? 'Giá qua đêm phòng Deluxe là 425.000 ₫.', confidence: 0.9, citations: KB_CITATIONS })),
      answerWithoutKnowledge: jest.fn(async () => 'Xin chào!'),
      groundingConfidence: jest.fn(async () => opts.grounding ?? 0.9),
      footerConfig: jest.fn(async () => null),
      effectiveAgentId: jest.fn(async () => null),
      agentGuestPolicy: jest.fn(async () => 'open'),
    };
    const moderate = jest.fn(async (p: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text: p.text }));
    const answerReuse = {
      lookup: jest.fn(async () => (opts.reuseHit ? { reuseId: 9, text: 'Câu trả lời cũ của khách sạn khác: 999.999 ₫', confidence: 0.9, citations: [] } : null)),
      recordAiAnswer: jest.fn(),
      recordHit: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as AnswerReuseService;

    const record = jest.fn(async (_e: unknown) => undefined);
    const logs = { record } as unknown as PartnerLookupLogService;
    const flags = { serverEnabled: () => opts.stepOn !== false, isEnabled: async () => opts.stepOn !== false } as unknown as PartnerFlagService;
    const step = new PartnerDataStep(flags, new PartnerDataService(new MockGo2JoyClient(DEFAULT_MOCK_SET, () => NOW), logs), logs);
    const resolve = jest.spyOn(PartnerDataService.prototype, 'resolve');

    const svc = new ChatService(
      convRepo,
      msgRepo,
      sessionRepo,
      tenantRepo,
      { find: jest.fn(async () => []) } as unknown as Repository<User>,
      { update: jest.fn() } as never,
      rag as unknown as RagService,
      { moderate } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      new SessionService(sessionRepo, tenantRepo, bus, redis),
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () => null),
        teamQuestion: jest.fn(async () => null),
        regionLookup: jest.fn(async () => ({ region: null, unmapped: null })),
      } as never,
      bus,
      {} as never,
      redis,
      answerReuse,
      undefined, // issueService
      undefined, // statRepo
      undefined, // attachments
      opts.noStep ? undefined : step,
    );
    return { svc, session, saved, rag, moderate, answerReuse, bus, record, resolve, convRepo };
  };

  const aiTurn = (saved: Array<Partial<Message>>) => saved.find((m) => m.senderType === 'ai');
  const traceOf = (m: Partial<Message> | undefined) => (m?.retrievalTrace ?? {}) as Record<string, unknown>;

  describe('a partner-data answer', () => {
    it('grounds the model in the server-built block (hotel from the claims) and delivers the answer', async () => {
      const b = build();
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');

      expect(res.reply?.senderType).toBe('ai');
      expect(res.reply?.body).toContain('425.000 ₫');
      expect(b.rag.answer).toHaveBeenCalledTimes(1);
      const opts = b.rag.answer.mock.calls[0][9] as { partnerData?: string; guestOnly: boolean; partnerContext?: string };
      expect(opts.partnerData).toContain('hotel 1721, role manager');
      expect(opts.partnerData).toContain('final 425.000 ₫');
      expect(opts.partnerContext).toContain('hotelSn 1721');
    });

    it('records the evidence on the trace as `partnerEvidence` — and NEVER in `citations`', async () => {
      const b = build();
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');

      const trace = traceOf(aiTurn(b.saved));
      expect(trace.answeredFrom).toBe('partner_data');
      expect(trace.partnerEvidence).toEqual([
        expect.objectContaining({ topic: 'rates', hotelSn: '1721', role: 'manager', source: 'mock', itemCount: 1 }),
      ]);
      expect((trace.partnerEvidence as Array<{ snapshotHash: string }>)[0].snapshotHash).toMatch(/^[0-9a-f]{64}$/);
      // citations are exactly the knowledge-base ones the model used — nothing from the partner
      expect(trace.citations).toEqual(KB_CITATIONS);
      expect(JSON.stringify(trace.citations)).not.toMatch(/partner|1721|snapshot|evidence/i);
      // what the widget receives: KB citations only, and no evidence field at all
      expect(res.reply?.citations).toEqual(KB_CITATIONS);
      expect(JSON.stringify(res.reply)).not.toMatch(/partnerEvidence|snapshotHash/);
    });

    it('shields the block\'s ids and amounts from the PII masks for this call only', async () => {
      const b = build({ answerText: 'Đặt phòng 2610140000123456 đã hủy, giá 300.000 ₫.' });
      await b.svc.handleUserMessage(b.session, 'Tra cứu đặt phòng 2610140000123456');

      expect(b.moderate).toHaveBeenCalledTimes(1);
      const input = b.moderate.mock.calls[0][0] as { protect?: string[] };
      expect(input.protect).toContain('2610140000123456'); // 16 digits: the default mask rule would eat it
      expect(input.protect).toContain('300.000 ₫');
    });

    it('uses a confidence the escalation threshold respects (answer delivered, not handed off)', async () => {
      const b = build();
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');
      expect(res.escalate).toBe(false);
    });
  });

  describe('answer reuse is bypassed at BOTH sites', () => {
    it('lookup: never replays a stored answer for a partner-data turn, even when one matches', async () => {
      const b = build({ reuseHit: true });
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');

      expect(b.answerReuse.lookup).not.toHaveBeenCalled();
      expect(b.rag.answer).toHaveBeenCalledTimes(1); // answered fresh from the data
      expect(res.reply?.body).not.toContain('999.999');
      expect(traceOf(aiTurn(b.saved)).answeredFrom).toBe('partner_data');
    });

    it('record: never stores a partner-data answer for other hotels to replay', async () => {
      const b = build();
      await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');
      expect(b.answerReuse.recordAiAnswer).not.toHaveBeenCalled();
    });

    it('control: an ordinary question by the same user still uses the reuse store both ways', async () => {
      const b = build({ reuseHit: true });
      const hit = await b.svc.handleUserMessage(b.session, 'Làm sao để đăng ký làm đối tác?');
      expect(b.answerReuse.lookup).toHaveBeenCalledTimes(1);
      expect(hit.reply?.body).toContain('Câu trả lời cũ');

      const miss = build();
      await miss.svc.handleUserMessage(miss.session, 'Làm sao để đăng ký làm đối tác?');
      expect(miss.answerReuse.lookup).toHaveBeenCalledTimes(1);
      expect(miss.answerReuse.recordAiAnswer).toHaveBeenCalledTimes(1);
    });
  });

  describe('number verification', () => {
    it('withholds an answer whose number the data block does not hold: notice + hand-off, the invented figure never delivered', async () => {
      const b = build({ answerText: 'Giá qua đêm phòng Deluxe là 480.000 ₫.' }); // the data says 425.000
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');

      expect(res.escalate).toBe(true);
      expect(res.reply?.senderType).toBe('system');
      expect(res.reply?.body).toContain('Tôi chưa xác nhận được các số liệu');
      expect(JSON.stringify(res)).not.toContain('480.000');
      // no AI turn with the invented figure was persisted
      expect(aiTurn(b.saved)).toBeUndefined();
      expect(b.saved.map((m) => m.body).join('\n')).not.toContain('480.000');
      // the notice carries the error on its trace; the escalation event is a normal low-confidence page
      const notice = b.saved.find((m) => m.senderType === 'system');
      expect(traceOf(notice)).toMatchObject({ reason: 'partner_unverified', partnerError: 'E5107' });
      expect(b.bus.publish).toHaveBeenCalledWith(EVENTS.ESCALATION, expect.objectContaining({ reason: 'low_confidence', conversationId: 77 }));
      expect(b.answerReuse.recordAiAnswer).not.toHaveBeenCalled();
      // and the lookup log says it
      expect(b.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'unverified', errorCode: 'E5107' }));
    });

    it('does not page a thread that is already queued — it still tells the customer', async () => {
      const b = build({ answerText: 'Giá là 480.000 ₫.', status: CONVERSATION_STATUS.WAITING });
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');
      expect(res.escalate).toBe(false);
      expect(res.reply?.body).toContain('Tôi chưa xác nhận được các số liệu');
      expect(b.bus.publish).not.toHaveBeenCalledWith(EVENTS.ESCALATION, expect.anything());
    });
  });

  describe('refusals and degradations never reach the model', () => {
    it('a receptionist asking for settlement gets the manager-only notice: no model call, no hand-off', async () => {
      const b = build({ claims: claims({ role: 'receptionist' }) });
      const res = await b.svc.handleUserMessage(b.session, 'Đối soát tháng 9 còn bao nhiêu chưa thanh toán?');

      expect(res.reply?.senderType).toBe('system');
      expect(res.reply?.body).toContain('Quản lý');
      expect(res.escalate).toBe(false);
      expect(b.rag.answer).not.toHaveBeenCalled();
      expect(b.answerReuse.lookup).not.toHaveBeenCalled();
      expect(traceOf(b.saved.find((m) => m.senderType === 'system'))).toMatchObject({ reason: 'partner_role_denied', partnerError: 'E5101' });
      expect(b.bus.publish).not.toHaveBeenCalledWith(EVENTS.ESCALATION, expect.anything());
    });

    it('expired claims: "sign in again", nothing fetched', async () => {
      const b = build({ claims: claims({ verifiedAt: new Date(NOW - 9 * 3600_000).toISOString() }) });
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');
      expect(res.reply?.body).toContain('đăng nhập lại');
      expect(b.rag.answer).not.toHaveBeenCalled();
      expect(b.resolve).not.toHaveBeenCalled();
    });

    it('a question naming another hotel: refused, nothing fetched for either hotel', async () => {
      const b = build();
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm khách sạn 2204 hôm nay?');
      expect(res.reply?.body).toContain('chỉ tra cứu được dữ liệu của khách sạn bạn đang đăng nhập');
      expect(b.rag.answer).not.toHaveBeenCalled();
      expect(b.resolve).not.toHaveBeenCalled();
    });
  });

  describe('a classifier that calls the question "out of scope"', () => {
    // The classifier assumes a shop; "giá qua đêm phòng Deluxe?" can come back out_of_scope with nothing in the
    // knowledge base to rescue it. A partner-data question must still reach the partner step.
    it('does not stop a partner-data question: it is answered from the hotel data', async () => {
      const b = build({ intent: 'out_of_scope', grounding: 0.2 });
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');

      expect(b.rag.answerWithoutKnowledge).not.toHaveBeenCalled();
      expect(b.rag.answer).toHaveBeenCalledTimes(1);
      expect(res.reply?.body).toContain('425.000 ₫');
      expect(traceOf(aiTurn(b.saved)).answeredFrom).toBe('partner_data');
    });

    it('control: without the step the same message is declined as before', async () => {
      const b = build({ intent: 'out_of_scope', grounding: 0.2, noStep: true });
      await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');
      expect(b.rag.answerWithoutKnowledge).toHaveBeenCalledTimes(1);
      expect(b.rag.answer).not.toHaveBeenCalled();
    });

    it('control: a genuinely off-topic message from the same user is still declined', async () => {
      const b = build({ intent: 'out_of_scope', grounding: 0.2 });
      await b.svc.handleUserMessage(b.session, 'Thời tiết hôm nay thế nào?');
      expect(b.rag.answerWithoutKnowledge).toHaveBeenCalledTimes(1);
      expect(b.rag.answer).not.toHaveBeenCalled();
    });

    it('control: with the feature off it is declined as before', async () => {
      const b = build({ intent: 'out_of_scope', grounding: 0.2, stepOn: false });
      await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');
      expect(b.rag.answerWithoutKnowledge).toHaveBeenCalledTimes(1);
    });
  });

  describe('a tenant (or session) without the feature sees no change at all', () => {
    const optsOf = (b: ReturnType<typeof build>) => b.rag.answer.mock.calls[0][9] as Record<string, unknown>;

    it('feature off: the model gets no partner block, moderation no protect list, reuse works as before', async () => {
      const b = build({ stepOn: false });
      await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');

      expect(Object.keys(optsOf(b)).sort()).toEqual(['guestOnly', 'partnerContext']); // no partnerData key at all
      expect(b.moderate.mock.calls[0][0]).not.toHaveProperty('protect');
      expect(b.answerReuse.lookup).toHaveBeenCalledTimes(1);
      expect(b.answerReuse.recordAiAnswer).toHaveBeenCalledTimes(1);
      expect(traceOf(aiTurn(b.saved))).not.toHaveProperty('partnerEvidence');
      expect(traceOf(aiTurn(b.saved)).answeredFrom).toBeUndefined();
      expect(b.resolve).not.toHaveBeenCalled();
    });

    it('a ChatService built without the step (every spec that predates it) is unchanged', async () => {
      const b = build({ noStep: true });
      const res = await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');
      expect(res.reply?.senderType).toBe('ai');
      expect(Object.keys(optsOf(b)).sort()).toEqual(['guestOnly', 'partnerContext']);
      expect(b.answerReuse.lookup).toHaveBeenCalledTimes(1);
    });

    it('a guest asking the same question is answered the ordinary (knowledge) way', async () => {
      const b = build({ claims: null });
      await b.svc.handleUserMessage(b.session, 'Giá qua đêm phòng Deluxe hôm nay?');
      expect(Object.keys(optsOf(b)).sort()).toEqual(['guestOnly', 'partnerContext']);
      expect(b.resolve).not.toHaveBeenCalled();
    });
  });
});
