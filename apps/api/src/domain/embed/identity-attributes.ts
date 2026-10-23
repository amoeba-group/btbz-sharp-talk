import { canonicalRegion, isRegionValue, provinceKey } from '@sharptalk/types';

/**
 * Signed identity attributes (PLN-261015 D2).
 *
 * A host application that knows more about its signed-in user than an id — the
 * Go2Joy Hotel Admin knows the hotel, its region and the staff member's role —
 * can sign those facts together with the id. Unlike the profile fields
 * (name/email/phone), these drive decisions: the region picks which human agent
 * a handoff goes to (D3). So they are accepted ONLY when signed, and only from a
 * fixed list; anything else is dropped rather than stored.
 */
export const IDENTITY_ATTRIBUTE_KEYS = ['hotel_id', 'hotel_name', 'region', 'province', 'province_sn', 'role'] as const;
export type IdentityAttributeKey = (typeof IDENTITY_ATTRIBUTE_KEYS)[number];
export type IdentityAttributes = Partial<Record<IdentityAttributeKey, string>>;

export const IDENTITY_ATTRIBUTE_MAX_LENGTH = 120;

/**
 * Keep the allow-listed keys with a usable string value; trim, drop empties.
 * Returns null when nothing survives, so "no attributes" has one shape.
 */
export function normalizeIdentityAttributes(raw: unknown): IdentityAttributes | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: IdentityAttributes = {};
  for (const key of IDENTITY_ATTRIBUTE_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value).trim();
    if (!text || text.length > IDENTITY_ATTRIBUTE_MAX_LENGTH || /[\r\n]/.test(text)) continue;
    // Go2Joy provinceSn (spec v1.4): a number or nothing. Dropped, it is left
    // out of the signing string, so a malformed one shows up as a 401.
    if (key === 'province_sn' && !/^\d{1,10}$/.test(text)) continue;
    out[key] = text;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The exact string the host server signs.
 *
 *   no attributes   → `userId`                       (unchanged, PLN-260819)
 *   with attributes → `userId\nkey=value\nkey=value`  keys in alphabetical order
 *
 * Alphabetical order and one `key=value` per line make the string reproducible in
 * any language without a JSON canonicaliser; values cannot contain a newline
 * (normalize drops them), so a value cannot forge an extra line.
 */
export function identitySigningString(userId: string, attributes: IdentityAttributes | null): string {
  if (!attributes) return userId;
  const lines = (Object.keys(attributes) as IdentityAttributeKey[])
    .sort()
    .map((key) => `${key}=${attributes[key]}`);
  return [userId, ...lines].join('\n');
}

/** What `storedIdentityAttributes` decided about the region, for the identify log. */
export type RegionSource = 'signed' | 'map' | 'province_in_region' | 'province_sn' | 'none';

/** Go2Joy provinceSn → the province's name and region code (Province Feed, PLN-261024 D1). */
export type ProvinceIndex = Record<string, { name: string; region: string | null }>;

/**
 * The attributes as they are STORED and routed on (PLN-261022 stage 1). Runs
 * only after the signature verified against the raw values — nothing here may
 * feed back into `identitySigningString`.
 *
 *  - every value NFC (Vietnamese tone marks arrive composed or decomposed)
 *  - `region` folded to its canonical code ("North Center" → `north_center`)
 *  - no region but a province: the tenant's province → region map fills it
 *  - both present but the map disagrees: the signed region stands (the host
 *    knows its own hotel); `mismatch` carries the mapped value for a warning
 *  - spec v1.4: a `province_sn` the index knows sets `province` (name) and
 *    `region` from Go2Joy's own table and wins over v1.3 values sent beside it
 *    (`snMismatch` says what was sent); an unknown number falls through to the
 *    rules above
 */
