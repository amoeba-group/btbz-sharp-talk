import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import {
  CHANNEL_DIRECTION,
  CJM_STAGE,
  CONSENT_STATE,
  CONVERSATION_STATUS,
  MESSENGER_CONSENT_MODE,
  SENDER_TYPE,
  SESSION_IDENTITY,
  localized,
} from '@sharptalk/types';
import { generateToken } from '@sharptalk/common';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { ReplyDraft } from '../chat/entity/reply-draft.entity';
import { ChatService } from '../chat/chat.service';
import { SessionService } from '../session/session.service';
import { MessengerChannel } from './entity/messenger-channel.entity';
import { ChannelThread } from './entity/channel-thread.entity';
import { ChannelMessageMap } from './entity/channel-message-map.entity';
import {
  InboundAttachmentRef,
  MessengerAdapter,
  NormalizedInbound,
} from './adapter/messenger-adapter';
import { MessengerOutboxService } from './messenger-outbox.service';
import { AdapterRegistry } from './adapter/adapter.registry';
import { decryptChannelSecret } from './messenger-secret.util';
import { AttachmentService } from '../attachment/attachment.service';
import { REPLY_MODE, resolveReplyMode } from './auto-reply.util';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';

/**
 * Privacy notice sent on first contact for `consent_mode='notice'` channels.
 * An external messenger has no consent banner, so without this the session
 * stays PENDING and the AI silently refuses every message — a failure that
 * looks like a normal response and never reaches the logs (REQ G3).
 */
const CONSENT_NOTICE = {
  EN: 'Hi! Before we start: messages in this chat are processed by our support system (including AI) to answer you, and stored as customer-service records. Continuing the conversation means you accept this.',
  ES: 'Hola. Antes de empezar: los mensajes de este chat son procesados por nuestro sistema de soporte (incluida la IA) para responderte y se guardan como registros de atención al cliente. Continuar la conversación implica que lo aceptas.',
  KO: '안녕하세요. 시작 전에 안내드립니다 — 이 대화의 메시지는 답변을 위해 상담 시스템(AI 포함)에서 처리되며 상담 기록으로 저장됩니다. 대화를 계속하시면 이에 동의하신 것으로 봅니다.',
  VI: 'Xin chào! Trước khi bắt đầu: tin nhắn trong cuộc trò chuyện này được hệ thống hỗ trợ của chúng tôi (bao gồm AI) xử lý để trả lời bạn và được lưu làm hồ sơ chăm sóc khách hàng. Việc tiếp tục trò chuyện đồng nghĩa bạn chấp nhận điều này.',
  JA: 'こんにちは。始める前にご案内します — このチャットのメッセージは、ご回答のために当社のサポートシステム（AIを含む）で処理され、応対記録として保存されます。会話を続けられた場合、これに同意いただいたものとみなします。',
  ZH: '您好！开始之前请注意：本次对话中的消息将由我们的客服系统（包括 AI）处理以便回复您，并作为客服记录保存。继续对话即表示您接受这一点。',
} as const;

/**
 * Shown in the conversation when an inbound file could not be stored — and sent
 * on to the customer, since they are the only one who can send it again.
 */
