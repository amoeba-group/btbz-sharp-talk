import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { canonicalRegion, isRegionValue } from '@sharptalk/types';
import { Company } from '../domain/company/entity/company.entity';
import { TenantAiConfig } from '../domain/ai-engine/entity/tenant-ai-config.entity';
import { regionForProvince } from '../domain/embed/identity-attributes';
import { envNumber } from '../global/util/env-number.util';

/**
 * One-time backfill for PLN-261023 H1-c: companies whose region is empty, or
 * holds something that is not a region (HA sent province names there), take
 * the region the tenant's province map gives — read from the company's
 * province, else from the bad region value itself read as a province (H1-b).
 * Companies the map cannot place are listed and left alone. Sessions are not
 * touched (their history stays as recorded).
 *
 * Dry run unless --apply. Run inside the API container:
 *   node apps/api/dist/database/backfill-company-regions.js [--apply]
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: envNumber('DB_PORT', 3306),
    username: process.env.DB_USER ?? 'sharptalk',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'db_sharptalk',
    charset: 'utf8mb4',
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    synchronize: false,
  });
  await ds.initialize();
  const companies = ds.getRepository(Company);
  const configs = ds.getRepository(TenantAiConfig);
  const tag = apply ? '' : '[dry-run] ';
  let fixed = 0;
  let unplaced = 0;
  try {
    const maps = new Map<number, Record<string, string> | null>();
    for (const c of await companies.find()) {
      if (c.region && isRegionValue(c.region)) continue;
      const tenantId = Number(c.tenantId);
      if (!maps.has(tenantId)) {
        const cfg = await configs.findOne({ where: { tenantId } });
        maps.set(tenantId, cfg?.handoffConfig?.provinceRegions ?? null);
      }
      const map = maps.get(tenantId);
      const asProvince = c.region ? canonicalRegion(c.region).replace(/_/g, ' ') : null;
      const region = regionForProvince(c.province, map) ?? regionForProvince(asProvince, map);
      if (!region) {
        unplaced += 1;
        console.log(`${tag}company ${c.id} (tenant ${tenantId}, ${c.externalKey}): province '${c.province ?? ''}' region '${c.region ?? ''}' — not in the map, left`);
        continue;
      }
      console.log(`${tag}company ${c.id} (tenant ${tenantId}, ${c.externalKey}): region '${c.region ?? ''}' → '${region}'`);
      fixed += 1;
      if (apply) await companies.update({ id: c.id }, { region });
    }
    console.log(`\n${tag}done — ${fixed} compan${fixed === 1 ? 'y' : 'ies'} ${apply ? 'updated' : 'to update'}, ${unplaced} not placeable`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
