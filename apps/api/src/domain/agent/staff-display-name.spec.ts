import { SENDER_TYPE } from '@sharptalk/types';
import { AgentService } from './agent.service';
import { ChatCommentService } from './chat-comment.service';
import { ChatService } from '../chat/chat.service';

/**
 * Where a staff member's name comes from (w3c, ops-manual finding 13).
 *
 * `users.name` used to be unsettable, so every staff-facing surface printed "Unknown" / "user #N".
 * Console surfaces now fall back to the e-mail words; the customer's widget must NOT: an agent
 * name a customer reads is either one the tenant chose to give, or nothing - never an address.
 */
describe('staff display names', () => {
  const named = { id: 1, name: 'Phạm Thu Lan', email: 'lan.pham@go2joy.example' };
  const unnamed = { id: 2, name: null, email: 'minh.tran@go2joy.example' };

  it('console: comment authors fall back to the e-mail words instead of "Unknown"', async () => {
    const svc = new ChatCommentService({} as never, {} as never, { find: jest.fn(async () => [named, unnamed]) } as never);
    const names = await svc.authorNames([{ authorId: 1 }, { authorId: 2 }] as never);
    expect(names.get('1')).toBe('Phạm Thu Lan');
    expect(names.get('2')).toBe('Minh Tran');
  });

  it('console: the assignee and the agent thread names use the same rule', async () => {
    const svc = Object.create(AgentService.prototype) as AgentService;
    Object.assign(svc, { userRepo: { findOne: jest.fn(async () => unnamed), find: jest.fn(async () => [named, unnamed]) } });
    expect(await svc.agentName(2)).toBe('Minh Tran');

    const names = await svc.resolveSenderNames([
      { senderType: SENDER_TYPE.AGENT, senderId: 1 },
      { senderType: SENDER_TYPE.AGENT, senderId: 2 },
      { senderType: SENDER_TYPE.USER, senderId: null },
    ] as never);
    expect(names.get('1')).toBe('Phạm Thu Lan');
    expect(names.get('2')).toBe('Minh Tran');
  });

  it('customer widget: an unnamed agent stays nameless, the e-mail words never reach the customer', async () => {
    const svc = Object.create(ChatService.prototype) as ChatService;
    Object.assign(svc, { userRepo: { find: jest.fn(async () => [named, unnamed]) } });
    const names = await svc.resolveSenderNames([
      { senderType: SENDER_TYPE.AGENT, senderId: 1 },
      { senderType: SENDER_TYPE.AGENT, senderId: 2 },
    ] as never);
    expect(names.get('1')).toBe('Phạm Thu Lan'); // a name the tenant chose to give is shown
    expect(names.has('2')).toBe(false); // none given: nothing shown, and nothing derived from the address
    expect(JSON.stringify([...names])).not.toContain('Minh');
  });
});
