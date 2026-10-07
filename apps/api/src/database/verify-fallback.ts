// Mark the process as a CLI before any module initialises: schedulers return early.
process.env.SHARPTALK_CLI = '1';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RagService } from '../domain/chat/rag.service';
import { KnowledgeService } from '../domain/knowledge/knowledge.service';

/**
 * Manual smoke harness — T7: Qdrant OUTAGE degradation
 * (PLAN-KB-VectorHybrid-Qdrant W5; results: docs/test/T-KB-VectorHybrid-*.md).
 * Stop Qdrant first (docker stop sharptalk_qdrant), then run:
 *   npx ts-node --files -r tsconfig-paths/register src/database/verify-fallback.ts
 * Expects retrieval/answers to degrade to FULLTEXT-only and KB writes to stay
 * accepted (status 'pending', swept by kb:reindex). Restart Qdrant afterwards.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const rag = app.get(RagService);
  const knowledge = app.get(KnowledgeService);

  const r = await rag.retrieve(1, 'How long does shipping take?');
  const a = await rag.answer(1, 'What is your refund timeline?', 'EN');
  console.log(`T7a retrieve-fallback: chunks=${r.length} sims=${r.every((c) => c.similarity === null)} → ${r.length > 0 ? 'PASS' : 'FAIL'}`);
  console.log(`T7b answer-fallback: confidence=${a.confidence.toFixed(3)} text=${a.text.length > 0} → ${a.confidence >= 0.5 && a.text.length > 0 ? 'PASS' : 'FAIL'}`);

  const doc = await knowledge.createDocument(1, { category: 'policy', title: 'Fallback Write Test xylophone-badger', content: 'temp' } as any);
  console.log(`T7c write-during-outage: status=${doc.status} (pending=retry scheduled) → ${doc.id ? 'PASS' : 'FAIL'}`);
  await knowledge.deleteDocument(1, Number(doc.id));
  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
