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
export const IDENTITY_ATTRIBUTE_KEYS = ['hotel_id', 'hotel_name', 'region', 'province', 'role'] as const;
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
