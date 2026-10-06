import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { AiConfigService } from './ai-config.service';
import { AiConfigRevisionService } from './ai-config-revision.service';
import { AiConfigMapper } from './ai-config.mapper';
import { CONFIG_REVISION_KIND } from './entity/tenant-ai-config-revision.entity';
import type { HandoffConfig, ScenarioOverride } from './entity/tenant-ai-config.entity';
import { SessionService } from '../session/session.service';
import { UpdateAiConfigRequest, CreatePreviewSessionRequest } from './dto/request/ai-config.request';
import { RequireCapability } from '../../global/decorator/auth.decorator';
import { Public } from '../../global/decorator/public.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { HttpStatus } from '@nestjs/common';
import { SessionToken } from '../../global/decorator/session-token.decorator';

/** AI behavior config (FR-047 / FN-040): persona, response rules, scenario buttons. */
@ApiTags('AI Config')
@Controller('ai-config')
export class AiConfigController {
  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly sessionService: SessionService,
    private readonly revisionService: AiConfigRevisionService,
  ) {}

  @Get()
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Get tenant AI config (persona/rules/scenario buttons)' })
  get(@CurrentUser() user: Principal) {
    return this.aiConfig.getConfig(this.tenantId(user));
  }

  // Declared before any `:param` route would be — and read-only shipped copy,
  // so it needs no tenant scope beyond the capability check.
  @Get('defaults')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({
    summary: 'Shipped conversation defaults (scenario scripts, buttons, persona, widget copy)',
  })
  defaults() {
    return AiConfigMapper.toDefaults(this.aiConfig.getDefaults());
  }

  @Put()
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update tenant AI config' })
  update(@CurrentUser() user: Principal, @Body() body: UpdateAiConfigRequest) {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return this.aiConfig.upsertConfig(
      user.tenantId,
      {
        persona: body.persona,
        rules: body.rules,
        scenarioButtons: body.scenario_buttons,
        // Shape is pruned/validated in the service (sanitizeOverrides).
        scenarioOverrides: body.scenario_overrides as Record<string, ScenarioOverride> | undefined,
        handoffConfig: body.handoff_config as HandoffConfig | undefined,
        // Pruned/validated in the service (sanitizeGuestGuidance).
        guestGuidance: body.guest_guidance,
      },
      { kind: CONFIG_REVISION_KIND.MANUAL, actorUserId: user.userId, note: body.note ?? null },
      body.ai_agent_id ?? null,
    );
  }

  @Get('revisions')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Version history for the persona and response rules' })
  async revisions(@CurrentUser() user: Principal) {
    const rows = await this.revisionService.list(this.tenantId(user));
    return { items: rows.map((r) => AiConfigMapper.toRevisionSummary(r)) };
  }

  @Get('revisions/:id')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'One past version, for review before restoring it' })
  async revision(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const row = await this.revisionService.get(this.tenantId(user), id);
    return AiConfigMapper.toRevision(row);
  }

  @Post('preview-session')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Create an isolated sandbox chat session for the /ai-setting preview' })
  async createPreviewSession(@CurrentUser() user: Principal, @Body() body: CreatePreviewSessionRequest) {
    const session = await this.sessionService.createPreview(
      this.tenantId(user),
      body.language,
      body.ai_agent_id ?? null,
    );
    return { sessionToken: session.sessionToken, language: session.language };
  }

  @Get('scenario')
  @Public()
  @ApiOperation({ summary: 'Widget: enabled scenario buttons for the session tenant' })
  // SessionToken, not @Query: an absent token used to fall through to
  // findOne({ sessionToken: undefined }) — TypeORM drops the predicate and
  // returns an ARBITRARY session, so the widget rendered another tenant's
  // unscoped buttons (FIX-260825-Scenario-Token-Guard).
  scenario(@SessionToken() sessionToken: string) {
    return this.aiConfig.getScenarioForSession(sessionToken);
  }

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }
}
