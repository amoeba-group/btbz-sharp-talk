import { FindOperator, Repository } from 'typeorm';
import { CONSENT_STATE, CONVERSATION_STATUS, MODERATION_DECISION } from '@sharptalk/types';
import { ChatService } from './chat.service';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { RagService } from './rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { CONSENT_NOTICE_VERSION, SessionService } from '../session/session.service';
import { EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import { AnswerReuseService } from '../answer-reuse/answer-reuse.service';

/**
 * Conversation memory (REQ/PLN-260929-AI-Conversation-Memory).
 *
 * Conversation 652 (skyliving): the assistant asked for a booking's name,
 * phone, address and time, received them, and asked for all four again on the
 * next turn — every model call saw the current message alone. Pinned here:
 * the earlier turns reach the classifier and both answering paths, a
 * context-dependent turn neither replays nor feeds the reuse store, a copied
 * privacy token never reaches the customer, and an out_of_scope label the
 * knowledge base contradicts is dropped.
 */
describe('ChatService — conversation memory', () => {
  // Newest first, as the repository returns them for `order: { id: 'DESC' }`.
  const PRIOR_652 = [
    { id: '17697', senderType: 'ai', body: '성함, 연락처, 주소, 희망 일시를 알려주세요' },
    { id: '17696', senderType: 'user', body: '김익용, 010-1234-5678, 30일 오전' },
    { id: '17695', senderType: 'ai', body: '벽걸이 에어컨 청소는 230,000₫입니다.' },
    { id: '17694', senderType: 'user', body: '벽걸이' },
  ];

  const build = (
    opts: {
      prior?: Array<{ id: string; senderType: string; body: string }>;
      intent?: string;
      intentConfidence?: number;
      answerText?: string;
      grounding?: number;
      reuseHit?: boolean;
      footer?: string;
    } = {},
  ) => {
    const conversation = {
      id: 652,
      sessionId: 14340,
      tenantId: 5,
      status: CONVERSATION_STATUS.AI_ACTIVE,
    } as Conversation;
    const session = {
      id: 14340,
      sessionToken: 'tok',
      tenantId: 5,
      customerId: null,
      identityLevel: 'guest',
      language: 'KO',
      consentState: CONSENT_STATE.GRANTED,
      consentAt: new Date(),
      consentVersion: CONSENT_NOTICE_VERSION,
    } as Session;

    const saved: Array<Partial<Message>> = [];
    let nextId = 17700;
    const msgRepo = {
      save: jest.fn(async (m: Partial<Message>) => {
        const row = { ...m, id: String(nextId++) };
        saved.push(row);
        return row;
      }),
      create: (m: Partial<Message>) => m,
      update: jest.fn(),
      // Only the history query filters on several sender types at once; the
      // retrieval and streak queries get nothing, keeping them out of the way.
      find: jest.fn(async (q: { where?: { senderType?: unknown } }) =>
        q.where?.senderType instanceof FindOperator ? [...(opts.prior ?? [])] : [],
      ),
      findOne: jest.fn(async () => null),
    } as unknown as Repository<Message>;
    const convRepo = {
      findOne: jest.fn(async () => conversation),
      save: jest.fn(async (c: Conversation) => c),
      create: (c: Partial<Conversation>) => c,
      update: jest.fn(),
      findOneOrFail: jest.fn(async () => conversation),
    } as unknown as Repository<Conversation>;
    const sessionRepo = {
      findOne: jest.fn(async () => session),
      save: jest.fn(async (s: Session) => s),
    } as unknown as Repository<Session>;
    const tenantRepo = {
      findOne: jest.fn(async () => ({ id: 5, privacyPolicyUrl: null, consentNoticeVersion: null }) as Tenant),
    } as unknown as Repository<Tenant>;
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const bus = { publish: jest.fn() } as unknown as EventBusService;

    const answerText = opts.answerText ?? '김익용 님, 연락처 [PHONE] 확인했습니다. 대수만 알려주세요.';
    const rag = {
      classifyIntent: jest.fn(async () => ({
        intent: opts.intent ?? 'other',
        needsOrderData: false,
        confidence: opts.intentConfidence ?? 0.8,
      })),
      answerWithoutKnowledge: jest.fn(async () => '연락처 [PHONE]로 안내드릴게요.'),
      answer: jest.fn(async () => ({ text: answerText, confidence: 0.9, citations: [{ id: 3340 }] })),
      groundingConfidence: jest.fn(async () => opts.grounding ?? 0.2),
      footerText: jest.fn(async () => opts.footer ?? null),
      effectiveAgentId: jest.fn(async () => null),
    };
    const moderation = {
      moderate: jest.fn(async (p: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text: p.text })),
    } as unknown as ModerationService;
    const answerReuse = {
      lookup: jest.fn(async () =>
        opts.reuseHit ? { reuseId: 9, text: '예약 방법 안내', confidence: 0.9, citations: [] } : null,
      ),
      recordAiAnswer: jest.fn(),
      recordHit: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as AnswerReuseService;

    const svc = new ChatService(
      convRepo,
      msgRepo,
      sessionRepo,
      tenantRepo,
      { find: jest.fn(async () => []) } as unknown as Repository<User>,
      { update: jest.fn() } as never,
      rag as unknown as RagService,
      moderation,
      { recentForCustomer: jest.fn(async () => []) } as never,
      new SessionService(sessionRepo, tenantRepo, bus, redis),
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () => null),
      } as unknown as HandoffRouterService,
      bus,
      {} as never,
      redis,
      answerReuse,
    );
    return { svc, session, saved, rag, answerReuse };
  };

  it('hands the earlier turns to the answering model, oldest first and scrubbed', async () => {
    const b = build({ prior: PRIOR_652 });

    await b.svc.handleUserMessage(b.session, '에어컨 벽걸이, 가정, 2대');

    const history = b.rag.answer.mock.calls[0][8] as Array<{ role: string; content: string }>;
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(history[0].content).toBe('벽걸이');
    expect(history[2].content).toContain('김익용');
    expect(history[2].content).toContain('[PHONE]');
    expect(JSON.stringify(history)).not.toContain('010-1234-5678');
  });

  it('searches with the shop\'s last reply as well as the customer turns (S8)', async () => {
    const b = build({ prior: PRIOR_652 });

    await b.svc.handleUserMessage(b.session, '예약 진행');

    const searchText = b.rag.answer.mock.calls[0][5] as string;
    expect(searchText).toContain('성함, 연락처, 주소, 희망 일시를 알려주세요');
    expect(searchText).toContain('벽걸이');
    expect(searchText).not.toContain('010-1234-5678');
    expect(searchText.endsWith('예약 진행')).toBe(true);
  });

  it('shows the classifier the exchange the message answers', async () => {
    const b = build({ prior: PRIOR_652 });

    await b.svc.handleUserMessage(b.session, '1. 김익용');

    const recent = b.rag.classifyIntent.mock.calls[0][2] as Array<{ role: string }>;
    expect(recent).toHaveLength(4);
    expect(recent[recent.length - 1].role).toBe('assistant');
  });

  it('gives the no-knowledge path the history too', async () => {
    const b = build({ prior: PRIOR_652, intent: 'unintelligible', intentConfidence: 0.9 });

    await b.svc.handleUserMessage(b.session, '1. 김익용');

    expect(b.rag.answerWithoutKnowledge).toHaveBeenCalled();
    expect((b.rag.answerWithoutKnowledge.mock.calls[0] as unknown[])[5]).toHaveLength(4);
  });

  it('never shows the customer a privacy token — RAG path', async () => {
    const b = build({ prior: PRIOR_652 });

    const res = await b.svc.handleUserMessage(b.session, '예약 진행');

    expect(res.reply?.body).not.toContain('[PHONE]');
    expect(res.reply?.body).toContain('말씀하신 연락처');
    expect(b.saved[b.saved.length - 1].body).toContain('말씀하신 연락처');
  });

  it('never shows the customer a privacy token — no-knowledge path', async () => {
    const b = build({ prior: PRIOR_652, intent: 'unintelligible', intentConfidence: 0.9 });

    const res = await b.svc.handleUserMessage(b.session, '1. 김익용');

    expect(res.reply?.body).not.toContain('[PHONE]');
  });

  it('does not replay a stored answer once the shop has spoken, nor store the contextual answer', async () => {
    const b = build({ prior: PRIOR_652, reuseHit: true });

    await b.svc.handleUserMessage(b.session, '예약 진행');

    expect(b.answerReuse.lookup).not.toHaveBeenCalled();
    expect(b.rag.answer).toHaveBeenCalled();
    expect(b.answerReuse.recordAiAnswer).not.toHaveBeenCalled();
  });

  it('keeps reuse for the opening question of a conversation', async () => {
    const b = build({ prior: [], reuseHit: true });

    await b.svc.handleUserMessage(b.session, '예약은 어떻게 하나요?');

    expect(b.answerReuse.lookup).toHaveBeenCalled();
    expect(b.rag.answer).not.toHaveBeenCalled();
  });

  it('passes no history on the first turn (prompt unchanged)', async () => {
    const b = build({ prior: [] });

    await b.svc.handleUserMessage(b.session, '에어컨 청소 가격');

    expect(b.rag.answer.mock.calls[0][8]).toEqual([]);
    expect(b.answerReuse.recordAiAnswer).toHaveBeenCalled();
  });

  it('appends the tenant contact footer after moderation, and keeps it out of the reuse store (PLN-261007 R4)', async () => {
    const b = build({ prior: [], footer: '📞 support@go2joy.vn · 1900 638 838' });

    const res = await b.svc.handleUserMessage(b.session, 'Hoa hồng bao nhiêu?');

    expect(res.reply?.body).toMatch(/\n\n📞 support@go2joy\.vn · 1900 638 838$/);
    expect(b.saved[b.saved.length - 1].body).toContain('📞 support@go2joy.vn');
    const stored = (b.answerReuse.recordAiAnswer as jest.Mock).mock.calls[0][0] as { answerText: string };
    expect(stored.answerText).not.toContain('📞');
  });

  describe('out_of_scope second opinion (S6)', () => {
    it('answers from knowledge when the knowledge base covers the "out of scope" question', async () => {
      const b = build({ intent: 'out_of_scope', intentConfidence: 0.85, grounding: 0.8 });

      await b.svc.handleUserMessage(b.session, '에어콘 청소 예약');

      expect(b.rag.groundingConfidence).toHaveBeenCalled();
      expect(b.rag.answerWithoutKnowledge).not.toHaveBeenCalled();
      expect(b.rag.answer).toHaveBeenCalled();
    });

    it('keeps the no-knowledge reply when nothing in the knowledge base matches', async () => {
      const b = build({ intent: 'out_of_scope', intentConfidence: 0.85, grounding: 0.2 });

      await b.svc.handleUserMessage(b.session, '오늘 환율 얼마야?');

      expect(b.rag.answerWithoutKnowledge).toHaveBeenCalled();
      expect(b.rag.answer).not.toHaveBeenCalled();
    });

    it('does not search the knowledge base for small talk', async () => {
      const b = build({ intent: 'smalltalk', intentConfidence: 0.9 });

      await b.svc.handleUserMessage(b.session, '안녕하세요');

      expect(b.rag.groundingConfidence).not.toHaveBeenCalled();
    });
  });
});
