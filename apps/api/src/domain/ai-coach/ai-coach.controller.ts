import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, JobLabel, Principal, UserRank } from '@sharptalk/types';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { RequireCapability } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { AiCoachService } from './ai-coach.service';
import { CoachProposalService } from './coach-proposal.service';
import { AiCoachMapper } from './ai-coach.mapper';
import {
  ApplyProposalRequest,
  CreateThreadRequest,
  ListThreadsQuery,
  SendCoachMessageRequest,
} from './dto/request/ai-coach.request';
import {
  CompareRunsQuery,
  BulkGoldenQuestionsRequest,
  CreateGoldenQuestionRequest,
  CreateGoldenRunRequest,
  UpdateGoldenQuestionRequest,
} from './dto/request/golden.request';
import { GOLDEN_MAX_QUESTIONS, GoldenService } from './golden.service';
import { GOLDEN_RUN_KIND, GoldenRunKind } from './entity/golden-run.entity';

/**
 * Agent coaching channel (FR-071 / FR-072). Distinct from the /ai-setting
 * preview: there the admin plays the shopper, here they talk to the agent about
 * its own behavior and approve the config changes that come out of it.
 */
@ApiTags('AI Coach')
@Controller('ai-coach')
export class AiCoachController {
  constructor(
    private readonly coach: AiCoachService,
    private readonly proposals: CoachProposalService,
    private readonly golden: GoldenService,
  ) {}

  private tenantUser(user: Principal): {
    tenantId: number;
    userId: number;
    rank: UserRank;
    labels: JobLabel[];
  } {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    // rank/labels ride along because applying a kb_upsert additionally requires
    // KNOWLEDGE_SOURCE_MANAGE, which the route-level guard does not cover.
    return {
      tenantId: user.tenantId,
      userId: user.userId,
      rank: user.rank,
      labels: user.labels ?? [],
    };
  }

