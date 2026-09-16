import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  CJM_STAGE,
  CONSENT_STATE,
  CONVERSATION_STATUS,
  MODERATION_DECISION,
  SENDER_TYPE,
  localized,
} from '@sharptalk/types';
import type { LocalizedText } from '@sharptalk/types';
import { Conversation } from './entity/conversation.entity';
import { CSAT_WINDOW_MS } from './chat.mapper';
import { Message } from './entity/message.entity';
import { DOC_GROUP } from '../knowledge/entity/kb-document.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { Assignment } from '../agent/entity/assignment.entity';
import { AgentDailyStat } from '../agent/entity/agent-daily-stat.entity';
import { RagService, RagAnswer } from './rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { AnswerReuseService } from '../answer-reuse/answer-reuse.service';
import { IssueService } from '../issue/issue.service';
import type { ChatTurnResponse } from '@sharptalk/types';
import { OrderService } from '../order/order.service';
import { SessionService, sessionCacheKey } from '../session/session.service';
import { CustomerService } from '../customer/customer.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import { EventBusService, EVENTS, RedisService } from '../../infrastructure/infrastructure.module';
import { AttachmentService } from '../attachment/attachment.service';
import { MessageAttachment } from '../attachment/entity/message-attachment.entity';
import { scrubPii } from '../../global/util/pii-scrub.util';
import { detectLanguage } from '../../global/util/detect-language.util';
import { DENY_MODE } from '../ai-engine/entity/tenant-ai-config.entity';

const ESCALATION_CONFIDENCE = 0.45;

/**
 * How sure the classifier must be before a message counts as "get me a person"
 * (PLN-260813 D2). The failure mode this guards against is a shopper saying
 * "your agent was lovely" and landing in the queue.
 */
const AGENT_REQUEST_CONFIDENCE = 0.6;

/**
 * Turns with nothing to look up (PLN-260813 P2). They score 0.2 for the same
 * reason a greeting resembles no document, and that used to page a human.
 */
const NON_QUESTION_INTENTS = new Set(['smalltalk', 'out_of_scope', 'unintelligible']);

/**
 * How many consecutive turns with nothing to answer before the shopper is
 * offered a person (PLN-260813 D5). Offered — not transferred: someone circling
 * may need help, but that call is theirs to make.
 */
const NON_QUESTION_STREAK_FOR_OFFER = 3;

const AGENT_OFFER_COPY: Record<string, string> = {
  EN: 'If you would like to speak with one of our team, just say so and I will connect you.',
  ES: 'Si prefieres hablar con nuestro equipo, dímelo y te conecto.',
  KO: '혹시 상담원 연결이 필요하시면 말씀해 주세요.',
};

/**
 * Second signal, for when the classifier misses or fails: phrasings that ask
 * for a human, in the three supported languages.
 *
 * Request shapes only — a bare "상담원" or "agent" is deliberately absent,
 * because "how many agents do you have?" is a question the AI should answer.
 */
const AGENT_REQUEST_PHRASES =
  /(talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+|the\s+)?(real\s+)?(person|human|agent|someone|representative)|real person|live agent|human agent|hablar con (una persona|un agente|alguien|un humano)|(상담원|상담사|담당자)(과|와|하고|이랑|을|를|에게|한테)?\s*(직접\s*)?(통화|연결|대화|얘기|이야기|바꿔|불러)|사람과\s*(통화|대화|얘기|이야기)/i;
/** Recent orders handed to the assistant as grounding for order questions. */
const ORDER_CONTEXT_LIMIT = 5;
/** Earlier customer turns folded into the retrieval query (FIX-260806 A2). */
const RETRIEVAL_CONTEXT_TURNS = 2;
/** Per-turn cap on that borrowed context, so one long message can't drown the query. */
const RETRIEVAL_CONTEXT_CHARS = 200;

/**
 * Localized backend-generated conversational strings keyed by session.language
 * (the six registered in @sharptalk/types). Backend ERROR messages stay English
 * (localized by code on the client); these are user-facing chat turns, so they
 * honor the UI language.
 */
