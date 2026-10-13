// Mark the process as a CLI before any module initialises: schedulers return early.
process.env.SHARPTALK_CLI = '1';
import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../app.module';
import { GoldenService } from '../domain/ai-coach/golden.service';
import { sanitizeAudience, sanitizeExpectGate } from '../domain/ai-coach/golden-gate-grade.util';
import { GateSimulatorService } from '../domain/knowledge/gate-simulator.service';
import { RagService } from '../domain/chat/rag.service';
import { GUEST_GATE_CONFIDENCE } from '../domain/chat/gate-decision';
import { parseLabelledCsv } from '../domain/chat/gate-calibration.util';
import type { LabelledItem } from '../domain/chat/gate-calibration.util';
import { QdrantService } from '../infrastructure/external/vector/qdrant.service';
import { parseCalibrateArgs, runCalibration } from './gate-calibrate.core';
import type { CalibrateArgs } from './gate-calibrate.core';
import { closeAndExit } from './cli-exit';

/**
 * CLI: `npm run gate:calibrate` (PLN-261012 SG-51, REQ D-16) — measure the guest gate on a labelled
 * question set and recommend `GUEST_GATE_CONFIDENCE`.
 *
 *   npm run gate:calibrate -- [--tenant=1] [--agent=ID] [--file=reference/go2joy-gate-calibration-set.csv]
 *                             [--from=0.45 --to=0.95 --step=0.05] [--json=out.json] [--delay-ms=0]
 *
 * The labelled set is, by default, the tenant's active golden questions that have both an `audience`
 * and an `expect_gate`; `--file` takes a CSV `question,audience,expect` instead (the starter set is
 * reference/go2joy-gate-calibration-set.csv — DRAFT labels, to be reviewed by Go2Joy ops).
 *
 * It needs REAL Voyage embeddings and a populated Qdrant to mean anything. With the stub embedder (or a
 * degraded vector leg) it prints a loud NOT MEANINGFUL banner and exits 3 — see gate-calibrate.core.ts
 * for the exit codes (0 ok · 1 could not run · 2 no leak-free bar · 3 not meaningful).
 */
/**
 * `npm run --workspace` runs this in apps/api, so a relative path the operator typed at the repo root
 * would silently point somewhere else; npm records where it was invoked in INIT_CWD.
 */
const fromCwd = (p: string): string => resolve(process.env.INIT_CWD ?? process.cwd(), p);

async function loadItems(
  app: INestApplicationContext,
  args: CalibrateArgs,
): Promise<{ items: LabelledItem[]; source: 'csv' | 'golden' } | null> {
  if (args.file) {
    const parsed = parseLabelledCsv(readFileSync(fromCwd(args.file), 'utf8'));
    if (parsed.errors.length) {
      // A mislabelled row would silently skew the recommendation: refuse to run on a bad file.
      console.error(`gate:calibrate: ${args.file} has ${parsed.errors.length} bad row(s):`);
      for (const e of parsed.errors) console.error(`  - ${e}`);
      return null;
    }
    if (!parsed.items.length) {
      console.error('gate:calibrate: the file holds no labelled question.');
      return null;
    }
    return { items: parsed.items, source: 'csv' };
  }
  const golden = app.get(GoldenService, { strict: false });
  const rows = (await golden.listQuestions(args.tenantId)).filter((q) => q.active === 1);
  const items = rows.flatMap((q) => {
    const audience = sanitizeAudience(q.audience);
    const expect = sanitizeExpectGate(q.expectGate);
    return audience && expect ? [{ question: q.question, audience, expect, language: q.language }] : [];
  });
  if (!items.length) {
    console.error(
      `gate:calibrate: tenant ${args.tenantId} has no active golden question with both an audience and an expect_gate — add some in Console > AI settings > Regression set, or pass --file.`,
    );
    return null;
  }
  return { items, source: 'golden' };
}

async function calibrate(app: INestApplicationContext, args: CalibrateArgs): Promise<number> {
  const loaded = await loadItems(app, args);
  if (!loaded) return 1;

  const simulator = app.get(GateSimulatorService, { strict: false });
  const rag = app.get(RagService, { strict: false });
  const qdrant = app.get(QdrantService, { strict: false });
  const agentId = await rag.effectiveAgentId(args.tenantId, args.agentId);
  const guestPolicy = await rag.agentGuestPolicy(args.tenantId, agentId).catch(() => null);

  const run = await runCalibration({
    items: loaded.items,
    // A guest is measured AS IF the agent were login_guidance: the point is to choose the bar BEFORE an
    // operator switches the policy on.
    measure: async (item) =>
      (
        await simulator.decide(
          args.tenantId,
          { question: item.question, as: item.audience, aiAgentId: args.agentId },
          { assumeGuestPolicy: 'login_guidance' },
        )
      ).decision,
    args,
    context: {
      tenantId: args.tenantId,
      agentId,
      source: loaded.source,
      guestPolicy,
      voyageKeySet: !!process.env.VOYAGE_API_KEY,
      qdrantEnabled: !!qdrant.enabled,
      currentThreshold: GUEST_GATE_CONFIDENCE,
    },
    onProgress: (done, total) => process.stderr.write(`\r  measured ${done}/${total}`),
  });
  process.stderr.write('\n');
  console.log(run.text);
  if (args.json) {
    const target = fromCwd(args.json);
    writeFileSync(target, `${JSON.stringify(run.json, null, 2)}\n`, 'utf8');
    console.log(`\nJSON written to ${target}`);
  }
  return run.exitCode;
}

async function main(): Promise<void> {
  const args = parseCalibrateArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(`gate:calibrate: ${args.error}`);
    console.error(
      'usage: npm run gate:calibrate -- [--tenant=1] [--agent=ID] [--file=PATH] [--from=0.45 --to=0.95 --step=0.05] [--json=PATH] [--delay-ms=N]',
    );
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  let code = 1;
  try {
    code = await calibrate(app, args);
  } catch (e) {
    console.error('gate:calibrate failed to run:', e);
  }
  await closeAndExit(app, code);
}

main().catch((e) => {
  console.error('gate:calibrate failed to start:', e);
  process.exit(1);
});
