/**
 * Did the model answer in the session's language? (PLN-261019-Widget-Language-Follow-Selection D4)
 *
 * Script-level only, by design. Every mismatch measured on staging was Korean
 * text delivered to an English or Vietnamese session, and Hangul, kana and Han
 * never make up a third of a Latin-script reply by accident — a quoted name or
 * a glossary term in brackets is a few letters among hundreds. Latin-script languages are NOT told apart here
 * (English vs Vietnamese vs Spanish): accents are shared, names are quoted
 * verbatim, and a wrong verdict would translate a correct answer. Those stay
 * with the prompt.
 *
 * Returns false for short replies: "OK 👍" says nothing about language.
 */
const HANGUL = /[가-힣ㄱ-ㆎ]/gu;
const KANA = /[ぁ-ゟ゠-ヿ]/gu;
const HAN = /[一-鿿㐀-䶿]/gu;
const LETTER = /\p{L}/gu;

/** Replies with fewer letters than this are not judged. */
export const REPLY_LANGUAGE_MIN_LETTERS = 20;
/**
 * Share of CJK letters at which a Latin-script reply counts as the wrong
 * language. A Vietnamese answer built from go2joy's bilingual glossary carries
 * "(오버나이트 / Overnight)" style term annotations — a dozen Hangul letters in
 * four hundred — and a fixed count flagged it on the first staging turn
 * (RPT-261019 O1). A reply actually written in Korean is Hangul almost
 * entirely; the share tells the two apart, a count does not.
 */
export const REPLY_LANGUAGE_CJK_LEAK_SHARE = 0.3;
/** Share of the expected script below which a KO/JA/ZH reply counts as the wrong language. */
export const REPLY_LANGUAGE_TARGET_MIN_SHARE = 0.1;

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function replyLanguageMismatch(text: string | null | undefined, language: string | null | undefined): boolean {
  const value = (text ?? '').trim();
  if (!value) return false;
  const letters = count(value, LETTER);
  if (letters < REPLY_LANGUAGE_MIN_LETTERS) return false;
  const hangul = count(value, HANGUL);
  const kana = count(value, KANA);
  const han = count(value, HAN);
  const share = (n: number) => n / letters;
  switch (String(language ?? '').toUpperCase()) {
    case 'KO':
      return share(hangul) < REPLY_LANGUAGE_TARGET_MIN_SHARE;
    case 'JA':
      return share(kana + han) < REPLY_LANGUAGE_TARGET_MIN_SHARE;
    case 'ZH':
      return share(han) < REPLY_LANGUAGE_TARGET_MIN_SHARE;
    default:
      // EN / ES / VI and anything unregistered: Latin script expected.
      return share(hangul + kana + han) >= REPLY_LANGUAGE_CJK_LEAK_SHARE;
  }
}
