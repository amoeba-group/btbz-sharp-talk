import { MODERATION_DECISION } from '@sharptalk/types';
import { KnowledgeService } from './knowledge.service';
import { PartnerGoldenService } from '../partner-data/partner-golden.service';

/**
 * KnowledgeService.ask with a prepared partner turn (PLN-261012 SG-31): the
 * golden-run path, which bypasses ChatService. The same safety properties as
 * the chat must hold here, or a regression run would grade something the chat
 * would never say.
 */
describe('KnowledgeService.ask — partner turn', () => {
  const NOW = Date.parse('2026-10-13T02:00:00.000Z');
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  const build = (answerText: string) => {
    const rag = { answer: jest.fn(async () => ({ text: answerText, confidence: 0.9, citations: [] })) };
    const moderate = jest.fn(async (p: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text: p.text }));
    // Only what ask() touches; the rest of KnowledgeService is irrelevant here.
    const svc = Object.create(KnowledgeService.prototype) as KnowledgeService;
    Object.assign(svc, {
      rag,
      moderation: { moderate },
      docRepo: { find: jest.fn(async () => []) },
      conflicts: { forDocuments: jest.fn(async () => new Set()) },
    });
    return { svc, rag, moderate };
  };
  const golden = new PartnerGoldenService();
  const prepared = (hotelSn: string, role: 'manager' | 'receptionist', q: string) =>
    golden.prepare(1, { hotelSn, role }, q, 'VI');

  it('without a partner turn it is exactly the old call (no 8th..10th argument content)', async () => {
    const { svc, rag, moderate } = build('ok');
    const res = await svc.ask(1, 'refunds?', 'EN', undefined, 5);
    expect(rag.answer).toHaveBeenCalledWith(1, 'refunds?', 'EN', undefined, undefined, undefined, 5, undefined, undefined, undefined);
    expect(moderate.mock.calls[0][0]).not.toHaveProperty('protect');
    expect(res).toMatchObject({ answer: 'ok', confidence: 0.9, blocked: false });
  });

  it('grounds the answer in the data block and shields the block\'s ids in moderation', async () => {
    const { svc, rag, moderate } = build('Mã 2610140000123456 đã hủy, giá 300.000 ₫.');
    const partner = await prepared('1721', 'manager', 'Tra cứu đặt phòng 2610140000123456');
    const res = await svc.ask(1, 'Tra cứu đặt phòng 2610140000123456', 'VI', undefined, null, partner);

    expect((rag.answer.mock.calls[0] as unknown[])[9]).toEqual({ partnerData: expect.stringContaining('booking 2610140000123456') });
    expect((moderate.mock.calls[0][0] as { protect: string[] }).protect).toContain('2610140000123456');
    expect(res.answer).toContain('2610140000123456');
  });

  it('degrades an answer with an invented number — the run then fails any graded fact', async () => {
    const { svc } = build('Giá qua đêm phòng Deluxe là 480.000 ₫.');
    const partner = await prepared('1721', 'manager', 'Giá qua đêm phòng Deluxe hôm nay?');
    const res = await svc.ask(1, 'Giá qua đêm phòng Deluxe hôm nay?', 'VI', undefined, null, partner);
    expect(res.answer).toContain('Tôi chưa xác nhận được các số liệu');
    expect(res.answer).not.toContain('480.000');
    expect(res.confidence).toBe(0);
  });

  it('passes a faithful answer', async () => {
    const { svc } = build('Giá qua đêm phòng Deluxe là 425.000 ₫.');
    const partner = await prepared('1721', 'manager', 'Giá qua đêm phòng Deluxe hôm nay?');
    const res = await svc.ask(1, 'Giá qua đêm phòng Deluxe hôm nay?', 'VI', undefined, null, partner);
    expect(res.answer).toBe('Giá qua đêm phòng Deluxe là 425.000 ₫.');
  });

  it('a refusal notice IS the answer: fixed text, no model call', async () => {
    const { svc, rag } = build('should not be used');
    const partner = await prepared('1721', 'receptionist', 'Đối soát tháng 9 còn bao nhiêu?');
    const res = await svc.ask(1, 'Đối soát tháng 9 còn bao nhiêu?', 'VI', undefined, null, partner);
    expect(rag.answer).not.toHaveBeenCalled();
    expect(res.answer).toContain('Quản lý');
    expect(res.blocked).toBe(false);
    expect(res.sources).toEqual([]);
  });
});
