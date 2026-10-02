/**
 * Widget exposure restriction (PLN-260929) — "show this widget only from these
 * IPs or these URLs, only during this window, plus anyone holding the invite
 * key".
 *
 * ⚠️ THIS IS EXPOSURE CONTROL, NOT ACCESS CONTROL. The URL arrives from the
 * browser and the IP is the first X-Forwarded-For hop our own edge sets — both
 * are forgeable by anything that is not a real browser. What this buys is "the
 * widget does not appear outside the test environment"; it is not an
 * authentication boundary and must never be used as one (REQ-260929 §3-3).
 *
 * The verdict is one expression:
 *
 *     visible = !enabled  ||  (inWindow && (ipMatch || urlMatch || keyMatch))
 *
 * Only the window is an AND, which is what makes "the restriction lifts itself
 * when the test period ends" fall out of the rule rather than needing a job.
 */

export interface WidgetAccess {
  /** Off = the widget behaves exactly as it did before this feature existed. */
  enabled: boolean;
  /** ISO instants. Null = open-ended on that side. */
  startsAt: string | null;
  endsAt: string | null;
  /** Single addresses or CIDR blocks, IPv4 and IPv6. */
  ips: string[];
  /** Origin + optional path prefix: `https://shop.example.com/collections/test`. */
  urls: string[];
}

export const WIDGET_ACCESS_DEFAULTS: WidgetAccess = {
  enabled: false,
  startsAt: null,
  endsAt: null,
  ips: [],
  urls: [],
};

/** Why the widget is hidden — surfaced to the console, never to the shopper. */
export const WIDGET_ACCESS_REASON = {
  WINDOW: 'window',
  NO_MATCH: 'no_match',
  SUSPENDED: 'suspended',
} as const;
export type WidgetAccessReason =
  (typeof WIDGET_ACCESS_REASON)[keyof typeof WIDGET_ACCESS_REASON];

const MAX_ENTRIES = 50;

// --- IP -------------------------------------------------------------------

/** Expand an IPv4 dotted quad to its 32-bit value, or null if it is not one. */
function ipv4ToBits(value: string): bigint | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let out = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8n) | BigInt(n);
  }
  return out;
}

/**
 * IPv6 → 128-bit value. Accepts `::` compression and a trailing IPv4 tail
 * (`::ffff:203.0.113.7`), which is what a dual-stack proxy reports for an IPv4
 * client — treating that as "not an address" would silently drop real visitors.
 */
function ipv6ToBits(value: string): bigint | null {
  let text = value;
  let tail = 0n;
  let tailGroups = 0;
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = ipv4ToBits(maybeV4);
    if (v4 == null) return null;
    tail = v4;
    tailGroups = 2;
    text = text.slice(0, lastColon + 1) + '0:0';
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  const groups = rest == null ? head : [...head, ...rest];
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  const total = rest == null ? groups.length : groups.length;
  if (rest == null ? total !== 8 : total > 7) return null;

  let bits = 0n;
  const fill = rest == null ? [] : new Array(8 - total).fill('0');
  for (const g of rest == null ? groups : [...head, ...fill, ...rest]) {
    bits = (bits << 16n) | BigInt(parseInt(g, 16));
  }
  if (tailGroups === 2) {
    // The two zero groups we substituted carry the IPv4 tail.
    bits = (bits & ~0xffffffffn) | tail;
  }
  return bits;
}

interface ParsedIp {
  bits: bigint;
  width: 32 | 128;
}

function parseIp(value: string): ParsedIp | null {
  const text = value.trim();
  if (!text) return null;
  if (text.includes(':')) {
    const bits = ipv6ToBits(text);
    return bits == null ? null : { bits, width: 128 };
  }
  const bits = ipv4ToBits(text);
  return bits == null ? null : { bits, width: 32 };
}

/**
 * One allowlist entry (`203.0.113.7` or `10.0.0.0/24`) against one client IP.
 * A malformed entry never matches — it was already refused at save time, and a
 * value that slipped through must not turn into "allow everyone".
 */
export function matchIp(entry: string, clientIp: string | null | undefined): boolean {
  if (!clientIp) return false;
  const [addr, prefixRaw] = entry.trim().split('/');
  const pattern = parseIp(addr);
  const client = parseIp(clientIp);
  if (!pattern || !client) return false;

  // An IPv4 client reported as ::ffff:a.b.c.d still has to match a v4 entry.
  const normalised =
    client.width === 128 && pattern.width === 32 && client.bits >> 32n === 0xffffn
      ? { bits: client.bits & 0xffffffffn, width: 32 as const }
      : client;
  if (normalised.width !== pattern.width) return false;

  const prefix = prefixRaw == null ? normalised.width : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > normalised.width) return false;
  if (prefix === 0) return true;
  const shift = BigInt(normalised.width - prefix);
  return pattern.bits >> shift === normalised.bits >> shift;
}

/** Save-time validation: an entry we cannot parse is refused, not stored. */
export function isValidIpEntry(entry: string): boolean {
  const [addr, prefixRaw] = entry.trim().split('/');
  const parsed = parseIp(addr);
  if (!parsed) return false;
  if (prefixRaw == null) return true;
  if (!/^\d{1,3}$/.test(prefixRaw)) return false;
  const prefix = Number(prefixRaw);
  return prefix >= 0 && prefix <= parsed.width;
}

// --- URL ------------------------------------------------------------------

interface ParsedUrlRule {
  scheme: string;
  host: string;
  port: string;
  path: string;
}

/**
 * `https://shop.example.com/collections/test` → origin + path prefix. A bare
 * host is accepted because operators paste what the browser shows them.
 */
