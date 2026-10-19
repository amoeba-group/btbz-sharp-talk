import {
  REPLY_LANGUAGE_CJK_LEAK,
  REPLY_LANGUAGE_MIN_LETTERS,
  replyLanguageMismatch,
} from './reply-language.util';

/** PLN-261019 D4 — script-level check behind the reply-language rule. */
describe('replyLanguageMismatch', () => {
  const KO = '안녕하세요. 예약 이의 제기 절차를 안내해 드리겠습니다. 체크아웃 후 12시간 이내에 신청하세요.';
  const VI = 'Xin chào. Đây là hướng dẫn quy trình khiếu nại đặt phòng sau khi khách trả phòng.';
  const EN = 'Hello. Here is how the booking dispute process works after the guest checks out.';

  it('flags Korean delivered to an English or Vietnamese session (the staging cases)', () => {
    expect(replyLanguageMismatch(KO, 'EN')).toBe(true);
    expect(replyLanguageMismatch(KO, 'VI')).toBe(true);
    expect(replyLanguageMismatch(KO, 'vi')).toBe(true);
  });

  it('flags a Latin-script reply on a Korean session', () => {
    expect(replyLanguageMismatch(EN, 'KO')).toBe(true);
    expect(replyLanguageMismatch(VI, 'KO')).toBe(true);
  });

  it('accepts matching scripts', () => {
    expect(replyLanguageMismatch(KO, 'KO')).toBe(false);
    expect(replyLanguageMismatch(EN, 'EN')).toBe(false);
    expect(replyLanguageMismatch(VI, 'VI')).toBe(false);
    expect(replyLanguageMismatch('こんにちは。ご予約の確認方法をご案内します。', 'JA')).toBe(false);
    expect(replyLanguageMismatch('您好。以下是查看预订状态的方法，请在后台打开仪表盘。', 'ZH')).toBe(false);
  });

  it('does not tell Latin-script languages apart — that stays with the prompt', () => {
    expect(replyLanguageMismatch(EN, 'VI')).toBe(false);
    expect(replyLanguageMismatch(VI, 'EN')).toBe(false);
    expect(replyLanguageMismatch(EN, 'ES')).toBe(false);
  });

  it('tolerates a quoted CJK name inside a Latin reply, up to the leak limit', () => {
    const name = '가'.repeat(REPLY_LANGUAGE_CJK_LEAK - 1);
    expect(replyLanguageMismatch(`${EN} The hotel is listed as ${name}.`, 'EN')).toBe(false);
    expect(replyLanguageMismatch(`${EN} The hotel is listed as ${name}가.`, 'EN')).toBe(true);
  });

  it('does not judge short replies', () => {
    expect(replyLanguageMismatch('OK 👍', 'KO')).toBe(false);
    expect(replyLanguageMismatch('네, 가능합니다.', 'EN')).toBe(false);
    expect(replyLanguageMismatch('a'.repeat(REPLY_LANGUAGE_MIN_LETTERS - 1), 'KO')).toBe(false);
    expect(replyLanguageMismatch('a'.repeat(REPLY_LANGUAGE_MIN_LETTERS), 'KO')).toBe(true);
    expect(replyLanguageMismatch('', 'KO')).toBe(false);
    expect(replyLanguageMismatch(null, 'EN')).toBe(false);
  });
});
