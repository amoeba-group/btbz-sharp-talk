import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { OdooProductSyncService } from './odoo-product-sync.service';
import { OdooSyncService } from './odoo-sync.service';
import { envNumber } from '../../global/util/env-number.util';
import { isCliContext } from '../../global/util/cli-context.util';

/**
 * Optional periodic Odoo sync. Disabled unless ODOO_SYNC_INTERVAL_MIN > 0.
 * Odoo has no webhooks here (like Cafe24), so scheduled pull is the freshness
 * mechanism. Each tick refreshes both the catalogue and orders per tenant.
 * Mirrors ScheduledCafe24SyncService.
 */
@Injectable()
export class ScheduledOdooSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledOdooSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly tenantService: TenantService,
    private readonly productSync: OdooProductSyncService,
    private readonly orderSync: OdooSyncService,
  ) {}

  onModuleInit(): void {
    // A one-off CLI must not run a second copy of this scheduler (PLN-261008 D2).
    if (isCliContext()) return;
    const minutes = envNumber('ODOO_SYNC_INTERVAL_MIN', '0');
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.logger.log('Odoo auto-sync disabled (set ODOO_SYNC_INTERVAL_MIN to enable)');
      return;
    }
    this.logger.log(`Odoo auto-sync enabled — every ${minutes} min`);
    this.timer = setInterval(() => void this.runAll(), minutes * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous Odoo auto-sync still running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      const tenantIds = await this.tenantService.listOdooTenantIds();
      for (const tenantId of tenantIds) {
        try {
          const p = await this.productSync.syncProducts(tenantId);
          const o = await this.orderSync.syncOrders(tenantId);
          this.logger.log(`Odoo auto-sync tenant ${tenantId}: products[${p.detail}] orders[${o.detail}]`);
        } catch (e) {
          this.logger.warn(`Odoo auto-sync tenant ${tenantId} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
