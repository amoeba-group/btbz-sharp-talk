import { apiDelete, apiGet, apiPost, apiPatch } from '@/lib/api-client';

export interface JobLabel {
  id: string;
  code: string;
  name: string;
  /** Users holding the label — the delete confirmation's release count. */
  memberCount: number;
}

/** Team (PLN-261019 P1) — code is fixed, name editable. */
export interface Unit {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  memberCount: number;
}

export interface OrgItemBody {
  code: string;
  name: string;
}

export interface TenantUser {
  id: string;
  email: string;
  name?: string | null;
  rank: string;
  labelCodes?: string[];
  unitId?: string | null;
  unitName?: string | null;
  status?: string;
  createdAt?: string;
}

export interface InviteUserBody {
  email: string;
  rank: string;
  label_codes: string[];
  unit_id?: number | null;
}

export interface UpdateUserBody {
  rank?: string;
  label_codes?: string[];
  /** null clears the team; undefined leaves it. */
  unit_id?: number | null;
  status?: string;
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
  list: () => apiGet<TenantUser[]>('/users'),
  jobLabels: () => apiGet<JobLabel[]>('/job-labels'),
  createJobLabel: (body: OrgItemBody) => apiPost<JobLabel>('/job-labels', body),
  renameJobLabel: (id: string, name: string) => apiPatch<JobLabel>(`/job-labels/${id}`, { name }),
  deleteJobLabel: (id: string) => apiDelete<{ released: number }>(`/job-labels/${id}`),
  units: () => apiGet<Unit[]>('/units'),
  createUnit: (body: OrgItemBody) => apiPost<Unit>('/units', body),
  renameUnit: (id: string, name: string) => apiPatch<Unit>(`/units/${id}`, { name }),
  deleteUnit: (id: string) => apiDelete<{ released: number }>(`/units/${id}`),
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
    if (body.unit_id !== undefined) {
      await apiPatch<TenantUser>(`/users/${id}/unit`, { unit_id: body.unit_id });
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
