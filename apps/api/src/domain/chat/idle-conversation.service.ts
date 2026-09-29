import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { CONVERSATION_STATUS, SENDER_TYPE, localized } from '@sharptalk/types';
import type { LocalizedText } from '@sharptalk/types';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Assignment } from '../agent/entity/assignment.entity';
import { AuditService } from '../audit/audit.service';
import { envNumber } from '../../global/util/env-number.util';

/** How often the sweep runs. 0 disables it. */
const SWEEP_INTERVAL_SEC = envNumber('IDLE_SWEEP_INTERVAL_SEC', '30');
/** Silence from both sides before the customer is asked whether anything is left. */
const PROMPT_AFTER_MIN = envNumber('IDLE_PROMPT_AFTER_MIN', '30');
/** Grace period after that question before the thread closes. */
const CLOSE_AFTER_SEC = envNumber('IDLE_CLOSE_AFTER_SEC', '60');
/** The only channel this sweeper owns; everything else belongs to an agent. */
const CONVERSATION_CHANNEL_WIDGET = 'widget';
/**
 * Past this, a thread is closed without asking anything. Reopening a
 * conversation that went quiet six weeks ago to say "anything else?" reads as a
 * system glitch, not service — the oldest abandoned thread on staging last
 * spoke on 2026-06-30.
 */
const STALE_AFTER_DAYS = envNumber('IDLE_STALE_AFTER_DAYS', '7');
/** Rows handled per sweep, so a backlog cannot stall the tick. */
const BATCH = 50;

const PROMPT_COPY: LocalizedText = {
  EN: 'Is there anything else I can help you with? If not, I’ll close this chat shortly.',
  ES: '¿Hay algo más en lo que pueda ayudarte? Si no, cerraré este chat en breve.',
  KO: '혹시 더 도와드릴 일이 있으실까요? 없으시면 잠시 후 상담을 마칠게요.',
  VI: 'Bạn còn cần tôi hỗ trợ gì nữa không? Nếu không, tôi sẽ kết thúc cuộc trò chuyện này sau ít phút.',
  JA: 'ほかにお手伝いできることはございますか。ないようでしたら、まもなくこのチャットを終了いたします。',
  ZH: '还有什么可以帮您的吗？如果没有，我稍后会结束这次对话。',
};

const CLOSING_COPY: LocalizedText = {
  EN: 'Thanks for chatting with us. How satisfied were you with this conversation?',
  ES: 'Gracias por escribirnos. ¿Qué tan satisfecho quedaste con esta conversación?',
  KO: '이용해 주셔서 감사합니다. 상담에 만족하셨나요?',
  VI: 'Cảm ơn bạn đã trò chuyện với chúng tôi. Bạn hài lòng với cuộc trò chuyện này ở mức nào?',
  JA: 'ご利用いただきありがとうございました。今回のご対応にどの程度ご満足いただけましたか。',
  ZH: '感谢您与我们联系。您对本次对话的满意度如何？',
};

/**
 * Closes conversations nobody is tending (PLN-260810 P1).
 *
 * Handback (S1) gave an agent a way to step out deliberately. This covers the
 * case where nobody does anything at all: measured on staging, seven threads
 * sat in `agent` with ten customer messages that neither a person nor the bot
 * ever answered, the oldest for over forty days.
 *
 * State lives in `conversations.idle_prompt_at`, not in a timer. Two timers —
 * one for the 30 minutes, one for the 60 seconds — would die with the process
 * and leave threads half-closed; a column survives a restart and doubles as the
 * ask-once latch.
 */
