#!/usr/bin/env node
/**
 * One-off: set kb_documents.video_ref for go2joy's video-guide articles
 * (PLN-261006-KB-Video-Links P1) from reference/go2joy-hotel-admin-video-blocks.json.
 * The same data the converter now writes as a `video_ref` CSV column — this is
 * for a database whose articles were imported before that column existed.
 *
 * Usage: node scripts/go2joy-video-refs-sql.mjs <tenant_id> > out.sql
 * Re-runnable: it only sets values.
 */
import { readFileSync } from 'node:fs';

const tenantId = Number(process.argv[2]);
if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error('usage: go2joy-video-refs-sql.mjs <tenant_id>');
const { blocks } = JSON.parse(readFileSync('reference/go2joy-hotel-admin-video-blocks.json', 'utf8'));
const lines = ['-- go2joy video-guide articles → their Notion video block (PLN-261006-KB-Video-Links)'];
for (const b of blocks.filter((x) => x.video != null)) {
  if (!/^[0-9a-f]{32}$/.test(b.blockId)) throw new Error(`bad block id at position ${b.position}`);
  const n = String(b.video).padStart(2, '0');
  lines.push(
    `UPDATE kb_documents SET video_ref = 'notion:${b.blockId}' WHERE tenant_id = ${tenantId} AND external_key IN ('GTJ-VID-${n}-VI', 'GTJ-VID-${n}-EN');`,
  );
}
console.log(lines.join('\n'));
