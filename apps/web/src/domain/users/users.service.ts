import { apiGet, apiPost, apiPatch } from '@/lib/api-client';

export interface JobLabel {
  code: string;
  name: string;
}

export interface TenantUser {
  id: string;
  email: string;
  name?: string | null;
  rank: string;
  /** Role labels held (PLN-261007 calls them roles in the UI). */
  labelCodes?: string[];
  /** Operational region: 'north' | 'south' | null = nationwide (PLN-261007). */
  region?: string | null;
  status?: string;
  createdAt?: string;
}

export const USER_REGIONS = ['north', 'south'] as const;

export interface InviteUserBody {
  email: string;
  rank: string;
  label_codes: string[];
  /** '' = nationwide. */
  region?: string;
}

export interface UpdateUserBody {
  rank?: string;
  label_codes?: string[];
  /** '' clears to nationwide. */
  region?: string;
  status?: string;
}

/** List filters (PLN-261007); region 'none' = nationwide only. */
export interface UserListFilter {
  label?: string;
  region?: string;
}

export interface InviteResult {
  invitationToken: string;
  tempPassword: string;
  userId: string;
}

export interface TempPasswordResult {
  userId: string;
  email: string;
  tempPassword: string;
  /** Present when email delivery was requested (PLN-260824 S4). */
  emailSent?: boolean;
}

export const usersService = {
  list: (filter: UserListFilter = {}) =>
    apiGet<TenantUser[]>('/users', {
      ...(filter.label ? { label: filter.label } : {}),
      ...(filter.region ? { region: filter.region } : {}),
    }),
  jobLabels: () => apiGet<JobLabel[]>('/job-labels'),
  invite: (body: InviteUserBody) => apiPost<InviteResult>('/users/invite', body),
  // The API exposes per-field endpoints with distinct RBAC (rank/labels/status),
  // so fan out and only touch the fields that were provided.
  update: async (id: string, body: UpdateUserBody): Promise<void> => {
    if (body.rank !== undefined) {
      await apiPatch<TenantUser>(`/users/${id}/rank`, { rank: body.rank });
    }
    if (body.label_codes !== undefined) {
      await apiPatch<TenantUser>(`/users/${id}/labels`, { label_codes: body.label_codes });
    }
    if (body.region !== undefined) {
      await apiPatch<TenantUser>(`/users/${id}/region`, { region: body.region });
    }
    if (body.status !== undefined) {
      await apiPatch<TenantUser>(`/users/${id}/status`, { status: body.status });
    }
  },
  // Issue a fresh temporary password for an existing user — relayed manually
  // and/or emailed to the user (PLN-260824 S4).
  issueTempPassword: (id: string, sendEmail: boolean) =>
    apiPost<TempPasswordResult>(`/users/${id}/temp-password`, { send_email: sendEmail }),
  // Clear the user's MFA enrollment — they re-enroll at their next login (audited).
  resetMfa: (id: string) => apiPost<{ reset: boolean }>(`/users/${id}/mfa-reset`, {}),
};
