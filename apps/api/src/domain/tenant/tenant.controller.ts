import {
  Body,
  Controller,
  Logger,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HttpStatus } from '@nestjs/common';
import { CAPABILITY, Principal, USER_RANK } from '@sharptalk/types';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { TenantService } from './tenant.service';
import { EcommerceIntegrationService } from './ecommerce-integration.service';
import { TenantMapper } from './tenant.mapper';
import { EmbedService } from '../embed/embed.service';
import { TenantAssetService } from '../tenant-asset/tenant-asset.service';
import { LogoUpload } from './widget-logo.service';

/** Multer's own ceiling; the service enforces the real 1MB policy with a reason. */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
import {
  CreateTenantRequest,
  ListTenantsQuery,
  UpdateIntegrationRequest,
  UpdatePrivacyNoticeRequest,
  UpdateShopifySettingsRequest,
  UpdateStorefrontRequest,
  UpdateKnowledgeSettingsRequest,
  UpdateTenantCustomCssRequest,
  UpdateNotificationChannelsRequest,
  UpdateWidgetAccessRequest,
  UpdateWidgetThemeRequest,
  UpdateEmbedOriginsRequest,
  UpdateWidgetSettingsRequest,
  UpdateTenantStatusRequest,
  UpsertCredentialRequest,
  UpdateTenantPlanRequest,
  UpdateTenantWorkflowModeRequest,
} from './dto/request/tenant.request';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { AdminOnly, Auth, RequireCapability, RequireMenu, RequireRank } from '../../global/decorator/auth.decorator';
import { Public } from '../../global/decorator/public.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

@ApiTags('Tenant')
@Controller('tenants')
export class TenantController {
  private readonly logger = new Logger(TenantController.name);

  constructor(
    private readonly tenantService: TenantService,
    private readonly ecommerceIntegrationService: EcommerceIntegrationService,
    private readonly embedService: EmbedService,
    private readonly assets: TenantAssetService,
  ) {}

  @Get()
  @AdminOnly()
  @ApiOperation({ summary: 'List tenants (paginated)' })
  async list(@Query() query: ListTenantsQuery) {
    const { page, size } = normalizePage(query.page, query.size);
    const { items, total } = await this.tenantService.list(page, size, query.status);
    const ids = items.map((t) => Number(t.id));
    const [counts, usage] = await Promise.all([
      this.tenantService.countUsersByTenant(ids),
      this.assets.usageByTenant(ids),
    ]);
    return new Paginated(TenantMapper.toTenantList(items, counts, usage), buildPagination(page, size, total));
  }

  @Get('by-slug/:slug')
  @Public()
  @ApiOperation({ summary: 'Resolve a tenant login page by slug (display-safe fields only)' })
  async getBySlug(@Param('slug') slug: string) {
    const tenant = await this.tenantService.findBySlug(slug);
    if (!tenant) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return TenantMapper.toPublicTenant(tenant);
  }

  // NOTE: declared before ':uuid' so 'privacy-notice' is not captured as a UUID.
  @Get('privacy-notice')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Get this tenant privacy-notice settings (PLN-Privacy-Control-Gap Stage 2)' })
  async getPrivacyNotice(@CurrentUser() user: Principal) {
    const tenant = await this.tenantService.findById(this.tenantId(user));
    return TenantMapper.toPrivacyNotice(tenant);
  }

  @Patch('privacy-notice')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Update this tenant privacy-policy URL / consent-notice version' })
  async updatePrivacyNotice(
    @CurrentUser() user: Principal,
    @Body() body: UpdatePrivacyNoticeRequest,
  ) {
    // @RequireRank guarantees a tenant user at runtime; narrow for TS.
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const tenant = await this.tenantService.updatePrivacyNotice(user.tenantId, user.userId, body);
    return TenantMapper.toPrivacyNotice(tenant);
  }

  // NOTE: declared before ':uuid' so 'widget-settings' is not captured as a UUID.
  @Get('widget-settings')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Get this tenant widget behavior settings (sign-in mode)' })
  async getWidgetSettings(@CurrentUser() user: Principal) {
    const tenant = await this.tenantService.findById(this.tenantId(user));
    return TenantMapper.toWidgetSettings(tenant);
  }

  // Declared before ':uuid' so 'storefront' is not captured as a UUID.
  @Get('storefront')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Get the customer-facing storefront origin' })
  async getStorefront(@CurrentUser() user: Principal) {
    return TenantMapper.toStorefront(await this.tenantService.findById(this.tenantId(user)));
  }

  @Patch('storefront')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Set the customer-facing storefront origin (enables product links)' })
  async updateStorefront(@CurrentUser() user: Principal, @Body() body: UpdateStorefrontRequest) {
    // @RequireRank guarantees a tenant user at runtime; narrow for TS.
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const tenant = await this.tenantService.updateStorefront(user.tenantId, user.userId, body);
    return TenantMapper.toStorefront(tenant);
  }

