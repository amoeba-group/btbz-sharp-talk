import { stripLiteMarkdown } from '@sharptalk/types';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThan, Or, Repository } from 'typeorm';
import { CHANNEL_DIRECTION, OUTBOX_STATUS, SENDER_TYPE } from '@sharptalk/types';
import { Message } from '../chat/entity/message.entity';
import { MessengerChannel } from './entity/messenger-channel.entity';
import { ChannelThread } from './entity/channel-thread.entity';
import { ChannelMessageMap } from './entity/channel-message-map.entity';
import { ChannelOutbox } from './entity/channel-outbox.entity';
import { AdapterRegistry } from './adapter/adapter.registry';
import { OutboundAttachment } from './adapter/messenger-adapter';
import { decryptChannelSecret } from './messenger-secret.util';
import { AttachmentService } from '../attachment/attachment.service';
import { AttachmentMapper } from '../attachment/attachment.mapper';

/** Backoff ladder; the last entry repeats until MAX_ATTEMPTS is spent. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
const MAX_ATTEMPTS = 5;
/** Rows drained per worker tick — bounded so one stuck channel can't hog it. */
const BATCH = 25;
/** Messages scanned per thread flush. */
const SCAN_LIMIT = 20;
/**
 * Attachment links sent to an external platform live far longer than the
 * console's 15 minutes: a customer opens a KakaoTalk message hours later, and a
 * dead link would read as a broken reply. Still bounded — the file does not
 * become permanently public.
 */
const MESSENGER_LINK_TTL_SEC = 7 * 24 * 3600;

/**
 * Outbound relay (PLN-260810 §4.1). Chat and agent code stay untouched: the
 * outbox scans forward from each thread's `outbound_cursor`, so any message
 * those paths persist — AI answer, agent reply, system notice — reaches the
 * channel without them knowing channels exist.
 */
@Injectable()
export class MessengerOutboxService {
  private readonly logger = new Logger(MessengerOutboxService.name);

  constructor(
    @InjectRepository(ChannelOutbox) private readonly outboxRepo: Repository<ChannelOutbox>,
    @InjectRepository(ChannelThread) private readonly threadRepo: Repository<ChannelThread>,
    @InjectRepository(ChannelMessageMap) private readonly mapRepo: Repository<ChannelMessageMap>,
    @InjectRepository(MessengerChannel) private readonly channelRepo: Repository<MessengerChannel>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    private readonly registry: AdapterRegistry,
    /** Files on an outbound turn (PLN-260814 S5); optional for older test doubles. */
    private readonly attachments?: AttachmentService,
  ) {}

  /** Does this message carry files? Decides whether an empty body is sendable. */
  private async hasAttachments(messageId: number): Promise<boolean> {
    if (!this.attachments) return false;
    const map = await this.attachments.findByMessageIds([messageId]);
    return (map.get(String(messageId))?.length ?? 0) > 0;
  }

  /**
   * Files for one outbound message as absolute, signed links. The platform (or
   * the customer) fetches them from us, so the URL has to name a public host —
   * without one configured, there is nothing deliverable to point at.
   */
  private async outboundAttachments(messageId: number): Promise<OutboundAttachment[]> {
    if (!this.attachments) return [];
    const base = (
      process.env.MESSENGER_WEBHOOK_BASE_URL ??
      process.env.PUBLIC_BASE_URL ??
      process.env.SHOPIFY_APP_URL ??
      ''
    ).replace(/\/+$/, '');
    const rows = (await this.attachments.findByMessageIds([messageId])).get(String(messageId)) ?? [];
    if (!rows.length) return [];
    if (!base) {
      this.logger.warn(
        `attachment link skipped for message ${messageId}: no public base URL configured`,
      );
      return [];
    }
    return rows.map((a) => ({
      url: AttachmentMapper.url(a.uuid, 'full', Date.now(), base, MESSENGER_LINK_TTL_SEC),
      filename: a.filename,
      mime: a.mime,
      kind: a.kind === 'image' ? ('image' as const) : ('file' as const),
    }));
  }

