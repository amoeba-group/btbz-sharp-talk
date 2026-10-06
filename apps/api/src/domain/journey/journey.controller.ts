import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { RequireCapability, RequireMenu } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { JourneyReportService } from './journey-report.service';
import { JourneyCriteriaService } from './journey-criteria.service';
import { JourneyManageService } from './journey-manage.service';
import { JourneyMapper } from './journey.mapper';
import {
  CompareJourneyReportsRequest,
  CreateJourneyReportRequest,
  CreateJourneyTaskRequest,
  JourneyBoardQuery,
  JourneyTimelineQuery,
  SaveJourneyCriteriaRequest,
  SaveJourneyStagesRequest,
  SetJourneyOwnerRequest,
  SetJourneyStageRequest,
  UpdateJourneyTaskRequest,
} from './dto/request/journey.request';

/** Customer journey reports (PLN-260825). Same holders as live chat. */
@ApiTags('Journey')
@Controller('journey')
export class JourneyController {
  constructor(
    private readonly reports: JourneyReportService,
    private readonly criteria: JourneyCriteriaService,
    private readonly manage: JourneyManageService,
  ) {}

  private tenantUser(user: Principal): { tenantId: number; userId: number } {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return { tenantId: user.tenantId, userId: user.userId };
  }

  @Get('groups/:groupId/reports')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: "A group's reports, newest first" })
  async list(@CurrentUser() user: Principal, @Param('groupId', ParseIntPipe) groupId: number) {
    const rows = await this.reports.list(this.tenantUser(user).tenantId, groupId);
    return JourneyMapper.toReportList(rows);
  }

  @Post('groups/:groupId/reports')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Start a report; it is written after this returns' })
  async create(
    @CurrentUser() user: Principal,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() body: CreateJourneyReportRequest,
  ) {
    const actor = this.tenantUser(user);
    const row = await this.reports.request(
      actor.tenantId,
      groupId,
      { from: body.period_from ?? null, to: body.period_to ?? null },
      actor.userId,
    );
    return JourneyMapper.toReport(row);
  }

  @Get('reports/:id')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'One report, with its body once ready' })
  async get(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    return JourneyMapper.toReport(await this.reports.get(this.tenantUser(user).tenantId, id), true);
  }

  @Post('reports/compare')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Compare two finished reports' })
  async compare(@CurrentUser() user: Principal, @Body() body: CompareJourneyReportsRequest) {
    const actor = this.tenantUser(user);
    const row = await this.reports.requestComparison(actor.tenantId, body.report_ids, actor.userId);
    return JourneyMapper.toReport(row);
  }

  @Delete('reports/:id')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Hide a report — comparisons still reference their inputs' })
  async hide(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    await this.reports.hide(this.tenantUser(user).tenantId, id);
    return { hidden: true };
  }

  @Get('criteria')
  @RequireCapability(CAPABILITY.TENANT_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Current writing criteria and its version history' })
  async criteriaList(@CurrentUser() user: Principal) {
    const actor = this.tenantUser(user);
    const [current, history] = await Promise.all([
      this.criteria.current(actor.tenantId, actor.userId),
      this.criteria.list(actor.tenantId),
    ]);
    return {
      current: JourneyMapper.toCriteria(current),
      history: history.map((c) => JourneyMapper.toCriteria(c)),
    };
  }

  @Put('criteria')
  @RequireCapability(CAPABILITY.TENANT_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Save as a new version; past reports keep the one they used' })
  async saveCriteria(@CurrentUser() user: Principal, @Body() body: SaveJourneyCriteriaRequest) {
    const actor = this.tenantUser(user);
    const saved = await this.criteria.save(
      actor.tenantId,
      {
        sectionsJson: body.sections,
        topQuestionsN: body.top_questions_n,
        sampleCap: body.sample_cap,
        quoteMaxChars: body.quote_max_chars,
        tone: body.tone,
        bannedJson: body.banned,
      },
      actor.userId,
    );
    return JourneyMapper.toCriteria(saved);
  }

  // ---- journey management (PLN-261006 P2~P4) ----

  @Get('stages')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: "The tenant's journey stages (5A seeded on first read)" })
  async stages(@CurrentUser() user: Principal) {
    const rows = await this.manage.stages(this.tenantUser(user).tenantId);
    return rows.map((r) => JourneyMapper.toStage(r));
  }

  @Put('stages')
  @RequireCapability(CAPABILITY.TENANT_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Replace the ordered stage list; a stage in use cannot be removed' })
  async saveStages(@CurrentUser() user: Principal, @Body() body: SaveJourneyStagesRequest) {
    const actor = this.tenantUser(user);
    const rows = await this.manage.saveStages(actor.tenantId, actor.userId, body.stages);
    return rows.map((r) => JourneyMapper.toStage(r));
  }

  @Get('people')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Teammates to pick as owner/assignee (id + display name)' })
  async people(@CurrentUser() user: Principal) {
    const rows = await this.manage.people(this.tenantUser(user).tenantId);
    return rows.map((r) => ({ id: String(r.id), name: r.name }));
  }

  @Get('board')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @RequireMenu('journey')
  @ApiOperation({ summary: 'Every group as a card under its stage' })
  async board(@CurrentUser() user: Principal, @Query() query: JourneyBoardQuery) {
    const { stages, cards } = await this.manage.board(this.tenantUser(user).tenantId, {
      kind: query.kind,
      ownerUserId: query.owner != null ? Number(query.owner) : undefined,
      overdueOnly: query.overdue === '1' || query.overdue === 'true',
    });
    return { stages: stages.map((s) => JourneyMapper.toStage(s)), cards: cards.map((c) => JourneyMapper.toBoardCard(c)) };
  }

  @Get('groups/:groupId/journey')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: "A group's journey card: stage, owner, next actions" })
  async card(@CurrentUser() user: Principal, @Param('groupId', ParseIntPipe) groupId: number) {
    const { journey, tasks, names } = await this.manage.card(this.tenantUser(user).tenantId, groupId);
    return JourneyMapper.toCard(groupId, journey, tasks, names);
  }

  @Put('groups/:groupId/stage')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Move the journey to a stage (audited)' })
  async setStage(
    @CurrentUser() user: Principal,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() body: SetJourneyStageRequest,
  ) {
    const actor = this.tenantUser(user);
    await this.manage.setStage(actor.tenantId, groupId, actor.userId, body.stage_key);
    return this.card(user, groupId);
  }

  @Put('groups/:groupId/owner')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Set or clear the journey owner' })
  async setOwner(
    @CurrentUser() user: Principal,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() body: SetJourneyOwnerRequest,
  ) {
    const actor = this.tenantUser(user);
    await this.manage.setOwner(actor.tenantId, groupId, actor.userId, body.owner_user_id);
    return this.card(user, groupId);
  }

  @Get('groups/:groupId/history')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Stage changes, newest first' })
  async history(@CurrentUser() user: Principal, @Param('groupId', ParseIntPipe) groupId: number) {
    return JourneyMapper.toHistory(await this.manage.history(this.tenantUser(user).tenantId, groupId));
  }

  @Get('groups/:groupId/timeline')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Touchpoints across the group sessions, newest first' })
  async timeline(
    @CurrentUser() user: Principal,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Query() query: JourneyTimelineQuery,
  ) {
    const { items, hasMore } = await this.manage.timeline(
      this.tenantUser(user).tenantId,
      groupId,
      query.before ? new Date(query.before) : undefined,
    );
    return { items: items.map((i) => JourneyMapper.toTimelineItem(i)), hasMore };
  }

  @Post('groups/:groupId/tasks')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Add a next action (manual, or picked from a report)' })
  async addTask(
    @CurrentUser() user: Principal,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() body: CreateJourneyTaskRequest,
  ) {
    const actor = this.tenantUser(user);
    await this.manage.addTask(actor.tenantId, groupId, actor.userId, {
      title: body.title,
      dueAt: body.due_at ?? null,
      assigneeUserId: body.assignee_user_id ?? null,
      source: body.source,
      reportId: body.report_id ?? null,
    });
    return this.card(user, groupId);
  }

  @Patch('tasks/:id')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Edit, complete or reopen a next action' })
  async updateTask(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateJourneyTaskRequest,
  ) {
    const task = await this.manage.updateTask(this.tenantUser(user).tenantId, id, {
      title: body.title,
      dueAt: body.due_at,
      assigneeUserId: body.assignee_user_id,
      done: body.done,
    });
    return JourneyMapper.toTask(task, new Map());
  }

  @Delete('tasks/:id')
  @RequireCapability(CAPABILITY.CONVERSATION_HANDLE)
  @ApiOperation({ summary: 'Delete a next action' })
  async deleteTask(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    await this.manage.deleteTask(this.tenantUser(user).tenantId, id);
    return { deleted: true };
  }
}
