import { PILOT_HOTEL_LIMIT, PILOT_NOTICE_MAX_LENGTH } from '@sharptalk/types';
import { PilotAdminService } from './pilot-admin.service';
import { PILOT_IMPORT_MAX_ROWS } from './pilot.util';
import type { UpdatePilotAccessRequest } from './dto/request/pilot.request';

/**
 * Console side of the pilot allowlist (PLN-261012 SG-40): the switch, one-by-one
 * changes, the paste/CSV import with its dry run, audit rows and cache drops.
 * The repositories are an in-memory table so "what would the import do" and
 * "what did it do" can be compared on the same data.
 */

interface Row {
  id: number;
  tenantId: number;
  hotelSn: string;
  note: string | null;
  active: number;
  addedBy: number | null;
  createdAt: Date;
}

function harness(seed: Array<Partial<Row> & { hotelSn: string }> = [], tenantOverrides: Record<string, unknown> = {}) {
  let nextId = 1;
  const rows: Row[] = [];
  const make = (r: Partial<Row> & { hotelSn: string }): Row => ({
    id: nextId++,
    tenantId: 1,
    note: null,
    active: 1,
    addedBy: null,
    createdAt: new Date('2026-10-13T09:00:00Z'),
    ...r,
  });
  seed.forEach((r) => rows.push(make(r)));

  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'value' in (v as object) ? true : (r as never)[k] === v));

  const hotelRepo = {
    create: jest.fn((r: Partial<Row>) => make(r as never)),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where))),
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).length),
    save: jest.fn(async (input: Row | Row[]) => {
      const list = Array.isArray(input) ? input : [input];
      for (const r of list) if (!rows.includes(r)) rows.push(r);
      return input;
    }),
    update: jest.fn(async (where: Record<string, unknown>, patch: Partial<Row>) => {
      rows.filter((r) => matches(r, where)).forEach((r) => Object.assign(r, patch));
    }),
    delete: jest.fn(async (where: Record<string, unknown>) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
    }),
    findAndCount: jest.fn(async (opts: { where: unknown }) => [rows, rows.length] as [Row[], number]),
  };

  const tenant: Record<string, unknown> = { id: 1, pilotAccess: null, ...tenantOverrides };
  const tenantRepo = {
    findOne: jest.fn(async () => tenant),
    save: jest.fn(async (t: Record<string, unknown>) => t),
  };
  const audit = { write: jest.fn(async () => undefined) };
  const pilot = { invalidate: jest.fn(async () => undefined) };
  const svc = new PilotAdminService(tenantRepo as never, hotelRepo as never, audit as never, pilot as never);
  return { svc, rows, tenant, hotelRepo, tenantRepo, audit, pilot };
}

const ACTOR = 9;
const settings = (over: Partial<UpdatePilotAccessRequest> = {}): UpdatePilotAccessRequest => ({
  enabled: true,
  guest_allowed: true,
  non_pilot: 'hide',
  notice: {},
  ...over,
});
const auditActions = (audit: { write: jest.Mock }) => audit.write.mock.calls.map((c) => (c as unknown as [{ action: string }])[0].action);
const rejected = (p: Promise<unknown>) => p.then(() => null, (e) => e as { errorCode?: string; getStatus?: () => number });

