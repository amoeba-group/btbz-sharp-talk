import { CONVERSATION_STATUS } from '@sharptalk/types';
import { AgentService } from './agent.service';
import { AgentAlertService } from './agent-alert.service';
import { fakeRepo } from './testing/fake-table';
import type { Row } from './testing/fake-table';

/**
 * Alert lifecycle around a conversation (PLN-261012 SG-63/SG-64, REQ D-20): an alert closes when
 * someone takes the conversation, when it ends or goes back to the AI; and a hand-back clears the
 * team / region / waiting clock of the escalation that is over, so the badges are not stale and
 * the next escalation is not mistaken for a continuation (and swallowed by the alert de-dupe).
 */
describe('AgentService — alerts and escalation state across a conversation life', () => {
  function build(conversation: Row) {
    const convs = fakeRepo<Row>([{ id: 42, tenantId: 1, sessionId: 9, ...conversation }]);
    const alerts = fakeRepo<Row>([
      { id: 1, tenantId: 1, conversationId: 42, reason: 'user_request', status: 'new', targetUserId: 11, targetRegion: null },
      { id: 2, tenantId: 1, conversationId: 43, reason: 'user_request', status: 'new', targetUserId: null, targetRegion: null },
    ]);
    const alertService = new AgentAlertService(
      alerts as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { subscribe: jest.fn() } as never,
      { get: jest.fn(() => undefined) } as never,
      { send: jest.fn() } as never,
    );
    const assignments = {
      update: jest.fn(async () => ({ affected: 1 })),
      save: jest.fn(async (a: unknown) => a),
      create: jest.fn((a: unknown) => a),
      count: jest.fn(async () => 0),
    };
    const svc = new AgentService(
      {
        findOne: convs.findOne,
        findOneOrFail: jest.fn(async () => convs.table[0]),
        update: jest.fn(async (where: Record<string, unknown>, patch: Row) => {
          Object.assign(convs.table[0], patch);
          return { affected: 1 };
        }),
        save: jest.fn(async (c: Row) => Object.assign(convs.table[0], c)),
      } as never,
      { create: (m: unknown) => m, save: jest.fn(async (m: unknown) => m) } as never,
      { findOne: jest.fn(async () => ({ id: 7, tenantId: 1, status: 'active' })) } as never, // userRepo
      { findOne: jest.fn(async () => ({ id: 9, language: 'EN' })) } as never, // sessionRepo
      { findOne: jest.fn(async () => null) } as never, // profileRepo
      assignments as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { write: jest.fn(async () => undefined) } as never, // audit
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      { findOne: jest.fn(async () => null) } as never, // aiConfigRepo
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      alertService,
    );
    return { svc, convs, alerts, assignments };
  }

  const status = (h: { alerts: { table: Row[] } }, id: number) => h.alerts.table.find((a) => a.id === id);

  describe('hand-back to the AI', () => {
    it('clears the team, region, unmapped hint and waiting clock of the escalation that is over', async () => {
      const h = build({
        status: CONVERSATION_STATUS.AGENT,
        agentId: 7,
        supportType: 'business',
        supportRegion: 'north',
        supportRegionHint: null,
        escalatedAt: new Date(),
        unclaimedPages: 2,
        unclaimedPagedAt: new Date(),
      });
      await h.svc.handBack(42, 1, 7);

      expect(h.convs.table[0]).toMatchObject({
        status: CONVERSATION_STATUS.AI_ACTIVE,
        agentId: null,
        supportType: null,
        supportRegion: null,
        supportRegionHint: null,
        escalatedAt: null,
        unclaimedPages: 0,
        unclaimedPagedAt: null,
      });
    });

    it('clears the "?" hint too, so an unmapped province does not outlive the escalation', async () => {
      const h = build({ status: CONVERSATION_STATUS.AGENT, agentId: 7, supportRegion: null, supportRegionHint: 'Tp Quy Nhơn' });
      await h.svc.handBack(42, 1, 7);
      expect(h.convs.table[0].supportRegionHint).toBeNull();
    });

    it('closes the conversation open alerts, so the next escalation is not swallowed by the de-dupe', async () => {
      const h = build({ status: CONVERSATION_STATUS.AGENT, agentId: 7 });
      await h.svc.handBack(42, 1, 7);
      expect(status(h, 1)?.status).toBe('superseded');
      expect(status(h, 2)?.status).toBe('new'); // another conversation
    });

    it('a refused hand-back (not with an agent) changes nothing', async () => {
      const h = build({ status: CONVERSATION_STATUS.WAITING, agentId: null, supportType: 'business', escalatedAt: new Date() });
      await expect(h.svc.handBack(42, 1, 7)).rejects.toBeDefined();
      expect(h.convs.table[0]).toMatchObject({ supportType: 'business' });
      expect(status(h, 1)?.status).toBe('new');
    });
  });

  it('accepting a conversation answers its open alerts as that agent (a colleague is not alarmed about it)', async () => {
    const h = build({ status: CONVERSATION_STATUS.WAITING, agentId: null });
    await h.svc.accept(42, 7, 1);
    expect(status(h, 1)).toMatchObject({ status: 'acked', ackedBy: 7 });
    expect(status(h, 2)?.status).toBe('new');
  });

  it('assigning a conversation answers its open alerts as the assigner', async () => {
    const h = build({ status: CONVERSATION_STATUS.WAITING, agentId: null });
    await h.svc.assignConversation(42, 1, 3, 7);
    expect(status(h, 1)).toMatchObject({ status: 'acked', ackedBy: 3 });
  });

  it('ending a conversation closes its open alerts', async () => {
    const h = build({ status: CONVERSATION_STATUS.WAITING, agentId: null });
    await h.svc.end(42, 1);
    expect(status(h, 1)?.status).toBe('superseded');
  });

  it('end-to-end: escalate, accept, hand back, escalate again — the second escalation pages (REQ D-20)', async () => {
    const h = build({ status: CONVERSATION_STATUS.WAITING, agentId: null });
    const alertService = (h.svc as unknown as { alertService: AgentAlertService }).alertService;
    // The first escalation's alert (id 1) is open. An agent accepts, then hands back.
    await h.svc.accept(42, 7, 1);
    await h.svc.handBack(42, 1, 7);
    // The customer asks for a person again: same conversation, same reason.
    await alertService.onEscalation({ tenantId: 1, conversationId: 42, reason: 'user_request' });
    const open = h.alerts.table.filter((a) => a.conversationId === 42 && a.status === 'new');
    expect(open).toHaveLength(1);
    expect(open[0].id).not.toBe(1);
  });
});
