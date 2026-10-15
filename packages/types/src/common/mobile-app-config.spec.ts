import { mergeAppSurface, MOBILE_APP_DEFAULTS, normalizeMobileAppConfig } from './mobile-app-config';
import type { WidgetTheme } from './widget-theme';

describe('normalizeMobileAppConfig', () => {
  it('is null when nothing was configured', () => {
    for (const v of [null, undefined, 'x', 3, []]) expect(normalizeMobileAppConfig(v)).toBeNull();
  });

  it('fills every missing field with the default instead of storing a hole', () => {
    expect(normalizeMobileAppConfig({})).toEqual(MOBILE_APP_DEFAULTS);
  });

  it('replaces an unknown value with the default and keeps the rest', () => {
    const c = normalizeMobileAppConfig({ app: { font: 'comic', menuStyle: 'chip', header: 'both', fontSize: 'big' }, minSdk: '9.9.9' })!;
    expect(c.app).toMatchObject({ font: 'system', menuStyle: 'chip', header: 'native', fontSize: 14 });
    expect(c.minSdk).toBe('0.2.0');
  });

  it('clamps the text size to the web design range', () => {
    expect(normalizeMobileAppConfig({ app: { fontSize: 99 } })!.app.fontSize).toBe(16);
    expect(normalizeMobileAppConfig({ app: { fontSize: 2 } })!.app.fontSize).toBe(13);
    expect(normalizeMobileAppConfig({ app: { fontSize: 14.6 } })!.app.fontSize).toBe(15);
  });

  it('accepts a brand as 3/6-digit hex and stores #RRGGBB; anything else clears it', () => {
    expect(normalizeMobileAppConfig({ app: { brand: '#f26a1b' } })!.app.brand).toBe('#F26A1B');
    expect(normalizeMobileAppConfig({ app: { brand: 'fa0' } })!.app.brand).toBe('#FFAA00');
    expect(normalizeMobileAppConfig({ app: { brand: 'orange' } })!.app.brand).toBeNull();
  });

  it('drops bad entries, dedupes by screen, lowercases and bounds', () => {
    const c = normalizeMobileAppConfig({
      entries: [
        { screen: 'Bookings', agentCode: 'hotel-admin', contextLabel: ' Mã\r\nđặt phòng ' },
        { screen: 'bookings', agentCode: 'other' },
        { screen: 'bad screen!', agentCode: 'hotel-admin' },
        { screen: 'home', agentCode: '' },
        { screen: 'x'.repeat(50), agentCode: 'a' },
        null,
        'str',
        { screen: 'reconciliation', agentCode: 'hotel-admin' },
      ],
    })!;
    expect(c.entries).toEqual([
      { screen: 'bookings', agentCode: 'hotel-admin', contextLabel: 'Mã đặt phòng' },
      { screen: 'reconciliation', agentCode: 'hotel-admin', contextLabel: null },
    ]);
  });

  it('caps the number of entries', () => {
    const entries = Array.from({ length: 80 }, (_, i) => ({ screen: `s${i}`, agentCode: 'a' }));
    expect(normalizeMobileAppConfig({ entries })!.entries).toHaveLength(30);
  });
});

describe('mergeAppSurface', () => {
  const web: WidgetTheme = {
    brand: '#F26A1B',
    headerStyle: 'brand',
    design: { font: { preset: 'pretendard', baseSize: 14 }, quickReplyStyle: 'chip', reviewLinkTemplate: '{productUrl}#r' },
  };

  it('returns the web theme untouched when the app has no config', () => {
    expect(mergeAppSurface(web, null)).toBe(web);
  });

  it('applies the app font, size and menu style over the web design and keeps everything else', () => {
    const cfg = normalizeMobileAppConfig({ app: { font: 'system', fontSize: 15, menuStyle: 'card' } })!;
    const t = mergeAppSurface(web, cfg)!;
    expect(t.design?.font).toEqual({ preset: 'system', baseSize: 15 });
    expect(t.design?.quickReplyStyle).toBe('card');
    expect(t.design?.reviewLinkTemplate).toBe('{productUrl}#r');
    expect(t.headerStyle).toBe('brand');
    expect(t.brand).toBe('#F26A1B');
  });

  it('"same font as web" keeps the web preset and only changes the size', () => {
    const cfg = normalizeMobileAppConfig({ app: { font: 'web', fontSize: 16 } })!;
    expect(mergeAppSurface(web, cfg)!.design?.font).toMatchObject({ preset: 'pretendard', baseSize: 16 });
  });

  it('an app brand overrides the web brand only for the app', () => {
    const cfg = normalizeMobileAppConfig({ app: { brand: '#0EA5E9' } })!;
    expect(mergeAppSurface(web, cfg)!.brand).toBe('#0EA5E9');
    expect(web.brand).toBe('#F26A1B');
  });

  it('never invents a theme for an unthemed tenant, unless the app names its own brand', () => {
    expect(mergeAppSurface(null, normalizeMobileAppConfig({ app: { fontSize: 15 } }))).toBeNull();
    const t = mergeAppSurface(null, normalizeMobileAppConfig({ app: { brand: '#0EA5E9' } }))!;
    expect(t.brand).toBe('#0EA5E9');
    expect(t.headerStyle).toBe('white');
  });
});
