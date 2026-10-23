import { MergedRoomService } from './merged-room.service';

/**
 * PLN-261023-LiveChat-Merge-Same-Customer-Sessions — merged room over the same
 * customer's sessions. An in-memory repository stands in for TypeORM; ids are
 * STRINGS on read, as BIGINT columns really arrive (numeric fixtures hid a
 * comparison bug before — bigint-pk lesson).
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    const actual = row[k];
    if (v && typeof v === 'object' && '_type' in v) {
      if (v._type === 'in') return (v._value as unknown[]).map(String).includes(String(actual));
      if (v._type === 'not') return v._value?._type === 'isNull' ? actual != null : String(actual) !== String(v._value);
      if (v._type === 'isNull') return actual == null;
    }
    return String(actual) === String(v);
  });
}

function repo(seed: Row[] = []) {
  const rows: Row[] = seed.map((r) => ({ ...r, id: String(r.id) }));
  let next = 1000;
  const pick = (opts: Row = {}) => {
    const wheres = opts.where ? (Array.isArray(opts.where) ? opts.where : [opts.where]) : [{}];
    let out = rows.filter((r) => wheres.some((w: Row) => matches(r, w)));
    const dir = opts.order?.id;
    if (dir) out = [...out].sort((a, b) => (Number(a.id) - Number(b.id)) * (dir === 'DESC' ? -1 : 1));
    return opts.take ? out.slice(0, opts.take) : out;
  };
  return {
    rows,
    find: jest.fn(async (opts?: Row) => pick(opts).map((r) => ({ ...r }))),
    findOne: jest.fn(async (opts?: Row) => {
      const r = pick(opts)[0];
      return r ? { ...r } : null;
    }),
    count: jest.fn(async (opts?: Row) => pick(opts).length),
    create: jest.fn((v: Row) => ({ ...v })),
    save: jest.fn(async (v: Row) => {
      if (v.id != null) {
        const i = rows.findIndex((r) => r.id === String(v.id));
        rows[i] = { ...rows[i], ...v, id: String(v.id) };
        return { ...rows[i] };
      }
      const row = { createdAt: new Date(), ...v, id: String(next++) };
      rows.push(row);
      return { ...row };
    }),
    update: jest.fn(async (where: Row, patch: Row) => {
      for (const r of rows) if (matches(r, where)) Object.assign(r, patch);
      return { affected: 1 };
    }),
    delete: jest.fn(async (where: Row) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { affected: 1 };
    }),
  };
}

const T = 4;

function harness() {
  // customer 10 = the person; 11 = another row with the same email; 20 = someone else.
  const customers = repo([
    { id: 10, tenantId: T, emailHash: 'h-ana' },
    { id: 11, tenantId: T, emailHash: 'h-ana' },
    { id: 20, tenantId: T, emailHash: 'h-bob' },
  ]);
  const sessions = repo([
    { id: 101, tenantId: T, customerId: 10, alias: null },
    { id: 102, tenantId: T, customerId: 11, alias: 'VIP' },
    { id: 103, tenantId: T, customerId: null, alias: null }, // claimed: customer on the conversation only
    { id: 104, tenantId: T, customerId: 20, alias: null }, // someone else
    { id: 105, tenantId: T, customerId: null, alias: null }, // guest
    { id: 106, tenantId: 9, customerId: 10, alias: null }, // other tenant
  ]);
  const convs = repo([
    { id: 501, tenantId: T, sessionId: 101, customerId: 10, channel: 'widget', status: 'ended', createdAt: new Date('2026-10-01') },
    { id: 502, tenantId: T, sessionId: 102, customerId: null, channel: 'widget', status: 'ended', createdAt: new Date('2026-10-10') },
    { id: 503, tenantId: T, sessionId: 103, customerId: 10, channel: 'widget', status: 'ai_active', createdAt: new Date('2026-10-20') },
    { id: 504, tenantId: T, sessionId: 104, customerId: 20, channel: 'widget', status: 'ended', createdAt: new Date('2026-10-05') },
    { id: 505, tenantId: T, sessionId: 105, customerId: null, channel: 'widget', status: 'ai_active', createdAt: new Date('2026-10-21') },
    { id: 506, tenantId: 9, sessionId: 106, customerId: 10, channel: 'widget', status: 'ended', createdAt: new Date('2026-10-21') },
    { id: 507, tenantId: T, sessionId: 101, customerId: 10, channel: 'widget', status: 'agent', createdAt: new Date('2026-10-22') },
  ]);
  (convs as any).createQueryBuilder = () => {
    let ids: unknown[] = [];
    let tenant: unknown;
    const qb: any = {
      select: () => qb,
      where: (_sql: string, p: Row) => ((ids = p.ids), (tenant = p.tenantId), qb),
      orderBy: () => qb,
      limit: () => qb,
      getRawMany: async () =>
        [
          ...new Set(
            convs.rows
              .filter((c) => String(c.tenantId) === String(tenant) && ids.map(String).includes(String(c.customerId)))
              .map((c) => c.sessionId),
          ),
        ].map((sessionId) => ({ sessionId: String(sessionId) })),
    };
    return qb;
  };
  const rooms = repo();
  const members = repo();
  const audit = { write: jest.fn(async () => ({})) };
  const svc = new MergedRoomService(
    rooms as never,
    members as never,
    sessions as never,
    convs as never,
    customers as never,
    audit as never,
  );
  return { svc, rooms, members, convs, audit };
}

describe('MergedRoomService (PLN-261023)', () => {
  it('candidates: same customer row, same email row and claimed conversation — never someone else or another tenant', async () => {
    const h = harness();
    const res = await h.svc.candidates(507, T);
    const by = new Map(res.sessions.map((s) => [s.sessionId, s]));
    expect([...by.keys()].sort()).toEqual([101, 102, 103]);
    expect(by.get(101)).toMatchObject({ matchedBy: 'customer', current: true, conversationId: 507, open: true });
    expect(by.get(102)).toMatchObject({ matchedBy: 'email', unverified: false, alias: 'VIP' });
    expect(by.get(103)).toMatchObject({ matchedBy: 'claimed', unverified: true });
  });

  it('candidates: a guest session has none', async () => {
    const h = harness();
    expect((await h.svc.candidates(505, T)).sessions).toEqual([]);
  });

  it('merge refuses a guest (E5105), another customer (E5106) and too few sessions', async () => {
    const h = harness();
    await expect(h.svc.merge(T, 1, 505, [101], true)).rejects.toMatchObject({ errorCode: 'E5105' });
    await expect(h.svc.merge(T, 1, 507, [104], true)).rejects.toMatchObject({ errorCode: 'E5106' });
    await expect(h.svc.merge(T, 1, 507, [], true)).rejects.toMatchObject({ errorCode: 'E5003' });
    expect(h.rooms.rows).toHaveLength(0);
  });

  it('merge creates one room keyed on the customer, audits it, and the transcript spans every conversation', async () => {
    const h = harness();
    const room = await h.svc.merge(T, 7, 507, [102, 103], true);
    expect(h.rooms.rows).toEqual([expect.objectContaining({ tenantId: T, customerId: 10, autoJoin: 1, createdBy: 7 })]);
    expect(room.sessions.map((s) => s.sessionId).sort()).toEqual([101, 102, 103]);
    expect(room.sessions.every((s) => !s.auto)).toBe(true);
    expect(h.audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'merged_room.created' }));
    const convs = await h.svc.roomConversations(T, 102);
    expect(convs!.map((c) => c.id)).toEqual([501, 502, 503, 507]);
    // Merging again from another member joins the SAME room (D5).
    await h.svc.merge(T, 7, 503, [101], false);
    expect(h.rooms.rows).toHaveLength(1);
    expect(h.rooms.rows[0].autoJoin).toBe(0);
  });

  it('badges count member sessions and the ones still going', async () => {
    const h = harness();
    await h.svc.merge(T, 7, 507, [102, 103], true);
    const badges = await h.svc.badgesForSessions(T, [101, 104]);
    expect(badges.get(101)).toMatchObject({ sessionCount: 3, openCount: 2 });
    expect(badges.has(104)).toBe(false);
  });

  it('auto-join: a later session of the customer joins; nothing happens without a room, for a guest, or when auto-join is off', async () => {
    const h = harness();
    await h.svc.autoJoin(T, 102);
    expect(h.members.find).not.toHaveBeenCalled(); // no room in the tenant: one lookup, done
    await h.svc.merge(T, 7, 507, [103], true);
    await h.svc.autoJoin(T, 102);
    expect(h.members.rows.find((m) => m.sessionId === 102)).toMatchObject({ state: 'member', addedBy: null });
    expect(h.audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'merged_room.auto_joined', actorType: 'system' }));
    await h.svc.autoJoin(T, 105); // guest
    await h.svc.autoJoin(T, 104); // someone else
    expect(h.members.rows.map((m) => m.sessionId).sort()).toEqual([101, 102, 103]);
  });

  it('auto-join respects "off" and never brings back an excluded session (D6)', async () => {
    const h = harness();
    const room = await h.svc.merge(T, 7, 507, [102, 103], false);
    await h.svc.removeSession(room.id, T, 7, 102);
    expect(h.members.rows.find((m) => m.sessionId === 102)?.state).toBe('excluded');
    await h.svc.setAutoJoin(room.id, T, 7, true);
    await h.svc.autoJoin(T, 102);
    expect(h.members.rows.find((m) => m.sessionId === 102)?.state).toBe('excluded');
    // The operator can still merge it back explicitly.
    await h.svc.merge(T, 7, 507, [102], true);
    expect(h.members.rows.find((m) => m.sessionId === 102)?.state).toBe('member');
  });

  it('auto-join never throws — a failure must not cost the shopper their message', async () => {
    const h = harness();
    h.rooms.findOne.mockRejectedValueOnce(new Error('db down'));
    await expect(h.svc.autoJoin(T, 102)).resolves.toBeUndefined();
    await h.svc.merge(T, 7, 507, [103], true);
    h.members.save.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));
    await expect(h.svc.autoJoin(T, 102)).resolves.toBeUndefined();
  });

  it('removing a session from a two-session room dissolves it; conversations are untouched', async () => {
    const h = harness();
    const room = await h.svc.merge(T, 7, 507, [103], true);
    const before = h.convs.rows.length;
    expect(await h.svc.removeSession(room.id, T, 7, 103)).toBeNull();
    expect(h.rooms.rows).toHaveLength(0);
    expect(h.members.rows).toHaveLength(0);
    expect(h.convs.rows).toHaveLength(before);
  });

  it('another tenant cannot touch the room (E5104)', async () => {
    const h = harness();
    const room = await h.svc.merge(T, 7, 507, [103], true);
    await expect(h.svc.dissolve(room.id, 9, 7)).rejects.toMatchObject({ errorCode: 'E5104' });
    await expect(h.svc.setAutoJoin(room.id, 9, 7, false)).rejects.toMatchObject({ errorCode: 'E5104' });
    expect(h.rooms.rows).toHaveLength(1);
  });

  it('a session in another customer’s room cannot be merged here', async () => {
    const h = harness();
    // Bob's room holds session 104; it is not Ana's anyway, and stays put.
    h.rooms.rows.push({ id: '900', tenantId: T, customerId: 20, autoJoin: 1, createdBy: 1 });
    h.members.rows.push({ id: '901', tenantId: T, roomId: '900', sessionId: '104', state: 'member', addedBy: 1 });
    await expect(h.svc.merge(T, 7, 507, [104], true)).rejects.toMatchObject({ errorCode: 'E5106' });
  });

  it('DSAR erasure removes rooms keyed on the customer', async () => {
    const h = harness();
    await h.svc.merge(T, 7, 507, [103], true);
    await h.svc.eraseCustomer(T, 10);
    expect(h.rooms.rows).toHaveLength(0);
    expect(h.members.rows).toHaveLength(0);
  });
});
