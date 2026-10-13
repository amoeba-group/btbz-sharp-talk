import { Body, Controller, Optional, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { EmbedService } from './embed.service';
import { EmbedIdentifyRequest, EmbedLogoutRequest } from './dto/request/embed.request';
import { SessionService } from '../session/session.service';
import { SessionMapper } from '../session/session.mapper';
import { Public } from '../../global/decorator/public.decorator';
import { PilotService } from '../pilot/pilot.service';

/**
 * Widget-facing embed endpoints (PLN-260819 S2).
 *
 * Public by necessity — it runs before there is any identity to authenticate
 * with. That is exactly why it is throttled: unlike the session poll routes this
 * one verifies a signature, so an unbounded caller could use it to grind at the
 * secret. Twenty attempts a minute is far above what a real sign-in needs.
 */
@ApiTags('Embed')
@Controller('public/embed')
export class EmbedController {
  constructor(
    private readonly embedService: EmbedService,
    private readonly sessionService: SessionService,
    // Optional so a controller built without the pilot module (specs) still works.
    @Optional() private readonly pilotService?: PilotService,
  ) {}

  @Post('identify')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Bind a widget session to a signed external user (SDK identify)' })
  async identify(@Body() body: EmbedIdentifyRequest) {
    const session = await this.embedService.identify({
      sessionToken: body.session_token,
      userId: body.user_id,
      hash: body.hash,
      // v2 (PLN-261001 v1.1): snake → camel at the edge; the service verifies.
      claims: body.claims
        ? {
            hotelSn: body.claims.hotel_sn,
            role: body.claims.role,
            iat: body.claims.iat,
            hotelName: body.claims.hotel_name ?? null,
            hotelCode: body.claims.hotel_code ?? null,
            province: body.claims.province ?? null,
          }
        : null,
      name: body.name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
    });
    const notice = await this.sessionService.privacyNotice(session.tenantId, session.aiAgentId, session.language);
    return SessionMapper.toResponse(
      session,
      notice,
      await this.sessionService.customerDisplayName(session),
      await this.sessionService.identityOf(session),
      // Whether this hotel is on the pilot list (PLN-261012 SG-40) — what the widget
      // needs to get out of the way for one that is not.
      (await this.pilotService?.hintFor(session)) ?? { eligible: null },
    );
  }

  @Post('logout')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'End the identity binding of a widget session (SDK logout)' })
  async logout(@Body() body: EmbedLogoutRequest) {
    return this.embedService.logout(body.session_token);
  }
}
