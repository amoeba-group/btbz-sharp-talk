// Mark the process as a CLI before any module initialises: schedulers return early.
process.env.SHARPTALK_CLI = '1';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { closeAndExit } from './cli-exit';
import { KnowledgeService } from '../domain/knowledge/knowledge.service';

/**
 * CLI entrypoint: `npm run kb:reindex` [-- --force]
 * Rebuilds the Qdrant vector index from MySQL (PLAN-KB-VectorHybrid-Qdrant W3).
 * Default: embeds pending docs + docs whose embedding_model differs from the
 * current embedder. --force re-embeds everything (use after a model change or
 * a wiped Qdrant volume).
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const knowledge = app.get(KnowledgeService);
    const result = await knowledge.reindexAll({ force });
    console.log(
      `✅ KB reindex complete (force=${force}): scanned=${result.scanned} embedded=${result.embedded} failed=${result.failed}`,
    );
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await closeAndExit(app);
  }
}

main().catch((e) => {
  console.error('KB reindex failed:', e);
  process.exit(1);
});
