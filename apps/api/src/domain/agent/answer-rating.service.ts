import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { SENDER_TYPE } from '@sharptalk/types';
import { AnswerRating, ANSWER_RATING, ANSWER_RATING_REASON } from './entity/answer-rating.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** Published when an AI answer is rated partial/inaccurate (consumed by KnowledgeGapService). */
export interface AnswerRatedEvent {
  tenantId: number;
  conversationId: number;
  messageId: number;
  rating: string;
  reason: string | null;
  note: string | null;
}

const RATINGS = new Set<string>(Object.values(ANSWER_RATING));
const REASONS = new Set<string>(Object.values(ANSWER_RATING_REASON));
const RATABLE = new Set<string>([SENDER_TYPE.AI, SENDER_TYPE.AGENT]);

export interface RatingSummary {
  from: string;
  to: string;
  /** senderType → rating → count. */
  bySender: Record<string, Record<string, number>>;
  /** reason → count, over partial + inaccurate only. */
  byReason: Record<string, number>;
  total: number;
}

/**
 * Answer accuracy ratings (PLN-261015 D7).
 *
 * Customer satisfaction says whether a customer was happy, not whether the
 * answer was right; golden runs check a fixed set. This is the missing signal:
 * an agent who takes over a conversation marks the AI answer they found there.
 */
@Injectable()
export class AnswerRatingService {
  private readonly logger = new Logger(AnswerRatingService.name);

  constructor(
    @InjectRepository(AnswerRating) private readonly ratingRepo: Repository<AnswerRating>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    private readonly bus: EventBusService,
  ) {}

  async rate(
    tenantId: number,
    userId: number,
    conversationId: number,
    messageId: number,
    input: { rating: string; reason?: string | null; note?: string | null },
  ): Promise<AnswerRating> {
    if (!RATINGS.has(input.rating)) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const reason = input.reason && REASONS.has(input.reason) ? input.reason : null;
    const note = input.note?.trim().slice(0, 500) || null;

    // Same 404 for "not yours" and "not there": the ids are enumerable.
    const conversation = await this.convRepo.findOne({ where: { id: conversationId, tenantId } });
    const message = conversation
      ? await this.msgRepo.findOne({ where: { id: messageId, conversationId } })
      : null;
    if (!conversation || !message) {
      this.logger.warn(`rating refused: conversation ${conversationId} message ${messageId} tenant ${tenantId}`);
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    if (!RATABLE.has(message.senderType)) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }

    const existing = await this.ratingRepo.findOne({ where: { tenantId, messageId, ratedBy: userId } });
    const row = existing ?? this.ratingRepo.create({ tenantId, conversationId, messageId, ratedBy: userId });
    row.senderType = message.senderType;
    row.rating = input.rating;
    // An "accurate" verdict carries no reason — a stale one would skew the reason chart.
    row.reason = input.rating === ANSWER_RATING.ACCURATE ? null : reason;
    row.note = note;
    const saved = await this.ratingRepo.save(row);

    if (message.senderType === SENDER_TYPE.AI && input.rating !== ANSWER_RATING.ACCURATE) {
      const event: AnswerRatedEvent = {
        tenantId,
        conversationId,
        messageId,
        rating: input.rating,
        reason: row.reason,
        note,
      };
      await this.bus.publish(EVENTS.ANSWER_RATED, event);
    }
    return saved;
  }

  /** Latest verdict per message, for the transcript the console is showing. */
  async forMessages(tenantId: number, messageIds: number[]): Promise<Map<string, AnswerRating>> {
    if (!messageIds.length) return new Map();
    const rows = await this.ratingRepo.find({
      where: { tenantId, messageId: In(messageIds) },
      order: { updatedAt: 'ASC' },
    });
    // Ascending, so the last write per message wins.
    return new Map(rows.map((r) => [String(r.messageId), r]));
  }

  async summary(tenantId: number, from: Date, to: Date): Promise<RatingSummary> {
    const rows = await this.ratingRepo.find({
      where: { tenantId, createdAt: Between(from, to) },
      select: { id: true, senderType: true, rating: true, reason: true },
    });
    const bySender: Record<string, Record<string, number>> = {};
    const byReason: Record<string, number> = {};
    for (const r of rows) {
      const s = (bySender[r.senderType] ??= { accurate: 0, partial: 0, inaccurate: 0 });
      s[r.rating] = (s[r.rating] ?? 0) + 1;
      if (r.rating !== ANSWER_RATING.ACCURATE) {
        const k = r.reason ?? ANSWER_RATING_REASON.OTHER;
        byReason[k] = (byReason[k] ?? 0) + 1;
      }
    }
    return { from: from.toISOString(), to: to.toISOString(), bySender, byReason, total: rows.length };
  }
}
