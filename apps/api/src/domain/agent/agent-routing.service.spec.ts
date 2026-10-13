import { Reflector } from '@nestjs/core';
import { AgentRoutingService } from './agent-routing.service';
import { AgentConsoleController } from './agent-console.controller';
import { AuthorizationGuard } from '../../global/guard/authorization.guard';
import { BusinessException } from '../../global/exception/business.exception';
import { fakeRepo } from './testing/fake-table';
import type { Row } from './testing/fake-table';

/**
 * Re-route: hand a conversation to another team / region (PLN-261012 SG-64, REQ D-20) and the
 * queue counters (SG-66). The repositories are in-memory tables, so what is asserted is the
 * state a console would read back: the conversation row, the released assignment, the thread
 * note, the audit entry, and the alert call that bypasses the de-dupe.
 */
const TEAMS = [
  { id: 'cs', jobLabel: 'consult', label: 'Customer Service Support' },
  { id: 'business', jobLabel: 'sales_admin', label: 'Business Support' },
];

function build(
  opts: {
    conv?: Row | null;
    teamRouting?: boolean;
    regionEnabled?: boolean;
    raise?: unknown;
    assignments?: Row[];
    users?: Row[];
  } = {},
) {
  const conv: Row | null =
    opts.conv === undefined
      ? {
          id: 42,
          tenantId: 1,
          sessionId: 5,
          status: 'waiting',
          agentId: null,
          escalated: 1,
          supportType: 'cs',
          supportRegion: 'north',
          supportRegionHint: null,
          escalatedAt: new Date(Date.now() - 3_600_000),
          unclaimedPages: 2,
          unclaimedPagedAt: new Date(Date.now() - 3_000_000),
        }
      : opts.conv;
  const convs = fakeRepo<Row>(conv ? [conv] : []);
  const assignments = fakeRepo<Row>(opts.assignments ?? []);
  const comments = fakeRepo<Row>([]);
  const msgs = fakeRepo<Row>([{ id: 1, conversationId: 42, senderType: 'user', body: 'Hoa hồng tính thế nào?' }]);
  const sessions = fakeRepo<Row>([{ id: 5, identityClaims: { signed: true, hotelSn: '1721', hotelName: 'Sao Mai', role: 'manager' } }]);
  const users = fakeRepo<Row>(opts.users ?? [{ id: 7, tenantId: 1, name: 'Lan', region: 'north' }, { id: 22, tenantId: 1, name: 'Minh', region: 'south' }]);
  const raise = jest.fn(async () => opts.raise ?? { alert: { id: 900 }, targetUserId: 22, targetRegion: null });
  const audit = { write: jest.fn(async () => undefined) };
  const router = {
    teamQuestion: jest.fn(async () => (opts.teamRouting === false ? null : { prompt: 'q', options: TEAMS })),
    routingPolicy: jest.fn(async () => ({
      configured: true,
      assigneeUserIds: [3],
      regionEnabled: opts.regionEnabled ?? true,
      regionMode: 'prefer',
      widenAfterMinutes: null,
      slackByRegion: {},
      teams: TEAMS,
      unclaimedAlerts: true,
    })),
  };
  const svc = new AgentRoutingService(
    convs as never,
    msgs as never,
    sessions as never,
    users as never,
    assignments as never,
    comments as never,
    { raise } as never,
    router as never,
    audit as never,
  );
  return { svc, conv, convs, assignments, comments, raise, audit, router, users };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    return (e as BusinessException).errorCode;
  }
  throw new Error('expected a rejection');
}

