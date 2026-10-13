import { PartnerLookupLogService, safeKeys, scrubParams } from './partner-lookup-log.service';

/** The audit log of partner lookups must never take the chat path down with it (PLN-261012 SG-31). */
describe('PartnerLookupLogService', () => {
  const build = (repo: { create: jest.Mock; save: jest.Mock }) => new PartnerLookupLogService(repo as never);
  const okRepo = () => ({ create: jest.fn((x) => x), save: jest.fn(async (x) => x) });

  it('writes one row per lookup with the verified hotel, role, topic and outcome', async () => {
    const repo = okRepo();
    await build(repo).record({
      tenantId: 1,
      conversationId: 5,
      messageId: 6,
      sessionId: 7,
      hotelSn: '1721',
      role: 'manager',
      topic: 'rates',
      params: { rateType: 'overnight', date: '2026-10-17' },
      status: 'ok',
      source: 'mock',
      latencyMs: 12,
      snapshotHash: 'a'.repeat(64),
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.create.mock.calls[0][0]).toMatchObject({
      tenantId: 1,
      conversationId: 5,
      messageId: 6,
      sessionId: 7,
      hotelSn: '1721',
      actorRole: 'manager',
      topic: 'rates',
      params: { rateType: 'overnight', date: '2026-10-17' },
      status: 'ok',
      errorCode: null,
      source: 'mock',
      latencyMs: 12,
    });
  });

  it('records how the lookup was triggered: prefetch by default (every row written before tools mode), tool when the model asked (PLN-261012 SG-33)', async () => {
    const repo = okRepo();
    await build(repo).record({ tenantId: 1, topic: 'rates', status: 'ok' });
    await build(repo).record({ tenantId: 1, topic: 'rates', status: 'ok', mode: 'tool' });
    expect(repo.create.mock.calls.map((c) => c[0].mode)).toEqual(['prefetch', 'tool']);
  });

  it('logs a rejected lookup by KEYS only — never by value', async () => {
    const repo = okRepo();
    await build(repo).record({
      tenantId: 1,
      topic: 'rates',
      params: { hotel_id: 'SECRET-2204' }, // must be ignored in favour of rejectedKeys
      rejectedKeys: ['hotel_id', 'hotelSn'],
      status: 'rejected',
      errorCode: 'E5104',
      reason: 'hotel_param',
    });
    const row = repo.create.mock.calls[0][0];
    expect(row.params).toEqual({ rejectedKeys: ['hotel_id', 'hotelSn'] });
    expect(JSON.stringify(row)).not.toContain('SECRET-2204');
  });

  describe('NEVER throws', () => {
    it('when the insert fails', async () => {
      const repo = { create: jest.fn((x) => x), save: jest.fn(async () => { throw new Error("Table 'partner_lookup_logs' doesn't exist"); }) };
      await expect(build(repo).record({ tenantId: 1, topic: 'rates', status: 'ok' })).resolves.toBeUndefined();
    });

    it('when building the row throws', async () => {
      const repo = { create: jest.fn(() => { throw new Error('bad entity'); }), save: jest.fn() };
      await expect(build(repo).record({ tenantId: 1, topic: 'rates', status: 'ok' })).resolves.toBeUndefined();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('with hostile input (huge strings, odd types)', async () => {
      const repo = okRepo();
      await expect(
        build(repo).record({
          tenantId: 1,
          topic: 'x'.repeat(500),
          params: { a: 'y'.repeat(5000), b: { nested: true } as never, c: [1] as never, d: NaN },
          reason: 'z'.repeat(500),
          status: 'error',
        }),
      ).resolves.toBeUndefined();
      const row = repo.create.mock.calls[0][0];
      expect(row.topic.length).toBeLessThanOrEqual(24);
      expect(row.reason.length).toBeLessThanOrEqual(64);
      expect(Object.keys(row.params ?? {})).toEqual(['a']);
      expect(String(row.params.a).length).toBeLessThanOrEqual(64);
    });
  });

  describe('scrubParams', () => {
    it('keeps scalars, caps them and scrubs PII-shaped values', () => {
      expect(scrubParams({ size: 20, status: 'confirmed' })).toEqual({ size: 20, status: 'confirmed' });
      const scrubbed = scrubParams({ bookingCode: 'guest@example.com' });
      expect(JSON.stringify(scrubbed)).not.toContain('guest@example.com');
    });

    it('returns null for nothing useful', () => {
      expect(scrubParams(null)).toBeNull();
      expect(scrubParams({})).toBeNull();
      expect(scrubParams({ x: { y: 1 } as never })).toBeNull();
    });
  });

  it('safeKeys bounds and sanitises the keys it logs', () => {
    expect(safeKeys(['hotel_id', 'a b\nc', 'x'.repeat(100), '1', '2', '3', '4'])).toEqual(['hotel_id', 'a?b?c', 'x'.repeat(40), '1', '2']);
    expect(safeKeys(undefined)).toEqual([]);
  });
});
