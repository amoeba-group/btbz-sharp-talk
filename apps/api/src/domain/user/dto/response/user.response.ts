import { User } from '../../entity/user.entity';
import { JobLabel } from '../../entity/job-label.entity';

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
  static toResponse(user: User, labelCodes: string[]): UserResponse {
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
