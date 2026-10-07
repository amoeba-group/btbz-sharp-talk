import { adminCan, userCan } from './permission-matrix';
import { ADMIN_LEVEL, USER_RANK, JOB_LABEL, CAPABILITY } from '@sharptalk/types';

describe('permission-matrix — adminCan', () => {
  it('grants super_admin the full system capability set', () => {
    expect(adminCan(ADMIN_LEVEL.SUPER_ADMIN, CAPABILITY.TENANT_OFFBOARD)).toBe(true);
    expect(adminCan(ADMIN_LEVEL.SUPER_ADMIN, CAPABILITY.ADMIN_ACCOUNT_MANAGE)).toBe(true);
    expect(adminCan(ADMIN_LEVEL.SUPER_ADMIN, CAPABILITY.BILLING_MANAGE)).toBe(true);
    expect(adminCan(ADMIN_LEVEL.SUPER_ADMIN, CAPABILITY.TENANT_APPROVE)).toBe(true);
  });

  it('grants admin only the reduced subset (not super-admin-only caps)', () => {
    expect(adminCan(ADMIN_LEVEL.ADMIN, CAPABILITY.TENANT_APPROVE)).toBe(true);
    expect(adminCan(ADMIN_LEVEL.ADMIN, CAPABILITY.AI_ENGINE_MANAGE)).toBe(true);
    // super-admin exclusives are denied to plain admin
    expect(adminCan(ADMIN_LEVEL.ADMIN, CAPABILITY.TENANT_OFFBOARD)).toBe(false);
    expect(adminCan(ADMIN_LEVEL.ADMIN, CAPABILITY.ADMIN_ACCOUNT_MANAGE)).toBe(false);
    expect(adminCan(ADMIN_LEVEL.ADMIN, CAPABILITY.BILLING_MANAGE)).toBe(false);
    expect(adminCan(ADMIN_LEVEL.ADMIN, CAPABILITY.GLOBAL_SETTINGS_WRITE)).toBe(false);
  });

  it('denies tenant-scoped capabilities to any admin level (deny-by-default)', () => {
    expect(adminCan(ADMIN_LEVEL.SUPER_ADMIN, CAPABILITY.CAMPAIGN_SEND)).toBe(false);
    expect(adminCan(ADMIN_LEVEL.ADMIN, CAPABILITY.CONVERSATION_HANDLE)).toBe(false);
  });
});