const ATTACHMENT_DROPPED_NOTICE = {
  EN: (n: number) =>
    n > 1
      ? `We could not open ${n} of the files you sent. Could you send them again as JPEG or PDF?`
      : 'We could not open the file you sent. Could you send it again as a JPEG or PDF?',
  ES: (n: number) =>
    n > 1
      ? `No pudimos abrir ${n} de los archivos que enviaste. ¿Puedes enviarlos de nuevo en JPEG o PDF?`
      : 'No pudimos abrir el archivo que enviaste. ¿Puedes enviarlo de nuevo en JPEG o PDF?',
  KO: (n: number) =>
    n > 1
      ? `보내주신 파일 중 ${n}개를 열지 못했습니다. JPEG나 PDF로 다시 보내주시겠어요?`
      : '보내주신 파일을 열지 못했습니다. JPEG나 PDF로 다시 보내주시겠어요?',
  VI: (n: number) =>
    n > 1
      ? `Chúng tôi không mở được ${n} tệp bạn đã gửi. Bạn gửi lại dưới dạng JPEG hoặc PDF giúp nhé?`
      : 'Chúng tôi không mở được tệp bạn đã gửi. Bạn gửi lại dưới dạng JPEG hoặc PDF giúp nhé?',
  JA: (n: number) =>
    n > 1
      ? `お送りいただいたファイルのうち${n}件を開けませんでした。JPEGまたはPDFで送り直していただけますか。`
      : 'お送りいただいたファイルを開けませんでした。JPEGまたはPDFで送り直していただけますか。',
  ZH: (n: number) =>
    n > 1
      ? `您发送的文件中有 ${n} 个无法打开。麻烦您改用 JPEG 或 PDF 重新发送好吗？`
      : '您发送的文件无法打开。麻烦您改用 JPEG 或 PDF 重新发送好吗？',
} as const;

/**
 * Channel-agnostic inbound pipeline (PLN-260810 §3 PR-M1).
 *
 * Every adapter — webhook or polling, direct or hub — funnels through here, so
 * consent, session binding, deduplication and the AI hand-off are written once
 * and a new channel is only ever a new adapter.
 */
@Injectable()
export class MessengerIngestService {
  private readonly logger = new Logger(MessengerIngestService.name);

  constructor(
    @InjectRepository(ChannelThread) private readonly threadRepo: Repository<ChannelThread>,
    @InjectRepository(ChannelMessageMap) private readonly mapRepo: Repository<ChannelMessageMap>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(ReplyDraft) private readonly draftRepo: Repository<ReplyDraft>,
    private readonly chatService: ChatService,
    private readonly sessionService: SessionService,
    private readonly outbox: MessengerOutboxService,
    /** Files delivered with an inbound message (PLN-260814 S5). */
    private readonly attachments?: AttachmentService,
    private readonly registry?: AdapterRegistry,
    @Optional() private readonly bus?: EventBusService,
  ) {}

  /**
   * The journey step for a message stored without the chat pipeline.
   *
   * Auto and approve modes go through `handleUserMessage`, which records it;
   * this branch did not, so relay rooms left at "off" read as if the customer
   * never asked (kakao 18 of 74 rooms on staging — REQ-261008 F3). Same rule as
   * the chat path: an analytics event only under an effective consent.
   */
  private async recordInquiry(session: Session): Promise<void> {
    if (!this.bus) return;
    try {
      const consent = await this.sessionService.effectiveConsentFor(session.id, session.tenantId);
      if (consent !== CONSENT_STATE.GRANTED) return;
      await this.bus.publish(EVENTS.CJM, {
        tenantId: session.tenantId,
        sessionId: session.id,
        customerId: session.customerId,
        stage: CJM_STAGE.INQUIRY,
        eventType: 'relay_message',
      });
    } catch (e) {
      // A lost analytics event must never cost the message.
      this.logger.warn(`journey event failed for session ${session.id}: ${(e as Error).message}`);
    }
  }

  /** Ingest a batch; one bad message never blocks the rest of the delivery. */
  async ingestBatch(channel: MessengerChannel, inbounds: NormalizedInbound[]): Promise<void> {
    for (const inbound of inbounds) {
      try {
        await this.ingestOne(channel, inbound);
      } catch (e) {
        this.logger.error(
          `ingest failed (channel ${channel.id}, thread ${inbound.externalThreadId}): ${(e as Error).message}`,
        );
      }
    }
  }

