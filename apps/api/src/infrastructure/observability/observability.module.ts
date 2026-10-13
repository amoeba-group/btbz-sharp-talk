import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiEngine } from '../../domain/ai-engine/entity/ai-engine.entity';
import { ErrorReporterService } from './error-reporter';
import { MetricsCollectorService } from './metrics-collector.service';
import { ObservabilityController } from './observability.controller';
import { OpsAlertService } from './ops-alert.service';
import { OpsWatchdogService } from './ops-watchdog.service';
import { weakOpsTokens } from './ops-token';
import { ReadinessService } from './readiness.service';

/**
 * Metrics, readiness, ops alerting and error tracking (PLN-261012 SG-83).
 *
 * Global so any module can inject `OpsAlertService` / `ErrorReporterService` without importing this one
 * (RetentionService and the exception filter do). Everything here defaults to inert: with no tokens
 * set `/metrics` and the hook are 404, with no alert targets alerts are logged only, with no error
 * sink nothing is reported.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AiEngine])],
  controllers: [ObservabilityController],
  providers: [OpsAlertService, ErrorReporterService, ReadinessService, OpsWatchdogService, MetricsCollectorService],
  exports: [OpsAlertService, ErrorReporterService, ReadinessService],
})
export class ObservabilityModule implements OnModuleInit {
  onModuleInit(): void {
    const weak = weakOpsTokens();
    if (weak.length) {
      new Logger('Observability').warn(`${weak.join(', ')} is shorter than 16 characters — use a long random token`);
    }
  }
}
