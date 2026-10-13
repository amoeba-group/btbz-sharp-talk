import { FindOperator } from 'typeorm';
import { AgentAlertService, alertSubjectPrefix } from './agent-alert.service';
import type { AgentAlert } from './entity/agent-alert.entity';
import type { RoutingPolicy } from '../ai-engine/handoff-router.service';
import { fakeRepo } from './testing/fake-table';
import type { Row } from './testing/fake-table';

/**
 * Routing extras on the alert fan-out (PLN-261012 SG-63, SG-64, SG-65, SG-67): the strict
 * regional ladder, the region fence on the alarm feed, the de-dupe bypass a re-route needs,
 * closing alerts when a conversation is settled, the "UNCLAIMED" re-page, and re-pointing
 * alerts when a staff member changes region. Rows live in an in-memory table (testing/fake-table),
 * so what is asserted is what a console would actually see.
 */
interface Staff {
  id: number;
  region?: string | null;
  status?: string;
}

const NOW = Date.parse('2026-10-15T09:00:00.000Z');

function build(
  opts: {
    staff?: Staff[];
    online?: number[];
    alerts?: Row[];
    convs?: Row[];
    sessions?: Row[];
    policy?: Partial<RoutingPolicy>;
    env?: Record<string, string>;
  } = {},
) {
  const staff = opts.staff ?? [];
  const alerts = fakeRepo<Row>(opts.alerts ?? []);
  const convs = fakeRepo<Row>(opts.convs ?? []);
  const sessions = fakeRepo<Row>(opts.sessions ?? []);
  const inValues = (op: unknown) => (op as FindOperator<number[]>).value;
  const userRepo = {
    find: jest.fn(async (q: { where: { id: unknown } }) =>
      staff.filter((s) => inValues(q.where.id).includes(s.id)).map((s) => ({ id: s.id, region: s.region ?? null, status: s.status ?? 'active' })),
    ),
    findOne: jest.fn(async (q: { where: { id: number } }) => {
      const s = staff.find((x) => x.id === q.where.id);
      return s ? { id: s.id, region: s.region ?? null } : null;
    }),
  };
  const policy: RoutingPolicy = {
    configured: true,
    assigneeUserIds: [],
    regionEnabled: true,
    regionMode: 'prefer',
    widenAfterMinutes: null,
    slackByRegion: {},
    teams: [{ id: 'business', jobLabel: 'sales_admin', label: 'Business Support' }],
    unclaimedAlerts: true,
    ...opts.policy,
  };
  const mailer = { send: jest.fn() };
  const env: Record<string, string> = { ...opts.env };
  const svc = new AgentAlertService(
    alerts as never,
    { find: jest.fn(async (q: { where: { code: string } }) => [{ id: 3, tenantId: 1, code: q.where.code }]) } as never,
    { find: jest.fn(async () => staff.map((s) => ({ userId: s.id, jobLabelId: 3 }))) } as never,
    {
      find: jest.fn(async (q: { where: { userId: unknown } }) =>
        (opts.online ?? [])
          .filter((id) => inValues(q.where.userId).includes(id))
          .map((userId) => ({ tenantId: 1, userId, status: 'online', maxConcurrent: 5, lastSeen: new Date() })),
      ),
    } as never,
    { count: jest.fn(async () => 0) } as never,
    { subscribe: jest.fn() } as never,
    { get: jest.fn((k: string) => env[k]) } as never,
    mailer as never,
    userRepo as never,
    convs as never,
    sessions as never,
    { routingPolicy: jest.fn(async () => policy) } as never,
  );
  return { svc, alerts, convs, sessions, mailer, userRepo };
}

const base = { tenantId: 1, conversationId: 42, reason: 'user_request', issueLabel: 'consult' };
const newest = (h: { alerts: { table: Row[] } }) => h.alerts.table[h.alerts.table.length - 1];