  async ingestOne(channel: MessengerChannel, inbound: NormalizedInbound): Promise<void> {
    const thread = await this.findOrCreateThread(channel, inbound);

    // Loop prevention #2 — the platform redelivers on any doubt about our 200.
    const seen = await this.mapRepo.findOne({
      where: { threadId: thread.id, externalMessageId: inbound.externalMessageId },
    });
    if (seen) return;

    const session = await this.resolveSession(channel, thread, inbound);
    const conversation = await this.resolveConversation(channel, thread, session);

    // The inbound turn and the AI answer are both written by ChatService, so
    // note the high-water mark first to find the turn we just caused.
    const before = await this.msgRepo.findOne({
      where: { conversationId: conversation.id },
      order: { id: 'DESC' },
      select: { id: true },
    });
    const sinceId = before ? Number(before.id) : 0;

    const humanOwnsThread =
      conversation.status === CONVERSATION_STATUS.AGENT ||
      (conversation.status === CONVERSATION_STATUS.WAITING && conversation.agentId != null);

    // Session choice beats the channel default; an agent on the thread beats
    // both (PLN-260812 §2 S1).
    const mode = humanOwnsThread
      ? REPLY_MODE.OFF
      : resolveReplyMode(channel.replyMode, session.autoReplyMode);

    // Files are downloaded and stored BEFORE the turn is handled, so the chat
    // pipeline sees them exactly as it sees a widget upload: ids to claim. That
    // is also what makes a caption-less photo skip the AI instead of asking it
    // to answer an empty string (PLN-260814 SI-2).
    const attachmentIds = await this.storeInboundAttachments(
      channel,
      inbound,
      conversation.id,
      session.language,
    );

    // The privacy notice precedes the first AI processing of this room — not
    // the first message. A channel left at "off" (unofficial KakaoTalk rooms,
    // REQ-260810 R-1) used to open every room with a system message anyway:
    // 37 rooms on staging on 2026-09-08 (REQ-260909).
    if (mode !== REPLY_MODE.OFF) {
      await this.ensureNotice(channel, thread, session, conversation);
    }

    if (mode === REPLY_MODE.AUTO) {
      // Full pipeline: consent gate, intent, deny-list, RAG, moderation, handoff.
      await this.chatService.handleUserMessage(session, inbound.text, { attachmentIds });
    } else if (mode === REPLY_MODE.APPROVE) {
      // Same pipeline, but the answer stops at a draft an agent has to send.
      const turn = await this.chatService.handleUserMessage(session, inbound.text, {
        draft: true,
        attachmentIds,
      });
      if (turn.draft) {
        await this.draftRepo.save(
          this.draftRepo.create({
            tenantId: channel.tenantId,
            conversationId: conversation.id,
            body: turn.draft.body,
            confidence: turn.draft.confidence ?? null,
          }),
        );
      }
      // A draft nobody sees is a draft nobody sends — put the thread in the queue.
      if (conversation.escalated !== 1) {
        await this.chatService.escalate(session, conversation.id).catch((e) => {
          this.logger.warn(`escalation failed for conversation ${conversation.id}: ${(e as Error).message}`);
        });
      }
    } else {
      // Auto-reply off (or a human already owns the thread): keep the message,
      // let the console answer. Nothing is generated on the shopper's behalf.
      const stored = await this.msgRepo.save(
        this.msgRepo.create({
          tenantId: channel.tenantId,
          conversationId: conversation.id,
          senderType: SENDER_TYPE.USER,
          body: inbound.text,
          lang: session.language,
        }),
      );
      if (attachmentIds.length && this.attachments) {
        await this.attachments
          .attachToMessage(attachmentIds, {
            tenantId: channel.tenantId,
            messageId: Number(stored.id),
            conversationId: Number(conversation.id),
          })
          .catch((e: Error) => this.logger.warn(`attachment claim failed: ${e.message}`));
      }
      await this.recordInquiry(session);
      // Escalate once per conversation, not once per message. Calling it on
      // every inbound paged the agents again for a thread already sitting in
      // their queue — 400 messages across 37 conversations on staging.
      if (!humanOwnsThread && conversation.escalated !== 1) {
        await this.chatService.escalate(session, conversation.id).catch((e) => {
          this.logger.warn(`escalation failed for conversation ${conversation.id}: ${(e as Error).message}`);
        });
      }
    }

    const userTurn = await this.msgRepo.findOne({
      where: {
        conversationId: conversation.id,
        senderType: SENDER_TYPE.USER,
        id: MoreThan(sinceId),
      },
      order: { id: 'ASC' },
    });
    if (userTurn) {
      // Loop prevention #3 rests on this row: an inbound-origin message is
      // never relayed back out (see MessengerOutboxService.flushThread).
      await this.mapRepo
        .save(
          this.mapRepo.create({
            tenantId: channel.tenantId,
            threadId: thread.id,
            externalMessageId: inbound.externalMessageId,
            messageId: Number(userTurn.id),
            direction: CHANNEL_DIRECTION.INBOUND,
          }),
        )
        .catch(() => undefined); // concurrent delivery already mapped it
    }

    await this.threadRepo.update(
      { id: thread.id },
      { lastInboundAt: new Date(), inboundCursor: inbound.externalMessageId },
    );

    // Send the AI answer (and the consent notice) straight away rather than
    // waiting for the worker tick — a chat reply that lands 10s late reads as broken.
    await this.outbox.flushThread(thread.id).catch((e) => {
      this.logger.warn(`outbox flush failed for thread ${thread.id}: ${(e as Error).message}`);
    });
  }