export function storedIdentityAttributes(
  attributes: IdentityAttributes | null,
  provinceRegions?: Record<string, string> | null,
  provinceIndex?: ProvinceIndex | null,
): { attributes: IdentityAttributes | null; regionSource: RegionSource; mismatch?: string; snMismatch?: string } {
  if (!attributes) return { attributes: null, regionSource: 'none' };
  const out: IdentityAttributes = {};
  for (const key of Object.keys(attributes) as IdentityAttributeKey[]) {
    const value = attributes[key];
    if (value) out[key] = value.normalize('NFC');
  }
  const bySn = out.province_sn ? provinceIndex?.[out.province_sn] : undefined;
  if (bySn?.name) {
    const name = bySn.name.normalize('NFC');
    const region = canonicalRegion(bySn.region ?? '');
    const sent: string[] = [];
    if (out.province && provinceKey(out.province) !== provinceKey(name)) sent.push(`province '${out.province}'`);
    if (out.region && canonicalRegion(out.region) !== region) sent.push(`region '${out.region}'`);
    out.province = name;
    if (region) out.region = region;
    else delete out.region;
    return { attributes: out, regionSource: 'province_sn', ...(sent.length ? { snMismatch: sent.join(', ') } : {}) };
  }
  if (out.region) {
    out.region = canonicalRegion(out.region);
    // A province name in the region field (HA sends `region: "Hồ Chí Minh"`,
    // PLN-261023 H1-b): read it as the province. Only a value that is not a
    // region at all, and only when the map knows it — the signature was
    // checked on the raw values before this runs.
    if (!isRegionValue(out.region)) {
      const asProvince = provinceInMap(out.region.replace(/_/g, ' '), provinceRegions);
      if (asProvince) {
        if (!out.province) out.province = asProvince.name;
        out.region = asProvince.region;
        return { attributes: out, regionSource: 'province_in_region' };
      }
    }
  }
  const mapped = mappedRegion(out.province, provinceRegions);
  if (out.region) {
    const mismatch = mapped && mapped !== out.region ? mapped : undefined;
    return { attributes: out, regionSource: 'signed', mismatch };
  }
  if (mapped) {
    out.region = mapped;
    return { attributes: out, regionSource: 'map' };
  }
  return { attributes: out, regionSource: 'none' };
}

/**
 * What a CLAIMED (unsigned) identify keeps on the session (PLN-261022 unsigned):
 * the stored attributes plus who the host says the user is — `user_id` and the
 * display `name`. Those two are not routing fields; nothing that routes or
 * registers a company reads them. Email and phone are deliberately absent:
 * the customers table encrypts them, this JSON is plaintext.
 */
export function claimedIdentityAttributes(
  userId: string,
  name: string | null | undefined,
  attributes: IdentityAttributes | null,
): Record<string, string> {
  const out: Record<string, string> = { ...(attributes ?? {}) };
  const id = claimedText(userId);
  if (id) out.user_id = id;
  const display = claimedText(name);
  if (display) out.name = display;
  return out;
}

function claimedText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/[\r\n]+/g, ' ').trim().slice(0, IDENTITY_ATTRIBUTE_MAX_LENGTH);
}

/** The map's entry for a province (its own spelling + canonical region), or null. */
function provinceInMap(
  province: string | null | undefined,
  map: Record<string, string> | null | undefined,
): { name: string; region: string } | null {
  const key = provinceKey(province);
  if (!key || !map) return null;
  for (const [name, region] of Object.entries(map)) {
    if (provinceKey(name) === key) {
      const code = canonicalRegion(region);
      return code ? { name, region: code } : null;
    }
  }
  return null;
}

function mappedRegion(province: string | undefined, map: Record<string, string> | null | undefined): string | undefined {
  return provinceInMap(province, map)?.region;
}

/** The region the tenant's map gives a province (company backfill, PLN-261023 H1-c). */
export function regionForProvince(
  province: string | null | undefined,
  map: Record<string, string> | null | undefined,
): string | null {
  return provinceInMap(province, map)?.region ?? null;
}