export function parseUrlRule(raw: string | null | undefined): ParsedUrlRule | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    const scheme = url.protocol.replace(/:$/, '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return null;
    if (!url.hostname) return null;
    // Query and hash are ignored on both sides: they are not part of "which
    // page is this", and a rule carrying one would never match anything.
    const path = url.pathname.replace(/\/+$/, '');
    return { scheme, host: url.hostname.toLowerCase(), port: url.port, path };
  } catch {
    return null;
  }
}

/**
 * Host comparison, with the same wildcard the embed allowlist already uses:
 * `*.example.com` covers any subdomain but NOT the apex. Operators type this
 * syntax because the "allowed domains" box next door accepts it — a rule that
 * saved cleanly and then matched nothing was the silent no-op this closes.
 *
 * The apex exclusion is deliberate and matches `embed-origin.util`: "*.x"
 * quietly covering "x" is the kind of surprise that gets found during an
 * incident. List both when both are meant.
 */
function hostMatches(ruleHost: string, pageHost: string): boolean {
  if (!ruleHost.startsWith('*.')) return ruleHost === pageHost;
  const suffix = ruleHost.slice(2);
  if (!suffix || suffix === pageHost) return false;
  return pageHost.endsWith(`.${suffix}`);
}

/**
 * One URL rule against the page the shopper is on.
 *
 * The path is a PREFIX, and the prefix must end on a segment boundary:
 * `/collections/test` matches `/collections/test` and `/collections/test/x`,
 * and does NOT match `/collections/testing`. Substring matching is how
 * "fulfil" once matched "Unfulfilled" in this codebase; it is not repeated here.
 * No wildcards in the PATH: a prefix already means "everything under this".
 * The host does take `*.` — see `hostMatches`.
 */
export function matchUrl(entry: string, pageUrl: string | null | undefined): boolean {
  const rule = parseUrlRule(entry);
  const page = parseUrlRule(pageUrl);
  if (!rule || !page) return false;
  if (rule.scheme !== page.scheme) return false;
  if (!hostMatches(rule.host, page.host)) return false;
  if (rule.port && rule.port !== page.port) return false;
  if (!rule.path) return true; // host-only rule = the whole site
  if (page.path === rule.path) return true;
  return page.path.startsWith(`${rule.path}/`);
}

// --- normalisation --------------------------------------------------------

function normaliseInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normaliseList(value: unknown, valid: (entry: string) => boolean): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const entry = raw.trim();
    if (!entry || !valid(entry)) continue;
    if (!out.includes(entry)) out.push(entry);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

/**
 * Stored shape, or null when nothing usable was configured. Invalid entries are
 * dropped here as a last line; the API refuses them at save time so the
 * operator hears about a typo instead of wondering why their IP never matched.
 */
export function normalizeWidgetAccess(input: unknown): WidgetAccess | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<WidgetAccess>;
  const out: WidgetAccess = {
    enabled: raw.enabled === true,
    startsAt: normaliseInstant(raw.startsAt),
    endsAt: normaliseInstant(raw.endsAt),
    ips: normaliseList(raw.ips, isValidIpEntry),
    urls: normaliseList(raw.urls, (e) => parseUrlRule(e) != null),
  };
  if (!out.enabled && !out.ips.length && !out.urls.length && !out.startsAt && !out.endsAt) {
    return null; // nothing configured — store NULL rather than an empty shell
  }
  return out;
}

// --- verdict --------------------------------------------------------------

export interface WidgetAccessRequest {
  /** First X-Forwarded-For hop, as the rest of the app reads it. */
  ip?: string | null;
  /** The storefront page the widget would appear on. */
  pageUrl?: string | null;
  /** Invite key the visitor carries (`?st_access=…`, then remembered). */
  key?: string | null;
  /** The tenant's invite key, or null when none was issued. */
  tenantKey?: string | null;
  /** Console preview and host apps skip the URL rule — see below. */
  skipUrlRule?: boolean;
  now?: Date;
}

export interface WidgetAccessVerdict {
  visible: boolean;
  reason?: WidgetAccessReason;
  /** True whenever the tenant has the restriction switched on, match or not. */
  restricted: boolean;
}

export function isWithinWindow(access: WidgetAccess, now: Date): boolean {
  if (access.startsAt && now < new Date(access.startsAt)) return false;
  if (access.endsAt && now > new Date(access.endsAt)) return false;
  return true;
}

/**
 * The whole rule, in one pure function so the server, the tests and (later) any
 * other caller cannot drift apart.
 *
 * `skipUrlRule` covers the two cases where "which page is this" has no answer:
 * the console's signed preview (not a storefront at all) and a host app's
 * WebView (`?mode=app`). Those still honour the window, the IP and the key —
 * exemption from a rule that cannot apply is not exemption from the restriction.
 */
export function evaluateWidgetAccess(
  access: WidgetAccess | null | undefined,
  req: WidgetAccessRequest = {},
): WidgetAccessVerdict {
  if (!access || !access.enabled) return { visible: true, restricted: false };

  const now = req.now ?? new Date();
  if (!isWithinWindow(access, now)) {
    // Outside the test window the restriction lifts itself (PLN §1, D5).
    return { visible: true, restricted: true, reason: WIDGET_ACCESS_REASON.WINDOW };
  }

  const keyMatch =
    !!req.key && !!req.tenantKey && req.key.length === req.tenantKey.length && req.key === req.tenantKey;
  if (keyMatch) return { visible: true, restricted: true };

  if (access.ips.some((entry) => matchIp(entry, req.ip))) {
    return { visible: true, restricted: true };
  }
  if (!req.skipUrlRule && access.urls.some((entry) => matchUrl(entry, req.pageUrl))) {
    return { visible: true, restricted: true };
  }
  return { visible: false, restricted: true, reason: WIDGET_ACCESS_REASON.NO_MATCH };
}
