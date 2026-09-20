import { ADMIN_LEVEL, AdminLevel, USER_RANK, UserRank, JobLabel, ActorType } from '../common/enum.types';

/**
 * Capabilities (action-level RBAC) — CHATWIDGET-RBAC-1.0.0.
 * Effective permission = rank-matrix ∩ label-matrix (FR-056).
 */
export const CAPABILITY = {
  // System admin (scope=system)
  TENANT_APPROVE: 'tenant.approve',
  TENANT_OFFBOARD: 'tenant.offboard',
  ADMIN_ACCOUNT_MANAGE: 'admin_account.manage',
  GLOBAL_SETTINGS_WRITE: 'global_settings.write',
  AI_ENGINE_MANAGE: 'ai_engine.manage',
  BILLING_MANAGE: 'billing.manage',
  PLATFORM_AUDIT_READ: 'platform_audit.read',
  // Tenant (scope=tenant)
  INTEGRATION_CREDENTIALS_MANAGE: 'integration_credentials.manage',
  TENANT_SETTINGS_MANAGE: 'tenant_settings.manage',
  /**
   * Register and edit the tenant's OWN AI engines (PLN-260824 D1).
   *
   * Deliberately not AI_ENGINE_MANAGE: that one means "curate the platform
   * catalogue for everyone" and is held by admins. Reusing it here would let a
   * single grant mean two different scopes depending on who holds it, which is
   * how a permission boundary stops being checkable.
   */
  TENANT_AI_ENGINE_MANAGE: 'tenant_ai_engine.manage',

  USER_INVITE: 'user.invite',
  USER_RANK_ADJUST: 'user.rank_adjust',
  LABEL_EDIT: 'label.edit',
  LABEL_ASSIGN: 'label.assign',
  AI_SETTINGS_MANAGE: 'ai_settings.manage',
  KNOWLEDGE_SOURCE_MANAGE: 'knowledge_source.manage',
  CONVERSATION_ASSIGN: 'conversation.assign',
  CONVERSATION_HANDLE: 'conversation.handle',
  ANALYTICS_READ: 'analytics.read',
  CAMPAIGN_SEND: 'campaign.send',
  TENANT_AUDIT_READ: 'tenant_audit.read',
  // Label-scoped modules
  MODULE_CONSULT: 'module.consult',
  MODULE_ACCOUNTING: 'module.accounting',
  MODULE_OPERATIONS: 'module.operations',
  CUSTOMER_MANAGE: 'customer.manage',
  /**
   * See a customer's UNMASKED name/email/phone (FIX/PLN-260920).
   *
   * Deliberately separate from CUSTOMER_MANAGE: managing a customer (tier,
   * display name) is day-to-day work, reading their contact details is a
   * privacy event that has to be logged and held by fewer people. Every grant
   * of this capability produces `customer.pii_revealed` audit rows.
   */
  CUSTOMER_PII_REVEAL: 'customer.pii_reveal',
} as const;
export type Capability = (typeof CAPABILITY)[keyof typeof CAPABILITY];

export interface AdminPrincipal {
  actorType: ActorType;
  adminId: number;
  email: string;
  level: AdminLevel;
}

export interface UserPrincipal {
  actorType: ActorType;
  userId: number;
  tenantId: number;
  email: string;
  rank: UserRank;
  labels: JobLabel[];
}

export type Principal =
  | ({ actorType: 'admin' } & Omit<AdminPrincipal, 'actorType'>)
  | ({ actorType: 'user' } & Omit<UserPrincipal, 'actorType'>);

export { ADMIN_LEVEL, USER_RANK };
