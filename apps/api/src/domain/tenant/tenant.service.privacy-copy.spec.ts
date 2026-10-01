import { Repository } from 'typeorm';
import { TenantService, nextNoticeVersion } from './tenant.service';
import { Tenant } from './entity/tenant.entity';
import { IntegrationCredential } from './entity/integration-credential.entity';
import { User } from '../user/entity/user.entity';
import { IntegrationService } from '../integration/integration.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * Saving the consent notice copy (PLN-261001 §2-4).
 *
 * The delicate part is not storing text — it is the version. Raising it asks
 * every shopper who already consented to consent again, so a typo fix must not
 * do it and a material change must. The operator declares which.
 */
describe('TenantService.updatePrivacyNotice — profile, copy, version', () => {
  let tenant: Tenant;
  let svc: TenantService;

  beforeEach(() => {
    tenant = {
      id: 1,
      status: 'active',
      commerceEnabled: 0,
      privacyPolicyUrl: null,
      consentNoticeVersion: null,
      privacyProfile: null,
      privacyNoticeCopy: null,
    } as Tenant;

    svc = new TenantService(
      {
        findOne: jest.fn(async () => tenant),
        save: jest.fn(async (t: Tenant) => t),
      } as unknown as Repository<Tenant>,
      {} as Repository<IntegrationCredential>,
      {} as Repository<User>,
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      {} as IntegrationService,
      { write: jest.fn(async () => undefined) } as unknown as AuditService,
    );
  });

  it('stores the profile and drops blank override lines', async () => {
    const saved = await svc.updatePrivacyNotice(1, 9, {
      privacy_profile: 'lodging',
      privacy_notice_copy: { KO: { items: '수집 항목: 메시지', purpose: '   ' } },
    } as never);

    expect(saved.privacyProfile).toBe('lodging');
    expect(saved.privacyNoticeCopy).toEqual({ KO: { items: '수집 항목: 메시지' } });
  });

  it('refuses a profile it does not ship', async () => {
    await expect(
      svc.updatePrivacyNotice(1, 9, { privacy_profile: 'hotel' } as never),
    ).rejects.toThrow(BusinessException);
  });

  it('leaves the version alone unless the operator says it is material', async () => {
    tenant.consentNoticeVersion = '2026-07';
    const saved = await svc.updatePrivacyNotice(1, 9, {
      privacy_notice_copy: { EN: { items: 'What we collect: messages.' } },
    } as never);
    expect(saved.consentNoticeVersion).toBe('2026-07');
  });

  it('raises the version when they do', async () => {
    tenant.consentNoticeVersion = '2026-07';
    const saved = await svc.updatePrivacyNotice(1, 9, { bump_version: true } as never);
    expect(saved.consentNoticeVersion).not.toBe('2026-07');
  });

  it('clears the overrides when sent null', async () => {
    tenant.privacyNoticeCopy = { KO: { items: 'x' } } as never;
    const saved = await svc.updatePrivacyNotice(1, 9, { privacy_notice_copy: null } as never);
    expect(saved.privacyNoticeCopy).toBeNull();
  });
});

describe('nextNoticeVersion', () => {
  it('moves to this month when the stored one is older', () => {
    const now = new Date().toISOString().slice(0, 7);
    expect(nextNoticeVersion('2020-01')).toBe(now);
  });

  it('adds a suffix for a second change in the same month', () => {
    const now = new Date().toISOString().slice(0, 7);
    expect(nextNoticeVersion(now)).toBe(`${now}.2`);
    expect(nextNoticeVersion(`${now}.2`)).toBe(`${now}.3`);
  });

  it('starts at this month when nothing was set', () => {
    expect(nextNoticeVersion(null)).toBe(new Date().toISOString().slice(0, 7));
  });

  it('leaves a scheme it does not understand untouched', () => {
    // Inventing a successor for someone else's versioning would re-prompt every
    // shopper for a change we cannot even describe.
    expect(nextNoticeVersion('v3-final')).toBe('v3-final');
  });
});
