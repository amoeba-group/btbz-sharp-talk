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
const ADMIN_PREFIXES = ['thanh pho', 'tinh', 'thu do', 'province', 'city of', 'city', 't p', 'tp'];
// Trailing words that name the kind of unit or the country, not the place:
// "Ho Chi Minh City", "Thanh Hoa Province", "Da Nang, Viet Nam".
const COUNTRY_SUFFIXES = [' viet nam', ' vietnam'];
const ADMIN_SUFFIXES = [' city', ' province'];

/**
 * Spelling variants of ONE place → the key they share. Keyed on the normalised
 * form (so "TP.HCM" is looked up as "hcm"), applied to BOTH the host's value and
 * every table entry — which keeps the match an exact comparison of two keys, never
 * a fuzzy guess. Only spellings of the same unit belong here; a merger ("Quảng
 * Nam" now being part of Đà Nẵng) is data in the province table, not an alias.
 */
const PROVINCE_ALIASES: ReadonlyMap<string, string> = new Map([
  // Capital and the big cities: joined spellings, English forms, old names.
  ['hanoi', 'ha noi'],
  ['hochiminh', 'ho chi minh'],
  ['hcm', 'ho chi minh'], // "TP.HCM" / "TP HCM" once the prefix is gone
  ['tphcm', 'ho chi minh'],
  ['hcmc', 'ho chi minh'],
  ['saigon', 'ho chi minh'],
  ['sai gon', 'ho chi minh'],
  ['danang', 'da nang'],
  ['haiphong', 'hai phong'],
  ['cantho', 'can tho'],
  // Huế: the province was "Thừa Thiên Huế", the city is "Huế", hosts say "TT Huế".
  ['hue', 'thua thien hue'],
  ['tt hue', 'thua thien hue'],
  // Đắk Lắk / Đắk Nông: the older "Đắc" and the joined spellings are all in use.
  ['dac lac', 'dak lak'],
  ['dak lac', 'dak lak'],
  ['dac lak', 'dak lak'],
  ['daklak', 'dak lak'],
  ['dac nong', 'dak nong'],
  ['daknong', 'dak nong'],
  ['kontum', 'kon tum'],
  // Bà Rịa - Vũng Tàu: abbreviation and run-together spellings.
  ['brvt', 'ba ria vung tau'],
  ['br vt', 'ba ria vung tau'],
  ['baria vungtau', 'ba ria vung tau'],
  ['baria vung tau', 'ba ria vung tau'],
]);

function dropSuffix(s: string, suffixes: readonly string[]): string {
  for (const suffix of suffixes) {
    // Never reduce a value to nothing: "Vietnam" alone stays "vietnam" (and misses).
    if (s.length > suffix.length && s.endsWith(suffix)) return s.slice(0, -suffix.length).trim();
  }
  return s;
}

/**
 * Province name → matching key: lower-case, no Vietnamese diacritics (đ → d, and
 * the legacy-encoded Ð U+00D0 too), no punctuation, no "tỉnh / thành phố / tp /
 * city" prefix, no " city" / " province" / ", Việt Nam" suffix, single spaces, and
 * known spelling variants folded together (see PROVINCE_ALIASES).
 * "TP. Hồ Chí Minh", "Thành phố Hồ Chí Minh", "HCMC", "Saigon" and
 * "Ho Chi Minh City, Vietnam" share one key. Codes ("HN", "79") pass through
 * unchanged apart from case.
 */
export function normalizeProvince(input: string | null | undefined): string {
  let s = String(input ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[đðɖ]/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  s = dropSuffix(s, COUNTRY_SUFFIXES);
  for (const prefix of ADMIN_PREFIXES) {
    if (s.startsWith(`${prefix} `)) {
      s = s.slice(prefix.length + 1).trim();
      break;
    }
  }
  s = dropSuffix(s, ADMIN_SUFFIXES);
  return PROVINCE_ALIASES.get(s) ?? s;
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
