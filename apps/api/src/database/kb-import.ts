import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { closeAndExit } from './cli-exit';
import { KbDocument } from '../domain/knowledge/entity/kb-document.entity';
import { KnowledgeService } from '../domain/knowledge/knowledge.service';
import { QdrantService } from '../infrastructure/external/vector/qdrant.service';

interface PolicyEntry {
  category: string;
  title: string;
  content: string;
}

/**
 * CLI entrypoint: `npm run kb:import` [-- --tenant=1] [--activate]
 * (AN-PolicyDoc-KB-Registration option A; data from docs parsing.)
 *
 * Imports the US-mall policy KB (data/kb-policy-{ko,en}.json, one row per
 * policy leaf section, KR+EN registered separately) idempotently keyed by
 * (tenant_id, title):
 *   - new titles are created with active=0 — imported docs stay INVISIBLE to
 *     the chatbot until reviewed (create-forces-active-1 gap workaround)
 *   - changed content/category updates the row and marks it for re-embedding
 *   - unchanged rows are skipped
 * Embeddings for pending rows are built at the end via reindexAll().
 *
 * `--activate` flips every title present in the data files to active=1 —
 * run it once after the review pass signs off.
 */
async function main(): Promise<void> {
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  const tenantId = Number(tenantArg?.split('=')[1] ?? '1');
  const activate = process.argv.includes('--activate');

  const entries: PolicyEntry[] = ['ko', 'en'].flatMap(
    (lang) =>
      JSON.parse(
        readFileSync(join(__dirname, 'data', `kb-policy-${lang}.json`), 'utf8'),
      ) as PolicyEntry[],
  );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const ds = app.get(DataSource);
    const repo = ds.getRepository(KbDocument);
    const knowledge = app.get(KnowledgeService);
    const qdrant = app.get(QdrantService);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let activated = 0;

    for (const entry of entries) {
      const existing = await repo.findOne({ where: { tenantId, title: entry.title } });
      if (!existing) {
        await repo.save(
          repo.create({
            tenantId,
            source: 'knowledge_store',
            sourceId: null,
            category: entry.category,
            title: entry.title,
            content: entry.content,
            active: 0, // review-gated: not retrievable until --activate
            status: 'pending',
            embeddingRef: null,
          }),
        );
        created++;
      } else if (existing.content !== entry.content || existing.category !== entry.category) {
        existing.content = entry.content;
        existing.category = entry.category;
        existing.status = 'pending'; // re-embed sweep picks it up
        await repo.save(existing);
        updated++;
      } else {
        skipped++;
      }

      if (activate) {
        const row = await repo.findOne({ where: { tenantId, title: entry.title } });
        if (row && row.active !== 1) {
          row.active = 1;
          await repo.save(row);
          if (qdrant.enabled) {
            await qdrant
              .setActive(Number(row.id), true)
              .catch((e) => console.warn(`qdrant setActive(${row.id}) failed: ${e.message}`));
          }
          activated++;
        }
      }
    }

    // Embed everything left pending (created + updated rows).
    const reindex = await knowledge.reindexAll();
    console.log(
      `✅ KB import complete (tenant=${tenantId}): entries=${entries.length} ` +
        `created=${created} updated=${updated} skipped=${skipped} activated=${activated} | ` +
        `embed scanned=${reindex.scanned} embedded=${reindex.embedded} failed=${reindex.failed}`,
    );
    if (!activate) {
      console.log('   Imported docs are active=0 (hidden). After review: npm run kb:import -- --activate');
    }
    if (reindex.failed > 0) process.exitCode = 1;
  } finally {
    await closeAndExit(app);
  }
}

main().catch((e) => {
  console.error('KB import failed:', e);
  process.exit(1);
});
