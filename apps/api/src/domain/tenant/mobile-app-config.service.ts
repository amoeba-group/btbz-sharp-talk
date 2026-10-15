import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MOBILE_APP_DEFAULTS, normalizeMobileAppConfig, type MobileAppConfig } from '@sharptalk/types';
import { Tenant } from './entity/tenant.entity';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import type { UpdateMobileAppRequest } from './dto/request/mobile-app.request';

/**
 * Settings for the host MOBILE APP surface (PLN-261015 S9): app-only look,
 * which agent each app screen opens, minimum SDK.
 *
 * Kept in its own service so the tenant service's positional constructor (and
 * every spec built on it) is untouched.
 */
@Injectable()
export class MobileAppConfigService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(AiAgent) private readonly agentRepo: Repository<AiAgent>,
    private readonly audit: AuditService,
  ) {}

  /** What the console edits: the stored config, or the defaults when never saved. */
  async get(tenantId: number): Promise<{ configured: boolean; config: MobileAppConfig }> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    const stored = normalizeMobileAppConfig(tenant.mobileAppConfig);
    return { configured: !!stored, config: stored ?? MOBILE_APP_DEFAULTS };
  }

  /**
   * Replace the config (sent whole). Every entry's agent must be one of THIS
   * tenant's agents — an unknown code is refused rather than stored, because a
   * typo here would send every lễ tân on that screen to the default agent
   * without anyone noticing.
   */
  async update(tenantId: number, actorId: number, body: UpdateMobileAppRequest) {
    const next = normalizeMobileAppConfig({
      app: body.app
        ? {
            font: body.app.font,
            fontSize: body.app.font_size,
            menuStyle: body.app.menu_style,
            header: body.app.header,
            brand: body.app.brand,
          }
        : undefined,
      entries: (body.entries ?? []).map((e) => ({
        screen: e.screen,
        agentCode: e.agent_code,
        contextLabel: e.context_label,
      })),
      minSdk: body.min_sdk,
    });
    // A body that normalises to nothing is still a valid "back to defaults".
    const config = next ?? MOBILE_APP_DEFAULTS;

    const codes = [...new Set(config.entries.map((e) => e.agentCode))];
    if (codes.length) {
      const known = await this.agentRepo.find({ where: { tenantId } });
      const have = new Set(known.map((a) => a.code));
      const unknown = codes.filter((c) => !have.has(c));
      if (unknown.length) {
        throw new BusinessException(ERROR_CODE.MOBILE_APP_UNKNOWN_AGENT, HttpStatus.BAD_REQUEST);
      }
    }

    await this.tenantRepo.update({ id: tenantId }, { mobileAppConfig: config });
    await this.audit
      .write({
        tenantId,
        actorType: 'user',
        actorId,
        action: 'tenant.mobile_app_updated',
        target: `mobile app: ${config.entries.length} screen(s), header ${config.app.header}`,
        metadata: { ...config },
      })
      .catch(() => undefined);
    return { configured: true, config };
  }

  /**
   * The widget's (and SDK's) read: no auth, keyed by shop like the logo. Only the
   * look and the screen→agent table — nothing private, no secrets. `null` = this
   * tenant never configured an app surface, so the web theme applies unchanged.
   */
  async publicFor(shop: string): Promise<MobileAppConfig | null> {
    const tenant = shop ? await this.tenantRepo.findOne({ where: { shopDomain: shop } }) : null;
    return normalizeMobileAppConfig(tenant?.mobileAppConfig ?? null);
  }
}