@Injectable()
export class IdleConversationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdleConversationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Assignment) private readonly assignmentRepo: Repository<Assignment>,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    if (!Number.isFinite(SWEEP_INTERVAL_SEC) || SWEEP_INTERVAL_SEC <= 0) {
      this.logger.warn('Idle conversation sweep DISABLED (IDLE_SWEEP_INTERVAL_SEC=0)');
      return;
    }
    this.logger.log(
      `Idle sweep every ${SWEEP_INTERVAL_SEC}s — ask after ${PROMPT_AFTER_MIN}min, ` +
        `close after ${CLOSE_AFTER_SEC}s, silent close past ${STALE_AFTER_DAYS}d`,
    );
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_SEC * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One pass: close what is due, then ask what has gone quiet.
   *
   * Silent closes are counted separately. Folding them into `closed` would hide
   * how many customers were spoken to, and leaving them out of the log entirely
   * — as the first version did — reported "asked 20, closed 0" on a sweep that
   * had just ended thirteen conversations (observed on the staging backfill).
   */
  async sweep(): Promise<{ prompted: number; closed: number; silentlyClosed: number }> {
    const idle = { prompted: 0, closed: 0, silentlyClosed: 0 };
    if (this.running) return idle;
    this.running = true;
    try {
      idle.closed = await this.closeDue();
      const asked = await this.promptIdle();
      idle.prompted = asked.prompted;
      idle.silentlyClosed = asked.silentlyClosed;
      if (idle.prompted || idle.closed || idle.silentlyClosed) {
        this.logger.log(
          `idle sweep: asked ${idle.prompted}, closed ${idle.closed}, ` +
            `closed without asking ${idle.silentlyClosed}`,
        );
      }
      return idle;
    } catch (e) {
      this.logger.warn(`idle sweep failed: ${(e as Error).message}`);
      return idle;
    } finally {
      this.running = false;
    }
  }

  /** Threads that were asked and did not answer inside the grace period. */
  private async closeDue(): Promise<number> {
    const due = await this.convRepo.find({
      where: this.sweepable({
        status: this.openStatuses(),
        idlePromptAt: LessThan(new Date(Date.now() - CLOSE_AFTER_SEC * 1000)),
        // Also excluded here, not just in the ask pass: a thread can be asked
        // and only then slip off hours, and closing it would cancel the email
        // reply the customer was promised in between.
        replyChannel: IsNull(),
      }),
      take: BATCH,
    });

    let closed = 0;
    for (const conversation of due) {
      // The customer may have replied between the question and this tick; the
      // reply clears the latch, but a race is still possible, so re-check.
      const answered = await this.msgRepo.count({
        where: {
          conversationId: conversation.id,
          senderType: SENDER_TYPE.USER,
          createdAt: this.after(conversation.idlePromptAt!),
        },
      });
      if (answered > 0) {
        await this.convRepo.update({ id: conversation.id }, { idlePromptAt: null });
        continue;
      }
      await this.close(conversation, true);
      closed += 1;
    }
    return closed;
  }

  /** Threads nobody has touched for long enough to ask about. */
  private async promptIdle(): Promise<{ prompted: number; silentlyClosed: number }> {
    const quietSince = new Date(Date.now() - PROMPT_AFTER_MIN * 60_000);
    const candidates = await this.convRepo.find({
      where: this.sweepable({
        status: this.openStatuses(),
        idlePromptAt: IsNull(),
        // An off-hours thread is waiting on a promised email reply; closing it
        // would cancel an answer the customer was told to expect.
        replyChannel: IsNull(),
      }),
      take: BATCH * 4,
    });

    let prompted = 0;
    let silentlyClosed = 0;
    for (const conversation of candidates) {
      const last = await this.msgRepo.findOne({
        where: { conversationId: conversation.id },
        order: { id: 'DESC' },
      });
      const lastAt = last?.createdAt ?? conversation.createdAt;
      if (lastAt > quietSince) continue;

      const staleBefore = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);
      if (lastAt < staleBefore) {
        // Reported on its own line: nothing was said to anyone, and an operator
        // reading the log needs to see that these ended too.
        await this.close(conversation, false);
        silentlyClosed += 1;
        continue;
      }

      const language = await this.languageOf(conversation);
      await this.say(conversation, PROMPT_COPY, language);
      await this.convRepo.update({ id: conversation.id }, { idlePromptAt: new Date() });
      await this.record(conversation, 'chat.idle_prompted');
      prompted += 1;
      if (prompted >= BATCH) break;
    }
    return { prompted, silentlyClosed };
  }

  /**
   * End the thread. `withClosing` is false for threads too old to talk to —
   * they are closed silently, since a satisfaction question about a
   * conversation from six weeks ago is noise.
   */
  private async close(conversation: Conversation, withClosing: boolean): Promise<void> {
    if (withClosing) {
      await this.say(conversation, CLOSING_COPY, await this.languageOf(conversation));
    }
    await this.convRepo.update(
      { id: conversation.id },
      { status: CONVERSATION_STATUS.ENDED, endedAt: new Date(), idlePromptAt: null },
    );
    await this.assignmentRepo.update(
      { conversationId: conversation.id, status: 'active' },
      { status: 'released', releasedAt: new Date() },
    );
    await this.record(conversation, 'chat.idle_closed');
  }

  private async say(
    conversation: Conversation,
    copy: LocalizedText,
    language: string,
  ): Promise<void> {
    await this.msgRepo.save(
      this.msgRepo.create({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        senderType: SENDER_TYPE.SYSTEM,
        body: localized(copy, language),
        lang: language,
        retrievalTrace: null,
      }),
    );
  }

  private async languageOf(conversation: Conversation): Promise<string> {
    const session = await this.sessionRepo.findOne({ where: { id: conversation.sessionId } });
    return session?.language ?? 'EN';
  }

  private async record(conversation: Conversation, action: string): Promise<void> {
    await this.audit
      .write({
        tenantId: conversation.tenantId,
        // Nobody clicked anything — attributing this to a person would put a
        // machine's decision under someone's name in the audit trail.
        actorType: 'system',
        actorId: 0,
        action,
        target: `conversation:${conversation.id}`,
      })
      .catch((e: Error) => this.logger.warn(`${action} audit failed: ${e.message}`));
  }

  private openStatuses() {
    return In([CONVERSATION_STATUS.AGENT, CONVERSATION_STATUS.WAITING]);
  }

  /**
   * Only widget threads are swept (PLN-260812 S5).
   *
   * "Idle" is a widget idea: the visitor closed the tab. A KakaoTalk room or a
   * mail thread does not go idle — the person is simply not typing — and
   * closing it sent "Anything else? / Rate this chat" into someone's personal
   * chat room 52 times on staging. Messenger threads are ended by an agent.
   *
   * Expressed as two alternatives so legacy NULL rows keep being swept.
   */
  private sweepable<T extends Record<string, unknown>>(where: T): T[] {
    return [
      { ...where, channel: IsNull() },
      { ...where, channel: CONVERSATION_CHANNEL_WIDGET },
    ];
  }

  private after(date: Date) {
    return MoreThan(date);
  }
}
