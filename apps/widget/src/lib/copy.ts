import type { WidgetCopyText } from './types';

/**
 * Tenant copy helpers (PLN-260808, shared since PLN-261019): the chat greeting,
 * the header title, the sender names and the launcher pill all resolve the same
 * way — the bag's text for the active language, or null so the caller falls back.
 */

/** Pick the tenant-configured copy for the active language, if any. */
export function pickCopy(bag: WidgetCopyText | undefined | null, language: string): string | null {
  const key = (language || 'en').toUpperCase() as keyof WidgetCopyText;
  return bag?.[key]?.trim() || null;
}

/** Substitute a template placeholder everywhere (ES2020-safe replaceAll). */
export function fill(template: string, key: string, value: string): string {
  return template.split(key).join(value);
}

/**
 * The welcome bubble's text (PLN-261023). The first-visit copy (agent greeting
 * or tenant bag) may carry `{name}`: with a known name it is used filled in —
 * so a tenant can write "Dear {name}, I'm Joydesk…" once — and only a template
 * without `{name}` hands over to the login greeting. Without a name the token
 * is dropped along with the space before it ("Dear {name}, hi" → "Dear, hi").
 */
export function welcomeGreeting(opts: {
  firstVisit: string;
  loginGreeting: string;
  name: string | null;
  shop: string;
}): string {
  const { firstVisit, loginGreeting, name, shop } = opts;
  const template = !name || firstVisit.includes('{name}') ? firstVisit : loginGreeting;
  const withShop = fill(template, '{shop}', shop);
  if (name) return fill(withShop, '{name}', name);
  return withShop.replace(/\s*\{name\}/g, '').replace(/^[\s,]+/, '');
}