  @Get('threads')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'List coaching threads for the tenant' })
  async listThreads(@CurrentUser() user: Principal, @Query() query: ListThreadsQuery) {
    const { tenantId } = this.tenantUser(user);
    const { page, size } = normalizePage(query.page, query.size);
    const { items, total } = await this.coach.listThreads(tenantId, page, size);
    return new Paginated(AiCoachMapper.toThreadList(items), buildPagination(page, size, total));
  }

  @Post('threads')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Start a coaching thread' })
  async createThread(@CurrentUser() user: Principal, @Body() body: CreateThreadRequest) {
    const { tenantId, userId } = this.tenantUser(user);
    const thread = await this.coach.createThread(tenantId, userId, body.title, body.ai_agent_id ?? null);
    return AiCoachMapper.toThread(thread);
  }

  @Get('threads/:id')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Get a coaching thread with its messages and proposals' })
  async getThread(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const { tenantId } = this.tenantUser(user);
    const { thread, messages, proposals } = await this.coach.getThread(tenantId, id);
    return AiCoachMapper.toThreadDetail(thread, messages, proposals);
  }

  @Post('threads/:id/messages')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Coach the agent; returns its reply and any change proposals' })
  async sendMessage(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SendCoachMessageRequest,
  ) {
    const { tenantId, userId } = this.tenantUser(user);
    const result = await this.coach.sendTurn({
      tenantId,
      userId,
      threadId: id,
      text: body.message,
      refMessageId: body.ref_message_id,
    });
    return {
      message: AiCoachMapper.toMessage(result.message),
      proposals: result.proposals.map((p) => AiCoachMapper.toProposal(p)),
    };
  }

  @Delete('threads/:id')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Archive a coaching thread' })
  async archiveThread(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const { tenantId } = this.tenantUser(user);
    await this.coach.archiveThread(tenantId, id);
    return { archived: true };
  }

  @Post('proposals/:id/apply')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Approve a proposal and write it to the tenant AI config' })
  async applyProposal(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ApplyProposalRequest,
  ) {
    const { tenantId, userId, rank, labels } = this.tenantUser(user);
    const proposal = await this.proposals.apply(tenantId, { userId, rank, labels }, id, {
      persona: body.persona,
      rule: body.rule,
      docContent: body.doc_content,
      scenarioReply: body.scenario_reply,
    });
    return AiCoachMapper.toProposal(proposal);
  }

  /**
   * Apply a proposal with evidence: snapshot the answers, apply, snapshot again.
   *
   * The order is the whole point — once a change is live the previous config is
   * gone, so a "before" cannot be taken afterwards. Kept separate from plain
   * apply because it costs two model calls per question and most approvals do
   * not need it.
   */
  @Post('proposals/:id/apply-verified')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Run the regression set, apply the proposal, run it again, and compare' })
  async applyVerified(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ApplyProposalRequest,
  ) {
    const { tenantId, userId, rank, labels } = this.tenantUser(user);
    const baseline = await this.golden.run(tenantId, userId, GOLDEN_RUN_KIND.BASELINE, {
      label: `proposal #${id}`,
    });
    const proposal = await this.proposals.apply(tenantId, { userId, rank, labels }, id, {
      persona: body.persona,
      rule: body.rule,
      docContent: body.doc_content,
      scenarioReply: body.scenario_reply,
    });
    const after = await this.golden.run(tenantId, userId, GOLDEN_RUN_KIND.AFTER, {
      label: `proposal #${id}`,
      proposalId: id,
    });
    return {
      proposal: AiCoachMapper.toProposal(proposal),
      comparison: await this.golden.compare(tenantId, Number(baseline.id), Number(after.id)),
    };
  }

  // ---- regression set (FR-073) ----

  @Get('golden/questions')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'List the regression questions' })
  async listGolden(@CurrentUser() user: Principal) {
    const rows = await this.golden.listQuestions(this.tenantUser(user).tenantId);
    return { items: rows.map((r) => AiCoachMapper.toGoldenQuestion(r)), max: GOLDEN_MAX_QUESTIONS };
  }

  @Post('golden/questions')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Add a regression question' })
  async addGolden(@CurrentUser() user: Principal, @Body() body: CreateGoldenQuestionRequest) {
    const { tenantId, userId } = this.tenantUser(user);
    const row = await this.golden.addQuestion(tenantId, userId, body);
    return AiCoachMapper.toGoldenQuestion(row);
  }

  /** Paste many questions with their expected facts (PLN-261007 R7). Declared before `:id`. */
  @Post('golden/questions/bulk')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Bulk add/update regression questions from a TSV paste' })
  async bulkGolden(@CurrentUser() user: Principal, @Body() body: BulkGoldenQuestionsRequest) {
    const { tenantId, userId } = this.tenantUser(user);
    return this.golden.bulkImport(tenantId, userId, body);
  }

  @Patch('golden/questions/:id')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Edit a regression question' })
  async updateGolden(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateGoldenQuestionRequest,
  ) {
    const row = await this.golden.updateQuestion(this.tenantUser(user).tenantId, id, body);
    return AiCoachMapper.toGoldenQuestion(row);
  }

  @Delete('golden/questions/:id')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Remove a regression question' })
  async removeGolden(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    await this.golden.removeQuestion(this.tenantUser(user).tenantId, id);
    return { removed: true };
  }

  @Post('golden/runs')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Ask every regression question on the current config' })
  async createGoldenRun(@CurrentUser() user: Principal, @Body() body: CreateGoldenRunRequest) {
    const { tenantId, userId } = this.tenantUser(user);
    const run = await this.golden.run(
      tenantId,
      userId,
      (body.kind as GoldenRunKind) ?? GOLDEN_RUN_KIND.MANUAL,
      // Background: up to 60 questions outlast the proxy timeout; the screen polls.
      { label: body.label, aiAgentId: body.ai_agent_id ?? null, background: true },
    );
    return AiCoachMapper.toGoldenRun(run);
  }

  @Get('golden/runs')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Recent regression runs' })
  async listGoldenRuns(@CurrentUser() user: Principal) {
    const rows = await this.golden.listRuns(this.tenantUser(user).tenantId);
    return { items: rows.map((r) => AiCoachMapper.toGoldenRun(r)) };
  }

  @Get('golden/compare')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Compare two runs question by question' })
  async compareGolden(@CurrentUser() user: Principal, @Query() query: CompareRunsQuery) {
    return this.golden.compare(this.tenantUser(user).tenantId, query.base, query.target);
  }

  @Post('proposals/:id/reject')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Dismiss a proposal without applying it' })
  async rejectProposal(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const { tenantId, userId } = this.tenantUser(user);
    const proposal = await this.proposals.reject(tenantId, userId, id);
    return AiCoachMapper.toProposal(proposal);
  }

  @Post('proposals/:id/revert')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Roll an applied proposal back to the value it replaced' })
  async revertProposal(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const { tenantId, userId } = this.tenantUser(user);
    const proposal = await this.proposals.revert(tenantId, userId, id);
    return AiCoachMapper.toProposal(proposal);
  }
}
