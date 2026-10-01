import { Repository } from 'typeorm';
import { ScenarioService } from './scenario.service';
import { ChatService } from './chat.service';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { ModerationService } from '../moderation/moderation.service';
import { SessionService } from '../session/session.service';
import type { AiConfigService } from '../ai-engine/ai-config.service';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * Buttons whose action has no script (PLN-261001 §1).
 *
 * The console offers "Send a message" (`message`) as a button action, but that
 * action has no script — so this endpoint answered every press with a 404 and
 * the operator saw "Resource not found". The server now answers it as a chat
 * turn, which rescues the console preview, older widget builds and SDK hosts in
 * one place; the widget's own branching is unchanged.
 */
describe('ScenarioService — actions without a script', () => {
  let handleUserMessage: jest.Mock;
  let warn: jest.SpyInstance;
  let svc: ScenarioService;

  const session = { id: 9, tenantId: 1, language: 'KO' } as Session;

  beforeEach(() => {
    handleUserMessage = jest.fn(async () => ({
      conversationId: '42',
      reply: { senderType: 'ai', body: '체크인은 15시부터입니다.' },
    }));
    svc = new ScenarioService(
      { save: jest.fn(async (m: Message) => m), create: (m: Partial<Message>) => m } as unknown as Repository<Message>,
      { handleUserMessage } as unknown as ChatService,
      {} as unknown as ModerationService,
      {} as unknown as SessionService,
      { getScenarioOverride: jest.fn().mockResolvedValue(null) } as unknown as AiConfigService,
    );
    warn = jest.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('answers a `message` button as a chat turn instead of 404ing', async () => {
    const res = await svc.handle(session, 'message', '체크인은 어떻게 하나요?');

    expect(handleUserMessage).toHaveBeenCalledWith(session, '체크인은 어떻게 하나요?');
    expect(res).toMatchObject({
      conversationId: '42',
      reply: { senderType: 'ai', body: '체크인은 15시부터입니다.' },
      followUps: [],
    });
  });

  it('does not warn for `message` — it is the configured, expected case', async () => {
    await svc.handle(session, 'message', '체크인 방법');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns for any OTHER unknown action — a 4xx alone leaves us no trace', async () => {
    await svc.handle(session, 'typo_action', '뭐든');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('typo_action'));
  });

  it('still 404s when there is nothing to ask', async () => {
    // No script AND no text: there is no question to put in the shopper's mouth.
    await expect(svc.handle(session, 'message', '   ')).rejects.toThrow(BusinessException);
    await expect(svc.handle(session, 'message')).rejects.toThrow(BusinessException);
    expect(handleUserMessage).not.toHaveBeenCalled();
  });

  it('carries an agent-mode turn as an empty body rather than widening the contract', async () => {
    // `reply` is null while a human is answering. Clients read `res.reply.body`
    // without a null check, so the empty string is what travels; they skip
    // rendering it.
    handleUserMessage.mockResolvedValueOnce({ conversationId: '42', reply: null });

    const res = await svc.handle(session, 'message', '안녕하세요');

    expect(res.reply.body).toBe('');
    expect(res.conversationId).toBe('42');
  });

  it('leaves scripted actions on the script path', async () => {
    // `delivery_status` maps to the shipping_policy script — it must not fall
    // through to the chat path just because text came along for the ride.
    await expect(svc.handle(session, 'delivery_status', '배송 조회')).rejects.toBeDefined();
    expect(handleUserMessage).not.toHaveBeenCalled();
  });
});
