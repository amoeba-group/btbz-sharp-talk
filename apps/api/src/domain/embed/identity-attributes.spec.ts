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

/**
 * GUIDE-261024 v1.4 §5.4 — payloads produced by the guide's PHP sample (php
 * 8.3 + intl, scripts/go2joy/identify-test-vectors.mjs). The server must
 * verify each with the hash the guide prints; T6 is T3 sent decomposed and
 * NBSP-padded, which the HA normalises to T3 before signing.
 */
describe('identify signing — GUIDE v1.4 test vectors', () => {
  it.each([
    ['T1', 'ha:1001', null, '244f6fa4c1c48d077d54bd632b0897042fa413e36d55921517c462e2af51e618'],
    ['T2', 'ha:1001', { hotel_id: '1721', hotel_name: 'A In Hotel Del Luna', province_sn: '1', role: 'RECEPTIONIST' }, 'fb670d6fbaac555b40b2f9896ec7de0604a1fad83aaf9e892f293f1d3be9faa7'],
    ['T3', 'ha:2002', { hotel_id: '2001', hotel_name: 'Huế Garden Hotel', province_sn: '32', role: 'OWNER' }, '0df74c490621c521a673b7bbd6014e6e3141a086d04c7c2f8de3699d31e581d7'],
    ['T4', 'ha:3003', { hotel_id: '3001', hotel_name: 'Hạ Long Bay Hotel', province_sn: '15', role: 'RECEPTIONIST' }, '7e5cf87cdd3dc38574ec8f3f9fe6671e9650806d28f4741a55bb508f53b77ea9'],
    ['T5', 'ha:1001', { role: 'MANAGER' }, 'd57dc894632e52a7ca62d97f4cbec924eb33982dff23f57058b7299d24f57f20'],
  ])('%s', (_n, userId, attrs, hash) => {
    expect(sign(userId as string, attrs as Record<string, unknown> | null)).toBe(hash);
  });

  it('T6: the decomposed, NBSP-padded T3 only matches once the HA normalises it', () => {
    const raw = { hotel_id: '2001', hotel_name: 'Hu\u0065\u0302\u0301  Garden\u00a0Hotel', province_sn: '32', role: 'OWNER' };
    expect(sign('ha:2002', raw)).not.toBe('0df74c490621c521a673b7bbd6014e6e3141a086d04c7c2f8de3699d31e581d7');
  });
});

describe('normalizeIdentityAttributes — province_sn (spec v1.4)', () => {
  it('keeps a numeric province_sn and drops anything else', () => {
    expect(normalizeIdentityAttributes({ province_sn: 1, role: 'X' })).toEqual({ province_sn: '1', role: 'X' });
    expect(normalizeIdentityAttributes({ province_sn: ' 12 ' })).toEqual({ province_sn: '12' });
    expect(normalizeIdentityAttributes({ province_sn: 'HCM', role: 'X' })).toEqual({ role: 'X' });
  });

  it('signs province_sn between hotel_name and role', () => {
    expect(identitySigningString('ha:1001', { role: 'R', province_sn: '1', hotel_name: 'H', hotel_id: '9' })).toBe(
      'ha:1001\nhotel_id=9\nhotel_name=H\nprovince_sn=1\nrole=R',
    );
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

  describe('spec v1.4 province_sn (PLN-261024)', () => {
    const index = { '1': { name: 'Hồ Chí Minh', region: 'south' }, '32': { name: 'Thừa Thiên Huế', region: 'north_center' }, '70': { name: 'Makati', region: 'region_10' } };

    it('fills the province name and region from the number', () => {
      const r = storedIdentityAttributes({ hotel_id: '4118', hotel_name: 'Lá Hotel Quận 10', province_sn: '1', role: 'RECEPTIONIST' }, null, index);
      expect(r.attributes).toEqual({ hotel_id: '4118', hotel_name: 'Lá Hotel Quận 10', province_sn: '1', province: 'Hồ Chí Minh', region: 'south', role: 'RECEPTIONIST' });
      expect(r.regionSource).toBe('province_sn');
      expect(r.snMismatch).toBeUndefined();
    });

    it('wins over v1.3 values sent beside it and says what differed', () => {
      const r = storedIdentityAttributes({ province_sn: '32', province: 'Hồ Chí Minh', region: 'south' }, map, index);
      expect(r.attributes).toEqual({ province_sn: '32', province: 'Thừa Thiên Huế', region: 'north_center' });
      expect(r.snMismatch).toBe("province 'Hồ Chí Minh', region 'south'");
      // Same values in another spelling are not a mismatch.
      expect(storedIdentityAttributes({ province_sn: '1', province: 'hồ chí minh', region: 'South' }, map, index).snMismatch).toBeUndefined();
    });

    it('an unknown number falls back to the v1.3 rules; no index behaves the same', () => {
      expect(storedIdentityAttributes({ province_sn: '999', province: 'Đà Nẵng' }, map, index)).toEqual({
        attributes: { province_sn: '999', province: 'Đà Nẵng', region: 'south_center' },
        regionSource: 'map',
      });
      expect(storedIdentityAttributes({ province_sn: '1' }, map, null)).toEqual({ attributes: { province_sn: '1' }, regionSource: 'none' });
    });

    it('keeps an undocumented region code as is', () => {
      expect(storedIdentityAttributes({ province_sn: '70' }, null, index).attributes).toEqual({ province_sn: '70', province: 'Makati', region: 'region_10' });
    });
  });

  it('no map / unmapped province / no attributes', () => {
    expect(storedIdentityAttributes({ province: 'Cần Thơ' }, map)).toEqual({ attributes: { province: 'Cần Thơ' }, regionSource: 'none' });
    expect(storedIdentityAttributes({ province: 'Hồ Chí Minh' }, null).regionSource).toBe('none');
    expect(storedIdentityAttributes(null, map)).toEqual({ attributes: null, regionSource: 'none' });
  });
});
