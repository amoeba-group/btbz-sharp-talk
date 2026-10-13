import { PILOT_NOTE_MAX_LENGTH, SESSION_IDENTITY } from '@sharptalk/types';
import type { IdentityClaims, PilotAccess } from '@sharptalk/types';
import {
  decidePilot,
  parseHotelInput,
  planHotelImport,
  signedHotelOf,
  splitHotelLine,
} from './pilot.util';

const NOW = new Date('2026-10-13T10:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const claims = (over: Partial<IdentityClaims> = {}): IdentityClaims => ({
  hotelSn: '1721',
  role: 'manager',
  hotelName: 'A In Hotel Del Luna',
  hotelCode: 'DL-1',
  signed: true,
  verifiedAt: hoursAgo(1),
  ...over,
});

const verified = (c: IdentityClaims | null) => ({
  identityLevel: SESSION_IDENTITY.VERIFIED,
  identityClaims: c,
});

const cfg = (over: Partial<PilotAccess> = {}): PilotAccess => ({
  enabled: true,
  guestAllowed: true,
  nonPilot: 'hide',
  notice: {},
  ...over,
});

describe('signedHotelOf — the only hotel the allowlist trusts', () => {
  it('returns the signed hotel of a verified, signed session', () => {
    expect(signedHotelOf(verified(claims()), { now: NOW })).toBe('1721');
  });

  it('trims it, the same way the claim was stored', () => {
    expect(signedHotelOf(verified(claims({ hotelSn: ' 1721 ' })), { now: NOW })).toBe('1721');
  });

  it('is null for a guest and for a v1 identity — neither carries a hotel', () => {
    expect(signedHotelOf({ identityLevel: SESSION_IDENTITY.GUEST, identityClaims: null })).toBeNull();
    expect(signedHotelOf(verified(null))).toBeNull();
  });

  it('is null when the claim is not literally signed — a display field is not a key', () => {
    expect(signedHotelOf(verified(claims({ signed: false })))).toBeNull();
    expect(signedHotelOf(verified(claims({ signed: undefined as unknown as boolean })))).toBeNull();
    expect(signedHotelOf(verified(claims({ signed: 'true' as unknown as boolean })))).toBeNull();
  });

  it('is null when the session is not at the verified level', () => {
    expect(signedHotelOf({ identityLevel: SESSION_IDENTITY.GUEST, identityClaims: claims() })).toBeNull();
  });

  it('is null for a blank serial', () => {
    expect(signedHotelOf(verified(claims({ hotelSn: '   ' })))).toBeNull();
    expect(signedHotelOf(verified(claims({ hotelSn: 1721 as unknown as string })))).toBeNull();
  });

  it('never reads the display fields: another hotel\'s name or code changes nothing', () => {
    const c = claims({ hotelSn: '9999', hotelName: '1721', hotelCode: '1721' });
    expect(signedHotelOf(verified(c), { now: NOW })).toBe('9999');
  });

  it('with no policy a signature does not expire on its own', () => {
    expect(signedHotelOf(verified(claims({ verifiedAt: hoursAgo(24 * 365) })), { now: NOW })).toBe('1721');
    expect(signedHotelOf(verified(claims({ verifiedAt: hoursAgo(24 * 365) })), { now: NOW, maxAgeHours: null })).toBe('1721');
  });

  it('with a max age, an older claim is treated as unsigned (→ guest)', () => {
    expect(signedHotelOf(verified(claims({ verifiedAt: hoursAgo(1) })), { now: NOW, maxAgeHours: 2 })).toBe('1721');
    expect(signedHotelOf(verified(claims({ verifiedAt: hoursAgo(3) })), { now: NOW, maxAgeHours: 2 })).toBeNull();
  });

  it('with a max age, a missing or unreadable verifiedAt counts as expired, not as fresh', () => {
    expect(signedHotelOf(verified(claims({ verifiedAt: 'yesterday' })), { now: NOW, maxAgeHours: 2 })).toBeNull();
    expect(signedHotelOf(verified(claims({ verifiedAt: undefined as unknown as string })), { now: NOW, maxAgeHours: 2 })).toBeNull();
  });

  it('a zero, negative or non-numeric max age is no policy', () => {
    for (const bad of [0, -5, Number.NaN, undefined]) {
      expect(signedHotelOf(verified(claims({ verifiedAt: hoursAgo(500) })), { now: NOW, maxAgeHours: bad })).toBe('1721');
    }
  });
});

describe('decidePilot — the enforcement matrix', () => {
  const LIST = new Set(['1721', '2204']);

  it('feature off or never configured: not applicable, served as before', () => {
    for (const c of [null, cfg({ enabled: false })]) {
      expect(decidePilot(c, LIST, '3307')).toMatchObject({ applies: false, allowed: true });
      expect(decidePilot(c, LIST, null)).toMatchObject({ applies: false, allowed: true });
    }
  });

  it('a signed hotel on the list is served', () => {
    expect(decidePilot(cfg(), LIST, '1721')).toEqual({ applies: true, allowed: true, audience: 'hotel', hotelSn: '1721' });
  });

  it('a signed hotel NOT on the list is refused', () => {
    expect(decidePilot(cfg(), LIST, '3307')).toEqual({ applies: true, allowed: false, audience: 'hotel', hotelSn: '3307' });
  });

  it('guests follow guestAllowed', () => {
    expect(decidePilot(cfg({ guestAllowed: true }), LIST, null)).toMatchObject({ applies: true, allowed: true, audience: 'guest' });
    expect(decidePilot(cfg({ guestAllowed: false }), LIST, null)).toMatchObject({ applies: true, allowed: false, audience: 'guest' });
  });

  it('guestAllowed never rescues an identified hotel that is off the list', () => {
    expect(decidePilot(cfg({ guestAllowed: true }), LIST, '3307').allowed).toBe(false);
  });

  it('an empty list serves no identified hotel — also how the pilot is closed', () => {
    expect(decidePilot(cfg(), new Set(), '1721').allowed).toBe(false);
    expect(decidePilot(cfg(), [], '1721').allowed).toBe(false);
  });

  it('compares exactly: no case folding, no leading-zero stripping', () => {
    expect(decidePilot(cfg(), new Set(['1721']), '01721').allowed).toBe(false);
    expect(decidePilot(cfg(), new Set(['HN1']), 'hn1').allowed).toBe(false);
  });

  it('accepts a plain array as the list', () => {
    expect(decidePilot(cfg(), ['1721'], '1721').allowed).toBe(true);
    expect(decidePilot(cfg(), ['1721'], '2204').allowed).toBe(false);
  });
});

