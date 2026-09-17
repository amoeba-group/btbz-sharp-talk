import {
  buildThemeRamp,
  buildThemeVariables,
  contrastRatio,
  normalizeWidgetTheme,
  parseHex,
  readableForeground,
  RAMP_STOPS,
  panelFrame,
  stripCustomCss,
  normalizeLauncher,
  clampRadius,
  radiusVars,
} from './widget-theme';

/**
 * A tenant picks one colour; everything a shopper actually reads is computed
 * from it. These pin the two properties that make that safe: the ramp keeps the
 * design's lightness relationships, and no brand colour can produce unreadable
 * text on a filled control.
 */
describe('parseHex', () => {
  it('accepts 3- and 6-digit hex, with or without the hash', () => {
    expect(parseHex('#2B7FFF')).toEqual([43, 127, 255]);
    expect(parseHex('2b7fff')).toEqual([43, 127, 255]);
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('  #000  ')).toEqual([0, 0, 0]);
  });

  it('rejects anything that is not a usable colour', () => {
    for (const bad of ['', 'blue', '#12', '#12345', 'rgb(1,2,3)', null, undefined, 42, {}]) {
      expect(parseHex(bad as never)).toBeNull();
    }
  });
});

describe('readableForeground', () => {
  it('puts white on dark brands and ink on light ones', () => {
    expect(readableForeground([28, 63, 138])).toEqual([255, 255, 255]); // deep navy
    expect(readableForeground([255, 212, 0])).toEqual([17, 24, 39]); // bright yellow
    expect(readableForeground([43, 127, 255])).toEqual([17, 24, 39]); // design blue: white is 3.8:1
    expect(readableForeground([0, 0, 0])).toEqual([255, 255, 255]);
    expect(readableForeground([255, 255, 255])).toEqual([17, 24, 39]);
    // The mid-tone band where neither white nor ink reaches 4.5 falls to black.
    expect(readableForeground([128, 128, 128])).toEqual([0, 0, 0]);
  });

  it('never lets a brand colour produce an illegible label', () => {
    // Swept across the hue circle at several lightnesses. The bar is 4.5:1 —
    // WCAG AA for TEXT, which is what sits on these fills (send button, message
    // bubble, order actions), not the 3:1 for UI components.
    for (let h = 0; h < 360; h += 15) {
      for (const l of [20, 40, 60, 80, 95]) {
        const ramp = buildThemeRamp(hslHex(h, 70, l))!;
        const brand = ramp[500].split(' ').map(Number) as [number, number, number];
        expect(contrastRatio(brand, readableForeground(brand))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('takes ink on the design blue, where white is only 3.8:1', () => {
    // The unthemed widget is unaffected — it never calls this function, its
    // white comes from index.css — but a tenant who THEMES with this same blue
    // gets ink, because 3.8:1 is not AA for text.
    const blue: [number, number, number] = [43, 127, 255];
    expect(contrastRatio(blue, [255, 255, 255])).toBeLessThan(4.5);
    expect(readableForeground(blue)).toEqual([17, 24, 39]);
  });
});

/** Small helper so the sweep above can express colours in HSL. */
function hslHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = L - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

describe('buildThemeRamp', () => {
  it('returns every stop the widget uses', () => {
    const ramp = buildThemeRamp('#E11D6B')!;
    expect(Object.keys(ramp).map(Number).sort((a, b) => a - b)).toEqual([...RAMP_STOPS].sort((a, b) => a - b));
  });

  it('hands back the tenant colour verbatim at 500', () => {
    // Round-tripping it through HSL would return something almost-but-not-quite
    // what they typed, and brand colours are the kind of thing people check.
    expect(buildThemeRamp('#E11D6B')![500]).toBe('225 29 107');
  });

  it('keeps the design lightness curve: 50 is lightest, 900 darkest', () => {
    const ramp = buildThemeRamp('#E11D6B')!;
    const sum = (s: number) => ramp[s].split(' ').reduce((a, c) => a + Number(c), 0);
    const ordered = [...RAMP_STOPS].sort((a, b) => a - b);
    for (let i = 1; i < ordered.length; i++) {
      expect(sum(ordered[i])).toBeLessThan(sum(ordered[i - 1]));
    }
  });

  it('reproduces the built-in palette when given its own brand colour', () => {
    // The safety net for "unconfigured must look identical": feeding the design
    // blue back in must land on the design blue.
    expect(buildThemeRamp('#2B7FFF')![500]).toBe('43 127 255');
  });

  it('stays ordered even at pure black and pure white', () => {
    // The extremes are where a clamped curve collides with the verbatim 500:
    // #000 used to yield a 600 brighter than 500, #FFF a 500 brighter than 400,
    // and either way every hover in the widget inverted.
    for (const brand of ['#000000', '#FFFFFF']) {
      const ramp = buildThemeRamp(brand)!;
      const sum = (stop: number) => ramp[stop].split(' ').reduce((a, c) => a + Number(c), 0);
      const ordered = [...RAMP_STOPS].sort((a, b) => a - b);
      for (let i = 1; i < ordered.length; i++) {
        expect(sum(ordered[i])).toBeLessThanOrEqual(sum(ordered[i - 1]));
      }
    }
  });

  it('returns null for an unusable colour rather than a broken ramp', () => {
    expect(buildThemeRamp('nope')).toBeNull();
  });
});

describe('buildThemeVariables', () => {
  it('is empty for an unconfigured tenant, leaving the CSS defaults in place', () => {
    expect(buildThemeVariables(null)).toEqual({});
    expect(buildThemeVariables(undefined)).toEqual({});
  });

  it('sets the ramp and the computed foreground', () => {
    const vars = buildThemeVariables({ brand: '#2B7FFF', headerStyle: 'white' });
    expect(vars['--ivy-primary-500']).toBe('43 127 255');
    // Ink, not white: white on this blue is 3.8:1, under AA for text. The
    // UNTHEMED widget still ships white — it never runs this function.
    expect(vars['--ivy-on-primary']).toBe('17 24 39');
  });

  it('leaves the header alone unless the tenant asked for a brand header', () => {
    const white = buildThemeVariables({ brand: '#E11D6B', headerStyle: 'white' });
    expect(white['--ivy-header-bg']).toBeUndefined();
    const brand = buildThemeVariables({ brand: '#E11D6B', headerStyle: 'brand' });
    expect(brand['--ivy-header-bg']).toBe('225 29 107');
    expect(brand['--ivy-header-fg']).toBe('255 255 255');
  });

  it('picks ink for a brand header that is too light for white', () => {
    const vars = buildThemeVariables({ brand: '#FFD400', headerStyle: 'brand' });
    expect(vars['--ivy-header-fg']).toBe('17 24 39');
  });
});

describe('normalizeWidgetTheme', () => {
  it('uppercases and expands the hex, defaulting the header style', () => {
    expect(normalizeWidgetTheme({ brand: '#e11d6b' })).toEqual({
      brand: '#E11D6B',
      headerStyle: 'white',
    });
    expect(normalizeWidgetTheme({ brand: '#fff' })!.brand).toBe('#FFFFFF');
  });

  it('keeps a brand header when asked', () => {
    expect(normalizeWidgetTheme({ brand: '#000', headerStyle: 'brand' })!.headerStyle).toBe('brand');
  });

  it('degrades to null instead of storing something unrenderable', () => {
    for (const bad of [null, undefined, 'blue', {}, { brand: 'nope' }, { headerStyle: 'brand' }]) {
      expect(normalizeWidgetTheme(bad as never)).toBeNull();
    }
  });

  it('ignores an unknown header style rather than trusting it', () => {
    expect(normalizeWidgetTheme({ brand: '#000', headerStyle: 'rainbow' as never })!.headerStyle).toBe(
      'white',
    );
  });
});

describe('design profile (PLN-260910 P2)', () => {
  it('clamps sizes to the allowed ranges and falls back for a custom font without a file', () => {
    const theme = normalizeWidgetTheme({
      brand: '#2B7FFF',
      design: {
        font: { preset: 'custom', baseSize: 40 },
        radius: 'xl',
        panel: { width: 9999, height: 10 },
        launcherIcon: { uuid: 'not-a-uuid' },
      },
      launcher: { icon: 'custom' },
    });
    expect(theme?.design).toEqual({
      font: { preset: 'pretendard', baseSize: 16 },
      panel: { width: 480, height: 480 },
    });
    // No icon file → the launcher cannot stay 'custom'.
    expect(theme?.launcher?.icon).toBe('chat');
  });

  it('keeps a valid custom font and writes the tokens the widget reads', () => {
    const uuid = '94c2949c-3ce5-47be-acb3-3c4cfa7c58b3';
    const theme = normalizeWidgetTheme({
      brand: '#2B7FFF',
      design: { font: { preset: 'custom', asset: { uuid, version: 3 }, baseSize: 15 }, radius: 'lg', panel: { width: 420, height: 700 } },
    });
    expect(theme?.design?.font).toEqual({ preset: 'custom', asset: { uuid, version: 3 }, baseSize: 15 });
    const vars = buildThemeVariables(theme);
    expect(vars['--ivy-font-family']).toMatch(/^'IvyTenantFont', 'Pretendard'/);
    expect(vars['--ivy-root-size']).toBe('17.14px');
    expect(vars['--ivy-radius']).toBe('16px');
    expect(vars['--ivy-panel-w']).toBe('420px');
    expect(panelFrame(theme)).toEqual({ w: 460, h: 780 });
  });

  it('writes no design tokens and the default frame when nothing is configured', () => {
    const theme = normalizeWidgetTheme({ brand: '#2B7FFF' });
    const vars = buildThemeVariables(theme);
    expect(Object.keys(vars).some((k) => k.startsWith('--ivy-font') || k.startsWith('--ivy-panel'))).toBe(false);
    // No radius step either: the panel falls back to the built-in 6/8/12/16px,
    // which is what an unthemed widget has always rendered (POL-001 Rule 4).
    expect(Object.keys(vars).some((k) => k.startsWith('--ivy-radius'))).toBe(false);
    expect(panelFrame(theme)).toEqual({ w: 444, h: 680 });
  });
});

describe('radius scale (POL-001, FIX-260917)', () => {
  // The whole point of the calibration: at `md` every derived step equals the
  // value that was hardcoded before the token existed, so the tenants already
  // on the default see nothing change.
  it.each([
    ['sm', { '--ivy-radius': '8px', '--ivy-radius-xs': '3px', '--ivy-radius-sm': '4px', '--ivy-radius-md': '5px', '--ivy-radius-lg': '8px', '--ivy-radius-xl': '11px' }],
    // `md` is the calibration row: every value here is what the component
    // hardcoded before the token existed (bare rounded, md, lg, xl, 2xl).
    ['md', { '--ivy-radius': '12px', '--ivy-radius-xs': '4px', '--ivy-radius-sm': '6px', '--ivy-radius-md': '8px', '--ivy-radius-lg': '12px', '--ivy-radius-xl': '16px' }],
    ['lg', { '--ivy-radius': '16px', '--ivy-radius-xs': '5px', '--ivy-radius-sm': '8px', '--ivy-radius-md': '11px', '--ivy-radius-lg': '16px', '--ivy-radius-xl': '21px' }],
  ] as const)('derives the documented scale for %s', (radius, expected) => {
    expect(radiusVars(radius)).toEqual(expected);
    // buildThemeVariables must publish exactly what radiusVars says — the
    // console preview reads the same function, and a divergence here is the
    // editor lying to the tenant again.
    const vars = buildThemeVariables(normalizeWidgetTheme({ brand: '#2B7FFF', design: { radius } }));
    for (const [k, v] of Object.entries(expected)) expect(vars[k]).toBe(v);
  });

  it('keeps a derived step a corner, not a hairline or a pill', () => {
    expect([0, 1, 27, 40].map(clampRadius)).toEqual([2, 2, 27, 28]);
  });
});

describe('custom CSS delivery (PLN-260910 P5)', () => {
  it('keeps the sanitized css in the design and strips it for delivery when the add-on is off', () => {
    const theme = normalizeWidgetTheme({ brand: '#2B7FFF', design: { radius: 'sm', customCss: '  .st-header { color: red; }  ' } });
    expect(theme?.design?.customCss).toBe('.st-header { color: red; }');
    expect(stripCustomCss(theme, true)?.design?.customCss).toBe('.st-header { color: red; }');
    const off = stripCustomCss(theme, false);
    expect(off?.design).toEqual({ radius: 'sm' });
    expect(stripCustomCss(normalizeWidgetTheme({ brand: '#2B7FFF', design: { customCss: 'x' } }), false)?.design).toBeNull();
  });
});

describe('normalizeLauncher trigger mode (PLN-260916 P2)', () => {
  it('keeps floating launchers exactly as before', () => {
    expect(normalizeLauncher({ position: 'left', size: 'lg', icon: 'chat' })).toEqual({ position: 'left', size: 'lg', icon: 'chat' });
  });
  it('accepts trigger mode with a clamped offset and a sanitized selector, camel or snake', () => {
    expect(normalizeLauncher({ position: 'right', size: 'md', icon: 'chat', mode: 'trigger', offsetTop: 999, triggerSelector: '#st-bell' })).toEqual({
      position: 'right', size: 'md', icon: 'chat', mode: 'trigger', offsetTop: 240, triggerSelector: '#st-bell',
    });
    expect(normalizeLauncher({ mode: 'trigger', offset_top: -5, trigger_selector: '<script>' })).toMatchObject({ mode: 'trigger', offsetTop: 0, triggerSelector: null });
    expect(normalizeLauncher({ mode: 'trigger' })).toMatchObject({ mode: 'trigger', offsetTop: 72 });
  });
  it('drops an unknown mode', () => {
    expect(normalizeLauncher({ mode: 'sidebar' })).not.toHaveProperty('mode');
  });
});
