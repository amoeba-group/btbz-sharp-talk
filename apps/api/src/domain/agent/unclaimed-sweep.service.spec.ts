import { FindOperator } from 'typeorm';
import { UnclaimedSweepService } from './unclaimed-sweep.service';
import type { Conversation } from '../chat/entity/conversation.entity';
import type { RoutingPolicy } from '../ai-engine/handoff-router.service';

/**
 * The unclaimed-conversation sweep (PLN-261012 SG-63, REQ D-10). The repository is a small
 * in-memory table that understands the TypeORM operators the sweep uses, so the test runs
 * the real query shape against rows and the clock is moved by hand: timing, de-dupe, cap,
 * tenant gate and the two-instance race are all exercised end to end.
 */
const MIN = 60_000;
const T0 = Date.parse('2026-10-15T09:00:00.000Z');

type Row = Partial<Conversation> & { id: number };

function holds(value: unknown, op: unknown): boolean {
  if (!(op instanceof FindOperator)) return value === op;
  const v = (op as unknown as { value: unknown }).value;
  const time = (x: unknown) => (x instanceof Date ? x.getTime() : Number(x));
  switch (op.type) {
    case 'isNull':
      return value === null || value === undefined;
    case 'lessThan':
      return value != null && time(value) < time(v);
    case 'lessThanOrEqual':
      return value != null && time(value) <= time(v);
    default:
      throw new Error(`operator not modelled: ${op.type}`);
  }
}

const matches = (row: Row, cond: Record<string, unknown>) =>
  Object.entries(cond).every(([k, op]) => holds((row as Record<string, unknown>)[k], op));

function build(rows: Row[], policies: Record<number, Partial<RoutingPolicy>> = {}) {
  const table = rows;
  const convRepo = {
    // Copies, like a real read: two instances must not see each other's later writes by reference.
    find: jest.fn(async (q: { where: Array<Record<string, unknown>> }) =>
      table.filter((r) => q.where.some((cond) => matches(r, cond))).map((r) => ({ ...r })),
    ),
    update: jest.fn(async (criteria: Record<string, unknown>, patch: Partial<Conversation>) => {
      const hit = table.filter((r) => matches(r, criteria));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    }),
  };
  const pages: Array<{ id: number; page: Record<string, unknown> }> = [];
  const alerts = {
    pageUnclaimed: jest.fn(async (conv: Conversation, page: Record<string, unknown>) => {
      pages.push({ id: Number(conv.id), page });
      return { id: 100 + pages.length } as never;
    }),
  };
  const router = {
    routingPolicy: jest.fn(async (tenantId: number) => ({
      configured: true,
      assigneeUserIds: [],
      regionEnabled: false,
      regionMode: 'prefer',
      widenAfterMinutes: null,
      slackByRegion: {},
      teams: [],
      unclaimedAlerts: true,
      ...(policies[tenantId] ?? {}),
    })),
  };
  const audit = { write: jest.fn(async () => undefined) };
  const svc = new UnclaimedSweepService(convRepo as never, alerts as never, router as never, audit as never);
  return { svc, table, convRepo, alerts, router, audit, pages };
}

const waiting = (over: Partial<Row> = {}): Row => ({
  id: 1,
  tenantId: 1,
  sessionId: 5,
  status: 'waiting',
  agentId: null,
  replyChannel: null,
  escalatedAt: new Date(T0),
  unclaimedPages: 0,
  unclaimedPagedAt: null,
  supportRegion: null,
  ...over,
});

