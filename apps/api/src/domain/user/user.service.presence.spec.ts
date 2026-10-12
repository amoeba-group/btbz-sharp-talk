import { UserService } from './user.service';

/**
 * Presence on the Users list (PLN-261012 SG-60): the same rule routing uses —
 * on duty AND a heartbeat within AGENT_PRESENCE_TTL_SEC — reported per user in
 * one extra query, so the screen can show who an alert would actually reach.
 */
const NOW = Date.parse('2026-10-15T09:00:00.000Z');
const ago = (sec: number) => new Date(NOW - sec * 1000);

function repo(overrides: Record<string, unknown> = {}): never {
  return {
    find: jest.fn(async () => []),
    findOne: jest.fn(),
    save: jest.fn(),
    ...overrides,
  } as never;
}

function listQb(users: unknown[]) {
  const qb: Record<string, unknown> = {};
  for (const m of ['where', 'andWhere', 'orderBy', 'skip', 'take']) qb[m] = () => qb;
  qb.getManyAndCount = async () => [users, users.length];
  return qb;
}

const user = (id: string) => ({
  id,
  tenantId: 1,
  email: `u${id}@example.com`,
  name: null,
  rank: 'staff',
  status: 'active',
  mustChangePassword: 0,
  region: null,
  invitedAt: null,
  createdAt: new Date('2026-06-30T13:55:48.000Z'),
});

describe('UserService.listUsers — presence', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function build(profiles: unknown[], env: Record<string, string> = {}) {
    const profileRepo = { find: jest.fn(async () => profiles) };
    const svc = new UserService(
      repo({ createQueryBuilder: () => listQb([user('1'), user('2'), user('3'), user('4')]) }),
      repo(),
      repo(),
      repo(),
      {} as never, // audit
      {} as never, // loginLimiter
      {} as never, // mailer
      {} as never, // tenantService
      { get: jest.fn((k: string) => env[k]) } as never,
      profileRepo as never,
    );
    return { svc, profileRepo };
  }

  it('reports present / stale / off duty / no profile per user from one query', async () => {
    const h = build([
      { tenantId: 1, userId: 1, status: 'online', lastSeen: ago(12) }, // present
      { tenantId: 1, userId: 2, status: 'online', lastSeen: ago(600) }, // on, not connected
      { tenantId: 1, userId: 3, status: 'offline', lastSeen: ago(3) }, // off duty
      // user 4: no profile row at all
    ]);

    const { items } = await h.svc.listUsers(1, 1, 20);

    expect(h.profileRepo.find).toHaveBeenCalledTimes(1);
    const byId = new Map(items.map((i) => [String(i.id), i.presence]));
    expect(byId.get('1')).toEqual({ onDuty: true, present: true, lastSeenAt: ago(12) });
    expect(byId.get('2')).toEqual({ onDuty: true, present: false, lastSeenAt: ago(600) });
    expect(byId.get('3')).toEqual({ onDuty: false, present: false, lastSeenAt: ago(3) });
    expect(byId.get('4')).toEqual({ onDuty: false, present: false, lastSeenAt: null });
  });

  it('fences the profile read to the tenant', async () => {
    const h = build([]);
    await h.svc.listUsers(1, 1, 20);
    const where = (h.profileRepo.find.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where.tenantId).toBe(1);
  });

  it('applies the configured TTL', async () => {
    const profiles = [{ tenantId: 1, userId: 1, status: 'online', lastSeen: ago(100) }];
    const wide = await build(profiles, { AGENT_PRESENCE_TTL_SEC: '120' }).svc.listUsers(1, 1, 20);
    expect(wide.items[0].presence?.present).toBe(true);
    const dflt = await build(profiles).svc.listUsers(1, 1, 20);
    expect(dflt.items[0].presence?.present).toBe(false);
  });

  it('omits presence when the profile table is not wired (legacy test double)', async () => {
    const svc = new UserService(
      repo({ createQueryBuilder: () => listQb([user('1')]) }),
      repo(),
      repo(),
      repo(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { get: jest.fn() } as never,
    );
    const { items } = await svc.listUsers(1, 1, 20);
    expect(items[0].presence).toBeUndefined();
  });
});
