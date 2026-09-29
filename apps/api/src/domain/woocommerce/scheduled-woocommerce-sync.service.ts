import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { WooProductSyncService } from './woocommerce-product-sync.service';
import { WooSyncService } from './woocommerce-sync.service';
import { envNumber } from '../../global/util/env-number.util';

/** Optional periodic WooCommerce sync. Disabled unless WOOCOMMERCE_SYNC_INTERVAL_MIN > 0. */
@Injectable()
export class ScheduledWooSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledWooSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly tenantService: TenantService,
    private readonly productSync: WooProductSyncService,
    private readonly orderSync: WooSyncService,
  ) {}

  onModuleInit(): void {
    const minutes = envNumber('WOOCOMMERCE_SYNC_INTERVAL_MIN', '0');
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.logger.log('WooCommerce auto-sync disabled (set WOOCOMMERCE_SYNC_INTERVAL_MIN to enable)');
      return;
    }
    this.logger.log(`WooCommerce auto-sync enabled — every ${minutes} min`);
    this.timer = setInterval(() => void this.runAll(), minutes * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous WooCommerce auto-sync still running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      const tenantIds = await this.tenantService.listWoocommerceTenantIds();
      for (const tenantId of tenantIds) {
        try {
          const p = await this.productSync.syncProducts(tenantId);
          const o = await this.orderSync.syncOrders(tenantId);
          this.logger.log(`WooCommerce auto-sync tenant ${tenantId}: products[${p.detail}] orders[${o.detail}]`);
        } catch (e) {
          this.logger.warn(`WooCommerce auto-sync tenant ${tenantId} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
