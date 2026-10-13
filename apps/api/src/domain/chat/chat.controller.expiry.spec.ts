import { ChatController } from './chat.controller';
import { ScenarioService } from './scenario.service';
import { ChatService } from './chat.service';
import { SessionService } from '../session/session.service';
import { AttachmentService } from '../attachment/attachment.service';
import { effectiveIdentity } from '../session/identity.util';

/**
 * The non-error expiry flag on the widget's chat endpoints (PLN-261012 SG-03).
 *
 * `identityExpired: true` rides on the chat turn, the scenario turn and the 5 s poll
 * ONLY when the session's signed claims lapsed — so an older widget ignores it, and
 * every tenant that never sends claims gets the exact response it always had.
 */
const HOUR = 3_600_000;
const claims = (ageMs: number) => ({
  hotelSn: '1721',
  role: 'receptionist',
  signed: true,
  verifiedAt: new Date(Date.now() - ageMs).toISOString(),
});

function build(session: Record<string, unknown>) {
  const sessionService = {
    findByToken: jest.fn(async () => session),
    identityOf: jest.fn(async (s: never) => effectiveIdentity(s)),
  };
  const chatService = {
    handleUserMessage: jest.fn(async () => ({ conversationId: '77', reply: null, escalate: false, needsAuth: false })),
    findLatestConversation: jest.fn(async () => null as unknown),
    listMessages: jest.fn(async () => []),
    resolveSenderNames: jest.fn(async () => new Map()),
  };
  const scenarioService = {
    handle: jest.fn(async () => ({ conversationId: '77', reply: { senderType: 'ai', body: 'hi' }, followUps: [] })),
  };
  const attachments = { findByMessageIds: jest.fn(async () => new Map()) };
  const controller = new ChatController(
    chatService as unknown as ChatService,
    scenarioService as unknown as ScenarioService,
    sessionService as unknown as SessionService,
    attachments as unknown as AttachmentService,
  );
  return { controller, chatService };
}

const lapsedSession = { id: 5, identityLevel: 'verified', customerId: 4, identityClaims: claims(9 * HOUR) };
const freshSession = { id: 5, identityLevel: 'verified', customerId: 4, identityClaims: claims(HOUR) };
const guestSession = { id: 5, identityLevel: 'guest', customerId: null, identityClaims: null };

describe('ChatController — identityExpired flag', () => {
  it('POST /chat/message carries it for lapsed claims', async () => {
    const { controller } = build(lapsedSession);

    const res = await controller.message({ session_token: 't', message: 'hello' } as never);

    expect(res).toMatchObject({ conversationId: '77', identityExpired: true });
  });

  it('POST /chat/scenario carries it for lapsed claims', async () => {
    const { controller } = build(lapsedSession);

    const res = await controller.scenario({ session_token: 't', action: 'faq' } as never);

    expect(res).toMatchObject({ identityExpired: true });
  });

  it('GET /chat/conversation carries it — also when there is no conversation yet', async () => {
    const { controller, chatService } = build(lapsedSession);

    const empty = await controller.conversation('t');
    expect(empty).toEqual({ conversationId: null, status: 'none', messages: [], identityExpired: true });

    chatService.findLatestConversation.mockResolvedValue({ id: 77, status: 'ai_active', sessionId: 5, createdAt: new Date() });
    const withThread = await controller.conversation('t');
    expect(withThread).toMatchObject({ conversationId: '77', identityExpired: true });
  });

  it('claims in force, a guest and a platform login get NO new key — the response is what it always was', async () => {
    for (const s of [freshSession, guestSession, { id: 5, identityLevel: 'verified', customerId: 9, identityClaims: null }]) {
      const { controller } = build(s);

      const msg = await controller.message({ session_token: 't', message: 'hello' } as never);
      const scen = await controller.scenario({ session_token: 't', action: 'faq' } as never);
      const poll = await controller.conversation('t');

      expect(msg).not.toHaveProperty('identityExpired');
      expect(scen).not.toHaveProperty('identityExpired');
      expect(poll).not.toHaveProperty('identityExpired');
    }
    const { controller } = build(guestSession);
    expect(await controller.conversation('t')).toEqual({ conversationId: null, status: 'none', messages: [] });
  });

  it('the turn itself is untouched: the flag is merged in, nothing is dropped', async () => {
    const { controller, chatService } = build(lapsedSession);
    chatService.handleUserMessage.mockResolvedValue({
      conversationId: '77',
      reply: { senderType: 'system', body: 'sign in' },
      escalate: false,
      needsAuth: true,
      authReason: 'login',
    } as never);

    const res = await controller.message({ session_token: 't', message: 'hello' } as never);

    expect(res).toEqual({
      conversationId: '77',
      reply: { senderType: 'system', body: 'sign in' },
      escalate: false,
      needsAuth: true,
      authReason: 'login',
      identityExpired: true,
    });
  });
});
