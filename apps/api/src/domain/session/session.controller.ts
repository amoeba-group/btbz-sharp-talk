import { Body, Controller, HttpCode, HttpStatus, Optional, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { SessionService } from './session.service';
import { SessionMapper } from './session.mapper';
import {
  ConsentRequest,
  EnsureSessionRequest,
  LanguageRequest,
  SessionOpenedRequest,
  SessionPilotRequest,
} from './dto/request/session.request';
import { Public } from '../../global/decorator/public.decorator';
import { PilotService } from '../pilot/pilot.service';

/** Widget-facing session endpoints (public; identified by opaque session token). */
@ApiTags('Session')
@Controller('session')
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    // Optional so a controller built without the pilot module (specs) still works.
    @Optional() private readonly pilotService?: PilotService,
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
    );
    const notice = await this.sessionService.privacyNotice(s.tenantId, s.aiAgentId, s.language);
    return SessionMapper.toResponse(
      s,
      notice,
      await this.sessionService.customerDisplayName(s),
      await this.sessionService.identityOf(s),
      (await this.pilotService?.hintFor(s)) ?? { eligible: null },
    );
  }

  /**
   * The pilot allowlist verdict for this session, re-asked without opening a
   * session (PLN-261012 SG-40). The widget hides itself for a hotel that is not on
   * the list; adding the hotel in the console is picked up here without the host
   * identifying again. No side effects, nothing written.
   */
  @Post('pilot')
  @Public()
  @ApiOperation({ summary: 'Pilot allowlist verdict for a session (SG-40)' })
  async pilot(@Body() body: SessionPilotRequest) {
    const s = await this.sessionService.findByToken(body.session_token);
    return { pilot: (await this.pilotService?.hintFor(s)) ?? { eligible: null } };
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
