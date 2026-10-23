import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * agent_alert_reads — an alarm a user has seen (PLN-261024 alarm center D2).
 * Closing an alarm hides it for that user only; stopping the page (ack) stays
 * with the assignee. Keyed on the alarm's first row (the one the console shows).
 */
@Entity('agent_alert_reads')
@Unique('uq_alert_read', ['alertId', 'userId'])
export class AgentAlertRead {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'alert_id', type: 'bigint', transformer: bigintTransformer })
  alertId: number;

  @Column({ name: 'user_id', type: 'bigint', transformer: bigintTransformer })
  userId: number;

  @Column({ name: 'read_at', type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  readAt: Date;
}
