#!/usr/bin/env node
/**
 * Emit the SQL that stores a tenant's province maps from the Go2Joy Province
 * Feed snapshot (province-feed-snapshot.json, 80 rows) — for a server that has
 * no Partner API credential yet (HA identify spec v1.4, PLN-261024 D2). With a
 * credential, Settings › Integrations › Go2Joy Partner [Update region map]
 * does the same from the live feed.
 *
 * Writes two keys of handoff_config and nothing else:
 *   provinceIndex   { "<provinceSn>": { name, region } }   — what `province_sn` resolves to
 *   provinceRegions { "<name>": region }                   — the name map (v1.3 senders, rules)
 *
 *   node scripts/go2joy/province-index-sql.mjs <tenant_id> > /tmp/pi.sql
 *   docker exec -i <mysql container> mysql --default-character-set=utf8mb4 -u… -p… <db> < /tmp/pi.sql
 *
 * Re-running is safe (both keys are replaced; other handoff keys are kept).
 * Rollback:
 *   UPDATE tenant_ai_config SET handoff_config = JSON_REMOVE(handoff_config, '$.provinceIndex') WHERE tenant_id = <id>;
 * (provinceRegions: re-run province-regions-sql.mjs for the 63-province table.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tenantId = Number(process.argv[2]);
if (!Number.isInteger(tenantId) || tenantId <= 0) {
  console.error('usage: province-index-sql.mjs <tenant_id>');
  process.exit(1);
}
// Same table as apps/api/src/domain/go2joy/province-region.mapper.ts partnerRegionCode.
const REGION = { 1: 'south', 2: 'north', 3: 'central', 4: 'north_center', 5: 'south_center' };
const regionCode = (n) => (Number.isInteger(n) && n > 0 ? (REGION[n] ?? `region_${n}`) : null);

const here = path.dirname(fileURLToPath(import.meta.url));
const { rows } = JSON.parse(fs.readFileSync(path.join(here, 'province-feed-snapshot.json'), 'utf8'));
const index = {};
const names = {};
for (const r of rows) {
  const name = String(r.name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!Number.isInteger(r.sn) || r.sn <= 0 || !name) continue;
  const region = regionCode(r.region);
  index[String(r.sn)] = { name, region };
  if (region) names[name] = region;
}
const lit = (v) => JSON.stringify(v).replace(/\\/g, '\\\\').replace(/'/g, "''");
process.stdout.write(
  `-- Go2Joy province maps (${Object.keys(index).length} numbers, ${Object.keys(names).length} names) for tenant ${tenantId}\n` +
    `UPDATE tenant_ai_config\n` +
    `   SET handoff_config = JSON_SET(COALESCE(handoff_config, JSON_OBJECT()),\n` +
    `         '$.provinceIndex', CAST('${lit(index)}' AS JSON),\n` +
    `         '$.provinceRegions', CAST('${lit(names)}' AS JSON))\n` +
    ` WHERE tenant_id = ${tenantId};\n`,
);
