import { Repository } from 'typeorm';
import { TenantService } from './tenant.service';
import { Tenant } from './entity/tenant.entity';
import { IntegrationCredential } from './entity/integration-credential.entity';
import { User } from '../user/entity/user.entity';
import { IntegrationService } from '../integration/integration.service';
import { AuditService } from '../audit/audit.service';

/** Tenant privacy-notice settings (PLN-Privacy-Control-Gap Stage 2). */
describe('TenantService.updatePrivacyNotice', () => {
  let tenant: Tenant;
  let auditWrite: jest.Mock;
  let svc: TenantService;

  beforeEach(() => {
    tenant = {
      id: 1,
      uuid: 'u-1',
      shopDomain: 'acme.myshopify.com',
      slug: 'acme',
      name: 'Acme',
      status: 'active',
      plan: null,
      privacyPolicyUrl: null,
      consentNoticeVersion: null,
    } as Tenant;
    auditWrite = jest.fn();

    const tenantRepo = {
      findOne: jest.fn(async () => tenant),
      save: jest.fn(async (t: Tenant) => t),
    } as unknown as Repository<Tenant>;

    svc = new TenantService(
      tenantRepo,
      {} as Repository<IntegrationCredential>,
      {} as Repository<User>,
      // ContentFilterRule repo — count>0 so any seedDefaultModeration call no-ops.
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      // JobLabel repo — count>0 so any seedDefaultJobLabels call no-ops.
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      // UsageType repo — same, for seedDefaultUsageTypes.
      { count: jest.fn(async () => 1), save: jest.fn(), create: jest.fn() } as never,
      {} as IntegrationService,
      { write: auditWrite } as unknown as AuditService,
    );
  });

  it('sets URL and version, audits with the new version as target', async () => {
    const saved = await svc.updatePrivacyNotice(1, 7, {
      privacy_policy_url: 'https://acme.example/privacy',
      consent_notice_version: '2026-08',
    });
    expect(saved.privacyPolicyUrl).toBe('https://acme.example/privacy');
    expect(saved.consentNoticeVersion).toBe('2026-08');
    expect(auditWrite).toHaveBeenCalledWith({
      tenantId: 1,
      actorType: 'user',
      actorId: 7,
      action: 'tenant.privacy_notice_updated',
      target: '2026-08',
    });
  });

  it('audits with the URL host when only the URL is set', async () => {
    await svc.updatePrivacyNotice(1, 7, { privacy_policy_url: 'https://acme.example/privacy?x=1' });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'acme.example' }),
    );
  });

  it('PATCH semantics: omitted fields stay, null clears to platform default', async () => {
    tenant.privacyPolicyUrl = 'https://old.example/privacy';
    tenant.consentNoticeVersion = 'v1';
    const saved = await svc.updatePrivacyNotice(1, 7, { consent_notice_version: null });
    expect(saved.privacyPolicyUrl).toBe('https://old.example/privacy'); // untouched
    expect(saved.consentNoticeVersion).toBeNull(); // cleared → fallback applies
  });

  /** Widget copy merge (PLN-260808-Widget-Greetings): flat fields → JSON blob. */
  describe('updateWidgetSettings widget copy', () => {
    it('folds per-language fields into widget_copy, trimming and dropping empties', async () => {
      const saved = await svc.updateWidgetSettings(1, 7, {
        login_mode: 'redirect',
        display_name: '  IVY 뷰티샵 ',
        first_visit_ko: '어서오세요!',
        first_visit_en: '   ',
        login_greeting_ko: '{name}님 반갑습니다. 무엇을 도와드릴까요?',
      });
      expect(saved.widgetCopy).toEqual({
        displayName: 'IVY 뷰티샵',
        firstVisit: { KO: '어서오세요!' },
        loginGreeting: { KO: '{name}님 반갑습니다. 무엇을 도와드릴까요?' },
      });
    });

    it('PATCH semantics: undefined keeps stored copy, empty clears; all-empty → null', async () => {
      tenant.widgetCopy = {
        displayName: 'Old',
        firstVisit: { EN: 'Hello', KO: '안녕' },
        loginGreeting: {},
      };
      const saved = await svc.updateWidgetSettings(1, 7, {
        login_mode: 'redirect',
        first_visit_en: '', // clear EN only
      });
      expect(saved.widgetCopy).toEqual({
        displayName: 'Old',
        firstVisit: { KO: '안녕' },
        loginGreeting: {},
      });

      const cleared = await svc.updateWidgetSettings(1, 7, {
        login_mode: 'redirect',
        display_name: null,
        first_visit_ko: '',
      });
      expect(cleared.widgetCopy).toBeNull();
    });
  });

  /**
   * Tab configuration (PLN-260817-Widget-Tab-Config). The column is JSON with
   * nothing but this method between a console request and what the widget
   * renders, so normalization and the empty-set refusal are pinned here.
   */
  describe('updateWidgetSettings tab configuration', () => {
    it('stores tabs in canonical order regardless of how they were ticked', async () => {
      const saved = await svc.updateWidgetSettings(1, 7, {
        login_mode: 'redirect',
        tabs: ['chat', 'orders', 'notifications'],
      });
      expect(saved.widgetTabs).toEqual(['notifications', 'orders', 'chat']);
    });

    it('refuses a tab set that renders nothing', async () => {
      // An empty bar leaves the shopper on a panel they cannot navigate away
      // from, so this is a 400 rather than a save that "works".
      await expect(
        svc.updateWidgetSettings(1, 7, { login_mode: 'redirect', tabs: [] }),
      ).rejects.toThrow();
      await expect(
        svc.updateWidgetSettings(1, 7, {
          login_mode: 'redirect',
          tabs: ['ghost'] as never,
        }),
      ).rejects.toThrow();
    });

    it('stores the store-features flag and keeps it when omitted (PLN-261001)', async () => {
      tenant.commerceEnabled = 1;
      const off = await svc.updateWidgetSettings(1, 7, { login_mode: 'redirect', commerce_enabled: false });
      expect(off.commerceEnabled).toBe(0);
      const kept = await svc.updateWidgetSettings(1, 7, { login_mode: 'redirect' });
      expect(kept.commerceEnabled).toBe(0);
      const on = await svc.updateWidgetSettings(1, 7, { login_mode: 'redirect', commerce_enabled: true });
      expect(on.commerceEnabled).toBe(1);
    });

    it('leaves the stored configuration alone when the request omits it', async () => {
      tenant.widgetTabs = ['notifications', 'orders'];
      tenant.widgetTabPosition = 'bottom';
      const saved = await svc.updateWidgetSettings(1, 7, { login_mode: 'popup' });
      expect(saved.widgetTabs).toEqual(['notifications', 'orders']);
      expect(saved.widgetTabPosition).toBe('bottom');
    });

    it('records the resulting layout in the audit trail', async () => {
      await svc.updateWidgetSettings(1, 7, {
        login_mode: 'redirect',
        tabs: ['notifications', 'chat'],
        tab_position: 'bottom',
      });
      expect(auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.widget_settings_updated',
          target: expect.stringContaining('tabs:notifications+chat@bottom'),
        }),
      );
    });
  });
  describe('updateKnowledgeSettings (PLN-260910)', () => {
    it('stores the switch as 0/1 and audits the resulting state', async () => {
      const saved = await svc.updateKnowledgeSettings(1, 7, { usage_guides_enabled: true });
      expect(saved.usageGuidesEnabled).toBe(1);
      expect(auditWrite).toHaveBeenCalledWith({
        tenantId: 1,
        actorType: 'user',
        actorId: 7,
        action: 'tenant.knowledge_settings_updated',
        target: 'usage_guides:on',
      });
    });

    it('turning it off keeps the row and records off', async () => {
      tenant.usageGuidesEnabled = 1;
      const saved = await svc.updateKnowledgeSettings(1, 7, { usage_guides_enabled: false });
      expect(saved.usageGuidesEnabled).toBe(0);
      expect(auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'usage_guides:off' }),
      );
    });
  });
  describe('updateWidgetTheme design profile (PLN-260910 P2)', () => {
    const withAssets = (rows: Record<string, { uuid: string; kind: string; version: number }>) =>
      new TenantService(
        { findOne: jest.fn(async () => tenant), save: jest.fn(async (t: Tenant) => t) } as never,
        {} as never,
        {} as never,
        { count: jest.fn(async () => 1) } as never,
        { count: jest.fn(async () => 1) } as never,
        { count: jest.fn(async () => 1) } as never,
        {} as never,
        { write: auditWrite } as never,
        undefined as never,
        {
          get: jest.fn(async (_t: number, uuid: string) => {
            const row = rows[uuid];
            if (!row) throw new Error('not found');
            return row;
          }),
        } as never,
      );

    it('stores verified asset refs (uuid + version) and clamps sizes', async () => {
      const font = '94c2949c-3ce5-47be-acb3-3c4cfa7c58b3';
      const svc2 = withAssets({ [font]: { uuid: font, kind: 'font', version: 2 } });
      const saved = await svc2.updateWidgetTheme(1, 7, {
        brand: '#2B7FFF',
        design: { font: { preset: 'custom', asset_uuid: font, base_size: 99 }, radius: 'lg', panel: { width: 100, height: 700 } },
      } as never);
      expect(saved.widgetTheme?.design).toEqual({
        font: { preset: 'custom', asset: { uuid: font, version: 2 }, baseSize: 16 },
        radius: 'lg',
        panel: { width: 360, height: 700 },
      });
    });

    it('refuses an asset of the wrong kind and keeps the stored design when the payload omits it', async () => {
      const icon = '9ff568e2-a4a0-4e98-83c0-6c3b3df60edd';
      const svc2 = withAssets({ [icon]: { uuid: icon, kind: 'icon', version: 1 } });
      await expect(
        svc2.updateWidgetTheme(1, 7, {
          brand: '#2B7FFF',
          design: { font: { preset: 'custom', asset_uuid: icon, base_size: 14 } },
        } as never),
      ).rejects.toMatchObject({ errorCode: 'E5003' });
      tenant.widgetTheme = { brand: '#2B7FFF', headerStyle: 'white', design: { radius: 'sm' } } as never;
      const saved = await svc2.updateWidgetTheme(1, 7, { brand: '#112233' } as never);
      expect(saved.widgetTheme?.design).toEqual({ radius: 'sm' });
    });
  });
  describe('custom css (PLN-260910 P5)', () => {
    const font = '94c2949c-3ce5-47be-acb3-3c4cfa7c58b3';
    const mk = (enabled: boolean) => {
      (tenant as any).customCssEnabled = enabled ? 1 : 0;
      return new TenantService(
        { findOne: jest.fn(async () => tenant), save: jest.fn(async (t: Tenant) => t) } as never,
        {} as never, {} as never,
        { count: jest.fn(async () => 1) } as never, { count: jest.fn(async () => 1) } as never, { count: jest.fn(async () => 1) } as never,
        {} as never, { write: auditWrite } as never, undefined as never,
        { get: jest.fn(async () => ({ uuid: font, kind: 'font', version: 1 })) } as never,
      );
    };
    it('sanitizes and stores custom css only while the add-on is on', async () => {
      const css = '.st-header { color: red } .st-send { display: none; color: blue }';
      const on = await mk(true).updateWidgetTheme(1, 7, { brand: '#2B7FFF', design: { custom_css: css } } as never);
      expect(on.widgetTheme?.design?.customCss).toBe('.st-header { color: red; }\n.st-send { color: blue; }');
      const off = await mk(false).updateWidgetTheme(1, 7, { brand: '#2B7FFF', design: { custom_css: css } } as never);
      expect(off.widgetTheme?.design ?? null).toBeNull();
    });
    it('admin switch flips the flag and audits', async () => {
      const svc2 = mk(false);
      const saved = await svc2.updateCustomCssEnabled(1, true, 99);
      expect(saved.customCssEnabled).toBe(1);
      expect(auditWrite).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'tenant.custom_css_changed', actorType: 'admin', target: 'tenant:1 on' }));
    });
  });
});
