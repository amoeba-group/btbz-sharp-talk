import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** Which alarms pop up for a user (PLN-261024 D4). */
export const ALERT_POPUP = { ALL: 'all', MINE: 'mine', OFF: 'off' } as const;
export type AlertPopup = (typeof ALERT_POPUP)[keyof typeof ALERT_POPUP];

/**
 * user_alert_settings — a user's own alarm preferences (PLN-261024 D4).
 * No row = defaults (popup all, sound on, desktop off, mail on).
 */
@Entity('user_alert_settings')
export class UserAlertSettings {
  @PrimaryColumn({ name: 'user_id', type: 'bigint', transformer: bigintTransformer })
  userId: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ type: 'varchar', length: 16, default: ALERT_POPUP.ALL })
  popup: string;

  @Column({ type: 'tinyint', width: 1, default: 1 })
  sound: number;

  @Column({ type: 'tinyint', width: 1, default: 0 })
  desktop: number;

  /** Personal alarm mail; the ops mailbox for broadcast alarms is unaffected. */
  @Column({ type: 'tinyint', width: 1, default: 1 })
  email: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
