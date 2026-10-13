import { Repository } from 'typeorm';
import { TenantService } from './tenant.service';
import { TenantMapper } from './tenant.mapper';
import { TenantController } from './tenant.controller';
import { Tenant } from './entity/tenant.entity';
import { IntegrationCredential } from './entity/integration-credential.entity';
import { User } from '../user/entity/user.entity';
import { IntegrationService } from '../integration/integration.service';
import { AuditService } from '../audit/audit.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { REQUIRE_RANK_KEY } from '../../global/decorator/auth.decorator';

/**
 * The tenant's signed-identity policy (PLN-261012 SG-03 / SG-04): save-time validation,
 * the audit trail, and what the console reads back.
 */
describe('TenantService.updateIdentityPolicy', () => {
  let tenant: Tenant;
  let auditWrite: jest.Mock;
  let svc: TenantService;
  let tenantSave: jest.Mock;

  beforeEach(() => {
    tenant = { id: 1, uuid: 'u-1', shopDomain: 'acme.example', slug: 'acme', name: 'Acme', status: 'active', identityPolicy: null } as unknown as Tenant;
    auditWrite = jest.fn(async () => undefined);
    tenantSave = jest.fn(async (t: Tenant) => t);
    const tenantRepo = {
      findOne: jest.fn(async () => tenant),
      save: tenantSave,
      update: jest.fn(async () => undefined),
    } as unknown as Repository<Tenant>;
    svc = new TenantService(
      tenantRepo,
      {} as Repository<IntegrationCredential>,
      {} as Repository<User>,
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      {} as IntegrationService,
      { write: auditWrite } as unknown as AuditService,
    );
  });

  it('stores a custom max age and the v1 refusal, and audits the change', async () => {
    const saved = await svc.updateIdentityPolicy(1, 9, { max_age_hours: 4, refuse_v1: true });

    expect(saved.identityPolicy).toEqual({ maxAgeHours: 4, refuseV1: true });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 1,
        actorType: 'user',
        actorId: 9,
        action: 'tenant.identity_policy_updated',
        metadata: { maxAgeHours: 4, refuseV1: true },
      }),
    );
  });

  it('nothing set clears the column to NULL — back to the platform default, byte-identical to never configured', async () => {
    tenant.identityPolicy = { maxAgeHours: 4, refuseV1: true };

    const saved = await svc.updateIdentityPolicy(1, 9, { max_age_hours: null, refuse_v1: false });

    expect(saved.identityPolicy).toBeNull();
    expect(auditWrite).toHaveBeenCalledWith(expect.objectContaining({ metadata: { cleared: true } }));
  });

  it('an omitted field is "not set", not "keep the stored value" — the policy is sent whole', async () => {
    tenant.identityPolicy = { maxAgeHours: 4, refuseV1: true };

    const saved = await svc.updateIdentityPolicy(1, 9, {});

    expect(saved.identityPolicy).toBeNull();
  });

  it.each([[0], [-5], [721], [1.5], [NaN], [1e9]])(
    'refuses max_age_hours = %p with E5097 and saves nothing (a typo must not switch expiry off)',
    async (hours) => {
      await expect(svc.updateIdentityPolicy(1, 9, { max_age_hours: hours })).rejects.toMatchObject({
        errorCode: ERROR_CODE.IDENTITY_POLICY_INVALID.code,
        status: 400,
      });
      expect(tenantSave).not.toHaveBeenCalled();
      expect(auditWrite).not.toHaveBeenCalled();
    },
  );

  it('accepts both bounds', async () => {
    await expect(svc.updateIdentityPolicy(1, 9, { max_age_hours: 1 })).resolves.toBeDefined();
    await expect(svc.updateIdentityPolicy(1, 9, { max_age_hours: 720 })).resolves.toBeDefined();
  });

  it('a failing audit write does not turn a saved policy into an error', async () => {
    auditWrite.mockRejectedValueOnce(new Error('audit down'));

    await expect(svc.updateIdentityPolicy(1, 9, { max_age_hours: 4 })).resolves.toMatchObject({
      identityPolicy: { maxAgeHours: 4 },
    });
  });
});

describe('TenantMapper.toIdentityPolicy (what the console reads back)', () => {
  const before = process.env.IDENTITY_MAX_AGE_HOURS;
  afterEach(() => {
    if (before === undefined) delete process.env.IDENTITY_MAX_AGE_HOURS;
    else process.env.IDENTITY_MAX_AGE_HOURS = before;
  });
  const tenant = (identityPolicy: unknown) => ({ identityPolicy }) as unknown as Tenant;

  it('never configured: nothing stored, the platform default (8 h) in force', () => {
    delete process.env.IDENTITY_MAX_AGE_HOURS;

    expect(TenantMapper.toIdentityPolicy(tenant(null))).toEqual({
      maxAgeHours: null,
      refuseV1: false,
      effectiveHours: 8,
      platformDefaultHours: 8,
    });
  });

  it('an override is what is in force; the platform default is still reported for the radio label', () => {
    process.env.IDENTITY_MAX_AGE_HOURS = '12';

    expect(TenantMapper.toIdentityPolicy(tenant({ maxAgeHours: 3, refuseV1: true }))).toEqual({
      maxAgeHours: 3,
      refuseV1: true,
      effectiveHours: 3,
      platformDefaultHours: 12,
    });
  });

  it('the platform kill switch reads as "no expiry" unless the tenant sets its own', () => {
    process.env.IDENTITY_MAX_AGE_HOURS = '0';

    expect(TenantMapper.toIdentityPolicy(tenant(null))).toMatchObject({ effectiveHours: null, platformDefaultHours: null });
    expect(TenantMapper.toIdentityPolicy(tenant({ maxAgeHours: 5 }))).toMatchObject({ effectiveHours: 5, platformDefaultHours: null });
  });

  it('a junk stored value reads as never configured', () => {
    expect(TenantMapper.toIdentityPolicy(tenant({ maxAgeHours: 'abc', refuseV1: 'yes' }))).toMatchObject({
      maxAgeHours: null,
      refuseV1: false,
    });
  });
});

describe('TenantController identity-policy routes — who may call them', () => {
  const ranks = (method: keyof TenantController) =>
    Reflect.getMetadata(REQUIRE_RANK_KEY, TenantController.prototype[method] as never) as string[] | undefined;

  it('MASTER and DIRECTOR may read it, only MASTER may change it', () => {
    // The console card disables the form for a DIRECTOR on the same rule.
    expect(ranks('getIdentityPolicy')).toEqual(['master', 'director']);
    expect(ranks('updateIdentityPolicy')).toEqual(['master']);
  });
});