describe('AgentAlertService — strict region ladder (SG-67)', () => {
  const STAFF: Staff[] = [
    { id: 11, region: 'north' },
    { id: 21, region: 'south' },
    { id: 31, region: null }, // nationwide
    { id: 41, region: 'north', status: 'suspended' },
  ];

  it('prefers the online agent of the hotel region, as in prefer mode', async () => {
    const h = build({ staff: STAFF, online: [11, 21, 31] });
    await h.svc.onEscalation({ ...base, supportRegion: 'north', regionMode: 'strict' });
    expect(newest(h)).toMatchObject({ targetUserId: 11, targetRegion: null });
  });

  it('then takes an online nationwide agent', async () => {
    const h = build({ staff: STAFF, online: [21, 31] });
    await h.svc.onEscalation({ ...base, supportRegion: 'north', regionMode: 'strict' });
    expect(newest(h)).toMatchObject({ targetUserId: 31 });
  });

  it('NEVER takes an agent of the other region: a region-scoped broadcast instead', async () => {
    const h = build({ staff: STAFF, online: [21] }); // only a south agent is online, the hotel is north
    await h.svc.onEscalation({ ...base, supportRegion: 'north', regionMode: 'strict', targetUserIds: [] });
    expect(newest(h)).toMatchObject({ targetUserId: null, targetRegion: 'north' });
  });

  it('skips a configured assignee of the other region, and takes the first one who fits', async () => {
    const h = build({ staff: STAFF, online: [] });
    await h.svc.onEscalation({ ...base, supportRegion: 'north', regionMode: 'strict', targetUserIds: [21, 31, 11] });
    // 21 is south (skipped); 31 is nationwide (fits) and comes before 11 in the configured order.
    expect(newest(h)).toMatchObject({ targetUserId: 31, targetRegion: null });
  });

  it('a configured assignee of the region is taken even when offline (the operator named them)', async () => {
    const h = build({ staff: STAFF, online: [] });
    await h.svc.onEscalation({ ...base, supportRegion: 'north', regionMode: 'strict', targetUserIds: [11] });
    expect(newest(h)).toMatchObject({ targetUserId: 11 });
  });

  it('a suspended assignee is never taken', async () => {
    const h = build({ staff: STAFF, online: [] });
    await h.svc.onEscalation({ ...base, supportRegion: 'north', regionMode: 'strict', targetUserIds: [41] });
    expect(newest(h)).toMatchObject({ targetUserId: null, targetRegion: 'north' });
  });

  it('prefer mode (and an absent mode) still falls back across regions — the switch is what changes it', async () => {
    const prefer = build({ staff: STAFF, online: [21] });
    await prefer.svc.onEscalation({ ...base, supportRegion: 'north', regionMode: 'prefer', targetUserIds: [21] });
    expect(newest(prefer)).toMatchObject({ targetUserId: 21, targetRegion: null });

    const absent = build({ staff: STAFF, online: [] });
    await absent.svc.onEscalation({ ...base, supportRegion: 'north', targetUserIds: [] });
    // Nobody to pick: the plain broadcast — visible to everyone, not scoped to the region.
    expect(newest(absent)).toMatchObject({ targetUserId: null, targetRegion: null });
  });

  it('strict mode without a region (guest, unmapped province) has nothing to scope by', async () => {
    const h = build({ staff: STAFF, online: [] });
    await h.svc.onEscalation({ ...base, regionMode: 'strict', targetUserIds: [21] });
    expect(newest(h)).toMatchObject({ targetUserId: 21, targetRegion: null });
  });

  it('a configured assignee list is not consulted without the user repository', async () => {
    const h = build({ staff: STAFF });
    (h.svc as unknown as { userRepo: unknown }).userRepo = undefined;
    await h.svc.onEscalation({ ...base, supportRegion: 'north', regionMode: 'strict', targetUserIds: [21] });
    // Nobody can be vouched for, so strict mode will not guess: region-scoped broadcast.
    expect(newest(h)).toMatchObject({ targetUserId: null, targetRegion: 'north' });
  });
});

