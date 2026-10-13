import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { normalizeProvince, resolveHotelRegion } from '@sharptalk/types';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { AuditService } from '../audit/audit.service';
import { AiConfigService } from './ai-config.service';
import { HandoffRouterService } from './handoff-router.service';
import { HotelProvince } from './entity/hotel-province.entity';
import {
  HOTEL_CSV_PROBLEMS_SHOWN,
  HotelCsvProblem,
  HotelCsvRow,
  parseHotelProvinceCsv,
} from './hotel-province-csv.util';

/** Rows per INSERT: well under MySQL's packet limit at ~100 bytes a row. */
const INSERT_CHUNK = 500;
/** Unlisted provinces named in the preview; the count is always exact. */
const UNMAPPED_SHOWN = 50;

/** What an upload (or its dry run) found — the console's preview card renders this. */
export interface HotelProvinceImportReport {
  dryRun: boolean;
  /** True only after a real run committed the new table. */
  applied: boolean;
  /** Usable rows in the file. */
  rows: number;
  /** Exact repeats of an earlier row, dropped. */
  duplicates: number;
  problemCount: number;
  /** The first HOTEL_CSV_PROBLEMS_SHOWN problems (row, reason). */
  problems: HotelCsvProblem[];
  /** Distinct provinces in the usable rows. */
  provinces: number;
  /**
   * Provinces the tenant's region table does not list, with how many hotels use each: a hotel
   * of such a province would be routed by label alone. Empty when region routing is off.
   */
  unmappedProvinces: Array<{ province: string; hotels: number }>;
  unmappedCount: number;
  /** Is the region table switched on? Without it the upload is stored but changes nothing yet. */
  regionRoutingEnabled: boolean;
  /** Rows the table holds now (a real run replaces them). */
  existingRows: number;
}

/**
 * The hotel → province table (PLN-261012 SG-67, REQ-261007 R3): the fallback for hosts that
 * sign a hotelSn but not the province. The console uploads a CSV; a dry run reports what it
 * holds (counts, provinces the region table misses, malformed rows) and a real run replaces
 * the tenant's whole table in ONE transaction, so a failed upload leaves the old table.
 *
 * A file with any malformed row is refused rather than partly applied: this is a
 * replace-all, and a silently dropped hotel would stop being routed by region with nothing
 * to show for it. An empty file is refused too (use `clear` to empty the table on purpose).
 */
@Injectable()
export class HotelProvinceService {
  private readonly logger = new Logger(HotelProvinceService.name);

  constructor(
    @InjectRepository(HotelProvince) private readonly repo: Repository<HotelProvince>,
    private readonly dataSource: DataSource,
    private readonly aiConfig: AiConfigService,
    private readonly router: HandoffRouterService,
    private readonly audit: AuditService,
  ) {}

  /** Row count and the time of the last change, for the console card. */
  async summary(tenantId: number): Promise<{ rows: number; updatedAt: Date | null }> {
    const rows = await this.repo.count({ where: { tenantId } });
    if (!rows) return { rows: 0, updatedAt: null };
    const latest = await this.repo.findOne({ where: { tenantId }, order: { updatedAt: 'DESC' } });
    return { rows, updatedAt: latest?.updatedAt ?? null };
  }

