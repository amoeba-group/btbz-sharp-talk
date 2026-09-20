import { apiGet, apiGetList, apiPost, apiPatch, apiPut } from '@/lib/api-client';
import type {
  InviteResult,
  InviteUserBody,
  JobLabel,
  TempPasswordResult,
  TenantUser,
} from '@/domain/users/users.service';

export interface Tenant {
  id: string;
  /** External tenant identifier — all admin routes/URLs use this, never `id`. */
  uuid: string;
  name: string;
  slug?: string;
  shopDomain?: string;
  plan?: string;
  /** Issue-workflow add-on entitlement: base/bridge/native (REQ-260825). */
  workflowMode?: string;
  customCssEnabled?: boolean;
  assetBytes?: number;
  status?: string;
  userCount?: number;
  createdAt?: string;
}

export interface AiEngine {
  id: string;
  name: string;
  provider?: string;
  model?: string;
  enabled: boolean; // derived from backend `status`
  hasKey?: boolean;
  isDefault?: boolean;
  createdAt?: string;
}

// Raw backend catalog entry (AiEngineMapper.toEngine).
interface BackendEngine {
  id: number | string;
  provider?: string;
  name: string;
  model?: string;
  hasKey?: boolean;
  status?: string;
  isDefault?: number;
  createdAt?: string;
}

/** Platform-admin account row (REQ-260824-Admin-Account-Invite). */
export interface AdminAccount {
  id: string;
  email: string;
  level: 'super_admin' | 'admin';
  status: string;
  mustChangePassword: boolean;
  createdAt?: string;
}

/** One-time credential result — the plaintext is shown once, never again. */
export interface AdminCredential {
  adminId: string;
  email: string;
  tempPassword: string;
  emailSent?: boolean;
}

/** How a tenant's provisioning of one menu is pinned against its plan. */
export type MenuProvisionMode = 'plan' | 'on' | 'off';

export interface TenantMenuRow {
  code: string;
  /** i18n key in the `nav` namespace — menu names are already translated there. */
  labelKey: string;
  path: string;
  planDefault: boolean;
  mode: MenuProvisionMode;
  /** Plan + override, computed server-side. */
  provided: boolean;
}

export interface TenantMenusView {
  tenantUuid: string;
  tenantName: string | null;
  plan: string | null;
  menus: TenantMenuRow[];
}

export interface AuditEntry {
  id: string;
  /** Resolved display name (staff name/email, admin email, or 'system'). */
  actorName?: string | null;
  actorType?: string;
  actorId?: string;
  action: string;
  target?: string;
  ip?: string;
  result?: string;
  createdAt?: string;
}

/** Per-tenant journey stages for the platform console (PLN-260920b). */
export interface TenantJourneyRow {
  tenantId: number;
  name: string;
  slug: string | null;
  impressions: number;
  opens: number;
  openedSessions: number;
  conversations: number;
  aiHandled: number;
  escalated: number;
  rated: number;
  ended: number;
}

