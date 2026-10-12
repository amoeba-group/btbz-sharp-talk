import {
  duplicateProvinces,
  normalizeProvince,
  REGION_CATEGORIES,
  resolveHotelRegion,
  type RegionCategory,
  type RegionRoutingConfig,
} from './region';
import { VN_PROVINCE_UNITS, VN_REGION_PRESET, vnRegionPresetRules } from './region-vn';

/**
 * Vietnam province preset and the spelling-tolerant matcher (PLN-261012 SG-61,
 * REQ D-14). The oracle below is written out by hand, independently of the preset's
 * own data, so a typo or a province filed under the wrong region fails here.
 */

const PRESET: RegionRoutingConfig = { enabled: true, categories: vnRegionPresetRules() };
const team = (c: RegionCategory) => (c === 'north' || c === 'north_central' ? 'north' : 'south');
const hit = (province: string | null | undefined) => resolveHotelRegion(PRESET, province);

/** The 63 provinces before 2025-07-01, by region. Hải Vân pass / Huế | Đà Nẵng is the north_central | south_central line. */
const OLD_63: Record<RegionCategory, string[]> = {
  north: [
    'Hà Nội', 'Hải Phòng', 'Quảng Ninh', 'Hải Dương', 'Hưng Yên', 'Thái Bình', 'Hà Nam', 'Nam Định', 'Ninh Bình',
    'Vĩnh Phúc', 'Bắc Ninh', 'Bắc Giang', 'Phú Thọ', 'Thái Nguyên', 'Bắc Kạn', 'Cao Bằng', 'Lạng Sơn', 'Tuyên Quang',
    'Hà Giang', 'Lào Cai', 'Yên Bái', 'Lai Châu', 'Điện Biên', 'Sơn La', 'Hòa Bình',
  ],
  north_central: ['Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Quảng Bình', 'Quảng Trị', 'Thừa Thiên Huế'],
  south_central: [
    'Đà Nẵng', 'Quảng Nam', 'Quảng Ngãi', 'Bình Định', 'Phú Yên', 'Khánh Hòa', 'Ninh Thuận', 'Bình Thuận',
    'Kon Tum', 'Gia Lai', 'Đắk Lắk', 'Đắk Nông', 'Lâm Đồng',
  ],
  south: [
    'TP. Hồ Chí Minh', 'Bình Dương', 'Đồng Nai', 'Bà Rịa - Vũng Tàu', 'Tây Ninh', 'Bình Phước', 'Cần Thơ', 'Long An',
    'Tiền Giang', 'Bến Tre', 'Trà Vinh', 'Vĩnh Long', 'Đồng Tháp', 'An Giang', 'Kiên Giang', 'Hậu Giang', 'Sóc Trăng',
    'Bạc Liêu', 'Cà Mau',
  ],
};

/** The 34 units since 2025-07-01, by region. */
const NEW_34: Record<RegionCategory, string[]> = {
  north: [
    'Hà Nội', 'Hải Phòng', 'Quảng Ninh', 'Bắc Ninh', 'Hưng Yên', 'Ninh Bình', 'Phú Thọ', 'Thái Nguyên', 'Tuyên Quang',
    'Lào Cai', 'Cao Bằng', 'Lạng Sơn', 'Lai Châu', 'Điện Biên', 'Sơn La',
  ],
  north_central: ['Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Quảng Trị', 'Huế'],
  south_central: ['Đà Nẵng', 'Quảng Ngãi', 'Gia Lai', 'Đắk Lắk', 'Khánh Hòa', 'Lâm Đồng'],
  south: ['TP. Hồ Chí Minh', 'Đồng Nai', 'Tây Ninh', 'Cần Thơ', 'Vĩnh Long', 'Đồng Tháp', 'Cà Mau', 'An Giang'],
};

