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
import { buildChain, claimsOf, toolsEnv } from '../partner-data/testing/tools-harness';
import {
  FakeAnthropicServer,
  endTurn,
  fakeToolUse,
  toolCalls,
} from '../../infrastructure/external/ai/testing/fake-anthropic.server';
import type { FakeReply, FakeRequest } from '../../infrastructure/external/ai/testing/fake-anthropic.server';

/**
 * PLN-261012 SG-33 — tools mode inside handleUserMessage. The step is the REAL one wired to the real
 * loop / gateway / Anthropic adapter against the local fake Messages API; the rest of the turn (RAG
 * generation, moderation, reuse store, persistence) is the production ChatService with test doubles at
 * its edges. What must hold with a model choosing the lookups: moderation exactly once on the FINAL
 * text with a protect list covering EVERY tool result, no answer reuse for a turn that ran a tool,
 * evidence on the trace (never in `citations`), and a figure no tool returned never reaches the customer.
 */
describe('ChatService — partner data in tools mode (SG-33)', () => {
  let fake: FakeAnthropicServer;
  let restoreEnv: () => void;

  beforeAll(async () => {
    fake = await new FakeAnthropicServer(() => endTurn()).start();
  });
  afterAll(() => fake.stop());
  beforeEach(() => {
    restoreEnv = toolsEnv();
    fake.requests.length = 0;
    fake.setScript(() => endTurn());
  });
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  const seq = (...replies: FakeReply[]) => (req: FakeRequest) => replies[req.n - 1] ?? endTurn();
  const KB_CITATIONS = [{ id: 3340, title: 'Chính sách hủy phòng', category: 'Policy', snippet: 'Hoàn tiền trong 7 ngày làm việc.', similarity: 0.8 }];

  interface BuildOpts {
    claims?: IdentityClaims | null;
    answerText?: string;
    reuseHit?: boolean;
    chain?: Parameters<typeof buildChain>[0];
    historyRows?: Array<{ senderType: string; body: string; id: number }>;
    pilotDenied?: boolean;
    guestPolicy?: string;
  }

  const build = (opts: BuildOpts = {}) => {
    const chain = buildChain({ fake, ...opts.chain });
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
      identityClaims: opts.claims === undefined ? claimsOf() : opts.claims,
    } as unknown as Session;
    const conversation = { id: 77, sessionId: 5, tenantId: 1, status: CONVERSATION_STATUS.AI_ACTIVE } as Conversation;

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
      find: jest.fn(async () => opts.historyRows ?? []),
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
      classifyIntent: jest.fn(async () => ({ intent: 'other', needsOrderData: false, confidence: 0.8 })),
      answer: jest.fn(async (..._args: unknown[]) => ({
        text: opts.answerText ?? 'Giá qua đêm phòng Deluxe là 475.000 ₫.',
        confidence: 0.9,
        citations: KB_CITATIONS,
      })),
      answerWithoutKnowledge: jest.fn(async () => 'Xin chào!'),
      groundingConfidence: jest.fn(async () => 0.9),
      footerConfig: jest.fn(async () => null),
      effectiveAgentId: jest.fn(async () => null),
      agentGuestPolicy: jest.fn(async () => opts.guestPolicy ?? 'open'),
    };
    const moderate = jest.fn(async (p: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text: p.text }));
    const answerReuse = {
      lookup: jest.fn(async () => (opts.reuseHit ? { reuseId: 9, text: 'Câu trả lời cũ: 999.999 ₫', confidence: 0.9, citations: [] } : null)),
      recordAiAnswer: jest.fn(),
      recordHit: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as AnswerReuseService;
    const pilot = { denialFor: jest.fn(async () => (opts.pilotDenied ? { body: 'Not in the pilot.' } : null)) };

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
      chain.step,
      pilot as never,
    );
    return { svc, session, saved, rag, moderate, answerReuse, bus, chain, pilot };
  };

  const aiTurn = (saved: Array<Partial<Message>>) => saved.find((m) => m.senderType === 'ai');
  const traceOf = (m: Partial<Message> | undefined) => (m?.retrievalTrace ?? {}) as Record<string, any>;
  const TWO_LOOKUPS = seq(
    toolCalls([
      fakeToolUse('tu_1', 'lookup_rates', { roomType: 'DELUXE', rateType: 'overnight', date: '2026-10-17' }),
      fakeToolUse('tu_2', 'lookup_bookings', { bookingCode: '2610140000123456' }),
    ]),
  );
  const QUESTION = 'Giá phòng Deluxe qua đêm thứ bảy và đặt phòng 2610140000123456 thế nào?';

  describe('a tool-driven answer', () => {
    it('the planning model picks the lookups; rag.answer then writes the answer from the union block; one moderation of the FINAL text', async () => {
      fake.setScript(TWO_LOOKUPS);
      const b = build({ answerText: 'Giá qua đêm Deluxe là 475.000 ₫. Đặt phòng 2610140000123456 đã hủy.' });

      const res = await b.svc.handleUserMessage(b.session, QUESTION);

      expect(res.reply?.senderType).toBe('ai');
      expect(res.reply?.body).toContain('475.000 ₫');
      // Generation is the existing grounded path: ONE rag.answer, fed the block of both tool results.
      expect(b.rag.answer).toHaveBeenCalledTimes(1);
      const block = (b.rag.answer.mock.calls[0][9] as { partnerData: string }).partnerData;
      expect(block).toContain('hotel 1721, role manager');
      expect(block).toContain('[rates]');
      expect(block).toContain('[bookings]');
      expect(block).toContain('final 475.000 ₫');
      expect(block).toContain('2610140000123456');
      // Moderation exactly once, on that final text, with the union of ALL tool results to protect.
      expect(b.moderate).toHaveBeenCalledTimes(1);
      const call = b.moderate.mock.calls[0][0] as { text: string; protect: string[] };
      expect(call.text).toBe('Giá qua đêm Deluxe là 475.000 ₫. Đặt phòng 2610140000123456 đã hủy.');
      expect(call.protect).toEqual(expect.arrayContaining(['2610140000123456', '475.000 ₫', '350.000 ₫']));
      // Two planning calls (the tool request, then DONE); the model's own words never reach the customer.
      expect(fake.requests).toHaveLength(2);
      expect(res.reply?.body).not.toContain('DONE');
    });

    it('records the evidence of every tool result as `partnerEvidence` — never in `citations` — plus the loop summary', async () => {
      fake.setScript(TWO_LOOKUPS);
      const b = build({ answerText: 'Giá qua đêm Deluxe là 475.000 ₫.' });

      const res = await b.svc.handleUserMessage(b.session, QUESTION);

      const trace = traceOf(aiTurn(b.saved));
      expect(trace.answeredFrom).toBe('partner_data');
      expect(trace.partnerEvidence.map((e: { topic: string }) => e.topic)).toEqual(['rates', 'bookings']);
      expect(trace.partnerEvidence[0]).toMatchObject({ hotelSn: '1721', role: 'manager', source: 'mock' });
      expect(trace.partnerMode).toBe('tools');
      expect(trace.partnerToolLoop).toMatchObject({ status: 'completed', iterations: 2, toolCalls: 2 });
      expect(trace.citations).toEqual(KB_CITATIONS);
      expect(JSON.stringify(trace.citations)).not.toMatch(/partner|1721|snapshot|evidence/i);
      expect(JSON.stringify(res.reply)).not.toMatch(/partnerEvidence|snapshotHash|partnerToolLoop/);
    });

    it('answer reuse is bypassed at BOTH sites for a turn that ran a tool, even when a stored answer matches', async () => {
      fake.setScript(TWO_LOOKUPS);
      const b = build({ reuseHit: true });

      const res = await b.svc.handleUserMessage(b.session, QUESTION);

      expect(b.answerReuse.lookup).not.toHaveBeenCalled();
      expect(b.answerReuse.recordAiAnswer).not.toHaveBeenCalled();
      expect(b.rag.answer).toHaveBeenCalledTimes(1);
      expect(res.reply?.body).not.toContain('999.999');
    });

    it('also bypassed when tools mode fell back to prefetch (the turn still carries one hotel\'s live figures)', async () => {
      fake.setScript(() => ({ status: 503, error: { type: 'overloaded_error', message: 'Overloaded' } }));
      // (No figures in the reply: the prefetch rate depends on the weekday this runs on.)
      const b = build({ reuseHit: true, answerText: 'Đây là bảng giá qua đêm hiện tại của phòng Deluxe.' });

      await b.svc.handleUserMessage(b.session, 'Giá phòng Deluxe qua đêm?');

      expect(b.answerReuse.lookup).not.toHaveBeenCalled();
      expect(b.answerReuse.recordAiAnswer).not.toHaveBeenCalled();
      expect(traceOf(aiTurn(b.saved)).partnerToolsFallback).toBe('engine_degraded');
    });

    it('control: a how-to question where the model chose NO lookup is an ordinary turn — reuse applies as before', async () => {
      fake.setScript(seq(endTurn('DONE')));
      const hit = build({ reuseHit: true });
      const res = await hit.svc.handleUserMessage(hit.session, 'Làm sao để hủy đặt phòng trên app?');
      expect(hit.answerReuse.lookup).toHaveBeenCalledTimes(1);
      expect(res.reply?.body).toContain('Câu trả lời cũ');
      expect(hit.rag.answer).not.toHaveBeenCalled();

      fake.requests.length = 0;
      fake.setScript(seq(endTurn('DONE')));
      const miss = build();
      await miss.svc.handleUserMessage(miss.session, 'Làm sao để hủy đặt phòng trên app?');
      expect(miss.answerReuse.recordAiAnswer).toHaveBeenCalledTimes(1);
      expect(traceOf(aiTurn(miss.saved)).partnerEvidence).toBeUndefined();
    });

    it('the planning model reads the conversation so far, scrubbed (a follow-up like "and for Saturday?")', async () => {
      fake.setScript(seq(endTurn('DONE')));
      const b = build({
        historyRows: [
          // newest first: the service reverses them
          { id: 3, senderType: 'ai', body: 'Giá qua đêm Deluxe thứ sáu là 450.000 ₫.' },
          { id: 2, senderType: 'user', body: 'Giá phòng Deluxe qua đêm thứ sáu, gọi 0901234567' },
        ],
      });

      await b.svc.handleUserMessage(b.session, 'Còn giá phòng thứ bảy thì sao?');

      const sent = fake.requests[0].body.messages;
      expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(JSON.stringify(sent)).toContain('[PHONE]');
      expect(JSON.stringify(sent)).not.toContain('0901234567');
      expect(sent[2].content).toBe('Còn giá phòng thứ bảy thì sao?');
    });
  });

  describe('a figure no tool returned never reaches the customer', () => {
    it('an invented amount in the generated answer: withheld, confirm-later notice + hand-off, nothing persisted as an AI answer', async () => {
      fake.setScript(TWO_LOOKUPS);
      const b = build({ answerText: 'Giá qua đêm Deluxe là 480.000 ₫.' }); // the tool data says 475.000

      const res = await b.svc.handleUserMessage(b.session, QUESTION);

      expect(res.escalate).toBe(true);
      expect(res.reply?.senderType).toBe('system');
      expect(res.reply?.body).toContain('Tôi chưa xác nhận được các số liệu');
      expect(JSON.stringify(res)).not.toContain('480.000');
      expect(aiTurn(b.saved)).toBeUndefined();
      expect(b.saved.map((m) => m.body).join('\n')).not.toContain('480.000');
      expect(b.answerReuse.recordAiAnswer).not.toHaveBeenCalled();
      expect(b.chain.rows).toContainEqual(expect.objectContaining({ status: 'unverified', errorCode: 'E5107', mode: 'tool' }));
    });

    it('a figure that is in ONE of the two tool results is accepted (the check covers the union)', async () => {
      fake.setScript(TWO_LOOKUPS);
      // 350.000 is the cancelled booking's base (bookings result); 475.000 is the rate (rates result).
      const b = build({ answerText: 'Đặt phòng 2610140000123456 giá gốc 350.000 ₫; giá qua đêm Deluxe 475.000 ₫.' });
      const res = await b.svc.handleUserMessage(b.session, QUESTION);
      expect(res.reply?.senderType).toBe('ai');
    });
  });

  describe('failures degrade like prefetch', () => {
    it('the iteration limit: confirm-later notice + hand-off, no generation, no moderation (fixed text)', async () => {
      let n = 0;
      fake.setScript(() => toolCalls([fakeToolUse(`tu_${++n}`, 'lookup_rates', { date: `2026-10-${10 + n}` })]));
      const b = build();

      const res = await b.svc.handleUserMessage(b.session, 'Giá phòng Deluxe qua đêm?');

      expect(res.escalate).toBe(true);
      expect(res.reply?.senderType).toBe('system');
      expect(b.rag.answer).not.toHaveBeenCalled();
      expect(b.moderate).not.toHaveBeenCalled();
      const notice = b.saved.find((m) => m.senderType === 'system');
      expect(traceOf(notice)).toMatchObject({ reason: 'partner_unavailable', partnerError: 'E5142', partnerToolLoop: { reason: 'iteration_limit' } });
      expect(b.bus.publish).toHaveBeenCalledWith(EVENTS.ESCALATION, expect.objectContaining({ conversationId: 77 }));
    });

    it('a model that names a hotel: refusal notice (no hand-off), nothing from any hotel is looked up', async () => {
      fake.setScript(seq(toolCalls([fakeToolUse('tu_1', 'lookup_bookings', { bookingCode: 'DECOY2610170001', hotelSn: '9999' })])));
      const b = build();

      const res = await b.svc.handleUserMessage(b.session, 'Cho tôi đặt phòng của tôi');

      expect(res.escalate).toBe(false);
      expect(res.reply?.body).toContain('Tôi chỉ tra cứu được dữ liệu của khách sạn bạn đang đăng nhập');
      expect(b.chain.clientGet).not.toHaveBeenCalled();
      expect(b.rag.answer).not.toHaveBeenCalled();
      expect(JSON.stringify(b.saved)).not.toContain('DECOY');
    });
  });

  describe('the gates before any tool call', () => {
    it('a pilot-denied hotel never reaches a model', async () => {
      const b = build({ pilotDenied: true });
      const res = await b.svc.handleUserMessage(b.session, 'Giá phòng Deluxe qua đêm?');
      expect(res.pilotDenied).toBe(true);
      expect(fake.requests).toHaveLength(0);
      expect(b.chain.clientGet).not.toHaveBeenCalled();
    });

    it('a guest (no signed identity) asking a partner question never reaches a tool', async () => {
      const b = build({ claims: null });
      await b.svc.handleUserMessage(b.session, 'Giá phòng Deluxe qua đêm?');
      expect(fake.requests).toHaveLength(0);
      expect(b.chain.clientGet).not.toHaveBeenCalled();
    });

    it('expired claims: the sign-in-again path, no tool call', async () => {
      const b = build({ claims: claimsOf({ verifiedAt: new Date(Date.now() - 9 * 3600_000).toISOString() }) });
      await b.svc.handleUserMessage(b.session, 'Giá phòng Deluxe qua đêm?');
      expect(fake.requests).toHaveLength(0);
      expect(b.chain.clientGet).not.toHaveBeenCalled();
    });

    it('tools mode off for the tenant: no model call, the prefetch block as always', async () => {
      const b = build({ chain: { tenantMode: 'prefetch' }, answerText: 'Đây là bảng giá qua đêm hiện tại của phòng Deluxe.' });
      const res = await b.svc.handleUserMessage(b.session, 'Giá phòng Deluxe qua đêm?');
      expect(fake.requests).toHaveLength(0);
      expect(res.reply?.senderType).toBe('ai');
      expect(traceOf(aiTurn(b.saved)).partnerMode).toBeUndefined();
      expect(traceOf(aiTurn(b.saved)).answeredFrom).toBe('partner_data');
    });
  });
});
