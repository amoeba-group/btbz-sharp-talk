import { partnerLinkOf } from './agent.service';
import type { IdentityClaims } from '@sharptalk/types';

/**
 * "Open in host system" link (REQ-261006 W6). The console shows the button only
 * when the API resolved a link, so these pin the rules the button inherits.
 */
describe('partnerLinkOf', () => {
  const signed: IdentityClaims = {
    hotelSn: '1721',
    role: 'receptionist',
    hotelName: 'A In Hotel Del Luna',
    hotelCode: 'HCM_001_001721',
    signed: true,
    verifiedAt: '2026-10-06T07:00:00.000Z',
  };
  const template = 'https://ha.go2joy.vn/hotel-info-tabs?hotelSn={hotelSn}';

  it('substitutes every {hotelSn} for a signed partner', () => {
    expect(partnerLinkOf(template, signed)).toBe(
      'https://ha.go2joy.vn/hotel-info-tabs?hotelSn=1721',
    );
    expect(partnerLinkOf('https://x.test/{hotelSn}/h/{hotelSn}', signed)).toBe(
      'https://x.test/1721/h/1721',
    );
  });

  it('URL-encodes the hotel key so a stray character cannot break the link', () => {
    expect(partnerLinkOf(template, { ...signed, hotelSn: 'a b&c' })).toBe(
      'https://ha.go2joy.vn/hotel-info-tabs?hotelSn=a%20b%26c',
    );
  });

  it('never links an unsigned (self-declared) hotel', () => {
    expect(partnerLinkOf(template, { ...signed, signed: false })).toBeNull();
  });

  it('is null without a template, claims, or hotel key', () => {
    expect(partnerLinkOf(null, signed)).toBeNull();
    expect(partnerLinkOf(template, null)).toBeNull();
    expect(partnerLinkOf(template, { ...signed, hotelSn: '' })).toBeNull();
  });
});
