import { capContext, selectPassages } from './passage.util';

/** PLN-261007 R3 — the model sees whole FAQ entries, and the right part of long guides. */
describe('selectPassages', () => {
  it('returns a document within the budget whole (go2joy C1 is 1,588 chars)', () => {
    const c1 = 'Câu hỏi: quản lý đặt phòng đến?\n\n' + 'Đã thanh toán ...'.repeat(40) + '\n\nChưa thanh toán: trả tại khách sạn.';
    expect(c1.length).toBeLessThan(2000);
    expect(selectPassages(c1, 'quản lý đặt phòng', 2000)).toBe(c1);
  });

  it('keeps the first paragraph and the matching ones, in document order', () => {
    const doc = [
      'Hướng dẫn sử dụng Hotel Admin',
      'Phần 1: đăng nhập '.repeat(30),
      'Phần 2: khóa phòng theo giờ, chọn Theo giờ rồi nhập khung giờ.',
      'Phần 3: báo cáo doanh thu '.repeat(30),
      'Phần 4: khóa phòng qua đêm.',
    ].join('\n\n');
    const out = selectPassages(doc, 'Làm sao khóa phòng theo giờ?', 300);
    expect(out.startsWith('Hướng dẫn sử dụng Hotel Admin')).toBe(true);
    expect(out).toContain('Phần 2: khóa phòng theo giờ');
    expect(out).not.toContain('Phần 3');
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.indexOf('Phần 2')).toBeLessThan(out.indexOf('Phần 4') === -1 ? Infinity : out.indexOf('Phần 4'));
  });

  it('slices a single huge paragraph', () => {
    expect(selectPassages('x'.repeat(5000), 'q', 2000)).toHaveLength(2000);
  });
});

describe('capContext', () => {
  it('cuts from the lowest-ranked chunk backwards', () => {
    const out = capContext([{ snippet: 'a'.repeat(6) }, { snippet: 'b'.repeat(6) }, { snippet: 'c'.repeat(6) }], 10);
    expect(out.map((c) => c.snippet)).toEqual(['aaaaaa', 'bbbb']);
  });
});
