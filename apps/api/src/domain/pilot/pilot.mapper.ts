import { PILOT_HOTEL_LIMIT, readPilotAccess } from '@sharptalk/types';
import type { PilotAccess } from '@sharptalk/types';
import { TenantPilotHotel } from './entity/tenant-pilot-hotel.entity';
import type {
  PilotAccessResponse,
  PilotHotelResponse,
  PilotImportResponse,
} from './dto/response/pilot.response';
import type { PilotImportPlan } from './pilot.util';

/** How many plan rows a preview echoes back; the counts always cover every line. */
const PREVIEW_ROWS = 100;
/** How many unusable lines are named; the rest are counted. */
const INVALID_ROWS = 50;

export class PilotMapper {
  /** A tenant that never configured it reads as the documented defaults, off. */
  static toAccess(
    stored: PilotAccess | null | undefined,
    counts: { active: number; total: number },
  ): PilotAccessResponse {
    const access = readPilotAccess(stored ?? {}) as PilotAccess;
    return {
      enabled: access.enabled,
      guestAllowed: access.guestAllowed,
      nonPilot: access.nonPilot,
      notice: access.notice,
      activeCount: counts.active,
      totalCount: counts.total,
      limit: PILOT_HOTEL_LIMIT,
    };
  }

  static toHotel(h: TenantPilotHotel): PilotHotelResponse {
    return {
      id: String(h.id),
      hotelSn: h.hotelSn,
      note: h.note ?? null,
      active: Number(h.active) === 1,
      addedBy: h.addedBy ?? null,
      createdAt: new Date(h.createdAt).toISOString(),
    };
  }

  static toImport(
    plan: PilotImportPlan,
    meta: { dryRun: boolean; headerSkipped: boolean; exceedsLimit: boolean },
  ): PilotImportResponse {
    const shape = (r: PilotImportPlan['rows'][number]) => ({
      line: r.line,
      hotelSn: r.hotelSn,
      raw: r.raw,
      note: r.note,
      status: r.status,
    });
    return {
      dryRun: meta.dryRun,
      headerSkipped: meta.headerSkipped,
      total: plan.rows.length,
      added: plan.counts.added,
      reactivated: plan.counts.reactivated,
      existing: plan.counts.existing,
      duplicate: plan.counts.duplicate,
      invalid: plan.counts.invalid,
      exceedsLimit: meta.exceedsLimit,
      rows: plan.rows.slice(0, PREVIEW_ROWS).map(shape),
      invalidRows: plan.rows.filter((r) => r.status === 'invalid').slice(0, INVALID_ROWS).map(shape),
    };
  }
}
