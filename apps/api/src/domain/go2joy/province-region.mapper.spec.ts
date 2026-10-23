import { mergeProvinceRegions, partnerRegionCode } from './province-region.mapper';

/** Province Feed values from staging-partner, 2026-10-23 (PLN-261023 H1-a). */
describe('province-region.mapper', () => {
  it('maps the documented region numbers and keeps undocumented ones as region_{n}', () => {
    expect([1, 2, 3, 4, 5].map(partnerRegionCode)).toEqual(['south', 'north', 'central', 'north_center', 'south_center']);
    expect(partnerRegionCode(10)).toBe('region_10'); // Metro Manila cities — not in the document
    expect(partnerRegionCode(null)).toBeNull();
    expect(partnerRegionCode(0)).toBeNull();
  });

  it('feed overrides the same province, adds new ones, keeps the rest', () => {
    const current = { 'hồ chí minh': 'north', 'Đà Nẵng': 'south_center', 'Custom Province': 'central' };
    const feed = [
      { sn: 1, name: 'Hồ Chí Minh', region: 1 },
      { sn: 32, name: 'Đà Nẵng'.normalize('NFD'), region: 5 },
      { sn: 70, name: 'Makati', region: 10 },
      { sn: 99, name: '', region: 1 },
      { sn: 98, name: 'No region', region: null },
    ];
    const r = mergeProvinceRegions(current, feed);
    expect(r.map).toEqual({
      'Custom Province': 'central',
      'Hồ Chí Minh': 'south',
      'Đà Nẵng': 'south_center',
      Makati: 'region_10',
    });
    // HCM: spelling + region changed; Đà Nẵng: NFC spelling equal → unchanged.
    expect({ added: r.added, changed: r.changed, kept: r.kept, total: r.total }).toEqual({ added: 1, changed: 1, kept: 1, total: 3 });
  });

  it('an empty feed reports total 0 (the caller then writes nothing)', () => {
    expect(mergeProvinceRegions({ 'Hà Nội': 'north' }, []).total).toBe(0);
    expect(mergeProvinceRegions(null, []).map).toEqual({});
  });
});
