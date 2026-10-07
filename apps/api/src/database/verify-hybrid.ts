// Mark the process as a CLI before any module initialises: schedulers return early.
process.env.SHARPTALK_CLI = '1';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RagService } from '../domain/chat/rag.service';
import { KnowledgeService } from '../domain/knowledge/knowledge.service';
import { QdrantService } from '../infrastructure/external/vector/qdrant.service';

/**
 * Manual smoke harness for the KB vector hybrid pipeline
 * (PLAN-KB-VectorHybrid-Qdrant W5; results: docs/test/T-KB-VectorHybrid-*.md).
 * Run against a live dev/staging stack (MySQL + Qdrant up, KB seeded):
 *   npx ts-node --files -r tsconfig-paths/register src/database/verify-hybrid.ts
 * Safe to re-run: the write-path test creates and deletes its own document.
 * With VOYAGE_API_KEY set, T1/T2 additionally exercise real cross-lingual
 * retrieval; keyless runs use the deterministic stub embeddings.
 */
const TENANT = 1;
const OTHER_TENANT = 99999;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const rag = app.get(RagService);
  const knowledge = app.get(KnowledgeService);
  const qdrant = app.get(QdrantService);
  const results: Array<{ id: string; pass: boolean; note: string }> = [];
  const check = (id: string, pass: boolean, note: string) => {
    results.push({ id, pass, note });
    console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${note}`);
  };

  // T1 — hybrid retrieval returns chunks with similarity populated
  const r1 = await rag.retrieve(TENANT, 'How long does shipping take?');
  check(
    'T1-hybrid-en',
    r1.length > 0 && r1.some((c) => c.similarity !== null),
    `chunks=${r1.length} top="${r1[0]?.title}" sim=${r1[0]?.similarity?.toFixed(3)}`,
  );

  // T2 — Korean query goes through the same pipeline (stub embeddings are
  // term-overlap only, so KO→EN semantic match is NOT expected here; this
  // verifies the KO tokenization + FULLTEXT leg + fusion mechanics).
  const r2 = await rag.retrieve(TENANT, '반품 정책 알려줘 returns');
  check('T2-ko-mixed', r2.length > 0, `chunks=${r2.length} top="${r2[0]?.title}"`);

  // T3 — snippet widened to 800 chars
  const longest = Math.max(...r1.map((c) => c.snippet.length));
  check('T3-snippet-800', longest > 400 && longest <= 800, `longest snippet=${longest}`);

  // T4a — stub mode preserves pre-hybrid (count-based) confidence behavior.
  // NOTE: off-topic Latin gibberish still FULLTEXT-matches via common ngram
  // bigrams — a known pre-existing ngram recall trait, unchanged by this work.
  const aOn = await rag.answer(TENANT, 'What is your refund timeline?', 'EN');
  check('T4a-stub-legacy-confidence', aOn.confidence >= 0.5, `on-topic=${aOn.confidence.toFixed(3)} (count-based)`);

  // T4b — calibrated (voyage) confidence mapping: above threshold → similarity,
  // below threshold → 0.2 (forces escalation). Exercises the real-key path
  // that can't run end-to-end without VOYAGE_API_KEY.
  const conf = (rag as any).confidence.bind(rag);
  const mk = (sim: number) => [{ id: 1, title: '', category: null, source: 'knowledge_store', snippet: '', similarity: sim }];
  const hi = conf(mk(0.72), 'voyage');
  const lo = conf(mk(0.31), 'voyage');
  const none = conf([], 'voyage');
  check(
    'T4b-calibrated-confidence',
    Math.abs(hi - 0.72) < 1e-9 && lo === 0.2 && none === 0.2,
    `sim0.72→${hi} sim0.31→${lo} empty→${none} (threshold=${process.env.RAG_MIN_SIMILARITY ?? '0.5'})`,
  );

  // T5 — tenant isolation: foreign tenant sees no tenant-1 documents
  const r5 = await rag.retrieve(OTHER_TENANT, 'How long does shipping take?');
  check('T5-tenant-isolation', r5.length === 0, `foreign-tenant chunks=${r5.length}`);

  // T6 — write path: create → searchable; deactivate → hidden; delete → gone
  const doc = await knowledge.createDocument(TENANT, {
    category: 'policy',
    title: 'Verify Hybrid Test Doc zebra-quokka',
    content: 'The zebra quokka verification document explains the flargle policy in detail.',
  } as any);
  const created = await qdrant.search(TENANT, await embedQuery(app, 'zebra quokka flargle'), 5);
  check('T6a-create-sync', created.some((h) => h.id === Number(doc.id)), `point found=${created.some((h) => h.id === Number(doc.id))} status=${doc.status}`);

  await knowledge.updateDocument(TENANT, Number(doc.id), { active: 0 } as any);
  // setActive is detached (fire-and-forget) — poll up to 3s for the payload flip.
  let hidden = false;
  for (let i = 0; i < 6 && !hidden; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const afterOff = await qdrant.search(TENANT, await embedQuery(app, 'zebra quokka flargle'), 5);
    hidden = !afterOff.some((h) => h.id === Number(doc.id));
  }
  check('T6b-deactivate', hidden, 'inactive doc excluded from vector search (eventual, ≤3s)');

  await knowledge.deleteDocument(TENANT, Number(doc.id));
  const afterDel = await qdrant.search(TENANT, await embedQuery(app, 'zebra quokka flargle'), 5);
  check('T6c-delete', !afterDel.some((h) => h.id === Number(doc.id)), 'deleted doc removed from Qdrant');

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await app.close();
  process.exit(failed ? 1 : 0);
}

async function embedQuery(app: any, text: string): Promise<number[]> {
  const { AiGatewayService } = await import('../infrastructure/external/ai/ai-gateway.service');
  const ai = app.get(AiGatewayService);
  return (await ai.embed([text], 'query')).vectors[0];
}

main().catch((e) => {
  console.error('verify failed:', e);
  process.exit(1);
});
