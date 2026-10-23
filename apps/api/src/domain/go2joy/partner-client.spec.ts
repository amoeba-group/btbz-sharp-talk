jest.mock('../tenant/ecommerce-probe.util', () => ({ assertPublicUrl: jest.fn(async () => undefined) }));

import { PartnerApiError, partnerCall, partnerSignature, probePartner, readPartnerConfig, sortedJson } from './partner-client';

/**
 * Go2Joy Partner API client (PLN-261023). The signing scheme was verified
 * live against staging-partner on 2026-10-23 (Hotel Info / Room Type Feed 200);
 * the vector below pins that algorithm. The doc's own sample header does not
 * match its sample body, so it cannot serve as the vector.
 */
const CFG = { baseUrl: 'https://partner.example/', clientId: 'cid', clientSecret: 'sec' };
const reply = (status: number, body: unknown) =>
  jest.fn(async () => ({ status, json: async () => body }) as unknown as Response) as unknown as typeof fetch;

describe('partner-client', () => {
  it('signs URL|sorted JSON with HMAC-SHA256 hex', () => {
    const body = sortedJson({
      timestamp: 1626261920,
      hotelSn: 467,
      bookingType: 1,
      deviceEncode: '52660884ecdfeafff221ad8e1973f2e7',
      clientId: '8eabbb1b-feb7-4d12-b8fd-10046769a100',
    });
    expect(body).toBe(
      '{"bookingType":1,"clientId":"8eabbb1b-feb7-4d12-b8fd-10046769a100","deviceEncode":"52660884ecdfeafff221ad8e1973f2e7","hotelSn":467,"timestamp":1626261920}',
    );
    expect(partnerSignature('f066739601bd38b6a6cc35a08ebf74bf0c2a77a5', 'https://partner.go2joy.vn/api/v1/hotel/getHotelInfo', body)).toBe(
      '36a00fc19abef1313a0108d314c509a85592d791893bd240781b4aae9166b05d',
    );
  });

  it('reads the credential blob and normalises the base URL', () => {
    expect(readPartnerConfig({ base_url: 'https://x.vn', client_id: 'a', client_secret: 'b' })).toEqual({
      baseUrl: 'https://x.vn/',
      clientId: 'a',
      clientSecret: 'b',
    });
    expect(readPartnerConfig({ base_url: 'https://x.vn', client_id: 'a' })).toBeNull();
  });

  it('sends exactly the signed body and returns data on code 1', async () => {
    const f = reply(200, { code: 1, data: { sn: 4118 } });
    await expect(partnerCall(CFG, 'api/v2/hotel/getHotelInfo', { hotelSn: 4118 }, { fetchImpl: f })).resolves.toEqual({ sn: 4118 });
    const [url, init] = (f as jest.Mock).mock.calls[0];
    expect(url).toBe('https://partner.example/api/v2/hotel/getHotelInfo');
    const sent = JSON.parse(init.body);
    expect(Object.keys(sent)).toEqual(['clientId', 'hotelSn', 'timestamp']);
    expect(init.headers.Authorization).toBe(partnerSignature('sec', url, init.body));
  });

  it.each([
    [{ code: 6, message: 'Invalid signature.' }, 'signature'],
    [[{ code: 4, message: 'The selected hotelSn is invalid.' }], 'not_found'],
    [[{ code: 4, message: 'The criteria.bookingType field is required.' }], 'parameter'],
    [{ code: 10, message: 'Permission denied' }, 'client'],
    [{ code: 12, message: 'Too many' }, 'rate_limited'],
  ])('classifies error %j as %s', async (error, kind) => {
    const f = reply(400, { code: 2, error, data: null });
    await expect(partnerCall(CFG, 'x', {}, { fetchImpl: f })).rejects.toMatchObject({ kind });
  });

  it('a network failure is its own kind', async () => {
    const f = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(partnerCall(CFG, 'x', {}, { fetchImpl: f })).rejects.toBeInstanceOf(PartnerApiError);
    await expect(partnerCall(CFG, 'x', {}, { fetchImpl: f })).rejects.toMatchObject({ kind: 'network' });
  });

  describe('probePartner', () => {
    const raw = { base_url: 'https://partner.example', client_id: 'cid', client_secret: 'sec' };
    it('"no such hotel" proves the credentials were accepted', async () => {
      const f = reply(400, { code: 2, error: [{ code: 4, message: 'The selected hotelSn is invalid.' }] });
      await expect(probePartner(raw, f)).resolves.toEqual({ ok: true, detail: 'Connected' });
    });
    it('names a rejected secret and a rejected client id differently', async () => {
      await expect(probePartner(raw, reply(400, { code: 2, error: { code: 6, message: 'x' } }))).resolves.toMatchObject({
        ok: false,
        detail: expect.stringContaining('client secret'),
      });
      await expect(probePartner(raw, reply(400, { code: 2, error: { code: 10, message: 'x' } }))).resolves.toMatchObject({
        ok: false,
        detail: expect.stringContaining('client ID'),
      });
    });
    it('incomplete credentials fail without a call', async () => {
      const f = reply(200, {});
      await expect(probePartner({ base_url: 'https://x' }, f)).resolves.toMatchObject({ ok: false });
      expect(f).not.toHaveBeenCalled();
    });
  });
});
