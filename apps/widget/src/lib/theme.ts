import {
  buildThemeVariables,
  CUSTOM_FONT_FAMILY,
  FONT_PRESET,
} from '../../../../packages/types/src/common/widget-theme';
import { assetUrl } from './branding';
import type { WidgetTheme } from './types';

/**
 * Applying the tenant's brand theme (PLN-260818 S4).
 *
 * Imported from source rather than '@sharptalk/types' for the same reason as the
 * language registry and the tab constants: the package publishes CJS and a value
 * import of its entry point fails the widget build.
 */

/** Cache key — per shop, because one browser can visit several storefronts. */
function cacheKey(shop: string | undefined): string {
  return `ivy_theme:${shop ?? 'default'}`;
}

/** Write (or clear) the theme variables on :root. */
export function applyTheme(theme: WidgetTheme | null): void {
  const vars = buildThemeVariables(theme);
  const root = document.documentElement;
  // An unthemed tenant REMOVES the properties rather than writing defaults, so
  // the stylesheet's own values take over. Writing them back would fork the
  // built-in palette into a second place to keep in sync.
  for (const name of THEMED_PROPERTIES) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  applyFontSources(theme);
  applyCustomCss(theme);
}

const CUSTOM_CSS_ID = 'ivy-custom-css';
/**
 * Tenant custom CSS (P5). The API only ever delivers allowlist-sanitized text
 * (and only while the platform add-on is on), so this is a plain <style>.
 */
function applyCustomCss(theme: WidgetTheme | null): void {
  const css = theme?.design?.customCss ?? '';
  const el = document.getElementById(CUSTOM_CSS_ID);
  if (!css) {
    el?.remove();
    return;
  }
  if (el?.textContent === css) return;
  const style = el ?? document.createElement('style');
  style.id = CUSTOM_CSS_ID;
  style.textContent = css;
  if (!el) document.head.appendChild(style);
}

const FONT_FACE_ID = 'ivy-font-face';
const FONT_LINK_ID = 'ivy-font-link';
/** Presets that are not bundled with the widget load their CSS from Google Fonts. */
const PRESET_LINKS: Record<string, string> = {
  [FONT_PRESET.NOTO_SANS_KR]: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap',
  [FONT_PRESET.INTER]: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
};

/**
 * Make the configured font available: an uploaded file becomes an @font-face
 * (swap, so text renders in the fallback until it lands), a hosted preset
 * becomes a stylesheet link. Both are idempotent — re-applying the same theme
 * must not stack duplicate tags.
 */
function applyFontSources(theme: WidgetTheme | null): void {
  const font = theme?.design?.font ?? null;
  const face = document.getElementById(FONT_FACE_ID);
  const link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  const wantFace =
    font?.preset === FONT_PRESET.CUSTOM && font.asset
      ? `@font-face{font-family:'${CUSTOM_FONT_FAMILY}';src:url("${assetUrl(font.asset)}");font-display:swap;}`
      : null;
  if (wantFace) {
    if (face?.textContent !== wantFace) {
      const el = face ?? document.createElement('style');
      el.id = FONT_FACE_ID;
      el.textContent = wantFace;
      if (!face) document.head.appendChild(el);
    }
  } else {
    face?.remove();
  }
  const wantLink = font ? PRESET_LINKS[font.preset] ?? null : null;
  if (wantLink) {
    if (link?.href !== wantLink) {
      const el = link ?? document.createElement('link');
      el.id = FONT_LINK_ID;
      el.rel = 'stylesheet';
      el.href = wantLink;
      if (!link) document.head.appendChild(el);
    }
  } else {
    link?.remove();
  }
}

/** Every property applyTheme may set — listed so clearing is exhaustive. */
const THEMED_PROPERTIES = [
  ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => `--ivy-primary-${s}`),
  '--ivy-on-primary',
  '--ivy-header-bg',
  '--ivy-header-fg',
  '--ivy-header-dim',
  // Design profile (P2)
  '--ivy-font-family',
  '--ivy-root-size',
  '--ivy-radius',
  // The derived scale (FIX-260917). Listed here for the same reason as the
  // rest: a tenant switching back to the default widget must lose these, or
  // the corners keep a setting the shop no longer has.
  '--ivy-radius-xs',
  '--ivy-radius-sm',
  '--ivy-radius-md',
  '--ivy-radius-lg',
  '--ivy-radius-xl',
  '--ivy-panel-w',
  '--ivy-panel-h',
];

/**
 * Paint the last theme this shop served, before the session round-trip.
 *
 * `session/ensure` is async, so a themed widget would otherwise render in the
 * default blue and visibly repaint a moment later. Only the first-ever visit
 * sees that now.
 */
export function applyCachedTheme(shop: string | undefined): WidgetTheme | null {
  try {
    const raw = localStorage.getItem(cacheKey(shop));
    if (raw) {
      const theme = JSON.parse(raw) as WidgetTheme;
      applyTheme(theme);
      // Returned so the store can seed logo/launcher from the same cache — they
      // are part of first paint too, and a launcher that jumps sides one frame
      // after load is the same defect as a colour that repaints.
      return theme;
    }
  } catch {
    // Private mode, blocked storage, or a corrupt entry: the built-in palette is
    // a perfectly good fallback, so never let this break boot.
  }
  return null;
}

/**
 * Static live design (PLN-260910 P4 D-14): nginx serves the tenant's live theme
 * from the uploads volume at /widget-design/live/{shop}.json, so the first
 * paint on a fresh browser does not wait for the API. Same origin as the
 * widget, no credentials, no-store. Any failure (dev server, old stack) is
 * silent — session/ensure still delivers the theme a moment later.
 */
export function fetchStaticLiveTheme(shop: string | undefined): void {
  if (!shop || !/^[a-z0-9][a-z0-9.-]{0,200}$/i.test(shop)) return;
  try {
    fetch(`/widget-design/live/${encodeURIComponent(shop.toLowerCase())}.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const theme = (body?.theme ?? null) as WidgetTheme | null;
        if (!body || !('theme' in body)) return;
        applyTheme(theme);
        cacheTheme(shop, theme);
      })
      .catch(() => {
        /* no static file on this stack — nothing to paint early */
      });
  } catch {
    /* fetch unavailable */
  }
}

/** Remember the served theme so the next visit paints it immediately. */
export function cacheTheme(shop: string | undefined, theme: WidgetTheme | null): void {
  try {
    if (theme) localStorage.setItem(cacheKey(shop), JSON.stringify(theme));
    else localStorage.removeItem(cacheKey(shop));
  } catch {
    /* not remembering is only a cosmetic loss on the next visit */
  }
}
