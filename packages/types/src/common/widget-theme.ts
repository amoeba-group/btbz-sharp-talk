/**
 * Per-tenant widget theming (PLN-260818-Widget-Theme-And-Tab-Guide).
 *
 * A tenant supplies ONE brand colour. Everything else — the nine-stop ramp and
 * every foreground colour — is computed here, deliberately:
 *
 *  - Asking for nine stops asks a shop owner to be a designer, and the answer
 *    would rarely preserve the contrast relationships the design depends on.
 *  - Letting anyone pick the text colour on a filled button eventually ships a
 *    widget nobody can read. Foreground is derived from luminance instead.
 *
 * Pure and dependency-free so the API, the console preview and the widget all
 * compute identical values from the same input.
 */

/** Stored shape. `null`/absent = never configured = the built-in palette. */
export const WIDGET_HEADER_STYLE = { WHITE: 'white', BRAND: 'brand' } as const;
export type WidgetHeaderStyle = (typeof WIDGET_HEADER_STYLE)[keyof typeof WIDGET_HEADER_STYLE];

/** Launcher geometry (PLN-260819 S4). Enumerated, never free-form. */
export const LAUNCHER_POSITION = { RIGHT: 'right', LEFT: 'left' } as const;
export type LauncherPosition = (typeof LAUNCHER_POSITION)[keyof typeof LAUNCHER_POSITION];

export const LAUNCHER_SIZE = { SM: 'sm', MD: 'md', LG: 'lg' } as const;
export type LauncherSize = (typeof LAUNCHER_SIZE)[keyof typeof LAUNCHER_SIZE];

/**
 * How the widget is opened (PLN-260916 P2). `floating` draws the round button
 * the loader has always shown; `trigger` draws nothing and the storefront's own
 * element (a header bell) opens the panel, which docks under the header.
 */
