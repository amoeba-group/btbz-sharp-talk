/**
 * Pure resolution of the widget base URL the console shows in its install snippets
 * (PLN-261012 SG-80, REQ D-18). Kept free of `import.meta` / `window` so it can be
 * unit-tested with plain `node --test` (apps/web has no test runner of its own).
 *
 * The widget is always served by the SAME stack as the console, under `/widget`.
 * The old rule — "VITE_WIDGET_URL, else Amoeba's staging host" — meant a customer
 * who copied the snippet from their own console installed a loader hosted by
 * Amoeba (and nothing in compose passed VITE_WIDGET_URL, so that was the default
 * for every self-hosted build).
 *
 * Resolution, first match wins:
 *   1. an explicit `VITE_WIDGET_URL` (a CDN, or a widget on its own host);
 *   2. the ORIGIN of an absolute `VITE_API_BASE_URL` + `/widget` — the same stack;
 *   3. the console's own origin + `/widget`, when the API base is relative
 *      (`/api/v1`, the domain-agnostic release bundle) — evaluated at runtime;
 *   4. development only: the legacy staging URL, so a developer's snippet is
 *      unchanged (it is not a deployment).
 */
export const LEGACY_DEV_WIDGET_URL = 'https://shoptalk.amoeba.site/widget';

export interface WidgetUrlInput {
  /** `import.meta.env.VITE_WIDGET_URL` */
  explicit?: string;
  /** `import.meta.env.VITE_API_BASE_URL` */
  apiBase?: string;
  /** `window.location.origin` (absent when not in a browser). */
  origin?: string;
  /** `import.meta.env.DEV` */
  dev?: boolean;
}

const trimSlash = (value: string): string => value.replace(/\/+$/, '');

export function resolveWidgetUrl(input: WidgetUrlInput): string {
  const explicit = input.explicit?.trim();
  if (explicit) return trimSlash(explicit);

  const apiBase = input.apiBase?.trim();
  if (apiBase && /^https?:\/\//i.test(apiBase)) {
    try {
      return `${new URL(apiBase).origin}/widget`;
    } catch {
      /* malformed — fall through to the origin rule */
    }
  }

  // Relative (or absent) API base: the console is served same-origin with the
  // widget, but the vite dev server (:5173) is not — keep the legacy default there.
  if (!input.dev && input.origin) return `${trimSlash(input.origin)}/widget`;
  return LEGACY_DEV_WIDGET_URL;
}
