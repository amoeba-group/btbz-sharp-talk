import { User } from '../../entity/user.entity';
import { JobLabel } from '../../entity/job-label.entity';

/**
 * Agent presence for the Users list (PLN-261012 SG-60). `onDuty` is the agent's own
 * toggle, `present` is what routing sees: on duty AND a heartbeat within the TTL.
 */
export interface UserPresence {
  onDuty: boolean;
  present: boolean;
  lastSeenAt: Date | null;
}

/** Response DTOs — camelCase. Never expose passwordHash. */
export interface UserResponse {
  id: number;
  tenantId: number;
  email: string;
  name: string | null;
  rank: string;
  status: string;
  mustChangePassword: boolean;
  labelCodes: string[];
  /** Operational region (PLN-261007); null = nationwide. */
  region: string | null;
  /** Only on the list endpoint; absent elsewhere. */
  presence?: UserPresence;
  invitedAt: Date | null;
  createdAt: Date;
}

export interface JobLabelResponse {
  id: number;
  tenantId: number;
  code: string;
  name: string;
}

export interface InviteUserResponse {
  invitationToken: string;
  tempPassword: string;
  userId: number;
}

/** Static mappers (entity -> response). */
export class UserMapper {
  static toResponse(user: User, labelCodes: string[], presence?: UserPresence): UserResponse {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      rank: user.rank,
      status: user.status,
      mustChangePassword: user.mustChangePassword === 1,
      labelCodes,
      region: user.region ?? null,
      ...(presence ? { presence } : {}),
      invitedAt: user.invitedAt,
      createdAt: user.createdAt,
    };
  }
}

export class JobLabelMapper {
  static toResponse(label: JobLabel): JobLabelResponse {
    return {
      id: label.id,
      tenantId: label.tenantId,
      code: label.code,
      name: label.name,
    };
  }
}