export const LAUNCHER_MODE = { FLOATING: 'floating', TRIGGER: 'trigger' } as const;
export type LauncherMode = (typeof LAUNCHER_MODE)[keyof typeof LAUNCHER_MODE];
/** Trigger-mode docking: how far below the viewport top the panel's frame starts. */
export const TRIGGER_OFFSET = { min: 0, max: 240, default: 72 } as const;
const TRIGGER_SELECTOR_RE = /^[-_a-zA-Z0-9#.\[\]="':>\s,]{1,80}$/;

export const LAUNCHER_ICON = {
  CHAT: 'chat',
  QUESTION: 'question',
  HEADSET: 'headset',
  LOGO: 'logo',
  /** An uploaded icon asset (design.launcherIcon) — PLN-260910 P2. */
  CUSTOM: 'custom',
} as const;
export type LauncherIcon = (typeof LAUNCHER_ICON)[keyof typeof LAUNCHER_ICON];

/**
 * Button edge in px, and the iframe the loader must reserve for it.
 *
 * The frame has to clear the button PLUS its offset from the edge, or the
 * launcher is clipped by its own iframe — the failure that made this a shared
 * constant instead of two numbers in two files.
 */
export const LAUNCHER_METRICS: Record<LauncherSize, { button: number; frame: number }> = {
  sm: { button: 48, frame: 80 },
  md: { button: 56, frame: 96 },
  lg: { button: 64, frame: 112 },
};

/** The palette the widget ships with — the answer for a tenant that never themed. */
export const DEFAULT_BRAND = '#2B7FFF';

export const LAUNCHER_DEFAULTS = {
  position: LAUNCHER_POSITION.RIGHT,
  size: LAUNCHER_SIZE.MD,
  icon: LAUNCHER_ICON.CHAT,
} as const;

/** Uploaded brand mark. Served publicly and cached hard, keyed by `id`. */
export interface WidgetLogo {
  id: string;
  ext: string;
  mime: string;
  width: number;
  height: number;
}

export interface WidgetLauncher {
  position: LauncherPosition;
  size: LauncherSize;
  icon: LauncherIcon;
  /** Absent = floating (every tenant before PLN-260916). */
  mode?: LauncherMode;
  /** Trigger mode only: px below the viewport top where the docked panel starts. */
  offsetTop?: number;
  /** Trigger mode only: CSS selector of the storefront element that opens the widget (snippet hint). */
  triggerSelector?: string | null;
}

// ---- Design profile (PLN-260910 P2) ------------------------------------------

export const FONT_PRESET = {
  PRETENDARD: 'pretendard',
  NOTO_SANS_KR: 'noto-sans-kr',
  INTER: 'inter',
  SYSTEM: 'system',
  /** A font file the tenant uploaded (design asset, kind=font). */
  CUSTOM: 'custom',
} as const;
export type FontPreset = (typeof FONT_PRESET)[keyof typeof FONT_PRESET];

export const WIDGET_RADIUS = { SM: 'sm', MD: 'md', LG: 'lg' } as const;
export const QUICK_REPLY_STYLE = { CHIP: 'chip', CARD: 'card' } as const;
export type QuickReplyStyle = (typeof QUICK_REPLY_STYLE)[keyof typeof QUICK_REPLY_STYLE];
export type WidgetRadius = (typeof WIDGET_RADIUS)[keyof typeof WIDGET_RADIUS];

/** A tenant design asset the widget fetches publicly; `version` is the cache key. */
export interface WidgetAssetRef {
  uuid: string;
  version: number;
}

export interface WidgetFont {
  preset: FontPreset;
  /** Required when preset is 'custom'; ignored otherwise. */
  asset?: WidgetAssetRef | null;
  /** Base text size in px. The widget scales rem-based text and spacing from it. */
  baseSize: number;
}

export interface WidgetPanelSize {
  width: number;
  height: number;
}

export interface WidgetDesign {
  font?: WidgetFont | null;
  radius?: WidgetRadius | null;
  panel?: WidgetPanelSize | null;
  /** Drawn when launcher.icon is 'custom'. */
  launcherIcon?: WidgetAssetRef | null;
  /** Opening scenario menu: filled chips (default) or outlined cards with an icon (PLN-260916 P4). */
  quickReplyStyle?: QuickReplyStyle | null;
  /**
   * Where the Review chip's "write a review" goes (PLN-260923 P3). Must contain
   * `{productUrl}`: either it LEADS the template (`{productUrl}#reviews` — the
   * store's review app anchor) or it sits inside an absolute http(s) URL, where
   * it is inserted URL-encoded. Absent = the product page itself.
   */
  reviewLinkTemplate?: string | null;
  /**
   * Tenant custom CSS (P5) — ALREADY sanitized by the API's allowlist; stored
   * and delivered only while the platform add-on is on. Never raw input.
   */
  customCss?: string | null;
}

export const CUSTOM_CSS_MAX_CHARS = 32 * 1024;

export const DESIGN_LIMITS = {
  baseSize: { min: 13, max: 16, default: 14 },
  panel: { width: { min: 360, max: 480, default: 404 }, height: { min: 480, max: 760, default: 600 } },
} as const;

/** Frame the loader reserves around the open panel: 20px gutters + the launcher row. */
export const PANEL_FRAME_PAD = { w: 40, h: 80 } as const;

export const RADIUS_PX: Record<WidgetRadius, number> = { sm: 8, md: 12, lg: 16 };

/**
 * Corner radius is ONE tenant input, but a panel has surfaces at four sizes —
 * a message bubble should not turn as sharply as the small tag inside it. So
 * the setting publishes a scale and components pick a step by name; adding a
 * component never means touching this file again (POL-001, FIX-260917).
 *
 * The ratios are calibrated so `md` reproduces the values that were hardcoded
 * before the token existed — 4/6/8/12/16px, i.e. Tailwind's bare/md/lg/xl/2xl —
 * so a tenant on the default setting sees no change at all. `xs` exists for
 * that last reason alone: attachment chips and thumbnails sat at Tailwind's
 * bare `rounded` (4px), below every other step, and rounding them up to `sm`
 * would have been a visible change at the default setting.
 */
export const RADIUS_SCALE = { xs: 0.33, sm: 0.5, md: 0.67, lg: 1, xl: 1.33 } as const;

/** Keeps a derived step a corner: never a hairline, never a pill by accident. */
export const clampRadius = (px: number): number => Math.max(2, Math.min(28, Math.round(px)));

/**
 * The radius half of the theme, on its own — the console's editor preview needs
 * exactly this and nothing else. Sharing the function rather than the table is
 * what keeps the preview from drifting away from the widget it is previewing.
 */
export function radiusVars(radius: WidgetRadius): Record<string, string> {
  const base = RADIUS_PX[radius];
  const vars: Record<string, string> = { '--ivy-radius': `${base}px` };
  for (const [step, ratio] of Object.entries(RADIUS_SCALE)) {
    vars[`--ivy-radius-${step}`] = `${clampRadius(base * ratio)}px`;
  }
  return vars;
}

/** Font stacks per preset. 'custom' is prefixed with the uploaded face at runtime. */
export const FONT_STACKS: Record<Exclude<FontPreset, 'custom'>, string> = {
  pretendard:
    "'Pretendard', -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', 'PingFang SC', 'Noto Sans SC', 'Segoe UI', Roboto, sans-serif",
  'noto-sans-kr': "'Noto Sans KR', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  inter: "'Inter', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

/** The face name the widget registers for an uploaded font. */
export const CUSTOM_FONT_FAMILY = 'IvyTenantFont';

export interface WidgetTheme {
  /** Brand colour as `#RRGGBB`; occupies the 500 slot of the generated ramp. */
  brand: string;
  /** 'white' keeps the design's header; 'brand' fills it with the brand colour. */
  headerStyle: WidgetHeaderStyle;
  /** Absent = no logo = the display name renders as text, exactly as before. */
  logo?: WidgetLogo | null;
  /** Absent = the built-in geometry. */
  launcher?: WidgetLauncher | null;
  /** Absent = the built-in font, size, corners and panel (PLN-260910 P2). */
  design?: WidgetDesign | null;
}

/** Ramp stop → the palette's own lightness, in HSL percent. */
const RAMP_LIGHTNESS: Record<number, number> = {
  50: 96.9,
  100: 92.7,
  200: 87.3,
  300: 77.8,
  400: 65.9,
  500: 58.4,
  600: 53.5,
  700: 49.0,
  800: 41.0,
  900: 33.3,
};

export const RAMP_STOPS = Object.keys(RAMP_LIGHTNESS).map(Number);

/** `#RGB`/`#RRGGBB` → [r,g,b], or null when it is not a colour we can use. */
export function parseHex(hex: string | null | undefined): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** WCAG contrast ratio between two colours. */
export function contrastRatio(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: [number, number, number] = [255, 255, 255];
/** Not pure black: the design's darkest text is gray-900, and it reads softer. */
const INK: [number, number, number] = [17, 24, 39];
/** Last-resort foreground; see readableForeground. */
const BLACK: [number, number, number] = [0, 0, 0];

/**
 * Minimum contrast white must reach before we keep it on a filled control.
 *
 * 4.5:1 — WCAG AA for body text, not the 3:1 for user-interface components.
 * What sits on these fills is text: send buttons, message bubbles, order
 * actions. An earlier revision used 3:1 to avoid disturbing the signed-off
 * design, whose white on #2B7FFF is only 3.8:1 — but that reasoning does not
 * survive contact with how this is wired. An UNTHEMED widget never calls this
 * function at all: its foreground is the literal white in index.css. So the
 * threshold cannot touch the approved design, and there is nothing left to
 * trade legibility against.
 *
 * The visible consequence is narrow and worth naming: a tenant who themes with
 * the default blue gets ink where an unthemed shop gets white. The console
 * preview runs this same function, so what the admin approves is what ships.
 */
const MIN_ON_PRIMARY_CONTRAST = 4.5;

/**
 * Text colour for a filled background.
 *
 * White while it clears AA for text, ink otherwise. This is why a tenant cannot
 * choose it: on `#FFD400` white is 1.43:1, and any UI that let someone keep it
 * there would ship a button with no visible label.
 */
export function readableForeground(bg: [number, number, number]): [number, number, number] {
  // Preference order, not "highest contrast wins": white reads as the brand's
  // own, ink is the soft dark the rest of the widget uses, and BLACK is the
  // last resort. The third candidate is not decoration — around 18% relative
  // luminance both white and #111827 stall near 4.47:1, so a two-candidate
  // rule cannot honour 4.5 there. Pure black bottoms out at 4.58:1 for every
  // possible background, which is what makes the guarantee hold.
  for (const fg of [WHITE, INK, BLACK]) {
    if (contrastRatio(bg, fg) >= MIN_ON_PRIMARY_CONTRAST) return fg;
  }
  /* istanbul ignore next -- unreachable: BLACK clears 4.5 against any colour. */
  return BLACK;
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = L - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

/** `[r,g,b]` → the `"R G B"` triplet a CSS custom property holds. */
export function toChannels([r, g, b]: [number, number, number]): string {
  return `${r} ${g} ${b}`;
}

/**
 * Brand colour → the full ramp, as CSS-variable channel strings.
 *
 * The reference palette supplies the LIGHTNESS curve; the tenant supplies hue
 * and saturation. That is what keeps a themed widget looking like the design:
 * the relationships between stops — which one is a wash, which carries white
 * text — are the design's, whatever colour is poured into them.
 */
export function buildThemeRamp(brandHex: string): Record<number, string> | null {
  const rgb = parseHex(brandHex);
  if (!rgb) return null;
  const [h, s, l] = rgbToHsl(rgb);
  // Slide the whole curve so the 500 slot lands on the brand's own lightness.
  // Without this a dark brand would sit at 500 with a LIGHTER 600 above it, and
  // every hover state in the widget would brighten instead of deepen.
  const shift = l - RAMP_LIGHTNESS[500];
  const ramp: Record<number, string> = {};
  for (const stop of RAMP_STOPS) {
    // The 500 slot is the tenant's colour verbatim — rounding it through HSL
    // would hand back something almost-but-not-quite what they typed.
    if (stop === 500) {
      ramp[stop] = toChannels(rgb);
      continue;
    }
    // Clamp to the full 0..100 range, not an inset one. Insetting collides with
    // the verbatim 500: #000000 pinned the other stops at 2% and produced a 600
    // BRIGHTER than 500, and #FFFFFF did the mirror image at 400 — in both cases
    // every hover in the widget inverted.
    const target = Math.min(100, Math.max(0, RAMP_LIGHTNESS[stop] + shift));
    ramp[stop] = toChannels(hslToRgb(h, s, target));
  }
  return ramp;
}

/** Every CSS custom property a themed widget sets, ready to write to :root. */
export function buildThemeVariables(theme: WidgetTheme | null | undefined): Record<string, string> {
  const rgb = theme ? parseHex(theme.brand) : null;
  const ramp = rgb && theme ? buildThemeRamp(theme.brand) : null;
  if (!rgb || !ramp) return {};
  const vars: Record<string, string> = {};
  for (const stop of RAMP_STOPS) vars[`--ivy-primary-${stop}`] = ramp[stop];
  vars['--ivy-on-primary'] = toChannels(readableForeground(rgb));
  if (theme?.headerStyle === WIDGET_HEADER_STYLE.BRAND) {
    vars['--ivy-header-bg'] = toChannels(rgb);
    vars['--ivy-header-fg'] = toChannels(readableForeground(rgb));
    // The white header can afford to dim its idle icons (ink at 60% is still
    // ~11:1); a brand header cannot — its foreground already sits at the
    // contrast floor, so dimming would push the icons under it.
    vars['--ivy-header-dim'] = '1';
  }
  // Design profile (P2). Each token is only written when configured, so an
  // unthemed part keeps the stylesheet's own default — same stance as the ramp.
  const design = theme?.design;
  if (design?.font) {
    vars['--ivy-font-family'] =
      design.font.preset === FONT_PRESET.CUSTOM
        ? `'${CUSTOM_FONT_FAMILY}', ${FONT_STACKS.pretendard}`
        : FONT_STACKS[design.font.preset];
    // Root font size: rem-based text AND spacing scale together, like a zoom,
    // which keeps line heights and bubbles proportional at every size.
    vars['--ivy-root-size'] = `${((16 * design.font.baseSize) / DESIGN_LIMITS.baseSize.default).toFixed(2)}px`;
  }
  if (design?.radius) Object.assign(vars, radiusVars(design.radius));
  if (design?.panel) {
    vars['--ivy-panel-w'] = `${design.panel.width}px`;
    vars['--ivy-panel-h'] = `${design.panel.height}px`;
  }
  return vars;
}

/** Open-panel frame the loader must reserve (widget and loader agree through this). */
export function panelFrame(theme: WidgetTheme | null | undefined): { w: number; h: number } {
  const panel = theme?.design?.panel ?? {
    width: DESIGN_LIMITS.panel.width.default,
    height: DESIGN_LIMITS.panel.height.default,
  };
  return { w: panel.width + PANEL_FRAME_PAD.w, h: panel.height + PANEL_FRAME_PAD.h };
}

const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

export function normalizeAssetRef(input: unknown): WidgetAssetRef | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<WidgetAssetRef>;
  if (typeof raw.uuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.uuid)) return null;
  const version = Number(raw.version);
  return { uuid: raw.uuid.toLowerCase(), version: Number.isFinite(version) && version > 0 ? Math.round(version) : 1 };
}

/**
 * Design profile, or null when nothing usable was configured. Out-of-range
 * values fall to the defaults rather than rejecting the save — like the
 * launcher, a bad number must not cost the tenant their colour (PLN D-5).
 */
export function normalizeDesign(input: unknown): WidgetDesign | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<WidgetDesign>;
  const out: WidgetDesign = {};
  if (raw.font && typeof raw.font === 'object') {
    const f = raw.font as Partial<WidgetFont>;
    const presets = Object.values(FONT_PRESET) as string[];
    let preset = presets.includes(f.preset as string) ? (f.preset as FontPreset) : FONT_PRESET.PRETENDARD;
    const asset = normalizeAssetRef(f.asset);
    // A custom preset without a file has nothing to draw with.
    if (preset === FONT_PRESET.CUSTOM && !asset) preset = FONT_PRESET.PRETENDARD;
    out.font = {
      preset,
      ...(preset === FONT_PRESET.CUSTOM && asset ? { asset } : {}),
      baseSize: clampInt(f.baseSize, DESIGN_LIMITS.baseSize.min, DESIGN_LIMITS.baseSize.max, DESIGN_LIMITS.baseSize.default),
    };
  }
  if ((Object.values(WIDGET_RADIUS) as string[]).includes(raw.radius as string)) out.radius = raw.radius as WidgetRadius;
  if (raw.panel && typeof raw.panel === 'object') {
    const p = raw.panel as Partial<WidgetPanelSize>;
    out.panel = {
      width: clampInt(p.width, DESIGN_LIMITS.panel.width.min, DESIGN_LIMITS.panel.width.max, DESIGN_LIMITS.panel.width.default),
      height: clampInt(p.height, DESIGN_LIMITS.panel.height.min, DESIGN_LIMITS.panel.height.max, DESIGN_LIMITS.panel.height.default),
    };
  }
  const icon = normalizeAssetRef(raw.launcherIcon);
  if (icon) out.launcherIcon = icon;
  if (raw.quickReplyStyle === QUICK_REPLY_STYLE.CARD) out.quickReplyStyle = QUICK_REPLY_STYLE.CARD;
  const reviewLink = normalizeReviewLinkTemplate(raw.reviewLinkTemplate);
  if (reviewLink) out.reviewLinkTemplate = reviewLink;
  if (typeof raw.customCss === 'string' && raw.customCss.trim()) {
    out.customCss = raw.customCss.trim().slice(0, CUSTOM_CSS_MAX_CHARS);
  }
  return Object.keys(out).length ? out : null;
}

export const REVIEW_LINK_TOKEN = '{productUrl}';
const REVIEW_LINK_MAX_CHARS = 512;

/**
 * A usable review-link template, or null. Invalid input degrades to "the
 * product page" rather than failing the save — same stance as the rest of the
 * design (one bad field must not cost the tenant their colour).
 */
export function normalizeReviewLinkTemplate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const tpl = input.trim();
  if (!tpl || tpl.length > REVIEW_LINK_MAX_CHARS || !tpl.includes(REVIEW_LINK_TOKEN)) return null;
  // The bare token is the default; storing it would only add noise.
  if (tpl === REVIEW_LINK_TOKEN) return null;
  if (tpl.startsWith(REVIEW_LINK_TOKEN)) return tpl;
  return /^https?:\/\/[^\s]+$/i.test(tpl) ? tpl : null;
}