/** Merger table (Resolution 202/2025/QH15): new unit → old provinces it absorbed besides its own name. */
const MERGERS: Array<[string, string[]]> = [
  ['Tuyên Quang', ['Hà Giang']],
  ['Lào Cai', ['Yên Bái']],
  ['Thái Nguyên', ['Bắc Kạn']],
  ['Phú Thọ', ['Vĩnh Phúc', 'Hòa Bình']],
  ['Bắc Ninh', ['Bắc Giang']],
  ['Hưng Yên', ['Thái Bình']],
  ['Hải Phòng', ['Hải Dương']],
  ['Ninh Bình', ['Hà Nam', 'Nam Định']],
  ['Quảng Trị', ['Quảng Bình']],
  ['Đà Nẵng', ['Quảng Nam']],
  ['Quảng Ngãi', ['Kon Tum']],
  ['Gia Lai', ['Bình Định']],
  ['Khánh Hòa', ['Ninh Thuận']],
  ['Lâm Đồng', ['Đắk Nông', 'Bình Thuận']],
  ['Đắk Lắk', ['Phú Yên']],
  ['TP. Hồ Chí Minh', ['Bình Dương', 'Bà Rịa - Vũng Tàu']],
  ['Đồng Nai', ['Bình Phước']],
  ['Tây Ninh', ['Long An']],
  ['Cần Thơ', ['Sóc Trăng', 'Hậu Giang']],
  ['Vĩnh Long', ['Bến Tre', 'Trà Vinh']],
  ['Đồng Tháp', ['Tiền Giang']],
  ['Cà Mau', ['Bạc Liêu']],
  ['An Giang', ['Kiên Giang']],
];

describe('Vietnam region preset — shape', () => {
  it('has the four categories with the default team of each', () => {
    const rules = vnRegionPresetRules();
    expect(rules.map((r) => r.id)).toEqual([...REGION_CATEGORIES]);
    expect(rules.map((r) => r.team)).toEqual(['north', 'north', 'south', 'south']);
    for (const r of rules) expect(r.provinces.length).toBeGreaterThan(0);
  });

  it('is 34 units covering the 63 old provinces, as the oracle counts them', () => {
    expect(Object.values(OLD_63).flat()).toHaveLength(63);
    expect(Object.values(NEW_34).flat()).toHaveLength(34);
    const units = REGION_CATEGORIES.flatMap((c) => VN_PROVINCE_UNITS[c]);
    expect(units).toHaveLength(34);
    // Every old name is a unit name or an absorbed ("formerly") name, once.
    const old = units.flatMap((u) => [u.name, ...(u.formerly ?? [])]).map(normalizeProvince);
    for (const n of Object.values(OLD_63).flat()) expect(old).toContain(normalizeProvince(n));
  });

  it('hands out fresh arrays, so editing a loaded table never edits the preset', () => {
    const a = vnRegionPresetRules();
    a[0].provinces.push('X');
    expect(vnRegionPresetRules()[0].provinces).not.toContain('X');
    expect(VN_REGION_PRESET.north).not.toContain('X');
  });
});

describe('Vietnam region preset — every name resolves to its region', () => {
  for (const category of REGION_CATEGORIES) {
    it(`${category}: the old (63) names`, () => {
      for (const name of OLD_63[category]) {
        expect({ name, got: hit(name)?.category }).toEqual({ name, got: category });
        expect(hit(name)?.team).toBe(team(category));
      }
    });
    it(`${category}: the new (34) names`, () => {
      for (const name of NEW_34[category]) {
        expect({ name, got: hit(name)?.category }).toEqual({ name, got: category });
      }
    });
  }

  it('the line between north-central and south-central is Huế | Đà Nẵng', () => {
    expect(hit('Huế')).toEqual({ category: 'north_central', team: 'north' });
    expect(hit('Thừa Thiên Huế')).toEqual({ category: 'north_central', team: 'north' });
    expect(hit('Quảng Trị')).toEqual({ category: 'north_central', team: 'north' });
    expect(hit('Đà Nẵng')).toEqual({ category: 'south_central', team: 'south' });
    expect(hit('Quảng Nam')).toEqual({ category: 'south_central', team: 'south' });
  });

  it('every string the preset lists resolves back to the category it is listed under', () => {
    for (const category of REGION_CATEGORIES) {
      for (const name of VN_REGION_PRESET[category]) {
        expect({ name, got: hit(name)?.category }).toEqual({ name, got: category });
      }
    }
  });
});

