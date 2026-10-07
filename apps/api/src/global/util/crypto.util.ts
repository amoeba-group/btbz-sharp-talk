import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * AES-256-GCM credential encryption (POL-018). Stored layout in a single buffer:
 * [12-byte IV][16-byte auth tag][ciphertext]. Key from CRED_ENC_KEY (base64, 32 bytes).
 */
const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const raw = process.env.CRED_ENC_KEY ?? '';
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('CRED_ENC_KEY must be 32 bytes (base64-encoded)');
  }
  return buf;
}

export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptSecret(stored: Buffer): string {
  const iv = stored.subarray(0, 12);
  const tag = stored.subarray(12, 28);
  const enc = stored.subarray(28);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/**
 * PII-at-rest encryption (PRV-M6). Same AES-256-GCM as credentials but
 * null-aware, so it can back a TypeORM column transformer over nullable PII
 * columns (customer email/name/phone). `to`/`from` never throw on null.
 */
export function encryptPii(plaintext: string | null | undefined): Buffer | null {
  if (plaintext == null || plaintext === '') return null;
  return encryptSecret(plaintext);
}

export function decryptPii(stored: Buffer | null | undefined): string | null {
  if (stored == null || stored.length === 0) return null;
  // Tolerate legacy plaintext rows written before encryption was introduced:
  // a value shorter than the GCM envelope (12 IV + 16 tag) can't be ciphertext.
  if (stored.length <= 28) return stored.toString('utf8');
  try {
    return decryptSecret(stored);
  } catch {
    // Not GCM ciphertext (pre-migration plaintext stored as bytes) — return as-is.
    return stored.toString('utf8');
  }
}

/**
 * Deterministic blind index for equality lookups on an encrypted column
 * (PRV-M6). HMAC-SHA256 over the normalized (trim + lowercase) value, keyed by
 * CRED_ENC_KEY so it can't be recomputed without the key. Deterministic → an
 * indexed `*_hash` column supports exact-match queries the ciphertext can't.
 */
export function blindIndex(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  return createHmac('sha256', key()).update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Signed attachment URLs (PLN-260814 §4). The download route is public — the
 * signature IS the authorisation — so ownership is checked when the URL is
 * minted (the caller already proved it may read that conversation) and the
 * signature only has to prove the URL was not forged or edited.
 *
 * Keyed by FILE_URL_SECRET when set; otherwise derived from CRED_ENC_KEY so a
 * deployment that has not added the new variable yet still boots with a secret
 * that is not guessable. The derivation is domain-separated so a signature can
 * never collide with a blind index.
 */
function fileUrlKey(): Buffer {
  const explicit = process.env.FILE_URL_SECRET ?? '';
  if (explicit.trim()) return Buffer.from(explicit.trim(), 'utf8');
  return createHmac('sha256', key()).update('file-url-signing-v1').digest();
}

export type FileVariant = 'full' | 'thumb';

/**
 * Signature for a KB video link (PLN-261006-KB-Video-Links D2). Unlike file
 * URLs it does not expire: it sits in a stored answer a customer may reopen
 * days later. It still names exactly one document of one tenant, so a link
 * cannot be edited into another video. Domain-separated from file signatures.
 */
export function signKbVideo(tenantId: number, docId: number): string {
  return createHmac('sha256', fileUrlKey()).update(`kb-video|${tenantId}|${docId}`).digest('hex').slice(0, 32);
}

export function verifyKbVideo(tenantId: number, docId: number, signature: string): boolean {
  const want = Buffer.from(signKbVideo(tenantId, docId), 'utf8');
  const given = Buffer.from(signature ?? '', 'utf8');
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Hex HMAC over uuid|variant|expiry — the exact tuple the URL carries. */
export function signFileUrl(uuid: string, variant: FileVariant, expiresAt: number): string {
  return createHmac('sha256', fileUrlKey())
    .update(`${uuid}|${variant}|${expiresAt}`)
    .digest('hex');
}

/**
 * True only for an unexpired, untampered signature. Comparison is constant-time,
 * and a malformed signature fails closed rather than throwing.
 */
export function verifyFileUrl(
  uuid: string,
  variant: FileVariant,
  expiresAt: number,
  signature: string,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now) return false;
  const expected = signFileUrl(uuid, variant, expiresAt);
  const given = Buffer.from(signature ?? '', 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
