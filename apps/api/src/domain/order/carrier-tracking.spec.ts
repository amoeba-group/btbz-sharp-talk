import { carrierTrackingUrl, normalizeCarrier, safeTrackingUrl } from './carrier-tracking';

describe('carrierTrackingUrl (PLN-260923 P2)', () => {
  it('builds the carrier page for names already on staging rows', () => {
    expect(carrierTrackingUrl('UPS', '1Z999AA10123456784')).toBe(
      'https://www.ups.com/track?tracknum=1Z999AA10123456784',
    );
    expect(carrierTrackingUrl('An Post', '123123123')).toBe(
      'https://www.anpost.com/Post-Parcels/Track/History?item=123123123',
    );
    expect(carrierTrackingUrl('Amazon Logistics', '123445')).toBe(
      'https://track.amazon.com/tracking/123445',
    );
  });

  it('ignores case, spaces and punctuation, and resolves aliases', () => {
    expect(carrierTrackingUrl('fedex', 'X1')).toContain('fedex.com');
    expect(carrierTrackingUrl('Federal Express', 'X1')).toContain('fedex.com');
    expect(carrierTrackingUrl('DHL Express', 'X1')).toContain('tracking-express');
    expect(carrierTrackingUrl('DHL eCommerce', 'X1')).toContain('dhlecs.com');
    expect(carrierTrackingUrl('United States Postal Service', 'X1')).toContain('usps.com');
    expect(normalizeCarrier('  D.H.L  Express ')).toBe('dhlexpress');
  });

  it('never matches on a substring', () => {
    // Both contain "ups" — neither is UPS.
    expect(carrierTrackingUrl('UPS Mail Innovations', 'X1')).toBeNull();
    expect(carrierTrackingUrl('Pups Express', 'X1')).toBeNull();
    expect(carrierTrackingUrl('Other', 'X1')).toBeNull();
  });

  it('needs both a carrier and a number', () => {
    expect(carrierTrackingUrl(null, '1Z')).toBeNull();
    expect(carrierTrackingUrl('UPS', null)).toBeNull();
    expect(carrierTrackingUrl('UPS', '   ')).toBeNull();
  });

  it('URL-encodes the number', () => {
    expect(carrierTrackingUrl('UPS', 'A B&c=1')).toBe('https://www.ups.com/track?tracknum=A%20B%26c%3D1');
  });
});

describe('safeTrackingUrl', () => {
  it('keeps absolute http(s) URLs', () => {
    expect(safeTrackingUrl(' https://www.ups.com/track?tracknum=1 ')).toBe(
      'https://www.ups.com/track?tracknum=1',
    );
  });

  it('drops other schemes, relative and malformed values', () => {
    expect(safeTrackingUrl('javascript:alert(1)')).toBeNull();
    expect(safeTrackingUrl('data:text/html,x')).toBeNull();
    expect(safeTrackingUrl('/track/1')).toBeNull();
    expect(safeTrackingUrl('')).toBeNull();
    expect(safeTrackingUrl(null)).toBeNull();
    expect(safeTrackingUrl(`https://x.example/${'a'.repeat(1100)}`)).toBeNull();
  });
});
