import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChatComment, COMMENT_SCOPE, CommentScope } from './entity/chat-comment.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { User } from '../user/entity/user.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { displayNameOf } from '../../global/util/user-display.util';

const MAX_BODY_LENGTH = 2000;

/**
 * Internal operator comments on conversations and sessions (REQ-260824 R4).
 * Every read and write goes through the conversation the console is looking
 * at, so tenant ownership is checked once, up front, on that conversation.
 */
@Injectable()
export class ChatCommentService {
  private readonly logger = new Logger(ChatCommentService.name);

  constructor(
    @InjectRepository(ChatComment) private readonly commentRepo: Repository<ChatComment>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  private async conversationOf(conversationId: number, tenantId: number): Promise<Conversation> {
    const conversation = await this.convRepo.findOne({ where: { id: conversationId, tenantId } });
    if (!conversation) {
      this.logger.warn(`comment refused: conversation=${conversationId} tenant=${tenantId}`);
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return conversation;
  }

  /**
   * Both scopes in one list: the thread's own notes plus the session-wide ones
   * that followed the shopper here. Newest first — the card shows the latest
   * context at the top.
   */
  async listFor(
    conversationId: number,
    tenantId: number,
  ): Promise<{ comments: ChatComment[]; authorNames: Map<string, string> }> {
    const conversation = await this.conversationOf(conversationId, tenantId);
    const comments = await this.commentRepo.find({
      where: [
        { tenantId, scope: COMMENT_SCOPE.CONVERSATION, conversationId },
        { tenantId, scope: COMMENT_SCOPE.SESSION, sessionId: Number(conversation.sessionId) },
      ],
      order: { id: 'DESC' },
      take: 200,
    });
    return { comments, authorNames: await this.authorNames(comments) };
  }

  async create(
    conversationId: number,
    tenantId: number,
    authorId: number,
    scope: CommentScope,
    body: string,
  ): Promise<ChatComment> {
    const conversation = await this.conversationOf(conversationId, tenantId);
    const trimmed = body.trim().slice(0, MAX_BODY_LENGTH);
    if (!trimmed) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    return this.commentRepo.save(
      this.commentRepo.create({
        tenantId,
        scope,
        conversationId: scope === COMMENT_SCOPE.CONVERSATION ? conversationId : null,
        sessionId: scope === COMMENT_SCOPE.SESSION ? Number(conversation.sessionId) : null,
        authorId,
        body: trimmed,
      }),
    );
  }

  /** Author-only: another agent's note is theirs to change. */
  async update(id: number, tenantId: number, userId: number, body: string): Promise<ChatComment> {
    const comment = await this.owned(id, tenantId);
    // Number() on BOTH sides: the JWT principal carries userId as a string
    // ("1"), and a strict compare against the bigint-transformed column made
    // every author fail their own ownership check (found in staging smoke).
    if (Number(comment.authorId) !== Number(userId)) {
      this.logger.warn(`comment edit refused: id=${id} author=${comment.authorId} user=${userId}`);
      throw new BusinessException(ERROR_CODE.COMMENT_FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const trimmed = body.trim().slice(0, MAX_BODY_LENGTH);
    if (!trimmed) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    comment.body = trimmed;
    return this.commentRepo.save(comment);
  }

  /** Author or master — a master can clean up after an agent who left. */
  async remove(id: number, tenantId: number, userId: number, isMaster: boolean): Promise<void> {
    const comment = await this.owned(id, tenantId);
    if (Number(comment.authorId) !== Number(userId) && !isMaster) {
      this.logger.warn(`comment delete refused: id=${id} author=${comment.authorId} user=${userId}`);
      throw new BusinessException(ERROR_CODE.COMMENT_FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    await this.commentRepo.delete({ id: comment.id });
  }

  private async owned(id: number, tenantId: number): Promise<ChatComment> {
    const comment = await this.commentRepo.findOne({ where: { id, tenantId } });
    if (!comment) {
      this.logger.warn(`comment not found: id=${id} tenant=${tenantId}`);
      throw new BusinessException(ERROR_CODE.COMMENT_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return comment;
  }

  async authorNames(comments: ChatComment[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const ids = [...new Set(comments.map((c) => Number(c.authorId)))];
    if (!ids.length) return map;
    const users = await this.userRepo.find({ where: { id: In(ids) } });
    // Staff-facing: a user with no name set reads as their e-mail words, not "Unknown" (w3c).
    for (const u of users) {
      const name = displayNameOf(u);
      if (name) map.set(String(u.id), name);
    }
    return map;
  }
}