describe('PilotAdminService.updateAccess — the switch', () => {
  it('stores the whole switch, drops the snapshot and audits tenant.pilot_updated', async () => {
    const { svc, tenant, tenantRepo, pilot, audit } = harness();
    const out = await svc.updateAccess(1, ACTOR, settings({ enabled: true, guest_allowed: false, non_pilot: 'notice', notice: { VI: ' Chưa áp dụng. ', EN: '  ' } }));

    expect(tenantRepo.save).toHaveBeenCalledTimes(1);
    expect(tenant.pilotAccess).toEqual({ enabled: true, guestAllowed: false, nonPilot: 'notice', notice: { VI: 'Chưa áp dụng.' } });
    expect(out.stored).toEqual(tenant.pilotAccess);
    expect(pilot.invalidate).toHaveBeenCalledWith(1);
    expect(auditActions(audit)).toEqual(['tenant.pilot_updated']);
    expect(audit.write.mock.calls[0][0]).toMatchObject({
      tenantId: 1,
      actorType: 'user',
      actorId: ACTOR,
      metadata: { enabled: true, guestAllowed: false, nonPilot: 'notice', noticeLanguages: ['VI'] },
    });
  });

  it('allows switching on with an empty list — that is also how the pilot is closed', async () => {
    const { svc } = harness();
    await expect(svc.updateAccess(1, ACTOR, settings())).resolves.toMatchObject({ counts: { active: 0, total: 0 } });
  });

  it('refuses an unknown non_pilot mode with E5133', async () => {
    const { svc, tenantRepo, pilot, audit } = harness();
    const err = await rejected(svc.updateAccess(1, ACTOR, settings({ non_pilot: 'block' as never })));
    expect(err?.errorCode).toBe('E5133');
    expect(tenantRepo.save).not.toHaveBeenCalled();
    expect(pilot.invalidate).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('refuses a notice in a language we do not speak, or one that is too long or not text', async () => {
    const { svc } = harness();
    expect((await rejected(svc.updateAccess(1, ACTOR, settings({ notice: { XX: 'hello' } }))))?.errorCode).toBe('E5133');
    expect((await rejected(svc.updateAccess(1, ACTOR, settings({ notice: { vi: 'lowercase code' } }))))?.errorCode).toBe('E5133');
    expect((await rejected(svc.updateAccess(1, ACTOR, settings({ notice: { VI: 'x'.repeat(PILOT_NOTICE_MAX_LENGTH + 1) } }))))?.errorCode).toBe('E5133');
    expect((await rejected(svc.updateAccess(1, ACTOR, settings({ notice: { VI: 5 as never } }))))?.errorCode).toBe('E5133');
    expect((await rejected(svc.updateAccess(1, ACTOR, settings({ notice: ['a'] as never }))))?.errorCode).toBe('E5133');
  });

  it('a failing audit write never fails the change', async () => {
    const { svc, audit, tenant } = harness();
    audit.write.mockRejectedValueOnce(new Error('audit down'));
    await expect(svc.updateAccess(1, ACTOR, settings())).resolves.toBeDefined();
    expect(tenant.pilotAccess).toMatchObject({ enabled: true });
  });
});

describe('PilotAdminService.addHotel', () => {
  it('adds a hotel, stamps who added it, drops the snapshot, audits tenant.pilot_hotel_added', async () => {
    const { svc, rows, pilot, audit } = harness();
    const saved = await svc.addHotel(1, ACTOR, { hotel_sn: ' 1721 ', note: ' batch 1 ' });
    expect(saved).toMatchObject({ tenantId: 1, hotelSn: '1721', note: 'batch 1', active: 1, addedBy: ACTOR });
    expect(rows).toHaveLength(1);
    expect(pilot.invalidate).toHaveBeenCalledWith(1);
    expect(auditActions(audit)).toEqual(['tenant.pilot_hotel_added']);
    expect(audit.write.mock.calls[0][0]).toMatchObject({ target: 'hotel:1721', metadata: { hotelSn: '1721', mode: 'single' } });
  });

  it('refuses a value that is not a serial with E5130 and changes nothing', async () => {
    const { svc, rows, pilot, audit } = harness();
    for (const bad of ['', '   ', 'a b', '17;21', "x'--"]) {
      expect((await rejected(svc.addHotel(1, ACTOR, { hotel_sn: bad })))?.errorCode).toBe('E5130');
    }
    expect(rows).toHaveLength(0);
    expect(pilot.invalidate).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('is idempotent for a hotel that is already active — no second row, no audit noise', async () => {
    const { svc, rows, audit } = harness([{ hotelSn: '1721' }]);
    const again = await svc.addHotel(1, ACTOR, { hotel_sn: '1721' });
    expect(again.hotelSn).toBe('1721');
    expect(rows).toHaveLength(1);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('adding a paused hotel resumes it', async () => {
    const { svc, rows, audit, pilot } = harness([{ hotelSn: '1721', active: 0, note: 'old' }]);
    await svc.addHotel(1, ACTOR, { hotel_sn: '1721', note: 'new' });
    expect(rows[0]).toMatchObject({ active: 1, note: 'new' });
    expect(pilot.invalidate).toHaveBeenCalled();
    expect(audit.write.mock.calls[0][0]).toMatchObject({ metadata: { mode: 'resumed' } });
  });

  it('refuses a hotel beyond the list limit with E5131', async () => {
    const { svc, hotelRepo } = harness();
    hotelRepo.count.mockResolvedValueOnce(PILOT_HOTEL_LIMIT);
    expect((await rejected(svc.addHotel(1, ACTOR, { hotel_sn: '1' })))?.errorCode).toBe('E5131');
  });

  it('keeps tenants apart — another tenant\'s identical serial is a different row', async () => {
    const { svc, rows } = harness([{ hotelSn: '1721', tenantId: 2 }]);
    await svc.addHotel(1, ACTOR, { hotel_sn: '1721' });
    expect(rows.map((r) => [r.tenantId, r.hotelSn])).toEqual([[2, '1721'], [1, '1721']]);
  });
});

describe('PilotAdminService.importHotels — paste / CSV with a dry run', () => {
  const SEED = [{ hotelSn: '1721' }, { hotelSn: '2204', active: 0 }];
  const TEXT = 'hotel_sn,note\n1721,already\n2204,again\n3307,new\n3307,twice\nbad one!,x\n4410';

  it('dry run: reports counts, duplicates and invalid lines and writes NOTHING', async () => {
    const { svc, rows, hotelRepo, pilot, audit } = harness(SEED);
    const out = await svc.importHotels(1, ACTOR, { text: TEXT, dry_run: true });

    expect(out.dryRun).toBe(true);
    expect(out.headerSkipped).toBe(true);
    expect(out.plan.counts).toEqual({ added: 2, reactivated: 1, existing: 1, duplicate: 1, invalid: 1 });
    expect(out.plan.rows.find((r) => r.status === 'invalid')).toMatchObject({ line: 6, raw: 'bad one!' });
    expect(rows).toHaveLength(2);
    expect(hotelRepo.save).not.toHaveBeenCalled();
    expect(hotelRepo.update).not.toHaveBeenCalled();
    expect(pilot.invalidate).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('the real import does exactly what the dry run promised', async () => {
    const { svc, rows } = harness(SEED);
    const preview = await svc.importHotels(1, ACTOR, { text: TEXT, dry_run: true });
    const done = await svc.importHotels(1, ACTOR, { text: TEXT });

    expect(done.dryRun).toBe(false);
    expect(done.plan.counts).toEqual(preview.plan.counts);
    // 1721 untouched, 2204 resumed, 3307 and 4410 added once; the duplicate and the invalid line did nothing.
    expect(rows.map((r) => [r.hotelSn, r.active, r.note])).toEqual([
      ['1721', 1, null],
      ['2204', 1, 'again'],
      ['3307', 1, 'new'],
      ['4410', 1, null],
    ]);
    expect(rows.find((r) => r.hotelSn === '3307')?.addedBy).toBe(ACTOR);
  });

  it('writes one audit row for the whole import, drops the snapshot once, keeps the serials as business keys', async () => {
    const { svc, audit, pilot } = harness(SEED);
    await svc.importHotels(1, ACTOR, { text: TEXT });
    expect(pilot.invalidate).toHaveBeenCalledTimes(1);
    expect(auditActions(audit)).toEqual(['tenant.pilot_hotel_added']);
    expect(audit.write.mock.calls[0][0]).toMatchObject({
      tenantId: 1,
      target: 'pilot hotels (bulk)',
      metadata: { mode: 'bulk', added: 2, resumed: 1, sample: ['3307', '4410', '2204'] },
    });
  });

  it('pasting what is already there is not an error and writes nothing', async () => {
    const { svc, audit, pilot, hotelRepo } = harness([{ hotelSn: '1721' }]);
    const out = await svc.importHotels(1, ACTOR, { text: '1721' });
    expect(out.plan.counts).toMatchObject({ existing: 1, added: 0 });
    expect(hotelRepo.save).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
    expect(pilot.invalidate).not.toHaveBeenCalled();
  });

  it('refuses an empty paste, a header-only file, and one with too many lines with E5134', async () => {
    const { svc } = harness();
    expect((await rejected(svc.importHotels(1, ACTOR, { text: '   \n ' })))?.errorCode).toBe('E5134');
    expect((await rejected(svc.importHotels(1, ACTOR, { text: 'hotel_sn,note' })))?.errorCode).toBe('E5134');
    const huge = Array.from({ length: PILOT_IMPORT_MAX_ROWS + 1 }, (_, i) => String(i + 1)).join('\n');
    expect((await rejected(svc.importHotels(1, ACTOR, { text: huge })))?.errorCode).toBe('E5134');
  });

  it('flags an import that would pass the limit: the dry run says so, the real one refuses with E5131', async () => {
    const { svc, hotelRepo } = harness();
    hotelRepo.find.mockResolvedValue(Array.from({ length: PILOT_HOTEL_LIMIT - 1 }, (_, i) => ({ hotelSn: `h${i}`, active: 1 })) as never);
    const preview = await svc.importHotels(1, ACTOR, { text: '900001\n900002', dry_run: true });
    expect(preview.exceedsLimit).toBe(true);
    expect((await rejected(svc.importHotels(1, ACTOR, { text: '900001\n900002' })))?.errorCode).toBe('E5131');
    expect(hotelRepo.save).not.toHaveBeenCalled();
  });

  it('reads a CSV exported from Excel: BOM, CRLF, quotes', async () => {
    const { svc, rows } = harness();
    await svc.importHotels(1, ACTOR, { text: '﻿hotel_sn,note\r\n"1721","batch, one"\r\n2204,\r\n' });
    expect(rows.map((r) => [r.hotelSn, r.note])).toEqual([['1721', 'batch, one'], ['2204', null]]);
  });
});

describe('PilotAdminService.setHotelActive / removeHotel', () => {
  it('pausing a hotel keeps the row, drops the snapshot and audits it as removed from the list', async () => {
    const { svc, rows, pilot, audit } = harness([{ hotelSn: '1721', note: 'batch 1' }]);
    const out = await svc.setHotelActive(1, ACTOR, '1721', false);
    expect(out.active).toBe(0);
    expect(rows[0].note).toBe('batch 1');
    expect(pilot.invalidate).toHaveBeenCalledWith(1);
    expect(auditActions(audit)).toEqual(['tenant.pilot_hotel_removed']);
    expect(audit.write.mock.calls[0][0]).toMatchObject({ target: 'hotel:1721', metadata: { mode: 'paused' } });
  });

  it('resuming audits it as added', async () => {
    const { svc, audit } = harness([{ hotelSn: '1721', active: 0 }]);
    await svc.setHotelActive(1, ACTOR, '1721', true);
    expect(auditActions(audit)).toEqual(['tenant.pilot_hotel_added']);
    expect(audit.write.mock.calls[0][0]).toMatchObject({ metadata: { mode: 'resumed' } });
  });

  it('setting the state it already has is a no-op — no write, no audit', async () => {
    const { svc, hotelRepo, audit, pilot } = harness([{ hotelSn: '1721' }]);
    await svc.setHotelActive(1, ACTOR, '1721', true);
    expect(hotelRepo.save).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
    expect(pilot.invalidate).not.toHaveBeenCalled();
  });

  it('removing a hotel deletes the row, drops the snapshot and audits tenant.pilot_hotel_removed', async () => {
    const { svc, rows, pilot, audit } = harness([{ hotelSn: '1721' }, { hotelSn: '2204' }]);
    await svc.removeHotel(1, ACTOR, '1721');
    expect(rows.map((r) => r.hotelSn)).toEqual(['2204']);
    expect(pilot.invalidate).toHaveBeenCalledWith(1);
    expect(auditActions(audit)).toEqual(['tenant.pilot_hotel_removed']);
    expect(audit.write.mock.calls[0][0]).toMatchObject({ target: 'hotel:1721', metadata: { mode: 'deleted' } });
  });

  it('answers 404 E5132 for a hotel that is not in the list, 400 E5130 for a non-serial', async () => {
    const { svc, rows } = harness([{ hotelSn: '1721' }]);
    const missing = await rejected(svc.removeHotel(1, ACTOR, '9999'));
    expect(missing?.errorCode).toBe('E5132');
    expect(missing?.getStatus?.()).toBe(404);
    expect((await rejected(svc.setHotelActive(1, ACTOR, '9999', false)))?.errorCode).toBe('E5132');
    expect((await rejected(svc.removeHotel(1, ACTOR, 'not a serial')))?.errorCode).toBe('E5130');
    expect(rows).toHaveLength(1);
  });

  it('never reaches another tenant\'s row with the same serial', async () => {
    const { svc, rows } = harness([{ hotelSn: '1721', tenantId: 2 }]);
    expect((await rejected(svc.removeHotel(1, ACTOR, '1721')))?.errorCode).toBe('E5132');
    expect(rows).toHaveLength(1);
  });

  it('a failing audit write never fails the removal', async () => {
    const { svc, audit, rows } = harness([{ hotelSn: '1721' }]);
    audit.write.mockRejectedValueOnce(new Error('audit down'));
    await expect(svc.removeHotel(1, ACTOR, '1721')).resolves.toBeUndefined();
    expect(rows).toHaveLength(0);
  });
});

describe('PilotAdminService.listHotels', () => {
  it('searches serial prefix OR note, with LIKE wildcards treated literally', async () => {
    const { svc, hotelRepo } = harness();
    await svc.listHotels(1, { page: 2, size: 20, q: ' 17%_\\21 ', active: true });
    const call = hotelRepo.findAndCount.mock.calls[0][0] as { where: Array<Record<string, unknown>>; skip: number; take: number };
    expect(call.skip).toBe(20);
    expect(call.take).toBe(20);
    expect(call.where).toHaveLength(2);
    const [bySn, byNote] = call.where;
    expect(bySn).toMatchObject({ tenantId: 1, active: 1 });
    expect(JSON.stringify((bySn.hotelSn as { _value: string })._value)).toBe('"1721%"');
    expect(JSON.stringify((byNote.note as { _value: string })._value)).toBe('"%1721%"');
  });

  it('without a search it is one tenant-scoped clause', async () => {
    const { svc, hotelRepo } = harness();
    await svc.listHotels(1, { page: 1, size: 20 });
    const call = hotelRepo.findAndCount.mock.calls[0][0] as { where: Array<Record<string, unknown>> };
    expect(call.where).toEqual([{ tenantId: 1 }]);
  });
});
