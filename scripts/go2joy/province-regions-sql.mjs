#!/usr/bin/env node
/**
 * Emit the SQL that stores a tenant's province → region map
 * (PLN-261022 stage 1, `handoff_config.provinceRegions`).
 *
 * The map is Go2Joy's own table (`Khu vực và Tỉnh_ Thành phố.xlsx`, 63
 * provinces; equal to the Partner API Province Feed on 2026-10-21), kept in
 * vn-province-regions.json next to this file. Only that one key is written —
 * every other handoff setting stays as it is.
 *
 *   node scripts/go2joy/province-regions-sql.mjs <tenant_id> > /tmp/pr.sql
 *   docker exec -i sharptalk_mysql_staging mysql --default-character-set=utf8mb4 -u… -p… db < /tmp/pr.sql
 *
 * Re-running is safe (the key is replaced). Rollback:
 *   UPDATE tenant_ai_config SET handoff_config = JSON_REMOVE(handoff_config, '$.provinceRegions') WHERE tenant_id = <id>;
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tenantId = Number(process.argv[2]);
if (!Number.isInteger(tenantId) || tenantId <= 0) {
  console.error('usage: province-regions-sql.mjs <tenant_id>');
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(fs.readFileSync(path.join(here, 'vn-province-regions.json'), 'utf8'));
const codes = new Set(['north', 'north_center', 'central', 'south_center', 'south']);
for (const [province, region] of Object.entries(map)) {
  if (!codes.has(region)) throw new Error(`unknown region '${region}' for ${province}`);
}
// NFC so the stored keys match what the API compares against.
const normalised = Object.fromEntries(Object.entries(map).map(([p, r]) => [p.normalize('NFC'), r]));
const json = JSON.stringify(normalised).replace(/\\/g, '\\\\').replace(/'/g, "''");
process.stdout.write(
  `-- province → region map (${Object.keys(normalised).length} provinces) for tenant ${tenantId}\n` +
    `UPDATE tenant_ai_config\n` +
    `   SET handoff_config = JSON_SET(COALESCE(handoff_config, JSON_OBJECT()), '$.provinceRegions', CAST('${json}' AS JSON))\n` +
    ` WHERE tenant_id = ${tenantId};\n`,
);
