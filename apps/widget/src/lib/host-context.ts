/**
 * The host app's "opened from booking #…" command, normalised (PLN-261015).
 *
 * Whatever a host sends is bounded text only: no newlines, no oversize values.
 * The server bounds it again and treats it as background, never as a fact
 * source — this keeps the chip and the request honest on the way in.
 */
export interface HostContextInput {
  screen: string;
  ref?: string;
  label?: string;
  /** Pre-fills an EMPTY composer once. */
  prefill?: string;
}

const text = (v: unknown, max: number): string =>
  typeof v === 'string' || typeof v === 'number'
    ? String(v)
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

/** Null removes the chip: no object, or no usable screen. */
export function parseHostContext(raw: unknown): HostContextInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const screen = text(c.screen, 120);
  if (!screen) return null;
  return {
    screen,
    ref: text(c.ref, 120) || undefined,
    label: text(c.label, 120) || undefined,
    prefill: text(c.prefill, 500) || undefined,
  };
}
