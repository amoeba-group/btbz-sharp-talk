import { HotelProvinceService } from './hotel-province.service';
import {
  HOTEL_CSV_MAX_ROWS,
  HOTEL_CSV_PROBLEMS_SHOWN,
  HOTEL_SN_MAX_LEN,
  parseHotelProvinceCsv,
} from './hotel-province-csv.util';
import { HotelProvince } from './entity/hotel-province.entity';
import { BusinessException } from '../../global/exception/business.exception';
import type { HandoffConfig } from './entity/tenant-ai-config.entity';

/**
 * The hotel → province CSV (PLN-261012 SG-67): the reader, the dry-run preview and the
 * transactional replace-all. The "trust" rule — only a SIGNED hotelSn ever reaches this table, never
 * an unsigned name — is a router rule and is covered next to the router; here the file is the input.
 */
const csv = (...lines: string[]) => lines.join('\r\n') + '\r\n';
const buf = (text: string) => Buffer.from(text, 'utf8');

function fatalOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    expect((e as BusinessException).errorCode).toBe('E5127');
    return (e as BusinessException).details?.file ?? [];
  }
  throw new Error('expected a rejection');
}

describe('parseHotelProvinceCsv', () => {
  it('reads hotel_sn and province, in any order, with any common header spelling', () => {
    for (const header of ['hotel_sn,province', 'province,hotel_sn', 'Hotel SN,Province', 'hotelSn,Province Name', 'HOTEL_ID,Tinh']) {
      const cols = header.split(',');
      const row = cols.map((c) => (/hotel|sn|id/i.test(c) ? '1721' : 'Đà Nẵng')).join(',');
      const out = parseHotelProvinceCsv(csv(header, row));
      expect(out.rows).toEqual([{ line: 2, hotelSn: '1721', province: 'Đà Nẵng' }]);
      expect(out.problems).toEqual([]);
    }
  });

  it('ignores other columns — a hotel NAME is display text and is never a key', () => {
    const out = parseHotelProvinceCsv(csv('hotel_sn,hotel_name,province', '1721,A In Hotel Del Luna,Đà Nẵng'));
    expect(out.rows).toEqual([{ line: 2, hotelSn: '1721', province: 'Đà Nẵng' }]);
  });

  it('survives a UTF-8 BOM, quoted commas and blank trailing lines', () => {
    const out = parseHotelProvinceCsv('﻿hotel_sn,province\r\n"1,721","Bà Rịa, Vũng Tàu"\r\n\r\n\r\n');
    expect(out.rows).toEqual([{ line: 2, hotelSn: '1,721', province: 'Bà Rịa, Vũng Tàu' }]);
  });

  it('trims cells', () => {
    expect(parseHotelProvinceCsv(csv('hotel_sn,province', '  1721 ,  Hà Nội  ')).rows[0]).toMatchObject({ hotelSn: '1721', province: 'Hà Nội' });
  });

  it('is fatal without a header naming both columns, or with nothing in it', () => {
    expect(fatalOf(() => parseHotelProvinceCsv(csv('id,city', '1,Hà Nội')))[0]).toContain('hotel_sn column and a province column');
    expect(fatalOf(() => parseHotelProvinceCsv(csv('hotel_sn', '1721')))[0]).toContain('province column');
    expect(fatalOf(() => parseHotelProvinceCsv(''))[0]).toContain('empty');
  });

  it('is fatal over the row limit', () => {
    const rows = Array.from({ length: HOTEL_CSV_MAX_ROWS + 1 }, (_, i) => `${i},Hà Nội`);
    expect(fatalOf(() => parseHotelProvinceCsv(csv('hotel_sn,province', ...rows)))[0]).toContain(String(HOTEL_CSV_MAX_ROWS));
    // Exactly at the limit is fine.
    expect(parseHotelProvinceCsv(csv('hotel_sn,province', ...rows.slice(0, HOTEL_CSV_MAX_ROWS))).rows).toHaveLength(HOTEL_CSV_MAX_ROWS);
  });

  it('reports malformed rows with their row number instead of stopping', () => {
    const out = parseHotelProvinceCsv(
      csv(
        'hotel_sn,province',
        '1,Hà Nội',
        ',Hà Nội', // row 3: no hotel_sn
        '3,', // row 4: no province
        `${'9'.repeat(HOTEL_SN_MAX_LEN + 1)},Hà Nội`, // row 5: too long
        '5,Đà Nẵng\u0007', // row 6: control character
        `6,${'x'.repeat(81)}`, // row 7: province too long
        '7,Cần Thơ',
      ),
    );
    expect(out.rows.map((r) => r.hotelSn)).toEqual(['1', '7']);
    expect(out.problems.map((p) => p.line)).toEqual([3, 4, 5, 6, 7]);
    expect(out.problems[0].reason).toContain('hotel_sn is empty');
    expect(out.problems[1].reason).toContain('province is empty');
    expect(out.problems[2].reason).toContain('longer than 64');
    expect(out.problems[3].reason).toContain('control character');
    expect(out.problems[4].reason).toContain('longer than 80');
  });

  it('treats an identical repeat as a harmless duplicate and a conflicting repeat as a problem', () => {
    const out = parseHotelProvinceCsv(csv('hotel_sn,province', '1,Hà Nội', '1,Hà Nội', '2,Đà Nẵng', '2,Cần Thơ'));
    expect(out.rows.map((r) => r.hotelSn)).toEqual(['1', '2']);
    expect(out.duplicates).toBe(1);
    expect(out.problems).toEqual([{ line: 5, hotelSn: '2', reason: 'hotel_sn repeats row 4 with a different province' }]);
  });

  it('compares hotel_sn case-insensitively, like the unique key will', () => {
    const out = parseHotelProvinceCsv(csv('hotel_sn,province', 'ab1,Hà Nội', 'AB1,Đà Nẵng'));
    expect(out.rows).toHaveLength(1);
    expect(out.problems).toHaveLength(1);
  });
});

