// Mark the process as a CLI before any module initialises: schedulers return early.
process.env.SHARPTALK_CLI = '1';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { GoldenService } from '../domain/ai-coach/golden.service';
import { GOLDEN_RUN_KIND } from '../domain/ai-coach/entity/golden-run.entity';
import { GateResult, gateFailed, gateMail, parseGateTargets } from '../domain/ai-coach/golden-gate.util';
import { MailerService } from '../infrastructure/external/mailer.service';
import { closeAndExit } from './cli-exit';

/**
 * CLI: `npm run golden:gate` (PLN-261008). Runs each `GOLDEN_GATE` target's
 * graded regression set on the code that was just deployed, compares with the
 * previous run, and mails `AI_ALERT_EMAIL ?? dev@amoeba.group` when anything
 * failed. Exit code 1 on failure (for the log only — the deploy script runs
 * this in the background and never rolls back).
 */
async function main(): Promise<void> {
  const targets = parseGateTargets(process.env.GOLDEN_GATE);
  if (!targets.length) {
    console.log('golden gate: off (GOLDEN_GATE empty)');
    return;
  }
  const label = process.env.GATE_LABEL?.trim() || new Date().toISOString().slice(0, 16);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const golden = app.get(GoldenService);
  const results: GateResult[] = [];
  for (const t of targets) {
    const previous = (await golden.listRuns(t.tenantId, 20)).find(
      (r) => r.status === 'done' && (r.aiAgentId ?? null) === t.aiAgentId,
    );
    const run = await golden.run(t.tenantId, null as unknown as number, GOLDEN_RUN_KIND.MANUAL, {
      aiAgentId: t.aiAgentId,
      label: `deploy gate ${label}`,
    });
    const { items } = await golden.getRun(t.tenantId, Number(run.id));
    const regressed = previous
      ? (await golden.compare(t.tenantId, Number(previous.id), Number(run.id))).items
          .filter((i) => i.regressed)
          .map((i) => i.question)
      : [];
    results.push({
      tenantId: t.tenantId,
      aiAgentId: t.aiAgentId,
      runId: Number(run.id),
      pass: run.passCount,
      fail: run.failCount,
      total: run.questionCount,
      failed: items
        .filter((i) => i.verdict === 'fail')
        .map((i) => ({ question: i.question, checks: i.failedChecks ?? (i.error ? ['error'] : []) })),
      regressed,
    });
  }
  for (const r of results) {
    console.log(`golden gate: tenant ${r.tenantId} run #${r.runId} pass=${r.pass} fail=${r.fail} regressed=${r.regressed.length}`);
  }
  if (results.some(gateFailed)) {
    const mail = gateMail(results, process.env.NODE_ENV || 'development', label);
    const sent = await app.get(MailerService).send({ to: process.env.AI_ALERT_EMAIL?.trim() || 'dev@amoeba.group', ...mail });
    console.log(`golden gate: FAILED — alert ${sent ? 'mailed' : 'NOT mailed'}`);
    process.exitCode = 1;
  } else {
    console.log('golden gate: passed');
  }
  await closeAndExit(app);
}

main().catch((e) => {
  console.error('golden gate failed to run:', e);
  process.exit(1);
});
