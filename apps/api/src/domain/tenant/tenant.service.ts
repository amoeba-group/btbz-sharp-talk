import { randomUUID } from 'crypto';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Tenant, TenantWidgetCopy } from './entity/tenant.entity';
import { normalizeStorefrontUrl } from '../../global/util/storefront-url.util';
import {
  EXTERNAL_CHANNELS,
  normalizeWidgetTheme,
  NOTIFICATION_CATEGORY,
  WIDGET_TABS_DEFAULT,
  normalizeWidgetTabs,
} from '@sharptalk/types';

/** Real categories the policy may mention ('all' is a query filter, not a kind). */
const NOTIFICATION_CATEGORY_KEYS: string[] = Object.values(NOTIFICATION_CATEGORY).filter(
  (c) => c !== 'all',
);
import { IntegrationCredential } from './entity/integration-credential.entity';
import { User } from '../user/entity/user.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { UsageType } from '../knowledge/entity/usage-type.entity';
import { DEFAULT_USAGE_TYPES } from '../knowledge/usage-guide.types';
import { IntegrationStatusEntity } from '../integration/entity/integration-status.entity';
import { ContentFilterRule } from '../moderation/entity/content-filter-rule.entity';
import { DEFAULT_MODERATION_RULES } from '../moderation/moderation.defaults';

/** Job labels every new tenant starts with (matches the seed for tenant ivyusa). */
const DEFAULT_JOB_LABELS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'consult', name: '상담' },
  { code: 'accounting', name: '회계' },
  { code: 'operations', name: '운영' },
];
import { IntegrationService } from '../integration/integration.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  RESERVED_TENANT_SLUGS,
  TENANT_SLUG_PATTERN,
} from '../../global/constant/reserved-slug.constant';
import { decryptSecret, encryptSecret } from '../../global/util/crypto.util';
import {
  UpdatePrivacyNoticeRequest,
  UpdateStorefrontRequest,
  UpdateKnowledgeSettingsRequest,
  UpdateTenantCustomCssRequest,
  UpdateWidgetSettingsRequest,
  UpdateWidgetThemeRequest,
  UpdateShopifySettingsRequest,
} from './dto/request/tenant.request';
import { AuditService } from '../audit/audit.service';
import { TenantAssetService } from '../tenant-asset/tenant-asset.service';
import { WidgetLiveService } from './widget-live.service';
import { sanitizeWidgetCss } from '../../global/util/css-sanitizer.util';
import { LogoUpload, WidgetLogoService } from './widget-logo.service';
import { parseOrigin } from '../embed/embed-origin.util';
import { DEFAULT_BRAND } from '@sharptalk/types';
import { ShopifyTestResponse } from './dto/response/tenant.response';

/** provider/name key used for the Shopify credential and integration status. */
const SHOPIFY = 'shopify';
const SHOPIFY_API_VERSION = '2026-01';

/**
 * Tenant lifecycle + per-tenant integration credentials (FR-051/FR-060).
 * Secrets are stored AES-256-GCM encrypted and never returned to clients.
 */
