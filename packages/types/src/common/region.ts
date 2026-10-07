import type { UserRegion } from './enum.types';
import type { LocalizedText } from './language';

/**
 * Hotel region routing (PLN-261007-Hotel-Region-Routing).
 *
 * A hotel belongs to one of four regional categories; each category is looked
 * after by one of the two support teams (`UserRegion`: north | south — the same
 * values a tenant user carries in `users.region`). The province → category table
 * is tenant configuration, so the console and the API resolve a province with
 * THE SAME function — kept here, dependency-free, because the browser bundles
 * deep-import this source file (a value import from the package entry fails the
 * build, see language.ts).
 */

export const REGION_CATEGORY = {
  NORTH: 'north',
  NORTH_CENTRAL: 'north_central',
  SOUTH_CENTRAL: 'south_central',
  SOUTH: 'south',
} as const;
export type RegionCategory = (typeof REGION_CATEGORY)[keyof typeof REGION_CATEGORY];

export const REGION_CATEGORIES: readonly RegionCategory[] = [
  REGION_CATEGORY.NORTH,
  REGION_CATEGORY.NORTH_CENTRAL,
  REGION_CATEGORY.SOUTH_CENTRAL,
  REGION_CATEGORY.SOUTH,
];

/** The team that looks after each category unless the tenant says otherwise. */
export const REGION_CATEGORY_DEFAULT_TEAM: Record<RegionCategory, UserRegion> = {
  north: 'north',
  north_central: 'north',
  south_central: 'south',
  south: 'south',
};

/** One category row of `handoff_config.regionRouting`. */
export interface RegionCategoryRule {
  id: RegionCategory;
  /** Team that takes the conversation — a `users.region` value. */
  team: UserRegion;
  /** Per-language display name; blank falls back to the built-in name. */
  label?: LocalizedText;
  /** Province names or codes as the host sends them; matched after normalisation. */
  provinces: string[];
}

export interface RegionRoutingConfig {
  enabled: boolean;
  categories?: RegionCategoryRule[];
}

/** What a province resolved to. */
export interface HotelRegion {
  category: RegionCategory;
  team: UserRegion;
}

/** Built-in English names — the console and alerts use them when a tenant set no label. */
export const REGION_CATEGORY_NAME: Record<RegionCategory, string> = {
  north: 'North',
  north_central: 'North Central',
  south_central: 'South Central',
  south: 'South',
};

const COMBINING_MARKS = /[̀-ͯ]/g;
// Longest first, each followed by a space so a province that merely STARTS with
// the letters ("Thanh Hoa") is never clipped.
const ADMIN_PREFIXES = ['thanh pho', 'tinh', 'thu do', 'province', 'city', 'tp'];

/**
 * Province name → matching key: lower-case, no Vietnamese diacritics (đ → d),
 * no punctuation, no "tỉnh / thành phố / tp" prefix, single spaces.
 * "TP. Hồ Chí Minh", "Thành phố Hồ Chí Minh" and "ho chi minh" share one key.
 * Codes ("HN", "79") pass through unchanged apart from case.
 */
export function normalizeProvince(input: string | null | undefined): string {
  let s = String(input ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (const prefix of ADMIN_PREFIXES) {
    if (s.startsWith(`${prefix} `)) {
      s = s.slice(prefix.length + 1).trim();
      break;
    }
  }
  return s;
}

function categoryTeam(rule: RegionCategoryRule): UserRegion {
  return rule.team === 'north' || rule.team === 'south' ? rule.team : REGION_CATEGORY_DEFAULT_TEAM[rule.id];
}

/**
 * The category (and team) a province belongs to, or null when region routing is
 * off, the province is blank, or the table does not list it. First matching
 * category wins, in table order, so a duplicated entry never changes behaviour
 * between calls — `duplicateProvinces` is what tells the console about it.
 */
export function resolveHotelRegion(
  config: RegionRoutingConfig | null | undefined,
  province: string | null | undefined,
): HotelRegion | null {
  if (!config?.enabled) return null;
  const key = normalizeProvince(province);
  if (!key) return null;
  for (const rule of config.categories ?? []) {
    if (!REGION_CATEGORIES.includes(rule?.id)) continue;
    if ((rule.provinces ?? []).some((p) => normalizeProvince(p) === key)) {
      return { category: rule.id, team: categoryTeam(rule) };
    }
  }
  return null;
}

/** Provinces listed under more than one category (normalised keys), for the console warning. */
export function duplicateProvinces(config: RegionRoutingConfig | null | undefined): string[] {
  const seen = new Map<string, RegionCategory>();
  const dup = new Set<string>();
  for (const rule of config?.categories ?? []) {
    for (const p of rule?.provinces ?? []) {
      const key = normalizeProvince(p);
      if (!key) continue;
      const first = seen.get(key);
      if (first && first !== rule.id) dup.add(key);
      else if (!first) seen.set(key, rule.id);
    }
  }
  return [...dup];
}

/**
 * One-line region description for alert channels and the queue badge title,
 * e.g. "South (South Central)". `categoryName` lets the caller supply a
 * localised name; the English built-in is the fallback.
 */
export function regionLabelOf(region: HotelRegion, categoryName?: string): string {
  const team = region.team === 'north' ? 'North' : 'South';
  const category = categoryName?.trim() || REGION_CATEGORY_NAME[region.category];
  return category === team ? team : `${team} (${category})`;
}