describe('AgentAlertService.list — region fence on the feed (SG-67)', () => {
  const rows = (): Row[] => [
    { id: 1, tenantId: 1, status: 'new', targetUserId: null, targetRegion: null }, // plain broadcast
    { id: 2, tenantId: 1, status: 'new', targetUserId: null, targetRegion: 'north' }, // north team
    { id: 3, tenantId: 1, status: 'new', targetUserId: null, targetRegion: 'south' }, // south team
    { id: 4, tenantId: 1, status: 'new', targetUserId: 21, targetRegion: null }, // addressed to the south agent
    { id: 5, tenantId: 1, status: 'new', targetUserId: 11, targetRegion: null }, // addressed to the north agent
    { id: 6, tenantId: 2, status: 'new', targetUserId: null, targetRegion: 'south' }, // another tenant
    { id: 7, tenantId: 1, status: 'acked', targetUserId: null, targetRegion: null },
  ];
  const staff: Staff[] = [
    { id: 11, region: 'north' },
    { id: 21, region: 'south' },
    { id: 31, region: null },
  ];
  const ids = (list: AgentAlert[]) => list.map((a) => Number(a.id)).sort();

  it('a south agent sees plain broadcasts, the south team broadcast and their own — not the north one', async () => {
    const h = build({ staff, alerts: rows() });
    expect(ids(await h.svc.list('new', 21, 1))).toEqual([1, 3, 4]);
  });

  it('a north agent sees the north side only', async () => {
    const h = build({ staff, alerts: rows() });
    expect(ids(await h.svc.list('new', 11, 1))).toEqual([1, 2, 5]);
  });

  it('nationwide staff (no region) see every broadcast, region-scoped or not', async () => {
    const h = build({ staff, alerts: rows() });
    expect(ids(await h.svc.list('new', 31, 1))).toEqual([1, 2, 3]);
  });

  it('never lists another tenant row, scoped or not', async () => {
    const h = build({ staff, alerts: rows() });
    expect(ids(await h.svc.list('new', 31, 1))).not.toContain(6);
  });

  it('the feed carries the conversation team, region, hint and partner on each alert', async () => {
    const h = build({
      staff,
      alerts: [{ id: 9, tenantId: 1, conversationId: 42, status: 'new', targetUserId: null, targetRegion: null, reason: 'user_request' }],
      convs: [
        {
          id: 42,
          tenantId: 1,
          sessionId: 5,
          status: 'waiting',
          supportType: 'business',
          supportRegion: null,
          supportRegionHint: 'Tp Quy Nhơn',
          escalatedAt: new Date(NOW),
        },
      ],
      sessions: [{ id: 5, identityClaims: { signed: true, hotelSn: '1721', hotelName: 'Sao Mai', role: 'manager' } }],
    });
    const [item] = await h.svc.listWithContext('new', 31, 1);
    expect(item.view).toMatchObject({
      supportType: 'business',
      supportRegion: null,
      supportRegionHint: 'Tp Quy Nhơn',
      conversationStatus: 'waiting',
      partner: { hotelName: 'Sao Mai', hotelSn: '1721', role: 'manager' },
    });
  });

  it('an unsigned identity gives no partner, and a missing conversation gives no view', async () => {
    const h = build({
      staff,
      alerts: [
        { id: 9, tenantId: 1, conversationId: 42, status: 'new', targetUserId: null, targetRegion: null },
        { id: 10, tenantId: 1, conversationId: 99, status: 'new', targetUserId: null, targetRegion: null },
      ],
      convs: [{ id: 42, tenantId: 1, sessionId: 5, status: 'waiting' }],
      sessions: [{ id: 5, identityClaims: { signed: false, hotelSn: '1721', role: 'manager' } }],
    });
    const items = await h.svc.listWithContext('new', 31, 1);
    expect(items.find((i) => Number(i.alert.id) === 9)?.view?.partner).toBeNull();
    expect(items.find((i) => Number(i.alert.id) === 10)?.view).toBeNull();
  });
});

