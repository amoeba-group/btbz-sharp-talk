import type { IdentityClaims } from '@sharptalk/types';
import { MockGo2JoyClient } from './mock-go2joy.client';
import { PartnerDataService } from './partner-data.service';
import { PartnerDataStep } from './partner-data.step';
import type { PartnerDataBlock, PartnerNotice, PartnerPrepareInput } from './partner-data.step';
import type { PartnerApiClient } from './partner-api.client';
import { partnerError } from './partner-data.constants';
import type { PartnerFlagService } from './partner-flag.service';
import type { PartnerLookupLogService } from './partner-lookup-log.service';
import { DEFAULT_MOCK_SET } from './fixtures/mock-set-default';

/**
 * The chat-facing step (PLN-261012 SG-31): inert unless everything lines up,
 * a data block or a notice when it applies, and never an exception.
 */
describe('PartnerDataStep', () => {
  // Tuesday 2026-10-13, 09:00 in Ho Chi Minh: "this weekend" is Saturday 2026-10-17 whatever day the suite runs.
  const NOW = Date.parse('2026-10-13T02:00:00.000Z');
  beforeAll(() => jest.useFakeTimers({ now: NOW }));
  afterAll(() => jest.useRealTimers());
  const claims = (over: Partial<IdentityClaims> = {}): IdentityClaims => ({
    hotelSn: '1721',
    role: 'manager',
    signed: true,
    verifiedAt: new Date().toISOString(),
    ...over,
  });

  const build = (opts: { serverOn?: boolean; tenantOn?: boolean; client?: PartnerApiClient } = {}) => {
    const flags = {
      serverEnabled: jest.fn(() => opts.serverOn ?? true),
      isEnabled: jest.fn(async () => opts.tenantOn ?? true),
    } as unknown as PartnerFlagService;
    const record = jest.fn(async (_e: unknown) => undefined);
    const logs = { record } as unknown as PartnerLookupLogService;
    const client = opts.client ?? new MockGo2JoyClient(DEFAULT_MOCK_SET, () => NOW);
    const get = jest.spyOn(client, 'get');
    const data = new PartnerDataService(client, logs);
    const resolve = jest.spyOn(data, 'resolve');
    return { step: new PartnerDataStep(flags, data, logs), flags, record, get, resolve };
  };

  const input = (text: string, over: Partial<PartnerPrepareInput> = {}, c: IdentityClaims | null = claims()): PartnerPrepareInput => ({
    tenantId: 1,
    session: { id: 5, tenantId: 1, identityClaims: c },
    conversationId: 77,
    messageId: 88,
    text,
    language: 'VI',
    ...over,
  });

  const asData = (r: unknown) => r as PartnerDataBlock;
  const asNotice = (r: unknown) => r as PartnerNotice;

  describe('inert — the turn is exactly what it was', () => {
    it('with the server-wide switch off, without even reading the tenant flag', async () => {
      const b = build({ serverOn: false });
      expect(await b.step.prepare(input('Giá qua đêm phòng Deluxe?'))).toBeNull();
      expect(b.flags.isEnabled).not.toHaveBeenCalled();
      expect(b.resolve).not.toHaveBeenCalled();
    });

    it('with the tenant switch off', async () => {
      const b = build({ tenantOn: false });
      expect(await b.step.prepare(input('Giá qua đêm phòng Deluxe?'))).toBeNull();
      expect(b.resolve).not.toHaveBeenCalled();
      expect(b.get).not.toHaveBeenCalled();
    });

    it('for a guest or an unsigned (v1) identity, even on a partner question', async () => {
      const b = build();
      expect(await b.step.prepare(input('Giá qua đêm phòng Deluxe?', {}, null))).toBeNull();
      expect(await b.step.prepare(input('Giá qua đêm phòng Deluxe?', {}, claims({ signed: false })))).toBeNull();
      expect(b.resolve).not.toHaveBeenCalled();
    });

    it('when the message is not a partner-data question', async () => {
      const b = build();
      expect(await b.step.prepare(input('Làm sao để đăng ký làm đối tác?'))).toBeNull();
      expect(await b.step.prepare(input('Xin chào'))).toBeNull();
      expect(b.resolve).not.toHaveBeenCalled();
    });

    it('and never throws — a broken flag read is "off"', async () => {
      const b = build();
      (b.flags.isEnabled as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
      expect(await b.step.prepare(input('Giá qua đêm phòng Deluxe?'))).toBeNull();
    });
  });

  describe('handles() — would the step act on this message?', () => {
    it('is true only for a signed partner naming a partner topic with the feature on', async () => {
      const b = build();
      expect(await b.step.handles(input('Giá qua đêm phòng Deluxe?'))).toBe(true);
      expect(await b.step.handles(input('Xin chào'))).toBe(false);
      expect(await b.step.handles(input('Giá qua đêm phòng Deluxe?', {}, null))).toBe(false);
      expect(await b.step.handles(input('Giá qua đêm phòng Deluxe?', {}, claims({ signed: false })))).toBe(false);
    });

    it('is false with either switch off, and never throws', async () => {
      expect(await build({ serverOn: false }).step.handles(input('Giá qua đêm phòng Deluxe?'))).toBe(false);
      expect(await build({ tenantOn: false }).step.handles(input('Giá qua đêm phòng Deluxe?'))).toBe(false);
      const b = build();
      (b.flags.isEnabled as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
      expect(await b.step.handles(input('Giá qua đêm phòng Deluxe?'))).toBe(false);
    });

    it('does no lookup — it only classifies', async () => {
      const b = build();
      await b.step.handles(input('Giá qua đêm phòng Deluxe?'));
      expect(b.resolve).not.toHaveBeenCalled();
      expect(b.get).not.toHaveBeenCalled();
    });
  });

  describe('a data block', () => {
    it('is built server-side for the signed-in hotel, in the session language', async () => {
      const b = build();
      const r = asData(await b.step.prepare(input('Giá qua đêm cuối tuần phòng Deluxe?')));
      expect(r.kind).toBe('data');
      expect(r.topics).toEqual(['rates']);
      expect(r.block).toContain('hotel 1721, role manager');
      expect(r.block).toContain('[rates]');
      expect(r.block).toContain('Deluxe (DELUXE) | overnight | 2026-10-17');
      expect(r.block).toContain('final 475.000 ₫'); // Vietnamese session: dot grouping + dong sign
      expect(r.evidence).toHaveLength(1);
      expect(r.evidence[0]).toMatchObject({ topic: 'rates', hotelSn: '1721', params: { roomType: 'DELUXE', rateType: 'overnight', date: '2026-10-17' } });
      // the lookup carried the closed params only — no hotel — and the turn ids
      expect(b.resolve).toHaveBeenCalledTimes(1);
      const [ctx, topic, params, meta] = b.resolve.mock.calls[0];
      expect(ctx.hotelSn).toBe('1721');
      expect(topic).toBe('rates');
      expect(Object.keys(params as object).sort()).toEqual(['date', 'rateType', 'roomType']);
      expect(meta).toEqual({ conversationId: 77, messageId: 88, sessionId: 5 });
    });

    it('formats amounts for the session language', async () => {
      const b = build();
      const r = asData(await b.step.prepare(input('overnight room rate for a deluxe room', { language: 'EN' })));
      expect(r.block).toContain('final 425,000 VND'); // Tuesday: no weekend surcharge, flash sale 25,000 off
      expect(r.block).not.toContain('₫');
    });

    it('lists ids and amounts to protect from the PII masks, longest first', async () => {
      const b = build();
      const r = asData(await b.step.prepare(input('Tra cứu đặt phòng 2610140000123456')));
      expect(r.kind).toBe('data');
      expect(r.protect).toContain('2610140000123456');
      expect(r.protect[0].length).toBeGreaterThanOrEqual(r.protect[r.protect.length - 1].length);
    });

    it('can combine two topics in one block', async () => {
      const b = build();
      const r = asData(await b.step.prepare(input('Đối soát tháng 9 và chính sách hủy phòng?')));
      expect(r.topics).toEqual(['settlement', 'policies']);
      expect(r.block).toContain('[settlement]');
      expect(r.block).toContain('[policies]');
      expect(r.evidence.map((e) => e.topic)).toEqual(['settlement', 'policies']);
    });

    it('says so when the data holds nothing (a block, not a notice)', async () => {
      const b = build();
      const r = asData(await b.step.prepare(input('Tra cứu đặt phòng ZZZ9999999')));
      expect(r.kind).toBe('data');
      expect(r.block).toMatch(/no booking data was found/);
    });
  });

  describe('a notice (the model is not asked)', () => {
    it('a receptionist asking for settlement: role notice, no hand-off, nothing requested', async () => {
      const b = build();
      const r = asNotice(await b.step.prepare(input('Đối soát tháng 9 còn bao nhiêu?', {}, claims({ role: 'receptionist' }))));
      expect(r.kind).toBe('notice');
      expect(r.code).toBe('E5101');
      expect(r.reason).toBe('partner_role_denied');
      expect(r.handoff).toBe(false);
      expect(r.body).toContain('Quản lý'); // Vietnamese session
      expect(r.trace).toMatchObject({ reason: 'partner_role_denied', partnerError: 'E5101' });
      expect(b.get).not.toHaveBeenCalled();
    });

    it('expired claims: "sign in again" notice (E5102), no hand-off, nothing requested', async () => {
      const b = build();
      const old = claims({ verifiedAt: new Date(Date.now() - 9 * 3600_000).toISOString() });
      const r = asNotice(await b.step.prepare(input('Giá qua đêm phòng Deluxe?', {}, old)));
      expect(r.code).toBe('E5102');
      expect(r.reason).toBe('partner_claims_stale');
      expect(r.handoff).toBe(false);
      expect(b.resolve).not.toHaveBeenCalled();
      expect(b.record.mock.calls[0][0]).toMatchObject({ status: 'denied', errorCode: 'E5102' });
    });

    it('a message that names ANOTHER hotel: refused (E5104), nothing requested, logged by key', async () => {
      const b = build();
      const r = asNotice(await b.step.prepare(input('Giá qua đêm khách sạn 2204 hôm nay?')));
      expect(r.code).toBe('E5104');
      expect(r.reason).toBe('partner_param_rejected');
      expect(r.handoff).toBe(false);
      expect(b.get).not.toHaveBeenCalled();
      const row = b.record.mock.calls[0][0] as Record<string, unknown>;
      expect(row).toMatchObject({ status: 'rejected', errorCode: 'E5104', rejectedKeys: ['hotel_mention'] });
      expect(JSON.stringify(row)).not.toContain('2204');
    });

    it('the partner being down: "we will confirm" notice WITH a hand-off', async () => {
      const down: PartnerApiClient = { mode: 'live', get: async () => { throw partnerError.unavailable('upstream_timeout'); } };
      const b = build({ client: down });
      const r = asNotice(await b.step.prepare(input('Giá qua đêm phòng Deluxe?')));
      expect(r.code).toBe('E5100');
      expect(r.reason).toBe('partner_unavailable');
      expect(r.handoff).toBe(true);
      expect(r.body).toContain('không đoán số liệu');
    });

    it('an unusable reply (wrong hotel echoed): notice + hand-off, never the data', async () => {
      const inner = new MockGo2JoyClient(DEFAULT_MOCK_SET, () => NOW);
      const wrong: PartnerApiClient = {
        mode: 'mock',
        get: async (_ctx, topic, query) =>
          inner.get(
            // hotel 2204's reply to hotel 1721's question
            { tenantId: 1, hotelSn: '2204', role: 'manager', verifiedAtMs: Date.now() } as never,
            topic,
            query,
          ),
      };
      const b = build({ client: wrong });
      const r = asNotice(await b.step.prepare(input('Giá qua đêm phòng Deluxe?')));
      expect(r.kind).toBe('notice');
      expect(r.code).toBe('E5105');
      expect(r.handoff).toBe(true);
      expect(JSON.stringify(r)).not.toMatch(/390\.000|280\.000/); // 2204's rates
    });

    it('any failure of one topic makes the whole turn a notice (no partial data)', async () => {
      const b = build();
      const r = await b.step.prepare(input('Đối soát tháng 9 và giá phòng qua đêm?', {}, claims({ role: 'receptionist' })));
      expect(asNotice(r).kind).toBe('notice');
      expect(asNotice(r).code).toBe('E5101');
    });

    it('the notice follows the session language', async () => {
      const b = build();
      const en = asNotice(await b.step.prepare(input('settlement for 2026-09?', { language: 'EN' }, claims({ role: 'receptionist' }))));
      expect(en.body).toMatch(/manager accounts/);
      const ko = asNotice(await b.step.prepare(input('정산 지난달', { language: 'KO' }, claims({ role: 'receptionist' }))));
      expect(ko.body).toMatch(/관리자/);
    });

    it('an unexpected exception after a topic was detected degrades to a notice, never to a silent fall-through', async () => {
      const b = build();
      b.resolve.mockRejectedValueOnce(new Error('bug'));
      const r = asNotice(await b.step.prepare(input('Giá qua đêm phòng Deluxe?')));
      expect(r.kind).toBe('notice');
      expect(r.code).toBe('E5100');
      expect(r.handoff).toBe(true);
    });
  });

  describe('verify — every number must be in the data block', () => {
    const block = async () => {
      const b = build();
      const r = asData(await b.step.prepare(input('Giá qua đêm cuối tuần phòng Deluxe?')));
      return { b, r };
    };

    it('passes an answer that copies the block', async () => {
      const { b, r } = await block();
      const v = await b.step.verify(r, 'Giá qua đêm phòng Deluxe ngày 17/10 là 475.000 ₫.', { question: 'giá?', language: 'VI' });
      expect(v.ok).toBe(true);
    });

    it('degrades an answer with a made-up number: unverified notice + hand-off + a log row', async () => {
      const { b, r } = await block();
      b.record.mockClear();
      const v = await b.step.verify(r, 'Giá qua đêm phòng Deluxe ngày 17/10 là 490.000 ₫.', { question: 'giá?', language: 'VI' });
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.notice.code).toBe('E5107');
      expect(v.notice.reason).toBe('partner_unverified');
      expect(v.notice.handoff).toBe(true);
      expect(v.notice.body).toContain('Tôi chưa xác nhận được các số liệu');
      expect(b.record.mock.calls[0][0]).toMatchObject({
        status: 'unverified',
        errorCode: 'E5107',
        hotelSn: '1721',
        conversationId: 77,
        messageId: 88,
        snapshotHash: r.evidence[0].snapshotHash,
      });
    });

    it('a number echoed from the customer or small numbers from cited knowledge are tolerated', async () => {
      const { b, r } = await block();
      expect((await b.step.verify(r, 'Bạn hỏi 450.000 ₫? Giá hiện tại 475.000 ₫.', { question: 'giá 450.000 đúng không', language: 'VI' })).ok).toBe(true);
      expect((await b.step.verify(r, 'Giá 475.000 ₫, hủy trước 24 giờ.', { question: 'q', kbTexts: ['Hủy trước 24 giờ'], language: 'VI' })).ok).toBe(true);
      expect((await b.step.verify(r, 'Giá 475.000 ₫, hủy trước 24 giờ.', { question: 'q', language: 'VI' })).ok).toBe(false);
    });
  });
});
