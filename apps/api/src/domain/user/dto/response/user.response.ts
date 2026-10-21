import { User } from '../../entity/user.entity';
import { JobLabel } from '../../entity/job-label.entity';
import { Unit } from '../../entity/unit.entity';

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
  /** Team (PLN-261019 P1); null = unassigned. */
  unitId: number | null;
  unitName: string | null;
  invitedAt: Date | null;
  createdAt: Date;
}

export interface UnitResponse {
  id: number;
  tenantId: number;
  code: string;
  name: string;
  sortOrder: number;
  /** Members in this unit — the delete confirmation's release count (PLN-261021). */
  memberCount: number;
}

export interface JobLabelResponse {
  id: number;
  tenantId: number;
  code: string;
  name: string;
  /** Users holding this label (PLN-261021). */
  memberCount: number;
}

export interface InviteUserResponse {
  invitationToken: string;
  tempPassword: string;
  userId: number;
}

/** Static mappers (entity -> response). */
export class UserMapper {
  static toResponse(user: User, labelCodes: string[], unit?: Unit | null): UserResponse {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      rank: user.rank,
      status: user.status,
      mustChangePassword: user.mustChangePassword === 1,
      labelCodes,
      unitId: user.unitId ?? null,
      unitName: unit?.name ?? null,
      invitedAt: user.invitedAt,
      createdAt: user.createdAt,
    };
  }
}

export class JobLabelMapper {
  static toResponse(label: JobLabel, memberCount = 0): JobLabelResponse {
    return {
      id: label.id,
      tenantId: label.tenantId,
      code: label.code,
      name: label.name,
      memberCount,
    };
  }
}

export class UnitMapper {
  static toResponse(unit: Unit, memberCount = 0): UnitResponse {
    return {
      id: unit.id,
      tenantId: unit.tenantId,
      code: unit.code,
      name: unit.name,
      sortOrder: unit.sortOrder,
      memberCount,
    };
  }
}
