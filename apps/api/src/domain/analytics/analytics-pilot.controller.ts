import { Controller, Get, HttpStatus, Logger, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CAPABILITY, Principal, USER_RANK } from '@sharptalk/types';
import { AuditService } from '../audit/audit.service';
import { RequireCapability, RequireMenu, RequireRank } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { toDateKey } from '../../global/util/date-range.util';
import { AnalyticsPilotService } from './analytics-pilot.service';
import type { PilotRequest } from './analytics-pilot.service';
import { AnalyticsPilotMapper } from './analytics-pilot.mapper';
import { pipeChunks } from './analytics-pilot-stream.util';
import { PilotAnalyticsQuery } from './dto/request/analytics-pilot.request';

/** The tenant-user shape of the principal union. */
type TenantUser = Extract<Principal, { actorType: 'user' }>;

/** The DTO is snake_case on the wire; the service speaks camelCase. */
function toRequest(q: PilotAnalyticsQuery): PilotRequest {
  return { group: q.group, from: q.from, to: q.to, hotelSn: q.hotel_sn, role: q.role };
}

/** `YYMMDD` of an instant, UTC — the file-name stamp. */
const stamp = (d: Date): string => toDateKey(d).replace(/-/g, '').slice(2);

/**
 * Pilot analytics (PLN-261012 SG-52): numbers by hotel / role / day for the Go2Joy pilot, and a
 * transcript export for grading by hand.
 *
 * Tenant users only. A system admin has no tenant, and a null tenant here would blend every
 * tenant's conversations into one table — the same cross-tenant leak `AnalyticsController.tenantOf`
 * refuses for the other lenses.
 */
@ApiTags('Analytics')
@Controller('analytics/pilot')
export class AnalyticsPilotController {
  private readonly logger = new Logger(AnalyticsPilotController.name);

  constructor(
    private readonly pilot: AnalyticsPilotService,
    private readonly audit: AuditService,
  ) {}

  private tenantUser(user: Principal): TenantUser {
    if (user.actorType !== 'user') throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    return user;
  }

  /** Same gate as every other statistics lens: the analytics capability and the statistics screen. */
  @Get()
  @RequireCapability(CAPABILITY.ANALYTICS_READ)
  @RequireMenu('statistics')
  @ApiOperation({ summary: 'Pilot numbers by hotel, role or day (SG-52)' })
  async report(@CurrentUser() user: Principal, @Query() query: PilotAnalyticsQuery) {
    return AnalyticsPilotMapper.toReport(await this.pilot.report(this.tenantUser(user).tenantId, toRequest(query)));
  }

  /**
   * One row per conversation for manual accuracy grading, with a PII-scrubbed transcript. More
   * sensitive than the aggregate (it is the conversations themselves, scrubbed), so it asks for a
   * privileged rank ON TOP of the analytics capability, and every export leaves an audit row.
   */
  @Get('conversations.csv')
  @RequireCapability(CAPABILITY.ANALYTICS_READ)
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @RequireMenu('statistics')
  @ApiOperation({ summary: 'Pilot conversations as CSV for grading by hand (SG-52)' })
  async exportCsv(
    @CurrentUser() user: Principal,
    @Query() query: PilotAnalyticsQuery,
    @Res() res: Response,
  ): Promise<void> {
    const actor = this.tenantUser(user);
    const tenantId = actor.tenantId;
    const req = toRequest(query);
    // Everything that can be refused is refused HERE, before a header is written: afterwards the only
    // honest way to fail is to break the connection.
    const plan = await this.pilot.prepareExport(tenantId, req);

    const lastDay = new Date(plan.to.getTime() - 1);
    const filename = `pilot-conversations-${stamp(plan.from)}-${stamp(lastDay)}.csv`;
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('X-Export-Rows', String(plan.rows.length));
    res.setHeader('X-Export-Truncated', plan.truncated ? 'true' : 'false');
    // A cross-origin console (dev: :5173 -> :3000) can read these only when they are exposed.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Rows, X-Export-Truncated');

    let result: 'success' | 'error' = 'success';
    let aborted = false;
    try {
      aborted = (await pipeChunks(res, this.pilot.exportChunks(tenantId, plan))).aborted;
    } catch (err) {
      result = 'error';
      this.logger.error(`pilot export failed mid-file (tenant ${tenantId}): ${(err as Error).message}`);
    } finally {
      // Counts and the window only: the audit trail must never hold what the export holds.
      await this.audit
        .write({
          tenantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'analytics.pilot_export',
          target: `window:${toDateKey(plan.from)}..${toDateKey(lastDay)}`,
          result,
          metadata: {
            rows: plan.rows.length,
            truncated: plan.truncated,
            aborted,
            hotelFilter: !!req.hotelSn,
            roleFilter: !!req.role,
          },
        })
        .catch((e: Error) => this.logger.warn(`pilot export audit row not written: ${e.message}`));
    }
  }
}
