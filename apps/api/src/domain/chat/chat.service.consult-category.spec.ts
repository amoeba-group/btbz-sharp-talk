import { ChatService } from './chat.service';
import { Session } from '../session/entity/session.entity';

/**
 * Consult categories in the chat pipeline (PLN-261024-Widget-Handoff-Consult-Category-Picker):
 * a pick on the way in routes the escalation; a pick after the handoff is
 * recorded and re-routes once while nobody has accepted; only categories the
 * tenant offers count.
 */
describe('ChatService — consult category', () => {
  const offered = { code: 'payment', name: '결제', names: { vi: 'Thanh toán' } };
  function build(conv: Record<string, unknown>, opts: { sticky?: number | null } = {}) {
    const conversation = { id: 30, sessionId: 5, tenantId: 4, status: 'waiting', agentId: null, consultCategory: null, prevConversationId: 20, ...conv };
    const convUpdate = jest.fn(async (_w: unknown, patch: Record<string, unknown>) => Object.assign(conversation, patch));
    const msgSave = jest.fn(async (x: object) => x);
    const route = jest.fn(async () => ({ mode: 'agents', targetUserIds: [11, 12], assignMode: 'least_loaded', ruleName: 'pay-north' }));
    const publish = jest.fn();
    const threads = { stickyAgent: jest.fn(async () => opts.sticky ?? null) };
    const categories = {
      visibleRow: jest.fn(async (_t: number, code: unknown) => (String(code).toLowerCase() === 'payment' ? offered : null)),
    };
    const svc = new ChatService(
      { findOne: jest.fn(async () => conversation), update: convUpdate } as never,
      { findOne: jest.fn(async () => ({ body: 'hoàn tiền' })), create: (x: object) => x, save: msgSave } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { route, needsCustomerTier: jest.fn(async () => false) } as never,
      { publish } as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      threads as never,
      undefined,
      categories as never,
    );
    return { svc, conversation, convUpdate, msgSave, route, publish, threads };
  }
  const session = { id: 5, tenantId: 4, language: 'VI', identityAttributes: { region: 'north' } } as unknown as Session;

  it('A path: an offered pick is stored, announced in the session language, routed on, and skips the sticky agent', async () => {
    const { svc, convUpdate, msgSave, route, publish, threads } = build({ status: 'ai_active' }, { sticky: 77 });
    await svc.escalate(session, 30, 'Payment');
    expect(convUpdate).toHaveBeenCalledWith({ id: 30 }, expect.objectContaining({ consultCategory: 'payment' }));
    expect(msgSave).toHaveBeenCalledWith(expect.objectContaining({ senderType: 'system', body: expect.stringContaining('Thanh toán') }));
    expect(route.mock.calls[0][2]).toMatchObject({ consultCategory: 'payment', region: 'north' });
    expect(threads.stickyAgent).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'user_request', targetUserIds: [11, 12], consultCategory: 'payment' }));
  });

  it('A path: a hidden or unknown code is ignored — routed as if nothing was picked (sticky agent still preferred)', async () => {
    const { svc, convUpdate, route, publish } = build({ status: 'ai_active' }, { sticky: 11 });
    await svc.escalate(session, 30, 'internal');
    expect(convUpdate).not.toHaveBeenCalledWith({ id: 30 }, expect.objectContaining({ consultCategory: expect.anything() }));
    expect(route.mock.calls[0][2]).toMatchObject({ consultCategory: null });
    expect(publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetUserIds: [11] }));
  });

  it('B path: the first pick on a waiting, unaccepted conversation re-routes once', async () => {
    const { svc, publish } = build({});
    await expect(svc.chooseConsultCategory(session, 30, 'payment')).resolves.toEqual({ rerouted: true, label: 'Thanh toán' });
    expect(publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'category_selected', consultCategory: 'payment' }));
    // A second pick is recorded only.
    await expect(svc.chooseConsultCategory(session, 30, 'payment')).resolves.toMatchObject({ rerouted: false });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('B path: an accepted conversation is recorded only', async () => {
    const { svc, publish, convUpdate } = build({ status: 'agent', agentId: 11 });
    await expect(svc.chooseConsultCategory(session, 30, 'payment')).resolves.toMatchObject({ rerouted: false });
    expect(convUpdate).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('B path: a category the tenant does not offer is E5109; another session\'s conversation is 404', async () => {
    const { svc } = build({});
    await expect(svc.chooseConsultCategory(session, 30, 'internal')).rejects.toMatchObject({ errorCode: 'E5109' });
    const other = { ...session, id: 6 } as unknown as Session;
    await expect(svc.chooseConsultCategory(other, 30, 'payment')).rejects.toMatchObject({ errorCode: 'E5002' });
  });
});
