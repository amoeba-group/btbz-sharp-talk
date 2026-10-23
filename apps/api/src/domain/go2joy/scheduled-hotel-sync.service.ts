import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HotelSyncService } from './hotel-sync.service';
import { ProvinceRegionSyncService } from './province-region-sync.service';
import { envNumber } from '../../global/util/env-number.util';
import { isCliContext } from '../../global/util/cli-context.util';

/**
 * Daily refresh of every hotel company from the Go2Joy Partner API (PLN-261023
 * D4) and of the province → region map (H1-a). Runs for tenants that saved
 * Partner credentials and nobody else, so it is on by default;
 * GO2JOY_HOTEL_SYNC_INTERVAL_MIN=0 turns it off.
 */
@Injectable()
export class ScheduledHotelSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledHotelSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly hotelSync: HotelSyncService,
    private readonly provinceSync: ProvinceRegionSyncService,
  ) {}

  onModuleInit(): void {
    if (isCliContext()) return;
    const minutes = envNumber('GO2JOY_HOTEL_SYNC_INTERVAL_MIN', '1440');
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.logger.log('Go2Joy hotel sync disabled (GO2JOY_HOTEL_SYNC_INTERVAL_MIN=0)');
      return;
    }
    this.timer = setInterval(() => void this.runAll(), minutes * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Regions first: a hotel synced next reads the fresh map.
      const provinces = await this.provinceSync.syncAll();
      if (provinces.tenants) this.logger.log(`Go2Joy province sync: ${provinces.tenants} tenant(s), ${provinces.failed} failed`);
      const { hotels, failed } = await this.hotelSync.syncAll();
      if (hotels) this.logger.log(`Go2Joy hotel sync: ${hotels} hotel(s), ${failed} failed`);
    } catch (e) {
      this.logger.warn(`Go2Joy hotel sync failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
