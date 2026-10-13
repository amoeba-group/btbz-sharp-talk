import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  AUDIENCE_RANK,
  CJM_STAGE,
  CONSENT_STATE,
  CONVERSATION_STATUS,
  GATE_DECISION,
  MODERATION_DECISION,
  REFUSAL_REASON,
  SENDER_TYPE,
  audienceOf,
  buildHandoffTrace,
  buildRefusalTrace,
  kbVersionCaveatVariants,
  localized,
} from '@sharptalk/types';
import type { Audience, LocalizedText } from '@sharptalk/types';
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
import { effectiveIdentity } from '../session/identity.util';
import type { EffectiveIdentity } from '../session/identity.util';
import { CustomerService } from '../customer/customer.service';
import { HandoffRouterService, TEAM_CHIP_PREFIX } from '../ai-engine/handoff-router.service';
import type { RegionLookup, TeamQuestion } from '../ai-engine/handoff-router.service';
import { EventBusService, EVENTS, RedisService } from '../../infrastructure/infrastructure.module';
import { AttachmentService } from '../attachment/attachment.service';
import { MessageAttachment } from '../attachment/entity/message-attachment.entity';
import { scrubPii } from '../../global/util/pii-scrub.util';
import { detectLanguage } from '../../global/util/detect-language.util';
import { buildTurnLatency, elapsedMs } from './turn-latency.util';
import { DENY_MODE } from '../ai-engine/entity/tenant-ai-config.entity';
import type { AiMessage } from '../../infrastructure/external/ai/ai-adapter.interface';
import {
  HISTORY_MESSAGES,
  INTENT_HISTORY_MESSAGES,
  buildHistory,
  hasAssistantTurn,
  replacePiiTokens,
  retrievalQuery,
} from './conversation-history.util';
import { footerFor, footerVariants, stripFooters } from '../ai-engine/answer-footer.util';
import { PartnerDataStep } from '../partner-data/partner-data.step';
import type { PartnerNotice } from '../partner-data/partner-data.step';
import { PilotService } from '../pilot/pilot.service';
import { ObserveChatTurn, markTurnOutcome, observeTurnLatency } from '../../infrastructure/observability/app-metrics';
import { partnerLabelOfClaims } from '../../global/util/partner-label.util';
import { escalationPreview } from './escalation-preview.util';
import { FOLLOW_UP_AGENT } from './scenario-scripts';
import { historyExceedsViewer } from './conversation-audience.util';
import {
  ESCALATION_CONFIDENCE,
  decideGuestGate,
  decideLowConfidence,
  gateTraceExtras,
} from './gate-decision';
import type { GateDecision } from './gate-decision';