describe('splitHotelLine', () => {
  it('splits on a comma, a semicolon, a tab or the first whitespace', () => {
    expect(splitHotelLine('1721,đợt 1')).toEqual(['1721', 'đợt 1']);
    expect(splitHotelLine('1721;đợt 1')).toEqual(['1721', 'đợt 1']);
    expect(splitHotelLine('1721\tđợt 1')).toEqual(['1721', 'đợt 1']);
    expect(splitHotelLine('1721   A In Hotel Del Luna')).toEqual(['1721', 'A In Hotel Del Luna']);
  });

  it('a bare serial has no note', () => {
    expect(splitHotelLine('1721')).toEqual(['1721', '']);
  });

  it('keeps everything after the first delimiter as the note — it never invents more hotels', () => {
    expect(splitHotelLine('1721, 2204, 3307')).toEqual(['1721', '2204, 3307']);
  });

  it('honours double quotes, including a comma inside them', () => {
    expect(splitHotelLine('"1721","batch, one"')).toEqual(['1721', 'batch, one']);
    expect(splitHotelLine('"17,21",x')).toEqual(['17,21', 'x']);
    expect(splitHotelLine('1721,"say ""hi"""')).toEqual(['1721', 'say "hi"']);
  });
});

describe('parseHotelInput', () => {
  it('reads one hotel per line, with the 1-based line number', () => {
    const { rows } = parseHotelInput('1721\n2204,batch 1\n3307');
    expect(rows.map((r) => [r.line, r.hotelSn, r.note])).toEqual([
      [1, '1721', null],
      [2, '2204', 'batch 1'],
      [3, '3307', null],
    ]);
  });

  it('skips the header row of a CSV (hotel_sn,note) and says so', () => {
    const { rows, headerSkipped } = parseHotelInput('hotel_sn,note\n1721,batch 1\n');
    expect(headerSkipped).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 2, hotelSn: '1721', note: 'batch 1' });
  });

  it('does not mistake a later row for a header, nor a serial for one', () => {
    expect(parseHotelInput('1721\nhotel_sn').rows).toHaveLength(2);
    expect(parseHotelInput('1721').headerSkipped).toBe(false);
  });

  it('survives an Excel BOM, CRLF and old-Mac CR line endings, blank lines and # comments', () => {
    const text = '﻿hotel_sn,note\r\n# first wave\r\n1721,a\r\n\r\n2204,b\r3307,c';
    const { rows } = parseHotelInput(text);
    expect(rows.map((r) => r.hotelSn)).toEqual(['1721', '2204', '3307']);
  });

  it('marks a line whose first field is not a serial as invalid, keeping what was typed', () => {
    const { rows } = parseHotelInput('1721\nnot a serial,x\n17 21');
    // A comma beats whitespace as the delimiter, so the whole first cell is shown back.
    expect(rows[1]).toMatchObject({ line: 2, hotelSn: null, raw: 'not a serial', note: 'x' });
    expect(rows[2]).toMatchObject({ hotelSn: '17', note: '21' });
  });

  it('cuts an over-long note to the column length', () => {
    const { rows } = parseHotelInput(`1721,${'x'.repeat(PILOT_NOTE_MAX_LENGTH + 50)}`);
    expect(rows[0].note).toHaveLength(PILOT_NOTE_MAX_LENGTH);
  });

  it('an empty or whitespace-only input has no rows', () => {
    expect(parseHotelInput('').rows).toEqual([]);
    expect(parseHotelInput('  \n \r\n').rows).toEqual([]);
    expect(parseHotelInput(undefined as unknown as string).rows).toEqual([]);
  });
});

describe('planHotelImport — what a paste would do', () => {
  const existing = new Map<string, boolean>([
    ['1721', true], // listed and active
    ['2204', false], // listed but paused
  ]);
  const plan = (text: string) => planHotelImport(parseHotelInput(text).rows, existing);

  it('classifies added / existing / reactivated / duplicate / invalid, first occurrence wins', () => {
    const p = plan('3307,new\n1721\n2204,again\n3307,twice\nnope!,x\n4410');
    expect(p.rows.map((r) => r.status)).toEqual(['added', 'existing', 'reactivated', 'duplicate', 'invalid', 'added']);
    expect(p.counts).toEqual({ added: 2, reactivated: 1, existing: 1, duplicate: 1, invalid: 1 });
  });

  it('a serial repeated before it is known is added once, the rest are duplicates', () => {
    const p = plan('5000\n5000\n5000');
    expect(p.counts).toMatchObject({ added: 1, duplicate: 2 });
  });

  it('an invalid line never counts toward the duplicates of a good one', () => {
    const p = plan('!!\n!!');
    expect(p.counts).toMatchObject({ invalid: 2, duplicate: 0, added: 0 });
  });
});
