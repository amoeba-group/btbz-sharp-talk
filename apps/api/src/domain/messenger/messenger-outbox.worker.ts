import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MessengerOutboxService } from './messenger-outbox.service';
import { envNumber } from '../../global/util/env-number.util';

/** Default cadence; agent replies from the console ride this tick. */
const DEFAULT_INTERVAL_SEC = 5;

/**
 * Drains the channel outbox on a timer (same shape as the Cafe24/Shopify
 * schedulers: env-gated interval, `running` guard, unref'd timer).
 *
 * The ingest path already flushes a thread inline, so this tick exists for what
 * ingest cannot see: replies an agent typed in the console, and retries whose
 * backoff has elapsed.
 */
@Injectable()
export class MessengerOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessengerOutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly outbox: MessengerOutboxService) {}

  onModuleInit(): void {
    const seconds = envNumber('MESSENGER_OUTBOX_INTERVAL_SEC', DEFAULT_INTERVAL_SEC);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      this.logger.log('Messenger outbox worker disabled (MESSENGER_OUTBOX_INTERVAL_SEC <= 0)');
      return;
    }
    this.logger.log(`Messenger outbox worker enabled — every ${seconds}s`);
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return; // a slow provider must not stack ticks
    this.running = true;
    try {
      await this.outbox.flushAllThreads();
      await this.outbox.deliverDue();
      // Asynchronous providers report back later; ask what became of them.
      await this.outbox.confirmUnconfirmed();
    } catch (e) {
      this.logger.error(`outbox tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