export const adminService = {
  tenantJourney: (from: string, to: string) =>
    apiGet<TenantJourneyRow[]>('/analytics/admin/tenants', { from, to }),

  tenants: (params: { page: number; pageSize: number }) =>
    apiGetList<Tenant>('/tenants', { page: params.page, size: params.pageSize }),
  tenant: (uuid: string) => apiGet<Tenant>(`/tenants/${uuid}`),
  // Backend expects snake_case shop_domain; slug is optional (server derives from name).
  createTenant: (body: { name: string; shopDomain: string; plan: string; slug?: string }) =>
    apiPost<Tenant>('/tenants', {
      name: body.name,
      shop_domain: body.shopDomain,
      plan: body.plan,
      ...(body.slug ? { slug: body.slug } : {}),
    }),
  setTenantPlan: (uuid: string, plan: string) =>
    apiPatch<Tenant>(`/tenants/${uuid}/plan`, { plan }),
  setTenantWorkflowMode: (uuid: string, workflow_mode: string) =>
    apiPatch<Tenant>(`/tenants/${uuid}/workflow-mode`, { workflow_mode }),
  setTenantCustomCss: (uuid: string, enabled: boolean) =>
    apiPatch<Tenant>(`/tenants/${uuid}/custom-css`, { enabled }),
  setTenantStatus: (uuid: string, status: string) =>
    apiPatch<Tenant>(`/tenants/${uuid}/status`, { status }),
  // ---- Admin-scoped per-tenant user management (tenant addressed by UUID) ----
  tenantUsers: (tenantUuid: string, params: { page: number; pageSize: number }) =>
    apiGetList<TenantUser>(`/tenants/${tenantUuid}/users`, {
      page: params.page,
      size: params.pageSize,
    }),
  tenantJobLabels: (tenantUuid: string) => apiGet<JobLabel[]>(`/tenants/${tenantUuid}/job-labels`),
  inviteTenantUser: (tenantUuid: string, body: InviteUserBody) =>
    apiPost<InviteResult>(`/tenants/${tenantUuid}/users/invite`, body),
  issueTenantUserTempPassword: (tenantUuid: string, userId: string, sendEmail: boolean) =>
    apiPost<TempPasswordResult>(`/tenants/${tenantUuid}/users/${userId}/temp-password`, {
      send_email: sendEmail,
    }),
  // Clear a tenant user's MFA enrollment — re-enrollment at next login (audited).
  // Mirrors the temp-password route pattern of the admin-scoped user routes.
  resetTenantUserMfa: (tenantUuid: string, userId: string) =>
    apiPost<{ reset: boolean }>(`/tenants/${tenantUuid}/users/${userId}/mfa-reset`, {}),
  setTenantUserStatus: (tenantUuid: string, userId: string, status: string) =>
    apiPatch<TenantUser>(`/tenants/${tenantUuid}/users/${userId}/status`, { status }),
  // ---- Platform-admin accounts (REQ-260824) — super_admin only server-side ----
  admins: () => apiGet<AdminAccount[]>('/admin-users'),
  inviteAdmin: (email: string, level: 'super_admin' | 'admin', sendEmail: boolean) =>
    apiPost<AdminCredential>('/admin-users/invite', { email, level, send_email: sendEmail }),
  issueAdminTempPassword: (adminId: string, sendEmail: boolean) =>
    apiPost<AdminCredential>(`/admin-users/${adminId}/temp-password`, { send_email: sendEmail }),
  setAdminStatus: (adminId: string, status: 'active' | 'suspended') =>
    apiPatch<AdminAccount>(`/admin-users/${adminId}/status`, { status }),
  // Adapt backend {status, hasKey,...} → frontend {enabled,...}.
  engines: async (): Promise<AiEngine[]> => {
    const list = await apiGet<BackendEngine[]>('/ai-engines');
    return (list ?? []).map((e) => ({
      id: String(e.id),
      name: e.name,
      provider: e.provider,
      model: e.model,
      enabled: e.status === 'enabled',
      hasKey: e.hasKey,
      isDefault: !!e.isDefault,
      createdAt: e.createdAt,
    }));
  },
  // Backend expects snake_case api_key.
  createEngine: (body: { name: string; provider: string; model: string; apiKey: string }) =>
    apiPost('/ai-engines', {
      provider: body.provider,
      name: body.name,
      model: body.model,
      api_key: body.apiKey,
    }),
  // Backend route is PATCH (not PUT); api_key is snake_case.
  updateEngine: (id: string, body: { name?: string; model?: string; apiKey?: string }) =>
    apiPatch(`/ai-engines/${id}`, { name: body.name, model: body.model, api_key: body.apiKey }),
  // Backend toggles via `status`, not `enabled`.
  setEngineEnabled: (id: string, enabled: boolean) =>
    apiPatch(`/ai-engines/${id}`, { status: enabled ? 'enabled' : 'disabled' }),
  audit: (params: { page: number; pageSize: number }) =>
    apiGetList<AuditEntry>('/audit', { page: params.page, size: params.pageSize }),

  // ---- Menu provisioning (PLN-260812 S2) ----
  tenantMenus: (uuid: string) => apiGet<TenantMenusView>(`/tenants/${uuid}/menus`),
  saveTenantMenus: (uuid: string, menus: { code: string; mode: MenuProvisionMode }[]) =>
    apiPut<TenantMenusView>(`/tenants/${uuid}/menus`, {
      // Backend DTOs are snake_case.
      menus: menus.map((m) => ({ menu_code: m.code, mode: m.mode })),
    }),
};
