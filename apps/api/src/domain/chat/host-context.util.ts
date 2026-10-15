import { localized, type LocalizedText } from '@sharptalk/types';

/**
 * Where in the host app a conversation was opened from (PLN-261015 Kotlin SDK 0.2).
 *
 * A native host can call `setContext({ screen: 'bookings', ref: 'G2J-8841', label: ... })`
 * so the chat opens "from a booking" instead of from a generic launcher. The
 * context is BACKGROUND, never a fact source: it is written once into the thread
 * as a system line (so a human agent sees it too) and handed to the model as a
 * one-line hint. Numbers, prices and statuses still come only from tools/KB.
 */
export interface HostContext {
  screen: string;
  ref?: string;
  label?: string;
}

export const HOST_CONTEXT_MAX = 120;

/** What an unsigned client may send is bounded text only — no newlines, no markup carriers. */
function clean(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>`]/g, '')
    .trim();
  if (!s) return undefined;
  return s.length > HOST_CONTEXT_MAX ? s.slice(0, HOST_CONTEXT_MAX) : s;
}

/** Null when there is no usable screen — a context without one carries nothing. */
export function normalizeHostContext(raw: unknown): HostContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const screen = clean(r.screen);
  if (!screen) return null;
  const out: HostContext = { screen };
  const ref = clean(r.ref);
  const label = clean(r.label);
  if (ref) out.ref = ref;
  if (label) out.label = label;
  return out;
}

/** Same screen + ref = same place; the label is display text and does not make a new context. */
export function hostContextKey(c: HostContext): string {
  return `${c.screen}|${c.ref ?? ''}`;
}

const OPENED_FROM: LocalizedText = {
  EN: 'Opened from {where}',
  ES: 'Abierto desde {where}',
  KO: '{where}에서 열림',
  VI: 'Mở từ {where}',
  JA: '{where}から開始',
  ZH: '从{where}打开',
};

/** The system line written into the thread, e.g. "Mở từ Đặt phòng #G2J-8841". */
export function hostContextLine(c: HostContext, lang: string): string {
  const what = c.label ?? c.screen;
  const where = c.ref ? `${what} #${c.ref.replace(/^#/, '')}` : what;
  return localized(OPENED_FROM, lang).replace('{where}', where);
}

/** One line for the model. Explicitly background: it must not be quoted as a source of facts. */
export function hostContextPromptNote(c: HostContext): string {
  const parts = [`screen=${c.screen}`];
  if (c.ref) parts.push(`ref=${c.ref}`);
  if (c.label) parts.push(`label=${c.label}`);
  return (
    `\nHOST_CONTEXT: the user opened this chat from the host app (${parts.join(', ')}). ` +
    'Use it only to understand what they are probably asking about. It is NOT a source of facts: ' +
    'never state booking details, prices, statuses or dates from it, only from the context documents.'
  );
}