const SYSTEM_MESSAGES = {
  authRequired: {
    EN: 'To look up your order I need to verify your identity. Please sign in or use guest order lookup.',
    ES: 'Para consultar tu pedido necesito verificar tu identidad. Inicia sesión o usa la búsqueda de pedido como invitado.',
    KO: '주문을 조회하려면 본인 확인이 필요합니다. 로그인하거나 비회원 주문 조회를 이용해 주세요.',
    VI: 'Để tra cứu đơn hàng, tôi cần xác minh danh tính của bạn. Vui lòng đăng nhập hoặc dùng tra cứu đơn hàng dành cho khách.',
    JA: 'ご注文を確認するには本人確認が必要です。ログインするか、ゲスト注文照会をご利用ください。',
    ZH: '查询订单需要先验证您的身份。请登录或使用访客订单查询。',
  },
  connectingAgent: {
    EN: "I'm connecting you with a support agent who can help with this.",
    ES: 'Te estoy conectando con un agente de soporte que puede ayudarte con esto.',
    KO: '이 문제를 도와드릴 상담원에게 연결해 드리겠습니다.',
    VI: 'Tôi đang kết nối bạn với nhân viên hỗ trợ có thể giúp việc này.',
    JA: 'この件をお手伝いできるサポート担当者におつなぎします。',
    ZH: '正在为您转接可以处理此问题的客服人员。',
  },
  offerAgent: {
    EN: 'Would you like me to connect you with a support agent?',
    ES: '¿Quieres que te conecte con un agente de soporte?',
    KO: '상담원에게 연결해 드릴까요?',
    VI: 'Bạn có muốn tôi kết nối với nhân viên hỗ trợ không?',
    JA: 'サポート担当者におつなぎしましょうか。',
    ZH: '需要为您转接客服人员吗？',
  },
  handoff: {
    EN: "I couldn't find a confident answer in our help content, so I'm forwarding this to our support team to continue the conversation. An agent will reply here shortly.",
    ES: 'No encontré una respuesta segura en nuestro contenido de ayuda, así que lo estoy remitiendo a nuestro equipo de soporte para continuar la conversación. Un agente responderá aquí en breve.',
    KO: '관리자에게 전달하여 상담을 이어가겠습니다. 잠시만 기다려 주시면 상담사가 이 대화창에서 답변드릴게요.',
    VI: 'Tôi chưa tìm được câu trả lời chắc chắn trong tài liệu hỗ trợ, nên tôi sẽ chuyển cuộc trò chuyện này cho đội hỗ trợ. Nhân viên sẽ trả lời ngay tại đây trong giây lát.',
    JA: 'ヘルプ情報の中に確かな回答が見つからなかったため、この会話をサポートチームに引き継ぎます。担当者がまもなくこちらで返信いたします。',
    ZH: '我在帮助内容中没有找到确定的答案，因此将这次对话转交给客服团队。客服人员稍后会在这里回复您。',
  },
  offHoursNeedEmail: {
    EN: "We're outside our support hours right now. Leave the email address you'd like the answer sent to and our team will reply there as soon as they're back.",
    ES: 'Ahora mismo estamos fuera del horario de atención. Déjanos el correo al que quieres recibir la respuesta y nuestro equipo te escribirá en cuanto vuelva.',
    KO: '지금은 상담 가능 시간이 아니에요. 회신받으실 이메일을 남겨주시면 업무 시간에 담당자가 이메일로 답변드릴게요.',
    VI: 'Hiện tại đang ngoài giờ hỗ trợ. Bạn hãy để lại địa chỉ email muốn nhận câu trả lời, đội ngũ của chúng tôi sẽ phản hồi ngay khi làm việc trở lại.',
    JA: 'ただいまサポート時間外です。回答をお送りするメールアドレスをご記入いただければ、営業時間になり次第担当者からご連絡いたします。',
    ZH: '现在是客服工作时间之外。请留下您希望接收回复的邮箱地址，我们的团队上班后会尽快回复您。',
  },
  contactEmailSaved: {
    EN: "Thanks — we'll send the answer to that address.",
    ES: 'Gracias, enviaremos la respuesta a esa dirección.',
    KO: '감사합니다. 해당 주소로 답변을 보내드릴게요.',
    VI: 'Cảm ơn bạn — chúng tôi sẽ gửi câu trả lời tới địa chỉ đó.',
    JA: 'ありがとうございます。そちらのアドレスに回答をお送りします。',
    ZH: '谢谢，我们会将回复发送到该邮箱。',
  },
  consentRequired: {
    EN: 'We cannot process chat messages until you accept the privacy notice. To use chat, please accept the privacy notice in the consent banner.',
    ES: 'No podemos procesar mensajes de chat hasta que aceptes el aviso de privacidad. Para usar el chat, acepta el aviso de privacidad en el banner de consentimiento.',
    KO: '개인정보 처리 안내에 동의하시기 전에는 채팅 메시지를 처리할 수 없습니다. 채팅을 이용하려면 동의 배너에서 개인정보 처리 안내에 동의해 주세요.',
    VI: 'Chúng tôi không thể xử lý tin nhắn trò chuyện cho đến khi bạn chấp nhận thông báo về quyền riêng tư. Để sử dụng trò chuyện, vui lòng chấp nhận thông báo quyền riêng tư trên biểu ngữ đồng ý.',
    JA: 'プライバシーに関するお知らせに同意いただくまで、チャットメッセージを処理できません。チャットをご利用になるには、同意バナーでプライバシーに関するお知らせに同意してください。',
    ZH: '在您接受隐私声明之前，我们无法处理聊天消息。如需使用聊天，请在同意横幅中接受隐私声明。',
  },
  // A file arrived with nothing written alongside it. There is nothing to
  // retrieve an answer from, so the bot acknowledges receipt instead of
  // guessing — and instead of the silence that made shoppers give up before
  // (FIX-260806 A1).
  attachmentReceived: {
    EN: "Got your file — thanks. Could you tell me briefly what you'd like help with?",
    ES: 'Recibimos tu archivo, gracias. ¿Nos cuentas brevemente en qué podemos ayudarte?',
    KO: '파일 잘 받았습니다. 어떤 점을 도와드리면 될지 간단히 알려주시겠어요?',
    VI: 'Chúng tôi đã nhận được tệp của bạn, cảm ơn bạn. Bạn cho biết ngắn gọn mình cần hỗ trợ điều gì nhé?',
    JA: 'ファイルを受け取りました。ありがとうございます。どのようなことでお困りか、簡単に教えていただけますか。',
    ZH: '已收到您的文件，谢谢。您方便简单说明一下需要什么帮助吗？',
  },
} satisfies Record<string, LocalizedText>;

/** Localized system-turn copy — shared with ScenarioService's consent gate. */
export function sysMsg(key: keyof typeof SYSTEM_MESSAGES, lang: string): string {
  return localized(SYSTEM_MESSAGES[key], lang);
}

/** An answer produced but NOT delivered — approval mode (PLN-260812). */
export interface ChatDraft {
  body: string;
  confidence: number;
  citations?: unknown;
}

/**
 * Response shape lives in `@sharptalk/types` — the widget imports the same contract.
 * `draft` is additive and only ever set for callers that asked for draft mode,
 * so the widget contract is unchanged.
 */
export type ChatTurnResult = ChatTurnResponse & { draft?: ChatDraft };

export type EscalationReason = 'low_confidence' | 'moderation_blocked' | 'user_request' | 'policy';

/** What a handoff tells the caller: the notice shown, and whether we still need an address. */
export interface HandoffOutcome {
  body: string;
  /** True off hours when we hold no email for this shopper — the widget asks. */
  needsContactEmail: boolean;
}

/** Payload published on EVENTS.ESCALATION (consumed by AgentAlertService). */
export interface EscalationEvent {
  tenantId: number;
  conversationId: number;
  sessionId: number | null;
  reason: EscalationReason;
  preview: string;
  /** Agents to address the alert to (PLN-AiSetting W3). Empty = broadcast. */
  targetUserIds?: number[];
  /** Off-hours: mail the summary here instead of paging the console. */
  offHoursEmail?: string;
  /** Issue type/label stamp from a deny rule (P2) — consumed by IssueService/alerts. */
  issueType?: string;
  issueLabel?: string;
}

