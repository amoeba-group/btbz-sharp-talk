/**
 * Which supported language a shopper is writing in (PLN-260813 D1).
 *
 * Character ranges, not a model: Hangul does not overlap any other supported
 * script, Vietnamese owns a set of letters no other Latin-script language
 * writes, and a per-turn model call to answer "is this Korean?" would cost
 * more than the problem.
 *
 * Returns null when the text is not evidence of anything. That case matters
 * more than it looks — "ok" in the middle of a Korean conversation must not
 * flip every later notice into English.
 *
 * FIX-260916: Vietnamese used to come back as Spanish. The Spanish rule
 * counted any acute-accented vowel (á é í ó ú) as Spanish and ran before
 * anything looked for Vietnamese, whose tone marks include those same
 * acutes. Two Vietnamese turns then moved a Go2Joy session to Spanish. The
 * order below puts the marks only Vietnamese writes first, and lets the
 * session's current language settle the marks that several languages share.
 */

/** Below this many letters a message says nothing about language (D5). */
const MIN_MEANINGFUL_CHARS = 4;

/** Hangul syllables. Jamo alone ("ㅇㅇ") is filler, not language. */
const HANGUL = /[가-힣]/;

/**
 * Letters and tone marks that, among Latin-script languages, only Vietnamese
 * writes: đ, ă, ơ, ư; the hook (ả) and dot-below (ạ) tones on any vowel; any
 * tone stacked on ă/â/ê/ô/ơ/ư; tilde on e/i/u/y and grave on y. Portuguese,
 * Italian, French and Spanish have none of these, so one occurrence decides.
 */
const VIETNAMESE_ONLY =
  /[đĐăĂơƠưƯảẢẻẺỉỈỏỎủỦỷỶạẠẹẸịỊọỌụỤỵỴấẤầẦẩẨẫẪậẬắẮằẰẳẲẵẴặẶếẾềỀểỂễỄệỆốỐồỒổỔỗỖộỘớỚờỜởỞỡỠợỢứỨừỪửỬữỮựỰẽẼĩĨũŨỹỸỳỲ]/;

/**
 * Marks Vietnamese shares with Portuguese, Italian or French: the plain
 * circumflex vowels, grave tones and tilde on a/o. Evidence of Vietnamese on a
 * Vietnamese session; nothing on any other, where they used to (and still)
 * read as English so a Portuguese shopper is not answered in Vietnamese.
 */
const VIETNAMESE_SHARED = /[âÂêÊôÔàÀèÈìÌòÒùÙãÃõÕ]/;

/** Marks only Spanish writes among the supported languages. */
const SPANISH_ONLY = /[ñÑ¿¡üÜ]/;

/**
 * Acute accents: Spanish stress marks, and also the Vietnamese rising tone
 * (sắc) on a plain vowel. Alone they cannot tell the two apart; the session
 * decides. Off a Vietnamese session this keeps the pre-fix verdict (Spanish),
 * and a Spanish sentence without any of the marks above still reads as
 * English — the documented limit of range detection (PLN-260813 §8).
 */
const ACUTE = /[áéíóúÁÉÍÓÚ]/;

const LATIN_LETTER = /[a-zA-ZÀ-ɏẠ-ỹ]/;

export type DetectedLanguage = 'EN' | 'ES' | 'KO' | 'VI';

/** Letters only — digits, punctuation, emoji and spaces carry no signal. */
function meaningfulLength(text: string): number {
  return (text.match(/[\p{L}]/gu) ?? []).length;
}

/**
 * @param text  the shopper's message
 * @param bias  the language the session is in right now (`session.language`);
 *              consulted only for marks that more than one language writes.
 */
export function detectLanguage(
  text: string | null | undefined,
  bias?: string | null,
): DetectedLanguage | null {
  const value = (text ?? '').trim();
  if (!value) return null;

  // The length gate runs first, ahead of the script rules. A single Hangul
  // syllable ("네") — or a Vietnamese "dạ" — identifies the script but not the
  // shopper's language; one-word acknowledgements are exactly what the streak
  // rule exists to ignore, and letting them through here would defeat it.
  if (meaningfulLength(value) < MIN_MEANINGFUL_CHARS) return null;

  if (HANGUL.test(value)) return 'KO';
  if (VIETNAMESE_ONLY.test(value)) return 'VI';
  if (SPANISH_ONLY.test(value)) return 'ES';

  const preferVietnamese = String(bias ?? '').toUpperCase() === 'VI';
  if (VIETNAMESE_SHARED.test(value)) {
    if (preferVietnamese) return 'VI';
    // Shared marks with an acute alongside ("está" next to an "à") keep the
    // Spanish reading they had before; shared marks alone never counted.
    return ACUTE.test(value) ? 'ES' : 'EN';
  }
  if (ACUTE.test(value)) return preferVietnamese ? 'VI' : 'ES';
  return LATIN_LETTER.test(value) ? 'EN' : null;
}
