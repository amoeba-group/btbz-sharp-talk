import { AgentService } from './agent.service';
import { AgentConsoleController } from './agent-console.controller';
import { toAlertResponse, toSessionResponse } from './agent.mapper';
import type { AgentAlert } from './entity/agent-alert.entity';
import type { Conversation } from '../chat/entity/conversation.entity';

/**
 * Queue filters, the "my region" default and the new fields on the queue row and the alert
 * (PLN-261012 SG-65/SG-66): the list can be narrowed to the threads whose province the region table
 * does not list, "mine" resolves to the CALLER's users.region server-side, and both the row and the
 * alarm carry what the console shows (age, "?" hint, team, region, partner).
 */
describe('listSessions — unlisted-province filter (SG-65)', () => {
  function build() {
    const wheres: Array<{ clause: string; params?: Record<string, unknown> }> = [];
    const qb: Record<string, unknown> = {
      where: jest.fn(() => qb),
      andWhere: jest.fn((clause: string, params?: Record<string, unknown>) => {
        wheres.push({ clause, params });
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[], 0]),
    };
    const svc = new AgentService(
      { createQueryBuilder: () => qb } as never,
      { createQueryBuilder: () => ({ select: () => ({ where: () => ({ getMany: async () => [] }) }) }) } as never,
      {} as never,
      { find: jest.fn(async () => []) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { contactsByIds: jest.fn(async () => new Map()) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, wheres };
  }
  const list = (svc: AgentService, region?: string) =>
    svc.listSessions(1, 1, 50, undefined, 'queue', 'all', undefined, undefined, undefined, region);

  it("'unmapped' selects the threads with a province hint and no team", async () => {
    const { svc, wheres } = build();
    await list(svc, 'unmapped');
    expect(wheres.some((w) => w.clause === 'c.support_region IS NULL AND c.support_region_hint IS NOT NULL')).toBe(true);
  });

  it("'none' still means every un-regioned thread, hinted or not", async () => {
    const { svc, wheres } = build();
    await list(svc, 'none');
    expect(wheres.some((w) => w.clause === 'c.support_region IS NULL')).toBe(true);
    expect(wheres.some((w) => w.clause.includes('support_region_hint'))).toBe(false);
  });
});

describe('GET /agent/sessions — "mine" resolves to the caller region (SG-66)', () => {
  function build(region: string | null) {
    const listSessions = jest.fn(async () => ({ items: [], total: 0 }));
    const userRegion = jest.fn(async () => region);
    const controller = new AgentConsoleController(
      { listSessions } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { userRegion } as never,
    );
    return { controller, listSessions, userRegion };
  }
  const user = { actorType: 'user', tenantId: 1, userId: 7 } as never;
  const regionArg = (listSessions: jest.Mock) => listSessions.mock.calls[0][9];

  it('passes the caller own region, read from the server — never a value the client names', async () => {
    const h = build('south');
    await h.controller.sessions(user, { status: 'queue', support_region: 'mine' } as never);
    expect(h.userRegion).toHaveBeenCalledWith(1, 7);
    expect(regionArg(h.listSessions)).toBe('south');
  });

  it('means everything for nationwide staff, who have no region of their own', async () => {
    const h = build(null);
    await h.controller.sessions(user, { status: 'queue', support_region: 'mine' } as never);
    expect(regionArg(h.listSessions)).toBe('all');
  });

  it('leaves every other value alone and does not look the user up', async () => {
    for (const value of ['north', 'none', 'unmapped', 'all', undefined]) {
      const h = build('south');
      await h.controller.sessions(user, { status: 'queue', support_region: value } as never);
      expect(regionArg(h.listSessions)).toBe(value);
      expect(h.userRegion).not.toHaveBeenCalled();
    }
  });
});

describe('queue row and alert carry the routing fields (SG-65/SG-66)', () => {
  const escalatedAt = new Date('2026-10-15T09:00:00Z');

  it('the queue row has the "?" province hint and the start of the waiting spell', () => {
    const row = toSessionResponse(
      { id: 1, sessionId: 2, status: 'waiting', supportRegion: null, supportRegionHint: 'Tp Quy Nhơn', escalatedAt } as unknown as Conversation,
      null,
    );
    expect(row.supportRegionHint).toBe('Tp Quy Nhơn');
    expect(row.escalatedAt).toBe(escalatedAt);
    expect(row.supportRegion).toBeNull();
  });

  it('absent values read as null, not undefined (the JSON the console receives)', () => {
    const row = toSessionResponse({ id: 1, sessionId: 2 } as Conversation, null);
    expect(row.supportRegionHint).toBeNull();
    expect(row.escalatedAt).toBeNull();
  });

  it('an alert with its conversation view carries team, region, hint, age, partner and region scope', () => {
    const alert = { id: 5, conversationId: 42, reason: 'unclaimed', status: 'new', targetRegion: 'south' } as unknown as AgentAlert;
    const out = toAlertResponse(alert, {
      supportType: 'business',
      supportRegion: 'south',
      supportRegionHint: null,
      escalatedAt,
      conversationStatus: 'waiting',
      partner: { hotelName: 'Sao Mai', hotelSn: '1721', role: 'manager' },
    });
    expect(out).toMatchObject({
      reason: 'unclaimed',
      targetRegion: 'south',
      supportType: 'business',
      supportRegion: 'south',
      escalatedAt,
      partner: { hotelName: 'Sao Mai', hotelSn: '1721', role: 'manager' },
    });
  });

  it('an alert without a view (the ack response) has the new fields as null', () => {
    const out = toAlertResponse({ id: 5, conversationId: 42, reason: 'user_request', status: 'acked' } as unknown as AgentAlert);
    expect(out).toMatchObject({ targetRegion: null, supportType: null, supportRegion: null, supportRegionHint: null, escalatedAt: null, partner: null });
  });

  it('the alarm feed endpoint stamps presence, then returns each alert with its context', async () => {
    const alert = { id: 5, conversationId: 42, reason: 'user_request', status: 'new', targetRegion: null } as unknown as AgentAlert;
    const touchPresence = jest.fn(async () => undefined);
    const listWithContext = jest.fn(async () => [
      { alert, view: { supportType: 'cs', supportRegion: 'north', supportRegionHint: null, escalatedAt, conversationStatus: 'waiting', partner: null } },
    ]);
    const controller = new AgentConsoleController(
      {} as never,
      { touchPresence, listWithContext } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const out = await controller.alerts({ actorType: 'user', tenantId: 1, userId: 7 } as never, { status: 'new' } as never);
    expect(touchPresence).toHaveBeenCalledWith(7, 1);
    expect(listWithContext).toHaveBeenCalledWith('new', 7, 1);
    expect(out[0]).toMatchObject({ id: 5, supportType: 'cs', supportRegion: 'north' });
  });
});