describe('Vietnam region preset — invariants', () => {
  it('no province appears in two categories', () => {
    expect(duplicateProvinces(PRESET)).toEqual([]);
    const owner = new Map<string, RegionCategory>();
    for (const category of REGION_CATEGORIES) {
      for (const name of VN_REGION_PRESET[category]) {
        const key = normalizeProvince(name);
        expect({ name, key, owner: owner.get(key) ?? category }).toEqual({ name, key, owner: category });
        owner.set(key, category);
      }
    }
  });

  it('a merged unit never straddles a category: it and everything it absorbed share one', () => {
    for (const [unit, absorbed] of MERGERS) {
      const home = hit(unit)?.category;
      expect({ unit, home }).not.toEqual({ unit, home: undefined });
      for (const old of absorbed) expect({ unit, old, got: hit(old)?.category }).toEqual({ unit, old, got: home });
    }
    // 23 merged units + 11 that kept their territory = 34.
    expect(MERGERS).toHaveLength(23);
  });
});

describe('Vietnam region preset — how hosts spell it', () => {
  const south = { category: 'south', team: 'south' };
  const north = { category: 'north', team: 'north' };
  const northCentral = { category: 'north_central', team: 'north' };
  const southCentral = { category: 'south_central', team: 'south' };

  it.each([
    ['TP. Hồ Chí Minh', south],
    ['TP.HCM', south],
    ['TP HCM', south],
    ['TPHCM', south],
    ['HCMC', south],
    ['hcmc', south],
    ['Ho Chi Minh City', south],
    ['Ho Chi Minh City, Vietnam', south],
    ['Hồ Chí Minh', south],
    ['Thành phố Hồ Chí Minh, Việt Nam', south],
    ['Sài Gòn', south],
    ['Saigon', south],
    ['Bà Rịa – Vũng Tàu', south],
    ['Ba Ria Vung Tau', south],
    ['BR-VT', south],
    ['Bình Dương', south],
    ['Hà Nội', north],
    ['Ha Noi', north],
    ['Hanoi', north],
    ['HA NOI', north],
    ['Hanoi City', north],
    ['Thủ đô Hà Nội', north],
    ['Hoà Bình', north], // tone mark on the o (old style)
    ['Hòa Bình', north], // tone mark on the a (new style)
    ['Hoa Binh', north],
    ['Hải Phòng', north],
    ['Hai Phong', north],
    ['Huế', northCentral],
    ['Hue', northCentral],
    ['TT Huế', northCentral],
    ['TT. Huế', northCentral],
    ['Thừa Thiên Huế', northCentral],
    ['Thua Thien Hue', northCentral],
    ['Thành phố Huế', northCentral],
    ['Hue City', northCentral],
    ['Tỉnh Thanh Hóa', northCentral],
    ['Thanh Hoa Province', northCentral],
    ['Đà Nẵng', southCentral],
    ['Ðà Nẵng', southCentral], // U+00D0, the legacy-encoded capital Đ
    ['Ðà Nẵng', southCentral],
    ['Da Nang', southCentral],
    ['Danang', southCentral],
    ['Da Nang City', southCentral],
    ['Đà Nẵng, Việt Nam', southCentral],
    ['Đắk Lắk', southCentral],
    ['Đắc Lắc', southCentral],
    ['Dak Lak', southCentral],
    ['Daklak', southCentral],
    ['Dac Lac', southCentral],
    ['Đắk Nông', southCentral],
    ['Kontum', southCentral],
    ['Bình Thuận', southCentral],
    ['Đồng Nai', south],
    ['Ðồng Nai', south],
  ])('%s', (spelling, expected) => {
    expect(hit(spelling)).toEqual(expected);
  });

  it.each([null, undefined, '', '   ', 'Vietnam', 'Việt Nam', 'Vientiane', 'Phnom Penh', 'Bangkok', 'City', 'Province'])(
    'does not resolve %p (blank, country only, or another country)',
    (value) => {
      expect(hit(value)).toBeNull();
    },
  );

  it('folds spelling variants only: a merger is data in the table, not an alias', () => {
    // Quảng Nam is its own key; it resolves because the preset LISTS it under Đà Nẵng's category.
    expect(normalizeProvince('Quảng Nam')).toBe('quang nam');
    expect(normalizeProvince('Đà Nẵng')).toBe('da nang');
    const onlyDaNang: RegionRoutingConfig = {
      enabled: true,
      categories: [{ id: 'south_central', team: 'south', provinces: ['Đà Nẵng'] }],
    };
    expect(resolveHotelRegion(onlyDaNang, 'Quảng Nam')).toBeNull();
  });

  it('a tenant table that lists only the plain names still matches the host variants', () => {
    const plain: RegionRoutingConfig = {
      enabled: true,
      categories: [
        { id: 'north', team: 'north', provinces: ['Hà Nội'] },
        { id: 'north_central', team: 'north', provinces: ['Thừa Thiên Huế'] },
        { id: 'south_central', team: 'south', provinces: ['Đà Nẵng', 'Đắk Lắk'] },
        { id: 'south', team: 'south', provinces: ['TP. Hồ Chí Minh'] },
      ],
    };
    for (const v of ['Hanoi', 'Ha Noi']) expect(resolveHotelRegion(plain, v)?.category).toBe('north');
    for (const v of ['Huế', 'TT Huế', 'Hue']) expect(resolveHotelRegion(plain, v)?.category).toBe('north_central');
    for (const v of ['Ðà Nẵng', 'Da Nang', 'Đắc Lắc']) expect(resolveHotelRegion(plain, v)?.category).toBe('south_central');
    for (const v of ['HCMC', 'TPHCM', 'Sài Gòn', 'Ho Chi Minh City']) expect(resolveHotelRegion(plain, v)?.category).toBe('south');
  });
});

