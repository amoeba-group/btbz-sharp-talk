import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { ShopifySyncService } from './shopify-sync.service';
import { envNumber } from '../../global/util/env-number.util';

/**
 * Optional periodic Shopify sync. Disabled unless SHOPIFY_SYNC_INTERVAL_MIN > 0
 * (kept off by default in dev). Uses a self-managed interval — no extra deps.
 * Runs are non-overlapping and per-tenant errors are isolated.
 */
@Injectable()
export class ScheduledShopifySyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledShopifySyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly tenantService: TenantService,
    private readonly syncService: ShopifySyncService,
  ) {}

  onModuleInit(): void {
    const minutes = envNumber('SHOPIFY_SYNC_INTERVAL_MIN', '0');
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.logger.log('Shopify auto-sync disabled (set SHOPIFY_SYNC_INTERVAL_MIN to enable)');
      return;
    }
    this.logger.log(`Shopify auto-sync enabled — every ${minutes} min`);
    this.timer = setInterval(() => void this.runAll(), minutes * 60_000);
    this.timer.unref?.(); // don't keep the process alive for the timer
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sync every tenant that has a Shopify credential; isolates per-tenant failures. */
  async runAll(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous auto-sync still running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      const tenantIds = await this.tenantService.listShopifyTenantIds();
      for (const tenantId of tenantIds) {
        try {
          const res = await this.syncService.syncOrders(tenantId);
          this.logger.log(`Auto-sync tenant ${tenantId}: ${res.detail}`);
        } catch (e) {
          this.logger.warn(`Auto-sync tenant ${tenantId} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