  // Declared before ':uuid'. Dry-run of the CSS sanitizer so the console can show
  // what a save will keep and why the rest is dropped (P5) — no state change.
  @Post('widget-theme/sanitize-css')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Sanitize custom widget CSS without saving (returns kept css + dropped reasons)' })
  sanitizeCss(@Body() body: { css?: string }) {
    return this.tenantService.sanitizeCustomCss(String(body?.css ?? '').slice(0, 64 * 1024));
  }

  // Declared before ':uuid' so 'knowledge-settings' is not captured as a UUID.
  // GET is menu-gated, not rank-gated: every knowledge-page visitor (staff too)
  // needs the switch to render the page; only master/director may flip it.
  @Get('knowledge-settings')
  @RequireMenu('knowledge')
  @ApiOperation({ summary: 'Knowledge-page options (usage-guides section switch)' })
  async getKnowledgeSettings(@CurrentUser() user: Principal) {
    return TenantMapper.toKnowledgeSettings(await this.tenantService.findById(this.tenantId(user)));
  }

  @Patch('knowledge-settings')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Set knowledge-page options (usage-guides section switch)' })
  async updateKnowledgeSettings(
    @CurrentUser() user: Principal,
    @Body() body: UpdateKnowledgeSettingsRequest,
  ) {
    // @RequireRank guarantees a tenant user at runtime; narrow for TS.
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const tenant = await this.tenantService.updateKnowledgeSettings(user.tenantId, user.userId, body);
    return TenantMapper.toKnowledgeSettings(tenant);
  }

  // Declared before ':uuid' so 'notification-channels' is not read as a UUID.
  @Get('notification-channels')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Which channels this shop may use per notification category' })
  async getNotificationChannels(@CurrentUser() user: Principal) {
    const tenant = await this.tenantService.findById(this.tenantId(user));
    return TenantMapper.toNotificationChannels(tenant);
  }

  @Patch('notification-channels')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Set the per-category channel policy (a ceiling on delivery)' })
  async updateNotificationChannels(
    @CurrentUser() user: Principal,
    @Body() body: UpdateNotificationChannelsRequest,
  ) {
    // @RequireRank guarantees a tenant user at runtime; narrow for TS.
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const tenant = await this.tenantService.updateNotificationChannels(
      user.tenantId,
      user.userId,
      body.channels,
    );
    return TenantMapper.toNotificationChannels(tenant);
  }

