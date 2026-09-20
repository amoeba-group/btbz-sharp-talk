import {
  ADMIN_LEVEL,
  AdminLevel,
  USER_RANK,
  UserRank,
  JOB_LABEL,
  JobLabel,
  CAPABILITY,
  Capability,
} from '@sharptalk/types';

/**
 * Default capability matrix — CHATWIDGET-RBAC-1.0.0.
 * This is the seed/fallback for `roles_permissions`; the DB table can override
 * per-tenant. Two layers: (1) rank/level grants, (2) label-gated module access.
 * Effective = rankAllows(cap) && (capRequiresLabel ? hasMatchingLabel : true).
 */

// System-admin capability grants by level.
const ADMIN_CAPS: Record<AdminLevel, Capability[]> = {
  [ADMIN_LEVEL.SUPER_ADMIN]: [
    CAPABILITY.TENANT_APPROVE,
    CAPABILITY.TENANT_OFFBOARD,
    CAPABILITY.ADMIN_ACCOUNT_MANAGE,
    CAPABILITY.GLOBAL_SETTINGS_WRITE,
    CAPABILITY.AI_ENGINE_MANAGE,
    CAPABILITY.BILLING_MANAGE,
    CAPABILITY.PLATFORM_AUDIT_READ,
    // A platform admin reading the audit trail is reading it across every
    // tenant, so the tenant-scoped capability is implied by the platform one.
    // Without this the audit console 403'd for admins while the tenant users
    // who hold TENANT_AUDIT_READ had no route to it — nobody could read it.
    CAPABILITY.TENANT_AUDIT_READ,
  ],
  [ADMIN_LEVEL.ADMIN]: [
    CAPABILITY.TENANT_APPROVE,
    CAPABILITY.AI_ENGINE_MANAGE,
    CAPABILITY.PLATFORM_AUDIT_READ,
    CAPABILITY.TENANT_AUDIT_READ,
  ],
};

// Tenant-user capability grants by rank (cumulative authority, deny-by-default).
const RANK_CAPS: Record<UserRank, Capability[]> = {
  [USER_RANK.MASTER]: [
    CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE,
    // Master only: this screen takes an API key and decides who is billed for
    // the model calls (PLN-260824 D2).
    CAPABILITY.TENANT_AI_ENGINE_MANAGE,
    CAPABILITY.TENANT_SETTINGS_MANAGE,
    CAPABILITY.USER_INVITE,
    CAPABILITY.USER_RANK_ADJUST,
    CAPABILITY.LABEL_EDIT,
    CAPABILITY.LABEL_ASSIGN,
    CAPABILITY.AI_SETTINGS_MANAGE,
    CAPABILITY.KNOWLEDGE_SOURCE_MANAGE,
    CAPABILITY.CONVERSATION_ASSIGN,
    CAPABILITY.CONVERSATION_HANDLE,
    CAPABILITY.ANALYTICS_READ,
    CAPABILITY.CAMPAIGN_SEND,
    CAPABILITY.TENANT_AUDIT_READ,
    CAPABILITY.CUSTOMER_MANAGE,
    CAPABILITY.CUSTOMER_PII_REVEAL,
    CAPABILITY.MODULE_CONSULT,
    CAPABILITY.MODULE_ACCOUNTING,
    CAPABILITY.MODULE_OPERATIONS,
  ],
  [USER_RANK.DIRECTOR]: [
    CAPABILITY.USER_INVITE,
    CAPABILITY.LABEL_ASSIGN,
    CAPABILITY.AI_SETTINGS_MANAGE,
    CAPABILITY.KNOWLEDGE_SOURCE_MANAGE,
    CAPABILITY.CONVERSATION_ASSIGN,
    CAPABILITY.CONVERSATION_HANDLE,
    CAPABILITY.ANALYTICS_READ,
    CAPABILITY.CAMPAIGN_SEND,
    CAPABILITY.TENANT_AUDIT_READ,
    CAPABILITY.CUSTOMER_MANAGE,
    // Reading contact details stops here: manager and staff work with masked
    // values and ask for a reveal when they genuinely need one (PLN-260920).
    CAPABILITY.CUSTOMER_PII_REVEAL,
    CAPABILITY.MODULE_CONSULT,
    CAPABILITY.MODULE_ACCOUNTING,
    CAPABILITY.MODULE_OPERATIONS,
  ],
  [USER_RANK.MANAGER]: [
    CAPABILITY.LABEL_ASSIGN,
    CAPABILITY.AI_SETTINGS_MANAGE,
    CAPABILITY.CONVERSATION_ASSIGN,
    CAPABILITY.CONVERSATION_HANDLE,
    CAPABILITY.ANALYTICS_READ,
    CAPABILITY.CAMPAIGN_SEND,
    CAPABILITY.CUSTOMER_MANAGE,
    CAPABILITY.MODULE_CONSULT,
    CAPABILITY.MODULE_ACCOUNTING,
    CAPABILITY.MODULE_OPERATIONS,
  ],
  [USER_RANK.STAFF]: [
    CAPABILITY.CONVERSATION_HANDLE,
    CAPABILITY.MODULE_CONSULT,
    CAPABILITY.MODULE_ACCOUNTING,
    CAPABILITY.MODULE_OPERATIONS,
  ],
};

// Capabilities that additionally require a matching job label (label-gated modules).
const CAP_REQUIRED_LABEL: Partial<Record<Capability, JobLabel>> = {
  [CAPABILITY.MODULE_CONSULT]: JOB_LABEL.CONSULT,
  [CAPABILITY.MODULE_ACCOUNTING]: JOB_LABEL.ACCOUNTING,
  [CAPABILITY.MODULE_OPERATIONS]: JOB_LABEL.OPERATIONS,
  [CAPABILITY.CONVERSATION_HANDLE]: JOB_LABEL.CONSULT,
  [CAPABILITY.CONVERSATION_ASSIGN]: JOB_LABEL.CONSULT,
  [CAPABILITY.CAMPAIGN_SEND]: JOB_LABEL.OPERATIONS,
};

export function adminCan(level: AdminLevel, capability: Capability): boolean {
  return ADMIN_CAPS[level]?.includes(capability) ?? false;
}

export function userCan(rank: UserRank, labels: JobLabel[], capability: Capability): boolean {
  const rankGrants = RANK_CAPS[rank]?.includes(capability) ?? false;
  if (!rankGrants) return false;
  // Master bypasses label-gating (owns everything in tenant).
  if (rank === USER_RANK.MASTER) return true;
  const requiredLabel = CAP_REQUIRED_LABEL[capability];
  if (!requiredLabel) return true;
  return labels.includes(requiredLabel);
}

export { ADMIN_CAPS, RANK_CAPS, CAP_REQUIRED_LABEL };