  /**
   * Queue everything new on a thread, then try to deliver it. Advancing the
   * cursor past skipped messages is deliberate: a customer turn must never be
   * reconsidered as outbound work.
   */
  async flushThread(threadId: number): Promise<void> {
    const thread = await this.threadRepo.findOne({ where: { id: threadId } });
    if (!thread?.conversationId) return;

    const messages = await this.msgRepo.find({
      where: {
        conversationId: thread.conversationId,
        id: MoreThan(thread.outboundCursor ?? 0),
      },
      order: { id: 'ASC' },
      take: SCAN_LIMIT,
    });

    // Receive-only thread (btbz relay SMS): nothing queued here could ever be
    // delivered, so the consent notice, CSAT prompt and AI answers written to
    // the conversation are walked past instead of parked as permanent failures
    // — 473 such rows on staging by 2026-09-08 (FIX-260908). deliver() keeps
    // its own guard for rows queued before a thread turned receive-only.
    const receiveOnly = thread.replyEnabled !== 1;

    let cursor = thread.outboundCursor ?? 0;
    for (const message of messages) {
      const id = Number(message.id);
      cursor = id;
      if (receiveOnly) continue;
      // Loop prevention #3 (a): the shopper's own words never go back to them.
      if (message.senderType === SENDER_TYPE.USER) continue;
      // Loop prevention #3 (b): defence in depth for any inbound-origin row.
      const inboundOrigin = await this.mapRepo.findOne({
        where: { messageId: id, direction: CHANNEL_DIRECTION.INBOUND },
      });
      if (inboundOrigin) continue;
      // Empty body USED to mean "nothing to send". Since PLN-260814 a reply can
      // be a file with no words, and skipping it here is how an agent's photo
      // would vanish between the console and the customer's phone (SI-1).
      if (!message.body?.trim() && !(await this.hasAttachments(id))) continue;

      await this.outboxRepo
        .save(
          this.outboxRepo.create({
            tenantId: thread.tenantId,
            threadId: thread.id,
            messageId: id,
            status: OUTBOX_STATUS.PENDING,
            attempts: 0,
            nextAttemptAt: null,
          }),
        )
        // uk_co_message — already queued by a concurrent flush.
        .catch(() => undefined);
    }

    if (cursor !== (thread.outboundCursor ?? 0)) {
      await this.threadRepo.update({ id: thread.id }, { outboundCursor: cursor });
    }
    await this.deliverPendingForThread(thread.id);
  }

  /** Queue new messages for every thread that has some (worker sweep). */
  async flushAllThreads(limit = 100): Promise<number> {
    const rows = await this.threadRepo
      .createQueryBuilder('t')
      .select('t.id', 'id')
      .innerJoin(Message, 'm', 'm.conversation_id = t.conversation_id')
      .where('t.conversation_id IS NOT NULL')
      .andWhere('m.id > COALESCE(t.outbound_cursor, 0)')
      .groupBy('t.id')
      .limit(limit)
      .getRawMany<{ id: number }>();

    for (const row of rows) {
      await this.flushThread(Number(row.id)).catch((e) =>
        this.logger.warn(`flush thread ${row.id} failed: ${(e as Error).message}`),
      );
    }
    return rows.length;
  }

  /**
   * Resolve sends the provider could not confirm at the time (btbz relay hands
   * the reply to a device agent). Rows stay 'unconfirmed' until the agent
   * reports back — never silently promoted to 'sent'.
   */
  async confirmUnconfirmed(): Promise<number> {
    const rows = await this.outboxRepo.find({
      where: { status: OUTBOX_STATUS.UNCONFIRMED },
      order: { id: 'ASC' },
      take: BATCH,
    });

    let resolved = 0;
    for (const row of rows) {
      if (!row.externalCommandId) continue;
      const thread = await this.threadRepo.findOne({ where: { id: row.threadId } });
      if (!thread) continue;
      const channel = await this.channelRepo.findOne({ where: { id: thread.channelId } });
      if (!channel) continue;
      const adapter = this.registry.find(channel.provider);
      if (!adapter?.confirm) continue;

      try {
        const secret = decryptChannelSecret(channel);
        const verdict = await adapter.confirm({ channel, secret }, thread, row.externalCommandId);
        if (verdict === 'pending' || verdict === 'unconfirmed') continue;
        await this.outboxRepo.update(
          { id: row.id },
          verdict === 'sent'
            ? { status: OUTBOX_STATUS.SENT, lastError: null }
            : { status: OUTBOX_STATUS.FAILED, lastError: 'relay agent reported failure' },
        );
        resolved += 1;
      } catch (e) {
        this.logger.warn(`confirm failed for outbox ${row.id}: ${(e as Error).message}`);
      }
    }
    return resolved;
  }

  /** Deliver rows whose backoff has elapsed (worker tick). */
  async deliverDue(): Promise<number> {
    const due = await this.outboxRepo.find({
      where: {
        status: OUTBOX_STATUS.PENDING,
        nextAttemptAt: Or(IsNull(), LessThanOrEqual(new Date())),
      },
      order: { id: 'ASC' },
      take: BATCH,
    });
    for (const row of due) await this.deliver(row);
    return due.length;
  }

