import { detectLanguage } from './detect-language.util';

describe('detectLanguage', () => {
  describe('Korean', () => {
    it.each([
      '배송 언제 오나요?',
      '상담원 연결해 주세요',
      '뉴욕 날씨 알려주시오',
      // Mixed script: one Hangul syllable settles it, because no other
      // supported language uses them.
      '배송 언제 오나요? shipping',
      'iPhone 케이스 재고 있나요',
    ])('reads %s as Korean', (text) => {
      expect(detectLanguage(text)).toBe('KO');
    });
  });

  describe('Vietnamese', () => {
    // FIX-260916: every one of these used to come back 'ES', because the
    // Spanish rule treated any acute-accented vowel as Spanish and ran before
    // anything looked for Vietnamese. Two such turns in a row then moved a
    // Go2Joy session to Spanish and the RAG prompt said "Reply in ES".
    it.each([
      'Cho tôi hỏi giá phòng qua đêm',
      'Khách sạn còn phòng không?',
      'Tôi muốn hủy đặt phòng',
      'Có chỗ đậu xe ô tô không ạ',
      'Đối soát kỳ này của tôi bị sai',
      'Mình muốn được hướng dẫn quản lý đánh giá cho khách sạn',
      // đ / ơ / ư alone are proof: no other Latin-script language writes them.
      'đặt phòng theo giờ',
      'giá 2 giờ đầu là bao nhiêu',
      // Mixed with English product names.
      'Wifi có miễn phí không',
    ])('reads %s as Vietnamese regardless of session language', (text) => {
      expect(detectLanguage(text)).toBe('VI');
      expect(detectLanguage(text, 'EN')).toBe('VI');
      expect(detectLanguage(text, 'ES')).toBe('VI');
    });

    it('does not read a tone-marked sentence as Spanish even when acutes are present', () => {
      // Acute tones on plain vowels overlap Spanish; the hook on ỏ does not.
      expect(detectLanguage('Có bán cà phê không, hỏi giá')).toBe('VI');
    });

    describe('marks shared with other Latin-script languages (â ê ô, grave, tilde, acute only)', () => {
      // These sentences carry only marks that Portuguese/Italian/French — or,
      // for acutes, Spanish — also use. Range detection cannot settle them, so
      // the session's current language decides: a Vietnamese session keeps
      // Vietnamese, anything else keeps today's behaviour.
      it.each(['còn phòng không', 'có bãi xe không', 'cho tôi xin'])(
        'reads %s as Vietnamese when the session is already Vietnamese',
        (text) => {
          expect(detectLanguage(text, 'VI')).toBe('VI');
          expect(detectLanguage(text, 'vi')).toBe('VI');
        },
      );

      it('leaves weak-marked text alone on a non-Vietnamese session (Portuguese must not become Vietnamese)', () => {
        expect(detectLanguage('Não recebi meu pedido', 'EN')).toBe('EN');
        expect(detectLanguage('Não recebi meu pedido')).toBe('EN');
        // A Vietnamese session, however, reads the same marks as Vietnamese.
        expect(detectLanguage('Não recebi meu pedido', 'VI')).toBe('VI');
      });

      it('reads acute-only text as Vietnamese on a Vietnamese session and as Spanish elsewhere', () => {
        expect(detectLanguage('có xe máy', 'VI')).toBe('VI');
        expect(detectLanguage('có xe máy', 'EN')).toBe('ES');
        expect(detectLanguage('có xe máy')).toBe('ES');
      });
    });
  });

  describe('Spanish', () => {
    it.each([
      '¿Cuándo llega mi pedido?',
      'Necesito hablar con un agente, ¿es posible?',
      'Mi pedido no ha llegado todavía',
    ])('reads %s as Spanish', (text) => {
      expect(detectLanguage(text)).toBe('ES');
      expect(detectLanguage(text, 'EN')).toBe('ES');
    });

    it('keeps Spanish-only marks Spanish even on a Vietnamese session', () => {
      // ñ, ¿, ¡ and ü never occur in Vietnamese, so the bias does not apply.
      expect(detectLanguage('¿Cuándo llega mi pedido?', 'VI')).toBe('ES');
      expect(detectLanguage('Mañana llego tarde', 'VI')).toBe('ES');
    });

    it('reads unmarked Spanish as English — the known limit', () => {
      // No ñ, no ¿, no accents. Range detection cannot separate this from
      // English, and guessing Spanish would mislabel English shoppers.
      expect(detectLanguage('Quiero cancelar mi pedido')).toBe('EN');
    });
  });

  describe('English', () => {
    it.each([
      'How long does shipping take?',
      'Can I talk to a real person?',
      'I want to cancel my order',
    ])('reads %s as English', (text) => {
      expect(detectLanguage(text)).toBe('EN');
      // The bias only breaks ties between marked scripts; plain ASCII is English
      // on a Vietnamese session too, so an English turn can still switch it.
      expect(detectLanguage(text, 'VI')).toBe('EN');
    });
  });

  describe('no evidence', () => {
    it.each(['ok', 'ㅇㅇ', '네', '?', '   ', '', '123 456', '👍👍', 'dạ', 'ạ'])(
      'returns null for %s',
      (text) => {
        // Short acknowledgements are the flip-flop hazard: one "ok" must never
        // turn a Korean conversation's notices English — nor one "dạ" a
        // Vietnamese one.
        expect(detectLanguage(text)).toBeNull();
        expect(detectLanguage(text, 'VI')).toBeNull();
      },
    );

    it('returns null for null and undefined', () => {
      expect(detectLanguage(null)).toBeNull();
      expect(detectLanguage(undefined)).toBeNull();
    });

    it('counts letters, not length — punctuation does not buy a verdict', () => {
      expect(detectLanguage('!!! ??? ...')).toBeNull();
      // Three letters, however many exclamation marks follow.
      expect(detectLanguage('yes!!!!!!!!')).toBeNull();
      expect(detectLanguage('yeah!!!')).toBe('EN');
    });
  });
  // PLN-261012 SG-53 — found by the labelled eval corpus (detect-language.eval.spec.ts).
  describe('Vietnamese typed without tone marks', () => {
    it.each([
      'Cho toi hoi gia phong qua dem',
      'Khach san con phong khong',
      'Doi soat thang nay cua toi bi sai',
      'cam on ban',
      'xin chao',
    ])('reads %s as Vietnamese (it used to read as English)', (text) => {
      expect(detectLanguage(text)).toBe('VI');
      expect(detectLanguage(text, 'EN')).toBe('VI');
    });

    it('trusts a Vietnamese session more: one strong word is enough there, not elsewhere', () => {
      expect(detectLanguage('khong biet', 'VI')).toBe('VI');
      expect(detectLanguage('khong biet', 'EN')).toBe('EN');
      // A longer message carries its own evidence on any session.
      expect(detectLanguage('hmm khong biet lam sao day nhi', 'EN')).toBe('VI');
    });

    it.each([
      'I would like to list a hotel in Phong Nha Ke Bang',
      'Our hotel is on Nguyen Hue street in District 1',
      'Can you contact Dalat Palace at 0912345678?',
      'How long does shipping take?',
      'Please update the rate for Phong Nha Ecolodge',
    ])('does not read English that merely names a Vietnamese place (%s) as Vietnamese', (text) => {
      expect(detectLanguage(text)).toBe('EN');
      expect(detectLanguage(text, 'EN')).toBe('EN');
    });

    it('still reads Portuguese as English, as the contract requires', () => {
      // "não" collides with Vietnamese "nào" but is one hit, not two.
      expect(detectLanguage('Nao recebi meu pedido')).toBe('EN');
    });

    it('a short unaccented acknowledgement is still not evidence', () => {
      expect(detectLanguage('ko')).toBeNull();
      expect(detectLanguage('dc r')).toBeNull();
    });
  });

  describe('Japanese and Chinese (session languages that used to return nothing)', () => {
    it.each([
      'ありがとうございます',
      '予約をキャンセルしたいです',
      'ホテルアドミンにログインできません',
      'Hotel Admin のログインができません',
    ])('reads %s as Japanese — kana decides', (text) => {
      expect(detectLanguage(text)).toBe('JA');
    });

    it.each(['我想订一个房间', '请问结算单在哪里下载?', '我的 Hotel Admin 账号被锁了'])(
      'reads %s as Chinese — Han with no kana',
      (text) => {
        expect(detectLanguage(text)).toBe('ZH');
      },
    );

    it('Korean with Hanja stays Korean (Hangul outranks Han)', () => {
      expect(detectLanguage('예약 確認 부탁드립니다')).toBe('KO');
    });

    it('kana outranks Han: Japanese mixed with kanji is Japanese, not Chinese', () => {
      expect(detectLanguage('宿泊料金を変更する')).toBe('JA');
    });

    it('stays silent on one- and two-character replies, like every other language', () => {
      for (const text of ['はい', '好', '你好', '谢谢']) expect(detectLanguage(text)).toBeNull();
    });

    it('kanji-only Japanese reads as Chinese — the documented limit of script detection', () => {
      expect(detectLanguage('予約確認')).toBe('ZH');
    });
  });
});
