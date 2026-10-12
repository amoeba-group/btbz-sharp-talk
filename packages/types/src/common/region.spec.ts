import {
  duplicateProvinces,
  normalizeProvince,
  regionLabelOf,
  resolveHotelRegion,
  type RegionRoutingConfig,
} from './region';

/**
 * Province → region (PLN-261007-Hotel-Region-Routing). The table is tenant
 * data, so what is pinned here is how a province NAME is matched: the host
 * sends whatever its own database holds, and a miss silently falls back to
 * un-regioned routing.
 */
const CONFIG: RegionRoutingConfig = {
  enabled: true,
  categories: [
    { id: 'north', team: 'north', provinces: ['Hà Nội', 'Hải Phòng'] },
    { id: 'north_central', team: 'north', provinces: ['Thanh Hóa', 'Nghệ An', 'Thừa Thiên Huế'] },
    { id: 'south_central', team: 'south', provinces: ['Đà Nẵng', 'Khánh Hòa', 'DN'] },
    { id: 'south', team: 'south', provinces: ['Thành phố Hồ Chí Minh', 'Cần Thơ'] },
  ],
};

describe('normalizeProvince', () => {
  it('drops diacritics, case, punctuation and đ', () => {
    expect(normalizeProvince('Hà Nội')).toBe('ha noi');
    expect(normalizeProvince('  ĐÀ  NẴNG ')).toBe('da nang');
    expect(normalizeProvince('Bà Rịa - Vũng Tàu')).toBe('ba ria vung tau');
  });

  it('drops the administrative prefix, whichever way it is written', () => {
    expect(normalizeProvince('TP. Hồ Chí Minh')).toBe('ho chi minh');
    expect(normalizeProvince('Thành phố Hồ Chí Minh')).toBe('ho chi minh');
    expect(normalizeProvince('Tỉnh Thanh Hóa')).toBe('thanh hoa');
    expect(normalizeProvince('Thủ đô Hà Nội')).toBe('ha noi');
  });

  it('never clips a province that merely starts with prefix letters', () => {
    expect(normalizeProvince('Thanh Hóa')).toBe('thanh hoa');
    expect(normalizeProvince('Tinh')).toBe('tinh');
  });

  it('is empty for blank input and keeps short codes', () => {
    expect(normalizeProvince(null)).toBe('');
    expect(normalizeProvince(undefined)).toBe('');
    expect(normalizeProvince('   ')).toBe('');
    expect(normalizeProvince('HN')).toBe('hn');
    expect(normalizeProvince('79')).toBe('79');
  });
});

describe('resolveHotelRegion', () => {
  it('maps a province to its category and team', () => {
    expect(resolveHotelRegion(CONFIG, 'Hà Nội')).toEqual({ category: 'north', team: 'north' });
    expect(resolveHotelRegion(CONFIG, 'Nghệ An')).toEqual({ category: 'north_central', team: 'north' });
    expect(resolveHotelRegion(CONFIG, 'Đà Nẵng')).toEqual({ category: 'south_central', team: 'south' });
    expect(resolveHotelRegion(CONFIG, 'Cần Thơ')).toEqual({ category: 'south', team: 'south' });
  });

  it('matches however the host spells it', () => {
    for (const spelling of ['ho chi minh', 'TP. Hồ Chí Minh', 'THÀNH PHỐ HỒ CHÍ MINH', 'Tp Ho Chi Minh']) {
      expect(resolveHotelRegion(CONFIG, spelling)).toEqual({ category: 'south', team: 'south' });
    }
    // Huế (the city) and Thừa Thiên Huế (the old province) are one place (PLN-261012
    // SG-61): a table that lists either matches a host that sends either.
    expect(resolveHotelRegion(CONFIG, 'hue')).toEqual({ category: 'north_central', team: 'north' });
    expect(resolveHotelRegion(CONFIG, 'Huế')).toEqual({ category: 'north_central', team: 'north' });
    expect(resolveHotelRegion(CONFIG, 'thua thien hue')).toEqual({ category: 'north_central', team: 'north' });
    expect(resolveHotelRegion(CONFIG, 'Hoi An')).toBeNull();
  });

  it('accepts a code the tenant listed', () => {
    expect(resolveHotelRegion(CONFIG, 'dn')).toEqual({ category: 'south_central', team: 'south' });
  });

  it('is null when routing is off, the province is blank or unlisted', () => {
    expect(resolveHotelRegion({ ...CONFIG, enabled: false }, 'Hà Nội')).toBeNull();
    expect(resolveHotelRegion(null, 'Hà Nội')).toBeNull();
    expect(resolveHotelRegion(CONFIG, '')).toBeNull();
    expect(resolveHotelRegion(CONFIG, null)).toBeNull();
    expect(resolveHotelRegion(CONFIG, 'Vientiane')).toBeNull();
    expect(resolveHotelRegion({ enabled: true }, 'Hà Nội')).toBeNull();
  });

  it('first category wins for a duplicated province, deterministically', () => {
    const cfg: RegionRoutingConfig = {
      enabled: true,
      categories: [
        { id: 'north_central', team: 'north', provinces: ['Huế'] },
        { id: 'south_central', team: 'south', provinces: ['Huế'] },
      ],
    };
    expect(resolveHotelRegion(cfg, 'hue')).toEqual({ category: 'north_central', team: 'north' });
    expect(duplicateProvinces(cfg)).toEqual(['thua thien hue']);
    expect(duplicateProvinces(CONFIG)).toEqual([]);
  });

  it('ignores rows with an unknown category id and repairs a bad team', () => {
    const cfg = {
      enabled: true,
      categories: [
        { id: 'central', team: 'north', provinces: ['Huế'] },
        { id: 'south_central', team: 'west', provinces: ['Đà Nẵng'] },
      ],
    } as unknown as RegionRoutingConfig;
    expect(resolveHotelRegion(cfg, 'Huế')).toBeNull();
    // A team that is not north/south falls back to the category's default team.
    expect(resolveHotelRegion(cfg, 'Đà Nẵng')).toEqual({ category: 'south_central', team: 'south' });
  });
});

describe('regionLabelOf', () => {
  it('names team and category once when they differ, once when they match', () => {
    expect(regionLabelOf({ category: 'south_central', team: 'south' })).toBe('South (South Central)');
    expect(regionLabelOf({ category: 'north', team: 'north' })).toBe('North');
    expect(regionLabelOf({ category: 'south', team: 'south' }, 'Miền Nam')).toBe('South (Miền Nam)');
  });
});
