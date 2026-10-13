import { decryptSecret, encryptSecret } from '../../global/util/crypto.util';

/**
 * Per-region Slack incoming webhooks in `handoff_config` (PLN-261012 SG-67).
 *
 * A webhook URL is a credential — anyone holding it can post to that channel — and the
 * handoff config is JSON that every AI-settings manager reads. So the URL is sealed with
 * the same AES-256-GCM the integration credentials use (`CRED_ENC_KEY`) before it is
 * stored, and the config API only ever returns the fixed mask below. The console sends
 * the mask back untouched when the operator did not change the field, which the server
 * reads as "keep what is stored".
 *
 * Only Slack's own host is accepted. The server POSTs to this URL, so a free-form URL
 * would let a tenant manager aim the API at its own network (SSRF); one fixed host and
 * the `/services/T…/B…/…` path shape close that without a DNS check.
 */

/** What the config API returns instead of a stored webhook, and what the console echoes back. */
export const WEBHOOK_MASK = 'https://hooks.slack.com/services/••••••••';
const SEALED_PREFIX = 'enc:v1:';
const SLACK_HOST = 'hooks.slack.com';
const WEBHOOK_MAX_LEN = 300;

export function isMaskedWebhook(value: unknown): boolean {
  return value === WEBHOOK_MASK;
}

/** `https://hooks.slack.com/services/<team>/<bot>/<token>` and nothing else. */
export function isSlackWebhookUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > WEBHOOK_MAX_LEN) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.hostname !== SLACK_HOST) return false;
  if (url.port || url.username || url.password || url.search || url.hash) return false;
  return /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname);
}

/** Seal for storage. Throws when `CRED_ENC_KEY` is not configured (the caller reports it). */
export function sealWebhook(url: string): string {
  return `${SEALED_PREFIX}${encryptSecret(url).toString('base64')}`;
}

/**
 * The clear URL behind a stored value, or null when it cannot be read. A stored value that
 * is already a plain Slack URL (written before sealing, or by hand) is accepted as is.
 * Never throws: an unreadable webhook must mean "no regional webhook", not a failed alert.
 */
export function openWebhook(stored: unknown): string | null {
  if (typeof stored !== 'string' || !stored) return null;
  if (stored.startsWith(SEALED_PREFIX)) {
    try {
      const url = decryptSecret(Buffer.from(stored.slice(SEALED_PREFIX.length), 'base64'));
      return isSlackWebhookUrl(url) ? url : null;
    } catch {
      return null;
    }
  }
  return isSlackWebhookUrl(stored) ? stored : null;
}

/** Is there a webhook behind this stored value (sealed or plain)? */
export function hasWebhook(stored: unknown): boolean {
  return typeof stored === 'string' && stored.length > 0;
}
