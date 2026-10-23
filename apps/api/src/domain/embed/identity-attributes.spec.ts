import { createHmac } from 'crypto';
import { identitySigningString, normalizeIdentityAttributes, storedIdentityAttributes } from './identity-attributes';

const sign = (userId: string, attrs: Record<string, unknown> | null) =>
  createHmac('sha256', 'test-secret-do-not-use').update(identitySigningString(userId, normalizeIdentityAttributes(attrs))).digest('hex');

/**
 * GUIDE-261022 v1.2 §5.4 — the hashes handed to Go2Joy. Pinned so a change to
 * normalisation (PLN-261022 stage 1) can never move the signing string.
 */
describe('identify signing — GUIDE v1.2 test vectors', () => {
  it.each([
    ['T1', 'ha:1001', null, '244f6fa4c1c48d077d54bd632b0897042fa413e36d55921517c462e2af51e618'],
    [
      'T2',
      'ha:1001',
      { hotel_id: '1721', hotel_name: 'A In Hotel Del Luna', province: 'Hồ Chí Minh', region: 'south', role: 'Lễ tân' },
      '6965b1eb09412033fa26782f43782021f7888addf9e493acb2dd212448667169',
    ],
    [
      'T3',
      'ha:2002',
      { hotel_id: '2001', hotel_name: 'Huế Garden Hotel', province: 'Thừa Thiên Huế', region: 'north_center', role: 'Chủ khách sạn' },
      '2a4997998a1edb97e90e7c306cbacd4ab79d6509bb6042c42401891d0b23f1d8',
    ],
    [
      'T4',
      'ha:3003',
      { hotel_id: '3001', hotel_name: 'Hạ Long Bay Hotel', province: 'Quảng Ninh', role: 'Lễ tân' },
      '64ec39ea09916f477ae469cee7331c64f65e81d1586c24c78b3693a5776985b0',
    ],
    ['T5', 'ha:1001', { role: 'Quản lý' }, '991931a386d1d47124162a1bf07a76d8f104e9e26964f8bfb328590c999c2a8d'],
  ])('%s', (_n, userId, attrs, hash) => {
    expect(sign(userId as string, attrs as Record<string, unknown> | null)).toBe(hash);
  });

  it('a decomposed value signs differently — normalisation must stay after verification', () => {
    const nfd = { province: 'Hồ Chí Minh'.normalize('NFD'), region: 'south' };
    expect(sign('ha:1001', nfd)).not.toBe(sign('ha:1001', { province: 'Hồ Chí Minh', region: 'south' }));
  });
});

describe('storedIdentityAttributes (PLN-261022 stage 1)', () => {
  const map = { 'Hồ Chí Minh': 'south', 'Thừa Thiên Huế': 'North Center', 'Đà Nẵng': 'south_center' };

  it('NFC-normalises every value and folds the region to its code', () => {
    const r = storedIdentityAttributes({ province: 'Thừa Thiên Huế'.normalize('NFD'), region: 'North Center', role: 'Lễ tân'.normalize('NFD') }, map);
    expect(r.attributes).toEqual({ province: 'Thừa Thiên Huế', region: 'north_center', role: 'Lễ tân' });
    expect(r.regionSource).toBe('signed');
    expect(r.mismatch).toBeUndefined();
  });

  it('fills a missing region from the province map (NFC + case-insensitive key)', () => {
    const r = storedIdentityAttributes({ hotel_id: '3001', province: 'đà nẵng' }, map);
    expect(r.attributes).toEqual({ hotel_id: '3001', province: 'đà nẵng', region: 'south_center' });
    expect(r.regionSource).toBe('map');
  });

  it('keeps the signed region when the map disagrees, and reports it', () => {
    const r = storedIdentityAttributes({ province: 'Hồ Chí Minh', region: 'north' }, map);
    expect(r.attributes?.region).toBe('north');
    expect(r.mismatch).toBe('south');
  });

  it('reads a province name in the region field as the province (PLN-261023 H1-b)', () => {
    // What HA UAT sends: region and province both "Hồ Chí Minh".
    const both = storedIdentityAttributes({ hotel_id: '4118', province: 'Hồ Chí Minh', region: 'Hồ Chí Minh' }, map);
    expect(both.attributes).toEqual({ hotel_id: '4118', province: 'Hồ Chí Minh', region: 'south' });
    expect(both.regionSource).toBe('province_in_region');
    expect(both.mismatch).toBeUndefined();
    // Region only, any case / decomposed / underscored: the province is filled with the map's spelling.
    for (const region of ['hồ_chí_minh', 'HỒ CHÍ MINH', 'Hồ Chí Minh'.normalize('NFD')]) {
      const r = storedIdentityAttributes({ region }, map);
      expect(r.attributes).toEqual({ province: 'Hồ Chí Minh', region: 'south' });
    }
  });

  it('leaves real regions and unknown values alone', () => {
    expect(storedIdentityAttributes({ region: 'south' }, map).attributes).toEqual({ region: 'south' });
    expect(storedIdentityAttributes({ region: 'region_10' }, { region_10: 'north' }).attributes).toEqual({ region: 'region_10' });
    // Not a region, not a province the map knows: kept as folded, signed source.
    const r = storedIdentityAttributes({ region: 'Cần Thơ' }, map);
    expect(r.attributes).toEqual({ region: 'cần_thơ' });
    expect(r.regionSource).toBe('signed');
    // No map: nothing to compare against.
    expect(storedIdentityAttributes({ region: 'Hồ Chí Minh' }, null).attributes).toEqual({ region: 'hồ_chí_minh' });
  });

  it('no map / unmapped province / no attributes', () => {
    expect(storedIdentityAttributes({ province: 'Cần Thơ' }, map)).toEqual({ attributes: { province: 'Cần Thơ' }, regionSource: 'none' });
    expect(storedIdentityAttributes({ province: 'Hồ Chí Minh' }, null).regionSource).toBe('none');
    expect(storedIdentityAttributes(null, map)).toEqual({ attributes: null, regionSource: 'none' });
  });
});