describe('HotelProvinceService', () => {
  const REGION_TABLE: HandoffConfig = {
    regionRouting: {
      enabled: true,
      categories: [
        { id: 'north', team: 'north', provinces: ['Hà Nội'] },
        { id: 'south_central', team: 'south', provinces: ['Đà Nẵng'] },
      ],
    },
  };

  function build(opts: { existing?: number; otherTenantRows?: number; config?: HandoffConfig | null; insertFails?: boolean } = {}) {
    // `committed` is the table as a reader sees it; a transaction works on a copy and only a
    // successful callback commits it — which is the property the replace-all must have.
    let committed: Array<{ tenantId: number; hotelSn: string; province: string }> = Array.from({ length: opts.existing ?? 0 }, (_, i) => ({
      tenantId: 1,
      hotelSn: `old${i}`,
      province: 'Hà Nội',
    }));
    committed.push(...Array.from({ length: opts.otherTenantRows ?? 0 }, (_, i) => ({ tenantId: 2, hotelSn: `t2-${i}`, province: 'Đà Nẵng' })));
    const events: string[] = [];
    const repo = {
      count: jest.fn(async (q: { where: { tenantId: number } }) => committed.filter((r) => r.tenantId === q.where.tenantId).length),
      findOne: jest.fn(async () => (committed[0] ? { ...committed[0], updatedAt: new Date('2026-10-15T09:00:00Z') } : null)),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) => {
        let working = committed.map((r) => ({ ...r }));
        const manager = {
          delete: jest.fn(async (_e: unknown, where: { tenantId: number }) => {
            events.push('delete');
            working = working.filter((r) => r.tenantId !== where.tenantId);
          }),
          insert: jest.fn(async (entity: unknown, rows: Array<{ tenantId: number; hotelSn: string; province: string }>) => {
            expect(entity).toBe(HotelProvince);
            events.push(`insert:${rows.length}`);
            if (opts.insertFails) throw new Error('insert failed');
            working.push(...rows);
          }),
        };
        await cb(manager);
        committed = working; // only reached when the callback did not throw
      }),
    };
    const audit = { write: jest.fn(async () => undefined) };
    const router = { invalidateHotelProvinces: jest.fn() };
    const aiConfig = { getHandoffConfig: jest.fn(async () => (opts.config === undefined ? REGION_TABLE : opts.config)) };
    const svc = new HotelProvinceService(repo as never, dataSource as never, aiConfig as never, router as never, audit as never);
    return { svc, repo, dataSource, audit, router, events, table: () => committed };
  }

  const file = (text: string, name = 'hotels.csv') => ({ name, buffer: buf(text) });

  describe('dry run (preview)', () => {
    it('counts rows, provinces, duplicates and what the table already holds — and writes nothing', async () => {
      const h = build({ existing: 3 });
      const out = await h.svc.importCsv(1, 7, file(csv('hotel_sn,province', '1,Hà Nội', '2,Hà Nội', '3,Đà Nẵng', '3,Đà Nẵng')), true);
      expect(out).toMatchObject({ dryRun: true, applied: false, rows: 3, duplicates: 1, problemCount: 0, provinces: 2, existingRows: 3, regionRoutingEnabled: true });
      expect(h.dataSource.transaction).not.toHaveBeenCalled();
      expect(h.table()).toHaveLength(3);
      expect(h.audit.write).not.toHaveBeenCalled();
      expect(h.router.invalidateHotelProvinces).not.toHaveBeenCalled();
    });

    it('lists the provinces the region table does not know, with how many hotels use each', async () => {
      const h = build();
      const out = await h.svc.importCsv(
        1,
        7,
        file(csv('hotel_sn,province', '1,Hà Nội', '2,Tp Quy Nhơn', '3,Tp Quy Nhơn', '4,Pleiku', '5,Ha Noi')),
        true,
      );
      expect(out.unmappedCount).toBe(2);
      expect(out.unmappedProvinces).toEqual([
        { province: 'Tp Quy Nhơn', hotels: 2 },
        { province: 'Pleiku', hotels: 1 },
      ]);
      // "Hà Nội" and "Ha Noi" are one province once normalised.
      expect(out.provinces).toBe(3);
    });

    it('reports no unmapped provinces when region routing is off, and says so', async () => {
      const off = build({ config: { regionRouting: { ...REGION_TABLE.regionRouting!, enabled: false } } });
      const out = await off.svc.importCsv(1, 7, file(csv('hotel_sn,province', '1,Pleiku')), true);
      expect(out).toMatchObject({ regionRoutingEnabled: false, unmappedCount: 0, unmappedProvinces: [] });
      const none = build({ config: null });
      expect((await none.svc.importCsv(1, 7, file(csv('hotel_sn,province', '1,Pleiku')), true)).regionRoutingEnabled).toBe(false);
    });

    it('shows malformed rows (capped) and still previews', async () => {
      const rows = Array.from({ length: HOTEL_CSV_PROBLEMS_SHOWN + 10 }, () => ',Hà Nội');
      const h = build();
      const out = await h.svc.importCsv(1, 7, file(csv('hotel_sn,province', '1,Hà Nội', ...rows)), true);
      expect(out.rows).toBe(1);
      expect(out.problemCount).toBe(HOTEL_CSV_PROBLEMS_SHOWN + 10);
      expect(out.problems).toHaveLength(HOTEL_CSV_PROBLEMS_SHOWN);
      expect(out.problems[0]).toMatchObject({ line: 3, reason: 'hotel_sn is empty' });
    });
  });

  describe('replace-all', () => {
    it('replaces the tenant table in one transaction, clears the router cache and audits it', async () => {
      const h = build({ existing: 2 });
      const out = await h.svc.importCsv(1, 7, file(csv('hotel_sn,province', '1721,Đà Nẵng', '1722,Hà Nội')), false);

      expect(out).toMatchObject({ dryRun: false, applied: true, rows: 2, existingRows: 2 });
      expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(h.events).toEqual(['delete', 'insert:2']);
      expect(h.table().map((r) => r.hotelSn)).toEqual(['1721', '1722']); // the old rows are gone
      expect(h.router.invalidateHotelProvinces).toHaveBeenCalledWith(1);
      expect(h.audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 1, actorType: 'user', actorId: 7, action: 'ai_config.hotel_provinces_replaced', metadata: expect.objectContaining({ rows: 2, previousRows: 2 }) }),
      );
    });

    it('inserts in chunks of 500 inside the same transaction', async () => {
      const rows = Array.from({ length: 1200 }, (_, i) => `${i},Hà Nội`);
      const h = build();
      await h.svc.importCsv(1, 7, file(csv('hotel_sn,province', ...rows)), false);
      expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(h.events).toEqual(['delete', 'insert:500', 'insert:500', 'insert:200']);
    });

    it('a failure mid-way leaves the OLD table in place and clears nothing (all or nothing)', async () => {
      const h = build({ existing: 3, insertFails: true });
      await expect(h.svc.importCsv(1, 7, file(csv('hotel_sn,province', '1,Hà Nội')), false)).rejects.toThrow('insert failed');
      expect(h.table().map((r) => r.hotelSn)).toEqual(['old0', 'old1', 'old2']);
      expect(h.router.invalidateHotelProvinces).not.toHaveBeenCalled();
      expect(h.audit.write).not.toHaveBeenCalled();
    });

    it('only the calling tenant table is replaced', async () => {
      const h = build({ existing: 2, otherTenantRows: 3 });
      await h.svc.importCsv(1, 7, file(csv('hotel_sn,province', '1,Hà Nội')), false);
      expect(h.table().filter((r) => r.tenantId === 1).map((r) => r.hotelSn)).toEqual(['1']);
      expect(h.table().filter((r) => r.tenantId === 2)).toHaveLength(3);
      // The clear() is fenced the same way.
      await h.svc.clear(1, 7);
      expect(h.table().filter((r) => r.tenantId === 2)).toHaveLength(3);
    });

    it('refuses a file with ANY malformed row, naming the first ones, and changes nothing', async () => {
      const h = build({ existing: 2 });
      await expect(
        h.svc.importCsv(1, 7, file(csv('hotel_sn,province', '1,Hà Nội', ',Hà Nội', '3,')), false),
      ).rejects.toMatchObject({
        errorCode: 'E5127',
        details: { file: expect.arrayContaining([expect.stringContaining('2 row(s) are malformed'), 'row 3: hotel_sn is empty', 'row 4: province is empty']) },
      });
      expect(h.dataSource.transaction).not.toHaveBeenCalled();
      expect(h.table()).toHaveLength(2);
    });

    it('refuses an empty file rather than wiping the table; clear() empties it on purpose', async () => {
      const h = build({ existing: 2 });
      await expect(h.svc.importCsv(1, 7, file(csv('hotel_sn,province')), false)).rejects.toMatchObject({ errorCode: 'E5127' });
      expect(h.table()).toHaveLength(2);
      const out = await h.svc.clear(1, 7);
      expect(out).toEqual({ removed: 2 });
      expect(h.table()).toHaveLength(0);
      expect(h.router.invalidateHotelProvinces).toHaveBeenCalledWith(1);
      expect(h.audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_config.hotel_provinces_cleared' }));
    });

    it('a file that is not UTF-8 is refused with the reason, not mis-read as bad rows', async () => {
      const h = build();
      // 0xC3 0x28 is an invalid UTF-8 sequence; node decodes the bad byte to U+FFFD.
      const bad = { name: 'h.csv', buffer: Buffer.concat([buf('hotel_sn,province\r\n1,'), Buffer.from([0xc3, 0x28]), buf('\r\n')]) };
      await expect(h.svc.importCsv(1, 7, bad, true)).rejects.toMatchObject({
        errorCode: 'E5127',
        details: { file: [expect.stringContaining('UTF-8')] },
      });
    });
  });

  it('summary: row count and last change, or zero and null', async () => {
    const h = build({ existing: 4 });
    expect(await h.svc.summary(1)).toEqual({ rows: 4, updatedAt: new Date('2026-10-15T09:00:00Z') });
    expect(await build().svc.summary(1)).toEqual({ rows: 0, updatedAt: null });
  });
});
