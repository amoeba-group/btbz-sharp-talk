import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Like, Repository } from 'typeorm';
import {
  PILOT_HOTEL_LIMIT,
  PILOT_NON_PILOT,
  PILOT_NOTE_MAX_LENGTH,
  PILOT_NOTICE_MAX_LENGTH,
  SESSION_LANGUAGE_CODES,
  normalizeHotelSn,
} from '@sharptalk/types';
import type { PilotAccess, SessionLanguage } from '@sharptalk/types';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { AuditService } from '../audit/audit.service';
import { Tenant } from '../tenant/entity/tenant.entity';
import { TenantPilotHotel } from './entity/tenant-pilot-hotel.entity';
import { PilotService } from './pilot.service';
import {
  PILOT_IMPORT_MAX_CHARS,
  PILOT_IMPORT_MAX_ROWS,
  parseHotelInput,
  planHotelImport,
} from './pilot.util';
import type { PilotImportPlan } from './pilot.util';
import type {
  AddPilotHotelRequest,
  ImportPilotHotelsRequest,
  UpdatePilotAccessRequest,
} from './dto/request/pilot.request';

/** Rows written per statement — keeps one import from building a giant INSERT. */
const WRITE_CHUNK = 500;
/** Serials named in an audit row; the rest are counted. */
const AUDIT_SAMPLE = 20;

export interface PilotCounts {
  active: number;
  total: number;
}

export interface PilotImportOutcome {
  plan: PilotImportPlan;
  dryRun: boolean;
  headerSkipped: boolean;
  exceedsLimit: boolean;
}

/**
 * Console side of the pilot allowlist (PLN-261012 SG-40): the switch, the list,
 * and the bulk paths. Every change drops the Redis snapshot so it is live on the
 * next turn, and is audited — hotel serials are business keys, so they go into
 * the audit row in clear; the audit write never fails the change itself.
 */