  /** Read, check and — unless `dryRun` — apply one CSV. */
  async importCsv(
    tenantId: number,
    actorUserId: number,
    file: { name: string; buffer: Buffer },
    dryRun: boolean,
  ): Promise<HotelProvinceImportReport> {
    const text = file.buffer.toString('utf8');
    // CP949 / Windows-1258 Excel "CSV" decodes to U+FFFD under utf8: say so, instead of
    // reporting every row as a different kind of failure.
    if (text.includes('�')) {
      this.logger.warn(`hotel province upload rejected: not valid UTF-8 (tenant ${tenantId})`);
      throw new BusinessException(ERROR_CODE.HOTEL_PROVINCE_CSV_INVALID, HttpStatus.BAD_REQUEST, {
        file: ['the file must be UTF-8 (save the CSV as "CSV UTF-8")'],
      });
    }
    const parsed = parseHotelProvinceCsv(text);
    const report = await this.report(tenantId, parsed.rows, parsed.duplicates, parsed.problems, dryRun);
    if (dryRun) return report;

    if (parsed.problems.length > 0) {
      this.logger.warn(`hotel province upload refused: ${parsed.problems.length} malformed row(s) (tenant ${tenantId})`);
      throw new BusinessException(ERROR_CODE.HOTEL_PROVINCE_CSV_INVALID, HttpStatus.BAD_REQUEST, {
        file: [
          `${parsed.problems.length} row(s) are malformed — fix them and upload again`,
          ...parsed.problems.slice(0, 5).map((p) => `row ${p.line}: ${p.reason}`),
        ],
      });
    }
    if (parsed.rows.length === 0) {
      throw new BusinessException(ERROR_CODE.HOTEL_PROVINCE_CSV_INVALID, HttpStatus.BAD_REQUEST, {
        file: ['the file has no hotel rows; to empty the table use "Clear table"'],
      });
    }

    await this.replaceAll(tenantId, parsed.rows);
    this.router.invalidateHotelProvinces(tenantId);
    await this.audit
      .write({
        tenantId,
        actorType: 'user',
        actorId: actorUserId,
        action: 'ai_config.hotel_provinces_replaced',
        target: `tenant:${tenantId}`,
        metadata: { rows: parsed.rows.length, previousRows: report.existingRows, unmappedProvinces: report.unmappedCount },
      })
      .catch((e: Error) => this.logger.warn(`hotel province audit failed: ${e.message}`));
    return { ...report, applied: true };
  }

  /** Empty the table on purpose (an upload with no rows is refused instead). */
  async clear(tenantId: number, actorUserId: number): Promise<{ removed: number }> {
    const removed = await this.repo.count({ where: { tenantId } });
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(HotelProvince, { tenantId });
    });
    this.router.invalidateHotelProvinces(tenantId);
    await this.audit
      .write({
        tenantId,
        actorType: 'user',
        actorId: actorUserId,
        action: 'ai_config.hotel_provinces_cleared',
        target: `tenant:${tenantId}`,
        metadata: { removed },
      })
      .catch((e: Error) => this.logger.warn(`hotel province audit failed: ${e.message}`));
    return { removed };
  }

  /** Delete + insert in one transaction: the table is the old one or the new one, never a mix. */
  private async replaceAll(tenantId: number, rows: HotelCsvRow[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(HotelProvince, { tenantId });
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await manager.insert(
          HotelProvince,
          rows.slice(i, i + INSERT_CHUNK).map((r) => ({ tenantId, hotelSn: r.hotelSn, province: r.province })),
        );
      }
    });
  }

  private async report(
    tenantId: number,
    rows: HotelCsvRow[],
    duplicates: number,
    problems: HotelCsvProblem[],
    dryRun: boolean,
  ): Promise<HotelProvinceImportReport> {
    const config = await this.aiConfig.getHandoffConfig(tenantId);
    const routing = config?.regionRouting;
    const enabled = routing?.enabled === true;

    // Provinces by their normalised key, so "Hà Nội" and "Ha Noi" count as one.
    const byProvince = new Map<string, { province: string; hotels: number }>();
    for (const row of rows) {
      const key = normalizeProvince(row.province) || row.province;
      const entry = byProvince.get(key);
      if (entry) entry.hotels += 1;
      else byProvince.set(key, { province: row.province, hotels: 1 });
    }
    const unmapped = enabled
      ? [...byProvince.values()]
          .filter((p) => !resolveHotelRegion(routing, p.province))
          .sort((a, b) => b.hotels - a.hotels || a.province.localeCompare(b.province))
      : [];

    return {
      dryRun,
      applied: false,
      rows: rows.length,
      duplicates,
      problemCount: problems.length,
      problems: problems.slice(0, HOTEL_CSV_PROBLEMS_SHOWN),
      provinces: byProvince.size,
      unmappedProvinces: unmapped.slice(0, UNMAPPED_SHOWN),
      unmappedCount: unmapped.length,
      regionRoutingEnabled: enabled,
      existingRows: await this.repo.count({ where: { tenantId } }),
    };
  }
}