describe('AgentAlertService — the de-dupe, its bypass, and settling (SG-64, REQ D-20)', () => {
  it('a repeated escalation for the same reason while one is open creates nothing (the at-least-once guard)', async () => {
    const h = build({ staff: [{ id: 11 }], online: [11] });
    await h.svc.onEscalation(base);
    await h.svc.onEscalation(base);
    expect(h.alerts.table).toHaveLength(1);
  });

  it('the re-route bypass settles the old alerts and raises a fresh one for the NEW target', async () => {
    const h = build({ staff: [{ id: 11 }, { id: 22 }], online: [22] });
    // The old alert is pinned to agent 11 and still open.
    h.alerts.table.push({ id: 5, tenantId: 1, conversationId: 42, reason: 'user_request', status: 'new', targetUserId: 11, targetRegion: null });

    const raised = await h.svc.raise({ ...base, reason: 'rerouted', issueLabel: 'sales_admin' }, { supersede: true });

    expect(raised?.targetUserId).toBe(22);
    expect(h.alerts.table.find((a) => a.id === 5)?.status).toBe('superseded');
    expect(h.alerts.table.filter((a) => a.status === 'new')).toHaveLength(1);
    // Agent 11 no longer sees it; agent 22 does.
    expect((await h.svc.list('new', 11, 1)).map((a) => a.id)).not.toContain(newest(h).id);
    expect((await h.svc.list('new', 22, 1)).map((a) => a.id)).toContain(newest(h).id);
  });

  it('WITHOUT the bypass the same re-route would be swallowed by the de-dupe', async () => {
    const h = build({ staff: [{ id: 11 }, { id: 22 }], online: [22] });
    h.alerts.table.push({ id: 5, tenantId: 1, conversationId: 42, reason: 'rerouted', status: 'new', targetUserId: 11, targetRegion: null });
    const raised = await h.svc.raise({ ...base, reason: 'rerouted', issueLabel: 'sales_admin' });
    expect(raised).toBeNull();
    expect(h.alerts.table).toHaveLength(1);
  });

  it('the bypass holds even when settling the old alerts fails: the fresh alert is still raised', async () => {
    const h = build({ staff: [{ id: 11 }, { id: 22 }], online: [22] });
    h.alerts.table.push({ id: 5, tenantId: 1, conversationId: 42, reason: 'rerouted', status: 'new', targetUserId: 11, targetRegion: null });
    h.alerts.update.mockRejectedValueOnce(new Error('db hiccup')); // settle swallows it and returns 0
    const raised = await h.svc.raise({ ...base, reason: 'rerouted', issueLabel: 'sales_admin' }, { supersede: true });
    expect(raised?.targetUserId).toBe(22);
    expect(h.alerts.table).toHaveLength(2);
  });

  it('settle closes only the conversation open alerts of that tenant, as acked by the claimant', async () => {
    const h = build({
      alerts: [
        { id: 1, tenantId: 1, conversationId: 42, status: 'new' },
        { id: 2, tenantId: 1, conversationId: 42, status: 'acked' },
        { id: 3, tenantId: 1, conversationId: 43, status: 'new' },
        { id: 4, tenantId: 2, conversationId: 42, status: 'new' },
      ],
    });
    const n = await h.svc.settle(1, 42, 'acked', 7);
    expect(n).toBe(1);
    expect(h.alerts.table.find((a) => a.id === 1)).toMatchObject({ status: 'acked', ackedBy: 7 });
    expect(h.alerts.table.find((a) => a.id === 3)?.status).toBe('new');
    expect(h.alerts.table.find((a) => a.id === 4)?.status).toBe('new');
  });

  it('settling as superseded sets no acknowledger', async () => {
    const h = build({ alerts: [{ id: 1, tenantId: 1, conversationId: 42, status: 'new' }] });
    await h.svc.settle(1, 42, 'superseded');
    expect(h.alerts.table[0]).toMatchObject({ status: 'superseded' });
    expect(h.alerts.table[0].ackedBy).toBeUndefined();
  });

  it('after a conversation is claimed (alerts settled), a LATER escalation of it pages again', async () => {
    const h = build({ staff: [{ id: 11 }], online: [11] });
    await h.svc.onEscalation(base);
    await h.svc.settle(1, 42, 'acked', 11); // an agent accepted
    await h.svc.onEscalation(base); // the thread was handed back and escalated again
    expect(h.alerts.table.filter((a) => a.status === 'new')).toHaveLength(1);
    expect(h.alerts.table).toHaveLength(2);
  });

  it('settle never throws, even when the update fails', async () => {
    const h = build({});
    h.alerts.update.mockRejectedValueOnce(new Error('db down'));
    await expect(h.svc.settle(1, 42, 'superseded')).resolves.toBe(0);
  });
});

