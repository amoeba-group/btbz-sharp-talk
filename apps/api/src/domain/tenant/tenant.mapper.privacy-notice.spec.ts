import { TenantMapper } from './tenant.mapper';
import { Tenant } from './entity/tenant.entity';

/**
 * The console reads the notice settings through this mapper. For the Vietnam
 * profile it has to (a) show the placeholders already filled in, the way a
 * shopper will read them, and (b) tell the operator when the draft is still
 * unfinished (PLN-261012 SG-70).
 */
describe('TenantMapper.toPrivacyNotice — vn_pdpl (SG-70)', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  const tenant = (over: Partial<Tenant> = {}): Tenant =>
    ({
      id: 1,
      privacyProfile: 'vn_pdpl',
      commerceEnabled: 0,
      privacyPolicyUrl: null,
      consentNoticeVersion: null,
      privacyNoticeCopy: null,
      ...over,
    }) as Tenant;

  it('shows the profile wording with the server-side values already substituted', () => {
    process.env.CONVERSATION_LOG_RETENTION_DAYS = '180';
    process.env.AI_PROCESSING_REGION = 'US';
    const out = TenantMapper.toPrivacyNotice(tenant());
    expect(out.effectiveProfile).toBe('vn_pdpl');
    expect(out.profileCopy.VI.retention).toContain('180 ngày');
    expect(out.profileCopy.VI.crossBorder).toContain('Hoa Kỳ');
    expect(out.profileCopy.EN.retention).toContain('180 days');
  });

  it('flags every language still showing a [[…]] controller placeholder', () => {
    const out = TenantMapper.toPrivacyNotice(tenant());
    // vi and en carry it natively; the other four fall back to the EN line.
    expect(out.unfilledPlaceholders.map((u) => u.language).sort()).toEqual(['EN', 'ES', 'JA', 'KO', 'VI', 'ZH']);
    expect(out.unfilledPlaceholders.every((u) => u.keys.join() === 'controller')).toBe(true);
  });

  it('clears the warning for a language once the tenant writes the real controller line', () => {
    const out = TenantMapper.toPrivacyNotice(
      tenant({
        privacyNoticeCopy: {
          VI: { controller: 'Bên kiểm soát dữ liệu: Công ty Go2Joy Việt Nam, Hà Nội. DPO: dpo@example.vn.' },
        } as never,
      }),
    );
    const languages = out.unfilledPlaceholders.map((u) => u.language);
    expect(languages).not.toContain('VI');
    expect(languages).toContain('EN');
  });

  it('reports nothing for a tenant on another profile', () => {
    const out = TenantMapper.toPrivacyNotice(tenant({ privacyProfile: 'lodging' }));
    expect(out.unfilledPlaceholders).toEqual([]);
  });
});
