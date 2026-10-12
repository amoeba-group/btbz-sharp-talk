import { FindOperator } from 'typeorm';
import { AgentAlertService } from './agent-alert.service';
import { AgentAlert } from './entity/agent-alert.entity';

/**
 * Tenant fence on the escalation alarm feed (REQ-260824 R2). The alert rows
 * always carried tenant_id; these tests pin the read path so a broadcast
 * alarm can never surface on another tenant's console again.
 */
describe('AgentAlertService — tenancy', () => {
  function build(rows: Partial<AgentAlert>[] = []) {
    const finds: Array<Record<string, unknown>> = [];
    const alertRepo = {
      find: jest.fn(async (opts: { where: Array<Record<string, unknown>> }) => {
        finds.push(opts);
        return rows as AgentAlert[];
      }),
      findOne: jest.fn(
        async (opts: { where: Record<string, unknown> }) =>
          (rows.find(
            (r) =>
              r.id === opts.where.id &&
              (opts.where.tenantId === undefined || r.tenantId === opts.where.tenantId),
          ) ?? null) as AgentAlert | null,
      ),
      save: jest.fn(async (a: AgentAlert) => a),
      create: jest.fn((a: Partial<AgentAlert>) => a as AgentAlert),
    };
    const svc = new AgentAlertService(
      alertRepo as never,
      {} as never, // labelRepo
      {} as never, // userLabelRepo
      {} as never, // profileRepo
      {} as never, // assignmentRepo
      { subscribe: jest.fn() } as never, // bus
      { get: jest.fn(() => undefined) } as never, // config
      { send: jest.fn() } as never, // mailer
    );
    return { svc, alertRepo, finds };
  }

  it('fences both list branches (broadcast + addressed) to the tenant', async () => {
    const h = build();

    await h.svc.list('new', 7, 1);

    const where = (h.finds[0].where ?? []) as Array<Record<string, unknown>>;
    expect(where).toHaveLength(2);
    for (const branch of where) expect(branch.tenantId).toBe(1);
    // Branch order: broadcast (target IS NULL) then addressed-to-me.
    expect((where[0].targetUserId as FindOperator<unknown>).type).toBe('isNull');
    expect(where[1].targetUserId).toBe(7);
  });

  it('returns an empty feed without querying when the caller has no tenant', async () => {
    const h = build();

    await expect(h.svc.list('new', 7, 0)).resolves.toEqual([]);
    expect(h.alertRepo.find).not.toHaveBeenCalled();
  });

  it("refuses to ack another tenant's alert with the same 404 as a missing row", async () => {
    const h = build([{ id: 10, tenantId: 2, status: 'new' }]);

    await expect(h.svc.ack(10, 7, 1)).rejects.toThrow();
    expect(h.alertRepo.save).not.toHaveBeenCalled();
  });

  it('acks an own-tenant alert', async () => {
    const h = build([{ id: 10, tenantId: 1, status: 'new' }]);

    const acked = await h.svc.ack(10, 7, 1);

    expect(acked.status).toBe('acked');
    expect(acked.ackedBy).toBe(7);
    expect(h.alertRepo.save).toHaveBeenCalled();
  });

  it('scopes the escalation dedupe lookup to the tenant', async () => {
    const h = build();

    await h.svc.onEscalation({ tenantId: 3, conversationId: 42, reason: 'user_request' });

    const where = h.alertRepo.findOne.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.tenantId).toBe(3);
    expect(where.conversationId).toBe(42);
  });
});