// ESCALATION_CONFIDENCE (the handoff bar) and GUEST_GATE_CONFIDENCE (the guest gate's bar, PLN-261001)
// now live with the gate decision they parameterise, so chat and the console simulator read ONE
// definition (PLN-261012 SG-51).

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
  // Guest gate (PLN-261001 v1.1 B5/T4): an unidentified visitor of a
  // login_guidance agent asked something outside the guest-visible knowledge.
  // A tenant may override the line per language (guest_guidance.notice).
  loginRequired: {
    EN: 'This information is for signed-in partners. Please sign in to your partner account and I will walk you through it.',
    ES: 'Esta información es para socios con sesión iniciada. Inicia sesión en tu cuenta de socio y te guiaré paso a paso.',
    KO: '이 내용은 로그인한 파트너에게만 안내해 드릴 수 있습니다. 파트너 계정으로 로그인하시면 자세히 안내해 드릴게요.',
    VI: 'Nội dung này dành cho đối tác đã đăng nhập. Vui lòng đăng nhập tài khoản đối tác để tôi hướng dẫn chi tiết.',
    JA: 'この内容はログイン済みのパートナー様向けです。パートナーアカウントでログインしていただければ、詳しくご案内します。',
    ZH: '此内容仅面向已登录的合作伙伴。请登录您的合作伙伴账户，我会为您详细说明。',
  },
  // A receptionist asked a topic only manager-only KB categories cover (PLN-261012 SG-10): the
  // content is NOT shown — they are pointed to the hotel's manager account and offered a person.
  // A tenant may override the line per language (guest_guidance.managerNotice).
  managerOnly: {
    EN: "That information is only shared with your hotel's manager account. Please ask your hotel's manager to look it up, or tell me if you'd like me to connect you with a support agent.",
    ES: 'Esa información solo se comparte con la cuenta de gerente de tu hotel. Pídele al gerente de tu hotel que la consulte, o dime si prefieres que te conecte con un agente de soporte.',
    KO: '이 내용은 호텔 매니저 계정에게만 안내해 드릴 수 있습니다. 호텔 매니저께 확인을 요청해 주시거나, 상담원 연결이 필요하시면 말씀해 주세요.',
    VI: 'Nội dung này chỉ được cung cấp cho tài khoản Quản lý của khách sạn. Bạn vui lòng nhờ Quản lý khách sạn tra cứu giúp, hoặc cho tôi biết nếu bạn muốn được kết nối với nhân viên hỗ trợ.',
    JA: 'この内容はホテルのマネージャーアカウントにのみご案内できます。ホテルのマネージャーにご確認いただくか、サポート担当者へのおつなぎをご希望でしたらお知らせください。',
    ZH: '此内容仅向贵酒店的经理账户提供。请让酒店经理查询，或告诉我，我可以为您转接客服人员。',
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
  // The AI engine (or the moderation path) is down — NOT "knowledge is missing" (PLN-261012 SG-84).
  // Used by handoff() for reason 'engine_unavailable'; promises a person, never an answer.
  engineUnavailable: {
    EN: "Our assistant is temporarily unavailable, so I can't answer this right now. I'm passing your question to our support team — we'll get back to you shortly and a person will help you right here.",
    ES: 'Nuestro asistente no está disponible temporalmente, por lo que ahora mismo no puedo responder. Paso tu consulta a nuestro equipo de soporte: te confirmaremos en breve y una persona te atenderá aquí mismo.',
    KO: '현재 AI 어시스턴트를 일시적으로 이용할 수 없어 바로 답변드리기 어렵습니다. 문의 내용을 상담팀에 전달했으며, 곧 확인하여 상담원이 이 대화창에서 도와드리겠습니다.',
    VI: 'Trợ lý tự động hiện đang tạm thời gián đoạn nên tôi chưa thể trả lời ngay. Tôi đã chuyển câu hỏi của bạn cho đội hỗ trợ — chúng tôi sẽ xác nhận lại với bạn trong giây lát và sẽ có nhân viên hỗ trợ bạn ngay tại đây.',
    JA: '現在、アシスタントを一時的にご利用いただけないため、すぐにお答えできません。ご質問をサポートチームに引き継ぎました。確認のうえ、担当者がまもなくこちらでご案内します。',
    ZH: '智能助手暂时无法使用，暂时无法立即回答您的问题。我已将您的问题转交给客服团队，我们会尽快确认，并由专人在此为您提供帮助。',
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
/**
 * One prompt line describing the signed partner behind a session (REQ-261006
 * H6), or undefined for guests and v1 identities. Only the signed fields and
 * the display name travel — never email or phone.
 */
export function partnerContextOf(
  session: Pick<Session, 'identityClaims'>,
  /** Pass the identity the caller already resolved; omitted = resolved here with the platform default. */
  identity: EffectiveIdentity = effectiveIdentity(session),
): string | undefined {
  // The claims in force, not the stored ones: lapsed claims must not keep naming
  // a hotel in the prompt (PLN-261012 SG-03).
  const claims = identity.claims;
  if (!claims?.signed || !claims.hotelSn) return undefined;
  const name = claims.hotelName?.trim() || 'the partner hotel';
  const code = claims.hotelCode?.trim() ? `, code ${claims.hotelCode.trim()}` : '';
  return `The user is partner staff of ${name} (hotelSn ${claims.hotelSn}${code}), role: ${claims.role}.`;
}

/** Short partner label for alert channels and ticket notes (REQ-261006 H4), or undefined. */
export function partnerLabelOf(
  session: Pick<Session, 'identityClaims'>,
  identity: EffectiveIdentity = effectiveIdentity(session),
): string | undefined {
  // The claims in force, not the stored ones (SG-03); the label itself is built by the
  // shared util so the alert path and the console read the same words (SG-66).
  return partnerLabelOfClaims(identity.claims);
}

/**
 * The region fields of an escalation event from what `stampRegion` found: the
 * hotel's team and wording, or — region routing on, province not in the table —
 * the unmapped province for the alert line; nothing otherwise.
 */
export function regionEventFields(
  region: StampedRegion | null,
): Pick<EscalationEvent, 'supportRegion' | 'regionLabel' | 'regionUnmapped' | 'regionMode'> {
  if (!region) return {};
  const mode = region.mode ? { regionMode: region.mode } : {};
  return 'unmapped' in region
    ? { regionUnmapped: region.unmapped, ...mode }
    : { supportRegion: region.team, regionLabel: region.label, ...mode };
}

/** What `stampRegion` found: the hotel team, or the province the table does not list. */
export type StampedRegion =
  | { team: string; label: string; mode?: 'prefer' | 'strict' }
  | { unmapped: string; mode?: 'prefer' | 'strict' };

/** Longest province text kept on a conversation as the unmapped hint (varchar(64)). */
const REGION_HINT_MAX = 64;

export function sysMsg(key: keyof typeof SYSTEM_MESSAGES, lang: string): string {
  return localized(SYSTEM_MESSAGES[key], lang);
}

/** The "Talk to an agent" chip scripts end with, in the session language (PLN-261012 SG-10). */
export function agentConnectChip(language: string): { id: string; label: string } {
  return { id: FOLLOW_UP_AGENT.id, label: localized(FOLLOW_UP_AGENT.label, language) };
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

export type EscalationReason =
  | 'low_confidence'
  | 'moderation_blocked'
  | 'user_request'
  | 'policy'
  /** The AI engine or the moderation path failed — an outage, not missing knowledge (PLN-261012 SG-84). */
  | 'engine_unavailable'
  /**
   * The partner-data step could not read the hotel's data / could not verify a figure (SG-31). They
   * used to be published as `low_confidence`, which told the person paged "no answer in the
   * knowledge base" for a partner-API outage (w3c, ops-manual finding 5).
   */
  | 'partner_unavailable'
  | 'partner_unverified';

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
  /**
   * Signed partner context in one line (REQ-261006 H4), e.g.
   * "A In Hotel Del Luna (1721) · receptionist" — for the alert channels, so
   * CS knows which hotel is paging before opening the console. Absent for
   * guests and v1 identities.
   */
  partnerLabel?: string;
  /**
   * The team the customer picked (PLN-261007 Team Routing): option id and
   * its wording, for the alert channels. `issueLabel` carries the job label
   * that actually routes it.
   */
  supportType?: string;
  supportLabel?: string;
  /**
   * The regional team (north | south) that looks after the hotel, from the
   * signed province claim (PLN-261007 Hotel Region Routing). The alert prefers
   * agents of that team; `regionLabel` is the wording for the channels.
   */
  supportRegion?: string;
  regionLabel?: string;
  /**
   * Set when region routing is on and the signed province is not in the table
   * (PLN-261012 SG-61): the alert says so instead of silently showing no region.
   */
  regionUnmapped?: string;
  /**
   * The region table's mode when region routing is on (PLN-261012 SG-67): `strict` keeps
   * the alert inside the hotel's region. Absent = `prefer`, today's behaviour.
   */
  regionMode?: 'prefer' | 'strict';
}

/** How a caller of `escalate` differs from the widget. */
export interface EscalateOptions {
  /**
   * False for channels that cannot render the team chips (Messenger, Zalo, Telegram …):
   * the hand-off happens at once, routed by the default label, instead of asking
   * a question nobody can answer (PLN-261012 SG-65). Default true.
   */
  askTeam?: boolean;
}

/** What `escalate` tells the widget (PLN-261007 Team Routing). */
export interface EscalateOutcome {
  /** True once the agents are paged. False while the team question is pending. */
  escalated: boolean;
  /** The team question was asked instead; its chips travel with the thread. */
  choose: boolean;
  /** Notice persisted for the customer this call (team question or off-hours), if any. */
  body: string | null;
  followUps?: Array<{ id: string; label: string }>;
  /**
   * Off-hours hand-off with no address on file: the widget asks for one so the
   * agent's reply has somewhere to go — the same flag `handoff()` returns
   * (PLN-261012 SG-62). Present (true) only then; absent in hours and on the
   * team-question and preview paths.
   */
  needsContactEmail?: boolean;
  /** Refused by the pilot allowlist (PLN-261012 SG-40): `body` is the notice, nobody was paged. */
  pilotDenied?: boolean;
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
    /**
     * Partner data lookup (PLN-261012 SG-31): grounds a signed-in hotel user's
     * rate / policy / booking / settlement question in the hotel's own live data.
     * Appended last and optional, like the others — specs that predate it build
     * the service without it and see exactly the old behaviour.
     */
    private readonly partnerData?: PartnerDataStep,
    /** Pilot allowlist by hotel (PLN-261012 SG-40); appended so positional specs keep working. */
    private readonly pilot?: PilotService,
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

  /**
   * What the session may be treated as right now (PLN-261012 SG-03): signed claims
   * past the max age read as a guest. Falls back to the platform default when a
   * positional SessionService double predates `identityOf`.
   */
  private identityOf(session: Session): Promise<EffectiveIdentity> {
    return this.sessionService.identityOf
      ? this.sessionService.identityOf(session)
      : Promise.resolve(effectiveIdentity(session));
  }

  /**
   * The AI agent that speaks for this session (the pin, or the tenant default),
   * or null. Never throws: a stamp or a trace must not cost the customer a reply.
   */
  private async speakingAgentId(tenantId: number | null, session: Session): Promise<number | null> {
    if (tenantId == null) return null;
    try {
      return (await this.rag.effectiveAgentId?.(tenantId, session.aiAgentId ?? null)) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * What a new conversation is stamped with (PLN-261012 SG-50): the signed hotel
   * and role — only when the claims are in force — and the effective AI agent.
   * Public so channels that create their own conversation rows (Messenger) stamp
   * them the same way.
   */
  async conversationStamps(
    session: Session,
    identity?: EffectiveIdentity,
  ): Promise<{ hotelSn: string | null; actorRole: string | null; aiAgentId: number | null }> {
    const claims = (identity ?? (await this.identityOf(session))).claims;
    return {
      hotelSn: claims?.signed && claims.hotelSn ? String(claims.hotelSn).slice(0, 32) : null,
      actorRole: claims?.signed && claims.role ? String(claims.role).slice(0, 16) : null,
      aiAgentId: await this.speakingAgentId(session.tenantId ?? null, session),
    };
  }

  async getOrCreateConversation(sessionId: number, session?: Session): Promise<Conversation> {
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
        // Who and what this thread is with, as of now (PLN-261012 SG-50). Callers
        // that only know the id (older specs) stamp nothing.
        ...(session ? await this.conversationStamps(session) : {}),
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

  /**
   * Agent display names for the given messages, so the widget can show who replied. Customer-facing:
   * only the `users.name` a tenant chose to give is shown. The staff-facing e-mail-words fallback
   * (`displayNameOf`) is deliberately NOT used here - it would put part of an address into a
   * customer's chat (w3c, ops-manual finding 13; pinned by staff-display-name.spec.ts).
   */
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

  @ObserveChatTurn()
  async handleUserMessage(
    session: Session,
    text: string,
    opts: { draft?: boolean; attachmentIds?: string[] } = {},
  ): Promise<ChatTurnResult> {
    const turnStartedAt = Date.now(); // per-turn latency (PLN-261012 SG-53)
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

    // Pilot allowlist gate (PLN-261012 SG-40) — the authoritative half, judged on the
    // SIGNED hotel of this session (never on anything typed or on what the widget
    // chose to show). A hotel outside the list gets the tenant's notice as a soft
    // system line, exactly like the consent block above: the turn is neither
    // persisted nor sent to a model, no conversation is opened and no CJM event
    // fires. The refusal is logged by PilotService (reason pilot_denied) — with
    // nothing stored there is no message row to carry a trace. Preview is exempt for
    // the same reason it skips consent: the console admin is not a hotel.
    const pilotDenial = isPreview ? null : await this.pilot?.denialFor(session);
    if (pilotDenial) {
      return {
        conversationId: null,
        reply: { senderType: 'system', body: pilotDenial.body },
        escalate: false,
        needsAuth: false,
        pilotDenied: true,
      };
    }

    const tenantId = session.tenantId ?? (await this.resolveTenantId());
    // Signed claims past their max age read as a guest from here on (PLN-261012
    // SG-03): the gate, the order-auth check, the prompt's partner line and the
    // conversation stamps all use this view, never the stored columns.
    const identity = await this.identityOf(session);
    // Who this answer is FOR (PLN-261012 SG-10): the effective identity, so lapsed claims
    // read as a guest. Passed to every retrieval below and to the reuse store.
    const audience = audienceOf(identity);
    const conversation = await this.getOrCreateConversation(session.id, session);

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
      // The same team/region scope as the hand-off decided with, so a per-team or
      // per-region schedule does not flip the reply channel back mid-thread (SG-67).
      const route = await this.handoffRouter.route(tenantId, session.language, {
        region: conversation.supportRegion,
        supportType: conversation.supportType,
      });
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

    // The conversation so far, scrubbed like the message itself (PLN-260929 S1).
    // Loaded once and shared by the classifier, both answering paths and the
    // reuse gate — every model call used to see this turn alone, so the
    // assistant asked for a booking's details again right after receiving them.
    // The tenant footer's texts, stripped from earlier answers before they go
    // back to the model (it copied the block and then the system added it again).
    const footerCfg = (await this.rag.footerConfig?.(tenantId)) ?? null;
    const variants = footerVariants(footerCfg);
    // KB UI-version caveat (PLN-261012 SG-20): its sentences are stripped from
    // earlier answers for the same reason — the model copies what it reads.
    const versionPolicy = (await this.rag.kbVersionPolicy?.(tenantId)) ?? null;
    const caveatTexts = kbVersionCaveatVariants(versionPolicy);
    // A thread held at a higher tier than the viewer's tier now must not feed the model its
    // earlier turns (PLN-261012 SG-11): see `historyReadableBy`.
    const history = (await this.historyReadableBy(conversation, audience, tenantId))
      ? await this.conversationHistory(conversation.id, userTurn.id, [...variants, ...caveatTexts])
      : [];

    // Intent + scope check (FN-015): order data requires authentication first.
    const classifyT0 = Date.now();
    const intent = await this.rag.classifyIntent(
      tenantId,
      egressText,
      history.slice(-INTENT_HISTORY_MESSAGES),
    );
    const classifyMs = elapsedMs(classifyT0);
    // Record the label on the turn that produced it. The classifier already
    // runs on every message and its result was discarded after the
    // needsOrderData check below, so the intent statistics lens costs no extra
    // model call — only this write.
    await this.msgRepo.update(
      { id: userTurn.id },
      { intent: intent.intent ?? null, intentConfidence: intent.confidence ?? null },
    );
    // A tenant with no orders (hotel partner desk, B2B help desk — PLN-261001)
    // has nothing to sign in to: "오늘 예약 현황" is a how-to question there,
    // and asking for a guest order lookup sent partners to a store login that
    // does not exist. The classifier's label is still recorded above; only the
    // order gate, order grounding and the reuse exclusion read this.
    const needsOrderData = !!intent.needsOrderData && (await this.commerceEnabled(tenantId));
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
      // Same question the "Talk to an agent" button asks (PLN-261007 Team
      // Routing): a typed request must not skip the team choice, or typing
      // would broadcast while the button routes.
      const teams = await this.handoffRouter.teamQuestion(tenantId, session.language);
      if (teams) {
        const asked = await this.askTeam(conversation.id, tenantId, session.language, teams);
        return {
          conversationId: String(conversation.id),
          reply: { senderType: 'system', body: asked.body },
          escalate: false,
          needsAuth: false,
          followUps: asked.followUps,
        };
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
    // A message the partner-data step will answer is never "out of scope": the
    // classifier assumes a shop and knows nothing of a hotel's own rates or
    // settlement, so it can label "giá qua đêm phòng Deluxe?" as off-topic and the
    // bot would decline a question the partner API can answer (PLN-261012 SG-31).
    const askedKind = this.nonQuestionKind(intent);
    const nonQuestion = await this.overrideOutOfScope(
      askedKind === 'out_of_scope' && (await this.partnerData?.handles({ tenantId, session, text }))
        ? null
        : askedKind,
      tenantId,
      conversation.id,
      retrievalQuery(history, egressText),
      session.aiAgentId ?? null,
      audience,
    );
    if (nonQuestion) {
      // A deny topic that reads as chit-chat is still a deny topic.
      if (denyAnswersFirst) return denyHandoffNow();
      const streak = await this.nonQuestionStreak(conversation.id);
      const draftT0 = Date.now();
      const drafted = await this.rag.answerWithoutKnowledge(
        tenantId,
        nonQuestion,
        egressText,
        session.language,
        session.aiAgentId ?? null,
        history,
      );
      // No reply could be written — the engine is down (PLN-261007 D4). A
      // person answers instead of the stub's canned line.
      if (!drafted) {
        if (queued) {
          return { conversationId: String(conversation.id), reply: null, escalate: false, needsAuth: false };
        }
        this.logger.warn(`no-knowledge reply unavailable (engine degraded) conversation=${conversation.id}`);
        // An outage, not missing knowledge: the customer is told so (PLN-261012 SG-84).
        const handoff = await this.handoff(conversation.id, session, tenantId, 'engine_unavailable', text, denyStamp);
        return {
          conversationId: String(conversation.id),
          reply: { senderType: 'system', body: handoff.body },
          escalate: true,
          needsAuth: false,
          needsContactEmail: handoff.needsContactEmail,
        };
      }
      const draftMs = elapsedMs(draftT0);
      // Same gate as any other AI egress (FR-069, non-bypassable).
      const checkT0 = Date.now();
      const checked = await this.moderation.moderate({
        tenantId,
        scope: 'ai',
        authorType: 'ai',
        conversationId: conversation.id,
        text: drafted,
      });
      const checkMs = elapsedMs(checkT0);
      if (checked.decision === MODERATION_DECISION.BLOCKED) {
        const handoff = await this.handoff(
          conversation.id,
          session,
          tenantId,
          // A block because the moderation path itself failed is an outage (PLN-261012 SG-84).
          checked.failsafe ? 'engine_unavailable' : 'moderation_blocked',
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
      const body = `${replacePiiTokens(checked.text, session.language)}${offer}`;
      // An out-of-scope reply is a polite refusal; the metric tells it apart from a real answer.
      if (nonQuestion === 'out_of_scope') markTurnOutcome('refused');
      await this.persist(tenantId, conversation.id, SENDER_TYPE.AI, body, session.language, {
        // Recorded so a misclassification can be found later without guessing
        // which turns took this path (PLN-260813 P4).
        answeredFrom: 'no_knowledge',
        nonQuestionKind: nonQuestion,
        intentConfidence: intent.confidence ?? null,
        latencyMs: observeTurnLatency(buildTurnLatency(turnStartedAt, { classify: classifyMs, generate: draftMs, moderate: checkMs })),
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

    // Resolved through RAG so the gate below, replay, retrieval and persona all
    // agree on which agent is speaking (a deactivated pin degrades to default).
    const effectiveAgentId = await this.rag.effectiveAgentId(tenantId, session.aiAgentId ?? null);

    // Guest gate (PLN-261001 v1.1 B5). An agent set to `login_guidance` answers
    // an UNIDENTIFIED visitor only from categories an operator opened to
    // guests; anything else gets a sign-in prompt instead of an answer — and
    // instead of a model call: the pre-check below retrieves with the guest
    // scope first, so a question the guest knowledge cannot ground never
    // reaches the LLM (Q2). Placed after the human-request and small-talk
    // branches on purpose: a guest can still reach a person and still be
    // greeted. Deny rules keep their priority — a matched topic is handed to
    // a human exactly as it would be for an identified visitor.
    // The decision is `decideGuestGate` (gate-decision.ts) — the very function the console simulator
    // calls, so "Test as a visitor" cannot differ from this (PLN-261012 SG-51). It reads the agent's
    // policy first and measures only for an unverified visitor of a login_guidance agent.
    const gate = await decideGuestGate(this.rag, {
      tenantId,
      agentId: effectiveAgentId,
      identity,
      query: retrievalQuery(history, egressText),
    });
    const guestGated = gate.guestGated;
    if (guestGated) {
      // Same bar as the handoff decision below (ESCALATION_CONFIDENCE), measured
      // on the guest-visible categories alone. "Any hit at all" was the first
      // cut and it never closed: a nearest-neighbour search returns its top-k
      // for every query once a single public document exists, so a partner
      // asking about reconciliation was answered from the sign-up guide instead
      // of being asked to sign in (found in the S3 local run, TCR-261006 §7).
      if (gate.decision !== GATE_DECISION.ALLOW) {
        if (denyAnswersFirst) return denyHandoffNow();
        const body = await this.loginRequiredMessage(tenantId, session.language);
        // Why this visitor was turned away, in the closed vocabulary (PLN-261012
        // SG-50): a visitor whose signed claims LAPSED is told apart from one who
        // never signed in — the first is fixed by the host re-signing. The measurement
        // rides along (SG-51): how close the public knowledge came, which categories it
        // matched, and whether the vector leg was even up (`gate: embedder_degraded`).
        await this.persist(
          tenantId,
          conversation.id,
          SENDER_TYPE.SYSTEM,
          body,
          session.language,
          buildRefusalTrace(
            identity.expired ? REFUSAL_REASON.IDENTITY_EXPIRED : REFUSAL_REASON.GUEST_GATE,
            effectiveAgentId,
            gateTraceExtras(gate),
          ),
        );
        this.logger.log(
          `guest gate: sign-in prompt conversation=${conversation.id} agent=${effectiveAgentId ?? 'default'}` +
            (identity.expired ? ' (identity expired)' : '') +
            (gate.decision === GATE_DECISION.EMBEDDER_DEGRADED ? ' (vector leg degraded)' : ''),
        );
        return {
          conversationId: String(conversation.id),
          reply: { senderType: 'system', body },
          escalate: false,
          needsAuth: true,
          authReason: 'login',
        };
      }
    }

    if (needsOrderData && identity.customerId == null && !denyAnswersFirst) {
      const body = sysMsg('authRequired', session.language);
      await this.persist(
        tenantId,
        conversation.id,
        SENDER_TYPE.SYSTEM,
        body,
        session.language,
        buildRefusalTrace(
          identity.expired ? REFUSAL_REASON.IDENTITY_EXPIRED : REFUSAL_REASON.AUTH_GATE,
          effectiveAgentId,
        ),
      );
      return { conversationId: String(conversation.id), reply: { senderType: 'system', body }, escalate: false, needsAuth: true, authReason: 'order' };
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
      needsOrderData && identity.customerId != null
        ? await this.buildOrderContext(tenantId, identity.customerId)
        : undefined;

    // Partner data (PLN-261012 SG-31), the hotel-side counterpart of the order
    // context above: a signed-in hotel user asking about THEIR hotel's rates,
    // policies, bookings or settlement gets a server-built, server-formatted data
    // block (hotel from the verified claims, never from the message) — or, when
    // that is refused or impossible, a fixed notice instead of a model reply.
    // Null for every tenant/session/message the feature does not apply to, which
    // leaves this turn exactly as it was.
    const partner = this.partnerData
      ? await this.partnerData.prepare({
          tenantId,
          session,
          conversationId: conversation.id,
          messageId: userTurn.id,
          text,
          language: session.language,
          identity,
          // Read only in tools mode (PLN-261012 SG-33): what the planning model may see.
          modelText: egressText,
          history,
        })
      : null;
    if (partner?.kind === 'notice') {
      if (denyAnswersFirst) return denyHandoffNow();
      return this.answerWithPartnerNotice(partner, {
        conversationId: conversation.id,
        session,
        tenantId,
        text,
        denyStamp,
        queued,
      });
    }

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
    // Only a conversation's opening question is self-contained enough to replay
    // (PLN-260929 S5): "예약 진행" means something different in every thread
    // that says it, and a stored answer cannot know which. A gated guest never
    // replays either: the store holds answers given with the full scope.
    const contextual = hasAssistantTurn(history);
    // A partner-data answer is about ONE hotel and its live figures; the reuse
    // store is keyed by tenant, language and agent only, so replaying it would
    // hand one hotel's numbers to another (REQ-261012 D-06). Bypassed here AND
    // at the record site below.
    const reused =
      needsOrderData || !this.answerReuse || contextual || guestGated || partner
        ? null
        : await this.answerReuse.lookup(
            tenantId,
            session.language,
            egressText,
            effectiveAgentId,
            // Replay only to a viewer at least as privileged as the one it was generated for (SG-06).
            AUDIENCE_RANK[audience],
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
          retrievalQuery(history, egressText),
          // Resolved, not raw: an unpinned session answers as the tenant's
          // default agent, and RAG applies what it is given rather than
          // guessing what null meant.
          effectiveAgentId,
          undefined,
          history,
          // Guest scope for gated visitors (PLN-261001 v1.1); signed partner
          // context for identified ones (REQ-261006 H6).
          {
            guestOnly: guestGated,
            audience,
            partnerContext: partnerContextOf(session, identity),
            ...(partner ? { partnerData: partner.block } : {}),
          },
        );

    // Outage signals from RAG (PLN-261012 SG-84); a replayed answer carries neither.
    const engineDown = 'engineDegraded' in answer && answer.engineDegraded === true;
    const vectorDegraded = 'vectorDegraded' in answer ? answer.vectorDegraded : undefined;

    // Mandatory moderation gate (FR-069).
    const moderateT0 = Date.now();
    const moderated = await this.moderation.moderate({
      tenantId,
      scope: 'ai',
      authorType: 'ai',
      conversationId: conversation.id,
      text: answer.text,
      // The ids and amounts of OUR data block must survive the PII masks (the
      // 13-16 digit rule would eat a long booking code) — this call only.
      ...(partner ? { protect: partner.protect } : {}),
    });
    const moderateMs = elapsedMs(moderateT0);
    // A privacy token the model copied despite the rule (PLN-260929 S7).
    const replyText = replacePiiTokens(moderated.text, session.language);

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
        // The moderation path failing, or the engine being down, is an outage and says so
        // (PLN-261012 SG-84); a rule that fired is a real moderation block.
        moderated.failsafe || engineDown ? 'engine_unavailable' : 'moderation_blocked',
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
      // Nothing grounded for THIS audience — but is it a topic only a manager may read? Then the
      // receptionist is told so (and offered a person) instead of a vague "no answer" handoff
      // (PLN-261012 SG-10). Not for an outage, and not when a deny rule already requires the page.
      // The WHY of the hand-off is `decideLowConfidence` (gate-decision.ts, the simulator's too): a
      // manager-only topic, a vector leg that was down (embedder_degraded — the 0.2 sentinel says
      // nothing about the question), or genuinely nothing grounded. An outage keeps its own reason.
      const lowDecision = engineDown
        ? null
        : await decideLowConfidence(
            this.rag,
            { tenantId, agentId: effectiveAgentId, identity, query: retrievalQuery(history, egressText) },
            { confidence: answer.confidence, grounding: (answer as Partial<RagAnswer>).grounding },
            { guestGated, skipRoleTier: denyAnswersFirst },
          );
      if (lowDecision?.decision === GATE_DECISION.ROLE_MANAGER_ONLY) {
        return this.managerOnlyReply({
          conversationId: conversation.id,
          session,
          tenantId,
          identity,
          effectiveAgentId,
          decision: lowDecision,
        });
      }
      const handoff = await this.handoff(
        conversation.id,
        session,
        tenantId,
        // The engine failed and the stub's text was withheld: tell the customer it is an outage,
        // not that the knowledge base has no answer (PLN-261012 SG-84).
        engineDown ? 'engine_unavailable' : 'low_confidence',
        text,
        // The measurement rides on the stored notice (SG-51): refusals are calibration data too.
        lowDecision ? { ...denyStamp, trace: { ...gateTraceExtras(lowDecision) } } : denyStamp,
      );
      return {
        conversationId: String(conversation.id),
        reply: { senderType: 'system', body: handoff.body },
        escalate: true,
        needsAuth: false,
        needsContactEmail: handoff.needsContactEmail,
      };
    }

    // Every number in a partner-data answer must be one the data block holds
    // (PLN-261012 SG-31): the model is told to copy figures, and this is what
    // makes that more than a request. A figure that is not there withholds the
    // answer and degrades the turn to "we will confirm" + hand-off. Runs on the
    // moderated text and BEFORE the contact footer (whose phone numbers are ours).
    if (partner) {
      // `partner` is only ever set when the step exists.
      const verdict = await this.partnerData!.verify(partner, replyText, {
        question: text,
        kbTexts: answer.citations.map((c) => c.snippet ?? ''),
        language: session.language,
      });
      if (!verdict.ok) {
        return this.answerWithPartnerNotice(verdict.notice, {
          conversationId: conversation.id,
          session,
          tenantId,
          text,
          denyStamp,
          queued,
        });
      }
    }

    // The tenant's contact footer (PLN-261007 R4): fixed operator text, added
    // after moderation and never stored in the reuse cache with the answer.
    const footer = footerFor(footerCfg, session.language);
    // A copy the model wrote itself is removed so the block appears once.
    const answerText = footer ? stripFooters(replyText, variants) : replyText;
    // One fixed UI-version caveat when a cited document is stamped with another
    // version (PLN-261012 SG-20): added here, after moderation, read live from the
    // cited documents so a replay is covered too, and kept out of `baseText` —
    // which is what the reuse store gets. It sits before the contact footer.
    const baseText = stripFooters(answerText, caveatTexts);
    const caveat =
      (await this.rag.versionCaveat?.(tenantId, versionPolicy, answer.citations, session.language)) ?? null;
    const bodyText = caveat ? `${baseText}\n\n${caveat}` : baseText;
    const deliveredText = footer ? `${bodyText}\n\n${footer}` : bodyText;

    if (opts.draft) {
      // Approval mode: the answer is a proposal, not a message. Persisting it
      // would deliver it — the widget poll and the channel outbox both read
      // `messages` — and reuse must not learn from an answer nobody approved.
      return {
        conversationId: String(conversation.id),
        reply: null,
        draft: {
          body: deliveredText,
          confidence: answer.confidence,
          citations: answer.citations,
        },
        escalate: false,
        needsAuth: false,
      };
    }

    const aiTurn = await this.persist(tenantId, conversation.id, SENDER_TYPE.AI, deliveredText, session.language, {
      citations: answer.citations,
      confidence: answer.confidence,
      // Console diagnostics: which answers came from the reuse store (D-C2:
      // the customer sees no marker; the trace always records it).
      ...(reused ? { answeredFrom: 'reuse', reuseId: reused.reuseId } : {}),
      // What the answer's figures were read from (PLN-261012 SG-31). Kept OUT of
      // `citations` on purpose: the widget receives citations wholesale, the
      // statistics read them as knowledge-document ids, and issue auto-resolve
      // counts the confidence next to them.
      ...(partner ? { partnerEvidence: partner.evidence, answeredFrom: 'partner_data', ...(partner.trace ?? {}) } : {}),
      ...(caveat ? { uiVersionCaveat: true } : {}),
      // A gate PASS is recorded too (PLN-261012 SG-51, D-13): without it a leak is invisible — the
      // only trace of the gate would be its refusals. Which tier, how grounded against which bar,
      // which categories matched. Only when a gate was actually asked (a guest of a login_guidance
      // agent): an open agent or a signed-in session never measured anything. Never the question.
      ...(guestGated ? gateTraceExtras(gate) : {}),
      // The vector leg was down and this answer stands on the keyword leg alone (PLN-261012 SG-84).
      ...(vectorDegraded ? { vectorProvider: 'degraded', vectorDegraded } : {}),
      // A replayed answer carries no `timings`: its retrieve/generate stay null, not 0.
      latencyMs: observeTurnLatency(buildTurnLatency(turnStartedAt, {
        classify: classifyMs,
        retrieve: (answer as Partial<RagAnswer>).timings?.retrieveMs,
        generate: (answer as Partial<RagAnswer>).timings?.generateMs,
        moderate: moderateMs,
      })),
    });
    if (reused) {
      void this.answerReuse?.recordHit(reused.reuseId);
    } else if (!contextual && !guestGated && !partner) {
      // (Not a partner-data answer either: it is one hotel's live figures, and
      // the store has no hotel dimension.)
      // A gated guest's answer came from the guest-only scope; stored, it
      // would replay for identified visitors as if it were the full answer.
      // A freshly generated, delivered answer becomes a reuse candidate (the
      // service applies the D-C1 filters: cited + confident, no order context).
      void this.answerReuse?.recordAiAnswer({
        tenantId,
        lang: session.language,
        question: egressText,
        answerText: baseText,
        confidence: answer.confidence,
        citations: answer.citations,
        sourceMessageId: aiTurn.id,
        needsOrderData,
        aiAgentId: effectiveAgentId,
        // What the answer was generated FOR (SG-06): replayed only to this rank or above.
        audienceRank: AUDIENCE_RANK[audience],
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
        body: deliveredText,
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
   * The turns before `currentTurnId`, oldest first, shaped for the model
   * (PLN-260929 S1). One query per turn; `messages(conversation_id)` is indexed.
   */
  private async conversationHistory(
    conversationId: number,
    currentTurnId: number,
    footerTexts: string[] = [],
  ): Promise<AiMessage[]> {
    const rows = await this.msgRepo.find({
      where: {
        conversationId,
        senderType: In([SENDER_TYPE.USER, SENDER_TYPE.AI, SENDER_TYPE.AGENT]),
        id: LessThan(currentTurnId),
      },
      order: { id: 'DESC' },
      take: HISTORY_MESSAGES,
      select: { id: true, senderType: true, body: true },
    });
    return buildHistory(
      rows
        .reverse()
        .map((r) =>
          r.senderType === SENDER_TYPE.AI && footerTexts.length
            ? { ...r, body: stripFooters(r.body, footerTexts) }
            : r,
        ),
    );
  }

  /**
   * An out_of_scope label the knowledge base disagrees with is dropped
   * (PLN-260929 S6). The classifier assumes a shop; a service tenant's core
   * business ("에어컨 청소 예약") was refused without retrieval ever running.
   * Only out_of_scope is second-guessed — a greeting searched against the
   * knowledge base is exactly what PLN-260813 P2 stopped doing.
   */
  private async overrideOutOfScope(
    kind: 'smalltalk' | 'out_of_scope' | 'unintelligible' | null,
    tenantId: number,
    conversationId: number,
    searchText: string,
    aiAgentId: number | null,
    audience?: Audience,
  ): Promise<'smalltalk' | 'out_of_scope' | 'unintelligible' | null> {
    if (kind !== 'out_of_scope') return kind;
    const scope = await this.rag.effectiveAgentId(tenantId, aiAgentId);
    // The same audience as the answer: a manager-only document must not talk an out_of_scope
    // label out of a receptionist's turn either (SG-10).
    const grounded = await this.rag.groundingConfidence(
      tenantId,
      searchText,
      scope,
      audience ? { audience } : undefined,
    );
    if (grounded < ESCALATION_CONFIDENCE) return kind;
    this.logger.log(
      `out_of_scope overridden by knowledge (conf ${grounded}) conversation=${conversationId}`,
    );
    return null;
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
    stamp?: {
      issueType?: string;
      issueLabel?: string;
      /** Replaces the stock notice (not the off-hours ones) — e.g. "the data system is unreachable". */
      notice?: string;
      /** Merged into the persisted notice's trace after `reason` (PLN-261012 SG-31). */
      trace?: Record<string, unknown>;
    },
  ): Promise<HandoffOutcome> {
    // Routing decides both who gets paged and what the customer is told:
    // outside business hours the message goes to a mailbox and the shopper is
    // told to expect an email reply instead of a live agent (PLN-AiSetting W3).
    // The hotel region is resolved first: an off-hours summary goes to the regional
    // mailbox when the tenant set one (PLN-261012 SG-67). The preview sandbox resolves nothing.
    const lookup = session.channel === 'preview' ? null : await this.lookupRegion(tenantId, session);
    const route = await this.handoffRouter.route(tenantId, session.language, {
      region: lookup?.region?.team ?? null,
    });
    // Off hours the answer travels by email, so we need somewhere to send it.
    // Without an address on file the widget asks for one (PLN-260806) and the
    // notice says so, instead of promising a reply we cannot deliver.
    const needsContactEmail =
      route.mode === 'email' && !(await this.hasContactEmail(tenantId, session));
    // The notice says why: a shopper who asked for a person is told one is
    // coming, not "I couldn't find a confident answer" (FIX-261007 G1 — the
    // copy was the same for every reason).
    const body = needsContactEmail
      ? sysMsg('offHoursNeedEmail', session.language)
      : route.mode === 'email' && route.notice
        ? route.notice
        : (stamp?.notice ??
          sysMsg(
            reason === 'user_request'
              ? 'connectingAgent'
              : reason === 'engine_unavailable'
                ? 'engineUnavailable'
                : 'handoff',
            session.language,
          ));
    // The stored reason speaks the closed refusal vocabulary and names the agent
    // that was speaking (PLN-261012 SG-50); the escalation event below keeps its
    // own words, which the alert channels and the console already key on. A
    // partner-data stamp (PLN-261012 SG-31) adds its own trace keys on top.
    await this.persist(tenantId, conversationId, SENDER_TYPE.SYSTEM, body, session.language, {
      ...buildHandoffTrace(reason, await this.speakingAgentId(tenantId, session)),
      ...stamp?.trace,
    });
    // Preview sandbox: show the real handoff notice but never page the agents —
    // no WAITING flip (the bot keeps answering for iterative testing), no alert
    // fan-out, no console-queue entry.
    if (session.channel === 'preview') return { body, needsContactEmail: false };
    await this.markWaiting(conversationId);
    // Lapsed claims name no hotel on the alert and route no region (SG-03).
    const identity = await this.identityOf(session);
    const region = await this.stampRegion(conversationId, lookup);
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
      partnerLabel: partnerLabelOf(session, identity),
      ...regionEventFields(region),
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
  async escalate(
    session: Session,
    conversationId: number,
    /** Team option id echoed back from a chip (PLN-261007 Team Routing). */
    supportType?: string,
    options: EscalateOptions = {},
  ): Promise<EscalateOutcome> {
    const conversation = await this.convRepo.findOne({ where: { id: conversationId } });
    // Number() both sides: session.id is a bare bigint PK (hydrates as a string)
    // while conversation.sessionId goes through bigintTransformer (number).
    if (!conversation || Number(conversation.sessionId) !== Number(session.id)) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    const tenantId = session.tenantId ?? conversation.tenantId ?? 0;

    // Pilot allowlist (PLN-261012 SG-40): a hotel outside the list must not page the
    // support team either — a person is as much "the agent" as the model is. A session
    // that identified AFTER chatting as a guest is the way an open conversation can
    // belong to a non-pilot hotel. Soft reply, nothing stored, nobody paged.
    const pilotDenial = session.channel === 'preview' ? null : await this.pilot?.denialFor(session);
    if (pilotDenial) {
      return { escalated: false, choose: false, body: pilotDenial.body, pilotDenied: true };
    }

    // Team routing (PLN-261007): first call asks, second call (with the chip's
    // option id) routes. A tenant that switched the question off in between
    // simply hands off — the stale id is ignored, never an error.
    //
    // A caller that cannot show the chips (a messenger room) passes
    // `askTeam: false` and goes straight to the hand-off (PLN-261012 SG-65, D-12):
    // the question would be stored where nobody can answer it, `choose: true`
    // would come back, and no agent would ever be paged.
    const teams =
      options.askTeam === false
        ? null
        : await this.handoffRouter.teamQuestion(tenantId, session.language);
    let chosen: TeamQuestion['options'][number] | null = null;
    if (teams) {
      if (!supportType) {
        const asked = await this.askTeam(conversationId, tenantId, session.language, teams);
        return { escalated: false, choose: true, body: asked.body, followUps: asked.followUps };
      }
      chosen = teams.options.find((o) => o.id === supportType) ?? null;
      if (!chosen) {
        this.logger.warn(`escalate: unknown support_type=${supportType} conversation=${conversationId}`);
        throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
      }
      // The choice goes into the thread as the customer's own words — an agent
      // reading the transcript tomorrow sees what was asked for — and onto the
      // conversation for the console's queue badge and filter.
      await this.persist(tenantId, conversationId, SENDER_TYPE.USER, chosen.label, session.language, {
        kind: 'team_choice',
        supportType: chosen.id,
      });
      await this.convRepo.update({ id: conversationId }, { supportType: chosen.id });
    }

    if (session.channel === 'preview') return { escalated: true, choose: false, body: null }; // sandbox: never page the agents
    // What the alert quotes: the customer's last message that is NOT the team chip just stored above
    // (w3c, ops-manual finding 16) - the question, not the name of the team they pressed.
    const preview = await escalationPreview((beforeId) =>
      this.msgRepo.findOne({
        where: { conversationId, senderType: SENDER_TYPE.USER, ...(beforeId != null ? { id: LessThan(beforeId) } : {}) },
        order: { id: 'DESC' },
      }),
    );
    // Same routing as the automatic handoff (PLN-AiSetting W3). Off hours the
    // widget's local "connecting you" line would be a lie, so persist the
    // off-hours notice — the conversation poll shows it to the customer.
    // Region first, then the decision: per-team hours and the regional off-hours mailbox
    // need both the team the customer picked and the hotel region (PLN-261012 SG-67).
    const lookup = await this.lookupRegion(tenantId, session);
    const route = await this.handoffRouter.route(tenantId, session.language, {
      region: lookup?.region?.team ?? null,
      supportType: chosen?.id ?? conversation.supportType,
    });
    // Off hours the answer travels by email, exactly as in handoff() (PLN-261012
    // SG-62): with no address on file the notice asks for one and the widget shows
    // the form, instead of promising a reply we cannot deliver.
    const needsContactEmail =
      route.mode === 'email' && !(await this.hasContactEmail(tenantId, session));
    // In hours the "connecting you" line is stored too (PLN-261007): as a
    // widget-local bubble it vanished on the poll after a team choice, and the
    // transcript never said the customer had asked for a person.
    const body = needsContactEmail
      ? sysMsg('offHoursNeedEmail', session.language)
      : route.mode === 'email' && route.notice
        ? route.notice
        : sysMsg('connectingAgent', session.language);
    await this.persist(
      tenantId,
      conversationId,
      SENDER_TYPE.SYSTEM,
      body,
      session.language,
      buildHandoffTrace('user_request', await this.speakingAgentId(tenantId, session)),
    );
    await this.markWaiting(conversationId);
    const identity = await this.identityOf(session);
    const region = await this.stampRegion(conversationId, lookup);
    // Remember how this thread must be answered: an agent replying tomorrow has no
    // one in the widget to read it (see AgentService.sendMessage). Without this the
    // reply stayed in a chat nobody was looking at, and the idle sweep closed it.
    if (route.mode === 'email') {
      await this.convRepo.update({ id: conversationId }, { replyChannel: 'email' });
    }
    const event: EscalationEvent = {
      tenantId,
      conversationId,
      sessionId: session.id,
      reason: 'user_request',
      preview,
      targetUserIds: route.targetUserIds,
      offHoursEmail: route.mode === 'email' ? route.email : undefined,
      partnerLabel: partnerLabelOf(session, identity),
      ...(chosen
        ? { issueLabel: chosen.jobLabel, supportType: chosen.id, supportLabel: chosen.label }
        : {}),
      ...regionEventFields(region),
    };
    await this.bus.publish(EVENTS.ESCALATION, event);
    // The flag rides only when true, so an in-hours response is exactly what it was.
    return { escalated: true, choose: false, body, ...(needsContactEmail ? { needsContactEmail } : {}) };
  }

  /**
   * The hotel regional team from the signed claims (PLN-261007 Hotel Region Routing),
   * or null. Never throws: a region lookup that fails must not stop a customer reaching a
   * person, it only means this hand-off is routed by label alone.
   */
  private async lookupRegion(tenantId: number, session: Session): Promise<RegionLookup | null> {
    try {
      // Lapsed claims name no hotel and route no region (PLN-261012 SG-03).
      const identity = await this.identityOf(session);
      return await this.handoffRouter.regionLookup(tenantId, identity.claims);
    } catch (e) {
      this.logger.warn(`region lookup failed (session ${session.id}): ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Stamp what the lookup found on the conversation for the queue badge and filter: the
   * team when the province resolved, or - region routing on, province not in the table -
   * the province itself as `support_region_hint`, so the queue can show a "?" badge with
   * it and filter on it (PLN-261012 SG-65). Never throws, for the same reason.
   */
  private async stampRegion(conversationId: number, lookup: RegionLookup | null): Promise<StampedRegion | null> {
    try {
      if (!lookup) return null;
      const { region, unmapped, mode } = lookup;
      const withMode = mode ? { mode } : {};
      if (!region) {
        if (!unmapped) return null;
        await this.convRepo.update({ id: conversationId }, { supportRegionHint: unmapped.slice(0, REGION_HINT_MAX) });
        return { unmapped, ...withMode };
      }
      await this.convRepo.update({ id: conversationId }, { supportRegion: region.team });
      return { team: region.team, label: region.label, ...withMode };
    } catch (e) {
      this.logger.warn(`region stamp failed (conversation ${conversationId}): ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Persist the team question with its chips (PLN-261007 Team Routing). The
   * chips ride on the message trace exactly like scenario follow-ups, so they
   * survive the poll and a reload; the conversation is NOT marked waiting and
   * nobody is paged until the customer picks one.
   */
  private async askTeam(
    conversationId: number,
    tenantId: number,
    language: string,
    teams: TeamQuestion,
  ): Promise<{ body: string; followUps: Array<{ id: string; label: string }> }> {
    const followUps = teams.options.map((o) => ({ id: `${TEAM_CHIP_PREFIX}${o.id}`, label: o.label }));
    await this.persist(tenantId, conversationId, SENDER_TYPE.SYSTEM, teams.prompt, language, {
      kind: 'team_question',
      followUps,
    });
    return { body: teams.prompt, followUps };
  }

  /**
   * A turn answered with a fixed partner-data notice instead of a model reply
   * (PLN-261012 SG-31). Two kinds, told apart by `notice.handoff`:
   *  - a refusal the customer can act on (role may not read it, sign in again,
   *    "that is another hotel") — the notice alone, nobody is paged;
   *  - the facts could not be fetched or verified — "we will confirm" and a real
   *    hand-off, so a person gives the figures. A thread already waiting for an
   *    agent is not paged twice (the same rule as every other handoff here).
   * Never throws a partner error to the customer; the error code rides on the
   * message trace for the logs and the refusal analytics.
   */
  private async answerWithPartnerNotice(
    notice: PartnerNotice,
    ctx: {
      conversationId: number;
      session: Session;
      tenantId: number;
      text: string;
      denyStamp?: { issueType?: string; issueLabel?: string };
      queued: boolean;
    },
  ): Promise<ChatTurnResult> {
    const conversationId = String(ctx.conversationId);
    if (notice.handoff && !ctx.queued) {
      // Its own escalation word, not `low_confidence`: the alarm and the Slack/e-mail text name the real
      // cause (the partner data could not be read / a figure could not be verified).
      const reason: EscalationReason =
        notice.reason === REFUSAL_REASON.PARTNER_UNVERIFIED ? 'partner_unverified' : 'partner_unavailable';
      const handoff = await this.handoff(ctx.conversationId, ctx.session, ctx.tenantId, reason, ctx.text, {
        ...ctx.denyStamp,
        notice: notice.body,
        trace: notice.trace,
      });
      return {
        conversationId,
        reply: { senderType: 'system', body: handoff.body },
        escalate: true,
        needsAuth: false,
        needsContactEmail: handoff.needsContactEmail,
      };
    }
    // A refusal the customer can act on speaks the closed vocabulary like every other refusal
    // (reason + the agent that was speaking, PLN-261012 SG-50/SG-52); the notice's own keys
    // (error code, topic) ride on top.
    await this.persist(ctx.tenantId, ctx.conversationId, SENDER_TYPE.SYSTEM, notice.body, ctx.session.language, {
      ...buildRefusalTrace(notice.reason, await this.speakingAgentId(ctx.tenantId, ctx.session)),
      ...notice.trace,
    });
    return { conversationId, reply: { senderType: 'system', body: notice.body }, escalate: false, needsAuth: false };
  }

  // ---- helpers ----
  /**
   * Compact, factual summary of the customer's recent orders for the RAG prompt.
   * Deliberately order-only: no email, phone or address is sent to the AI provider
   * (PRV — minimise PII leaving the system); the shopper is asking about orders,
   * so order number, dates, status, totals and item titles are what's needed.
   * Never throws — losing the enrichment must not break the reply.
   */
  /**
   * The "ask your hotel's manager" line (PLN-261012 SG-10): the tenant's own wording for the
   * session language when it set one (guest_guidance.managerNotice), else the built-in line.
   */
  async managerOnlyMessage(tenantId: number | null, language: string): Promise<string> {
    const guidance = await this.rag.guestGuidance(tenantId);
    const override = guidance?.managerNotice?.[String(language ?? '').toUpperCase()]?.trim();
    return override || sysMsg('managerOnly', language);
  }

  /**
   * The customer-facing words a gate decision gives, for the console simulator (PLN-261012
   * SG-51): the very text each refusal branch above sends, read through the same helpers, so what
   * an operator sees under "Test as…" is what a visitor of that kind reads. `allow` has no text of
   * its own (the answer is the answer). A hand-off reads the STOCK notice — the live one also
   * depends on business hours and routing, which the simulator does not run.
   */
  async gateReplyText(
    tenantId: number | null,
    language: string,
    d: Pick<GateDecision, 'decision' | 'stage'>,
  ): Promise<string | null> {
    switch (d.decision) {
      case GATE_DECISION.GUEST_GATE:
        return this.loginRequiredMessage(tenantId, language);
      case GATE_DECISION.ROLE_MANAGER_ONLY:
        return this.managerOnlyMessage(tenantId, language);
      case GATE_DECISION.EMBEDDER_DEGRADED:
        // At the guest gate an outage keeps the gate CLOSED, so the visitor is told what any
        // closed gate says; past it, the same outage ends in the ordinary hand-off notice.
        return d.stage === 'guest' ? this.loginRequiredMessage(tenantId, language) : sysMsg('handoff', language);
      case GATE_DECISION.LOW_CONFIDENCE:
        return sysMsg('handoff', language);
      default:
        return null;
    }
  }

  /**
   * May the conversation's earlier turns go to the model for this viewer? (PLN-261012 SG-11.)
   * No when the thread was held at a higher tier than the viewer's tier now — the claims lapsed
   * mid-conversation, or the role that opened it is no longer the one asking — AND the tenant
   * has a manager-only category (a tenant with none is byte-identical to before).
   */
  private async historyReadableBy(conversation: Conversation, audience: Audience, tenantId: number): Promise<boolean> {
    if (!historyExceedsViewer(conversation.actorRole, audience)) return true;
    if (!(await this.rag.hasAudienceTiers?.(tenantId))) return true;
    this.logger.warn(
      `conversation ${conversation.id} was held at a higher tier than the viewer's (${audience}) — earlier turns withheld from the model`,
    );
    return false;
  }

  /**
   * A receptionist asked a topic only manager-only categories cover (PLN-261012 SG-10). Reached
   * from the low-confidence branch once `decideLowConfidence` (the SECOND grounding check, with
   * the manager audience — one extra embed, only on that branch and only when the tenant has a
   * manager-only category) ruled `role_manager_only`. The content is NOT shown — the reply points
   * to the hotel's manager account and offers a person, the trace carries `role_manager_only`, and
   * nobody is paged (no CS page).
   */
  private async managerOnlyReply(ctx: {
    conversationId: number;
    session: Session;
    tenantId: number;
    identity: EffectiveIdentity;
    effectiveAgentId: number | null;
    decision: GateDecision;
  }): Promise<ChatTurnResult> {
    const body = await this.managerOnlyMessage(ctx.tenantId, ctx.session.language);
    const followUps = [agentConnectChip(ctx.session.language)];
    // Chips ride on the trace like the team question's, so they survive the poll and a reload.
    await this.persist(ctx.tenantId, ctx.conversationId, SENDER_TYPE.SYSTEM, body, ctx.session.language, {
      ...buildRefusalTrace(REFUSAL_REASON.ROLE_MANAGER_ONLY, ctx.effectiveAgentId, {
        actorRole: ctx.identity.claims?.role ?? null,
        requiredRole: 'manager',
        // grounded / threshold are the MANAGER-scope measurement against the handoff bar, plus what
        // it matched (SG-51): the categories named here are the manager-only ones that held the answer.
        ...gateTraceExtras(ctx.decision),
      }),
      followUps,
    });
    this.logger.log(
      `manager-only topic: receptionist pointed to the manager account conversation=${ctx.conversationId} agent=${ctx.effectiveAgentId ?? 'default'}`,
    );
    markTurnOutcome('refused');
    return {
      conversationId: String(ctx.conversationId),
      reply: { senderType: 'system', body },
      escalate: false,
      needsAuth: false,
      followUps,
    };
  }

  /**
   * The sign-in prompt for a gated guest (PLN-261001 v1.1 T4): the tenant's
   * own wording for the session language when it set one, else the built-in
   * line. Language keys are the session codes (EN/VI/…) on both sides.
   */
  private async loginRequiredMessage(tenantId: number | null, language: string): Promise<string> {
    const guidance = await this.rag.guestGuidance(tenantId);
    const override = guidance?.notice?.[String(language ?? '').toUpperCase()]?.trim();
    return override || sysMsg('loginRequired', language);
  }

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
    // When this waiting spell started (PLN-261012 SG-63/SG-66): the queue shows the age and the
    // unclaimed sweeper counts from it. Only the FIRST hand-off stamps it - a repeat request on a
    // thread that is already waiting keeps the original time, because the customer has been
    // waiting since then. A hand-back to the AI clears it, so the next spell starts fresh.
    await this.convRepo.update(
      { id: conversationId, escalatedAt: IsNull() },
      { escalatedAt: new Date(), unclaimedPages: 0, unclaimedPagedAt: null },
    );
  }

  /** Store features flag (PLN-261001); an unknown tenant reads as a store. */
  private async commerceEnabled(tenantId: number): Promise<boolean> {
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { id: true, commerceEnabled: true },
    });
    return Number(tenant?.commerceEnabled ?? 1) !== 0;
  }

  private async resolveTenantId(): Promise<number> {
    const tenant = await this.tenantRepo.findOne({ where: {}, order: { id: 'ASC' } });
    return tenant?.id ?? 0;
  }
}
