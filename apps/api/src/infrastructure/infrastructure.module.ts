import { Global, Module } from '@nestjs/common';
import { RedisService } from './cache/redis.service';
import { EventBusService } from './queue/event-bus.service';
import { MailerService } from './external/mailer.service';

// Re-export infra services so domains can import them from this barrel.
export { RedisService } from './cache/redis.service';
export { EventBusService } from './queue/event-bus.service';
export { MailerService } from './external/mailer.service';

/** Global infrastructure: cache + event bus, available to every domain module. */
@Global()
@Module({
  providers: [RedisService, EventBusService, MailerService],
  exports: [RedisService, EventBusService, MailerService],
})
export class InfrastructureModule {}

/** Routing keys for the event bus (single source of truth). */
export const EVENTS = {
  CJM: 'cjm.event',
  NOTIFICATION: 'notification.event',
  WEBHOOK_FULFILLMENT: 'webhook.fulfillment',
  CAMPAIGN_DISPATCH: 'campaign.dispatch',
  ESCALATION: 'escalation.requested',
  PUSH_DISPATCH: 'push.dispatch',
  /** Agent-tier issue resolution → knowledge-gap capture proposal (P5). */
  ISSUE_RESOLVED: 'issue.resolved',
  /** A staff member's region or status changed → pinned alerts are re-pointed (PLN-261012 SG-65). */
  USER_ROUTING_CHANGED: 'user.routing_changed',
} as const;