describe('AgentAlertService.summary — partner line (REQ-261006 H4)', () => {
  const svc = Object.create(AgentAlertService.prototype) as AgentAlertService;
  const alert = { conversationId: 4820, reason: 'low_confidence', preview: 'Hạn đối soát?' } as AgentAlert;

  it('appends the signed partner label when the escalating session carried one', () => {
    const text = svc.summary(alert, { partnerLabel: 'A In Hotel Del Luna (1721) · receptionist' });
    expect(text).toContain('Partner: A In Hotel Del Luna (1721) · receptionist');
    expect(text).toContain('conversation #4820');
    expect(text.endsWith('> Hạn đối soát?')).toBe(true);
  });

  it('is byte-identical to the pre-v1.1 text without a label', () => {
    expect(svc.summary(alert)).toBe(
      'Chat escalation — conversation #4820\nReason: AI could not answer from the knowledge base\n> Hạn đối soát?',
    );
    expect(svc.summary(alert, { partnerLabel: '  ' })).not.toContain('Partner');
  });
});

/**
 * Who the alarm is addressed to (PLN-261007 Team Routing). An explicit label —
 * the team the customer picked, or a deny rule's stamp — outranks the tenant's
 * general assignee list; with no such agent online the configured assignee is
 * used; with neither the row stays a broadcast (alarms never drop).
 */
describe('AgentAlertService — label routing precedence', () => {
  function build(opts: { labelUsers: number[]; online: number[] }) {
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
    const mailer = { send: jest.fn() };
    const svc = new AgentAlertService(
      alertRepo as never,
      { find: jest.fn(async () => [{ id: 3, tenantId: 1, code: 'sales_admin' }]) } as never,
      { find: jest.fn(async () => opts.labelUsers.map((userId) => ({ userId, jobLabelId: 3 }))) } as never,
      {
        find: jest.fn(async () =>
          opts.online.map((userId) => ({ tenantId: 1, userId, status: 'online', maxConcurrent: 5, lastSeen: new Date() })),
        ),
      } as never,
      { count: jest.fn(async () => 0) } as never,
      { subscribe: jest.fn() } as never,
      { get: jest.fn((k: string) => (k === 'ALERT_EMAIL_TO' ? 'ops@example.com' : undefined)) } as never,
      mailer as never,
    );
    return { svc, saved, mailer };
  }

  const base = { tenantId: 1, conversationId: 42, reason: 'user_request', targetUserIds: [9] };

  it('the chosen team label wins over the configured assignee', async () => {
    const h = build({ labelUsers: [21, 22], online: [22] });
    await h.svc.onEscalation({ ...base, issueLabel: 'sales_admin', supportLabel: 'Business Support' });
    expect(h.saved[0].targetUserId).toBe(22);
    // The channels say which team was asked for.
    expect(h.mailer.send.mock.calls[0][0].text).toContain('Team: Business Support');
  });

  it('falls back to the configured assignee when nobody with the label is online', async () => {
    const h = build({ labelUsers: [21], online: [] });
    await h.svc.onEscalation({ ...base, issueLabel: 'sales_admin' });
    expect(h.saved[0].targetUserId).toBe(9);
  });

  it('stays a broadcast with neither', async () => {
    const h = build({ labelUsers: [], online: [] });
    await h.svc.onEscalation({ tenantId: 1, conversationId: 42, reason: 'user_request', issueLabel: 'sales_admin' });
    expect(h.saved[0].targetUserId).toBeNull();
    expect(h.mailer.send.mock.calls[0][0].text).not.toContain('Team:');
  });
});

/**
 * Integration of two features that both add a line to the escalation text
 * (REQ-261006 partner line + PLN-261007 team line): both show, in a fixed
 * order, and each stays absent when its input is.
 */