describe('AgentRoutingService.reroute', () => {
  it('moves the conversation to the new team and back into the waiting queue, with a fresh waiting clock', async () => {
    const h = build();
    const out = await h.svc.reroute(42, 1, 7, { supportType: 'business' });

    expect(h.conv).toMatchObject({
      supportType: 'business',
      supportRegion: 'north', // omitted = kept
      status: 'waiting',
      agentId: null,
      escalated: 1,
      unclaimedPages: 0,
      unclaimedPagedAt: null,
    });
    // The clock restarted: it is "now", not the hour-old stamp the thread had.
    expect(Date.now() - new Date(h.conv!.escalatedAt as Date).getTime()).toBeLessThan(60_000);
    expect(out).toMatchObject({ id: 42, status: 'waiting', supportType: 'business', supportRegion: 'north' });
  });

  it('re-runs the ladder through a fresh alert with the de-dupe bypassed, for the new team label and region', async () => {
    const h = build();
    await h.svc.reroute(42, 1, 7, { supportType: 'business' });

    expect(h.raise).toHaveBeenCalledTimes(1);
    const [payload, opts] = h.raise.mock.calls[0] as unknown as [Record<string, unknown>, { supersede: boolean }];
    expect(opts).toEqual({ supersede: true });
    expect(payload).toMatchObject({
      tenantId: 1,
      conversationId: 42,
      reason: 'rerouted',
      issueLabel: 'sales_admin', // the NEW team's label, not the old team's
      supportLabel: 'Business Support',
      supportRegion: 'north',
      regionLabel: 'North',
      partnerLabel: 'Sao Mai (1721) · manager',
      targetUserIds: [3],
      preview: 'Hoa hồng tính thế nào?',
    });
  });

  it('tells the caller who was asked', async () => {
    const h = build();
    const out = await h.svc.reroute(42, 1, 7, { supportType: 'business' });
    expect(out.notified).toEqual({ userId: 22, name: 'Minh', region: null });
  });

  it('reports a broadcast when nobody could be addressed, region-scoped in strict mode', async () => {
    const h = build({ raise: { alert: { id: 900 }, targetUserId: null, targetRegion: 'north' } });
    const out = await h.svc.reroute(42, 1, 7, { supportType: 'business' });
    expect(out.notified).toEqual({ userId: null, name: null, region: 'north' });
  });

  it('writes an internal note (never a customer-visible message) and an audit entry', async () => {
    const h = build();
    await h.svc.reroute(42, 1, 7, { supportType: 'business' });

    expect(h.comments.table).toHaveLength(1);
    expect(h.comments.table[0]).toMatchObject({
      tenantId: 1,
      scope: 'conversation',
      conversationId: 42,
      authorId: 7,
      body: 'Routed to Business Support (North) by Lan',
    });
    expect(h.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 1,
        actorType: 'user',
        actorId: 7,
        action: 'agent.conversation_rerouted',
        target: 'conversation:42',
        metadata: expect.objectContaining({
          from: expect.objectContaining({ supportType: 'cs', supportRegion: 'north' }),
          to: { supportType: 'business', supportRegion: 'north' },
          paged: 22,
        }),
      }),
    );
  });

  it('releases the previous holder of an agent-owned conversation: assignment transferred, owner cleared', async () => {
    const h = build({
      conv: { id: 42, tenantId: 1, sessionId: 5, status: 'agent', agentId: 9, supportType: 'cs', supportRegion: null },
      assignments: [
        { id: 1, tenantId: 1, conversationId: 42, agentId: 9, status: 'active' },
        { id: 2, tenantId: 1, conversationId: 43, agentId: 9, status: 'active' }, // another conversation
      ],
    });
    await h.svc.reroute(42, 1, 7, { supportType: 'business' });

    expect(h.conv).toMatchObject({ status: 'waiting', agentId: null });
    expect(h.assignments.table.find((a) => a.id === 1)).toMatchObject({ status: 'transferred' });
    expect(h.assignments.table.find((a) => a.id === 2)?.status).toBe('active');
    expect(h.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ from: expect.objectContaining({ agentId: 9, status: 'agent' }) }) }),
    );
  });

  it('an explicit region replaces the stored one and ends the unmapped hint; null clears it', async () => {
    const h = build({ conv: { id: 42, tenantId: 1, sessionId: 5, status: 'waiting', supportType: 'cs', supportRegion: null, supportRegionHint: 'Tp Quy Nhơn' } });
    await h.svc.reroute(42, 1, 7, { supportType: 'cs', region: 'south' });
    expect(h.conv).toMatchObject({ supportRegion: 'south', supportRegionHint: null });
    expect((h.raise.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({ supportRegion: 'south', regionLabel: 'South' });

    await h.svc.reroute(42, 1, 7, { supportType: 'cs', region: null });
    expect(h.conv).toMatchObject({ supportRegion: null });
    expect((h.raise.mock.calls[1] as unknown as [Record<string, unknown>])[0].supportRegion).toBeUndefined();
  });

  it('keeps the unmapped hint, and says so on the alert, when the region is left alone', async () => {
    const h = build({ conv: { id: 42, tenantId: 1, sessionId: 5, status: 'waiting', supportType: 'cs', supportRegion: null, supportRegionHint: 'Pleiku' } });
    await h.svc.reroute(42, 1, 7, { supportType: 'business' });
    expect(h.conv?.supportRegionHint).toBe('Pleiku');
    expect((h.raise.mock.calls[0] as unknown as [Record<string, unknown>])[0].regionUnmapped).toBe('Pleiku');
  });

  it('works on a conversation the AI still holds (the agent is escalating it to that team)', async () => {
    const h = build({ conv: { id: 42, tenantId: 1, sessionId: 5, status: 'ai_active', agentId: null, supportType: null, supportRegion: null } });
    const out = await h.svc.reroute(42, 1, 7, { supportType: 'business' });
    expect(out.status).toBe('waiting');
    expect(h.conv?.escalated).toBe(1);
  });

  describe('refusals leave everything untouched', () => {
    it('an ended conversation (E5125)', async () => {
      const h = build({ conv: { id: 42, tenantId: 1, sessionId: 5, status: 'ended', supportType: 'cs' } });
      expect(await code(h.svc.reroute(42, 1, 7, { supportType: 'business' }))).toBe('E5125');
      expect(h.conv).toMatchObject({ status: 'ended', supportType: 'cs' });
      expect(h.raise).not.toHaveBeenCalled();
      expect(h.audit.write).not.toHaveBeenCalled();
      expect(h.comments.table).toHaveLength(0);
    });

    it('a team the tenant does not offer (E5126), whatever the console sent', async () => {
      const h = build();
      expect(await code(h.svc.reroute(42, 1, 7, { supportType: 'accounting' }))).toBe('E5126');
      expect(await code(h.svc.reroute(42, 1, 7, { supportType: '' }))).toBe('E5126');
      expect(h.conv?.supportType).toBe('cs');
      expect(h.raise).not.toHaveBeenCalled();
    });

    it('a region that is not a team (E5126)', async () => {
      const h = build();
      expect(await code(h.svc.reroute(42, 1, 7, { supportType: 'business', region: 'east' }))).toBe('E5126');
      expect(h.conv?.supportRegion).toBe('north');
    });

    it('a tenant without team routing (E5129)', async () => {
      const h = build({ teamRouting: false });
      expect(await code(h.svc.reroute(42, 1, 7, { supportType: 'business' }))).toBe('E5129');
    });

    it("another tenant's conversation reads as missing (404)", async () => {
      const h = build();
      await expect(h.svc.reroute(42, 2, 7, { supportType: 'business' })).rejects.toMatchObject({ errorCode: 'E5002' });
      expect(h.raise).not.toHaveBeenCalled();
    });
  });
});

