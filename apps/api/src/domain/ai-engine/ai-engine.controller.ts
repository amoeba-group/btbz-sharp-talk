import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { AdminOnly, RequireCapability } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { AiEngineService } from './ai-engine.service';
import { AuditService } from '../audit/audit.service';
import { AiEngineMapper } from './ai-engine.mapper';
import { CreateEngineRequest, UpdateEngineRequest } from './dto/request/ai-engine.request';

/** Platform AI engine catalog (FR-070). Admin-only, AI_ENGINE_MANAGE. */
@ApiTags('AI Engines')
@Controller('ai-engines')
export class AiEngineController {
  constructor(
    private readonly aiEngineService: AiEngineService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AdminOnly()
  @RequireCapability(CAPABILITY.AI_ENGINE_MANAGE)
  @ApiOperation({ summary: 'List all AI engines (API key masked as hasKey)' })
  async list() {
    return this.aiEngineService.listForAdmin();
  }

  /**
   * Connection test (PLN-261007 S4). Audited: it spends one token on whoever
   * owns the key, which for a tenant engine is not the operator.
   */
  @Post(':id/test')
  @AdminOnly()
  @RequireCapability(CAPABILITY.AI_ENGINE_MANAGE)
  @ApiOperation({ summary: 'Test an engine against its provider (records its health)' })
  async test(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const { engine, result } = await this.aiEngineService.test(id);
    await this.audit
      .write({
        tenantId: engine.tenantId ?? null,
        actorType: 'admin',
        actorId: user.actorType === 'admin' ? user.adminId : 0,
        action: 'ai_engine.tested',
        target: `ai_engine:${engine.id}`,
        result: result.ok ? 'success' : 'error',
        metadata: { reason: result.reason, elapsedMs: result.elapsedMs },
      })
      .catch(() => undefined);
    return result;
  }

  @Post()
  @AdminOnly()
  @RequireCapability(CAPABILITY.AI_ENGINE_MANAGE)
  @ApiOperation({ summary: 'Register an AI engine (platform-wide or tenant-scoped)' })
  async create(@Body() body: CreateEngineRequest) {
    const engine = await this.aiEngineService.create(body);
    return AiEngineMapper.toEngine(engine);
  }

  @Patch(':id')
  @AdminOnly()
  @RequireCapability(CAPABILITY.AI_ENGINE_MANAGE)
  @ApiOperation({ summary: 'Update an AI engine (re-encrypts key if provided)' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateEngineRequest) {
    const engine = await this.aiEngineService.update(id, body);
    return AiEngineMapper.toEngine(engine);
  }

  @Delete(':id')
  @AdminOnly()
  @RequireCapability(CAPABILITY.AI_ENGINE_MANAGE)
  @ApiOperation({ summary: 'Delete an AI engine' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.aiEngineService.remove(id);
    return { deleted: true };
  }
}