  // Declared before ':uuid' so 'widget-theme' is not read as a UUID.
  @Get('widget-theme')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: "This tenant's widget brand theme" })
  async getWidgetTheme(@CurrentUser() user: Principal) {
    const tenant = await this.tenantService.findById(this.tenantId(user));
    return TenantMapper.toWidgetTheme(tenant);
  }

  @Patch('widget-theme')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Set the widget brand colour (ramp + foregrounds are derived)' })
  async updateWidgetTheme(
    @CurrentUser() user: Principal,
    @Body() body: UpdateWidgetThemeRequest,
  ) {
    // @RequireRank guarantees a tenant user at runtime; narrow for TS.
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const tenant = await this.tenantService.updateWidgetTheme(user.tenantId, user.userId, body);
    return TenantMapper.toWidgetTheme(tenant);
  }

  /**
   * Widget exposure restriction (PLN-260929). Declared before ':uuid' for the
   * same reason the theme routes are — otherwise the path reads as a UUID.
   */
  @Get('widget-access')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: "This tenant's widget exposure restriction" })
  async getWidgetAccess(@CurrentUser() user: Principal) {
    const tenant = await this.tenantService.findById(this.tenantId(user));
    return TenantMapper.toWidgetAccess(tenant);
  }

  @Patch('widget-access')
  @RequireRank(USER_RANK.MASTER)
  @ApiOperation({ summary: 'Replace the widget exposure restriction (sent whole)' })
  async updateWidgetAccess(
    @CurrentUser() user: Principal,
    @Body() body: UpdateWidgetAccessRequest,
  ) {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const tenant = await this.tenantService.updateWidgetAccess(user.tenantId, user.userId, body);
    return TenantMapper.toWidgetAccess(tenant);
  }

  @Post('widget-access/key')
  @RequireRank(USER_RANK.MASTER)
  @ApiOperation({ summary: 'Generate (or replace) the tester invite key' })
  async rotateWidgetAccessKey(@CurrentUser() user: Principal) {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    // Rotating invalidates every invite link already handed out — the console
    // confirms before calling, the same stance as the embed secret.
    const key = await this.tenantService.rotateWidgetAccessKey(user.tenantId, user.userId);
    return { key };
  }

  @Get('embed-settings')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Embed allowlist + whether a signing secret exists' })
  async getEmbedSettings(@CurrentUser() user: Principal) {
    const tenant = await this.tenantService.findById(this.tenantId(user));
    return TenantMapper.toEmbedSettings(tenant);
  }

  @Patch('embed-origins')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Replace the domains allowed to embed this widget' })
  async updateEmbedOrigins(
    @CurrentUser() user: Principal,
    @Body() body: UpdateEmbedOriginsRequest,
  ) {
    // @RequireRank guarantees a tenant user at runtime; narrow for TS.
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const tenant = await this.tenantService.updateEmbedOrigins(
      user.tenantId,
      user.userId,
      body.origins,
    );
    return TenantMapper.toEmbedSettings(tenant);
  }

  /**
   * Issue a new signing secret. The plaintext is in THIS response and nowhere
   * else — it is stored encrypted and never read back out, so a console that
   * loses it has to rotate again. Rotating invalidates every signature the
   * customer's server is currently producing, which is why the UI confirms.
   */
  @Post('embed-secret/rotate')
  @RequireRank(USER_RANK.MASTER)
  @ApiOperation({ summary: 'Generate (or replace) the identify() signing secret' })
  async rotateEmbedSecret(@CurrentUser() user: Principal) {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const secret = await this.embedService.rotateSecret(user.tenantId);
    // The secret is already rotated by this point and this response is the only
    // place it exists in plaintext. A failing audit write must not turn that into
    // a 500 the operator reads as "nothing happened" — they would be locked out
    // of a secret that is already live.
    await this.tenantService
      .auditEmbedSecretRotated(user.tenantId, user.userId)
      .catch(() => undefined);
    return { secret };
  }

  @Post('widget-theme/logo')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Upload the widget header logo' })
  async uploadWidgetLogo(@CurrentUser() user: Principal, @UploadedFile() file?: LogoUpload) {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    if (!file) {
      // 4xx are not server-logged by default, so a rejected upload would leave
      // no trace at all for whoever is asked why it "did nothing".
      this.logger.warn(`widget logo upload rejected: no file (tenant ${user.tenantId})`);
      throw new BusinessException(ERROR_CODE.WIDGET_LOGO_REJECTED, HttpStatus.BAD_REQUEST);
    }
    const tenant = await this.tenantService.setWidgetLogo(user.tenantId, user.userId, file);
    return TenantMapper.toWidgetTheme(tenant);
  }

  @Delete('widget-theme/logo')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Remove the widget header logo' })
  async deleteWidgetLogo(@CurrentUser() user: Principal) {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const tenant = await this.tenantService.clearWidgetLogo(user.tenantId, user.userId);
    return TenantMapper.toWidgetTheme(tenant);
  }

  @Patch('widget-settings')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Update this tenant widget sign-in mode (redirect/popup)' })
  async updateWidgetSettings(
    @CurrentUser() user: Principal,
    @Body() body: UpdateWidgetSettingsRequest,
  ) {
    // @RequireRank guarantees a tenant user at runtime; narrow for TS.
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const tenant = await this.tenantService.updateWidgetSettings(user.tenantId, user.userId, body);
    return TenantMapper.toWidgetSettings(tenant);
  }

  @Get(':uuid')
  @AdminOnly()
  @ApiOperation({ summary: 'Get a tenant by UUID' })
  async get(@Param('uuid') uuid: string) {
    const tenant = await this.tenantService.getByUuid(uuid);
    return TenantMapper.toTenant(tenant);
  }

  @Post()
  @RequireCapability(CAPABILITY.TENANT_APPROVE)
  @ApiOperation({ summary: 'Create (approve) a tenant' })
  async create(@Body() body: CreateTenantRequest) {
    const tenant = await this.tenantService.create(body.shop_domain, body.name, body.plan, body.slug);
    return TenantMapper.toTenant(tenant);
  }

  @Patch(':uuid/status')
  @AdminOnly()
  @ApiOperation({ summary: 'Update tenant status (applied/active/suspended)' })
  async updateStatus(
    @Param('uuid') uuid: string,
    @Body() body: UpdateTenantStatusRequest,
  ) {
    const target = await this.tenantService.getByUuid(uuid);
    const tenant = await this.tenantService.updateStatus(Number(target.id), body.status);
    return TenantMapper.toTenant(tenant);
  }

  @Patch(':uuid/plan')
  @AdminOnly()
  @ApiOperation({ summary: 'Change a tenant plan — menu presets recompute instantly (REQ-260825)' })
  async updatePlan(
    @CurrentUser() admin: Principal,
    @Param('uuid') uuid: string,
    @Body() body: UpdateTenantPlanRequest,
  ) {
    const target = await this.tenantService.getByUuid(uuid);
    const tenant = await this.tenantService.updatePlan(
      Number(target.id),
      body.plan,
      this.adminActorId(admin),
    );
    return TenantMapper.toTenant(tenant);
  }

  @Patch(':uuid/workflow-mode')
  @AdminOnly()
  @ApiOperation({ summary: 'Set the issue-workflow add-on mode (base/bridge/native, REQ-260825)' })
  async updateWorkflowMode(
    @CurrentUser() admin: Principal,
    @Param('uuid') uuid: string,
    @Body() body: UpdateTenantWorkflowModeRequest,
  ) {
    const target = await this.tenantService.getByUuid(uuid);
    const tenant = await this.tenantService.updateWorkflowMode(
      Number(target.id),
      body.workflow_mode,
      this.adminActorId(admin),
    );
    return TenantMapper.toTenant(tenant);
  }

  @Patch(':uuid/custom-css')
  @AdminOnly()
  @ApiOperation({ summary: 'Platform add-on: allow this tenant to ship sanitized custom widget CSS (PLN-260910 P5)' })
  async updateCustomCss(
    @CurrentUser() admin: Principal,
    @Param('uuid') uuid: string,
    @Body() body: UpdateTenantCustomCssRequest,
  ) {
    const target = await this.tenantService.getByUuid(uuid);
    const tenant = await this.tenantService.updateCustomCssEnabled(Number(target.id), body.enabled, this.adminActorId(admin));
    return TenantMapper.toTenant(tenant);
  }

  /** Audit actor for admin-only routes — hard runtime guarantee it IS an admin. */
  private adminActorId(principal: Principal): number {
    if (principal.actorType !== 'admin') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return principal.adminId;
  }

  @Get('me/credentials')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'List this tenant integration credential statuses' })
  async listCredentials(@CurrentUser() user: Principal) {
    const tenantId = this.tenantId(user);
    const creds = await this.tenantService.listCredentials(tenantId);
    return TenantMapper.toCredentialList(creds);
  }

  @Get('me/integrations')
  @Auth()
  @ApiOperation({ summary: "This tenant's own integration statuses (dashboard, read-only)" })
  async listMyIntegrations(@CurrentUser() user: Principal) {
    // Per-tenant integration status for the dashboard — any tenant user may read
    // it (no secrets exposed), unlike the credential-management list above
    // (FIX-260827). System admins have no tenant scope here.
    const tenantId = this.tenantId(user);
    const creds = await this.tenantService.listCredentials(tenantId);
    return TenantMapper.toCredentialList(creds);
  }

  @Put('me/credentials/:provider')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Upsert this tenant credential for a provider' })
  async upsertCredential(
    @CurrentUser() user: Principal,
    @Param('provider') provider: string,
    @Body() body: UpsertCredentialRequest,
  ) {
    const tenantId = this.tenantId(user);
    const cred = await this.tenantService.upsertCredential(tenantId, provider, body.secret);
    return TenantMapper.toCredential(cred);
  }

  @Get('me/shopify')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Get this tenant Shopify connection settings' })
  async getShopify(@CurrentUser() user: Principal) {
    const { tenant, cred, status } = await this.tenantService.getShopifyView(this.tenantId(user));
    return TenantMapper.toShopifySettings(tenant, cred, status);
  }

  @Put('me/shopify')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Save this tenant Shopify shop domain and credentials' })
  async saveShopify(
    @CurrentUser() user: Principal,
    @Body() body: UpdateShopifySettingsRequest,
  ) {
    const { tenant, cred, status } = await this.tenantService.saveShopify(this.tenantId(user), body);
    return TenantMapper.toShopifySettings(tenant, cred, status);
  }

  @Post('me/shopify/test')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Test Shopify Admin API connectivity and record status' })
  async testShopify(@CurrentUser() user: Principal) {
    return this.tenantService.testShopify(this.tenantId(user));
  }

  @Get('me/integrations/:provider')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Get this tenant e-commerce integration settings (cafe24/woocommerce/odoo/haravan)' })
  async getIntegration(@CurrentUser() user: Principal, @Param('provider') provider: string) {
    return this.ecommerceIntegrationService.getSettings(this.tenantId(user), provider);
  }

  @Put('me/integrations/:provider')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Save this tenant e-commerce integration credentials' })
  async saveIntegration(
    @CurrentUser() user: Principal,
    @Param('provider') provider: string,
    @Body() body: UpdateIntegrationRequest,
  ) {
    return this.ecommerceIntegrationService.save(this.tenantId(user), provider, body.config ?? {});
  }

  @Post('me/integrations/:provider/test')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Test e-commerce integration connectivity and record status' })
  async testIntegration(@CurrentUser() user: Principal, @Param('provider') provider: string) {
    return this.ecommerceIntegrationService.test(this.tenantId(user), provider);
  }

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }
}