/**
 * Chat orchestration (SEQ-03/05, S5). Persists turns, classifies intent, runs
 * RAG, applies the mandatory moderation gate, and decides escalation. Every turn
 * is logged (FN-046) and emits a CJM Inquiry event (FN-047).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Assignment) private readonly assignmentRepo: Repository<Assignment>,
    private readonly rag: RagService,
    private readonly moderation: ModerationService,
    private readonly orderService: OrderService,
    private readonly sessionService: SessionService,
    private readonly handoffRouter: HandoffRouterService,
    private readonly bus: EventBusService,
    private readonly customerService: CustomerService,
    private readonly redis: RedisService,
    // Appended last so positional test doubles that predate it stay valid —
    // every use is `this.answerReuse?.` / `this.issueService?.`-guarded.
    private readonly answerReuse?: AnswerReuseService,
    private readonly issueService?: IssueService,
    // Satisfaction lands in the agent's daily row (PLN-260810 P2); appended so
    // existing positional test doubles keep working.
    @InjectRepository(AgentDailyStat)
    private readonly statRepo?: Repository<AgentDailyStat>,
    /** Files uploaded before the send call are claimed here (PLN-260814). */
    private readonly attachments?: AttachmentService,
  ) {}

  /**
   * Bind pre-uploaded files to the turn that carries them. Failure is logged,
   * not thrown: the message itself is already persisted, and losing the whole
   * turn because a file could not be claimed would be the worse outcome.
   */
  private async attachUploads(
    ids: string[] | undefined,
    params: { tenantId: number; messageId: number; conversationId: number; sessionId?: number | null },
  ): Promise<MessageAttachment[]> {
    if (!ids?.length || !this.attachments) return [];
    try {
      return await this.attachments.attachToMessage(ids, params);
    } catch (err) {
      this.logger.warn(`attachment claim failed (message ${params.messageId}): ${String(err)}`);
      return [];
    }
  }

  async getOrCreateConversation(sessionId: number): Promise<Conversation> {
    // Reuse waiting/agent conversations too — a customer replying during or
    // after a handoff must stay in the same thread (FR-S4), not fork a new one.
    const open = await this.convRepo.findOne({
      where: {
        sessionId,
        status: In([
          CONVERSATION_STATUS.AI_ACTIVE,
          CONVERSATION_STATUS.WAITING,
          CONVERSATION_STATUS.AGENT,
        ]),
      },
      order: { id: 'DESC' },
    });
    if (open) return open;
    return this.convRepo.save(
      this.convRepo.create({
        sessionId,
        channel: 'widget',
        status: CONVERSATION_STATUS.AI_ACTIVE,
        escalated: 0,
        agentId: null,
      }),
    );
  }

  /**
   * Read-only lookup of the session's current open conversation (PERF-1).
   * Unlike getOrCreateConversation this NEVER inserts — the widget's 5s poll
   * must not create rows; conversations come into being on the first message.
   */
  async findOpenConversation(sessionId: number): Promise<Conversation | null> {
    return this.convRepo.findOne({
      where: {
        sessionId,
        status: In([
          CONVERSATION_STATUS.AI_ACTIVE,
          CONVERSATION_STATUS.WAITING,
          CONVERSATION_STATUS.AGENT,
        ]),
      },
      order: { id: 'DESC' },
    });
  }

  /**
   * The session's newest conversation regardless of status. The widget's poll
   * needs this so an ENDED thread (customer or agent pressed "end") reports
   * status 'ended' with its history instead of collapsing to 'none' — that
   * status is what renders the "conversation ended" notice (PLN-260808 Track B).
   */
  async findLatestConversation(sessionId: number): Promise<Conversation | null> {
    return this.convRepo.findOne({ where: { sessionId }, order: { id: 'DESC' } });
  }

  /**
   * Customer-side end chat (요구 3, PLN-260808 Track B): end the session's open
   * conversation and release any active agent assignment — the same state
   * transition as the console's end. The session (and sign-in) stays alive; the
   * next message simply opens a fresh conversation (existing open-only lookup).
   * No-op success when nothing is open: pressing "end" twice must not error.
   */
  async endBySession(session: Session): Promise<{ ended: boolean; conversationId: string | null }> {
    const open = await this.findOpenConversation(session.id);
    if (!open) return { ended: false, conversationId: null };
    await this.convRepo.update(
      { id: open.id },
      { status: CONVERSATION_STATUS.ENDED, endedAt: new Date() },
    );
    await this.assignmentRepo.update(
      { conversationId: open.id, status: 'active' },
      { status: 'released', releasedAt: new Date() },
    );
    // Issue P1/B4: a settled issue closes; an untouched received issue may
    // auto-resolve by the last bot tier (customer chose to leave satisfied).
    void this.issueService?.onConversationEnded(open.id, true);
    this.logger.log(`conversation ${open.id} ended by customer (session=${session.id})`);
    return { ended: true, conversationId: String(open.id) };
  }

  /**
   * Record how the customer felt about a finished conversation (PLN-260810 P2).
   *
   * Open to the widget, so ownership is checked the same way `escalate` does
   * it: the session token must belong to this conversation. Ratings are not
   * personal data, so no consent gate — but a stranger must not be able to
   * score someone else's thread.
   */
  async rate(session: Session, conversationId: number, rating: number): Promise<{ rating: number }> {
    const conversation = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conversation || Number(conversation.sessionId) !== Number(session.id)) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    // A thread still running has nothing to rate yet, and one closed long ago
    // is being rated from a stale widget — both are refused rather than
    // silently accepted into the averages.
    const endedAt = conversation.endedAt?.getTime();
    if (conversation.status !== CONVERSATION_STATUS.ENDED || !endedAt) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.CONFLICT);
    }
    if (Date.now() - endedAt > CSAT_WINDOW_MS) {
      this.logger.warn(`csat rejected: conversation=${conversationId} outside the 24h window`);
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.CONFLICT);
    }

    // Re-rating overwrites: a misclick the customer cannot correct produces
    // worse data than one they can (PLN-260810 D6).
    await this.convRepo.update(
      { id: conversationId },
      { csatRating: rating, csatRatedAt: new Date() },
    );
    void this.recordCsatForAgent(conversation).catch((e: Error) =>
      this.logger.warn(`csat stat update failed: ${e.message}`),
    );
    this.logger.log(`csat ${rating}/5 recorded for conversation ${conversationId}`);
    return { rating };
  }

  /**
   * Fold the rating into the handling agent's daily average.
   *
   * `agent_daily_stats.csat_avg` has existed since the console was built and
   * nothing ever wrote it — the satisfaction column read '—' for every agent.
   * Recomputed from the conversations themselves rather than accumulated, so a
   * re-rating corrects the average instead of double-counting.
   */
  private async recordCsatForAgent(conversation: Conversation): Promise<void> {
    const lastAgentMessage = await this.msgRepo.findOne({
      where: { conversationId: conversation.id, senderType: SENDER_TYPE.AGENT },
      order: { id: 'DESC' },
    });
    const agentId = lastAgentMessage?.senderId ?? conversation.agentId;
    if (!agentId || !conversation.tenantId || !conversation.endedAt) return;

    const statDate = conversation.endedAt.toISOString().slice(0, 10);
    const { avg, rated } = await this.csatAverageFor(
      conversation.tenantId,
      Number(agentId),
      statDate,
    );
    if (rated === 0) return;

    const existing = await this.statRepo?.findOne({
      where: { tenantId: conversation.tenantId, agentId: Number(agentId), statDate },
    });
    if (existing) {
      existing.csatAvg = avg;
      await this.statRepo?.save(existing);
      return;
    }
    await this.statRepo?.save(
      this.statRepo.create({
        tenantId: conversation.tenantId,
        agentId: Number(agentId),
        statDate,
        csatAvg: avg,
      }),
    );
  }

  /** Average of every rated conversation that agent closed that day. */
  private async csatAverageFor(
    tenantId: number,
    agentId: number,
    statDate: string,
  ): Promise<{ avg: number; rated: number }> {
    const row = await this.convRepo
      .createQueryBuilder('c')
      .select('AVG(c.csat_rating)', 'avg')
      .addSelect('COUNT(c.csat_rating)', 'rated')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.agent_id = :agentId OR c.id IN (' +
        'SELECT m.conversation_id FROM messages m WHERE m.sender_type = :agent AND m.sender_id = :agentId)',
        { agentId, agent: SENDER_TYPE.AGENT })
      .andWhere('c.csat_rating IS NOT NULL')
      .andWhere('DATE(c.ended_at) = :statDate', { statDate })
      .getRawOne<{ avg: string | null; rated: string }>();
    return { avg: Number(row?.avg ?? 0), rated: Number(row?.rated ?? 0) };
  }

  /**
   * Bounded message read (PERF-1). With `afterId` only newer rows return
   * (delta poll); without it, the LAST `limit` messages in ascending order.
   */
  async listMessages(
    conversationId: number,
    opts?: { afterId?: number; limit?: number },
  ): Promise<Message[]> {
    const limit = opts?.limit ?? 200;
    if (opts?.afterId != null) {
      return this.msgRepo
        .createQueryBuilder('m')
        .where('m.conversation_id = :cid', { cid: conversationId })
        .andWhere('m.id > :after', { after: opts.afterId })
        .orderBy('m.id', 'ASC')
        .take(limit)
        .getMany();
    }
    const latest = await this.msgRepo.find({
      where: { conversationId },
      order: { id: 'DESC' },
      take: limit,
    });
    return latest.reverse();
  }

  /** Agent display names for the given messages, so the widget can show who replied. */
  async resolveSenderNames(messages: Message[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const ids = [
      ...new Set(
        messages
          .filter((m) => m.senderType === SENDER_TYPE.AGENT && m.senderId != null)
          .map((m) => m.senderId as number),
      ),
    ];
    if (ids.length === 0) return map;
    const users = await this.userRepo.find({ where: { id: In(ids) } });
    for (const u of users) {
      if (u.name) map.set(String(u.id), u.name);
    }
    return map;
  }

  async handleUserMessage(
    session: Session,
    text: string,
    opts: { draft?: boolean; attachmentIds?: string[] } = {},
  ): Promise<ChatTurnResult> {
    // Consent gate (PRV-M4, PLN-Privacy-Control-Gap D-1: fail-closed). Only an
    // effective GRANTED — fresh (uncached) read, current notice version — lets
    // the turn proceed; PENDING, DECLINED, and an outdated grant all soft-block:
    // the message is neither persisted nor sent to the AI, no CJM event fires,
    // and the customer gets a localized pointer back to the consent banner.
    // Preview sandbox (/ai-setting) skips the gate: the admin is not a data
    // subject and the session is isolated from alerts/queues/analytics.
    const isPreview = session.channel === 'preview';
    const consent = isPreview
      ? CONSENT_STATE.GRANTED
      : await this.sessionService.effectiveConsentFor(session.id, session.tenantId);
    if (consent !== CONSENT_STATE.GRANTED) {
      return {
        conversationId: null,
        reply: { senderType: 'system', body: sysMsg('consentRequired', session.language) },
        escalate: false,
        needsAuth: false,
      };
    }

    const tenantId = session.tenantId ?? (await this.resolveTenantId());
    const conversation = await this.getOrCreateConversation(session.id);

    const userTurn = await this.persist(tenantId, conversation.id, SENDER_TYPE.USER, text, session.language);
    // Files were uploaded before this call and are claimed here, inside the
    // tenant + session scope — an id from someone else's upload attaches
    // nothing (PLN-260814 §2).
    const attached = await this.attachUploads(opts.attachmentIds, {
      tenantId,
      messageId: Number(userTurn.id),
      conversationId: Number(conversation.id),
      sessionId: Number(session.id),
    });
    await this.bus.publish(EVENTS.CJM, {
      tenantId,
      sessionId: session.id,
      customerId: session.customerId,
      stage: CJM_STAGE.INQUIRY,
      eventType: 'chat_message',
    });

    // Which language is this shopper actually writing in? Runs before any reply
    // is produced so the switch takes effect on the turn that earned it, not
    // the next one (PLN-260813 P2). A photo carries no script to detect, so a
    // file-only turn must not vote on the language.
    if (text.trim()) await this.syncSessionLanguage(session, conversation.id, text);

    // The customer answered the idle check, so the thread is alive again. This
    // must happen BEFORE the agent-mode return below: the threads most likely
    // to have been asked are exactly the ones a human owns, and clearing the
    // latch after that early return would never run for them (PLN-260810 P1).
    if (conversation.idlePromptAt) {
      conversation.idlePromptAt = null;
      await this.convRepo.update({ id: conversation.id }, { idlePromptAt: null });
    }

    // Agent mode (FR-S4): once a human owns the thread the bot stays silent —
    // the message is persisted for the agent console and the customer receives
    // agent replies via conversation polling.
    //
    // A merely QUEUED thread (waiting, nobody assigned) is different: it can sit
    // there for hours, and staying silent meant every further question vanished
    // without a word — the shopper watched an indicator and gave up
    // (FIX-260806 A1). So the bot keeps helping until an agent takes over; the
    // escalation, the alert and the WAITING state all stand.
    const humanOwnsThread =
      conversation.status === CONVERSATION_STATUS.AGENT ||
      (conversation.status === CONVERSATION_STATUS.WAITING && conversation.agentId != null);
    if (humanOwnsThread) {
      return { conversationId: String(conversation.id), reply: null, escalate: false, needsAuth: false };
    }
    const queued = conversation.status === CONVERSATION_STATUS.WAITING;

    // A file with nothing written alongside it (PLN-260814 SI-2). There is no
    // question to classify, nothing to retrieve against and no text to
    // moderate, so the whole AI path is skipped — running it on an empty
    // string would spend a model call to answer nothing. The turn is still
    // persisted, still counts as customer activity, and a queued thread stays
    // silent exactly as it does for a typed message.
    if (!text.trim() && attached.length) {
      if (queued) {
        return { conversationId: String(conversation.id), reply: null, escalate: false, needsAuth: false };
      }
      const body = sysMsg('attachmentReceived', session.language);
      await this.persist(tenantId, conversation.id, SENDER_TYPE.SYSTEM, body, session.language);
      return {
        conversationId: String(conversation.id),
        reply: { senderType: 'system', body },
        escalate: false,
        needsAuth: false,
      };
    }

    // They are typing in the widget again — but that only means replies belong
    // here if somebody is actually on shift to write one. A shopper who follows
    // up five minutes later is still off hours, and clearing the channel then
    // quietly cancelled the email delivery their answer depends on (found in
    // staging verification, PLN-260806 S2).
    if (conversation.replyChannel === 'email') {
      const route = await this.handoffRouter.route(tenantId, session.language);
      if (route.mode !== 'email') {
        conversation.replyChannel = null;
        await this.convRepo.update({ id: conversation.id }, { replyChannel: null });
      }
    }

    // PII minimization (PRV Stage 5): the AI provider gets a scrubbed COPY of
    // the message; the persisted original stays intact (agents need it). Only
    // match counts are logged — never the original text.
    const { text: egressText, counts: piiCounts } = scrubPii(text);
    if (Object.keys(piiCounts).length > 0) {
      this.logger.warn(
        `PII scrubbed from AI egress (conversation ${conversation.id}): ${JSON.stringify(piiCounts)}`,
      );
    }

    // Intent + scope check (FN-015): order data requires authentication first.
    const intent = await this.rag.classifyIntent(tenantId, egressText);
    // Record the label on the turn that produced it. The classifier already
    // runs on every message and its result was discarded after the
    // needsOrderData check below, so the intent statistics lens costs no extra
    // model call — only this write.
    await this.msgRepo.update(
      { id: userTurn.id },
      { intent: intent.intent ?? null, intentConfidence: intent.confidence ?? null },
    );
    // Policy deny-list (P2, REQ §5.3): a matched topic goes to a human no matter
    // how confident the AI would be — the LLM is not even asked. A queued thread
    // stays silent (agents are already paged; see the blocked/low-conf branches).
    const deny = await this.handoffRouter.denyMatch(tenantId, egressText);
    // A rule set to answer first keeps every guarantee it had — the agent is
    // still paged, the issue still stamped — and stops the customer waiting in
    // silence for something the knowledge base already holds (REQ-260826).
    //
    // Not in draft mode: an approval-mode answer is a proposal nobody has
    // delivered, so "answer first" has nothing to show and the immediate
    // handoff stays right.
    const denyAnswersFirst =
      !!deny && deny.mode === DENY_MODE.ANSWER_THEN_HANDOFF && !opts.draft && !queued;
    if (deny && !denyAnswersFirst) {
      if (queued) {
        return { conversationId: String(conversation.id), reply: null, escalate: false, needsAuth: false };
      }
      const handoff = await this.handoff(conversation.id, session, tenantId, 'policy', text, {
        issueType: deny.type,
        issueLabel: deny.label,
      });
      return {
        conversationId: String(conversation.id),
        reply: { senderType: 'system', body: handoff.body },
        escalate: true,
        needsAuth: false,
        needsContactEmail: handoff.needsContactEmail,
      };
    }
    // Carried into the branches below so a deny topic that ends up blocked or
    // unconfident still reaches the right desk: without it the issue would lose
    // the accounting/refund stamp precisely when a person is needed most.
    const denyStamp = deny ? { issueType: deny.type, issueLabel: deny.label } : undefined;
    /**
     * The handoff the rule always required, run now instead of after an answer.
     *
     * Answering first only *defers* the handoff — it never cancels it. Some
     * paths below never reach the knowledge base at all (a deny topic phrased
     * as chit-chat, or an order question from a shopper who is not signed in),
     * and without this they would return a friendly reply and no agent, which
     * is precisely the guarantee the deny-list exists to make.
     */
    const denyHandoffNow = async () => {
      const handoff = await this.handoff(conversation.id, session, tenantId, 'policy', text, denyStamp);
      return {
        conversationId: String(conversation.id),
        reply: { senderType: 'system', body: handoff.body },
        escalate: true,
        needsAuth: false,
        needsContactEmail: handoff.needsContactEmail,
      };
    };

    // The shopper asked for a person (PLN-260813 P1). Placed before retrieval:
    // an answer we are not going to send is a model call we do not need to
    // make. Until now this was not a handoff trigger at all — and because the
    // knowledge base answers "how do I reach an agent?" confidently, it never
    // fell through to the low-confidence branch either, so the AI replied
    // "I'll connect you" and nobody ever came (REQ-260813).
    if (this.wantsHuman(intent, egressText)) {
      if (queued) {
        return { conversationId: String(conversation.id), reply: null, escalate: false, needsAuth: false };
      }
      const handoff = await this.handoff(conversation.id, session, tenantId, 'user_request', text);
      return {
        conversationId: String(conversation.id),
        reply: { senderType: 'system', body: handoff.body },
        escalate: true,
        needsAuth: false,
        needsContactEmail: handoff.needsContactEmail,
      };
    }

    // Nothing to look up (PLN-260813 P2). Placed before retrieval on purpose:
    // searching the knowledge base for "hello" produces "no similar document",
    // and the old code read that as "no answer found" and paged an agent — 19
    // of 34 low-confidence handoffs on staging were greetings, compliments,
    // off-topic questions or noise (REQ-260813).
    const nonQuestion = this.nonQuestionKind(intent);
    if (nonQuestion) {
      // A deny topic that reads as chit-chat is still a deny topic.
      if (denyAnswersFirst) return denyHandoffNow();
      const streak = await this.nonQuestionStreak(conversation.id);
      const drafted = await this.rag.answerWithoutKnowledge(
        tenantId,
        nonQuestion,
        egressText,
        session.language,
        session.aiAgentId ?? null,
      );
      // Same gate as any other AI egress (FR-069, non-bypassable).
      const checked = await this.moderation.moderate({
        tenantId,
        scope: 'ai',
        authorType: 'ai',
        conversationId: conversation.id,
        text: drafted,
      });
      if (checked.decision === MODERATION_DECISION.BLOCKED) {
        const handoff = await this.handoff(
          conversation.id,
          session,
          tenantId,
          'moderation_blocked',
          text,
          denyStamp,
        );
        return {
          conversationId: String(conversation.id),
          reply: { senderType: 'system', body: handoff.body },
          escalate: true,
          needsAuth: false,
          needsContactEmail: handoff.needsContactEmail,
        };
      }
      const offer =
        streak + 1 >= NON_QUESTION_STREAK_FOR_OFFER
          ? ` ${AGENT_OFFER_COPY[session.language?.toUpperCase() ?? 'EN'] ?? AGENT_OFFER_COPY.EN}`
          : '';
      const body = `${checked.text}${offer}`;
      await this.persist(tenantId, conversation.id, SENDER_TYPE.AI, body, session.language, {
        // Recorded so a misclassification can be found later without guessing
        // which turns took this path (PLN-260813 P4).
        answeredFrom: 'no_knowledge',
        nonQuestionKind: nonQuestion,
        intentConfidence: intent.confidence ?? null,
      });
      this.logger.log(
        `handoff skipped: ${nonQuestion} (conf ${intent.confidence ?? 0}) conversation=${conversation.id}`,
      );
      return {
        conversationId: String(conversation.id),
        reply: { senderType: 'ai', body },
        escalate: false,
        needsAuth: false,
      };
    }

    if (intent.needsOrderData && session.customerId == null && !denyAnswersFirst) {
      const body = sysMsg('authRequired', session.language);
      await this.persist(tenantId, conversation.id, SENDER_TYPE.SYSTEM, body, session.language);
      return { conversationId: String(conversation.id), reply: { senderType: 'system', body }, escalate: false, needsAuth: true };
    }

    // Answer-first deny rules skip that gate deliberately (REQ-260826). The
    // classifier marks "환불계좌 바꾸고 싶어" as needing order data, so a guest
    // asking it was told to sign in and handed off with no answer — while the
    // knowledge base held the policy the agent then retyped by hand. Nothing is
    // guessed: a guest has no order context, so the answer is grounded in the
    // knowledge base alone, and the agent still gets the thread.
    //
    // Order questions from a signed-in shopper are answered from their real
    // orders, not guessed from the knowledge base. Only reached once the gate
    // above proved the session is bound to a customer.
    const orderContext =
      intent.needsOrderData && session.customerId != null
        ? await this.buildOrderContext(tenantId, session.customerId)
        : undefined;

    // RAG answer (FN-016/017). The shopper's own words go out scrubbed (Stage 5);
    // `orderContext` does not, on purpose — we build it ourselves from our own
    // database, it already excludes every contact field (see buildOrderContext), and
    // scrubPii would mask the order refs and totals that are the whole point of the
    // grounding. Minimisation happens at construction here, not by redaction after.
    // Group preference (PLN-260804 D3): a product-ish intent nudges retrieval
    // toward the product catalogue. A fallback label carries no information —
    // the classifier's failure value happens to be 'product_inquiry' — so it
    // yields no preference at all.
    const preferGroup =
      !intent.fallback && /product/i.test(intent.intent ?? '') ? DOC_GROUP.PRODUCT : undefined;
    // Answer reuse (요구 5, PLN-260808 Track C): a near-duplicate of an already
    // answered question replays the stored verified answer — no LLM call. Sits
    // BEFORE rag.answer but upstream of the moderation gate below, so a replay
    // is still moderated (FR-069 non-bypassable). Never for order questions:
    // those answers are personal and the reuse store refuses them anyway.
    // Resolved through RAG so replay, retrieval and persona all agree on which
    // agent is speaking (a deactivated pin degrades to the tenant default).
    const effectiveAgentId = await this.rag.effectiveAgentId(tenantId, session.aiAgentId ?? null);
    const reused =
      intent.needsOrderData || !this.answerReuse
        ? null
        : await this.answerReuse.lookup(
            tenantId,
            session.language,
            egressText,
            effectiveAgentId,
          );
    const answer = reused
      ? {
          text: reused.text,
          confidence: reused.confidence,
          citations: reused.citations as RagAnswer['citations'],
        }
      : await this.rag.answer(
          tenantId,
          egressText,
          session.language,
          orderContext,
          preferGroup,
          // Retrieval-only context (FIX-260806 A2): a follow-up like "and for my
          // young son?" carries none of the words its own topic is indexed under,
          // so searching on it alone scored off-topic and escalated a question the
          // knowledge base could answer.
          await this.retrievalQueryFor(conversation.id, userTurn.id, egressText),
          // Resolved, not raw: an unpinned session answers as the tenant's
          // default agent, and RAG applies what it is given rather than
          // guessing what null meant.
          effectiveAgentId,
        );

    // Mandatory moderation gate (FR-069).
    const moderated = await this.moderation.moderate({
      tenantId,
      scope: 'ai',
      authorType: 'ai',
      conversationId: conversation.id,
      text: answer.text,
    });

    // Already queued: the agents have been paged and the customer has seen the
    // handoff notice, so a second one per message would be noise and a duplicate
    // alert. Stay silent for this turn — the widget keeps showing the queued
    // state — rather than escalating what is already escalated.
    if (moderated.decision === MODERATION_DECISION.BLOCKED) {
      // A replay the moderator refuses must never be replayed again.
      if (reused) {
        void this.answerReuse
          ?.deactivate(reused.reuseId, tenantId)
          .catch((e: Error) => this.logger.warn(`reuse deactivate failed: ${e.message}`));
      }
      if (queued) {
        return { conversationId: String(conversation.id), reply: null, escalate: false, needsAuth: false };
      }
      const handoff = await this.handoff(
        conversation.id,
        session,
        tenantId,
        'moderation_blocked',
        text,
        denyStamp,
      );
      return {
        conversationId: String(conversation.id),
        reply: { senderType: 'system', body: handoff.body },
        escalate: true,
        needsAuth: false,
        needsContactEmail: handoff.needsContactEmail,
      };
    }

    // RAG fallback (FR-S3): no confident answer within the knowledge base →
    // hand off to a human instead of replying, and alert the agents.
    if (answer.confidence < ESCALATION_CONFIDENCE) {
      if (queued) {
        return { conversationId: String(conversation.id), reply: null, escalate: false, needsAuth: false };
      }
      const handoff = await this.handoff(
        conversation.id,
        session,
        tenantId,
        'low_confidence',
        text,
        denyStamp,
      );
      return {
        conversationId: String(conversation.id),
        reply: { senderType: 'system', body: handoff.body },
        escalate: true,
        needsAuth: false,
        needsContactEmail: handoff.needsContactEmail,
      };
    }

    if (opts.draft) {
      // Approval mode: the answer is a proposal, not a message. Persisting it
      // would deliver it — the widget poll and the channel outbox both read
      // `messages` — and reuse must not learn from an answer nobody approved.
      return {
        conversationId: String(conversation.id),
        reply: null,
        draft: {
          body: moderated.text,
          confidence: answer.confidence,
          citations: answer.citations,
        },
        escalate: false,
        needsAuth: false,
      };
    }

    const aiTurn = await this.persist(tenantId, conversation.id, SENDER_TYPE.AI, moderated.text, session.language, {
      citations: answer.citations,
      confidence: answer.confidence,
      // Console diagnostics: which answers came from the reuse store (D-C2:
      // the customer sees no marker; the trace always records it).
      ...(reused ? { answeredFrom: 'reuse', reuseId: reused.reuseId } : {}),
    });
    if (reused) {
      void this.answerReuse?.recordHit(reused.reuseId);
    } else {
      // A freshly generated, delivered answer becomes a reuse candidate (the
      // service applies the D-C1 filters: cited + confident, no order context).
      void this.answerReuse?.recordAiAnswer({
        tenantId,
        lang: session.language,
        question: egressText,
        answerText: moderated.text,
        confidence: answer.confidence,
        citations: answer.citations,
        sourceMessageId: aiTurn.id,
        needsOrderData: intent.needsOrderData ?? false,
        aiAgentId: effectiveAgentId,
      });
    }

    // Answer delivered; now the handoff the deny rule always required. Ordering
    // matters: the AI turn is persisted first, so the customer reads the answer
    // and then the notice rather than being told to wait and answered after.
    const denyHandoff = denyAnswersFirst
      ? await this.handoff(conversation.id, session, tenantId, 'policy', text, denyStamp)
      : null;

    return {
      conversationId: String(conversation.id),
      // confidence rides along for the admin preview diagnostics; widget ignores it.
      reply: {
        senderType: 'ai',
        body: moderated.text,
        citations: answer.citations,
        confidence: answer.confidence,
        // Lets the /ai-setting preview hand this exact turn to the coaching tab.
        messageId: String(aiTurn.id),
      },
      escalate: !!denyHandoff,
      needsAuth: false,
      ...(denyHandoff ? { needsContactEmail: denyHandoff.needsContactEmail } : {}),
    };
  }

  /**
   * Search text for this turn: the shopper's earlier questions prepended to the
   * current one (FIX-260806 A2). Retrieval only — the model is still asked the
   * current message alone. A follow-up carries none of the vocabulary its topic
   * is indexed under ("thanks, and recomend my young son." after a skincare
   * question), so searching on it alone scored off-topic and escalated a
   * question the catalogue could answer. PII is scrubbed here too: this text
   * reaches the embedding provider.
   */
  private async retrievalQueryFor(
    conversationId: number,
    currentTurnId: number,
    current: string,
  ): Promise<string> {
    const previous = await this.msgRepo.find({
      where: {
        conversationId,
        senderType: SENDER_TYPE.USER,
        id: LessThan(currentTurnId),
      },
      order: { id: 'DESC' },
      take: RETRIEVAL_CONTEXT_TURNS,
      select: { id: true, body: true },
    });
    if (previous.length === 0) return current;
    const history = previous
      .reverse()
      .map((m) => scrubPii(m.body).text.trim().slice(0, RETRIEVAL_CONTEXT_CHARS))
      .filter(Boolean);
    return [...history, current].join('\n');
  }

  /**
   * Hand the conversation to humans (FR-S3/S4): persist the localized handoff
   * notice, mark the thread waiting, and publish the escalation event that
   * fans out to console modal / email / Slack alerts.
   */
  /**
   * Which "nothing to answer" kind this turn is, or null (PLN-260813 P2).
   *
   * The same two guards as the handoff trigger: a failed classification is not
   * a signal, and low confidence is not either. Getting this wrong in the
   * permissive direction is the worse failure — a real question answered with
   * a greeting and no human — so both gates stay closed by default.
   */
  private nonQuestionKind(intent: {
    intent?: string | null;
    confidence?: number | null;
    fallback?: boolean;
  }): 'smalltalk' | 'out_of_scope' | 'unintelligible' | null {
    if (intent.fallback) return null;
    const label = intent.intent ?? '';
    if (!NON_QUESTION_INTENTS.has(label)) return null;
    if ((intent.confidence ?? 0) < AGENT_REQUEST_CONFIDENCE) {
      this.logger.log(`non-question below threshold (${intent.confidence ?? 0}) — answering normally`);
      return null;
    }
    return label as 'smalltalk' | 'out_of_scope' | 'unintelligible';
  }

  /**
   * How many of the immediately preceding customer turns had nothing to answer.
   * Read from `messages.intent`, which is already written every turn — no new
   * column, and it survives a restart.
   */
  private async nonQuestionStreak(conversationId: number): Promise<number> {
    const recent = await this.msgRepo.find({
      where: { conversationId, senderType: SENDER_TYPE.USER },
      order: { id: 'DESC' },
      take: NON_QUESTION_STREAK_FOR_OFFER,
      select: ['id', 'intent'],
    });
    // The current turn is already persisted, so skip it and count backwards.
    let streak = 0;
    for (const message of recent.slice(1)) {
      if (!message.intent || !NON_QUESTION_INTENTS.has(message.intent)) break;
      streak += 1;
    }
    return streak;
  }

  /**
   * Follow the shopper's language (PLN-260813 P2, D1/D2/D3/D5).
   *
   * The AI already matches whatever language a message is written in, turn by
   * turn; system copy reads one fixed `session.language` chosen when the widget
   * opened. That gap is the whole bug — a Korean conversation carrying English
   * off-hours notices (REQ-260813).
   *
   * Two consecutive turns in the same language are required. One is not enough:
   * a single "thanks" mid-conversation would otherwise turn every later notice
   * English and leave it there. Short messages detect as null and so break the
   * agreement rather than driving it — which is the intent, not a side effect.
   */
  private async syncSessionLanguage(
    session: Session,
    conversationId: number,
    text: string,
  ): Promise<void> {
    // The shopper chose this language by hand. Detection does not get a vote.
    if (session.languageLocked) return;

    // The session's current language breaks ties on marks that Vietnamese
    // shares with Spanish (FIX-260916); a locked session never reaches here.
    const detected = detectLanguage(text, session.language);
    if (!detected || detected === session.language) return;

    // The current turn is already persisted, so the previous customer turn is
    // the second row back.
    const recent = await this.msgRepo.find({
      where: { conversationId, senderType: SENDER_TYPE.USER },
      order: { id: 'DESC' },
      take: 2,
      select: ['id', 'body'],
    });
    const previous = recent[1];
    if (!previous || detectLanguage(previous.body, session.language) !== detected) return;

    await this.sessionService.applyDetectedLanguage(session, detected);
  }

  /**
   * Does this turn mean "get me a person"? (PLN-260813 P1, D1/D2)
   *
   * Two signals, in order. The classifier is the primary one; the phrase list
   * covers what it misses — a typo, a language it read poorly, or a run where
   * the JSON came back unparseable.
   *
   * A failed classification is NOT a signal. Its fallback label is a confident
   * `product_inquiry`, and reading a parse failure as a request for a human
   * would put shoppers in the queue because a model call hiccuped.
   */
  private wantsHuman(
    intent: { intent?: string | null; confidence?: number | null; fallback?: boolean },
    text: string,
  ): boolean {
    if (AGENT_REQUEST_PHRASES.test(text)) return true;
    if (intent.fallback || intent.intent !== 'agent_request') return false;
    const confidence = intent.confidence ?? 0;
    if (confidence >= AGENT_REQUEST_CONFIDENCE) return true;
    // Kept visible so the threshold can be judged on real traffic rather than
    // guessed at again (PLN-260813 P3).
    this.logger.log(
      `agent_request below threshold (${confidence} < ${AGENT_REQUEST_CONFIDENCE}) — not handing off`,
    );
    return false;
  }

  async handoff(
    conversationId: number,
    session: Session,
    tenantId: number,
    reason: EscalationReason,
    preview: string,
    stamp?: { issueType?: string; issueLabel?: string },
  ): Promise<HandoffOutcome> {
    // Routing decides both who gets paged and what the customer is told:
    // outside business hours the message goes to a mailbox and the shopper is
    // told to expect an email reply instead of a live agent (PLN-AiSetting W3).
    const route = await this.handoffRouter.route(tenantId, session.language);
    // Off hours the answer travels by email, so we need somewhere to send it.
    // Without an address on file the widget asks for one (PLN-260806) and the
    // notice says so, instead of promising a reply we cannot deliver.
    const needsContactEmail =
      route.mode === 'email' && !(await this.hasContactEmail(tenantId, session));
    const body = needsContactEmail
      ? sysMsg('offHoursNeedEmail', session.language)
      : route.mode === 'email' && route.notice
        ? route.notice
        : sysMsg('handoff', session.language);
    await this.persist(tenantId, conversationId, SENDER_TYPE.SYSTEM, body, session.language, { reason });
    // Preview sandbox: show the real handoff notice but never page the agents —
    // no WAITING flip (the bot keeps answering for iterative testing), no alert
    // fan-out, no console-queue entry.
    if (session.channel === 'preview') return { body, needsContactEmail: false };
    await this.markWaiting(conversationId);
    // Remember how this thread must be answered: an agent replying tomorrow has
    // no one in the widget to read it (see AgentService.sendMessage).
    if (route.mode === 'email') {
      await this.convRepo.update({ id: conversationId }, { replyChannel: 'email' });
    }
    const event: EscalationEvent = {
      tenantId,
      conversationId,
      sessionId: session.id,
      reason,
      preview: preview.slice(0, 300),
      targetUserIds: route.targetUserIds,
      offHoursEmail: route.mode === 'email' ? route.email : undefined,
      issueType: stamp?.issueType,
      issueLabel: stamp?.issueLabel,
    };
    await this.bus.publish(EVENTS.ESCALATION, event);
    return { body, needsContactEmail };
  }

  /**
   * Store the address an off-hours shopper wants their answer sent to
   * (PLN-260806). Runs through the lead path so the erasure-suppression check
   * and encrypted storage apply exactly as they do for an agent-entered
   * address, and binds the session so the reply can find the customer.
   * Consent-gated: collecting an address is processing personal data.
   */
  async saveContactEmail(session: Session, email: string): Promise<{ body: string }> {
    const consent = await this.sessionService.effectiveConsentFor(session.id, session.tenantId);
    if (consent !== CONSENT_STATE.GRANTED) {
      throw new BusinessException(ERROR_CODE.CONSENT_REQUIRED, HttpStatus.FORBIDDEN);
    }
    const tenantId = session.tenantId ?? (await this.resolveTenantId());
    const customer = await this.customerService.createFromLead(tenantId, { email });
    if (session.customerId !== customer.id) {
      await this.sessionRepo.update({ id: session.id }, { customerId: customer.id });
      // The token→session cache would otherwise keep serving the unbound row.
      await this.redis.del(sessionCacheKey(session.sessionToken));
    }
    const conversation = await this.findOpenConversation(session.id);
    const body = sysMsg('contactEmailSaved', session.language);
    if (conversation) {
      await this.persist(tenantId, conversation.id, SENDER_TYPE.SYSTEM, body, session.language);
    }
    return { body };
  }

  /** Do we already hold an address to send this shopper's answer to? */
  private async hasContactEmail(tenantId: number, session: Session): Promise<boolean> {
    if (session.customerId == null) return false;
    return !!(await this.customerService.contactEmail(tenantId, session.customerId));
  }

  /** Explicit "talk to an agent" request from the widget (FR-015). */
  /**
   * Escalate to a human (FR-015). SEC-L3: the conversation must belong to the
   * caller's own session — a `@Public()` endpoint keyed on a raw, enumerable
   * conversation id must not let anyone force-escalate another visitor's chat.
   */
  async escalate(session: Session, conversationId: number): Promise<void> {
    const conversation = await this.convRepo.findOne({ where: { id: conversationId } });
    // Number() both sides: session.id is a bare bigint PK (hydrates as a string)
    // while conversation.sessionId goes through bigintTransformer (number).
    if (!conversation || Number(conversation.sessionId) !== Number(session.id)) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    if (session.channel === 'preview') return; // sandbox: never page the agents
    const lastUser = await this.msgRepo.findOne({
      where: { conversationId, senderType: SENDER_TYPE.USER },
      order: { id: 'DESC' },
    });
    const tenantId = session.tenantId ?? conversation.tenantId ?? 0;
    // Same routing as the automatic handoff (PLN-AiSetting W3). Off hours the
    // widget's local "connecting you" line would be a lie, so persist the
    // off-hours notice — the conversation poll shows it to the customer.
    const route = await this.handoffRouter.route(tenantId, session.language);
    if (route.mode === 'email' && route.notice) {
      await this.persist(tenantId, conversationId, SENDER_TYPE.SYSTEM, route.notice, session.language, {
        reason: 'user_request',
      });
    }
    await this.markWaiting(conversationId);
    const event: EscalationEvent = {
      tenantId,
      conversationId,
      sessionId: session.id,
      reason: 'user_request',
      preview: (lastUser?.body ?? '').slice(0, 300),
      targetUserIds: route.targetUserIds,
      offHoursEmail: route.mode === 'email' ? route.email : undefined,
    };
    await this.bus.publish(EVENTS.ESCALATION, event);
  }

  // ---- helpers ----
  /**
   * Compact, factual summary of the customer's recent orders for the RAG prompt.
   * Deliberately order-only: no email, phone or address is sent to the AI provider
   * (PRV — minimise PII leaving the system); the shopper is asking about orders,
   * so order number, dates, status, totals and item titles are what's needed.
   * Never throws — losing the enrichment must not break the reply.
   */
  private async buildOrderContext(
    tenantId: number,
    customerId: number,
  ): Promise<string | undefined> {
    try {
      const recent = await this.orderService.recentForCustomer(
        tenantId,
        customerId,
        ORDER_CONTEXT_LIMIT,
      );
      if (!recent.length) return undefined;
      return recent
        .map(({ order, items }) => {
          const placed = order.createdAt ? order.createdAt.toISOString().slice(0, 10) : 'unknown';
          const total =
            order.total != null ? `${order.total} ${order.currency ?? ''}`.trim() : 'unknown';
          const lines = items.length
            ? items
                .map((i) => `${i.title}${i.optionText ? ` (${i.optionText})` : ''} x${i.qty}`)
                .join(', ')
            : 'no item details cached';
          return (
            `- Order ${order.orderNumber}: status ${order.statusUi ?? order.statusInternal ?? 'unknown'}` +
            `, placed ${placed}, total ${total}, items: ${lines}`
          );
        })
        .join('\n');
    } catch (e) {
      this.logger.warn(`Order context unavailable for customer ${customerId}: ${(e as Error).message}`);
      return undefined;
    }
  }

  /**
   * `tenantId` is passed explicitly rather than left to `TenantSubscriber`'s
   * auto-stamp: the subscriber only fires inside a request's tenant context, so
   * a write from an event consumer — or a widget request whose session token
   * failed to resolve while more than one tenant exists — would land a row with
   * a null tenant_id and silently drop out of every tenant-scoped statistic.
   */
  private async persist(
    tenantId: number | null,
    conversationId: number,
    senderType: string,
    body: string,
    lang: string,
    trace?: unknown,
  ): Promise<Message> {
    return this.msgRepo.save(
      this.msgRepo.create({ tenantId, conversationId, senderType, body, lang, retrievalTrace: trace ?? null }),
    );
  }

  private async markWaiting(conversationId: number): Promise<void> {
    await this.convRepo.update({ id: conversationId }, { status: CONVERSATION_STATUS.WAITING, escalated: 1 });
  }

  private async resolveTenantId(): Promise<number> {
    const tenant = await this.tenantRepo.findOne({ where: {}, order: { id: 'ASC' } });
    return tenant?.id ?? 0;
  }
}