describe('AgentAlertService.pageUnclaimed — the UNCLAIMED re-page (SG-63)', () => {
  const fetchMock = jest.fn(async () => ({ ok: true }));
  const realFetch = global.fetch;
  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  const conv = (over: Row = {}): never =>
    ({
      id: 42,
      tenantId: 1,
      sessionId: 5,
      status: 'waiting',
      supportType: 'business',
      supportRegion: 'north',
      supportRegionHint: null,
      ...over,
    }) as never;
  const sessions = [{ id: 5, identityClaims: { signed: true, hotelSn: '1721', hotelName: 'Sao Mai', role: 'manager' } }];
  const page = { attempt: 2, maxPages: 3, waitedMin: 10, scopeRegion: null as string | null, crossRegion: true };
  const slackText = () => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body).text as string;

  it('raises a broadcast alert, supersedes the targeted one, and keeps the preview', async () => {
    const h = build({
      sessions,
      env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/global' },
      alerts: [{ id: 5, tenantId: 1, conversationId: 42, reason: 'user_request', status: 'new', targetUserId: 11, targetRegion: null, preview: 'Hoa hồng?' }],
    });
    const alert = await h.svc.pageUnclaimed(conv(), page);

    expect(alert).toMatchObject({ reason: 'unclaimed', targetUserId: null, targetRegion: null, preview: 'Hoa hồng?', status: 'new' });
    expect(h.alerts.table.find((a) => a.id === 5)?.status).toBe('superseded');
    // The addressed agent never saw their alert as broadcast; now the feed shows the new one to anyone.
    expect((await h.svc.list('new', 99, 1)).map((a) => a.reason)).toEqual(['unclaimed']);
  });

  it('posts UNCLAIMED to Slack and email with the wait, team, region and partner lines', async () => {
    const h = build({
      sessions,
      env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/global', ALERT_EMAIL_TO: 'ops@example.com' },
      alerts: [{ id: 5, tenantId: 1, conversationId: 42, reason: 'user_request', status: 'new', preview: 'Hoa hồng?' }],
    });
    await h.svc.pageUnclaimed(conv(), page);

    expect(slackText()).toContain('UNCLAIMED');
    expect(slackText()).toContain('Waiting: 10 min (reminder 2 of 3)');
    expect(slackText()).toContain('Team: Business Support');
    expect(slackText()).toContain('Region: North');
    expect(slackText()).toContain('Partner: Sao Mai (1721) · manager');
    expect(slackText()).toContain('> Hoa hồng?');
    // Neutral product prefix by default (w3c, ops-manual finding 17); an operator sets ALERT_EMAIL_SUBJECT_PREFIX.
    expect(h.mailer.send.mock.calls[0][0]).toMatchObject({ to: 'ops@example.com', subject: '[SharpTalk] UNCLAIMED — conversation #42' });
  });

  it("uses the operator's ALERT_EMAIL_SUBJECT_PREFIX for the subject (an IVY deployment keeps its old filter)", async () => {
    const h = build({
      sessions,
      env: { ALERT_EMAIL_TO: 'ops@example.com', ALERT_EMAIL_SUBJECT_PREFIX: '[IVY Chat]' },
      alerts: [{ id: 5, tenantId: 1, conversationId: 42, reason: 'user_request', status: 'new', preview: 'Hoa hồng?' }],
    });
    await h.svc.pageUnclaimed(conv(), page);
    expect(h.mailer.send.mock.calls[0][0]).toMatchObject({ subject: '[IVY Chat] UNCLAIMED — conversation #42' });
  });

  it('names a partner-data outage in the alert text instead of a knowledge miss (w3c, ops-manual finding 5)', () => {
    const h = build({ sessions, env: {} });
    const text = h.svc.summary({ id: 9, conversationId: 42, reason: 'partner_unavailable', preview: 'Giá hôm nay?' } as never, {});
    expect(text).toContain('Partner data unavailable');
    expect(text).not.toContain('knowledge base');
    expect(h.svc.summary({ id: 9, conversationId: 42, reason: 'partner_unverified', preview: null } as never, {})).toContain(
      'could not be verified',
    );
  });

  it('shows the unmapped province instead of a region when the table did not list it', async () => {
    const h = build({ sessions, env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/global' } });
    await h.svc.pageUnclaimed(conv({ supportRegion: null, supportRegionHint: 'Tp Quy Nhơn' }), page);
    expect(slackText()).toContain('Region: ? (unmapped: Tp Quy Nhơn)');
  });

  it('a strict-mode page scoped to the region is a region-scoped broadcast', async () => {
    const h = build({ sessions });
    const alert = await h.svc.pageUnclaimed(conv(), { ...page, scopeRegion: 'north', crossRegion: false });
    expect(alert).toMatchObject({ targetUserId: null, targetRegion: 'north' });
  });

  it('uses the hotel region webhook when the tenant set one, and the global one otherwise', async () => {
    const regional = build({
      sessions,
      env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/global' },
      policy: { slackByRegion: { north: 'https://hooks.slack.com/services/T/B/north' } },
    });
    await regional.svc.pageUnclaimed(conv(), { ...page, crossRegion: false, scopeRegion: 'north' });
    expect(fetchMock.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(['https://hooks.slack.com/services/T/B/north']);

    fetchMock.mockClear();
    const none = build({ sessions, env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/global' } });
    await none.svc.pageUnclaimed(conv(), page);
    expect(fetchMock.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(['https://hooks.slack.com/services/T/B/global']);
  });

  it('a widening (cross-region) page also reaches the OTHER team channel and the shared one', async () => {
    const h = build({
      sessions,
      env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/global' },
      policy: { slackByRegion: { north: 'https://hooks.slack.com/services/T/B/north', south: 'https://hooks.slack.com/services/T/B/south' } },
    });
    await h.svc.pageUnclaimed(conv(), { ...page, crossRegion: true, scopeRegion: null });
    expect(fetchMock.mock.calls.map((c) => (c as unknown as [string])[0]).sort()).toEqual([
      'https://hooks.slack.com/services/T/B/global',
      'https://hooks.slack.com/services/T/B/north',
      'https://hooks.slack.com/services/T/B/south',
    ]);
  });

  it('never throws: a failure is logged and null comes back', async () => {
    const h = build({ sessions });
    h.alerts.save.mockRejectedValueOnce(new Error('db down'));
    await expect(h.svc.pageUnclaimed(conv(), page)).resolves.toBeNull();
  });

  it('summary keeps the old text byte for byte when there is no unclaimed context', () => {
    const svc = Object.create(AgentAlertService.prototype) as AgentAlertService;
    const alert = { conversationId: 7, reason: 'user_request', preview: 'Hoa hồng?' } as AgentAlert;
    expect(svc.summary(alert, { teamLabel: 'Business Support' })).toBe(
      'Chat escalation — conversation #7\nReason: Customer asked for a human agent\nTeam: Business Support\n> Hoa hồng?',
    );
  });
});

describe('AgentAlertService.onUserRoutingChanged — a staff region/status change (SG-65, REQ D-20)', () => {
  const STAFF: Staff[] = [
    { id: 11, region: 'north' },
    { id: 12, region: 'north' },
    { id: 21, region: 'south' },
    { id: 31, region: null },
  ];
  const waiting = (id: number, region: string | null, over: Row = {}): Row => ({
    id,
    tenantId: 1,
    sessionId: 5,
    status: 'waiting',
    agentId: null,
    supportType: 'business',
    supportRegion: region,
    ...over,
  });
  const alertFor = (id: number, conversationId: number, userId: number): Row => ({
    id,
    tenantId: 1,
    conversationId,
    reason: 'user_request',
    status: 'new',
    targetUserId: userId,
    targetRegion: null,
  });

  it('re-points a pending alert for a north hotel away from an agent who moved to the south', async () => {
    const h = build({
      staff: [{ id: 11, region: 'south' }, { id: 12, region: 'north' }],
      online: [12],
      convs: [waiting(42, 'north')],
      alerts: [alertFor(1, 42, 11)],
    });
    await h.svc.onUserRoutingChanged({ tenantId: 1, userId: 11, region: 'south' });
    // Re-run without them: the other online north agent takes it.
    expect(h.alerts.table[0]).toMatchObject({ targetUserId: 12, status: 'new' });
  });

  it('falls to a broadcast when nobody else is eligible (region-scoped in strict mode)', async () => {
    const prefer = build({ staff: [{ id: 11, region: 'south' }], online: [], convs: [waiting(42, 'north')], alerts: [alertFor(1, 42, 11)] });
    await prefer.svc.onUserRoutingChanged({ tenantId: 1, userId: 11, region: 'south' });
    expect(prefer.alerts.table[0]).toMatchObject({ targetUserId: null, targetRegion: null });

    const strict = build({
      staff: [{ id: 11, region: 'south' }],
      online: [],
      policy: { regionMode: 'strict' },
      convs: [waiting(42, 'north')],
      alerts: [alertFor(1, 42, 11)],
    });
    await strict.svc.onUserRoutingChanged({ tenantId: 1, userId: 11, region: 'south' });
    expect(strict.alerts.table[0]).toMatchObject({ targetUserId: null, targetRegion: 'north' });
  });

  it('leaves alerts that still fit: same region, nationwide, or a conversation with no region', async () => {
    const h = build({
      staff: STAFF,
      online: [12],
      convs: [waiting(42, 'south'), waiting(43, null), waiting(44, 'north')],
      alerts: [alertFor(1, 42, 21), alertFor(2, 43, 21), alertFor(3, 44, 31)],
    });
    await h.svc.onUserRoutingChanged({ tenantId: 1, userId: 21, region: 'south' }); // unchanged region for 21
    await h.svc.onUserRoutingChanged({ tenantId: 1, userId: 31, region: null }); // nationwide fits any region
    expect(h.alerts.table.map((a) => a.targetUserId)).toEqual([21, 21, 31]);
  });

  it('a user who became nationwide keeps their alerts', async () => {
    const h = build({ staff: [{ id: 11, region: null }], convs: [waiting(42, 'north')], alerts: [alertFor(1, 42, 11)] });
    await h.svc.onUserRoutingChanged({ tenantId: 1, userId: 11, region: null });
    expect(h.alerts.table[0].targetUserId).toBe(11);
  });

  it('a suspended user loses every pinned alert, whatever their region', async () => {
    const h = build({
      staff: [{ id: 11, region: 'north', status: 'suspended' }, { id: 12, region: 'north' }],
      online: [12],
      convs: [waiting(42, 'north')],
      alerts: [alertFor(1, 42, 11)],
    });
    await h.svc.onUserRoutingChanged({ tenantId: 1, userId: 11, region: 'north', status: 'suspended' });
    expect(h.alerts.table[0].targetUserId).toBe(12);
  });

  it('settles alerts of conversations that were claimed or ended meanwhile instead of re-pinning them', async () => {
    const h = build({
      staff: [{ id: 11, region: 'south' }],
      convs: [waiting(42, 'north', { status: 'agent', agentId: 9 }), waiting(43, 'north', { status: 'ended' })],
      alerts: [alertFor(1, 42, 11), alertFor(2, 43, 11)],
    });
    await h.svc.onUserRoutingChanged({ tenantId: 1, userId: 11, region: 'south' });
    expect(h.alerts.table.map((a) => a.status)).toEqual(['superseded', 'superseded']);
  });

  it('only touches the open alerts addressed to that user', async () => {
    const h = build({
      staff: [{ id: 11, region: 'south' }, { id: 12, region: 'north' }],
      online: [12],
      convs: [waiting(42, 'north'), waiting(43, 'north')],
      alerts: [alertFor(1, 42, 11), alertFor(2, 43, 12), { ...alertFor(3, 42, 11), status: 'acked' }],
    });
    await h.svc.onUserRoutingChanged({ tenantId: 1, userId: 11, region: 'south' });
    expect(h.alerts.table.map((a) => a.targetUserId)).toEqual([12, 12, 11]);
  });

  it('never throws', async () => {
    const h = build({ staff: STAFF });
    h.alerts.find.mockRejectedValueOnce(new Error('db down'));
    await expect(h.svc.onUserRoutingChanged({ tenantId: 1, userId: 11, region: 'south' })).resolves.toBeUndefined();
  });
});

describe('AgentAlertService — event wiring', () => {
  it('subscribes to escalations AND to staff routing changes', async () => {
    const h = build({
      staff: [{ id: 11, region: 'south' }, { id: 12, region: 'north' }],
      online: [12],
      convs: [{ id: 42, tenantId: 1, sessionId: 5, status: 'waiting', agentId: null, supportType: 'business', supportRegion: 'north' }],
      alerts: [{ id: 1, tenantId: 1, conversationId: 42, reason: 'user_request', status: 'new', targetUserId: 11, targetRegion: null }],
    });
    const handlers = new Map<string, (p: unknown) => Promise<void>>();
    (h.svc as unknown as { bus: { subscribe: jest.Mock } }).bus.subscribe = jest.fn((key: string, fn: (p: unknown) => Promise<void>) => {
      handlers.set(key, fn);
    });
    h.svc.onModuleInit();

    expect([...handlers.keys()].sort()).toEqual(['escalation.requested', 'user.routing_changed']);
    // The routing-change handler runs the re-pointing.
    await handlers.get('user.routing_changed')!({ tenantId: 1, userId: 11, region: 'south' });
    expect(h.alerts.table[0].targetUserId).toBe(12);
    // The escalation handler creates an alert.
    await handlers.get('escalation.requested')!({ tenantId: 1, conversationId: 77, reason: 'user_request' });
    expect(h.alerts.table.some((a) => a.conversationId === 77)).toBe(true);
  });
});

describe('alertSubjectPrefix', () => {
  it('defaults to the neutral [SharpTalk] and never to a tenant brand', () => {
    expect(alertSubjectPrefix(undefined)).toBe('[SharpTalk]');
    expect(alertSubjectPrefix('')).toBe('[SharpTalk]');
    expect(alertSubjectPrefix('   ')).toBe('[SharpTalk]');
  });

  it('takes the operator value, on one line and bounded', () => {
    expect(alertSubjectPrefix(' [Go2Joy Chat] ')).toBe('[Go2Joy Chat]');
    expect(alertSubjectPrefix('[A]\r\nBcc: x@y.z')).toBe('[A] Bcc: x@y.z');
    expect(alertSubjectPrefix('x'.repeat(100)).length).toBe(40);
  });
});
