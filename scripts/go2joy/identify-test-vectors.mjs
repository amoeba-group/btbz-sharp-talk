#!/usr/bin/env node
/**
 * HA identify spec v1.4 test vectors T1 – T6 (PLN-261024), printed for the
 * guide. Same signing string as the API (`identitySigningString`, pinned in
 * identity-attributes.spec.ts): `userId` then `key=value` lines in key order,
 * HMAC-SHA256 with the TEST secret below, hex.
 *
 * T6 feeds a decomposed (NFD), double-spaced, NBSP-padded copy of T3 through
 * the guide's normalisation (NFC → collapse whitespace → trim → 120 chars);
 * it must give T3's hash. The guide's PHP sample is checked against this
 * output (docker php + intl).
 *
 *   node scripts/go2joy/identify-test-vectors.mjs
 */
import { createHmac } from 'node:crypto';

export const TEST_SECRET = 'test-secret-do-not-use';

/** The guide's normalisation, in its order. */
export function clean(value) {
  return String(value)
    .normalize('NFC')
    .replace(/[\s  -​　]+/gu, ' ')
    .trim()
    .slice(0, 120);
}

export function signingString(userId, attributes) {
  const keys = Object.keys(attributes ?? {})
    .filter((k) => clean(attributes[k]) !== '')
    .sort();
  return [userId, ...keys.map((k) => `${k}=${clean(attributes[k])}`)].join('\n');
}

export const sign = (userId, attributes) => createHmac('sha256', TEST_SECRET).update(signingString(userId, attributes), 'utf8').digest('hex');

export const VECTORS = [
  ['T1', 'ha:1001', null, 'No attributes'],
  ['T2', 'ha:1001', { hotel_id: '1721', hotel_name: 'A In Hotel Del Luna', province_sn: '1', role: 'RECEPTIONIST' }, 'Hồ Chí Minh (sn 1) → south'],
  ['T3', 'ha:2002', { hotel_id: '2001', hotel_name: 'Huế Garden Hotel', province_sn: '32', role: 'OWNER' }, 'Thừa Thiên Huế (sn 32) → north_center'],
  ['T4', 'ha:3003', { hotel_id: '3001', hotel_name: 'Hạ Long Bay Hotel', province_sn: '15', role: 'RECEPTIONIST' }, 'Quảng Ninh (sn 15) → north'],
  ['T5', 'ha:1001', { role: 'MANAGER' }, '"All hotels": role only'],
  [
    'T6',
    'ha:2002',
    { hotel_id: ' 2001', hotel_name: '  Huế  Garden Hotel ', province_sn: '32', role: 'OWNER' },
    'T3 sent decomposed (NFD), double-spaced, NBSP-padded → normalised = T3',
  ],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [id, userId, attrs, note] of VECTORS) {
    console.log(`${id}\t${sign(userId, attrs)}\t${note}`);
    console.log('   ' + signingString(userId, attrs).replace(/\n/g, ' ⏎ '));
  }
}