describe('AgentAlertService.summary — partner and team lines together', () => {
  const svc = Object.create(AgentAlertService.prototype) as AgentAlertService;
  const alert = { conversationId: 7, reason: 'user_request', preview: 'Hoa hồng?' } as AgentAlert;

  it('shows team, region and partner in a fixed order, before the preview', () => {
    expect(
      svc.summary(alert, {
        partnerLabel: 'A In Hotel Del Luna (1721) · manager',
        teamLabel: 'Business Support',
        regionLabel: 'South (South Central)',
      }),
    ).toBe(
      'Chat escalation — conversation #7\nReason: Customer asked for a human agent' +
        '\nTeam: Business Support\nRegion: South (South Central)' +
        '\nPartner: A In Hotel Del Luna (1721) · manager\n> Hoa hồng?',
    );
  });

  it('keeps each line independent of the others', () => {
    expect(svc.summary(alert, { teamLabel: 'Customer Service Support' })).not.toContain('Partner:');
    const partnerOnly = svc.summary(alert, { partnerLabel: 'Hotel X (1)' });
    expect(partnerOnly).not.toContain('Team:');
    expect(partnerOnly).not.toContain('Region:');
    expect(svc.summary(alert, { regionLabel: 'North' })).toContain('\nRegion: North');
  });
});

/**
 * Regional team routing (PLN-261007 Hotel Region Routing). The hotel's own
 * region is asked first; nationwide staff (region empty) are the second round;
 * staff of the OTHER region are never picked here. Nobody → the caller's
 * existing fallback (configured assignee, then broadcast).
 */
describe('AgentAlertService — regional ladder', () => {
  type StaffRow = { id: number; region: string | null; status?: string };

  function build(staff: StaffRow[], online: number[]) {
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
    const labelFinds: unknown[] = [];
    const svc = new AgentAlertService(
      alertRepo as never,
      {
        find: jest.fn(async (q: unknown) => {
          labelFinds.push(q);
          return [{ id: 3, tenantId: 1, code: 'consult' }];
        }),
      } as never,
      { find: jest.fn(async () => staff.map((s) => ({ userId: s.id, jobLabelId: 3 }))) } as never,
      {
        find: jest.fn(async (q: { where: { userId: { _value: number[] } } }) => {
          const asked = (q.where.userId as unknown as { _value: number[] })._value;
          return online
            .filter((id) => asked.includes(id))
            .map((userId) => ({ tenantId: 1, userId, status: 'online', maxConcurrent: 5, lastSeen: new Date() }));
        }),
      } as never,
      { count: jest.fn(async () => 0) } as never,
      { subscribe: jest.fn() } as never,
      { get: jest.fn(() => undefined) } as never,
      { send: jest.fn() } as never,
      { find: jest.fn(async () => staff) } as never, // userRepo
    );
    return { svc, saved, labelFinds };
  }

  const base = { tenantId: 1, conversationId: 50, reason: 'user_request', targetUserIds: [9] };
  // Real user statuses are active / suspended / invited (users.status, user.request.ts).
  const STAFF: StaffRow[] = [
    { id: 11, region: 'north', status: 'active' },
    { id: 12, region: 'north', status: 'active' },
    { id: 21, region: 'south', status: 'active' },
    { id: 31, region: null, status: 'active' }, // nationwide
    { id: 41, region: 'south', status: 'suspended' },
  ];

  it('picks an online agent of the hotel region, not of the other one', async () => {
    const h = build(STAFF, [12, 21, 31]);
    await h.svc.onEscalation({ ...base, issueLabel: 'consult', supportRegion: 'north', regionLabel: 'North' });
    expect(h.saved[0].targetUserId).toBe(12);
  });

  it('asks nationwide staff next when nobody of that region is online', async () => {
    const h = build(STAFF, [21, 31]); // both north agents offline
    await h.svc.onEscalation({ ...base, issueLabel: 'consult', supportRegion: 'north' });
    expect(h.saved[0].targetUserId).toBe(31);
  });

  it('never picks the other region: falls to the configured assignee, then the broadcast', async () => {
    const h = build(STAFF, [21]); // only a SOUTH agent is online, hotel is north
    await h.svc.onEscalation({ ...base, issueLabel: 'consult', supportRegion: 'north' });
    expect(h.saved[0].targetUserId).toBe(9);

    const none = build(STAFF, [21]);
    await none.svc.onEscalation({
      tenantId: 1,
      conversationId: 51,
      reason: 'low_confidence',
      supportRegion: 'north',
    });
    expect(none.saved[0].targetUserId).toBeNull();
  });

  it('skips suspended staff', async () => {
    const h = build(STAFF, [41]);
    await h.svc.onEscalation({ ...base, issueLabel: 'consult', supportRegion: 'south' });
    expect(h.saved[0].targetUserId).toBe(9);
  });

  it('a region with no label (AI-triggered hand-off) searches the consult label', async () => {
    const h = build(STAFF, [11]);
    await h.svc.onEscalation({ tenantId: 1, conversationId: 52, reason: 'low_confidence', supportRegion: 'north' });
    expect(h.saved[0].targetUserId).toBe(11);
    expect(JSON.stringify(h.labelFinds[0])).toContain('consult');
  });

  it('without a region the search ignores region entirely, as before', async () => {
    const h = build(STAFF, [21]);
    await h.svc.onEscalation({ ...base, issueLabel: 'consult' });
    expect(h.saved[0].targetUserId).toBe(21);
  });
});

