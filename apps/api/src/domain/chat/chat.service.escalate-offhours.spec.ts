import { ChatService, sysMsg } from './chat.service';
import type { Conversation } from './entity/conversation.entity';
import type { Session } from '../session/entity/session.entity';

/**
 * Off-hours parity of the "talk to an agent" button with the automatic hand-off
 * (PLN-261012 SG-62, REQ D-08). `handoff()` already marked the thread to be
 * answered by email and asked for an address; `escalate()` only stored the notice,
 * so an agent's reply went into a widget nobody was looking at and the idle sweep
 * eventually closed the thread.
 */
describe('ChatService.escalate — off hours', () => {
  type Route = { mode: 'agents' | 'email'; targetUserIds: number[]; email?: string; notice?: string };

  const OFF_HOURS: Route = {
    mode: 'email',
    targetUserIds: [],
    email: 'cs@example.com',
    notice: 'We are closed. We will reply by email.',
  };
  const IN_HOURS: Route = { mode: 'agents', targetUserIds: [9] };

  function build(opts: { route: Route; contactEmail?: string | null; customerId?: number | null; team?: boolean }) {
    const conversation = { id: 77, sessionId: 5, tenantId: 1 } as Conversation;
    const convUpdate = jest.fn();
    const publish = jest.fn();
    const savedMessages: Array<Record<string, unknown>> = [];
    const contactEmail = jest.fn(async () => opts.contactEmail ?? null);
    const svc = new ChatService(
      { findOne: jest.fn(async () => conversation), update: convUpdate } as never,
      {
        create: jest.fn((m: Record<string, unknown>) => m),
        save: jest.fn(async (m: Record<string, unknown>) => {
          savedMessages.push(m);
          return m;
        }),
        findOne: jest.fn(async () => ({ body: 'Where is my order?' })),
      } as never,
      {} as never, // Session repo
      {} as never, // Tenant repo
      {} as never, // User repo
      {} as never, // Assignment repo
      {} as never, // RagService
      {} as never, // ModerationService
      {} as never, // OrderService
      {} as never, // SessionService
      {
        teamQuestion: jest.fn(async () =>
          opts.team
            ? { prompt: 'Which team?', options: [{ id: 'cs', jobLabel: 'consult', label: 'Customer Service' }] }
            : null,
        ),
        route: jest.fn(async () => opts.route),
        regionLookup: jest.fn(async () => ({ region: null })),
      } as never, // HandoffRouterService
      { publish } as never, // EventBusService
      { contactEmail } as never, // CustomerService
      {} as never, // RedisService
    );
    const session = {
      id: 5,
      tenantId: 1,
      language: 'EN',
      channel: 'widget',
      customerId: opts.customerId === undefined ? null : opts.customerId,
      identityClaims: null,
    } as unknown as Session;
    return { svc, session, convUpdate, publish, savedMessages, contactEmail };
  }

  const replyChannelSet = (convUpdate: jest.Mock) =>
    convUpdate.mock.calls.some(([, set]) => set && (set as Record<string, unknown>).replyChannel === 'email');

  describe('no address on file', () => {
    it('marks the thread to be answered by email, asks for the address and says so', async () => {
      const h = build({ route: OFF_HOURS });

      const out = await h.svc.escalate(h.session, 77);

      expect(out).toMatchObject({ escalated: true, choose: false, needsContactEmail: true });
      // The notice asks for the address — not the "we will reply by email" promise.
      expect(out.body).toBe(sysMsg('offHoursNeedEmail', 'EN'));
      expect(h.savedMessages.some((m) => m.body === sysMsg('offHoursNeedEmail', 'EN'))).toBe(true);
      expect(h.convUpdate).toHaveBeenCalledWith({ id: 77 }, { replyChannel: 'email' });
    });

    it('still queues the thread and mails the off-hours summary, as before', async () => {
      const h = build({ route: OFF_HOURS });

      await h.svc.escalate(h.session, 77);

      expect(h.publish).toHaveBeenCalledTimes(1);
      expect(h.publish.mock.calls[0][1]).toMatchObject({
        conversationId: 77,
        reason: 'user_request',
        offHoursEmail: 'cs@example.com',
      });
      expect(h.convUpdate.mock.calls.some(([, set]) => (set as Record<string, unknown>).status === 'waiting')).toBe(true);
    });

    it('treats a customer with no stored address like no customer at all', async () => {
      const h = build({ route: OFF_HOURS, customerId: 12, contactEmail: null });

      const out = await h.svc.escalate(h.session, 77);

      expect(h.contactEmail).toHaveBeenCalledWith(1, 12);
      expect(out.needsContactEmail).toBe(true);
    });
  });

  describe('address already on file', () => {
    it('shows the tenant off-hours notice, marks email reply, and does not ask again', async () => {
      const h = build({ route: OFF_HOURS, customerId: 12, contactEmail: 'guest@example.com' });

      const out = await h.svc.escalate(h.session, 77);

      expect(out).toEqual({ escalated: true, choose: false, body: OFF_HOURS.notice });
      expect(h.convUpdate).toHaveBeenCalledWith({ id: 77 }, { replyChannel: 'email' });
    });

    it('falls back to the connecting line when the tenant set no notice', async () => {
      const h = build({
        route: { ...OFF_HOURS, notice: undefined },
        customerId: 12,
        contactEmail: 'guest@example.com',
      });

      const out = await h.svc.escalate(h.session, 77);

      expect(out.body).toBe(sysMsg('connectingAgent', 'EN'));
      expect(replyChannelSet(h.convUpdate)).toBe(true);
    });
  });

  describe('in business hours — unchanged', () => {
    it('does not mark email reply, ask for an address, or look one up', async () => {
      const h = build({ route: IN_HOURS });

      const out = await h.svc.escalate(h.session, 77);

      // Exactly the response it always was: the flag is absent, not false.
      expect(out).toEqual({ escalated: true, choose: false, body: sysMsg('connectingAgent', 'EN') });
      expect(replyChannelSet(h.convUpdate)).toBe(false);
      expect(h.contactEmail).not.toHaveBeenCalled();
      expect((h.publish.mock.calls[0][1] as Record<string, unknown>).offHoursEmail).toBeUndefined();
    });
  });

  describe('team question', () => {
    it('asking the team question is neither an escalation nor an email-reply thread', async () => {
      const h = build({ route: OFF_HOURS, team: true });

      const out = await h.svc.escalate(h.session, 77);

      expect(out).toMatchObject({ escalated: false, choose: true });
      expect(out.needsContactEmail).toBeUndefined();
      expect(replyChannelSet(h.convUpdate)).toBe(false);
      expect(h.publish).not.toHaveBeenCalled();
    });

    it('the second call (team chosen) off hours behaves like the plain path', async () => {
      const h = build({ route: OFF_HOURS, team: true });

      const out = await h.svc.escalate(h.session, 77, 'cs');

      expect(out).toMatchObject({ escalated: true, choose: false, needsContactEmail: true });
      expect(replyChannelSet(h.convUpdate)).toBe(true);
      expect(h.publish.mock.calls[0][1]).toMatchObject({ issueLabel: 'consult', supportType: 'cs' });
    });
  });

  it('preview sandbox neither marks email reply nor pages anyone', async () => {
    const h = build({ route: OFF_HOURS });
    const preview = { ...h.session, channel: 'preview' } as unknown as Session;

    const out = await h.svc.escalate(preview, 77);

    expect(out).toEqual({ escalated: true, choose: false, body: null });
    expect(replyChannelSet(h.convUpdate)).toBe(false);
    expect(h.publish).not.toHaveBeenCalled();
  });

  describe('same decisions as the automatic hand-off', () => {
    it.each([
      ['off hours, no address', OFF_HOURS, null, null],
      ['off hours, address on file', OFF_HOURS, 12, 'guest@example.com'],
      ['in hours', IN_HOURS, null, null],
    ] as const)('%s', async (_name, route, customerId, contactEmail) => {
      const viaEscalate = build({ route, customerId, contactEmail });
      const viaHandoff = build({ route, customerId, contactEmail });

      const e = await viaEscalate.svc.escalate(viaEscalate.session, 77);
      const h = await viaHandoff.svc.handoff(77, viaHandoff.session, 1, 'user_request', 'Where is my order?');

      expect(e.needsContactEmail === true).toBe(h.needsContactEmail);
      expect(e.body).toBe(h.body);
      expect(replyChannelSet(viaEscalate.convUpdate)).toBe(replyChannelSet(viaHandoff.convUpdate));
      expect((viaEscalate.publish.mock.calls[0][1] as Record<string, unknown>).offHoursEmail).toBe(
        (viaHandoff.publish.mock.calls[0][1] as Record<string, unknown>).offHoursEmail,
      );
    });
  });
});
