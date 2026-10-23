import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ChatService } from './chat.service';
import { ScenarioService } from './scenario.service';
import { ChatMapper } from './chat.mapper';
import { ThreadService } from './thread.service';
import { threadEligible } from '../embed/unsigned-identify';
import {
  SendMessageRequest,
  EndChatRequest,
  ConsultCategoryRequest,
  EscalateRequest,
  ScenarioRequest,
  ContactEmailRequest,
  RateChatRequest,
} from './dto/request/chat.request';
import { SessionService } from '../session/session.service';
import { AttachmentService } from '../attachment/attachment.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { Public } from '../../global/decorator/public.decorator';
import { SessionToken } from '../../global/decorator/session-token.decorator';

/** Widget-facing chat endpoints (public; session-token identified). */
@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly scenarioService: ScenarioService,
    private readonly sessionService: SessionService,
    private readonly attachmentService: AttachmentService,
    private readonly threadService: ThreadService,
  ) {}

  @Post('scenario')
  @Public()
  @ApiOperation({ summary: 'Scenario button/quick-reply → deterministic scripted reply (FR-S1)' })
  async scenario(@Body() body: ScenarioRequest) {
    const session = await this.sessionService.findByToken(body.session_token);
    return this.scenarioService.handle(session, body.action, body.text);
  }

  @Post('message')
  @Public()
  @ApiOperation({ summary: 'Send a message; returns AI reply (S5, SEQ-03)' })
  async message(@Body() body: SendMessageRequest) {
    // Either-or: text, files, or both — but not an empty turn (PLN-260814).
    if (!body.message?.trim() && !body.attachment_ids?.length) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const session = await this.sessionService.findByToken(body.session_token);
    return this.chatService.handleUserMessage(session, body.message, {
      attachmentIds: body.attachment_ids,
    });
  }

  @Post('contact-email')
  @Public()
  @ApiOperation({ summary: 'Save the address for an off-hours email reply (PLN-260806)' })
  async contactEmail(@Body() body: ContactEmailRequest) {
    const session = await this.sessionService.findByToken(body.session_token);
    return this.chatService.saveContactEmail(session, body.email);
  }

  @Post('end')
  @Public()
  @ApiOperation({ summary: 'End the current conversation (customer side, PLN-260808 Track B)' })
  async end(@Body() body: EndChatRequest) {
    const session = await this.sessionService.findByToken(body.session_token);
    return this.chatService.endBySession(session);
  }

  @Post('csat')
  @Public()
  @ApiOperation({ summary: 'Rate a finished conversation, 1..5 stars (PLN-260810)' })
  async rate(@Body() body: RateChatRequest) {
    const session = await this.sessionService.findByToken(body.session_token);
    return this.chatService.rate(session, body.conversation_id, body.rating, {
      resolved: body.resolved,
      reason: body.reason,
      comment: body.comment,
    });
  }

  @Get('conversation')
  @Public()
  @SkipThrottle() // widget polls this every few seconds — must not count against the flood limit
  @ApiOperation({ summary: 'Get conversation messages for a session (delta via ?after_id=)' })
  async conversation(@SessionToken() token: string, @Query('after_id') afterId?: string) {
    const session = await this.sessionService.findByToken(token);
    // Read-only + bounded (PERF-1): the poll never creates conversations and
    // fetches only messages newer than after_id once the widget has history.
    // Latest (not open-only) so an ended thread reports status 'ended' — the
    // widget renders its end-of-conversation notice off that status.
    const conversation = await this.chatService.findLatestConversation(session.id);
    if (!conversation) {
      return { conversationId: null, status: 'none', messages: [] };
    }
    const after = afterId != null && afterId !== '' ? Number(afterId) : undefined;
    const messages = await this.chatService.listMessages(conversation.id, {
      afterId: Number.isFinite(after) ? after : undefined,
    });
    const senderNames = await this.chatService.resolveSenderNames(messages);
    // One query for the whole page — the poll runs every few seconds, so a
    // per-message lookup here would be the widget's most expensive habit.
    const attachments = await this.attachmentService.findByMessageIds(
      messages.map((m) => Number(m.id)),
    );
    return ChatMapper.toConversationResponse(conversation, messages, senderNames, attachments);
  }

  /**
   * Earlier conversations of the signed-in account (PLN-261022 stage 2), newest
   * first, `limit` (1–5) at a time before `before`. Only a host-verified session
   * of a tenant that switched continuity on — a guest, or a tenant without it,
   * gets 403 E5099 (the widget never shows the button then).
   */
  @Get('thread')
  @Public()
  @ApiOperation({ summary: "Earlier conversations of the signed-in user's account" })
  async thread(@SessionToken() token: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    const session = await this.sessionService.findByToken(token);
    if (!threadEligible(session) || !(await this.threadService.enabled(session.tenantId))) {
      throw new BusinessException(ERROR_CODE.THREAD_NOT_AVAILABLE, HttpStatus.FORBIDDEN);
    }
    // Default "before" = the conversation the widget is showing, so the page starts behind it.
    const beforeId =
      before != null && before !== '' && Number.isFinite(Number(before))
        ? Number(before)
        : Number((await this.chatService.findLatestConversation(session.id))?.id ?? 0) || null;
    const size = Math.min(5, Math.max(1, Number(limit) || 3));
    const page = await this.threadService.listForWidget(session, beforeId, size);
    const senderNames = await this.chatService.resolveSenderNames(page.conversations.flatMap((c) => c.messages));
    return ChatMapper.toThreadResponse(page, senderNames);
  }

  @Post('escalate')
  @Public()
  @ApiOperation({ summary: 'Request a human agent (FR-015)' })
  async escalate(@Body() body: EscalateRequest) {
    const session = await this.sessionService.findByToken(body.session_token);
    await this.chatService.escalate(session, body.conversation_id, body.category_code);
    return { escalated: true };
  }

  @Post('consult-category')
  @Public()
  @ApiOperation({ summary: 'Pick a consult category after the handoff (PLN-261024)' })
  async consultCategory(@Body() body: ConsultCategoryRequest) {
    const session = await this.sessionService.findByToken(body.session_token);
    return this.chatService.chooseConsultCategory(session, body.conversation_id, body.category_code);
  }
}
