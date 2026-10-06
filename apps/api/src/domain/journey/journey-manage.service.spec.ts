import { FindOperator } from 'typeorm';
import { DEFAULT_STAGES, JourneyManageService } from './journey-manage.service';

/**
 * Customer journey management (PLN-261006 P2~P4): stages seed as 5A, a stage
 * change is one audit row, nothing crosses tenants, the board shows every
 * group (unstaged ones included), and the timeline never exposes payloads.
 */
describe('JourneyManageService', () => {
  /** Unwrap In([...]) / Not(x) / IsNull() / LessThan(x) the way the repo would. */
  const match = (cond: unknown, value: unknown): boolean => {
    if (cond instanceof FindOperator) {
      const op = cond as FindOperator<unknown>;
      switch (op.type) {
        case 'in':
          return (op.value as unknown[]).map(String).includes(String(value));
        case 'not':
          return !match(op.value, value);
        case 'isNull':
          return value == null;
        case 'lessThan':
          return value != null && (value as Date) < (op.value as Date);
        default:
          return true;
      }
    }
    return String(cond) === String(value);
  };
  const where = <T extends Record<string, unknown>>(rows: T[], w: Record<string, unknown> = {}) =>
    rows.filter((r) => Object.entries(w).every(([k, v]) => match(v, r[k])));

  /** A tiny in-memory repository: enough of find/findOne/count/save/delete. */
  function repo<T extends Record<string, unknown>>(rows: T[]) {
    let next = 1000;
    return {
      rows,
      find: jest.fn(async (q: { where?: Record<string, unknown> } = {}) => where(rows, q.where)),
      findOne: jest.fn(async (q: { where: Record<string, unknown> }) => where(rows, q.where)[0] ?? null),
      count: jest.fn(async (q: { where: Record<string, unknown> }) => where(rows, q.where).length),
      create: jest.fn((v: Partial<T>) => ({ ...v }) as T),
      save: jest.fn(async (v: T | T[]) => {
        const list = Array.isArray(v) ? v : [v];
        for (const r of list) {
          if (r.id == null) (r as Record<string, unknown>).id = next++;
          if (!rows.includes(r)) rows.push(r);
        }
        return v;
      }),
      delete: jest.fn(async (w: Record<string, unknown>) => {
        const gone = where(rows, w);
        for (const g of gone) rows.splice(rows.indexOf(g), 1);
        return { affected: gone.length };
      }),
    };
  }

  function build(seed: {
    stages?: Array<Record<string, unknown>>;
    journeys?: Array<Record<string, unknown>>;
    tasks?: Array<Record<string, unknown>>;
    groups?: Array<Record<string, unknown>>;
    members?: Array<Record<string, unknown>>;
    convs?: Array<Record<string, unknown>>;
    cjm?: Array<Record<string, unknown>>;
    users?: Array<Record<string, unknown>>;
  } = {}) {
    const stageRepo = repo(seed.stages ?? []);
    const journeyRepo = repo(seed.journeys ?? []);
    const taskRepo = repo(seed.tasks ?? []);
    const groupRepo = repo(seed.groups ?? [{ id: 50, tenantId: 1, kind: 'timeline', title: '김OO' }]);
    const memberRepo = repo(seed.members ?? []);
    const convRepo = repo(seed.convs ?? []);
    const cjmRepo = repo(seed.cjm ?? []);
    const userRepo = repo(seed.users ?? [{ id: 7, tenantId: 1, name: '상담원', email: 'a@x', status: 'active' }]);
    const qb = {
      innerJoin: () => qb,
      where: () => qb,
      setParameter: () => qb,
      select: () => qb,
      addSelect: () => qb,
      groupBy: () => qb,
      getRawMany: async () => [],
    };
    const msgRepo = { createQueryBuilder: () => qb };
    const audit = { write: jest.fn(async () => ({})), list: jest.fn(async () => ({ items: [], total: 0 })) };
    const svc = new JourneyManageService(
      stageRepo as never,
      journeyRepo as never,
      taskRepo as never,
      groupRepo as never,
      memberRepo as never,
      convRepo as never,
      msgRepo as never,
      cjmRepo as never,
      userRepo as never,
      audit as never,
    );
    return { svc, stageRepo, journeyRepo, taskRepo, audit };
  }

  describe('stages', () => {
    it('seeds Kotler 5A on first read, in order', async () => {
      const h = build();
      const rows = await h.svc.stages(1);
      expect(h.stageRepo.rows.map((r) => r.key)).toEqual(DEFAULT_STAGES.map((s) => s.key));
      expect(rows).toHaveLength(5);
    });

    it('refuses dropping a stage a journey still sits in (E5094)', async () => {
      const h = build({ journeys: [{ id: 1, tenantId: 1, groupId: 50, stageKey: 'ask' }] });
      await h.svc.stages(1);
      await expect(
        h.svc.saveStages(1, 7, [{ key: 'aware', label: { EN: 'Aware' } }]),
      ).rejects.toMatchObject({ errorCode: 'E5094' });
    });

    it('drops an unused stage, renames and reorders the rest', async () => {
      const h = build();
      await h.svc.stages(1);
      await h.svc.saveStages(1, 7, [
        { key: 'ask', label: { KO: '문의 접수' } },
        { key: 'aware', label: { EN: 'Aware' } },
      ]);
      const keys = h.stageRepo.rows.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)).map((r) => r.key);
      expect(keys).toEqual(['ask', 'aware']);
      expect(h.stageRepo.rows.find((r) => r.key === 'ask')?.label).toEqual({ KO: '문의 접수' });
    });

    it('refuses duplicate keys and nameless stages', async () => {
      const h = build();
      await expect(
        h.svc.saveStages(1, 7, [
          { key: 'a', label: { EN: 'A' } },
          { key: 'a', label: { EN: 'B' } },
        ]),
      ).rejects.toThrow();
      await expect(h.svc.saveStages(1, 7, [{ key: 'a', label: { EN: '  ' } }])).rejects.toThrow();
    });
  });

  describe('stage and owner', () => {
    it('creates the journey on first stage and writes one audit row from → to', async () => {
      const h = build();
      await h.svc.setStage(1, 50, 7, 'ask');
      expect(h.journeyRepo.rows[0]).toMatchObject({ groupId: 50, stageKey: 'ask' });
      expect(h.audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'journey.stage_changed', target: 'group:50', metadata: { from: null, to: 'ask' } }),
      );
    });

    it('a no-op stage change writes no audit row', async () => {
      const h = build({ journeys: [{ id: 1, tenantId: 1, groupId: 50, stageKey: 'ask' }] });
      await h.svc.setStage(1, 50, 7, 'ask');
      expect(h.audit.write).not.toHaveBeenCalled();
    });

    it('refuses a stage the tenant does not have (E5093)', async () => {
      const h = build();
      await expect(h.svc.setStage(1, 50, 7, 'purchase')).rejects.toMatchObject({ errorCode: 'E5093' });
    });

    it("another tenant's group is not found", async () => {
      const h = build();
      await expect(h.svc.setStage(2, 50, 7, 'ask')).rejects.toThrow();
      expect(h.journeyRepo.rows).toHaveLength(0);
    });

    it("refuses an owner from another tenant", async () => {
      const h = build({ users: [{ id: 9, tenantId: 2, name: 'x', email: 'x', status: 'active' }] });
      await expect(h.svc.setOwner(1, 50, 7, 9)).rejects.toThrow();
    });
  });

  describe('tasks', () => {
    it('adds a task (creating the journey) and records where it came from', async () => {
      const h = build();
      await h.svc.addTask(1, 50, 7, { title: '  정산  일정 안내 ', dueAt: '2026-10-08', source: 'report', reportId: 3 });
      expect(h.taskRepo.rows[0]).toMatchObject({ title: '정산 일정 안내', dueAt: '2026-10-08', source: 'report', reportId: 3 });
    });

    it('done toggles the timestamp; reopening clears it', async () => {
      const h = build({ tasks: [{ id: 5, tenantId: 1, journeyId: 1, title: 't', doneAt: null }] });
      const done = await h.svc.updateTask(1, 5, { done: true });
      expect(done.doneAt).toBeInstanceOf(Date);
      const reopened = await h.svc.updateTask(1, 5, { done: false });
      expect(reopened.doneAt).toBeNull();
    });

    it("another tenant's task is not found", async () => {
      const h = build({ tasks: [{ id: 5, tenantId: 2, journeyId: 1, title: 't', doneAt: null }] });
      await expect(h.svc.deleteTask(1, 5)).rejects.toThrow();
      expect(h.taskRepo.rows).toHaveLength(1);
    });
  });

  describe('board', () => {
    it('shows every group, unstaged ones included, with open and overdue counts', async () => {
      const h = build({
        groups: [
          { id: 50, tenantId: 1, kind: 'timeline', title: 'A' },
          { id: 51, tenantId: 1, kind: 'project', title: 'B' },
        ],
        journeys: [{ id: 1, tenantId: 1, groupId: 50, stageKey: 'ask', ownerUserId: 7 }],
        tasks: [
          { id: 1, tenantId: 1, journeyId: 1, title: 'old', dueAt: '2000-01-01', doneAt: null },
          { id: 2, tenantId: 1, journeyId: 1, title: 'new', dueAt: '2999-01-01', doneAt: null },
          { id: 3, tenantId: 1, journeyId: 1, title: 'done', dueAt: '2000-01-01', doneAt: new Date() },
        ],
      });
      const { cards } = await h.svc.board(1);
      const a = cards.find((c) => c.groupId === 50)!;
      expect(a).toMatchObject({ stageKey: 'ask', openTasks: 2, overdueTasks: 1, ownerName: '상담원' });
      expect(cards.find((c) => c.groupId === 51)?.stageKey).toBeNull();
    });

    it('a journey in a since-removed stage shows as unstaged rather than vanishing', async () => {
      const h = build({ journeys: [{ id: 1, tenantId: 1, groupId: 50, stageKey: 'gone' }] });
      const { cards } = await h.svc.board(1);
      expect(cards[0].stageKey).toBeNull();
    });

    it('filters overdue-only', async () => {
      const h = build({
        groups: [
          { id: 50, tenantId: 1, kind: 'timeline', title: 'A' },
          { id: 51, tenantId: 1, kind: 'timeline', title: 'B' },
        ],
        journeys: [{ id: 1, tenantId: 1, groupId: 50, stageKey: 'ask' }],
        tasks: [{ id: 1, tenantId: 1, journeyId: 1, title: 'old', dueAt: '2000-01-01', doneAt: null }],
      });
      const { cards } = await h.svc.board(1, { overdueOnly: true });
      expect(cards.map((c) => c.groupId)).toEqual([50]);
    });
  });

  describe('timeline', () => {
    it('merges cjm events and conversation start/end/rating, newest first, without chat_message noise', async () => {
      const h = build({
        members: [{ id: 1, tenantId: 1, groupId: 50, sessionId: 10 }],
        cjm: [
          { id: 1, tenantId: 1, sessionId: 10, stage: 'Awareness', eventType: 'session_start', payload: { secret: 1 }, createdAt: new Date('2026-10-01T00:00:00Z') },
          { id: 2, tenantId: 1, sessionId: 10, stage: 'Inquiry', eventType: 'chat_message', payload: null, createdAt: new Date('2026-10-01T00:05:00Z') },
          { id: 3, tenantId: 1, sessionId: 10, stage: 'Purchase', eventType: 'order_created', payload: null, createdAt: new Date('2026-10-03T00:00:00Z') },
        ],
        convs: [
          {
            id: 100, tenantId: 1, sessionId: 10, channel: 'kakao',
            createdAt: new Date('2026-10-01T00:01:00Z'), endedAt: new Date('2026-10-02T00:00:00Z'),
            csatRating: 5, csatRatedAt: new Date('2026-10-02T00:01:00Z'),
          },
        ],
      });
      const { items } = await h.svc.timeline(1, 50);
      expect(items.map((i) => i.eventType ?? i.kind)).toEqual([
        'order_created',
        'csat',
        'conversation_ended',
        'conversation_started',
        'session_start',
      ]);
      expect(JSON.stringify(items)).not.toContain('secret');
    });
  });
});
