import { DESIGN_LIMITS, parseHex, QUICK_REPLY_STYLE, type WidgetTheme } from './widget-theme';

/**
 * Per-surface settings for a host MOBILE APP (PLN-261015 S9).
 *
 * A tenant has one widget theme shared by its web storefront and its app. This
 * adds a small override that applies ONLY when the widget runs inside a host
 * app (`?mode=app`): font, text size, scenario-menu style, whether the widget
 * draws its own header, and an optional app-only brand colour. Plus which agent
 * each app screen opens, so the app does not hard-code agent codes.
 *
 * Stored as JSON, NULL = never configured = the web theme applies unchanged.
 */
export const MOBILE_FONT = { SYSTEM: 'system', WEB: 'web' } as const;
export type MobileFont = (typeof MOBILE_FONT)[keyof typeof MOBILE_FONT];

export const MOBILE_HEADER = { NATIVE: 'native', WIDGET: 'widget' } as const;
export type MobileHeader = (typeof MOBILE_HEADER)[keyof typeof MOBILE_HEADER];

/** SDK versions the console offers as "minimum". Informational: the app reports itself, the server does not block. */
export const MOBILE_SDK_VERSIONS = ['0.1.0', '0.2.0'] as const;

export const MOBILE_APP_LIMITS = { maxEntries: 30, screen: 40, agentCode: 64, contextLabel: 60 } as const;

export interface MobileAppSurface {
  /** 'system' = the device font (no web font download over mobile data). */
  font: MobileFont;
  /** Base text size in px (same 13–16 range as the web design). */
  fontSize: number;
  /** Opening scenario menu: outlined cards or filled chips. */
  menuStyle: 'card' | 'chip';
  /** 'native' = the app draws the toolbar and the widget hides its header. */
  header: MobileHeader;
  /** App-only brand colour `#RRGGBB`; null = the tenant's web brand. */
  brand: string | null;
}

export interface MobileAppEntry {
  /** App screen id the host passes when it opens the chat, e.g. `bookings`. */
  screen: string;
  /** Agent code that screen opens (an `ai_agents.code` of this tenant). */
  agentCode: string;
  /** What the host sends as context for that screen, shown to admins as a hint. */
  contextLabel: string | null;
}

export interface MobileAppConfig {
  app: MobileAppSurface;
  entries: MobileAppEntry[];
  minSdk: string;
}

export const MOBILE_APP_DEFAULTS: MobileAppConfig = {
  app: { font: MOBILE_FONT.SYSTEM, fontSize: DESIGN_LIMITS.baseSize.default, menuStyle: 'card', header: MOBILE_HEADER.NATIVE, brand: null },
  entries: [],
  minSdk: '0.2.0',
};

const SCREEN_RE = /^[a-z0-9][a-z0-9_-]*$/;

function toHex(v: unknown): string | null {
  const rgb = parseHex(typeof v === 'string' ? v : null);
  if (!rgb) return null;
  return '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Whatever arrives is coerced to something safe, never trusted: an unknown value
 * falls back to the default rather than being stored, and a bad entry is dropped.
 * Returns null only when nothing at all was given (= "not configured").
 */
export function normalizeMobileAppConfig(raw: unknown): MobileAppConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const a = (r.app && typeof r.app === 'object' ? r.app : {}) as Record<string, unknown>;
  const d = MOBILE_APP_DEFAULTS.app;

  const size = Number(a.fontSize);
  const surface: MobileAppSurface = {
    font: a.font === MOBILE_FONT.WEB ? MOBILE_FONT.WEB : a.font === MOBILE_FONT.SYSTEM ? MOBILE_FONT.SYSTEM : d.font,
    fontSize: Number.isFinite(size)
      ? Math.min(DESIGN_LIMITS.baseSize.max, Math.max(DESIGN_LIMITS.baseSize.min, Math.round(size)))
      : d.fontSize,
    menuStyle: a.menuStyle === 'chip' ? 'chip' : a.menuStyle === 'card' ? 'card' : d.menuStyle,
    header: a.header === MOBILE_HEADER.WIDGET ? MOBILE_HEADER.WIDGET : a.header === MOBILE_HEADER.NATIVE ? MOBILE_HEADER.NATIVE : d.header,
    brand: toHex(a.brand),
  };

  const seen = new Set<string>();
  const entries: MobileAppEntry[] = [];
  for (const e of Array.isArray(r.entries) ? r.entries : []) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    const screen = typeof x.screen === 'string' ? x.screen.trim().toLowerCase() : '';
    const agentCode = typeof x.agentCode === 'string' ? x.agentCode.trim() : '';
    if (!screen || screen.length > MOBILE_APP_LIMITS.screen || !SCREEN_RE.test(screen)) continue;
    if (!agentCode || agentCode.length > MOBILE_APP_LIMITS.agentCode) continue;
    if (seen.has(screen)) continue;
    seen.add(screen);
    const label = typeof x.contextLabel === 'string' ? x.contextLabel.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MOBILE_APP_LIMITS.contextLabel) : '';
    entries.push({ screen, agentCode, contextLabel: label || null });
    if (entries.length >= MOBILE_APP_LIMITS.maxEntries) break;
  }

  const minSdk = (MOBILE_SDK_VERSIONS as readonly string[]).includes(String(r.minSdk)) ? String(r.minSdk) : MOBILE_APP_DEFAULTS.minSdk;
  return { app: surface, entries, minSdk };
}

/**
 * The widget theme as the HOST APP should see it: the tenant's web theme with
 * the app overrides on top. Pure — the same function shapes the console
 * preview and the widget at runtime.
 *
 * With no web theme there is nothing to override except an explicit app brand;
 * a theme is never invented, because the built-in (unthemed) palette is not
 * reproducible from a brand colour (white-on-blue vs ink-on-blue).
 */
export function mergeAppSurface(theme: WidgetTheme | null, cfg: MobileAppConfig | null): WidgetTheme | null {
  if (!cfg) return theme;
  const s = cfg.app;
  if (!theme && !s.brand) return null;
  const base: WidgetTheme = theme ?? { brand: s.brand as string, headerStyle: 'white' };
  const font = base.design?.font;
  return {
    ...base,
    brand: s.brand ?? base.brand,
    design: {
      ...(base.design ?? {}),
      font:
        s.font === MOBILE_FONT.SYSTEM
          ? { preset: 'system', baseSize: s.fontSize }
          : { preset: font?.preset ?? 'pretendard', asset: font?.asset ?? null, baseSize: s.fontSize },
      quickReplyStyle: s.menuStyle === 'chip' ? QUICK_REPLY_STYLE.CHIP : QUICK_REPLY_STYLE.CARD,
    },
  };
}