describe('normalizeProvince — encoding, prefixes and suffixes', () => {
  it('treats the legacy capital Ð (U+00D0) as Đ', () => {
    expect(normalizeProvince('Ðà Nẵng')).toBe('da nang');
    expect(normalizeProvince('ÐỒNG NAI')).toBe('dong nai');
  });

  it('drops a trailing city / province word and a trailing country', () => {
    expect(normalizeProvince('Ho Chi Minh City')).toBe('ho chi minh');
    expect(normalizeProvince('Thanh Hoa Province')).toBe('thanh hoa');
    expect(normalizeProvince('Hà Nội, Việt Nam')).toBe('ha noi');
    expect(normalizeProvince('Hà Nội, Vietnam')).toBe('ha noi');
    expect(normalizeProvince('Cần Thơ City, Viet Nam')).toBe('can tho');
  });

  it('never reduces a value to nothing', () => {
    expect(normalizeProvince('Vietnam')).toBe('vietnam');
    expect(normalizeProvince('Việt Nam')).toBe('viet nam');
    expect(normalizeProvince('City')).toBe('city');
  });

  it('folds the known spelling variants of one place to one key', () => {
    const keys = ['TP.HCM', 'TPHCM', 'HCMC', 'Sài Gòn', 'Saigon', 'Ho Chi Minh City', 'Thành phố Hồ Chí Minh'].map(
      normalizeProvince,
    );
    expect(new Set(keys)).toEqual(new Set(['ho chi minh']));
    expect(new Set(['Huế', 'Hue', 'TT Huế', 'Thừa Thiên Huế'].map(normalizeProvince))).toEqual(
      new Set(['thua thien hue']),
    );
    expect(new Set(['Đắk Lắk', 'Đắc Lắc', 'Daklak'].map(normalizeProvince))).toEqual(new Set(['dak lak']));
  });

  it('leaves ordinary names alone — no clipping of look-alike prefixes, no prototype lookups', () => {
    for (const [input, key] of [
      ['Thanh Hóa', 'thanh hoa'],
      ['Thái Bình', 'thai binh'],
      ['Tây Ninh', 'tay ninh'],
      ['Tiền Giang', 'tien giang'],
      ['Tuyên Quang', 'tuyen quang'],
      ['constructor', 'constructor'],
      ['toString', 'tostring'],
      ['HN', 'hn'],
      ['79', '79'],
    ]) {
      expect(normalizeProvince(input)).toBe(key);
    }
  });
});
