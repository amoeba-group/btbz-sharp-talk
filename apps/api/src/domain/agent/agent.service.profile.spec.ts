import { AgentService } from './agent.service';
import { AgentProfile } from './entity/agent-profile.entity';
import { toProfileResponse } from './agent.mapper';

/**
 * The console's "On duty" toggle (PLN-261012 SG-60) writes through
 * PUT /agent/profile: it must create the row when missing and stamp the first
 * heartbeat on switch-on, so routing counts the agent from that moment.
 */
describe('AgentService.upsertProfile — duty toggle', () => {
  function build(existing: Partial<AgentProfile> | null) {
    const saved: Array<Partial<AgentProfile>> = [];
    const profileRepo = {
      findOne: jest.fn(async () => existing),
      create: jest.fn((p: Partial<AgentProfile>) => p),
      save: jest.fn(async (p: Partial<AgentProfile>) => {
        saved.push(p);
        return p as AgentProfile;
      }),
    };
    const svc = Object.create(AgentService.prototype) as AgentService & { profileRepo: unknown };
    (svc as unknown as { profileRepo: unknown }).profileRepo = profileRepo;
    return { svc, saved, profileRepo };
  }

  const NOW = Date.parse('2026-10-15T09:00:00.000Z');
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates the profile row on the first switch-on, already stamped', async () => {
    const h = build(null);
    await h.svc.upsertProfile(7, 1, { status: 'online' });
    expect(h.saved[0]).toMatchObject({ tenantId: 1, userId: 7, status: 'online' });
    expect(h.saved[0].lastSeen?.getTime()).toBe(NOW);
  });

  it('stamps the heartbeat when an existing profile goes online', async () => {
    const h = build({ userId: 7, tenantId: 1, status: 'offline', maxConcurrent: 3, lastSeen: null });
    await h.svc.upsertProfile(7, 1, { status: 'online' });
    expect(h.saved[0]).toMatchObject({ status: 'online' });
    expect(h.saved[0].lastSeen?.getTime()).toBe(NOW);
  });

  it('switching off leaves the old heartbeat alone and the profile is off duty', async () => {
    const old = new Date(NOW - 5000);
    const h = build({ userId: 7, tenantId: 1, status: 'online', maxConcurrent: 3, lastSeen: old });
    await h.svc.upsertProfile(7, 1, { status: 'offline' });
    expect(h.saved[0]).toMatchObject({ status: 'offline', lastSeen: old });
  });

  it('a profile created without a status starts off duty and unseen', async () => {
    const h = build(null);
    await h.svc.upsertProfile(7, 1, { languages: 'en' });
    expect(h.saved[0]).toMatchObject({ status: 'offline', lastSeen: null });
  });

  it('exposes lastSeen in the profile response', () => {
    const lastSeen = new Date(NOW);
    expect(toProfileResponse({ id: 1, tenantId: 1, userId: 7, status: 'online', lastSeen } as AgentProfile).lastSeen).toBe(
      lastSeen,
    );
    expect(toProfileResponse({ id: 1, tenantId: 1, userId: 7, status: 'offline' } as AgentProfile).lastSeen).toBeNull();
  });
});
