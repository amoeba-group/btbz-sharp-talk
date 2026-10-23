import { AlertCenterService } from './alert-center.service';
import { AgentAlert } from './entity/agent-alert.entity';

/**
 * Alarm center (PLN-261024-Alarm-Center-Assignee-Region-Routing). Ids are
 * strings like TypeORM's BIGINT PKs; the per-agent rows of one escalation share
 * an event key and fold into one alarm.
 */
const row = (o: Partial<AgentAlert>): AgentAlert =>
  ({
    tenantId: 4,
    sessionId: '900',
    reason: 'low_confidence',
    preview: 'Hỏi về đối soát',
    status: 'new',
    ackedBy: null,
    ackedAt: null,
    eventKey: null,
    ruleName: null,
    consultCategory: null,
    createdAt: new Date('2026-10-24T01:00:00Z'),
    ...o,
  }) as unknown as AgentAlert;

function build(rows: AgentAlert[], opts: { reads?: string[]; settings?: object | null } = {}) {
  const readInsert = jest.fn();
  const qb = { insert: () => qb, into: () => qb, values: (v: object) => (readInsert(v), qb), orIgnore: () => qb, execute: jest.fn() };
  const alertRepo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where }: { where: { id: number; tenantId: number } }) =>
      rows.find((r) => String(r.id) === String(where.id) && r.tenantId === where.tenantId) ?? null,
    ),
  };
  const readRepo = {
    find: jest.fn(async () => (opts.reads ?? []).map((alertId) => ({ alertId }))),
    createQueryBuilder: () => qb,
  };
  const saved: object[] = [];
  const settingsRepo = {
    findOne: jest.fn(async () => opts.settings ?? null),
    upsert: jest.fn(async (x: object, keys: string[]) => (saved.push({ ...x, keys }), undefined)),
  };
  const userRepo = {
    find: jest.fn(async () => [
      { id: '28', name: 'Huy Nguyen', email: 'huy@x' },
      { id: '29', name: null, email: 'nguyen@x' },
    ]),
  };
  const sessionRepo = {
    find: jest.fn(async () => [{ id: '900', identityAttributes: { hotel_name: 'Lá Hotel Quận 10', region: 'south' } }]),
  };
  const svc = new AlertCenterService(alertRepo as never, readRepo as never, settingsRepo as never, userRepo as never, sessionRepo as never);
  return { svc, readInsert, saved, alertRepo };
}

describe('AlertCenterService (PLN-261024)', () => {
  const group = [
    row({ id: '11' as never, conversationId: 30 as never, targetUserId: '28' as never, eventKey: 'e1', ruleName: 'CS_South', consultCategory: 'cs' }),
    row({ id: '12' as never, conversationId: 30 as never, targetUserId: '29' as never, eventKey: 'e1', ruleName: 'CS_South', consultCategory: 'cs' }),
    row({ id: '10' as never, conversationId: 31 as never, targetUserId: null, sessionId: null }),
  ];

  it('folds one escalation into one alarm with its assignees, rule, category and hotel; broadcast is its own alarm', async () => {
    const { svc } = build(group);
    const feed = await svc.feed(4, 28);
    expect(feed.map((v) => v.id)).toEqual(['11', '10']);
    expect(feed[0]).toMatchObject({
      conversationId: '30',
      assignees: [
        { id: '28', name: 'Huy Nguyen' },
        { id: '29', name: 'nguyen@x' },
      ],
      broadcast: false,
      assignedToMe: true,
      canAck: true,
      ruleName: 'CS_South',
      consultCategory: 'cs',
      hotel: 'Lá Hotel Quận 10',
      region: 'south',
    });
    expect(feed[1]).toMatchObject({ broadcast: true, assignees: [], canAck: true, assignedToMe: false, hotel: null });
  });

  it('another agent sees the alarm (D1) but cannot stop the page; read state is per user', async () => {
    const { svc } = build(group, { reads: ['11'] });
    const [mine, bc] = await svc.feed(4, 55);
    expect(mine).toMatchObject({ assignedToMe: false, canAck: false, readByMe: true });
    expect(bc).toMatchObject({ canAck: true, readByMe: false });
  });

  it('center filters by scope and status and pages over folded alarms', async () => {
    const rows = [...group, row({ id: '9' as never, conversationId: 32 as never, targetUserId: '28' as never, status: 'acked', ackedBy: '28' as never, ackedAt: new Date() })];
    const { svc } = build(rows);
    expect((await svc.center(4, 28, { scope: 'mine' }, 1, 20)).items.map((v) => v.id)).toEqual(['11', '9']);
    expect((await svc.center(4, 28, { scope: 'broadcast' }, 1, 20)).items.map((v) => v.id)).toEqual(['10']);
    const acked = await svc.center(4, 28, { status: 'acked' }, 1, 20);
    expect(acked.items[0]).toMatchObject({ id: '9', status: 'acked', ackedBy: { id: '28', name: 'Huy Nguyen' }, readByMe: true });
    const page2 = await svc.center(4, 28, {}, 2, 2);
    expect(page2).toMatchObject({ total: 3 });
    expect(page2.items.map((v) => v.id)).toEqual(['9']);
  });

  it('markRead records for the caller only and refuses another tenant (404)', async () => {
    const { svc, readInsert } = build(group);
    await svc.markRead(4, 55, 11);
    expect(readInsert).toHaveBeenCalledWith({ tenantId: 4, alertId: 11, userId: 55 });
    await expect(svc.markRead(5, 55, 11)).rejects.toMatchObject({ errorCode: 'E5002' });
  });

  it('settings default when unset and save only known popup values', async () => {
    const { svc, saved } = build([]);
    await expect(svc.settings(4, 28)).resolves.toEqual({ popup: 'all', sound: true, desktop: false, email: true });
    await expect(svc.saveSettings(4, 28, { popup: 'mine', email: false })).resolves.toEqual({ popup: 'mine', sound: true, desktop: false, email: false });
    expect(saved[0]).toMatchObject({ userId: 28, tenantId: 4, popup: 'mine', email: 0, sound: 1, keys: ['userId'] });
    await expect(svc.saveSettings(4, 28, { popup: 'bogus' as never })).resolves.toMatchObject({ popup: 'all' });
  });
});