describe('UnclaimedSweepService', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    delete process.env.ALERT_UNCLAIMED_MINUTES;
    delete process.env.ALERT_UNCLAIMED_MAX_PAGES;
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('pages after the wait limit and not before', async () => {
    const h = build([waiting()]);
    await h.svc.sweep(T0 + 4 * MIN + 59_000);
    expect(h.pages).toHaveLength(0);
    await h.svc.sweep(T0 + 5 * MIN);
    expect(h.pages).toHaveLength(1);
    expect(h.pages[0].page).toMatchObject({ attempt: 1, crossRegion: true, scopeRegion: null, waitedMin: 5 });
  });

  it('never re-pages on every tick: a 2-hour wait with a tick every 30 s pages at 5, 10 and 15 min only', async () => {
    const h = build([waiting()]);
    const at: number[] = [];
    for (let t = 0; t <= 120 * MIN; t += 30_000) {
      const before = h.pages.length;
      await h.svc.sweep(T0 + t);
      if (h.pages.length > before) at.push(t / MIN);
    }
    expect(at).toEqual([5, 10, 15]);
    // The latch lives on the row, so a restart sees the same state.
    expect(h.table[0]).toMatchObject({ unclaimedPages: 3 });
    expect(new Date(h.table[0].unclaimedPagedAt as Date).getTime()).toBe(T0 + 15 * MIN);
  });

  it('the cap is configurable', async () => {
    process.env.ALERT_UNCLAIMED_MAX_PAGES = '1';
    const h = build([waiting()]);
    for (let t = 0; t <= 60 * MIN; t += 30_000) await h.svc.sweep(T0 + t);
    expect(h.pages).toHaveLength(1);
  });

  it('is switched off by ALERT_UNCLAIMED_MINUTES=0, without touching the database', async () => {
    process.env.ALERT_UNCLAIMED_MINUTES = '0';
    const h = build([waiting()]);
    await h.svc.sweep(T0 + 60 * MIN);
    expect(h.convRepo.find).not.toHaveBeenCalled();
    expect(h.pages).toHaveLength(0);
  });

  it('leaves a tenant alone when its routing does not call for it', async () => {
    const h = build([waiting({ tenantId: 2 })], { 2: { unclaimedAlerts: false } });
    await h.svc.sweep(T0 + 30 * MIN);
    expect(h.pages).toHaveLength(0);
    expect(h.table[0].unclaimedPages).toBe(0);
  });

  it('pages one tenant and not another in the same pass', async () => {
    const h = build([waiting({ id: 1, tenantId: 1 }), waiting({ id: 2, tenantId: 2 })], { 2: { unclaimedAlerts: false } });
    await h.svc.sweep(T0 + 5 * MIN);
    expect(h.pages.map((p) => p.id)).toEqual([1]);
  });

  it('only looks at waiting, unclaimed conversations', async () => {
    const h = build([
      waiting({ id: 1, status: 'agent', agentId: 9 }),
      waiting({ id: 2, status: 'ai_active' }),
      waiting({ id: 3, status: 'ended' }),
      waiting({ id: 4, agentId: 9 }), // waiting but held by someone
    ]);
    await h.svc.sweep(T0 + 30 * MIN);
    expect(h.pages).toHaveLength(0);
  });

  it('skips an off-hours thread waiting on an email reply, and a legacy row with no escalated_at', async () => {
    const h = build([waiting({ id: 1, replyChannel: 'email' }), waiting({ id: 2, escalatedAt: null })]);
    await h.svc.sweep(T0 + 30 * MIN);
    expect(h.pages).toHaveLength(0);
  });

  it('a conversation claimed between the read and the page slot is not paged', async () => {
    const h = build([waiting()]);
    h.convRepo.update.mockImplementationOnce(async () => ({ affected: 0 }));
    await h.svc.sweep(T0 + 5 * MIN);
    expect(h.pages).toHaveLength(0);
    expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('two instances sweeping at the same moment page once: only one wins the page slot', async () => {
    const rows = [waiting()];
    const a = build(rows);
    const b = build(rows); // the same table
    await Promise.all([a.svc.sweep(T0 + 5 * MIN), b.svc.sweep(T0 + 5 * MIN)]);
    expect(a.pages.length + b.pages.length).toBe(1);
    expect(rows[0].unclaimedPages).toBe(1);
  });

  it('strict mode keeps the page in the hotel region, then crosses after the widening delay', async () => {
    const strict = { regionEnabled: true, regionMode: 'strict', widenAfterMinutes: 15 } as Partial<RoutingPolicy>;
    const h = build([waiting({ supportRegion: 'north' })], { 1: strict });
    for (let t = 0; t <= 30 * MIN; t += 30_000) await h.svc.sweep(T0 + t);
    expect(h.pages.map((p) => [p.page.scopeRegion, p.page.crossRegion])).toEqual([
      ['north', false], // 5 min
      ['north', false], // 10 min
      [null, true], // 15 min: the widening
      [null, true], // 20 min — the raised cap still allows it
    ]);
  });

  it('records a system audit entry per page, never under a person name', async () => {
    const h = build([waiting()]);
    await h.svc.sweep(T0 + 5 * MIN);
    expect(h.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'system',
        actorId: 0,
        action: 'alert.unclaimed_paged',
        target: 'conversation:1',
        tenantId: 1,
      }),
    );
  });

  it('a page that fails does not stop the pass or leave the sweep locked', async () => {
    const h = build([waiting({ id: 1 }), waiting({ id: 2 })]);
    h.alerts.pageUnclaimed.mockImplementationOnce(async () => null as never);
    const out = await h.svc.sweep(T0 + 5 * MIN);
    expect(out.paged).toBe(1); // conversation 2 still went out
    // And the next pass is not blocked.
    await expect(h.svc.sweep(T0 + 6 * MIN)).resolves.toBeDefined();
  });

  it('a routing policy that cannot be read leaves that tenant unswept', async () => {
    const h = build([waiting()]);
    h.router.routingPolicy.mockRejectedValueOnce(new Error('db down'));
    await h.svc.sweep(T0 + 5 * MIN);
    expect(h.pages).toHaveLength(0);
  });
});
