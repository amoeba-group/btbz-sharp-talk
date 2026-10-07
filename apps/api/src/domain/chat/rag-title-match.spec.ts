import { RagService } from './rag.service';
import { titleMatchScore } from './passage.util';

/**
 * FIX-261007-FAQ-Title-Match — an FAQ titled with the question comes first.
 * go2joy D3/E1: 2nd/1st by vector, dropped after fusion with the VN full-text leg.
 */
describe('titleMatchScore', () => {
  it('is 1 for the FAQ question asked verbatim (with or without the "Câu hỏi:" prefix)', () => {
    const t = 'Tôi (khách sạn) có thể thanh toán cho Go2Joy như nào?';
    expect(titleMatchScore(t, t)).toBe(1);
    expect(titleMatchScore(`Câu hỏi: ${t}`, 'tôi khách sạn có thể thanh toán cho go2joy như nào')).toBe(1);
  });

  it('is partial for a reworded question and 0 for short titles', () => {
    const s = titleMatchScore('Làm thế nào để liên hệ với khách đặt qua ứng dụng?', 'liên hệ khách đặt phòng qua ứng dụng thế nào');
    expect(s).toBeGreaterThan(0.6);
    expect(s).toBeLessThan(1);
    expect(titleMatchScore('Hoa hồng', 'hoa hồng là bao nhiêu')).toBe(0);
  });
});

describe('RagService.titleBonus', () => {
  it('outranks any fusion score for a near-verbatim title, nudges a partial one', () => {
    const q = 'Làm thế nào để liên hệ với khách đặt qua ứng dụng?';
    expect(RagService.titleBonus(q, q)).toBe(0.05);
    expect(RagService.titleBonus('Làm thế nào để liên hệ với khách đặt qua ứng dụng?', 'liên hệ với khách đặt qua ứng dụng')).toBeGreaterThan(0);
    expect(RagService.titleBonus('Chính sách hủy phòng của Go2Joy', q)).toBe(0);
    // Two legs at rank 1 give 2/61 ≈ 0.033 — still below the bonus.
    expect(RagService.titleBonus(q, q)).toBeGreaterThan(2 / 61);
  });
});

describe('classifyIntent prompt — asking how to contact is a question (G1)', () => {
  it('tells the classifier that "how do I reach support" is not agent_request', async () => {
    const complete = jest.fn(async () => ({ text: '{"intent":"other","needsOrderData":false,"confidence":0.8}' }));
    const svc = new RagService({} as never, {} as never, { complete } as never, {} as never, {} as never);
    await svc.classifyIntent(4, 'Cách liên hệ hỗ trợ kỹ thuật');
    const system = (complete.mock.calls[0] as unknown as [{ system: string }])[0].system;
    expect(system).toContain('Asking HOW to contact support');
  });
});