  /**
   * Download the files a platform delivered and store them as unattached
   * uploads, returning their ids for the turn to claim (PLN-260814 S5).
   *
   * Failure is per-file and never fatal: one unreachable photo must not cost us
   * the message it came with. A file that cannot be fetched is logged, not
   * silently forgotten — the agent still sees the text, and the log says why
   * the picture is missing.
   */
  private async storeInboundAttachments(
    channel: MessengerChannel,
    inbound: NormalizedInbound,
    conversationId: number,
    language: string,
  ): Promise<string[]> {
    const refs = inbound.attachments ?? [];
    if (!refs.length || !this.attachments) return [];

    const adapter = this.registry?.find(channel.provider);
    const ids: string[] = [];
    let dropped = 0;
    for (const ref of refs.slice(0, this.attachments.maxPerMessage())) {
      try {
        const fetched = await this.fetchInbound(channel, adapter, ref);
        if (!fetched) continue;
        const saved = await this.attachments.store(
          {
            originalname: fetched.filename,
            mimetype: fetched.mime ?? '',
            size: fetched.buffer.length,
            buffer: fetched.buffer,
          },
          {
            tenantId: channel.tenantId,
            conversationId,
            sessionId: null,
            uploaderType: 'user',
            uploaderId: null,
            source: channel.provider,
          },
        );
        ids.push(saved.uuid);
      } catch (e) {
        dropped++;
        this.logger.warn(
          `inbound attachment dropped (channel ${channel.id}, thread ${inbound.externalThreadId}): ${(e as Error).message}`,
        );
      }
    }

    if (dropped) await this.noteDroppedAttachments(channel, conversationId, dropped, language);
    return ids;
  }

  /**
   * A file we could not store leaves a visible trace in the conversation
   * (PLN-260817 §2.2).
   *
   * Before this, the customer's photo vanished between their phone and the
   * console: they believed it had arrived, the agent saw a message about a
   * photo that was not there, and the only record was a log line nobody reads.
   * The note is written as a `system` message, which the outbox also delivers
   * to the customer's own channel — so the wording asks for the picture again
   * rather than talking about the customer in the third person.
   */
  private async noteDroppedAttachments(
    channel: MessengerChannel,
    conversationId: number,
    count: number,
    language: string,
  ): Promise<void> {
    const lang = (language || 'EN').toUpperCase() as keyof typeof ATTACHMENT_DROPPED_NOTICE;
    const body = (ATTACHMENT_DROPPED_NOTICE[lang] ?? ATTACHMENT_DROPPED_NOTICE.EN)(count);
    try {
      await this.msgRepo.save(
        this.msgRepo.create({
          tenantId: channel.tenantId,
          conversationId,
          senderType: SENDER_TYPE.SYSTEM,
          body,
          lang: language,
        }),
      );
    } catch (e) {
      this.logger.warn(`could not record dropped-attachment notice: ${(e as Error).message}`);
    }
  }

