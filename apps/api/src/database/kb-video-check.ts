// Mark the process as a CLI before any module initialises: schedulers return early.
process.env.SHARPTALK_CLI = '1';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { closeAndExit } from './cli-exit';
import { KbVideoService } from '../domain/knowledge/kb-video.service';

/**
 * CLI entrypoint: `npm run kb:video-check` [-- --tenant <id>]
 * In a container: `node dist/database/kb-video-check.js --tenant 4`.
 * Probes every KB document's "Watch video" source (FIX-261023) — run it after
 * a Notion token swap or re-share. Exits 1 when any ref is broken/unavailable.
 */
async function main(): Promise<void> {
  const at = process.argv.indexOf('--tenant');
  const tenantId = at > -1 ? Number(process.argv[at + 1]) : undefined;
  if (tenantId !== undefined && !Number.isInteger(tenantId)) throw new Error('--tenant needs a numeric id');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { checked, problems } = await app.get(KbVideoService).checkRefs(tenantId);
    for (const p of problems) {
      console.log(`${p.reason}\tdoc=${p.docId}\t${p.externalKey ?? '-'}\t${p.videoRef}\t${p.detail}`);
    }
    console.log(`${problems.length ? '❌' : '✅'} KB video check: documents=${checked} problems=${problems.length}`);
    if (problems.length) process.exitCode = 1;
  } finally {
    await closeAndExit(app);
  }
}

main().catch((e) => {
  console.error('KB video check failed:', e);
  process.exit(1);
});
