import { FindOperator } from 'typeorm';
import { AgentAlertService } from './agent-alert.service';
import { AgentAlert } from './entity/agent-alert.entity';

/**
 * Real presence (PLN-261012 SG-60, D-09): an agent is asked for an escalation only
 * while on duty AND seen within AGENT_PRESENCE_TTL_SEC; the alert poll is the
 * heartbeat and writes are throttled.
 */

const NOW = Date.parse('2026-10-15T09:00:00.000Z');
const ago = (sec: number) => new Date(NOW - sec * 1000);

interface ProfileRow {
  tenantId: number;
  userId: number;
  status: string;
  maxConcurrent?: number;
  lastSeen?: Date | null;
}

describe('AgentAlertService — presence in routing', () => {
  function build(profiles: ProfileRow[], env: Record<string, string> = {}) {
    const saved: Array<Partial<AgentAlert>> = [];
    const alertRepo = {
      findOne: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      save: jest.fn(async (a: Partial<AgentAlert>) => {
        saved.push(a);
        return { id: 1, ...a } as AgentAlert;
      }),
      create: jest.fn((a: Partial<AgentAlert>) => a as AgentAlert),
    };
    const svc = new AgentAlertService(
      alertRepo as never,
      { find: jest.fn(async () => [{ id: 3, tenantId: 1, code: 'consult' }]) } as never,
      { find: jest.fn(async () => [11, 12, 13].map((userId) => ({ userId, jobLabelId: 3 }))) } as never,
      {
        // The status filter is the query's job; the TTL is the service's.
        find: jest.fn(async () => profiles.filter((p) => p.status === 'online')),
      } as never,
      { count: jest.fn(async () => 0) } as never,
      { subscribe: jest.fn() } as never,
      { get: jest.fn((k: string) => env[k]) } as never,
      { send: jest.fn() } as never,
    );
    return { svc, saved };
  }

  const base = { tenantId: 1, conversationId: 42, reason: 'user_request', targetUserIds: [9], issueLabel: 'consult' };
  const profile = (userId: number, lastSeen: Date | null, status = 'online'): ProfileRow => ({
    tenantId: 1,
    userId,
    status,
    maxConcurrent: 5,
    lastSeen,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('picks an agent seen within the TTL', async () => {
    const h = build([profile(11, ago(30))]);
    await h.svc.onEscalation(base);
    expect(h.saved[0].targetUserId).toBe(11);
  });

  it('counts the agent at exactly 90 s, not at 91 s', async () => {
    const atEdge = build([profile(11, ago(90))]);
    await atEdge.svc.onEscalation(base);
    expect(atEdge.saved[0].targetUserId).toBe(11);

    const past = build([profile(11, ago(91))]);
    await past.svc.onEscalation(base);
    expect(past.saved[0].targetUserId).toBe(9); // configured assignee fallback
  });

  it("does not ask a stale 'online' agent — the old forever-online bug", async () => {
    const h = build([profile(11, ago(3600))]);
    await h.svc.onEscalation(base);
    expect(h.saved[0].targetUserId).toBe(9);
  });

  it('does not ask an agent with no heartbeat at all (status alone is not presence)', async () => {
    const h = build([profile(11, null)]);
    await h.svc.onEscalation(base);
    expect(h.saved[0].targetUserId).toBe(9);
  });

  it('does not ask an agent who has no profile row', async () => {
    const h = build([]);
    await h.svc.onEscalation(base);
    expect(h.saved[0].targetUserId).toBe(9);
  });

  it('skips the stale agent and asks the present one', async () => {
    const h = build([profile(11, ago(500)), profile(12, ago(5))]);
    await h.svc.onEscalation(base);
    expect(h.saved[0].targetUserId).toBe(12);
  });

  it('honours AGENT_PRESENCE_TTL_SEC', async () => {
    const wide = build([profile(11, ago(100))], { AGENT_PRESENCE_TTL_SEC: '120' });
    await wide.svc.onEscalation(base);
    expect(wide.saved[0].targetUserId).toBe(11);

    const tight = build([profile(11, ago(100))], { AGENT_PRESENCE_TTL_SEC: '60' });
    await tight.svc.onEscalation(base);
    expect(tight.saved[0].targetUserId).toBe(9);
  });

  it('with nobody present and no assignee, the alert stays a broadcast', async () => {
    const h = build([profile(11, ago(900))]);
    await h.svc.onEscalation({ tenantId: 1, conversationId: 43, reason: 'user_request', issueLabel: 'consult' });
    expect(h.saved[0].targetUserId).toBeNull();
  });
});

/**
 * The poll's heartbeat write. The UPDATE itself carries the throttle and the
 * "on duty only" fence in its WHERE clause; the fake repo below evaluates that
 * clause against rows, so the behaviour (not just the call shape) is pinned.
 */
describe('AgentAlertService.touchPresence', () => {
  type Row = { tenantId: number; userId: number; status: string; lastSeen: Date | null };

  /** Evaluate a TypeORM find criteria value: plain equality or the operators used here. */
  function matches(value: unknown, wanted: unknown): boolean {
    if (!(wanted instanceof FindOperator)) return value === wanted;
    switch (wanted.type) {
      case 'isNull':
        return value == null;
      case 'lessThan':
        return value != null && (value as Date).getTime() < ((wanted.value as Date).getTime());
      case 'or':
        return (wanted.value as unknown as FindOperator<unknown>[]).some((op) => matches(value, op));
      default:
        throw new Error(`unhandled operator ${wanted.type}`);
    }
  }

  function build(rows: Row[], failWith?: Error) {
    const profileRepo = {
      update: jest.fn(async (criteria: Record<string, unknown>, patch: Partial<Row>) => {
        if (failWith) throw failWith;
        let affected = 0;
        for (const r of rows) {
          const hit = Object.entries(criteria).every(([k, w]) => matches((r as never)[k], w));
          if (hit) {
            Object.assign(r, patch);
            affected += 1;
          }
        }
        return { affected };
      }),
    };
    const svc = new AgentAlertService(
      {} as never,
      {} as never,
      {} as never,
      profileRepo as never,
      {} as never,
      { subscribe: jest.fn() } as never,
      { get: jest.fn(() => undefined) } as never,
      { send: jest.fn() } as never,
    );
    return { svc, profileRepo, rows };
  }

  const row = (lastSeen: Date | null, over: Partial<Row> = {}): Row => ({
    tenantId: 1,
    userId: 7,
    status: 'online',
    lastSeen,
    ...over,
  });

  it('stamps an on-duty agent who has never been seen', async () => {
    const h = build([row(null)]);
    await h.svc.touchPresence(7, 1, NOW);
    expect(h.rows[0].lastSeen?.getTime()).toBe(NOW);
  });

  it('stamps when the stored stamp is older than the 20 s throttle', async () => {
    const h = build([row(ago(21))]);
    await h.svc.touchPresence(7, 1, NOW);
    expect(h.rows[0].lastSeen?.getTime()).toBe(NOW);
  });

  it('skips the write when the stamp is younger than the throttle', async () => {
    const stamp = ago(10);
    const h = build([row(stamp)]);
    await h.svc.touchPresence(7, 1, NOW);
    expect(h.rows[0].lastSeen).toBe(stamp); // untouched
  });

  it('never touches an agent who is off duty', async () => {
    const h = build([row(ago(500), { status: 'offline' })]);
    await h.svc.touchPresence(7, 1, NOW);
    expect(h.rows[0].lastSeen?.getTime()).toBe(NOW - 500 * 1000);
  });

  it("never touches another tenant's or another user's profile", async () => {
    const h = build([row(null, { tenantId: 2 }), row(null, { userId: 8 })]);
    await h.svc.touchPresence(7, 1, NOW);
    expect(h.rows.map((r) => r.lastSeen)).toEqual([null, null]);
  });

  it('does nothing — and does not create a row — for a user with no profile', async () => {
    const h = build([]);
    await expect(h.svc.touchPresence(7, 1, NOW)).resolves.toBeUndefined();
    expect(h.rows).toHaveLength(0);
  });

  it('issues nothing for a caller without a tenant (platform admin) or user id', async () => {
    const h = build([row(null)]);
    await h.svc.touchPresence(7, 0, NOW);
    await h.svc.touchPresence(0, 1, NOW);
    expect(h.profileRepo.update).not.toHaveBeenCalled();
  });

  it('swallows a database error so the alert poll still answers', async () => {
    const h = build([row(null)], new Error('db down'));
    await expect(h.svc.touchPresence(7, 1, NOW)).resolves.toBeUndefined();
  });
});
