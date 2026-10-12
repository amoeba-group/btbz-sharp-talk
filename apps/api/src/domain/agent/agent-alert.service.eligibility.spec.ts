import { AgentAlertService } from './agent-alert.service';
import { AgentAlert } from './entity/agent-alert.entity';

/**
 * Who an escalation alert may be addressed to (PLN-261012 SG-65, REQ D-11).
 *
 * Eligibility: real user statuses are active / suspended / invited, and only an
 * active user can take a conversation — in the regional ladder AND in the plain
 * label search (which had no check at all). Choice: lowest load wins, where load
 * is the conversations a person holds plus the alerts already addressed to them
 * that nobody has acknowledged; ties go to the lowest user id, so the same inputs
 * always page the same person.
 */
describe('AgentAlertService — eligibility and load', () => {
  interface Staff {
    id: number;
    region?: string | null;
    status?: string;
  }
  interface Profile {
    userId: number;
    maxConcurrent?: number;
    /** Open conversations (active assignments). */
    open?: number;
    /** Alerts addressed to this person that are still `new`. */
    pending?: number;
  }

  const FRESH = () => new Date();

  function build(staff: Staff[], profiles: Profile[]) {
    const saved: Array<Partial<AgentAlert>> = [];
    const alertRepo = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async (a: Partial<AgentAlert>) => {
        saved.push(a);
        return { id: 1, ...a } as AgentAlert;
      }),
      create: jest.fn((a: Partial<AgentAlert>) => a as AgentAlert),
      count: jest.fn(async (q: { where: { targetUserId: number; status: string } }) => {
        expect(q.where.status).toBe('new');
        return profiles.find((p) => p.userId === q.where.targetUserId)?.pending ?? 0;
      }),
    };
    const assignmentRepo = {
      count: jest.fn(async (q: { where: { agentId: number; status: string } }) => {
        expect(q.where.status).toBe('active');
        return profiles.find((p) => p.userId === q.where.agentId)?.open ?? 0;
      }),
    };
    const profileRepo = {
      // The service filters presence itself; every row here is on duty and seen now.
      find: jest.fn(async (q: { where: { userId: { _value: number[] } } }) => {
        const asked = (q.where.userId as unknown as { _value: number[] })._value;
        return profiles
          .filter((p) => asked.includes(p.userId))
          .map((p) => ({
            tenantId: 1,
            userId: p.userId,
            status: 'online',
            maxConcurrent: p.maxConcurrent ?? 5,
            lastSeen: FRESH(),
          }));
      }),
    };
    const userRepo = {
      find: jest.fn(async (q: { where: { id: { _value: number[] } } }) => {
        const asked = (q.where.id as unknown as { _value: number[] })._value;
        return staff
          .filter((s) => asked.includes(s.id))
          .map((s) => ({ id: s.id, region: s.region ?? null, status: s.status ?? 'active' }));
      }),
    };
    const svc = new AgentAlertService(
      alertRepo as never,
      { find: jest.fn(async () => [{ id: 3, tenantId: 1, code: 'consult' }]) } as never,
      { find: jest.fn(async () => staff.map((s) => ({ userId: s.id, jobLabelId: 3 }))) } as never,
      profileRepo as never,
      assignmentRepo as never,
      { subscribe: jest.fn() } as never,
      { get: jest.fn(() => undefined) } as never,
      { send: jest.fn() } as never,
      userRepo as never,
    );
    return { svc, saved, alertRepo, assignmentRepo };
  }

  const base = { tenantId: 1, conversationId: 42, reason: 'user_request', targetUserIds: [9], issueLabel: 'consult' };
  const asTarget = (h: { saved: Array<Partial<AgentAlert>> }) => h.saved[0].targetUserId;

  describe('only an active user is eligible', () => {
    const everyone = (status: string): Staff[] => [
      { id: 11, region: 'north', status },
      { id: 31, region: null, status },
    ];
    const onDuty: Profile[] = [{ userId: 11 }, { userId: 31 }];

    it.each(['suspended', 'invited'])('plain label search (no region): a %s user is not paged', async (status) => {
      const h = build(everyone(status), onDuty);
      await h.svc.onEscalation(base);
      expect(asTarget(h)).toBe(9); // the configured assignee, not the suspended/invited agent
    });

    it.each(['suspended', 'invited'])('regional ladder: a %s user is not paged, in the region or nationwide', async (status) => {
      const h = build(everyone(status), onDuty);
      await h.svc.onEscalation({ ...base, supportRegion: 'north' });
      expect(asTarget(h)).toBe(9);
    });

    it('a status nobody has (the old "inactive" check) is not a pass either', async () => {
      const h = build([{ id: 11, status: 'inactive' }], [{ userId: 11 }]);
      await h.svc.onEscalation(base);
      expect(asTarget(h)).toBe(9);
    });

    it('an active user is paged in both branches', async () => {
      const plain = build([{ id: 11, region: 'north' }], [{ userId: 11 }]);
      await plain.svc.onEscalation(base);
      expect(asTarget(plain)).toBe(11);

      const regional = build([{ id: 11, region: 'north' }], [{ userId: 11 }]);
      await regional.svc.onEscalation({ ...base, supportRegion: 'north' });
      expect(asTarget(regional)).toBe(11);
    });

    it('skips the suspended agent and takes the active one, however they are ordered', async () => {
      const h = build(
        [
          { id: 11, status: 'suspended' },
          { id: 12, status: 'invited' },
          { id: 13, status: 'active' },
        ],
        [{ userId: 11 }, { userId: 12 }, { userId: 13, open: 4 }],
      );
      await h.svc.onEscalation(base);
      expect(asTarget(h)).toBe(13);
    });

    it('fences the user lookup to the tenant', async () => {
      const h = build([{ id: 11 }], [{ userId: 11 }]);
      await h.svc.onEscalation(base);
      const userRepo = (h.svc as unknown as { userRepo: { find: jest.Mock } }).userRepo;
      expect(userRepo.find.mock.calls[0][0].where.tenantId).toBe(1);
    });
  });

  describe('load = open conversations + pending alerts', () => {
    const staff: Staff[] = [{ id: 11 }, { id: 12 }, { id: 13 }];

    it('picks the person with the fewest open conversations', async () => {
      const h = build(staff, [
        { userId: 11, open: 3 },
        { userId: 12, open: 1 },
        { userId: 13, open: 2 },
      ]);
      await h.svc.onEscalation(base);
      expect(asTarget(h)).toBe(12);
    });

    it('counts alerts already addressed to someone, so a burst does not all land on one agent', async () => {
      // 11 and 12 hold nothing, but 11 already has two alerts nobody has opened yet.
      const h = build(staff, [
        { userId: 11, open: 0, pending: 2 },
        { userId: 12, open: 0, pending: 0 },
        { userId: 13, open: 1, pending: 0 },
      ]);
      await h.svc.onEscalation(base);
      expect(asTarget(h)).toBe(12);
    });

    it('adds the two: 1 open + 0 pending ties 0 open + 1 pending, and the lower id wins', async () => {
      const h = build(staff, [
        { userId: 12, open: 1, pending: 0 },
        { userId: 11, open: 0, pending: 1 },
      ]);
      await h.svc.onEscalation(base);
      expect(asTarget(h)).toBe(11);
    });

    it('a pending alert does not count against the concurrency cap, only against the ranking', async () => {
      const h = build([{ id: 11 }], [{ userId: 11, maxConcurrent: 1, open: 0, pending: 3 }]);
      await h.svc.onEscalation(base);
      expect(asTarget(h)).toBe(11);
    });

    it('skips an agent at the cap, however light their alert queue', async () => {
      const h = build(staff, [
        { userId: 11, maxConcurrent: 2, open: 2, pending: 0 },
        { userId: 12, maxConcurrent: 5, open: 4, pending: 3 },
      ]);
      await h.svc.onEscalation(base);
      expect(asTarget(h)).toBe(12);
    });

    it('asks the alert table about this tenant and still-new alerts only', async () => {
      const h = build([{ id: 11 }], [{ userId: 11 }]);
      await h.svc.onEscalation(base);
      expect(h.alertRepo.count).toHaveBeenCalledWith({ where: { tenantId: 1, targetUserId: 11, status: 'new' } });
    });
  });

  describe('deterministic choice', () => {
    it('equal load: the lowest user id, not the first profile the database returned', async () => {
      const staff: Staff[] = [{ id: 31 }, { id: 12 }, { id: 21 }];
      for (const order of [
        [31, 12, 21],
        [12, 21, 31],
        [21, 31, 12],
      ]) {
        const h = build(
          staff,
          order.map((userId) => ({ userId, open: 2 })),
        );
        await h.svc.onEscalation(base);
        expect(asTarget(h)).toBe(12);
      }
    });

    it('the same inputs page the same person every time', async () => {
      const picks = new Set<number | null | undefined>();
      for (let i = 0; i < 5; i += 1) {
        const h = build([{ id: 14 }, { id: 13 }], [{ userId: 14 }, { userId: 13 }]);
        await h.svc.onEscalation(base);
        picks.add(asTarget(h));
      }
      expect([...picks]).toEqual([13]);
    });

    it('the regional ladder uses the same load and tie-break inside each round', async () => {
      const h = build(
        [
          { id: 22, region: 'south' },
          { id: 21, region: 'south' },
          { id: 31, region: null },
        ],
        [
          { userId: 22, open: 0, pending: 1 },
          { userId: 21, open: 1, pending: 0 },
          { userId: 31, open: 0, pending: 0 },
        ],
      );
      await h.svc.onEscalation({ ...base, supportRegion: 'south' });
      // 21 and 22 tie at load 1 → 21; the idle nationwide agent is only the second round.
      expect(asTarget(h)).toBe(21);
    });
  });
});