  /** Bytes for one reference: adapter resolve → inline data → plain fetch. */
  private async fetchInbound(
    channel: MessengerChannel,
    adapter: { downloadAttachment?: MessengerAdapter['downloadAttachment'] } | undefined,
    ref: InboundAttachmentRef,
  ): Promise<{ buffer: Buffer; filename: string; mime: string | null } | null> {
    if (ref.data?.length) {
      return { buffer: ref.data, filename: ref.filename || 'file', mime: ref.mime ?? null };
    }
    if (ref.fileId && adapter?.downloadAttachment) {
      const secret = decryptChannelSecret(channel);
      const got = await adapter.downloadAttachment({ channel, secret }, ref);
      return got ? { ...got, mime: got.mime ?? ref.mime ?? null } : null;
    }
    if (!ref.url) return null;

    const res = await fetch(ref.url);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    // Name from the reference, else the URL's last path segment — the stored
    // type check needs an extension it can read.
    const fromUrl = decodeURIComponent(new URL(ref.url).pathname.split('/').pop() || '');
    return {
      buffer,
      filename: ref.filename || fromUrl || 'file',
      mime: ref.mime ?? res.headers.get('content-type'),
    };
  }

  /**
   * Idempotent thread lookup. A unique-key collision is the normal outcome of
   * two concurrent deliveries for a new chat, not an error: re-read and use the
   * winner's row (AMA kakao-integration pattern).
   */
  private async findOrCreateThread(
    channel: MessengerChannel,
    inbound: NormalizedInbound,
  ): Promise<ChannelThread> {
    const existing = await this.threadRepo.findOne({
      where: { channelId: channel.id, externalThreadId: inbound.externalThreadId },
    });
    if (existing) {
      // Display name and reply permission can change between messages.
      const patch: Partial<ChannelThread> = {};
      if (inbound.externalUserName && inbound.externalUserName !== existing.externalUserName) {
        patch.externalUserName = inbound.externalUserName;
      }
      const replyEnabled = inbound.replyEnabled ? 1 : 0;
      if (replyEnabled !== existing.replyEnabled) patch.replyEnabled = replyEnabled;
      if (Object.keys(patch).length) {
        await this.threadRepo.update({ id: existing.id }, patch);
        Object.assign(existing, patch);
      }
      return existing;
    }

    try {
      return await this.threadRepo.save(
        this.threadRepo.create({
          tenantId: channel.tenantId,
          channelId: channel.id,
          externalThreadId: inbound.externalThreadId,
          subChannel: inbound.subChannel,
          replyEnabled: inbound.replyEnabled ? 1 : 0,
          externalUserId: inbound.externalUserId,
          externalUserName: inbound.externalUserName,
        }),
      );
    } catch (e) {
      const raced = await this.threadRepo.findOne({
        where: { channelId: channel.id, externalThreadId: inbound.externalThreadId },
      });
      if (raced) return raced;
      throw e;
    }
  }

