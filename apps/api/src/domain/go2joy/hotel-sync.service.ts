import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { Company } from '../company/entity/company.entity';
import { PRODUCT_STATUS, ProductCache } from '../product/entity/product-cache.entity';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { decryptSecret } from '../../global/util/crypto.util';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { PartnerApiError, PartnerConfig, partnerCall, readPartnerConfig } from './partner-client';
import {
  HA_ROOM_STATUS,
  PartnerHotelInfo,
  PartnerRoomV1,
  PartnerRoomV2,
  RoomTypeAttributes,
  representativePrice,
  roomHandle,
  toPartnerInfo,
  toRoomAttributes,
} from './room-type.mapper';

export const ROOM_SOURCE = 'go2joy_partner';
export const ROOM_CATEGORY = 'room_type';
/** A hotel synced more recently than this is not re-fetched on sign-in. */
const FRESH_MS = 24 * 3_600_000;

export interface HotelSyncResult {
  company: Company;
  rooms: { upserted: number; archived: number };
}

/** `hotel:{sn}` — the same key a signed identify uses (companyKeyFor). */
const hotelKey = (hotelSn: number) => `hotel:${hotelSn}`;

/** A Go2Joy hotel number: positive integer (hotel_id arrives as a string from identify). */
export function parseHotelSn(value: unknown): number | null {
  const n = typeof value === 'number' ? value : /^\d{1,10}$/.test(String(value ?? '').trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Hotel profile + room types from the Go2Joy Partner API (PLN-261023 B).
 *
 * What the API has — name, opening hours, cancellation policy, room types with
 * list prices and status — is written here and is read-only on the console.
 * Everything else about the hotel (code, phone, address, contract, enterprise…)
 * is operator-entered on the console until the host sends it (A, later).
 *
 * A hotel becomes a company only after the API confirms it exists, so a hotel
 * number from an unsigned sign-in can create nothing but a public hotel record.
 */
@Injectable()
export class HotelSyncService {
  private readonly logger = new Logger(HotelSyncService.name);

  constructor(
    @InjectRepository(IntegrationCredential) private readonly credRepo: Repository<IntegrationCredential>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(ProductCache) private readonly productRepo: Repository<ProductCache>,
  ) {}

  async config(tenantId: number): Promise<PartnerConfig | null> {
    const cred = await this.credRepo.findOne({
      where: { tenantId, provider: INTEGRATION_PROVIDER.GO2JOY_PARTNER },
    });
    if (!cred?.secretEnc) return null;
    try {
      return readPartnerConfig(JSON.parse(decryptSecret(cred.secretEnc)) as Record<string, string>);
    } catch {
      return null;
    }
  }

  /** Tenants with a Partner credential (the daily sweep). */
  async connectedTenantIds(): Promise<number[]> {
    const rows = await this.credRepo.find({
      where: { provider: INTEGRATION_PROVIDER.GO2JOY_PARTNER },
      select: ['tenantId'],
    });
    return rows.map((r) => Number(r.tenantId));
  }

  /**
   * Fetch one hotel and write it. Console paths call this and see the error;
   * sign-in and the sweep go through `ensureHotel` / `syncAll`, which log.
   */
  async syncHotel(tenantId: number, hotelSn: number): Promise<HotelSyncResult> {
    const cfg = await this.config(tenantId);
    if (!cfg) throw new BusinessException(ERROR_CODE.PARTNER_NOT_CONFIGURED, HttpStatus.BAD_REQUEST);
    let info: PartnerHotelInfo;
    try {
      info = await partnerCall<PartnerHotelInfo>(cfg, 'api/v2/hotel/getHotelInfo', { hotelSn });
    } catch (err) {
      if (err instanceof PartnerApiError && err.kind === 'not_found') {
        throw new BusinessException(ERROR_CODE.PARTNER_HOTEL_NOT_FOUND, HttpStatus.NOT_FOUND);
      }
      await this.recordError(tenantId, hotelSn, err);
      throw this.asBusiness(err);
    }
    // The feeds answer an unknown hotel with somebody else's data (REQ-261021
    // T15); Hotel Info has not been seen to, but the check is one comparison.
    if (Number(info?.sn) !== hotelSn) {
      throw new BusinessException(ERROR_CODE.PARTNER_HOTEL_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    let roomsV1: PartnerRoomV1[] = [];
    let roomsV2: PartnerRoomV2[] = [];
    try {
      roomsV1 = (await partnerCall<PartnerRoomV1[] | null>(cfg, 'api/v1/datafeed/getRoomTypeFeed', { hotelSn })) ?? [];
    } catch (err) {
      await this.recordError(tenantId, hotelSn, err);
      throw this.asBusiness(err);
    }
    try {
      const v2 = await partnerCall<{ roomTypeList?: PartnerRoomV2[] } | null>(cfg, 'api/v2/datafeed/getRoomTypeFeed', {
        hotelSn,
      });
      roomsV2 = v2?.roomTypeList ?? [];
    } catch (err) {
      // v2 only adds facilities and images; the room list stands without it.
      this.logger.warn(`room type feed v2 failed (tenant ${tenantId}, hotel ${hotelSn}): ${(err as Error).message}`);
    }

    const company = await this.upsertCompany(tenantId, hotelSn, info);
    const rooms = await this.writeRooms(tenantId, hotelSn, Number(company.id), roomsV1, roomsV2);
    this.logger.log(
      `hotel synced (tenant ${tenantId}, hotel ${hotelSn}, company ${company.id}): ${rooms.upserted} rooms, ${rooms.archived} archived`,
    );
    return { company, rooms };
  }

  /**
   * Sign-in path (PLN-261023 D1-②): make sure the hotel a host user named
   * exists as a company, at most once a day. Never throws — a sign-in must not
   * depend on Go2Joy being up. Returns the company when there is one.
   */
  async ensureHotel(tenantId: number, hotelId: unknown): Promise<Company | null> {
    const hotelSn = parseHotelSn(hotelId);
    if (hotelSn == null) return null;
    const existing = await this.companyRepo.findOne({ where: { tenantId, externalKey: hotelKey(hotelSn) } });
    if (existing?.partnerSyncedAt && Date.now() - new Date(existing.partnerSyncedAt).getTime() < FRESH_MS) {
      return existing;
    }
    if (!(await this.config(tenantId))) return existing;
    try {
      return (await this.syncHotel(tenantId, hotelSn)).company;
    } catch (err) {
      this.logger.warn(`hotel sync on sign-in skipped (tenant ${tenantId}, hotel ${hotelSn}): ${(err as Error).message}`);
      return existing;
    }
  }

  /** Daily sweep: every hotel company of every connected tenant, one at a time. */
  async syncAll(): Promise<{ hotels: number; failed: number }> {
    let hotels = 0;
    let failed = 0;
    for (const tenantId of await this.connectedTenantIds()) {
      const companies = await this.companyRepo
        .createQueryBuilder('c')
        .select(['c.id', 'c.externalKey'])
        .where('c.tenantId = :tenantId', { tenantId })
        .andWhere('c.externalKey LIKE :prefix', { prefix: 'hotel:%' })
        .getMany();
      for (const c of companies) {
        const hotelSn = parseHotelSn(c.externalKey.slice('hotel:'.length));
        if (hotelSn == null) continue;
        hotels += 1;
        try {
          await this.syncHotel(tenantId, hotelSn);
        } catch (err) {
          failed += 1;
          this.logger.warn(`daily hotel sync failed (tenant ${tenantId}, hotel ${hotelSn}): ${(err as Error).message}`);
        }
      }
    }
    return { hotels, failed };
  }

  private async upsertCompany(tenantId: number, hotelSn: number, info: PartnerHotelInfo): Promise<Company> {
    const externalKey = hotelKey(hotelSn);
    const existing = await this.companyRepo.findOne({ where: { tenantId, externalKey } });
    const company = existing ?? this.companyRepo.create({ tenantId, externalKey, name: null, province: null, region: null });
    const partnerInfo = toPartnerInfo(info);
    // Go2Joy's own record of the hotel name wins over what a sign-in carried.
    if (partnerInfo.name) company.name = partnerInfo.name;
    company.partnerInfo = partnerInfo;
    company.partnerSyncedAt = new Date();
    company.partnerSyncError = null;
    try {
      return await this.companyRepo.save(company);
    } catch (err) {
      // A sign-in creating the same hotel at the same moment: take its row.
      const winner = existing ? null : await this.companyRepo.findOne({ where: { tenantId, externalKey } });
      if (!winner) throw err;
      Object.assign(winner, { name: company.name, partnerInfo, partnerSyncedAt: company.partnerSyncedAt, partnerSyncError: null });
      return this.companyRepo.save(winner);
    }
  }

  /**
   * Upsert every room of the v1 feed as a product of this company; a room the
   * feed no longer lists is archived, never deleted. The operator-entered room
   * count survives every sync.
   */
  private async writeRooms(
    tenantId: number,
    hotelSn: number,
    companyId: number,
    v1: PartnerRoomV1[],
    v2: PartnerRoomV2[],
  ): Promise<{ upserted: number; archived: number }> {
    const existing = await this.productRepo.find({ where: { tenantId, companyId, source: ROOM_SOURCE } });
    const byHandle = new Map(existing.map((p) => [p.handle, p]));
    const v2BySn = new Map(v2.map((r) => [Number(r.sn), r]));
    const seen = new Set<string>();
    const now = new Date();
    let upserted = 0;
    for (const room of v1) {
      const sn = Number(room?.sn);
      if (!Number.isInteger(sn) || !room.name) continue;
      const handle = roomHandle(hotelSn, sn);
      seen.add(handle);
      const row = byHandle.get(handle) ?? this.productRepo.create({ tenantId, handle });
      const prevCount = (row.attributes as Partial<RoomTypeAttributes> | null)?.roomCount ?? null;
      const attrs = toRoomAttributes(room, v2BySn.get(sn), prevCount);
      Object.assign(row, {
        companyId,
        source: ROOM_SOURCE,
        externalId: String(sn),
        title: room.name.trim().slice(0, 255),
        category: ROOM_CATEGORY,
        description: attrs.memo,
        imageUrl: attrs.images[0]?.slice(0, 1024) ?? null,
        price: representativePrice(attrs.prices),
        currency: 'VND',
        status: attrs.haStatus === HA_ROOM_STATUS.SELLING ? PRODUCT_STATUS.ACTIVE : PRODUCT_STATUS.ARCHIVED,
        attributes: attrs as unknown as Record<string, unknown>,
        syncedAt: now,
      });
      await this.productRepo.save(row);
      upserted += 1;
    }
    let archived = 0;
    for (const row of existing) {
      if (seen.has(row.handle) || row.status === PRODUCT_STATUS.ARCHIVED) continue;
      row.status = PRODUCT_STATUS.ARCHIVED;
      await this.productRepo.save(row);
      archived += 1;
    }
    return { upserted, archived };
  }

  private async recordError(tenantId: number, hotelSn: number, err: unknown): Promise<void> {
    const company = await this.companyRepo.findOne({ where: { tenantId, externalKey: hotelKey(hotelSn) } });
    if (!company) return;
    company.partnerSyncError = ((err as Error)?.message ?? 'Partner API error').slice(0, 255);
    await this.companyRepo.save(company);
  }

  private asBusiness(err: unknown): BusinessException {
    if (err instanceof BusinessException) return err;
    this.logger.warn(`partner request failed: ${(err as Error)?.message}`);
    return new BusinessException(ERROR_CODE.PARTNER_REQUEST_FAILED, HttpStatus.BAD_GATEWAY);
  }
}
