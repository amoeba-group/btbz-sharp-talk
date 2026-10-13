/**
 * Who operational mail goes to, and who it appears to come from (PLN-261012 SG-80).
 *
 * Both used to fall back to Amoeba's own addresses (`dev@amoeba.group` for AI
 * credit / golden-gate alerts, `noreply@ivyusa.local` as the sender). On a
 * customer's own infrastructure that is a data leak and a deliverability trap in
 * one: the customer's engine names, tenant slugs and failure details would be
 * mailed to a third party, from a domain that cannot pass SPF.
 *
 * Operators now say where alerts go. Amoeba's own deployments set
 * `AI_ALERT_EMAIL=dev@amoeba.group` explicitly in their env files.
 */

/**
 * Recipient for AI-engine and golden-gate alerts:
 * `AI_ALERT_EMAIL`, else the general `ALERT_EMAIL_TO`, else null (= "not configured";
 * callers log a warning instead of mailing anyone).
 */
export function resolveAlertRecipient(env: Record<string, string | undefined> = process.env): string | null {
  const dedicated = env.AI_ALERT_EMAIL?.trim();
  if (dedicated) return dedicated;
  const general = env.ALERT_EMAIL_TO?.trim();
  return general || null;
}

/**
 * Sender address. A blank env var must fall through: `ALERT_EMAIL_FROM=` in an
 * env file is an EMPTY STRING, which `??` does not skip — the old code sent
 * `from: ''` whenever the operator copied the template and left the line blank.
 *
 * Order: ALERT_EMAIL_FROM → SMTP_USER → noreply@<host of APP_PUBLIC_URL> →
 * noreply@localhost.
 */
export function resolveMailFrom(opts: {
  from?: string | null;
  smtpUser?: string | null;
  appPublicUrl?: string | null;
}): string {
  const from = opts.from?.trim();
  if (from) return from;
  const user = opts.smtpUser?.trim();
  if (user) return user;
  try {
    const host = new URL(opts.appPublicUrl?.trim() ?? '').hostname;
    if (host) return `noreply@${host}`;
  } catch {
    /* not a URL — fall through */
  }
  return 'noreply@localhost';
}