  private async deliverPendingForThread(threadId: number): Promise<void> {
    const rows = await this.outboxRepo.find({
      where: { threadId, status: OUTBOX_STATUS.PENDING },
      order: { id: 'ASC' },
      take: SCAN_LIMIT,
    });
    for (const row of rows) await this.deliver(row);
  }

  private async deliver(row: ChannelOutbox): Promise<void> {
    const thread = await this.threadRepo.findOne({ where: { id: row.threadId } });
    if (!thread) return void (await this.fail(row, 'thread missing', true));

    // Receive-only thread (btbz relay SMS): sending would 400 on every retry.
    if (thread.replyEnabled !== 1) {
      return void (await this.fail(row, 'thread is receive-only', true));
    }

    const channel = await this.channelRepo.findOne({ where: { id: thread.channelId } });
    if (!channel || channel.active !== 1) {
      // Not terminal: an operator re-enabling the channel should drain the queue.
      return void (await this.fail(row, 'channel inactive', false));
    }

    // Idempotency across retries: a mapped outbound row was already delivered.
    const already = await this.mapRepo.findOne({
      where: { messageId: row.messageId, direction: CHANNEL_DIRECTION.OUTBOUND },
    });
    if (already) {
      await this.outboxRepo.update({ id: row.id }, { status: OUTBOX_STATUS.SENT, lastError: null });
      return;
    }

    const message = await this.msgRepo.findOne({ where: { id: row.messageId } });
    if (!message) return void (await this.fail(row, 'message missing', true));

    const adapter = this.registry.find(channel.provider);
    if (!adapter) return void (await this.fail(row, `no adapter for ${channel.provider}`, true));

    const files = await this.outboundAttachments(Number(message.id));
    if (!message.body?.trim() && !files.length) {
      return void (await this.fail(row, 'message missing', true));
    }

    try {
      const secret = decryptChannelSecret(channel);
      // Platforms that carry files get them; the rest get the links appended to
      // the text, which is a delivery the customer can act on rather than a
      // failure they never hear about (PLN-260814 FR-7).
      const native = adapter.supportsAttachments === true;
      // Channels here show plain text only, so markdown goes out as structure
      // without markers — "- **Email:** a@b" arrives as "• Email: a@b"
      // instead of literal asterisks (PLN-261008 S5). The stored body is unchanged.
      const plain = stripLiteMarkdown(message.body ?? '');
      const text = native ? plain : appendLinks(plain, files);
      const result = await adapter.send(
        { channel, secret },
        thread,
        text,
        native ? files : undefined,
      );
      await this.mapRepo
        .save(
          this.mapRepo.create({
            tenantId: row.tenantId,
            threadId: thread.id,
            externalMessageId: result.externalMessageId || `msg:${row.messageId}`,
            messageId: row.messageId,
            direction: CHANNEL_DIRECTION.OUTBOUND,
          }),
        )
        .catch(() => undefined);
      await this.outboxRepo.update(
        { id: row.id },
        {
          // 'unconfirmed' is not a lesser 'sent' — it means delivery is unproven.
          status: result.unconfirmed ? OUTBOX_STATUS.UNCONFIRMED : OUTBOX_STATUS.SENT,
          externalCommandId: result.unconfirmed ? result.externalMessageId : null,
          lastError: null,
        },
      );
      if (channel.status !== 'connected' || channel.lastError) {
        await this.channelRepo.update({ id: channel.id }, { status: 'connected', lastError: null });
      }
    } catch (e) {
      const reason = (e as Error).message.slice(0, 200);
      await this.fail(row, reason, false);
      await this.channelRepo.update({ id: channel.id }, { status: 'error', lastError: reason });
    }
  }

  private async fail(row: ChannelOutbox, reason: string, terminal: boolean): Promise<void> {
    const attempts = row.attempts + 1;
    const exhausted = terminal || attempts >= MAX_ATTEMPTS;
    if (exhausted) {
      this.logger.warn(`outbox ${row.id} failed permanently after ${attempts}: ${reason}`);
    }
    await this.outboxRepo.update(
      { id: row.id },
      {
        status: exhausted ? OUTBOX_STATUS.FAILED : OUTBOX_STATUS.PENDING,
        attempts,
        lastError: reason,
        nextAttemptAt: exhausted
          ? null
          : new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
      },
    );
  }
}

/**
 * Link fallback for a platform that cannot carry files (PLN-260814 FR-7).
 * The customer gets something they can open; the alternative — treating it as
 * an undeliverable message — loses the file with nobody told.
 */
export function appendLinks(body: string | null | undefined, files: OutboundAttachment[]): string {
  if (!files.length) return body ?? '';
  const lines = files.map((f) => `${f.filename}: ${f.url}`);
  const text = (body ?? '').trim();
  return text ? `${text}\n\n${lines.join('\n')}` : lines.join('\n');
}
