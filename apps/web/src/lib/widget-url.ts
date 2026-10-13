import { resolveWidgetUrl } from './widget-url-resolve';

/**
 * Where the widget SPA and its storefront loader are served.
 *
 * One definition, because the copy that did NOT use it shipped a broken install
 * snippet: it built the loader URL from `window.location.origin` (the console's
 * own host) and dropped the `/widget` base, so every store that pasted the
 * snippet requested a path nginx does not route. That path answers **200 with
 * the console's index.html**, so the browser downloads HTML, refuses to run it
 * as a script, and the widget simply never appears — nothing in the network tab
 * looks red (FIX-260917-Embed-Snippet-Url).
 *
 * Where it points — an explicit VITE_WIDGET_URL, else THIS deployment's own origin —
 * is decided in widget-url-resolve.ts (PLN-261012 SG-80): the default used to be
 * Amoeba's staging host, which every self-hosted build inherited.
 */
export const WIDGET_URL = resolveWidgetUrl({
  explicit: import.meta.env.VITE_WIDGET_URL as string | undefined,
  apiBase: import.meta.env.VITE_API_BASE_URL as string | undefined,
  origin: typeof window !== 'undefined' ? window.location.origin : undefined,
  dev: import.meta.env.DEV,
});

/**
 * The versioned loader a storefront should install.
 *
 * `/v1/embed.js` is pinned by nginx (`location = /widget/v1/embed.js`) so the
 * contract survives us rebuilding the widget — install snippets must use this,
 * not the unversioned file.
 */
export const EMBED_LOADER_URL = `${WIDGET_URL}/v1/embed.js`;
