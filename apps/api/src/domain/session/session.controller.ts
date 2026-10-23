import { Body, Controller, HttpCode, HttpStatus, Logger, Optional, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { SessionService } from './session.service';
import { SessionMapper } from './session.mapper';
import { RoutingCategoryService } from '../routing-category/routing-category.service';
import {
  ConsentRequest,
  EnsureSessionRequest,
  LanguageRequest,
  SessionOpenedRequest,
} from './dto/request/session.request';
import { Public } from '../../global/decorator/public.decorator';

/** Widget-facing session endpoints (public; identified by opaque session token). */
@ApiTags('Session')
@Controller('session')
export class SessionController {
  private readonly logger = new Logger(SessionController.name);

  constructor(
    private readonly sessionService: SessionService,
    /** Consult categories offered in the widget (PLN-261024); optional for older specs. */
    @Optional() private readonly consultCategories?: RoutingCategoryService,
  ) {}

  @Post('ensure')
  @Public()
  @SkipThrottle() // runs on every storefront page load — exclude from the flood limit
  @ApiOperation({ summary: 'Create or resume a widget session (S1)' })
  async ensure(@Body() body: EnsureSessionRequest) {
    const s = await this.sessionService.ensure(
      body.session_token,
      body.locale,
      body.shop_domain,
      body.parent_origin,
      body.agent_code,
      body.landing_path,
      body.access_key,
      body.language_chosen === true,
    );
    const notice = await this.sessionService.privacyNotice(s.tenantId, s.aiAgentId, s.language);
    return SessionMapper.toResponse(
      s,
      notice,
      await this.sessionService.customerDisplayName(s),
      await this.offeredCategories(s.tenantId, s.language),
    );
  }

  /** The picker list, or none — a failed read must never fail the session (the widget connects directly). */
  private async offeredCategories(tenantId: number | null, language: string): Promise<Array<{ code: string; label: string }>> {
    if (tenantId == null || !this.consultCategories) return [];
    try {
      return await this.consultCategories.visibleFor(tenantId, language);
    } catch (err) {
      this.logger.warn(`consult categories unavailable (tenant ${tenantId}): ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * The shopper opened the panel (PLN-260920).
   *
   * The session row already proves the widget was SHOWN; this is what separates
   * that from "was opened". Always answers 204, even for an unknown token: the
   * widget treats it as fire-and-forget, and an analytics ping must never be a
   * reason for a shopper to see an error.
   */
  @Post('opened')
  @Public()
  @SkipThrottle() // opens are rare next to page loads, but they arrive in bursts
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record a panel open (PLN-260920)' })
  async opened(@Body() body: SessionOpenedRequest): Promise<void> {
    try {
      await this.sessionService.recordOpen(body.session_token);
    } catch {
      /* analytics must not surface as a widget error */
    }
  }

  @Post('consent')
  @Public()
  @ApiOperation({ summary: 'Record CCPA consent (FN-008)' })
  async consent(@Body() body: ConsentRequest) {
    const s = await this.sessionService.setConsent(body.session_token, body.granted);
    return { consentState: s.consentState, consentVersion: s.consentVersion };
  }

  @Post('language')
  @Public()
  @ApiOperation({ summary: 'Set UI language (en/es/ko)' })
  async language(@Body() body: LanguageRequest) {
    const s = await this.sessionService.setLanguage(body.session_token, body.language);
    return { language: s.language };
  }
}
