import { canonicalRegion, isRegionCode, provinceKey, REGION_CODES } from './region';

/** PLN-261022 stage 1 — one code per region whatever spelling the host signs. */
describe('canonicalRegion', () => {
  it('folds the Go2Joy table text and aliases to catalogue codes', () => {
    expect(canonicalRegion('North Center')).toBe('north_center');
    expect(canonicalRegion(' south center ')).toBe('south_center');
    expect(canonicalRegion('North Central')).toBe('north_center');
    expect(canonicalRegion('south-central')).toBe('south_center');
    expect(canonicalRegion('SOUTH')).toBe('south');
    for (const code of REGION_CODES) expect(canonicalRegion(code)).toBe(code);
  });

  it('keeps an uncatalogued value (folded) instead of dropping it', () => {
    expect(canonicalRegion('Metro Manila')).toBe('metro_manila');
    expect(isRegionCode('metro_manila')).toBe(false);
  });

  it('empty and non-strings read as no region', () => {
    expect(canonicalRegion('')).toBe('');
    expect(canonicalRegion('   ')).toBe('');
    expect(canonicalRegion(null)).toBe('');
    expect(canonicalRegion(5)).toBe('');
  });
});

describe('provinceKey', () => {
  it('treats composed and decomposed Vietnamese as the same province', () => {
    const nfc = 'Hồ Chí Minh';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(provinceKey(nfd)).toBe(provinceKey(nfc));
    expect(provinceKey('  hồ   chí minh ')).toBe(provinceKey(nfc));
  });
});