  /**
   * Session for the thread. External channels have no consent banner, so the
   * grant is recorded here — after the notice message for 'notice' channels,
   * or on the platform's terms for 'auto' ones (PLN-260810 §4.4).
   */
  private async resolveSession(
    channel: MessengerChannel,
    thread: ChannelThread,
    inbound: NormalizedInbound,
  ): Promise<Session> {
    if (thread.sessionId != null) {
      const existing = await this.sessionRepo.findOne({ where: { id: thread.sessionId } });
      if (existing) return existing;
    }

    const noticeVersion = await this.sessionService.effectiveNoticeVersion(channel.tenantId);
    // Channel-level AI-agent binding (PLN-260820): an operator can point e.g.
    // the partner-support Kakao channel at the partner persona. Unset/unknown
    // codes pin nothing — the tenant default answers, as before.
    const aiAgentId = await this.sessionService.resolveAiAgentId(
      channel.tenantId,
      typeof channel.config?.ai_agent_code === 'string' ? channel.config.ai_agent_code : undefined,
    );
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        sessionToken: generateToken(),
        // The badge in the console and the AI's channel awareness both read this.
        channel: thread.subChannel ?? channel.provider,
        tenantId: channel.tenantId,
        aiAgentId,
        customerId: null,
        identityLevel: SESSION_IDENTITY.GUEST,
        // Tenant default when the platform gives no locale — a relay sends
        // none, and English notices in a Korean room were the result (B-2).
        language: await this.sessionService.languageForChannel(
          channel.tenantId,
          inbound.languageHint,
        ),
        consentState: CONSENT_STATE.GRANTED,
        consentAt: new Date(),
        consentVersion: noticeVersion,
      }),
    );
    await this.threadRepo.update({ id: thread.id }, { sessionId: Number(session.id) });
    thread.sessionId = Number(session.id);
    this.logger.log(
      `channel session created: channel=${channel.id} thread=${thread.id} session=${session.id} consent=${channel.consentMode}`,
    );
    return session;
  }

  /** Open conversation for the thread, stamped with the channel for the console. */
  private async resolveConversation(
    channel: MessengerChannel,
    thread: ChannelThread,
    session: Session,
  ): Promise<Conversation> {
    const open = await this.chatService.findOpenConversation(Number(session.id));
    if (open) {
      if (thread.conversationId !== Number(open.id)) {
        await this.threadRepo.update({ id: thread.id }, { conversationId: Number(open.id) });
        thread.conversationId = Number(open.id);
      }
      return open;
    }

    const conversation = await this.convRepo.save(
      this.convRepo.create({
        tenantId: channel.tenantId,
        sessionId: Number(session.id),
        // Not 'widget': the console badge and any channel-aware routing key off this.
        channel: thread.subChannel ?? channel.provider,
        status: CONVERSATION_STATUS.AI_ACTIVE,
        escalated: 0,
        agentId: null,
      }),
    );
    await this.threadRepo.update({ id: thread.id }, { conversationId: Number(conversation.id) });
    thread.conversationId = Number(conversation.id);
    return conversation;
  }

  /**
   * Post the privacy notice to this room once (PLN-260909), as a real system
   * message: it is relayed out AND visible to the agent, and it is saved before
   * the AI turn so the outbox delivers it first. Skipped on 'auto' channels
   * (platform terms cover it), on receive-only threads (nothing can be
   * delivered), and when the room already saw the current notice version.
   */
  private async ensureNotice(
    channel: MessengerChannel,
    thread: ChannelThread,
    session: Session,
    conversation: Conversation,
  ): Promise<void> {
    if (channel.consentMode !== MESSENGER_CONSENT_MODE.NOTICE) return;
    if (thread.replyEnabled !== 1) return;
    const version = session.consentVersion ?? (await this.sessionService.effectiveNoticeVersion(channel.tenantId));
    if (thread.noticeVersion != null && thread.noticeVersion === version) return;

    await this.msgRepo.save(
      this.msgRepo.create({
        tenantId: channel.tenantId,
        conversationId: Number(conversation.id),
        senderType: SENDER_TYPE.SYSTEM,
        body: localized(CONSENT_NOTICE, session.language),
        lang: session.language,
      }),
    );
    await this.threadRepo.update({ id: thread.id }, { noticeVersion: version });
    thread.noticeVersion = version;
  }
}


