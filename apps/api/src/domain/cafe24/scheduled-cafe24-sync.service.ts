import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { Cafe24SyncService } from './cafe24-sync.service';
import { isCliContext } from '../../global/util/cli-context.util';

/**
 * Optional periodic Cafe24 sync. Disabled unless CAFE24_SYNC_INTERVAL_MIN > 0.
 * Cafe24 has no real-time webhooks (unlike Shopify), so scheduled pull is the
 * primary freshness mechanism here (PLN-260807 §3.1). Mirrors the Shopify scheduler.
 */
@Injectable()
export class ScheduledCafe24SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledCafe24SyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly tenantService: TenantService,
    private readonly syncService: Cafe24SyncService,
  ) {}

  onModuleInit(): void {
    // A one-off CLI must not run a second copy of this scheduler (PLN-261008 D2).
    if (isCliContext()) return;
    const minutes = Number(process.env.CAFE24_SYNC_INTERVAL_MIN ?? '0');
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.logger.log('Cafe24 auto-sync disabled (set CAFE24_SYNC_INTERVAL_MIN to enable)');
      return;
    }
    this.logger.log(`Cafe24 auto-sync enabled — every ${minutes} min`);
    this.timer = setInterval(() => void this.runAll(), minutes * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous Cafe24 auto-sync still running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      const tenantIds = await this.tenantService.listCafe24TenantIds();
      for (const tenantId of tenantIds) {
        try {
          const res = await this.syncService.syncOrders(tenantId);
          this.logger.log(`Cafe24 auto-sync tenant ${tenantId}: ${res.detail}`);
        } catch (e) {
          this.logger.warn(`Cafe24 auto-sync tenant ${tenantId} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
