import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { HaravanProductSyncService } from './haravan-product-sync.service';
import { HaravanSyncService } from './haravan-sync.service';
import { envNumber } from '../../global/util/env-number.util';
import { isCliContext } from '../../global/util/cli-context.util';

/** Optional periodic Haravan sync. Disabled unless HARAVAN_SYNC_INTERVAL_MIN > 0. */
@Injectable()
export class ScheduledHaravanSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledHaravanSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly tenantService: TenantService,
    private readonly productSync: HaravanProductSyncService,
    private readonly orderSync: HaravanSyncService,
  ) {}

  onModuleInit(): void {
    // A one-off CLI must not run a second copy of this scheduler (PLN-261008 D2).
    if (isCliContext()) return;
    const minutes = envNumber('HARAVAN_SYNC_INTERVAL_MIN', '0');
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.logger.log('Haravan auto-sync disabled (set HARAVAN_SYNC_INTERVAL_MIN to enable)');
      return;
    }
    this.logger.log(`Haravan auto-sync enabled — every ${minutes} min`);
    this.timer = setInterval(() => void this.runAll(), minutes * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous Haravan auto-sync still running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      const tenantIds = await this.tenantService.listHaravanTenantIds();
      for (const tenantId of tenantIds) {
        try {
          const p = await this.productSync.syncProducts(tenantId);
          const o = await this.orderSync.syncOrders(tenantId);
          this.logger.log(`Haravan auto-sync tenant ${tenantId}: products[${p.detail}] orders[${o.detail}]`);
        } catch (e) {
          this.logger.warn(`Haravan auto-sync tenant ${tenantId} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
