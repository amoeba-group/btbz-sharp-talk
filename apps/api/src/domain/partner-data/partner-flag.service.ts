import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenant/entity/tenant.entity';
import { RedisService } from '../../infrastructure/cache/redis.service';
import type { PartnerApiMode } from './partner-data.constants';

/** The flag is read on every chat turn of an enabled deployment; a short cache keeps it off the DB. */
const FLAG_CACHE_SEC = 30;
export const partnerFlagCacheKey = (tenantId: number) => `partner:flag:${tenantId}`;

/** Server-wide switch (PLN-261012 SG-31). Default OFF: blank, 0, false and unknown values are all "off". */
export function partnerServerEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test((process.env.PARTNER_DATA_ENABLED ?? '').trim());
}

/** `PARTNER_API_MODE=mock|live`; anything else is `mock`, so a typo can never reach a real API. */
export function partnerApiMode(): PartnerApiMode {
  return (process.env.PARTNER_API_MODE ?? '').trim().toLowerCase() === 'live' ? 'live' : 'mock';
}

/**
 * Whether partner-data lookups run for a tenant: the server-wide env AND the
 * tenant's own switch (`tenants.partner_data_enabled`). Both default OFF, and
 * with either off the chat path does nothing at all — no detection, no I/O —
 * so tenants that never opt in behave exactly as before.
 */
@Injectable()
export class PartnerFlagService {
  private readonly logger = new Logger(PartnerFlagService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly redis: RedisService,
  ) {}

  serverEnabled(): boolean {
    return partnerServerEnabled();
  }

  mode(): PartnerApiMode {
    return partnerApiMode();
  }

  /** Effective switch for a tenant. Never throws: an unreadable flag is "off". */
  async isEnabled(tenantId: number): Promise<boolean> {
    if (!partnerServerEnabled()) return false;
    try {
      return await this.tenantFlag(tenantId);
    } catch (e) {
      this.logger.warn(`partner flag unreadable for tenant ${tenantId}: ${(e as Error).message}`);
      return false;
    }
  }

  /** The tenant's own switch, regardless of the server-wide env (for the console). */
  async tenantFlag(tenantId: number): Promise<boolean> {
    const key = partnerFlagCacheKey(tenantId);
    if (this.redis.available()) {
      const hit = await this.redis.get(key);
      if (hit === '1' || hit === '0') return hit === '1';
    }
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { id: true, partnerDataEnabled: true },
    });
    const on = Number(tenant?.partnerDataEnabled ?? 0) !== 0;
    await this.redis.set(key, on ? '1' : '0', FLAG_CACHE_SEC);
    return on;
  }

  async setTenantFlag(tenantId: number, enabled: boolean): Promise<void> {
    await this.tenantRepo.update({ id: tenantId }, { partnerDataEnabled: enabled ? 1 : 0 });
    await this.redis.del(partnerFlagCacheKey(tenantId));
  }
}