/**
 * The link behind a review button: the product page run through the tenant's
 * template. Null when there is no product URL (the widget then opens its own
 * form) or the result is not an absolute http(s) URL.
 */
export function reviewLinkFor(template: string | null | undefined, productUrl: string | null | undefined): string | null {
  if (!productUrl || !/^https?:\/\//i.test(productUrl)) return null;
  const tpl = normalizeReviewLinkTemplate(template);
  if (!tpl) return productUrl;
  const out = tpl.startsWith(REVIEW_LINK_TOKEN)
    ? productUrl + tpl.slice(REVIEW_LINK_TOKEN.length)
    : tpl.split(REVIEW_LINK_TOKEN).join(encodeURIComponent(productUrl));
  return /^https?:\/\//i.test(out) ? out : null;
}

/** The theme a shopper may receive: custom CSS only while the add-on is on. */
export function stripCustomCss(theme: WidgetTheme | null, allowed: boolean): WidgetTheme | null {
  if (!theme?.design?.customCss || allowed) return theme;
  const { customCss: _dropped, ...rest } = theme.design;
  void _dropped;
  return { ...theme, design: Object.keys(rest).length ? rest : null };
}

/**
 * Clean a stored/submitted theme. Returns null for "not configured", which the
 * readers treat as the built-in palette — an unusable colour must never become
 * a widget nobody can read, so it degrades to the default rather than throwing.
 */
export function normalizeWidgetTheme(input: unknown): WidgetTheme | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<WidgetTheme>;
  const rgb = parseHex(raw.brand);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  const theme: WidgetTheme = {
    brand: hex,
    headerStyle:
      raw.headerStyle === WIDGET_HEADER_STYLE.BRAND
        ? WIDGET_HEADER_STYLE.BRAND
        : WIDGET_HEADER_STYLE.WHITE,
  };

  // Unlike the brand colour, a bad logo or launcher value is NOT a reason to
  // throw the whole theme away — the colour is the part that can render an
  // unreadable widget. These fall back to "not set" and "the built-in geometry".
  const logo = normalizeLogo(raw.logo);
  if (logo) theme.logo = logo;
  const launcher = normalizeLauncher(raw.launcher);
  if (launcher) theme.launcher = launcher;
  const design = normalizeDesign(raw.design);
  if (design) theme.design = design;
  // A custom launcher icon needs its file; without one, draw the default.
  if (theme.launcher?.icon === LAUNCHER_ICON.CUSTOM && !design?.launcherIcon) {
    theme.launcher = { ...theme.launcher, icon: LAUNCHER_DEFAULTS.icon };
  }
  return theme;
}

