import { provinceKey } from '@sharptalk/types';

/**
 * Province Feed → the tenant's province → region map (PLN-261023 H1-a). Pure
 * functions so the merge rules are testable without a network or a database.
 */

/** Province Feed v2 item (fields we read). */
export interface PartnerProvince {
  sn: number;
  name?: string | null;
  code?: string | null;
  region?: number | null;
}

/**
 * Go2Joy region number → SharpTalk region code. The documented enum is 1–5;
 * the feed also carries numbers the document does not list (10 = the Metro
 * Manila cities, measured 2026-10-23), stored as `region_{n}` until Go2Joy
 * names them (PLN D1) — still a region a rule can match, just uncatalogued.
 */
const PARTNER_REGION: Readonly<Record<number, string>> = {
  1: 'south',
  2: 'north',
  3: 'central',
  4: 'north_center',
  5: 'south_center',
};

export function partnerRegionCode(region: unknown): string | null {
  const n = typeof region === 'number' ? region : Number(region);
  if (!Number.isInteger(n) || n <= 0) return null;
  return PARTNER_REGION[n] ?? `region_${n}`;
}

export interface ProvinceRegionMerge {
  map: Record<string, string>;
  /** Provinces the map did not have. */
  added: number;
  /** Provinces whose region (or spelling) the feed changed. */
  changed: number;
  /** Map entries the feed does not list — kept as they were (PLN D2). */
  kept: number;
  /** Feed provinces after dropping unusable rows. */
  total: number;
}

/**
 * Feed provinces override the same province in the current map (compared by
 * provinceKey; the feed's spelling, NFC, becomes the key); entries the feed
 * does not list stay. Rows without a name or a region are skipped.
 */
export function mergeProvinceRegions(
  current: Record<string, string> | null | undefined,
  feed: PartnerProvince[],
): ProvinceRegionMerge {
  const byKey = new Map<string, [string, string]>();
  for (const [name, region] of Object.entries(current ?? {})) {
    const key = provinceKey(name);
    if (key) byKey.set(key, [name, region]);
  }
  const fromFeed = new Map<string, [string, string]>();
  for (const p of feed) {
    const name = typeof p?.name === 'string' ? p.name.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
    const region = partnerRegionCode(p?.region);
    const key = provinceKey(name);
    if (!key || !region) continue;
    fromFeed.set(key, [name, region]);
  }
  let added = 0;
  let changed = 0;
  for (const [key, [name, region]] of fromFeed) {
    const before = byKey.get(key);
    if (!before) added += 1;
    else if (before[0] !== name || before[1] !== region) changed += 1;
  }
  const map: Record<string, string> = {};
  let kept = 0;
  for (const [key, entry] of byKey) {
    if (fromFeed.has(key)) continue;
    map[entry[0]] = entry[1];
    kept += 1;
  }
  for (const [name, region] of fromFeed.values()) map[name] = region;
  return { map, added, changed, kept, total: fromFeed.size };
}

/**
 * Province Feed → provinceSn index (HA identify spec v1.4, PLN-261024): the
 * HA signs Go2Joy's province number and SharpTalk reads the name and region
 * from here. The feed's numbers replace the same numbers in `current`;
 * numbers it no longer lists are kept. Rows without a number or a name are
 * skipped; a row without a region keeps its name with region null.
 */
export function mergeProvinceIndex(
  current: Record<string, { name: string; region: string | null }> | null | undefined,
  feed: PartnerProvince[],
): { index: Record<string, { name: string; region: string | null }>; total: number } {
  const index: Record<string, { name: string; region: string | null }> = { ...(current ?? {}) };
  let total = 0;
  for (const p of feed) {
    const sn = Number(p?.sn);
    const name = typeof p?.name === 'string' ? p.name.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
    if (!Number.isInteger(sn) || sn <= 0 || !name) continue;
    index[String(sn)] = { name, region: partnerRegionCode(p?.region) };
    total += 1;
  }
  return { index, total };
}
