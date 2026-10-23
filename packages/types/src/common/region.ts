/**
 * Routing regions (PLN-261022 stage 1).
 *
 * The Go2Joy Hotel Admin signs the hotel's region; its own province table
 * (`Khu vực và Tỉnh_ Thành phố.xlsx`, = Partner API Province Feed) puts the 63
 * Vietnamese provinces in four regions. The codes below are the canonical form
 * SharpTalk stores and routes on. A host may send the table's display text
 * ("North Center") or a legacy alias ("north_central"); `canonicalRegion`
 * folds every spelling to one code so a rule written once matches all of them.
 *
 * Browser bundles import this file directly (a value import from the package
 * root fails the Vite build), the same way language.ts is consumed.
 */
export const REGION_CODES = ['north', 'north_center', 'central', 'south_center', 'south'] as const;
export type RegionCode = (typeof REGION_CODES)[number];

/** Spellings that mean a catalogued code (Partner API docs say "North Central"). */
const REGION_ALIASES: Readonly<Record<string, RegionCode>> = {
  north_central: 'north_center',
  south_central: 'south_center',
  northcenter: 'north_center',
  southcenter: 'south_center',
};

/**
 * One region value in canonical form: trimmed, lower-case, spaces/hyphens as
 * `_`, aliases folded. An uncatalogued value is returned in the same folded
 * form (not dropped) so a rule an operator wrote for it can still match.
 * Empty / non-string → ''.
 */
export function canonicalRegion(value: unknown): string {
  if (typeof value !== 'string') return '';
  const folded = value.normalize('NFC').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return REGION_ALIASES[folded] ?? folded;
}

export function isRegionCode(value: unknown): value is RegionCode {
  return (REGION_CODES as readonly string[]).includes(String(value));
}

/**
 * A value that names a region at all: a catalogued code, or `region_{n}` — a
 * Go2Joy region number the Partner API documents no name for (PLN-261023 D1).
 * Anything else in a region field is not a region (HA has sent province
 * names there).
 */
export function isRegionValue(value: unknown): boolean {
  return isRegionCode(value) || /^region_\d+$/.test(String(value));
}

/**
 * Comparison key for a province name: NFC (Vietnamese tone marks arrive both
 * composed and decomposed), whitespace collapsed, lower-case. Used for both
 * the stored scope and the session value, so "Hồ Chí Minh" in either form and
 * any case is the same province.
 */
export function provinceKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}