/**
 * An unmapped province (PLN-261012 SG-61): region routing is on, the hotel's
 * province is not in the table. The alert says so instead of showing no region.
 */
describe('AgentAlertService.summary — unmapped province', () => {
  const svc = Object.create(AgentAlertService.prototype) as AgentAlertService;
  const alert = { conversationId: 9, reason: 'user_request', preview: 'Hoa hồng?' } as AgentAlert;

  it('prints "Region: ? (unmapped: <province>)" in the region slot', () => {
    expect(svc.summary(alert, { teamLabel: 'Business Support', regionUnmapped: 'Tp Quy Nhơn', partnerLabel: 'Hotel X (1)' })).toBe(
      'Chat escalation — conversation #9\nReason: Customer asked for a human agent' +
        '\nTeam: Business Support\nRegion: ? (unmapped: Tp Quy Nhơn)' +
        '\nPartner: Hotel X (1)\n> Hoa hồng?',
    );
  });

  it('a resolved region wins over the marker, and no marker keeps the old text byte for byte', () => {
    expect(svc.summary(alert, { regionLabel: 'North', regionUnmapped: 'X' })).toContain('\nRegion: North');
    expect(svc.summary(alert, { regionLabel: 'North', regionUnmapped: 'X' })).not.toContain('unmapped');
    expect(svc.summary(alert, {})).toBe(
      'Chat escalation — conversation #9\nReason: Customer asked for a human agent\n> Hoa hồng?',
    );
    expect(svc.summary(alert, { regionUnmapped: '   ' })).not.toContain('Region');
  });

  it('keeps the province on one bounded line', () => {
    const text = svc.summary(alert, { regionUnmapped: 'Pleiku\n:rotating_light: injected\n' + 'x'.repeat(200) });
    expect(text.split('\n').filter((l) => l.startsWith('Region:'))).toHaveLength(1);
    expect(text).not.toContain('\n:rotating_light:');
    expect(text.split('\n').find((l) => l.startsWith('Region:'))!.length).toBeLessThanOrEqual('Region: ? (unmapped: )'.length + 80);
  });

  it('flows from the escalation payload to the channels', async () => {
    const mailer = { send: jest.fn() };
    const svc2 = new AgentAlertService(
      { findOne: jest.fn(async () => null), save: jest.fn(async (a: unknown) => ({ id: 1, ...(a as object) })), create: jest.fn((a: unknown) => a) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { subscribe: jest.fn() } as never,
      { get: jest.fn((k: string) => (k === 'ALERT_EMAIL_TO' ? 'ops@example.com' : undefined)) } as never,
      mailer as never,
    );
    await svc2.onEscalation({ tenantId: 1, conversationId: 9, reason: 'user_request', regionUnmapped: 'Tp Quy Nhơn' });
    expect(mailer.send.mock.calls[0][0].text).toContain('Region: ? (unmapped: Tp Quy Nhơn)');
  });
});
