// Mark the process as a CLI before any module initialises: schedulers return early.
process.env.SHARPTALK_CLI = '1';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { GoldenService } from '../domain/ai-coach/golden.service';
import { GOLDEN_RUN_KIND } from '../domain/ai-coach/entity/golden-run.entity';
import { GateResult, gateFailed, gateMail, parseGateTargets } from '../domain/ai-coach/golden-gate.util';
import { MailerService } from '../infrastructure/external/mailer.service';
import { OpsAlertService } from '../infrastructure/observability/ops-alert.service';
import { resolveAlertRecipient } from '../infrastructure/external/alert-address.util';
import { closeAndExit } from './cli-exit';

/**
 * CLI: `npm run golden:gate` (PLN-261008). Runs each `GOLDEN_GATE` target's
 * graded regression set on the code that was just deployed, compares with the
 * previous run, and mails `AI_ALERT_EMAIL ?? ALERT_EMAIL_TO` when anything
 * failed (no Amoeba default since PLN-261012 SG-80 — unset means the failure is
 * only in the log and the exit code). Exit code 1 on failure (for the log only — the deploy script runs
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
    const to = resolveAlertRecipient(process.env);
    const sent = to ? await app.get(MailerService).send({ to, ...mail }) : false;
    console.log(
      `golden gate: FAILED — alert ${sent ? 'mailed' : to ? 'NOT mailed' : 'NOT mailed (AI_ALERT_EMAIL / ALERT_EMAIL_TO not set)'}`,
    );
    // The generic ops channel as well (PLN-261012 SG-83): OPS_ALERT_EMAIL / OPS_ALERT_WEBHOOK_URL, no built-in recipient.
    const failedCount = results.filter(gateFailed).length;
    const ops = await app.get(OpsAlertService).alert({
      key: 'golden_gate_failed',
      kind: 'golden_gate_failed',
      severity: 'warning',
      title: 'Post-deploy answer-quality gate failed',
      detail: `${failedCount} of ${results.length} gate target(s) regressed or failed after deploy ${label}. See the golden run in the console.`,
    });
    console.log(`golden gate: ops alert ${ops.outcome}`);
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
