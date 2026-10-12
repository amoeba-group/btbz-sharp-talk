import { REGION_CATEGORIES, REGION_CATEGORY_DEFAULT_TEAM } from './region';
import type { RegionCategory, RegionCategoryRule } from './region';

/**
 * Vietnam province preset for hotel region routing (PLN-261012 SG-61, REQ D-14).
 *
 * The province → category table is tenant configuration and used to ship empty,
 * so nothing resolved until someone typed 63 names. This is the ready-made table
 * the console loads on request. Dependency-free like region.ts: the browser
 * bundles deep-import this source file.
 *
 * TWO NAMINGS ARE LISTED ON PURPOSE. From 2025-07-01 Vietnam went from 63 to 34
 * provincial units (Resolution 202/2025/QH15). Hotel hosts do not all switch at
 * once, so a hotel in Bình Dương may be sent as "Bình Dương" (old) or as
 * "TP. Hồ Chí Minh" (new). Every unit therefore carries its post-merger name,
 * the pre-merger names it absorbed (`formerly`) and common spellings (`aka`);
 * the preset lists all of them under the one category.
 *
 * CATEGORY DEFINITION (Go2Joy): the regions are four, by coast and highlands —
 *   north          Bắc Bộ: Red River delta, north-east and north-west
 *   north_central  Bắc Trung Bộ: ENDS AT HUẾ — Thanh Hóa, Nghệ An, Hà Tĩnh,
 *                  Quảng Trị (with Quảng Bình) and Huế (Thừa Thiên Huế)
 *   south_central  Nam Trung Bộ + Tây Nguyên: Đà Nẵng and everything south of the
 *                  Hải Vân pass down to Lâm Đồng, Khánh Hòa; the Central Highlands
 *   south          Đông Nam Bộ + Đồng bằng sông Cửu Long: HCMC and the south-east,
 *                  the Mekong delta
 * Teams: north + north_central → "north"; south_central + south → "south"
 * (REGION_CATEGORY_DEFAULT_TEAM). Tây Nguyên, Đông Nam Bộ and ĐBSCL are therefore
 * not categories of their own — they are provinces filed under these four.
 *
 * MERGED UNITS NEVER STRADDLE A CATEGORY. The new units that absorbed neighbours
 * were checked one by one: every merger below joins provinces of the SAME
 * category. In particular nothing crosses the Huế | Đà Nẵng line — Huế stayed a
 * unit of its own, Quảng Bình merged north into Quảng Trị, Quảng Nam merged south
 * into Đà Nẵng. Where a merger joins the coast to the highlands (Quảng Ngãi + Kon
 * Tum, Gia Lai + Bình Định, Đắk Lắk + Phú Yên, Lâm Đồng + Đắk Nông + Bình Thuận)
 * both halves are south_central here, and in any case both south categories are
 * handled by the same team. region-vn.spec.ts holds the invariant.
 */

/** One post-merger unit with the names that must all resolve to it. */
export interface VnProvinceUnit {
  /** Name since 2025-07-01. */
  name: string;
  /** Pre-merger names: provinces absorbed into this unit, or its own earlier name. */
  formerly?: readonly string[];
  /** Other spellings hosts commonly send. Case, diacritics and "TP./Tỉnh" prefixes are matched anyway. */
  aka?: readonly string[];
}

export const VN_PROVINCE_UNITS: Readonly<Record<RegionCategory, readonly VnProvinceUnit[]>> = {
  north: [
    { name: 'Hà Nội', aka: ['Hanoi'] },
    { name: 'Hải Phòng', formerly: ['Hải Dương'] },
    { name: 'Quảng Ninh' },
    { name: 'Bắc Ninh', formerly: ['Bắc Giang'] },
    { name: 'Hưng Yên', formerly: ['Thái Bình'] },
    { name: 'Ninh Bình', formerly: ['Hà Nam', 'Nam Định'] },
    { name: 'Phú Thọ', formerly: ['Vĩnh Phúc', 'Hòa Bình'] },
    { name: 'Thái Nguyên', formerly: ['Bắc Kạn'] },
    { name: 'Tuyên Quang', formerly: ['Hà Giang'] },
    { name: 'Lào Cai', formerly: ['Yên Bái'] },
    { name: 'Cao Bằng' },
    { name: 'Lạng Sơn' },
    { name: 'Lai Châu' },
    { name: 'Điện Biên' },
    { name: 'Sơn La' },
  ],
  north_central: [
    { name: 'Thanh Hóa' },
    { name: 'Nghệ An' },
    { name: 'Hà Tĩnh' },
    { name: 'Quảng Trị', formerly: ['Quảng Bình'] },
    { name: 'Huế', formerly: ['Thừa Thiên Huế'], aka: ['TT Huế'] },
  ],
  south_central: [
    { name: 'Đà Nẵng', formerly: ['Quảng Nam'] },
    { name: 'Quảng Ngãi', formerly: ['Kon Tum'] },
    { name: 'Gia Lai', formerly: ['Bình Định'] },
    { name: 'Đắk Lắk', formerly: ['Phú Yên'] },
    { name: 'Khánh Hòa', formerly: ['Ninh Thuận'] },
    { name: 'Lâm Đồng', formerly: ['Đắk Nông', 'Bình Thuận'] },
  ],
  south: [
    {
      name: 'TP. Hồ Chí Minh',
      formerly: ['Bình Dương', 'Bà Rịa - Vũng Tàu'],
      aka: ['TP.HCM', 'TPHCM', 'HCMC', 'Sài Gòn', 'Saigon'],
    },
    { name: 'Đồng Nai', formerly: ['Bình Phước'] },
    { name: 'Tây Ninh', formerly: ['Long An'] },
    { name: 'Cần Thơ', formerly: ['Sóc Trăng', 'Hậu Giang'] },
    { name: 'Vĩnh Long', formerly: ['Bến Tre', 'Trà Vinh'] },
    { name: 'Đồng Tháp', formerly: ['Tiền Giang'] },
    { name: 'Cà Mau', formerly: ['Bạc Liêu'] },
    { name: 'An Giang', formerly: ['Kiên Giang'] },
  ],
};

/** Every name of a unit, post-merger name first, without exact repeats. */
function unitNames(unit: VnProvinceUnit): string[] {
  return [...new Set([unit.name, ...(unit.formerly ?? []), ...(unit.aka ?? [])])];
}

/** Category → every province name the preset lists under it (old, new and aliases). */
export const VN_REGION_PRESET: Readonly<Record<RegionCategory, readonly string[]>> = {
  north: VN_PROVINCE_UNITS.north.flatMap(unitNames),
  north_central: VN_PROVINCE_UNITS.north_central.flatMap(unitNames),
  south_central: VN_PROVINCE_UNITS.south_central.flatMap(unitNames),
  south: VN_PROVINCE_UNITS.south.flatMap(unitNames),
};

/**
 * The preset as `handoff_config.regionRouting.categories` rows: each category with
 * its default team and the full province list. Fresh arrays every call, so a
 * caller can edit the result without touching the preset.
 */
export function vnRegionPresetRules(): RegionCategoryRule[] {
  return REGION_CATEGORIES.map((id) => ({
    id,
    team: REGION_CATEGORY_DEFAULT_TEAM[id],
    provinces: [...VN_REGION_PRESET[id]],
  }));
}