describe('AgentRoutingService.options', () => {
  it('lists the tenant team options and whether regions apply', async () => {
    const h = build();
    expect(await h.svc.options(1, 'VI')).toEqual({
      enabled: true,
      teams: [
        { id: 'cs', label: 'Customer Service Support' },
        { id: 'business', label: 'Business Support' },
      ],
      regionEnabled: true,
      regions: ['north', 'south'],
    });
  });

  it('offers nothing when team routing is off, and no regions when region routing is off', async () => {
    const off = build({ teamRouting: false, regionEnabled: false });
    expect(await off.svc.options(1, 'EN')).toEqual({ enabled: false, teams: [], regionEnabled: false, regions: [] });
  });
});

describe('PATCH /agent/conversations/:id/routing — who may call it', () => {
  const guard = new AuthorizationGuard(new Reflector());
  const ctx = (user: unknown) =>
    ({
      getHandler: () => AgentConsoleController.prototype.rerouteConversation,
      getClass: () => AgentConsoleController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;
  const staff = (labels: string[]) => ({ actorType: 'user', tenantId: 1, userId: 5, rank: 'staff', labels });

  it('a STAFF-rank user with the CS (consult) label may — assign is manager+, this is not', () => {
    expect(guard.canActivate(ctx(staff(['consult'])))).toBe(true);
  });

  it('a staff user with the sales-admin label may too (it satisfies the consult-gated capabilities)', () => {
    expect(guard.canActivate(ctx(staff(['sales_admin'])))).toBe(true);
  });

  it('a staff user with neither label may not', () => {
    expect(() => guard.canActivate(ctx(staff(['accounting'])))).toThrow(BusinessException);
    expect(() => guard.canActivate(ctx(staff([])))).toThrow(BusinessException);
  });

  it('a manager and a master may; a platform admin may not', () => {
    expect(guard.canActivate(ctx({ ...staff(['consult']), rank: 'manager' }))).toBe(true);
    expect(guard.canActivate(ctx({ ...staff([]), rank: 'master' }))).toBe(true);
    expect(() => guard.canActivate(ctx({ actorType: 'admin', adminId: 1, level: 'super_admin' }))).toThrow(BusinessException);
  });

  it('stays distinct from "assign", which a staff user still cannot do', () => {
    const assign = {
      getHandler: () => AgentConsoleController.prototype.assignConversation,
      getClass: () => AgentConsoleController,
      switchToHttp: () => ({ getRequest: () => ({ user: staff(['consult']) }) }),
    } as never;
    expect(() => guard.canActivate(assign)).toThrow(BusinessException);
  });
});

describe('AgentRoutingService.queueCounts', () => {
  /** A query builder double that answers the grouped read and the unclaimed read. */
  function build2(grouped: Array<Record<string, unknown>>, unclaimed: { n: number; oldest: string | null }, region: string | null = 'south') {
    const qb = (kind: 'grouped' | 'waiting') => {
      const chain: Record<string, unknown> = {};
      for (const m of ['where', 'andWhere', 'select', 'addSelect', 'groupBy', 'addGroupBy']) chain[m] = jest.fn(() => chain);
      chain.getRawMany = jest.fn(async () => grouped);
      chain.getRawOne = jest.fn(async () => unclaimed);
      (chain as { kind?: string }).kind = kind;
      return chain;
    };
    const queues: Array<Record<string, unknown>> = [];
    const convRepo = {
      createQueryBuilder: jest.fn(() => {
        const q = qb(queues.length === 0 ? 'grouped' : 'waiting');
        queues.push(q);
        return q;
      }),
    };
    const svc = new AgentRoutingService(
      convRepo as never,
      {} as never,
      {} as never,
      { findOne: jest.fn(async () => (region ? { id: 7, region } : { id: 7, region: null })) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, queues };
  }

  it('totals the queue per team and region, with the unmapped part of "no region" and the caller region', async () => {
    const h = build2(
      [
        { supportType: 'cs', supportRegion: 'north', unmapped: 0, n: '4' },
        { supportType: 'cs', supportRegion: 'south', unmapped: 0, n: '5' },
        { supportType: 'business', supportRegion: 'south', unmapped: 0, n: '3' },
        { supportType: 'business', supportRegion: null, unmapped: 1, n: '2' }, // unlisted province
        { supportType: null, supportRegion: null, unmapped: 0, n: '6' }, // guests / AI threads
      ],
      { n: 7, oldest: '2026-10-15T08:00:00.000Z' },
    );
    const out = await h.svc.queueCounts(1, 7, 'queue');

    expect(out.total).toBe(20);
    expect(out.teams).toEqual([
      { id: null, count: 6 },
      { id: 'cs', count: 9 },
      { id: 'business', count: 5 },
    ].sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id))));
    expect(out.regions).toEqual({ north: 4, south: 8, none: 8, unmapped: 2 });
    expect(out.unclaimed).toBe(7);
    expect(out.oldestUnclaimedAt).toEqual(new Date('2026-10-15T08:00:00.000Z'));
    expect(out.myRegion).toBe('south');
  });

  it('an empty queue is all zeros and no oldest wait; a nationwide caller has no region', async () => {
    const h = build2([], { n: 0, oldest: null }, null);
    const out = await h.svc.queueCounts(1, 7, 'all');
    expect(out).toMatchObject({ total: 0, teams: [], unclaimed: 0, oldestUnclaimedAt: null, myRegion: null });
    expect(out.regions).toEqual({ north: 0, south: 0, none: 0, unmapped: 0 });
  });

  it('fences both reads to the tenant and applies the channel like the list does', async () => {
    const h = build2([], { n: 0, oldest: null });
    await h.svc.queueCounts(3, 7, 'queue', 'widget');
    const where = (h.queues[0].where as jest.Mock).mock.calls[0];
    expect(where[1]).toEqual({ tenantId: 3 });
    expect(JSON.stringify((h.queues[0].andWhere as jest.Mock).mock.calls)).toContain("c.channel = 'widget' OR c.channel IS NULL");
    expect((h.queues[1].where as jest.Mock).mock.calls[0][1]).toEqual({ tenantId: 3 });
  });
});
