import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { EmbedService } from './embed.service';
import { EmbedIdentifyRequest } from './dto/request/embed.request';
import { SessionService } from '../session/session.service';
import { SessionMapper } from '../session/session.mapper';
import { Public } from '../../global/decorator/public.decorator';

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
      name: body.name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
    });
    const notice = await this.sessionService.privacyNotice(session.tenantId, session.aiAgentId, session.language);
    return SessionMapper.toResponse(
      session,
      notice,
      await this.sessionService.customerDisplayName(session),
    );
  }
}
