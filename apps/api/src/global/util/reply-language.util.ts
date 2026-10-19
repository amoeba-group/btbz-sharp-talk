/**
 * Did the model answer in the session's language? (PLN-261019-Widget-Language-Follow-Selection D4)
 *
 * Script-level only, by design. Every mismatch measured on staging was Korean
 * text delivered to an English or Vietnamese session, and Hangul, kana and Han
 * never appear in a Latin-script reply by accident — a product name is a word
 * or two, not eight letters. Latin-script languages are NOT told apart here
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
/** CJK letters a Latin-script reply may carry (a quoted name) before it counts as leaked. */
export const REPLY_LANGUAGE_CJK_LEAK = 8;

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function replyLanguageMismatch(text: string | null | undefined, language: string | null | undefined): boolean {
  const value = (text ?? '').trim();
  if (!value || count(value, LETTER) < REPLY_LANGUAGE_MIN_LETTERS) return false;
  const hangul = count(value, HANGUL);
  const kana = count(value, KANA);
  const han = count(value, HAN);
  switch (String(language ?? '').toUpperCase()) {
    case 'KO':
      return hangul === 0;
    case 'JA':
      return kana + han === 0;
    case 'ZH':
      return han === 0;
    default:
      // EN / ES / VI and anything unregistered: Latin script expected.
      return hangul + kana + han >= REPLY_LANGUAGE_CJK_LEAK;
  }
}