describe('permission-matrix — userCan', () => {
  it('master bypasses label-gating (owns everything granted to the rank)', () => {
    // No labels at all, yet master gets label-gated modules.
    expect(userCan(USER_RANK.MASTER, [], CAPABILITY.MODULE_CONSULT)).toBe(true);
    expect(userCan(USER_RANK.MASTER, [], CAPABILITY.MODULE_OPERATIONS)).toBe(true);
    expect(userCan(USER_RANK.MASTER, [], CAPABILITY.CAMPAIGN_SEND)).toBe(true);
    expect(userCan(USER_RANK.MASTER, [], CAPABILITY.CONVERSATION_HANDLE)).toBe(true);
  });

  it('master is still bounded by the rank matrix for caps it does not own', () => {
    // ADMIN_ACCOUNT_MANAGE is a system-admin capability, not in any rank grant.
    expect(userCan(USER_RANK.MASTER, [], CAPABILITY.ADMIN_ACCOUNT_MANAGE)).toBe(false);
  });

  it('staff with consult label may handle consult module & conversations', () => {
    expect(userCan(USER_RANK.STAFF, [JOB_LABEL.CONSULT], CAPABILITY.MODULE_CONSULT)).toBe(true);
    expect(userCan(USER_RANK.STAFF, [JOB_LABEL.CONSULT], CAPABILITY.CONVERSATION_HANDLE)).toBe(true);
  });

  it('sales_admin satisfies the consult-gated conversation capabilities (PLN-261007)', () => {
    expect(userCan(USER_RANK.STAFF, [JOB_LABEL.SALES_ADMIN], CAPABILITY.CONVERSATION_HANDLE)).toBe(true);
    expect(userCan(USER_RANK.STAFF, [JOB_LABEL.SALES_ADMIN], CAPABILITY.MODULE_CONSULT)).toBe(true);
    expect(userCan(USER_RANK.MANAGER, [JOB_LABEL.SALES_ADMIN], CAPABILITY.CONVERSATION_ASSIGN)).toBe(true);
    // Not a superset of operations: campaigns stay with the operations label.
    expect(userCan(USER_RANK.MANAGER, [JOB_LABEL.SALES_ADMIN], CAPABILITY.CAMPAIGN_SEND)).toBe(false);
    expect(userCan(USER_RANK.MANAGER, [JOB_LABEL.SALES_ADMIN], CAPABILITY.MODULE_OPERATIONS)).toBe(false);
  });

  it('staff with consult label may NOT send campaigns (not in staff rank grant)', () => {
    expect(userCan(USER_RANK.STAFF, [JOB_LABEL.CONSULT], CAPABILITY.CAMPAIGN_SEND)).toBe(false);
  });

  it('staff without the matching label is denied a label-gated module', () => {
    // MODULE_OPERATIONS is in the staff rank grant but gated by the operations label.
    expect(userCan(USER_RANK.STAFF, [JOB_LABEL.CONSULT], CAPABILITY.MODULE_OPERATIONS)).toBe(false);
    expect(userCan(USER_RANK.STAFF, [], CAPABILITY.MODULE_CONSULT)).toBe(false);
  });

  it('manager without operations label is denied MODULE_OPERATIONS', () => {
    expect(userCan(USER_RANK.MANAGER, [JOB_LABEL.CONSULT], CAPABILITY.MODULE_OPERATIONS)).toBe(false);
    // …but with the operations label it is granted (rank allows + label matches)
    expect(userCan(USER_RANK.MANAGER, [JOB_LABEL.OPERATIONS], CAPABILITY.MODULE_OPERATIONS)).toBe(true);
  });

  it('manager may send campaigns only with the operations label (CAMPAIGN_SEND is gated)', () => {
    expect(userCan(USER_RANK.MANAGER, [], CAPABILITY.CAMPAIGN_SEND)).toBe(false);
    expect(userCan(USER_RANK.MANAGER, [JOB_LABEL.OPERATIONS], CAPABILITY.CAMPAIGN_SEND)).toBe(true);
  });

  it('denies a capability not in the rank grant regardless of labels', () => {
    // USER_RANK_ADJUST is master-only.
    expect(
      userCan(USER_RANK.MANAGER, [JOB_LABEL.CONSULT, JOB_LABEL.OPERATIONS], CAPABILITY.USER_RANK_ADJUST),
    ).toBe(false);
  });

  it('both admin levels can read the audit trail (regression: nobody could)', () => {
    // The audit console lives on the system-admin route but GET /audit is
    // guarded by the tenant capability. Admins held only PLATFORM_AUDIT_READ,
    // so every request 403'd while the tenant users who did hold
    // TENANT_AUDIT_READ had no route to the page — the log was unreadable.
    for (const level of [ADMIN_LEVEL.SUPER_ADMIN, ADMIN_LEVEL.ADMIN]) {
      expect(adminCan(level, CAPABILITY.PLATFORM_AUDIT_READ)).toBe(true);
      expect(adminCan(level, CAPABILITY.TENANT_AUDIT_READ)).toBe(true);
    }
    // Tenant side is unchanged: master/director yes, manager no.
    expect(userCan(USER_RANK.MASTER, [], CAPABILITY.TENANT_AUDIT_READ)).toBe(true);
    expect(userCan(USER_RANK.DIRECTOR, [], CAPABILITY.TENANT_AUDIT_READ)).toBe(true);
    expect(userCan(USER_RANK.MANAGER, [], CAPABILITY.TENANT_AUDIT_READ)).toBe(false);
  });

  it('deny-by-default for an unknown capability', () => {
    expect(userCan(USER_RANK.MASTER, [], 'totally.unknown' as never)).toBe(false);
    expect(adminCan(ADMIN_LEVEL.SUPER_ADMIN, 'totally.unknown' as never)).toBe(false);
  });
});
