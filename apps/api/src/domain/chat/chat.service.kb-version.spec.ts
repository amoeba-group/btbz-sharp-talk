import { FindOperator, Repository } from 'typeorm';
import {
  CONSENT_STATE,
  CONVERSATION_STATUS,
  KB_VERSION_CAVEAT_DEFAULTS,
  MODERATION_DECISION,
  SESSION_LANGUAGE_CODES,
} from '@sharptalk/types';
import type { KbVersionPolicy } from '@sharptalk/types';
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
 * KB UI-version caveat in the chat path (PLN-261012 SG-20, REQ FR-010).
 *
 * The harness wires a REAL RagService for the pieces under test (policy read,
 * live version read, caveat decision) and stubs only what needs a model or an
 * index (classifier, answer, grounding). So what is asserted is the whole
 * path a customer's answer takes: moderation first, the one fixed sentence
 * after it, the contact footer last, and nothing of it in the reuse store.
 */
describe('ChatService — KB UI version caveat', () => {
  const ANSWER = 'Đối soát được chốt vào ngày 5 hàng tháng.';
  const FOOTER = '📞 support@go2joy.vn · 1900 638 838';
  const REF: KbVersionPolicy = { referenceVersion: 'v0.12.0', onMismatch: 'caveat' };

  const build = (
    opts: {
      policy?: KbVersionPolicy | null;
      /** Live versions of the documents the answer cites (id 5, 6). */
      docs?: Array<{ id: number; uiVersion: string | null }>;
      language?: string;
      answerText?: string;
      footer?: boolean;
      reuseHit?: boolean;
      prior?: Array<{ id: string; senderType: string; body: string }>;
      draft?: boolean;
    } = {},
  ) => {
    const language = opts.language ?? 'VI';
    const conversation = { id: 652, sessionId: 1, tenantId: 5, status: CONVERSATION_STATUS.AI_ACTIVE } as Conversation;
    const session = {
      id: 1,
      sessionToken: 'tok',
      tenantId: 5,
      customerId: null,
      identityLevel: 'guest',
      language,
      consentState: CONSENT_STATE.GRANTED,
      consentAt: new Date(),
      consentVersion: CONSENT_NOTICE_VERSION,
    } as Session;

    const saved: Array<Partial<Message>> = [];
    let nextId = 100;
    const msgRepo = {
      save: jest.fn(async (m: Partial<Message>) => {
        const row = { ...m, id: String(nextId++) };
        saved.push(row);
        return row;
      }),
      create: (m: Partial<Message>) => m,
      update: jest.fn(),
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

    // The real RagService, over a config that knows the policy and the footer and a
    // repository that knows the live versions of the cited documents.
    const find = jest.fn(async () => opts.docs ?? []);
    const aiConfig = {
      getKbVersionPolicy: jest.fn(async () => opts.policy ?? null),
      getAnswerFooter: jest.fn(async () =>
        opts.footer ? { enabled: true, text: { EN: FOOTER, VI: FOOTER }, protected: [] } : null,
      ),
    };
    const rag = new RagService(
      { find } as never,
      { findOne: async () => null } as never,
      { complete: jest.fn(), embed: jest.fn() } as never,
      { enabled: false } as never,
      aiConfig as never,
    );
    const answerText = opts.answerText ?? ANSWER;
    const answerMock = jest.fn(async () => ({ text: answerText, confidence: 0.9, citations: [{ id: 5 }, { id: 6 }] }));
    Object.assign(rag, {
      classifyIntent: jest.fn(async () => ({ intent: 'other', needsOrderData: false, confidence: 0.8 })),
      answer: answerMock,
      groundingConfidence: jest.fn(async () => 0.2),
      effectiveAgentId: jest.fn(async () => null),
      agentGuestPolicy: jest.fn(async () => 'open'),
    });

    const moderate = jest.fn(async (p: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text: p.text }));
    const answerReuse = {
      lookup: jest.fn(async () =>
        opts.reuseHit
          ? {
              reuseId: 9,
              text: ANSWER,
              confidence: 0.9,
              // Stored days ago: it says the document was on the reference version.
              citations: [{ id: 5, uiVersion: 'v0.12.0' }],
            }
          : null,
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
      rag,
      { moderate } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      new SessionService(sessionRepo, tenantRepo, bus, redis),
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () => null),
        teamQuestion: jest.fn(async () => null),
      } as unknown as HandoffRouterService,
      bus,
      {} as never,
      redis,
      answerReuse,
    );
    return { svc, session, saved, moderate, answerReuse, answerMock, find };
  };

  const ask = (b: ReturnType<typeof build>, draft = false) =>
    b.svc.handleUserMessage(b.session, 'Khi nào chốt đối soát?', draft ? { draft: true } : undefined);
  const storedAnswer = (b: ReturnType<typeof build>) =>
    ((b.answerReuse.recordAiAnswer as jest.Mock).mock.calls[0][0] as { answerText: string }).answerText;

  const DOCS_MISMATCH = [{ id: 5, uiVersion: 'v0.9.2' }, { id: 6, uiVersion: null }];

  it('appends the fixed sentence when a cited document is stamped with another version', async () => {
    const b = build({ policy: REF, docs: DOCS_MISMATCH });
    const res = await ask(b);
    expect(res.reply?.body).toBe(`${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS.VI}`);
    expect(b.saved[b.saved.length - 1].body).toBe(`${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS.VI}`);
  });

  it.each(SESSION_LANGUAGE_CODES)('says it in %s, in the shopper\'s own language', async (lang) => {
    const b = build({ policy: REF, docs: DOCS_MISMATCH, language: lang });
    const res = await ask(b);
    expect(res.reply?.body).toBe(`${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS[lang]}`);
  });

  it('is added AFTER moderation: the moderator never sees the sentence', async () => {
    const b = build({ policy: REF, docs: DOCS_MISMATCH });
    await ask(b);
    expect(b.moderate).toHaveBeenCalledTimes(1);
    const moderated = (b.moderate.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(moderated).toBe(ANSWER);
    expect(moderated).not.toContain(KB_VERSION_CAVEAT_DEFAULTS.VI);
  });

  it('keeps the sentence out of the reuse store', async () => {
    const b = build({ policy: REF, docs: DOCS_MISMATCH });
    await ask(b);
    expect(storedAnswer(b)).toBe(ANSWER);
  });

  it('is silent for a document with no version — it is flagged in the console, not in the answer', async () => {
    const b = build({ policy: REF, docs: [{ id: 5, uiVersion: null }, { id: 6, uiVersion: '' }] });
    const res = await ask(b);
    expect(res.reply?.body).toBe(ANSWER);
  });

  it('is silent when the cited documents are on the reference version', async () => {
    const b = build({ policy: REF, docs: [{ id: 5, uiVersion: '0.12.0' }, { id: 6, uiVersion: 'V0.12.0' }] });
    expect((await ask(b)).reply?.body).toBe(ANSWER);
  });

  it('puts the sentence between the answer and the contact footer', async () => {
    const b = build({ policy: REF, docs: DOCS_MISMATCH, footer: true });
    const res = await ask(b);
    expect(res.reply?.body).toBe(`${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS.VI}\n\n${FOOTER}`);
    // …and neither is in what the reuse store learns.
    expect(storedAnswer(b)).toBe(ANSWER);
  });

  it('appears once even when the model already wrote it', async () => {
    const b = build({
      policy: REF,
      docs: DOCS_MISMATCH,
      answerText: `${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS.VI}`,
    });
    const res = await ask(b);
    expect(res.reply?.body.split(KB_VERSION_CAVEAT_DEFAULTS.VI)).toHaveLength(2);
    expect(res.reply?.body).toBe(`${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS.VI}`);
    // A model-written copy never reaches the reuse store either.
    expect(storedAnswer(b)).toBe(ANSWER);
  });

  it('strips a copy the model wrote in ANOTHER language too', async () => {
    const b = build({
      policy: REF,
      docs: DOCS_MISMATCH,
      language: 'VI',
      answerText: `${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS.EN}`,
    });
    const res = await ask(b);
    expect(res.reply?.body).toBe(`${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS.VI}`);
  });

  it('removes earlier caveats from the history the model reads, so it cannot copy them', async () => {
    const b = build({
      policy: REF,
      docs: DOCS_MISMATCH,
      prior: [
        { id: '99', senderType: 'ai', body: `Câu trả lời trước.\n\n${KB_VERSION_CAVEAT_DEFAULTS.VI}` },
        { id: '98', senderType: 'user', body: 'Câu hỏi trước' },
      ],
    });
    await ask(b);
    const history = (b.answerMock.mock.calls[0] as unknown[])[8] as Array<{ role: string; content: string }>;
    expect(history.find((m) => m.role === 'assistant')?.content).toBe('Câu trả lời trước.');
  });

  it('uses the tenant\'s own wording for the session language', async () => {
    const b = build({
      policy: { ...REF, notice: { VI: 'Hướng dẫn này theo bản v0.9.2 của Hotel Admin.' } },
      docs: DOCS_MISMATCH,
    });
    const res = await ask(b);
    expect(res.reply?.body).toBe(`${ANSWER}\n\nHướng dẫn này theo bản v0.9.2 của Hotel Admin.`);
  });

  it('covers a REPLAYED answer: versions are read live, the stored citations are not believed', async () => {
    // The stored citation says v0.12.0 (the reference); the document has been
    // re-stamped v0.9.2 since. The replay must still carry the caveat.
    const b = build({ policy: REF, docs: [{ id: 5, uiVersion: 'v0.9.2' }], reuseHit: true });
    const res = await ask(b);
    expect(b.answerMock).not.toHaveBeenCalled(); // it WAS a replay
    expect(res.reply?.body).toBe(`${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS.VI}`);
    expect(b.answerReuse.recordAiAnswer).not.toHaveBeenCalled();
    expect(b.answerReuse.recordHit).toHaveBeenCalled();
  });

  it('a replay of a document that now matches carries no caveat', async () => {
    const b = build({ policy: REF, docs: [{ id: 5, uiVersion: 'v0.12.0' }], reuseHit: true });
    expect((await ask(b)).reply?.body).toBe(ANSWER);
  });

  it('a draft (approval mode) carries the sentence too — the proposal is what would be sent', async () => {
    const b = build({ policy: REF, docs: DOCS_MISMATCH });
    const res = await ask(b, true);
    expect(res.reply).toBeNull();
    expect(res.draft?.body).toBe(`${ANSWER}\n\n${KB_VERSION_CAVEAT_DEFAULTS.VI}`);
  });

  it('records on the trace that the caveat was added', async () => {
    const b = build({ policy: REF, docs: DOCS_MISMATCH });
    await ask(b);
    expect(b.saved[b.saved.length - 1].retrievalTrace).toMatchObject({ uiVersionCaveat: true });
  });

  describe('a tenant without the feature is byte-identical', () => {
    it.each([
      ['no policy', null],
      ['off', { referenceVersion: 'v0.12.0', onMismatch: 'off' } as KbVersionPolicy],
      // hide filters at retrieval; nothing is appended on top of it.
      ['hide', { referenceVersion: 'v0.12.0', onMismatch: 'hide' } as KbVersionPolicy],
    ])('%s: same body, no document read', async (_n, policy) => {
      const b = build({ policy, docs: DOCS_MISMATCH, footer: true });
      const res = await ask(b);
      expect(res.reply?.body).toBe(`${ANSWER}\n\n${FOOTER}`);
      expect(b.find).not.toHaveBeenCalled();
      expect(b.saved[b.saved.length - 1].retrievalTrace).not.toHaveProperty('uiVersionCaveat');
      expect(storedAnswer(b)).toBe(ANSWER);
    });
  });
});
