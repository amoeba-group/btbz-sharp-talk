import { AgentAlertReminderService } from './agent-alert-reminder.service';
import { AgentAlertService } from './agent-alert.service';
import type { AgentAlert } from './entity/agent-alert.entity';

/**
 * Personal alert mail + unanswered-alarm reminder (PLN-261015 D4).
 * The properties under test: a paged agent is mailed at their OWN address,
 * a reminder goes out once per conversation and only while it is still
 * waiting, and the lead is paged on top.
 */
const NOW = new Date('2026-10-16T03:00:00Z');

function harness(opts: {
  alerts: Array<Partial<AgentAlert>>;
  waiting?: number[];
  reAlert?: { afterMinutes?: number; escalateToUserIds?: number[] } | null;
  emails?: Record<number, string>;
}) {
  const rows = opts.alerts.map((a, i) => ({ id: i + 1, status: 'new', remindedAt: null, tenantId: 4, ...a })) as AgentAlert[];
  const mails: Array<{ to: string; subject: string; text: string }> = [];
  const alertRepo = {
    find: jest.fn(async () => rows.filter((r) => r.status === 'new' && r.remindedAt == null)),
    findOne: jest.fn(async () => null),
    update: jest.fn(async (where: { conversationId: number }, patch: Partial<AgentAlert>) => {
      for (const r of rows) if (Number(r.conversationId) === where.conversationId && r.remindedAt == null) Object.assign(r, patch);
      return { affected: 1 };
    }),
    create: (a: Partial<AgentAlert>) => a as AgentAlert,
    save: jest.fn(async (a: AgentAlert | AgentAlert[]) => {
      const list = Array.isArray(a) ? a : [a];
      rows.push(...list);
      return a;
    }),
  };
  const userRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: number } }) =>
      opts.emails?.[where.id] ? { id: where.id, email: opts.emails[where.id] } : null,
    ),
  };
  const sessionRepo = {
    findOne: jest.fn(async () => ({ id: 1, identityAttributes: { hotel_name: 'Joy Hotel', region: 'north' } })),
  };
  const config = { get: jest.fn((k: string) => ({ ALERT_EMAIL_TO: 'ops@go2joy.vn', APP_PUBLIC_URL: 'https://sharptalk.go2joy.vn/' } as Record<string, string>)[k]) };
  const mailer = { send: jest.fn(async (m: { to: string; subject: string; text: string }) => { mails.push(m); return true; }) };
  const alerts = new AgentAlertService(
    alertRepo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { subscribe: jest.fn() } as never,
    config as never,
    mailer as never,
    userRepo as never,
    sessionRepo as never,
  );
  const configRepo = {
    find: jest.fn(async () => (opts.reAlert === null ? [] : [{ id: 5, tenantId: 4, handoffConfig: { reAlert: opts.reAlert } }])),
  };
  const convRepo = {
    find: jest.fn(async () => (opts.waiting ?? []).map((id) => ({ id }))),
  };
  const reminder = new AgentAlertReminderService(alertRepo as never, configRepo as never, convRepo as never, alerts);
  return { reminder, alerts, rows, mails };
}

describe('AgentAlertService.notifyRows — personal mail', () => {
  it('mails each paged agent at their own address, with hotel, region and a console link', async () => {
    const h = harness({ alerts: [], emails: { 11: 'an@go2joy.vn', 12: 'binh@go2joy.vn' } });
    await h.alerts.notifyRows([
      { id: 1, tenantId: 4, conversationId: 900, sessionId: 1, reason: 'low_confidence', preview: 'Hỏi về đối soát', targetUserId: 11 },
      { id: 2, tenantId: 4, conversationId: 900, sessionId: 1, reason: 'low_confidence', preview: 'Hỏi về đối soát', targetUserId: 12 },
    ] as AgentAlert[]);
    expect(h.mails.map((m) => m.to)).toEqual(['an@go2joy.vn', 'binh@go2joy.vn']);
    expect(h.mails[0].text).toContain('Hotel: Joy Hotel · Region: north');
    expect(h.mails[0].text).toContain('https://sharptalk.go2joy.vn/live-chat?c=900');
  });

  it('a broadcast row keeps the ops mailbox; an unreadable agent address falls back to it once', async () => {
    const h = harness({ alerts: [] });
    await h.alerts.notifyRows([
      { id: 1, tenantId: 4, conversationId: 901, reason: 'user_request', targetUserId: 77 },
      { id: 2, tenantId: 4, conversationId: 901, reason: 'user_request', targetUserId: null },
    ] as AgentAlert[]);
    expect(h.mails.map((m) => m.to)).toEqual(['ops@go2joy.vn']);
  });
});

describe('AgentAlertReminderService.sweep', () => {
  const old = new Date(NOW.getTime() - 10 * 60_000);

  it('reminds a still-waiting conversation once and pages the lead', async () => {
    const h = harness({
      alerts: [{ conversationId: 900, targetUserId: 11, createdAt: old, reason: 'low_confidence' }],
      waiting: [900],
      reAlert: { afterMinutes: 5, escalateToUserIds: [20] },
      emails: { 11: 'an@go2joy.vn', 20: 'lead@go2joy.vn' },
    });
    expect(await h.reminder.sweep(NOW)).toBe(1);
    expect(h.mails.map((m) => m.to)).toEqual(['an@go2joy.vn', 'lead@go2joy.vn']);
    expect(h.mails[0].subject).toMatch(/Reminder/);
    // Lead row exists, already stamped — and a second sweep sends nothing.
    expect(h.rows.find((r) => r.targetUserId === 20)?.remindedAt).toEqual(NOW);
    expect(await h.reminder.sweep(NOW)).toBe(0);
    expect(h.mails).toHaveLength(2);
  });

  it('stamps but stays quiet when the conversation was accepted meanwhile', async () => {
    const h = harness({
      alerts: [{ conversationId: 900, targetUserId: 11, createdAt: old }],
      waiting: [],
      reAlert: { afterMinutes: 5 },
      emails: { 11: 'an@go2joy.vn' },
    });
    expect(await h.reminder.sweep(NOW)).toBe(0);
    expect(h.mails).toHaveLength(0);
    expect(h.rows[0].remindedAt).toEqual(NOW);
  });

  it('does nothing for a tenant without reAlert', async () => {
    const h = harness({ alerts: [{ conversationId: 900, targetUserId: 11, createdAt: old }], waiting: [900], reAlert: {} });
    expect(await h.reminder.sweep(NOW)).toBe(0);
    expect(h.mails).toHaveLength(0);
    expect(h.rows[0].remindedAt).toBeNull();
  });
});
