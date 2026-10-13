import { Body, Controller, Get, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../../global/decorator/public.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { metrics, safeLabel } from './app-metrics';
import { assertOpsToken } from './ops-token';
import { OpsAlertService, OpsSeverity } from './ops-alert.service';
import { ReadinessService } from './readiness.service';

/** Alert kinds a script may raise through the hook. `custom` is for site-specific jobs. */
export const OPS_HOOK_KINDS = ['backup_failed', 'restore_failed', 'deploy_failed', 'custom'] as const;
export type OpsHookKind = (typeof OPS_HOOK_KINDS)[number];

const HOOK_TITLE: Record<Exclude<OpsHookKind, 'custom'>, string> = {
  backup_failed: 'Backup failed',
  restore_failed: 'Restore failed',
  deploy_failed: 'Deploy failed',
};

/** Request DTO — snake_case per the repo convention. */
export class OpsAlertRequest {
  @IsIn(OPS_HOOK_KINDS as unknown as string[])
  kind: OpsHookKind;

  /** Required for `custom`; ignored otherwise (the title is fixed per kind). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  /** What the operator needs to know — the failing command's last lines, not customer data. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detail?: string;

  @IsOptional()
  @IsIn(['info', 'warning', 'critical'])
  severity?: OpsSeverity;
}

/**
 * The operations surface (PLN-261012 SG-83). Not part of the product API and not in Swagger.
 * Every route is `@Public()` for the JWT guard and protected by a static bearer token instead —
 * see `assertOpsToken` for the 404-when-unset / 401-when-wrong contract.
 */
@ApiExcludeController()
@Controller()
export class ObservabilityController {
  constructor(
    private readonly alerts: OpsAlertService,
    private readonly readiness: ReadinessService,
  ) {}

  /**
   * Prometheus text exposition (v0.0.4), `METRICS_TOKEN`-protected. Served at `/metrics` (outside the
   * API prefix, the Prometheus convention — scrape the container port directly, do not publish it) and
   * also under the prefix as `/ops/metrics` for deployments whose proxy only forwards `/api/`.
   */
  @Get(['metrics', 'ops/metrics'])
  @Public()
  async scrape(@Req() req: Request, @Res() res: Response): Promise<void> {
    assertOpsToken(req.headers, 'METRICS_TOKEN');
    // Express re-serialises the parameters (charset first); Prometheus accepts either order.
    res
      .status(HttpStatus.OK)
      .set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(await metrics.render());
  }

  /**
   * Dependency readiness — DB, Redis, Qdrant and an AI-engine summary, each with its own deadline
   * and verdict. 200 while the REQUIRED dependencies (READINESS_REQUIRED, default the database) are
   * up, 503 + E5122 when one is down; `data` always carries the full per-dependency report.
   * Liveness (`/health`) and the admin `/health/ready` are unchanged.
   */
  @Get('health/readiness')
  @Public()
  async ready(@Req() req: Request, @Res() res: Response): Promise<void> {
    assertOpsToken(req.headers, 'METRICS_TOKEN');
    const report = await this.readiness.check();
    const timestamp = new Date().toISOString();
    if (report.status === 'down') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        success: false,
        data: report,
        error: { code: ERROR_CODE.READINESS_FAILED.code, message: ERROR_CODE.READINESS_FAILED.message },
        timestamp,
      });
      return;
    }
    res.status(HttpStatus.OK).json({ success: true, data: report, timestamp });
  }

  /**
   * Script hook for failures the API cannot observe itself (a nightly backup, a restore, a deploy):
   * `curl -fsS -H "Authorization: Bearer $OPS_ALERT_TOKEN" -H 'content-type: application/json'
   *   -d '{"kind":"backup_failed","detail":"pg_dump exited 2"}' http://localhost:3000/api/v1/internal/ops-alert`.
   * `OPS_ALERT_TOKEN`-protected. 200 when delivered or deduped, 503 + E5123 when no channel took it —
   * so `curl -f` makes the script notice that its alert went nowhere.
   */
  @Post('internal/ops-alert')
  @Public()
  async raise(@Req() req: Request, @Body() body: OpsAlertRequest) {
    assertOpsToken(req.headers, 'OPS_ALERT_TOKEN');
    const title = body.kind === 'custom' ? (body.title?.trim() || 'Operational alert') : HOOK_TITLE[body.kind];
    const key = body.kind === 'custom' ? `custom:${safeLabel(title)}` : body.kind;
    const result = await this.alerts.alert({
      key,
      kind: body.kind,
      severity: body.severity ?? 'critical',
      title,
      detail: body.detail,
    });
    if (result.outcome === 'unconfigured' || result.outcome === 'failed') {
      throw new BusinessException(ERROR_CODE.OPS_ALERT_NOT_DELIVERED, HttpStatus.SERVICE_UNAVAILABLE, {
        outcome: [result.outcome],
      });
    }
    return { outcome: result.outcome, channels: result.channels };
  }
}