@Injectable()
export class TenantService {
  // 4xx are not server-logged by default, so a rejected save would otherwise
  // leave no trace at all — "no error in the logs" must not read as "it saved".
  private readonly logger = new Logger(TenantService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ContentFilterRule)
    private readonly cfrRepo: Repository<ContentFilterRule>,
    @InjectRepository(JobLabel)
    private readonly jobLabelRepo: Repository<JobLabel>,
    // Repository only — seeding a starter taxonomy needs no KnowledgeModule
    // import, and importing it here would close a cycle.
    @InjectRepository(UsageType)
    private readonly usageTypeRepo: Repository<UsageType>,
    private readonly integrationService: IntegrationService,
    private readonly audit: AuditService,
    private readonly widgetLogo: WidgetLogoService,
    // Optional: unit specs build the service positionally without it (P2).
    @Optional() private readonly assets?: TenantAssetService,
    @Optional() private readonly live?: WidgetLiveService,
  ) {}

  async list(
    page: number,
    size: number,
    status?: string,
  ): Promise<{ items: Tenant[]; total: number }> {
    const where: FindOptionsWhere<Tenant> = {};
    if (status) where.status = status;
    const [items, total] = await this.tenantRepo.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { items, total };
  }

  /** users-per-tenant counts for the admin tenant list. */
  async countUsersByTenant(tenantIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (!tenantIds.length) return counts;
    // Raw rows come back as strings (bigint PK / COUNT) — normalize to numbers.
    const rows = await this.userRepo
      .createQueryBuilder('u')
      .select('u.tenant_id', 'tenantId')
      .addSelect('COUNT(*)', 'cnt')
      .where('u.tenant_id IN (:...ids)', { ids: tenantIds })
      .groupBy('u.tenant_id')
      .getRawMany<{ tenantId: string; cnt: string }>();
    for (const row of rows) counts.set(Number(row.tenantId), Number(row.cnt));
    return counts;
  }

  async findById(id: number): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return tenant;
  }

  /** Resolve a tenant by its Shopify shop domain (e.g. from a webhook header). */
  async findByShopDomain(shopDomain: string): Promise<Tenant | null> {
    return this.tenantRepo.findOne({ where: { shopDomain } });
  }

  /** Resolve a tenant by its URL slug (per-tenant login page). */
  async findBySlug(slug: string): Promise<Tenant | null> {
    return this.tenantRepo.findOne({ where: { slug } });
  }

  /** Resolve a tenant by its external UUID (admin API); 404 when unknown. */
  async getByUuid(uuid: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { uuid } });
    if (!tenant) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return tenant;
  }

  /** Tenant ids that have a stored Shopify credential (for scheduled sync). */
  async listShopifyTenantIds(): Promise<number[]> {
    const creds = await this.credRepo.find({ where: { provider: SHOPIFY } });
    return creds.map((c) => c.tenantId).filter((id): id is number => id != null);
  }

  async listCafe24TenantIds(): Promise<number[]> {
    const creds = await this.credRepo.find({ where: { provider: 'cafe24' } });
    return creds.map((c) => c.tenantId).filter((id): id is number => id != null);
  }

  async listOdooTenantIds(): Promise<number[]> {
    const creds = await this.credRepo.find({ where: { provider: 'odoo' } });
    return creds.map((c) => c.tenantId).filter((id): id is number => id != null);
  }

  async listHaravanTenantIds(): Promise<number[]> {
    const creds = await this.credRepo.find({ where: { provider: 'haravan' } });
    return creds.map((c) => c.tenantId).filter((id): id is number => id != null);
  }

  async listWoocommerceTenantIds(): Promise<number[]> {
    const creds = await this.credRepo.find({ where: { provider: 'woocommerce' } });
    return creds.map((c) => c.tenantId).filter((id): id is number => id != null);
  }

  async create(shopDomain: string, name: string, plan: string, slug?: string): Promise<Tenant> {
    const existing = await this.tenantRepo.findOne({ where: { shopDomain } });
    if (existing) {
      throw new BusinessException(ERROR_CODE.DUPLICATE_RESOURCE, HttpStatus.CONFLICT);
    }
    const tenant = this.tenantRepo.create({
      uuid: randomUUID(),
      shopDomain,
      slug: await this.resolveSlug(slug, name),
      name,
      plan,
      status: 'applied',
    });
    const saved = await this.tenantRepo.save(tenant);
    await this.seedDefaultModeration(saved.id);
    await this.seedDefaultJobLabels(saved.id);
    await this.seedDefaultUsageTypes(saved.id);
    return saved;
  }

  /**
   * Seed a new tenant's starter job labels (consult/accounting/operations), so the
   * user-edit label picker isn't empty on a fresh tenant. Idempotent — skips a tenant
   * that already has any (never clobbers renamed/deleted labels).
   */
  /**
   * Give a new tenant a neutral set of usage-guide types (PLN-260824 D4).
   *
   * What made this necessary: the previous default was ten K-beauty types
   * compiled into the code, so an apparel shop opened the screen to
   * "Press-on nails — 0 products" ten times over and had nowhere to put
   * laundry care. Measured on staging, that list matched 65% of one catalogue
   * and 0% of the other two.
   *
   * The replacements carry no keywords on purpose. A type that matches nothing
   * reads "0 products", which is the prompt to write terms that fit this
   * catalogue; inventing terms for a catalogue nobody has seen would produce
   * confident nonsense instead.
   *
   * Idempotent, like the other seeds — only runs when the tenant has none.
   */
  private async seedDefaultUsageTypes(tenantId: number): Promise<void> {
    const existing = await this.usageTypeRepo.count({ where: { tenantId } });
    if (existing > 0) return;
    let order = 10;
    const rows = DEFAULT_USAGE_TYPES.map((t) => {
      const row = this.usageTypeRepo.create({
        tenantId,
        key: t.key,
        label: t.label,
        keywords: null,
        sortOrder: order,
        active: 1,
      });
      order += 10;
      return row;
    });
    await this.usageTypeRepo.save(rows);
  }

  private async seedDefaultJobLabels(tenantId: number): Promise<void> {
    const existing = await this.jobLabelRepo.count({ where: { tenantId } });
    if (existing > 0) return;
    await this.jobLabelRepo.save(
      DEFAULT_JOB_LABELS.map((l) => this.jobLabelRepo.create({ tenantId, code: l.code, name: l.name })),
    );
  }

  /**
   * Seed a new tenant's starter moderation rules (issue-2 fix). Idempotent — only
   * runs when the tenant has none, so it never clobbers a tenant that deleted them
   * on purpose. Response-rule defaults come from AiConfigService.DEFAULT_RULES (a
   * read-time fallback), so only moderation — which is stored as rows — is seeded.
   */
  private async seedDefaultModeration(tenantId: number): Promise<void> {
    const existing = await this.cfrRepo.count({ where: { tenantId } });
    if (existing > 0) return;
    await this.cfrRepo.save(
      DEFAULT_MODERATION_RULES.map((r) =>
        this.cfrRepo.create({
          tenantId,
          scope: r.scope,
          type: r.type,
          patternOrPrompt: r.patternOrPrompt,
          lang: r.lang,
          severity: r.severity,
          action: r.action,
          isActive: 1,
        }),
      ),
    );
  }

  /** Find-or-create a tenant by shop domain (used by the Shopify OAuth callback). */
  async upsertByShopDomain(shopDomain: string, name?: string): Promise<Tenant> {
    const existing = await this.tenantRepo.findOne({ where: { shopDomain } });
    if (existing) return existing;
    // e.g. "acme.myshopify.com" -> slug base "acme"
    const slug = await this.generateUniqueSlug(name ?? shopDomain.split('.')[0]);
    const saved = await this.tenantRepo.save(
      this.tenantRepo.create({
        uuid: randomUUID(),
        shopDomain,
        slug,
        name: name ?? shopDomain,
        status: 'active',
      }),
    );
    await this.seedDefaultModeration(saved.id);
    await this.seedDefaultJobLabels(saved.id);
    await this.seedDefaultUsageTypes(saved.id);
    return saved;
  }

  /**
   * Validate a caller-chosen slug (pattern + reserved words + uniqueness), or
   * derive one from the tenant name when none was given.
   */
  private async resolveSlug(slug: string | undefined, name: string): Promise<string> {
    if (!slug) return this.generateUniqueSlug(name);
    if (!TENANT_SLUG_PATTERN.test(slug) || RESERVED_TENANT_SLUGS.includes(slug)) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    if (await this.findBySlug(slug)) {
      throw new BusinessException(ERROR_CODE.DUPLICATE_RESOURCE, HttpStatus.CONFLICT);
    }
    return slug;
  }

  /** Slugify a base string and suffix -2, -3, … until unique and not reserved. */
  private async generateUniqueSlug(base: string): Promise<string> {
    const cleaned =
      base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 56) || 'shop';
    let candidate = RESERVED_TENANT_SLUGS.includes(cleaned) ? `${cleaned}-shop` : cleaned;
    for (let n = 2; await this.findBySlug(candidate); n++) {
      candidate = `${cleaned}-${n}`;
    }
    return candidate;
  }

  /**
   * Update this tenant's privacy-notice settings (PLN-Privacy-Control-Gap
   * Stage 2). PATCH semantics: omitted fields keep their value, null clears
   * back to the platform default. Privileged + privacy-relevant → audited.
   */
  async updatePrivacyNotice(
    tenantId: number,
    actorId: number,
    dto: UpdatePrivacyNoticeRequest,
  ): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    if (dto.privacy_policy_url !== undefined) {
      tenant.privacyPolicyUrl = dto.privacy_policy_url?.trim() || null;
    }
    if (dto.consent_notice_version !== undefined) {
      tenant.consentNoticeVersion = dto.consent_notice_version?.trim() || null;
    }
    const saved = await this.tenantRepo.save(tenant);
    // Audit target: the new notice version, else the policy URL's host — never
    // the full URL (keeps audit rows short and query-string-free).
    const target =
      saved.consentNoticeVersion ?? this.safeUrlHost(saved.privacyPolicyUrl) ?? 'cleared';
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.privacy_notice_updated',
      target,
    });
    return saved;
  }

  /**
   * Update this tenant's widget behavior settings (PLN-Widget-Login-Redirect-
   * Orders). Changes how storefront sign-in opens for every shopper → audited.
   */
  /**
   * Store a new logo and point the theme at it (PLN-260819 S4).
   *
   * The previous file is removed only AFTER the row that references it is saved:
   * a crash between the two leaves an unreferenced file (swept with the tenant),
   * never a theme pointing at a file that is gone.
   */
  async setWidgetLogo(
    tenantId: number,
    actorId: number,
    file: LogoUpload,
  ): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    const logo = await this.widgetLogo.store(tenantId, file);
    const previous = tenant.widgetTheme?.logo ?? null;

    // A tenant may upload a logo before ever choosing a brand colour; keep the
    // built-in palette in that case rather than refusing the upload.
    const base = tenant.widgetTheme ?? { brand: DEFAULT_BRAND, headerStyle: 'white' };
    tenant.widgetTheme = normalizeWidgetTheme({ ...base, logo });
    const saved = await this.tenantRepo.save(tenant);
    await this.live?.publish(saved);
    await this.widgetLogo.remove(tenantId, previous);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.widget_logo_updated',
      target: `${logo.width}x${logo.height} ${logo.mime}`,
    });
    return saved;
  }

  /** Remove the logo; the widget header falls back to the display name. */
  async clearWidgetLogo(tenantId: number, actorId: number): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    const previous = tenant.widgetTheme?.logo ?? null;
    if (!previous) return tenant;
    tenant.widgetTheme = normalizeWidgetTheme({ ...tenant.widgetTheme, logo: null });
    const saved = await this.tenantRepo.save(tenant);
    await this.live?.publish(saved);
    await this.widgetLogo.remove(tenantId, previous);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.widget_logo_removed',
      target: previous.id,
    });
    return saved;
  }

  async updateWidgetSettings(
    tenantId: number,
    actorId: number,
    dto: UpdateWidgetSettingsRequest,
  ): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    tenant.widgetLoginMode = dto.login_mode;
    if (dto.tabs !== undefined) {
      // Normalize rather than trust: the array arrives in whatever order the
      // console's checkboxes were ticked, and a tab bar with nothing in it
      // cannot be navigated at all — so an empty result is a 400, never a save.
      const tabs = normalizeWidgetTabs(dto.tabs);
      if (!tabs) {
        this.logger.warn(`widget tab update rejected: no valid tabs (tenant ${tenantId})`);
        throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
      }
      tenant.widgetTabs = tabs;
    }
    if (dto.tab_position !== undefined) tenant.widgetTabPosition = dto.tab_position;
    if (dto.timezone !== undefined) tenant.timezone = dto.timezone?.trim() || null;
    if (dto.default_language !== undefined) tenant.defaultLanguage = dto.default_language?.trim().toLowerCase() || null;
    tenant.widgetCopy = mergeWidgetCopy(tenant.widgetCopy, dto);
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.widget_settings_updated',
      target: [
        saved.widgetLoginMode,
        `tabs:${(saved.widgetTabs ?? WIDGET_TABS_DEFAULT).join('+')}@${saved.widgetTabPosition}`,
        saved.timezone,
        saved.defaultLanguage ? `lang:${saved.defaultLanguage}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
    return saved;
  }

  /**
   * Update which external channels this shop may use per category.
   *
   * A ceiling on delivery, not a customer preference — so it is audited like
   * any other setting that changes what shoppers receive.
   */
  async updateNotificationChannels(
    tenantId: number,
    actorId: number,
    channels: Record<string, string[]>,
  ): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    // Keep only known categories/channels: this lands in a JSON column that the
    // delivery path reads on every send, and an unknown key there is dead weight
    // that outlives whoever typed it.
    const clean: Record<string, string[]> = {};
    for (const [category, list] of Object.entries(channels ?? {})) {
      if (!NOTIFICATION_CATEGORY_KEYS.includes(category)) continue;
      clean[category] = (Array.isArray(list) ? list : []).filter((c) =>
        EXTERNAL_CHANNELS.includes(c),
      );
    }
    tenant.notificationChannels = clean;
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.notification_channels_updated',
      target: Object.entries(clean)
        .map(([cat, list]) => `${cat}:${list.join('+') || 'none'}`)
        .join(' · '),
    });
    return saved;
  }

  /**
   * Set the widget brand theme. Stores the brand colour only — the ramp and the
   * readable foregrounds are derived on read, so the stored value cannot drift
   * out of step with what shoppers actually see.
   */
  /**
   * Replace the embed allowlist (PLN-260819 S1).
   *
   * An EMPTY list is stored as NULL, not as `[]`: "I removed my last entry" and
   * "I never configured this" must land on the same behaviour, which is the
   * tenant's own storefront. Storing `[]` would mean "allow nothing" and take
   * the widget offline the moment someone tidies the list.
   */
  async updateEmbedOrigins(
    tenantId: number,
    actorId: number,
    origins: string[],
  ): Promise<Tenant> {
    const cleaned: string[] = [];
    for (const raw of origins) {
      const parsed = parseOrigin(raw);
      if (!parsed) {
        this.logger.warn(`embed origin rejected: unusable value (tenant ${tenantId})`);
        throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
      }
      // Keep the operator's wildcard, but normalise scheme/host/port around it.
      const host = raw.trim().replace(/^[a-z]+:\/\//i, '').split('/')[0].toLowerCase();
      const value = host.startsWith('*.')
        ? `${parsed.scheme}://${host}`
        : `${parsed.scheme}://${parsed.host}${parsed.port ? `:${parsed.port}` : ''}`;
      if (!cleaned.includes(value)) cleaned.push(value);
    }

    const tenant = await this.findById(tenantId);
    tenant.embedOrigins = cleaned.length ? cleaned : null;
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.embed_origins_updated',
      target: cleaned.length ? cleaned.join(', ') : '(default: storefront only)',
    });
    return saved;
  }

  /** Secret rotation is a privileged action; the value itself is never logged. */
  async auditEmbedSecretRotated(tenantId: number, actorId: number): Promise<void> {
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.embed_secret_rotated',
      target: 'embed signing secret',
    });
  }

  async updateWidgetTheme(
    tenantId: number,
    actorId: number,
    dto: UpdateWidgetThemeRequest,
  ): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    // The logo is uploaded through its own route, so this payload does not carry
    // it. Carrying the stored value forward is what stops "change the brand
    // colour" from silently deleting the tenant's logo — the neighbouring-field
    // wipe this repo has been bitten by before (PLN-260818 lesson).
    // Design profile (P2): absent = keep, null = clear. Asset references are
    // resolved against the tenant's own files so a uuid from another tenant (or
    // a deleted one) cannot become a broken font or icon on the storefront.
    const design =
      dto.design === undefined
        ? tenant.widgetTheme?.design ?? null
        : dto.design === null
          ? null
          : await this.resolveDesign(tenantId, dto.design);
    const theme = normalizeWidgetTheme({
      brand: dto.brand,
      // Every optional field carries the stored value forward. header_style is
      // @IsOptional() too, so a client sending only `brand` would otherwise
      // reset a brand-filled header to white — the same neighbouring-field wipe,
      // one field over.
      headerStyle: dto.header_style ?? tenant.widgetTheme?.headerStyle,
      logo: tenant.widgetTheme?.logo ?? null,
      launcher: dto.launcher ?? tenant.widgetTheme?.launcher ?? null,
      design,
    });
    if (!theme) {
      this.logger.warn(`widget theme rejected: unusable brand colour (tenant ${tenantId})`);
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    tenant.widgetTheme = theme;
    const saved = await this.tenantRepo.save(tenant);
    await this.live?.publish(saved);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.widget_theme_updated',
      target: `${theme.brand} · header:${theme.headerStyle}`,
    });
    return saved;
  }

  /**
   * Set the customer-facing storefront origin. This decides which product URLs
   * are allowed to become clickable links in shoppers' conversations, so a
   * change is audited like any other trust boundary.
   *
   * Rejects anything that is not an http(s) origin rather than storing it and
   * silently matching nothing later.
   */
  async updateStorefront(
    tenantId: number,
    actorId: number,
    dto: UpdateStorefrontRequest,
  ): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    const raw = dto.storefront_url?.trim();
    if (raw) {
      const normalized = normalizeStorefrontUrl(raw);
      if (!normalized) {
        throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
      }
      tenant.storefrontUrl = normalized;
    } else {
      tenant.storefrontUrl = null;
    }
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.storefront_updated',
      target: saved.storefrontUrl ?? 'cleared',
    });
    return saved;
  }

  /**
   * Knowledge-page options (PLN-260910 D-2). The switch only decides whether the
   * usage-guides section renders; guide documents and their citations are not
   * touched, so turning it off is reversible and audited like any setting.
   */
  async updateKnowledgeSettings(
    tenantId: number,
    actorId: number,
    dto: UpdateKnowledgeSettingsRequest,
  ): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    tenant.usageGuidesEnabled = dto.usage_guides_enabled ? 1 : 0;
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.knowledge_settings_updated',
      target: `usage_guides:${dto.usage_guides_enabled ? 'on' : 'off'}`,
    });
    return saved;
  }

  /** Snake-case design payload → theme JSON, with asset uuids verified (kind + tenant). */
  async resolveDesign(
    tenantId: number,
    d: NonNullable<UpdateWidgetThemeRequest['design']>,
  ): Promise<Record<string, unknown>> {
    const ref = async (uuid: string | null | undefined, kind: string) => {
      if (!uuid) return null;
      if (!this.assets) {
        throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
      }
      const row = await this.assets.get(tenantId, uuid); // 404 when not this tenant's
      if (row.kind !== kind) {
        this.logger.warn(`widget design rejected: asset ${uuid} is ${row.kind}, expected ${kind} (tenant ${tenantId})`);
        throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
      }
      return { uuid: row.uuid, version: row.version };
    };
    // Custom CSS (P5): allowlist-sanitized here, and only kept while the
    // platform add-on is on — a tenant cannot store what it may not deliver.
    let customCss: string | null = null;
    if (typeof d.custom_css === 'string' && d.custom_css.trim()) {
      const tenant = await this.findById(tenantId);
      if (Number(tenant.customCssEnabled) === 1) {
        const { css, dropped } = sanitizeWidgetCss(d.custom_css);
        if (dropped.length) this.logger.warn(`custom css: ${dropped.length} item(s) dropped (tenant ${tenantId})`);
        customCss = css || null;
      } else {
        this.logger.warn(`custom css ignored: add-on off (tenant ${tenantId})`);
      }
    }
    return {
      font: d.font
        ? {
            preset: d.font.preset,
            asset: d.font.preset === 'custom' ? await ref(d.font.asset_uuid, 'font') : null,
            baseSize: d.font.base_size,
          }
        : null,
      radius: d.radius ?? null,
      panel: d.panel ?? null,
      launcherIcon: await ref(d.launcher_icon_uuid, 'icon'),
      quickReplyStyle: d.quick_reply_style === 'card' ? 'card' : null,
      customCss,
    };
  }

  /** What a design save would keep of this CSS — for the console to show before saving (P5). */
  sanitizeCustomCss(input: string): { css: string; dropped: string[] } {
    return sanitizeWidgetCss(input);
  }

  /** Platform add-on switch (P5). Turning it off stops delivery immediately (stripped at read). */
  async updateCustomCssEnabled(id: number, enabled: boolean, actorId: number): Promise<Tenant> {
    const tenant = await this.findById(id);
    tenant.customCssEnabled = enabled ? 1 : 0;
    const saved = await this.tenantRepo.save(tenant);
    await this.live?.publish(saved);
    await this.audit.write({
      tenantId: id,
      actorType: 'admin',
      actorId,
      action: 'tenant.custom_css_changed',
      target: `tenant:${id} ${enabled ? 'on' : 'off'}`,
    });
    return saved;
  }

  private safeUrlHost(url: string | null): string | null {
    if (!url) return null;
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  }

  async updateStatus(id: number, status: string): Promise<Tenant> {
    const tenant = await this.findById(id);
    tenant.status = status;
    return this.tenantRepo.save(tenant);
  }

  /**
   * Plan change (REQ-260825). Menu presets are computed from `plan` on every
   * read (resolveProvidedMenus), so saving the column IS the rollout — the
   * per-menu overrides a tenant already has stay pinned on top of it.
   */
  async updatePlan(id: number, plan: string, actorId: number): Promise<Tenant> {
    const tenant = await this.findById(id);
    const from = tenant.plan;
    tenant.plan = plan;
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.write({
      tenantId: id,
      actorType: 'admin',
      actorId,
      action: 'tenant.plan_changed',
      target: `tenant:${id} ${from ?? '-'} -> ${plan}`,
    });
    return saved;
  }

  /**
   * Issue-workflow add-on entitlement (REQ-260825). This is the gate the
   * /issues board judges server-side — menu provisioning only affects the
   * sidebar. Mode is a gate, not data: existing tickets survive any switch.
   */
  async updateWorkflowMode(id: number, mode: string, actorId: number): Promise<Tenant> {
    const tenant = await this.findById(id);
    const from = tenant.workflowMode;
    tenant.workflowMode = mode;
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.write({
      tenantId: id,
      actorType: 'admin',
      actorId,
      action: 'tenant.workflow_mode_changed',
      target: `tenant:${id} ${from} -> ${mode}`,
    });
    return saved;
  }

  async listCredentials(tenantId: number): Promise<IntegrationCredential[]> {
    return this.credRepo.find({ where: { tenantId }, order: { provider: 'ASC' } });
  }

  async upsertCredential(
    tenantId: number,
    provider: string,
    secret: string,
  ): Promise<IntegrationCredential> {
    const secretEnc = encryptSecret(secret);
    let cred = await this.credRepo.findOne({ where: { tenantId, provider } });
    // Credential set/rotate is a privileged action (PRV-H4); the secret itself
    // never reaches the audit row — only which provider changed.
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: 0,
      action: cred ? 'tenant.credential_rotated' : 'tenant.credential_created',
      target: provider,
    });
    // Saving is not a verified connection (FIX-260827) — a test sets 'connected'.
    if (cred) {
      cred.secretEnc = secretEnc;
      cred.status = 'unknown';
      cred.detail = null;
      cred.lastTestedAt = null;
    } else {
      cred = this.credRepo.create({ tenantId, provider, secretEnc, status: 'unknown' });
    }
    return this.credRepo.save(cred);
  }

  // ---- Shopify connection settings (self-service, per tenant) ----

  /** Current tenant + Shopify credential/status for the settings view. */
  async getShopifyView(tenantId: number): Promise<{
    tenant: Tenant;
    cred: IntegrationCredential | null;
    status: IntegrationStatusEntity | null;
  }> {
    const tenant = await this.findById(tenantId);
    const cred = await this.credRepo.findOne({ where: { tenantId, provider: SHOPIFY } });
    const status = await this.integrationService.findByName(SHOPIFY);
    return { tenant, cred: cred ?? null, status: status ?? null };
  }

  /**
   * Save the shop domain (+ optional name) and, if credential fields are given,
   * pack them into the encrypted `shopify` credential. Empty credential fields
   * leave the stored secret untouched.
   */
  async saveShopify(
    tenantId: number,
    dto: UpdateShopifySettingsRequest,
  ): Promise<{
    tenant: Tenant;
    cred: IntegrationCredential | null;
    status: IntegrationStatusEntity | null;
  }> {
    const tenant = await this.findById(tenantId);
    const shopDomain = dto.shop_domain.trim();
    if (shopDomain !== tenant.shopDomain) {
      const dup = await this.tenantRepo.findOne({ where: { shopDomain } });
      if (dup && dup.id !== tenant.id) {
        throw new BusinessException(ERROR_CODE.DUPLICATE_RESOURCE, HttpStatus.CONFLICT);
      }
      tenant.shopDomain = shopDomain;
    }
    if (dto.name !== undefined) tenant.name = dto.name.trim() || null;
    await this.tenantRepo.save(tenant);

    if (dto.access_token && dto.access_token.trim()) {
      const secret = JSON.stringify({
        accessToken: dto.access_token.trim(),
        ...(dto.api_key?.trim() ? { apiKey: dto.api_key.trim() } : {}),
        ...(dto.api_secret?.trim() ? { apiSecret: dto.api_secret.trim() } : {}),
      });
      await this.upsertCredential(tenantId, SHOPIFY, secret);
    }
    return this.getShopifyView(tenantId);
  }

  /**
   * Resolve the shop domain + decrypted Admin API token for a tenant, or null if
   * either is missing. Shared by the connectivity test and the order/customer sync.
   * Expiring OAuth tokens (accessToken + refreshToken + expiresAt) are refreshed
   * transparently here; manual custom-app tokens (no refreshToken) pass through.
   */
  async getShopifyConnection(
    tenantId: number,
  ): Promise<{ shopDomain: string; token: string } | null> {
    const tenant = await this.findById(tenantId);
    const shopDomain = tenant.shopDomain?.trim();
    const cred = await this.credRepo.findOne({ where: { tenantId, provider: SHOPIFY } });
    if (!shopDomain || !cred?.secretEnc) return null;
    const parsed = this.parseShopifyCredential(decryptSecret(cred.secretEnc));
    if (!parsed) return null;
    let token = parsed.accessToken;
    if (parsed.refreshToken && (!parsed.expiresAt || parsed.expiresAt - Date.now() < 120_000)) {
      const refreshed = await this.refreshShopifyToken(tenantId, shopDomain, parsed, cred);
      if (!refreshed) return null;
      token = refreshed;
    }
    // Shopify tokens are printable ASCII. Reject anything else (e.g. a masked/
    // placeholder value) so it never reaches an HTTP header — which would throw a
    // ByteString error on fetch instead of a clean "invalid token" result.
    if (!token || !/^[\x21-\x7e]+$/.test(token)) return null;
    return { shopDomain, token };
  }

  /**
   * Rotate an expiring offline token via grant_type=refresh_token. Single-flight
   * per tenant — Shopify rotates the refresh token on every use, so a concurrent
   * second refresh with the old refresh token would be rejected.
   */
  private readonly refreshInFlight = new Map<number, Promise<string | null>>();

  private refreshShopifyToken(
    tenantId: number,
    shopDomain: string,
    parsed: { accessToken: string; refreshToken?: string },
    cred: IntegrationCredential,
  ): Promise<string | null> {
    const existing = this.refreshInFlight.get(tenantId);
    if (existing) return existing;
    const run = (async (): Promise<string | null> => {
      const clientId = process.env.SHOPIFY_API_KEY ?? '';
      const clientSecret = process.env.SHOPIFY_API_SECRET ?? '';
      if (!clientId || !clientSecret || !parsed.refreshToken) return null;
      try {
        const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: parsed.refreshToken,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          access_token?: string;
          expires_in?: number | string;
          refresh_token?: string;
          refresh_token_expires_in?: number | string;
        };
        if (!data.access_token) return null;
        const now = Date.now();
        const rotated = {
          accessToken: data.access_token,
          ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
          ...(data.expires_in ? { expiresAt: now + Number(data.expires_in) * 1000 } : {}),
          ...(data.refresh_token_expires_in
            ? { refreshTokenExpiresAt: now + Number(data.refresh_token_expires_in) * 1000 }
            : {}),
        };
        // Automatic rotation — persist quietly (no audit row; upsertCredential's
        // audit trail is reserved for operator-initiated set/rotate actions).
        cred.secretEnc = encryptSecret(JSON.stringify(rotated));
        await this.credRepo.save(cred);
        return rotated.accessToken;
      } catch {
        return null;
      }
    })();
    this.refreshInFlight.set(tenantId, run);
    void run.finally(() => this.refreshInFlight.delete(tenantId));
    return run;
  }

  /** Parse a stored Shopify credential (JSON blob or raw token string). */
  private parseShopifyCredential(secret: string): {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  } | null {
    try {
      const parsed = JSON.parse(secret) as {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
      };
      if (parsed && typeof parsed === 'object') {
        return parsed.accessToken
          ? {
              accessToken: parsed.accessToken,
              refreshToken: parsed.refreshToken,
              expiresAt: parsed.expiresAt,
            }
          : null;
      }
    } catch {
      /* not JSON — treat the whole value as the raw token */
    }
    return secret ? { accessToken: secret } : null;
  }

  /**
   * Live connectivity test: pings the Shopify Admin API with the stored token and
   * records the result in integration_status. Fail-safe: any error → 'error'.
   */
  async testShopify(tenantId: number): Promise<ShopifyTestResponse> {
    const conn = await this.getShopifyConnection(tenantId);
    if (!conn) {
      return this.recordShopifyTest(
        false,
        'Shopify shop domain or a valid access token is missing — reconnect the store',
      );
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      // GraphQL — new Dev Dashboard apps are REST-restricted on many endpoints.
      const res = await fetch(
        `https://${conn.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': conn.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ shop { name } }' }),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);
      if (!res.ok) {
        return this.recordShopifyTest(false, `Admin API returned ${res.status}`);
      }
      const data = (await res.json()) as {
        data?: { shop?: { name?: string } };
        errors?: Array<{ message?: string }>;
      };
      if (data.errors?.length) {
        return this.recordShopifyTest(false, `Admin API error: ${data.errors[0]?.message ?? ''}`);
      }
      const name = data.data?.shop?.name;
      return this.recordShopifyTest(true, name ? `Connected: ${name}` : 'Connected');
    } catch (e) {
      return this.recordShopifyTest(false, `Connection failed: ${(e as Error).message}`);
    }
  }

  private async recordShopifyTest(ok: boolean, detail: string): Promise<ShopifyTestResponse> {
    await this.integrationService.upsert(SHOPIFY, ok ? 'connected' : 'error', detail.slice(0, 255));
    return { ok, detail };
  }

}

/**
 * Fold the flat per-language DTO fields into the widget_copy JSON blob.
 * PATCH semantics per field: undefined keeps the stored value, ''/null clears it
 * (falling back to the widget default). Returns null when nothing remains set.
 */
function mergeWidgetCopy(
  current: TenantWidgetCopy | null,
  dto: UpdateWidgetSettingsRequest,
): TenantWidgetCopy | null {
  const copy: TenantWidgetCopy = {
    displayName: current?.displayName ?? null,
    firstVisit: { ...(current?.firstVisit ?? {}) },
    loginGreeting: { ...(current?.loginGreeting ?? {}) },
  };
  if (dto.display_name !== undefined) copy.displayName = dto.display_name?.trim() || null;
  const setLang = (bag: Record<string, string>, lang: string, v: string | null | undefined) => {
    if (v === undefined) return;
    const trimmed = v?.trim();
    if (trimmed) bag[lang] = trimmed;
    else delete bag[lang];
  };
  // Listed field by field rather than looped over the language registry: a
  // dynamic `dto['first_visit_' + code]` lookup would compile even when the DTO
  // field for a newly registered language is missing, and the tenant's copy for
  // that language would silently never save.
  setLang(copy.firstVisit!, 'EN', dto.first_visit_en);
  setLang(copy.firstVisit!, 'ES', dto.first_visit_es);
  setLang(copy.firstVisit!, 'KO', dto.first_visit_ko);
  setLang(copy.firstVisit!, 'VI', dto.first_visit_vi);
  setLang(copy.firstVisit!, 'JA', dto.first_visit_ja);
  setLang(copy.firstVisit!, 'ZH', dto.first_visit_zh);
  setLang(copy.loginGreeting!, 'EN', dto.login_greeting_en);
  setLang(copy.loginGreeting!, 'ES', dto.login_greeting_es);
  setLang(copy.loginGreeting!, 'KO', dto.login_greeting_ko);
  setLang(copy.loginGreeting!, 'VI', dto.login_greeting_vi);
  setLang(copy.loginGreeting!, 'JA', dto.login_greeting_ja);
  setLang(copy.loginGreeting!, 'ZH', dto.login_greeting_zh);
  const empty =
    !copy.displayName &&
    Object.keys(copy.firstVisit!).length === 0 &&
    Object.keys(copy.loginGreeting!).length === 0;
  return empty ? null : copy;
}
