import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { partnerCall } from './partner-client';
import { HotelSyncService } from './hotel-sync.service';
import { PartnerProvince, mergeProvinceIndex, mergeProvinceRegions } from './province-region.mapper';

export const PROVINCE_REGIONS_SOURCE = 'go2joy_partner';

export interface ProvinceRegionSyncResult {
  total: number;
  added: number;
  changed: number;
  kept: number;
  /** Province numbers in the index after the sync (spec v1.4). */
  indexed: number;
  syncedAt: string;
}

export interface ProvinceRegionStatus {
  total: number;
  syncedAt: string | null;
  /** 'go2joy_partner' once synced; null = entered by SQL only. */
  source: string | null;
  regions: Record<string, number>;
  /** Province numbers the HA can sign as `province_sn` (spec v1.4). */
  indexed: number;
}

/**
 * The tenant's province → region map from the Partner API Province Feed
 * (PLN-261023 H1-a) and the province-number index the HA signs against (spec
 * v1.4, PLN-261024). Only `handoff_config.provinceRegions*` and
 * `provinceIndex` are written — every other handoff setting stays as it is.
 * An empty or failed feed writes nothing, so a broken connection never
 * empties the map.
 */
@Injectable()
export class ProvinceRegionSyncService {
  private readonly logger = new Logger(ProvinceRegionSyncService.name);

  constructor(
    @InjectRepository(TenantAiConfig) private readonly aiConfigRepo: Repository<TenantAiConfig>,
    private readonly hotelSync: HotelSyncService,
  ) {}

  async status(tenantId: number): Promise<ProvinceRegionStatus> {
    const handoff = (await this.aiConfigRepo.findOne({ where: { tenantId } }))?.handoffConfig ?? null;
    const map = handoff?.provinceRegions ?? {};
    const regions: Record<string, number> = {};
    for (const region of Object.values(map)) regions[region] = (regions[region] ?? 0) + 1;
    return {
      total: Object.keys(map).length,
      syncedAt: handoff?.provinceRegionsSyncedAt ?? null,
      source: handoff?.provinceRegionsSource ?? null,
      regions,
      indexed: Object.keys(handoff?.provinceIndex ?? {}).length,
    };
  }

  /** Console button and the daily sweep. Throws BusinessException on failure. */
  async syncTenant(tenantId: number): Promise<ProvinceRegionSyncResult> {
    const cfg = await this.hotelSync.config(tenantId);
    if (!cfg) throw new BusinessException(ERROR_CODE.PARTNER_NOT_CONFIGURED, HttpStatus.BAD_REQUEST);
    let feed: PartnerProvince[];
    try {
      const data = await partnerCall<{ provinceList?: PartnerProvince[] } | null>(cfg, 'api/v2/datafeed/getProvinceFeed', {});
      feed = data?.provinceList ?? [];
    } catch (err) {
      this.logger.warn(`province feed failed (tenant ${tenantId}): ${(err as Error).message}`);
      throw new BusinessException(ERROR_CODE.PARTNER_REQUEST_FAILED, HttpStatus.BAD_GATEWAY);
    }
    const row = await this.aiConfigRepo.findOne({ where: { tenantId } });
    if (!row) {
      // No AI configuration yet — nothing routes on regions; do not create one here.
      this.logger.warn(`province regions not stored (tenant ${tenantId}): no AI configuration row`);
      throw new BusinessException(ERROR_CODE.PARTNER_REQUEST_FAILED, HttpStatus.CONFLICT);
    }
    const merged = mergeProvinceRegions(row.handoffConfig?.provinceRegions, feed);
    if (!merged.total) {
      this.logger.warn(`province feed empty (tenant ${tenantId}) — map left unchanged`);
      throw new BusinessException(ERROR_CODE.PARTNER_REQUEST_FAILED, HttpStatus.BAD_GATEWAY);
    }
    const index = mergeProvinceIndex(row.handoffConfig?.provinceIndex, feed);
    const syncedAt = new Date().toISOString();
    row.handoffConfig = {
      ...(row.handoffConfig ?? {}),
      provinceRegions: merged.map,
      provinceIndex: index.index,
      provinceRegionsSyncedAt: syncedAt,
      provinceRegionsSource: PROVINCE_REGIONS_SOURCE,
    };
    await this.aiConfigRepo.save(row);
    this.logger.log(
      `province regions synced (tenant ${tenantId}): ${merged.total} from Go2Joy, ${merged.added} new, ${merged.changed} changed, ${merged.kept} kept`,
    );
    return {
      total: merged.total + merged.kept,
      added: merged.added,
      changed: merged.changed,
      kept: merged.kept,
      indexed: Object.keys(index.index).length,
      syncedAt,
    };
  }

  /** Daily sweep: every tenant with Partner credentials. Never throws. */
  async syncAll(): Promise<{ tenants: number; failed: number }> {
    let tenants = 0;
    let failed = 0;
    for (const tenantId of await this.hotelSync.connectedTenantIds()) {
      tenants += 1;
      try {
        await this.syncTenant(tenantId);
      } catch (err) {
        failed += 1;
        this.logger.warn(`daily province sync failed (tenant ${tenantId}): ${(err as Error).message}`);
      }
    }
    return { tenants, failed };
  }
}
