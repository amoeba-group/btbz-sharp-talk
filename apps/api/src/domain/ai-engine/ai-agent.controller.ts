import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { AiAgentService } from './ai-agent.service';
import { AiAgentMapper } from './ai-agent.mapper';
import { CreateAiAgentRequest, UpdateAiAgentRequest } from './dto/request/ai-agent.request';
import { RequireCapability } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** A tenant's AI agents — one persona per counter (PLN-260820-Multi-AI-Agent-Personas). */
@ApiTags('AI Agents')
@Controller('ai-agents')
export class AiAgentController {
  constructor(private readonly agents: AiAgentService) {}

  @Get()
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'List this tenant AI agents (default first)' })
  async list(@CurrentUser() user: Principal) {
    const rows = await this.agents.list(this.tenantId(user));
    return { items: rows.map((r) => AiAgentMapper.toResponse(r)) };
  }

  @Post()
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Create an AI agent' })
  async create(@CurrentUser() user: Principal, @Body() body: CreateAiAgentRequest) {
    const row = await this.agents.create(this.tenantId(user), {
      code: body.code,
      name: body.name,
      persona: body.persona ?? null,
      rules: body.rules ?? null,
      guestPolicy: body.guest_policy,
    });
    return AiAgentMapper.toResponse(row);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update an AI agent (name/persona/rules/active)' })
  async update(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAiAgentRequest,
  ) {
    const row = await this.agents.update(
      this.tenantId(user),
      id,
      {
        name: body.name,
        displayName: body.display_name,
        persona: body.persona,
        rules: body.rules,
        greeting: body.greeting,
        active: body.active,
        guestPolicy: body.guest_policy,
      },
      user.actorType === 'user' ? user.userId : null,
    );
    return AiAgentMapper.toResponse(row);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Delete an AI agent (the default cannot be deleted)' })
  async remove(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    await this.agents.remove(this.tenantId(user), id);
    return { deleted: true };
  }

  @Post(':id/default')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Make this agent the tenant default (routing fallback)' })
  async setDefault(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const row = await this.agents.setDefault(this.tenantId(user), id);
    return AiAgentMapper.toResponse(row);
  }

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }
}