@Injectable()
export class PilotAdminService {
  private readonly logger = new Logger(PilotAdminService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantPilotHotel) private readonly hotelRepo: Repository<TenantPilotHotel>,
    private readonly audit: AuditService,
    private readonly pilot: PilotService,
  ) {}

  // ---- the switch -----------------------------------------------------------

  async getAccess(tenantId: number): Promise<{ stored: PilotAccess | null; counts: PilotCounts }> {
    const tenant = await this.requireTenant(tenantId);
    return { stored: tenant.pilotAccess ?? null, counts: await this.counts(tenantId) };
  }

  /**
   * Store the switch whole. Switching it on with an empty list is allowed on
   * purpose: with the list in force and nothing on it nobody identified is served,
   * which is also how an operator closes the pilot. The console warns about it;
   * refusing it here would remove that.
   */
  async updateAccess(
    tenantId: number,
    actorId: number,
    body: UpdatePilotAccessRequest,
  ): Promise<{ stored: PilotAccess; counts: PilotCounts }> {
    if (body.non_pilot !== PILOT_NON_PILOT.HIDE && body.non_pilot !== PILOT_NON_PILOT.NOTICE) {
      this.reject(`pilot settings refused (tenant ${tenantId}): unknown non_pilot`, ERROR_CODE.PILOT_ACCESS_INVALID);
    }
    const notice = this.validateNotice(tenantId, body.notice);
    const tenant = await this.requireTenant(tenantId);
    const next: PilotAccess = {
      enabled: body.enabled === true,
      guestAllowed: body.guest_allowed !== false,
      nonPilot: body.non_pilot,
      notice,
    };
    tenant.pilotAccess = next;
    await this.tenantRepo.save(tenant);
    await this.pilot.invalidate(tenantId);
    await this.audit
      .write({
        tenantId,
        actorType: 'user',
        actorId,
        action: 'tenant.pilot_updated',
        target: next.enabled ? 'pilot: on' : 'pilot: off',
        metadata: {
          enabled: next.enabled,
          guestAllowed: next.guestAllowed,
          nonPilot: next.nonPilot,
          noticeLanguages: Object.keys(next.notice),
        },
      })
      .catch(() => undefined);
    return { stored: next, counts: await this.counts(tenantId) };
  }

  // ---- the list ---------------------------------------------------------------

  async listHotels(
    tenantId: number,
    q: { page: number; size: number; q?: string; active?: boolean },
  ): Promise<{ items: TenantPilotHotel[]; total: number }> {
    const base: FindOptionsWhere<TenantPilotHotel> = { tenantId };
    if (q.active !== undefined) base.active = q.active ? 1 : 0;
    // LIKE wildcards in the search box are literal characters, not patterns.
    const needle = (q.q ?? '').trim().replace(/[%_\\]/g, '');
    const where: FindOptionsWhere<TenantPilotHotel>[] = needle
      ? [
          { ...base, hotelSn: Like(`${needle}%`) },
          { ...base, note: Like(`%${needle}%`) },
        ]
      : [base];
    const [items, total] = await this.hotelRepo.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (q.page - 1) * q.size,
      take: q.size,
    });
    return { items, total };
  }

  async addHotel(tenantId: number, actorId: number, body: AddPilotHotelRequest): Promise<TenantPilotHotel> {
    const hotelSn = normalizeHotelSn(body.hotel_sn);
    if (!hotelSn) {
      this.reject(`pilot hotel refused (tenant ${tenantId}): not a serial`, ERROR_CODE.PILOT_HOTEL_SN_INVALID);
    }
    const note = body.note?.trim() ? body.note.trim().slice(0, PILOT_NOTE_MAX_LENGTH) : null;

    const existing = await this.hotelRepo.findOne({ where: { tenantId, hotelSn: hotelSn as string } });
    if (existing) {
      // Adding it again is idempotent; adding a paused one resumes it.
      if (Number(existing.active) === 1) return existing;
      existing.active = 1;
      if (note) existing.note = note;
      const resumed = await this.hotelRepo.save(existing);
      await this.afterChange(tenantId, actorId, 'tenant.pilot_hotel_added', `hotel:${hotelSn}`, {
        hotelSn,
        mode: 'resumed',
      });
      return resumed;
    }

    if ((await this.hotelRepo.count({ where: { tenantId } })) >= PILOT_HOTEL_LIMIT) {
      this.reject(`pilot list full (tenant ${tenantId})`, ERROR_CODE.PILOT_HOTEL_LIMIT);
    }
    const saved = await this.hotelRepo.save(
      this.hotelRepo.create({ tenantId, hotelSn: hotelSn as string, note, active: 1, addedBy: actorId }),
    );
    await this.afterChange(tenantId, actorId, 'tenant.pilot_hotel_added', `hotel:${hotelSn}`, {
      hotelSn,
      mode: 'single',
    });
    return saved;
  }

  /**
   * Paste a list / import a CSV. `dry_run` returns the same plan the real import
   * would execute, without writing — the console shows it and only then asks
   * again without the flag. The plan is computed by one pure function, so the
   * preview cannot promise something the import does differently.
   */
  async importHotels(
    tenantId: number,
    actorId: number,
    body: ImportPilotHotelsRequest,
  ): Promise<PilotImportOutcome> {
    const dryRun = body.dry_run === true;
    const text = String(body.text ?? '');
    if (!text.trim() || text.length > PILOT_IMPORT_MAX_CHARS) {
      this.reject(`pilot import refused (tenant ${tenantId}): empty or too large`, ERROR_CODE.PILOT_IMPORT_INVALID);
    }
    const parsed = parseHotelInput(text);
    if (parsed.rows.length === 0 || parsed.rows.length > PILOT_IMPORT_MAX_ROWS) {
      this.reject(
        `pilot import refused (tenant ${tenantId}): ${parsed.rows.length} data line(s)`,
        ERROR_CODE.PILOT_IMPORT_INVALID,
      );
    }

    const stored = await this.hotelRepo.find({ where: { tenantId }, select: { hotelSn: true, active: true } });
    const existing = new Map(stored.map((r) => [r.hotelSn, Number(r.active) === 1]));
    const plan = planHotelImport(parsed.rows, existing);
    const exceedsLimit = stored.length + plan.counts.added > PILOT_HOTEL_LIMIT;
    const outcome = { plan, dryRun, headerSkipped: parsed.headerSkipped, exceedsLimit };
    if (dryRun) return outcome;

    if (exceedsLimit) {
      this.reject(`pilot list would exceed its limit (tenant ${tenantId})`, ERROR_CODE.PILOT_HOTEL_LIMIT);
    }
    // Nothing to write is not an error — the operator pasted what was already there.
    const toAdd = plan.rows.filter((r) => r.status === 'added');
    const toResume = plan.rows.filter((r) => r.status === 'reactivated');
    if (toAdd.length) {
      const entities = toAdd.map((r) =>
        this.hotelRepo.create({
          tenantId,
          hotelSn: r.hotelSn as string,
          note: r.note,
          active: 1,
          addedBy: actorId,
        }),
      );
      await this.hotelRepo.save(entities, { chunk: WRITE_CHUNK });
    }
    for (const r of toResume) {
      // A paused hotel pasted again is switched back on; its old note stays unless a new one came with it.
      await this.hotelRepo.update(
        { tenantId, hotelSn: r.hotelSn as string },
        r.note ? { active: 1, note: r.note } : { active: 1 },
      );
    }
    if (toAdd.length || toResume.length) {
      await this.afterChange(tenantId, actorId, 'tenant.pilot_hotel_added', 'pilot hotels (bulk)', {
        mode: 'bulk',
        added: toAdd.length,
        resumed: toResume.length,
        sample: [...toAdd, ...toResume].slice(0, AUDIT_SAMPLE).map((r) => r.hotelSn),
      });
    }
    return outcome;
  }

  /** Pause (`active: false`) or resume one hotel — its note is kept either way. */
  async setHotelActive(
    tenantId: number,
    actorId: number,
    hotelSnParam: string,
    active: boolean,
  ): Promise<TenantPilotHotel> {
    const row = await this.requireHotel(tenantId, hotelSnParam);
    if ((Number(row.active) === 1) === active) return row;
    row.active = active ? 1 : 0;
    const saved = await this.hotelRepo.save(row);
    await this.afterChange(
      tenantId,
      actorId,
      active ? 'tenant.pilot_hotel_added' : 'tenant.pilot_hotel_removed',
      `hotel:${row.hotelSn}`,
      { hotelSn: row.hotelSn, mode: active ? 'resumed' : 'paused' },
    );
    return saved;
  }

  async removeHotel(tenantId: number, actorId: number, hotelSnParam: string): Promise<void> {
    const row = await this.requireHotel(tenantId, hotelSnParam);
    await this.hotelRepo.delete({ id: row.id, tenantId });
    await this.afterChange(tenantId, actorId, 'tenant.pilot_hotel_removed', `hotel:${row.hotelSn}`, {
      hotelSn: row.hotelSn,
      mode: 'deleted',
    });
  }

  // ---- internals --------------------------------------------------------------

  private async counts(tenantId: number): Promise<PilotCounts> {
    const [active, total] = await Promise.all([
      this.hotelRepo.count({ where: { tenantId, active: 1 } }),
      this.hotelRepo.count({ where: { tenantId } }),
    ]);
    return { active, total };
  }

  private async requireTenant(tenantId: number): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    return tenant;
  }

  private async requireHotel(tenantId: number, hotelSnParam: string): Promise<TenantPilotHotel> {
    const hotelSn = normalizeHotelSn(hotelSnParam);
    if (!hotelSn) {
      this.reject(`pilot hotel refused (tenant ${tenantId}): not a serial`, ERROR_CODE.PILOT_HOTEL_SN_INVALID);
    }
    const row = await this.hotelRepo.findOne({ where: { tenantId, hotelSn: hotelSn as string } });
    if (!row) {
      this.logger.warn(`pilot hotel not found (tenant ${tenantId}, hotel ${hotelSn})`);
      throw new BusinessException(ERROR_CODE.PILOT_HOTEL_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return row;
  }

  /** A change landed: make the next turn see it, then leave an audit row. */
  private async afterChange(
    tenantId: number,
    actorId: number,
    action: string,
    target: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.pilot.invalidate(tenantId);
    await this.audit
      .write({ tenantId, actorType: 'user', actorId, action, target, metadata })
      .catch(() => undefined);
  }

  /** Languages are the registered ones, text is bounded; blank entries are dropped. */
  private validateNotice(
    tenantId: number,
    notice: Record<string, string> | undefined,
  ): Partial<Record<SessionLanguage, string>> {
    if (notice == null) return {};
    if (typeof notice !== 'object' || Array.isArray(notice)) {
      this.reject(`pilot settings refused (tenant ${tenantId}): notice is not an object`, ERROR_CODE.PILOT_ACCESS_INVALID);
    }
    const out: Partial<Record<SessionLanguage, string>> = {};
    for (const [lang, text] of Object.entries(notice)) {
      if (!(SESSION_LANGUAGE_CODES as readonly string[]).includes(lang)) {
        this.reject(`pilot settings refused (tenant ${tenantId}): language ${lang}`, ERROR_CODE.PILOT_ACCESS_INVALID);
      }
      if (typeof text !== 'string' || text.length > PILOT_NOTICE_MAX_LENGTH) {
        this.reject(`pilot settings refused (tenant ${tenantId}): notice ${lang} too long`, ERROR_CODE.PILOT_ACCESS_INVALID);
      }
      const trimmed = text.trim();
      if (trimmed) out[lang as SessionLanguage] = trimmed;
    }
    return out;
  }

  /** 4xx are not server-logged by default; this is the only trace of a refused save. */
  private reject(logLine: string, error: (typeof ERROR_CODE)[keyof typeof ERROR_CODE]): never {
    this.logger.warn(logLine);
    throw new BusinessException(error, HttpStatus.BAD_REQUEST);
  }
}
