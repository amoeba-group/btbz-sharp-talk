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
