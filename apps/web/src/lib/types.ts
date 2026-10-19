export type ActorType = 'admin' | 'user';

export type Rank = 'master' | 'director' | 'manager' | 'staff';

export interface Principal {
  actorType: ActorType;
  id: string;
  email: string;
  tenantId?: string;
  /** Platform-admin level — the backend sends the string, not a number. */
  level?: 'super_admin' | 'admin';
  rank?: Rank;
  labels?: string[];
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code?: string; message: string; details?: Record<string, string[]> } | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
  principal: Principal;
  /**
   * MFA-enrollment enforcement (PLN-MFA M3): required = rank must enroll
   * (grace banner until mfaEnforceFrom); mfaEnforced = deadline passed, the
   * token only works on enrollment routes (forced modal).
   */
  mfaEnrollmentRequired?: boolean;
  mfaEnforceFrom?: string | null;
  mfaEnforced?: boolean;
}

/** Step-up login response for MFA-enabled accounts (no tokens/principal yet). */
export interface MfaChallengeResponse {
  mfaRequired: true;
  /** Purpose-limited 5-minute token consumed by POST /auth/mfa/verify. */
  mfaToken: string;
}

/** Either a full login or an MFA step-up challenge. */
export type LoginResult = LoginResponse | MfaChallengeResponse;

export function isMfaRequired(res: LoginResult): res is MfaChallengeResponse {
  return 'mfaRequired' in res && res.mfaRequired === true;
}

export interface MfaStatus {
  enrolled: boolean;
  enabledAt: string | null;
}

export interface MfaEnrollment {
  otpauthUri: string;
  secret: string;
}

/** Display-safe tenant view served to the unauthenticated /<slug> login page. */
export interface PublicTenant {
  slug: string;
  name: string | null;
  status: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
