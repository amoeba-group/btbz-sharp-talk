import { Repository } from 'typeorm';
import { CONSENT_STATE, CONVERSATION_STATUS } from '@sharptalk/types';
import { ChatService } from './chat.service';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { RagService } from './rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { SessionService } from '../session/session.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import { EventBusService } from '../../infrastructure/infrastructure.module';
import { AttachmentService } from '../attachment/attachment.service';
import { MessageAttachment } from '../attachment/entity/message-attachment.entity';

/**
 * A turn that carries a photo and no words (PLN-260814 SI-2).
 *
 * The AI path is the thing being kept OUT: retrieval over an empty string
 * spends a model call to answer nothing, and the intent classifier would label
 * silence. What must still happen is everything that keeps the thread alive —
 * the message is persisted, the journey event fires, and the files are claimed.
 */
describe('ChatService — attachment-only turns', () => {
  function build(opts: { status?: string; agentId?: number | null } = {}) {
    const conversation = {
      id: 77,
      sessionId: 5,
      tenantId: 1,
      status: opts.status ?? CONVERSATION_STATUS.AI_ACTIVE,
      agentId: opts.agentId ?? null,
    } as Conversation;
    const session = {
      id: 5,
      sessionToken: 'tok-5',
      tenantId: 1,
      customerId: null,
      language: 'KO',
      consentState: CONSENT_STATE.GRANTED,
    } as Session;

    let nextId = 100;
    const saved: Message[] = [];
    const msgSave = jest.fn(async (m: Message) => {
      const row = { ...m, id: m.id ?? nextId++ } as Message;
      saved.push(row);
      return row;
    });
    const classifyIntent = jest.fn(async () => ({
      intent: 'product_recommendation',
      needsOrderData: false,
      confidence: 0.9,
    }));
    const ragAnswer = jest.fn(async () => ({ text: 'AI answer', confidence: 0.9, citations: [] }));
    const moderate = jest.fn(async () => ({ decision: 'delivered', text: 'AI answer' }));
    const busPublish = jest.fn();
    const attachToMessage = jest.fn(async (ids: string[]) =>
      ids.map((uuid, i) => ({ id: i + 1, uuid, kind: 'image' }) as MessageAttachment),
    );

    const svc = new ChatService(
      {
        findOne: jest.fn(async () => conversation),
        save: jest.fn(async (c: Conversation) => c),
        create: (c: Partial<Conversation>) => c,
        update: jest.fn(),
        findOneOrFail: jest.fn(async () => conversation),
      } as unknown as Repository<Conversation>,
      {
        save: msgSave,
        create: (m: Partial<Message>) => m,
        update: jest.fn(),
        find: jest.fn(async () => []),
        findOne: jest.fn(async () => null),
      } as unknown as Repository<Message>,
      {
        findOne: jest.fn(async () => session),
        save: jest.fn(async (s: Session) => s),
      } as unknown as Repository<Session>,
      { findOne: jest.fn(async () => ({ id: 1 }) as Tenant) } as unknown as Repository<Tenant>,
      { find: jest.fn(async () => []) } as unknown as Repository<User>,
      { update: jest.fn() } as never,
      {
        classifyIntent,
        answer: ragAnswer,
        effectiveAgentId: jest.fn(async () => null),
        // Guest gate (PLN-261001 v1.1): every agent is open unless a test says otherwise.
        agentGuestPolicy: jest.fn(async () => 'open'),
      } as unknown as RagService,
      { moderate } as unknown as ModerationService,
      { recentForCustomer: jest.fn(async () => []) } as never,
      {
        effectiveConsentFor: jest.fn(async () => CONSENT_STATE.GRANTED),
      } as unknown as SessionService,
      {
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        denyMatch: jest.fn(async () => null),
      } as unknown as HandoffRouterService,
      { publish: busPublish } as unknown as EventBusService,
      undefined as never, // customerService
      undefined as never, // redis
      undefined, // answerReuse
      undefined, // issueService
      undefined, // statRepo
      { attachToMessage } as unknown as AttachmentService,
    );

    return { svc, session, classifyIntent, ragAnswer, moderate, busPublish, attachToMessage, saved };
  }

  it('skips retrieval, intent and moderation when the turn is only a file', async () => {
    const { svc, session, classifyIntent, ragAnswer, moderate } = build();

    const res = await svc.handleUserMessage(session, '', { attachmentIds: ['uuid-a'] });

    expect(classifyIntent).not.toHaveBeenCalled();
    expect(ragAnswer).not.toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled();
    // The shopper still hears something back, in their own language.
    expect(res.reply?.senderType).toBe('system');
    expect(res.reply?.body).toContain('파일');
  });

  it('still persists the turn and reports the journey event', async () => {
    const { svc, session, busPublish, saved } = build();

    await svc.handleUserMessage(session, '', { attachmentIds: ['uuid-a'] });

    expect(saved.some((m) => m.senderType === 'user')).toBe(true);
    expect(busPublish).toHaveBeenCalled();
  });

  it('claims the uploaded files onto the persisted turn', async () => {
    const { svc, session, attachToMessage } = build();

    await svc.handleUserMessage(session, '', { attachmentIds: ['uuid-a', 'uuid-b'] });

    expect(attachToMessage).toHaveBeenCalledWith(
      ['uuid-a', 'uuid-b'],
      expect.objectContaining({ tenantId: 1, conversationId: 77, sessionId: 5 }),
    );
  });

  it('stays silent on a file-only turn once an agent owns the thread', async () => {
    const { svc, session, ragAnswer } = build({
      status: CONVERSATION_STATUS.AGENT,
      agentId: 42,
    });

    const res = await svc.handleUserMessage(session, '', { attachmentIds: ['uuid-a'] });

    expect(res.reply).toBeNull();
    expect(ragAnswer).not.toHaveBeenCalled();
  });

  it('stays silent on a file-only turn while the thread waits in the queue', async () => {
    const { svc, session } = build({ status: CONVERSATION_STATUS.WAITING });

    const res = await svc.handleUserMessage(session, '', { attachmentIds: ['uuid-a'] });

    expect(res.reply).toBeNull();
  });

  it('runs the normal AI path when the file comes with a question', async () => {
    const { svc, session, classifyIntent, attachToMessage } = build();

    await svc.handleUserMessage(session, 'is this the right shade?', {
      attachmentIds: ['uuid-a'],
    });

    expect(classifyIntent).toHaveBeenCalled();
    expect(attachToMessage).toHaveBeenCalled();
  });

  it('does not let a failed claim take the message down with it', async () => {
    const { svc, session, attachToMessage } = build();
    attachToMessage.mockRejectedValueOnce(new Error('disk gone'));

    // Text turn: the reply path must still complete even though the file was lost.
    const res = await svc.handleUserMessage(session, 'here is the photo', {
      attachmentIds: ['uuid-a'],
    });

    expect(res.conversationId).toBe('77');
  });
});
