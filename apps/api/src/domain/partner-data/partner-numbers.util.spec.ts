import { numberTokens, verifyNumbers } from './partner-numbers.util';

/**
 * Post-generation number check (PLN-261012 SG-31): every number in the drafted
 * answer must be one the server-built data block holds — otherwise the answer
 * is withheld. Restyling a figure is free; changing it is not.
 */
describe('numberTokens', () => {
  const norms = (s: string) => numberTokens(s).map((t) => t.norm);

  it('reads Vietnamese, English and bare amounts as the same value', () => {
    expect(norms('450.000 ₫')).toEqual(['450000']);
    expect(norms('450,000 VND')).toEqual(['450000']);
    expect(norms('450000')).toEqual(['450000']);
    expect(norms('450.000đ')).toEqual(['450000']);
    expect(norms('1.200.000 đồng')).toEqual(['1200000']);
  });

  it('expands compact amounts (k, nghìn, triệu, tr, million, 만)', () => {
    expect(norms('450k')).toEqual(['450000']);
    expect(norms('450 nghìn')).toEqual(['450000']);
    expect(norms('1,5 triệu')).toEqual(['1500000']);
    expect(norms('1.5tr')).toEqual(['1500000']);
    expect(norms('2 million')).toEqual(['2000000']);
    expect(norms('3만')).toEqual(['30000']);
  });

  it('does not mistake a following word for a unit', () => {
    // "đêm" (night) starts with đ; "24h" and "2 mins" must stay plain numbers.
    expect(numberTokens('5 đêm')).toEqual([{ raw: '5', norm: '5', strict: false }]);
    expect(norms('24h')).toEqual(['24']);
    expect(norms('2 mins')).toEqual(['2']);
  });

  it('keeps decimals and handles both separator conventions', () => {
    expect(norms('4,5 sao')).toEqual(['4.5']);
    expect(norms('4.50')).toEqual(['4.5']);
    expect(norms('1.234,56')).toEqual(['1234.56']);
    expect(norms('1,234.56')).toEqual(['1234.56']);
  });

  it('splits dates and times into their numbers, ignoring leading zeros', () => {
    expect(norms('2026-10-17')).toEqual(['2026', '10', '17']);
    expect(norms('14:00')).toEqual(['14', '0']);
    expect(norms('07')).toEqual(['7']);
  });

  it('marks amounts and long numbers as strict, small numbers as not', () => {
    const strict = (s: string) => numberTokens(s).map((t) => t.strict);
    expect(strict('450.000 ₫')).toEqual([true]);
    expect(strict('450000')).toEqual([true]);
    expect(strict('G2J2610170001')).toEqual([false, true]);
    expect(strict('24 hours, 50%')).toEqual([false, false]);
    expect(strict('450k')).toEqual([true]);
  });

  it('ignores numbered-list markers', () => {
    expect(norms('1. Giá qua đêm 450.000 ₫\n2) Giá theo giờ 120.000 ₫\n- 3. phụ thu')).toEqual(['450000', '120000']);
  });
});

describe('verifyNumbers', () => {
  const block =
    '[rates] (data as of 2026-10-13T09:00:00.000+07:00)\n' +
    '- Deluxe (DELUXE) | overnight | 2026-10-17: base 450.000 ₫; extra 50.000 ₫; direct discount 0 ₫; flash sale -25.000 ₫; coupon 0 ₫; final 475.000 ₫\n' +
    '[policies]\n- cancellation policy: cancelled at least 24 hours before check-in: 100% refunded; cancelled at least 2 hours before check-in: 50% refunded\n' +
    '- booking G2J2610170001: status confirmed\n' +
    '- booking 2610140000123456: status cancelled';

  it('passes an answer that copies the block, in any number style', () => {
    expect(verifyNumbers('Giá qua đêm phòng Deluxe ngày 17/10 là 475.000 ₫ (đã gồm phụ thu 50.000 ₫).', { block }).ok).toBe(true);
    expect(verifyNumbers('The overnight rate is 475,000 VND.', { block }).ok).toBe(true);
    expect(verifyNumbers('Khoảng 475k cho một đêm.', { block }).ok).toBe(true);
    expect(verifyNumbers('Hủy trước 24 giờ được hoàn 100%, trước 2 giờ hoàn 50%.', { block }).ok).toBe(true);
    expect(verifyNumbers('Mã đặt phòng 2610140000123456 đã hủy.', { block }).ok).toBe(true);
  });

  it('degrades an answer with a number the model made up', () => {
    const r = verifyNumbers('Giá qua đêm phòng Deluxe là 480.000 ₫.', { block });
    expect(r.ok).toBe(false);
    expect(r.unverified).toEqual(['480.000 ₫']);
  });

  it('degrades the model\'s own arithmetic (a total that is nowhere in the data)', () => {
    // 475.000 + 120.000 is a sum the block does not contain.
    expect(verifyNumbers('Tổng cộng 595.000 ₫ cho cả hai.', { block }).ok).toBe(false);
  });

  it('degrades a rounded, converted or abbreviated figure that changes the value', () => {
    expect(verifyNumbers('Khoảng 500.000 ₫.', { block }).ok).toBe(false);
    expect(verifyNumbers('About 20 USD.', { block }).ok).toBe(false);
    expect(verifyNumbers('Around 0.5 million.', { block }).ok).toBe(false);
  });

  it('degrades a wrong date, hour or percentage', () => {
    expect(verifyNumbers('Hủy trước 12 giờ hoàn 100%.', { block }).ok).toBe(false);
    expect(verifyNumbers('Hoàn 75%.', { block }).ok).toBe(false);
    expect(verifyNumbers('Ngày 18/10.', { block }).ok).toBe(false);
  });

  it('degrades a wrong booking code / long id', () => {
    expect(verifyNumbers('Mã G2J2610170002 đã xác nhận.', { block }).ok).toBe(false);
    expect(verifyNumbers('Mã 2610140000123457.', { block }).ok).toBe(false);
  });

  it('lets the customer\'s own numbers be echoed back, strict ones too', () => {
    expect(verifyNumbers('Bạn hỏi 450.000 ₫ — giá hiện tại là 475.000 ₫.', { block, question: 'giá 450000 đúng không?' }).ok).toBe(true);
  });

  it('lets cited knowledge-base passages supply SMALL numbers only', () => {
    const kb = ['Phí hủy phòng xử lý trong 7 ngày làm việc.'];
    expect(verifyNumbers('Hoàn tiền trong 7 ngày.', { block, kbTexts: kb }).ok).toBe(true);
    // ...but never an amount: a KB example price must not stand in for the hotel's own.
    expect(verifyNumbers('Giá là 300.000 ₫.', { block, kbTexts: ['Ví dụ giá 300.000 ₫'] }).ok).toBe(false);
  });

  it('passes a reply with no numbers at all', () => {
    expect(verifyNumbers('Tôi không tìm thấy thông tin này.', { block }).ok).toBe(true);
  });

  it('caps the offenders it reports', () => {
    const r = verifyNumbers(Array.from({ length: 20 }, (_, i) => `${900000 + i} ₫`).join(' '), { block });
    expect(r.ok).toBe(false);
    expect(r.unverified.length).toBeLessThanOrEqual(8);
  });
});