/** A stored logo is only usable if every field the URL and layout need is there. */
const LOGO_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function normalizeLogo(input: unknown): WidgetLogo | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<WidgetLogo>;
  if (typeof raw.id !== 'string' || !/^[0-9a-f-]{6,64}$/i.test(raw.id)) return null;
  if (typeof raw.ext !== 'string' || !/^[a-z0-9]{2,5}$/i.test(raw.ext)) return null;
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  // The mime is replayed as a public Content-Type, and this function is the
  // only place stored JSON crosses back into the app. Derive it from the
  // extension rather than trusting the column: a stray control character would
  // throw inside setHeader (a 500 on a public asset), and an arbitrary type
  // would change how the browser renders the file.
  const ext = raw.ext.toLowerCase();
  const mime = LOGO_MIME_BY_EXT[ext];
  if (!mime) return null;

  return {
    id: raw.id,
    ext,
    mime,
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * Launcher geometry, or null when nothing was configured. Every field is an
 * enum: an unknown value silently becomes the default rather than rejecting the
 * save, because a typo in one radio should not cost the tenant their colour.
 */
export function normalizeLauncher(input: unknown): WidgetLauncher | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<WidgetLauncher>;
  const position = Object.values(LAUNCHER_POSITION).includes(raw.position as LauncherPosition)
    ? (raw.position as LauncherPosition)
    : LAUNCHER_DEFAULTS.position;
  const size = Object.values(LAUNCHER_SIZE).includes(raw.size as LauncherSize)
    ? (raw.size as LauncherSize)
    : LAUNCHER_DEFAULTS.size;
  const icon = Object.values(LAUNCHER_ICON).includes(raw.icon as LauncherIcon)
    ? (raw.icon as LauncherIcon)
    : LAUNCHER_DEFAULTS.icon;
  const out: WidgetLauncher = { position, size, icon };
  // Trigger mode (PLN-260916 P2). Accepts the console's camelCase and the API's
  // snake_case so a request DTO can pass the object through untouched.
  const loose = raw as Record<string, unknown>;
  if (raw.mode === LAUNCHER_MODE.TRIGGER) {
    out.mode = LAUNCHER_MODE.TRIGGER;
    const off = Number(loose.offsetTop ?? loose.offset_top);
    out.offsetTop = Number.isFinite(off)
      ? Math.min(TRIGGER_OFFSET.max, Math.max(TRIGGER_OFFSET.min, Math.round(off)))
      : TRIGGER_OFFSET.default;
    const sel = String(loose.triggerSelector ?? loose.trigger_selector ?? '').trim();
    out.triggerSelector = sel && TRIGGER_SELECTOR_RE.test(sel) ? sel : null;
  }
  return out;
}

/** Geometry a reader can rely on, defaults included. */
export function resolveLauncher(theme: WidgetTheme | null | undefined): WidgetLauncher {
  return theme?.launcher ?? { ...LAUNCHER_DEFAULTS };
}
