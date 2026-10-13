/**
 * Vietnamese typed WITHOUT tone marks ("cho toi hoi gia phong qua dem").
 *
 * Range detection cannot see it: every letter is plain ASCII, so the detector
 * answered English — and a Vietnamese partner who types on a phone without
 * diacritics (very common) had a Vietnamese session flipped to English after
 * two such turns (PLN-261012 SG-53, found by the labelled eval corpus).
 *
 * What does separate it is vocabulary. Vietnamese syllables are short and a
 * fixed set of function words appears in nearly every sentence (không, tôi,
 * của, được, phòng, khách, …). So: strip marks, split into syllables, and score
 * them against two lists.
 *
 *  - STRONG: syllables that are not ordinary English words once the marks are
 *    gone. A hit is evidence.
 *  - WEAK: syllables that ARE English words (`co`, `ban`, `the`, `may`, `long`,
 *    `rat`). Never evidence on their own; they only add a little weight to a
 *    sentence that already has strong hits.
 *  - PHRASES: two-syllable collocations that settle a short message
 *    ("cam on", "xin chao", "khach san", "doi soat").
 *
 * The verdict needs at least two strong hits AND a density, because real
 * unaccented Vietnamese is dense in these words while an English sentence that
 * merely names a place ("Phong Nha", "San Francisco") has one at most. Portuguese
 * "não" collides with Vietnamese "nào" but is a single hit, so Portuguese stays
 * English, as the detector's documented contract requires. A session that is
 * already Vietnamese is trusted a little more (one strong hit, lower density),
 * because there the cheap error is staying put.
 *
 * This is a heuristic on purpose. It is cheap (no model call) and conservative
 * (wrongly calling English "Vietnamese" is worse than missing a short unaccented
 * message); the eval in detect-language.eval.spec.ts holds both numbers.
 */

/**
 * Syllables that are not ordinary English words once tone marks are removed:
 * the high-frequency Vietnamese function words plus the vocabulary of a partner
 * desk (rooms, bookings, settlement, accounts). Chosen from general Vietnamese
 * frequency, not from the eval corpus — the held-out set in the eval spec is the
 * check that it generalises.
 */
const STRONG = new Set(
  (
    // function words and particles
    'khong toi cua duoc nhung nhu nao nhieu cho vao neu cung sau truoc luc voi cac mot trong khi phai tren duoi ' +
    'roi chua muon giup hoi vay dau sao lam xin chao quen loi vui thua vua nay hom ngay gio phut tuan qua dem ' +
    'theo hon som them cuoi dau cuoi khoang du kien tung nhat moi ' +
    // people and parties
    'minh nguoi khach nhan vien chung ' +
    // hotel / booking / money / account vocabulary
    'phong dat huy doi soat nhap dang ky tai khoan ngan thanh toan tien hoan dich kiem thong lien quan khau ' +
    'giao gia phi hoa thue doanh thu cao tro huong cach thuc hien duyet xac chinh sach mien tiet chuong trinh ' +
    'khuyen giam giay phep phan tram trieu cuu thoi han truy phat nguon dinh quy luong chiu trach nhiem khieu ' +
    'ung dien thoai ngon ngu thuong hieu canh phap viec nuoc cong quoc van tieng ngung tam ' +
    // texting abbreviations that carry no other meaning
    'ko dc dk ntn sdt mk tk ks cty'
  ).split(/\s+/),
);

/**
 * Syllables that are ALSO ordinary English (or Romance) words — `co`, `ban`,
 * `the`, `may`, `long`, `rat`, `san`, `chat`. They add a little weight to a
 * sentence that already has strong hits and are never evidence on their own. A
 * word must be in exactly one list (asserted in the spec).
 */
const WEAK = new Set(
  (
    'co la va de bi ve ra di den hay thi se da vi ma con rat bay tin the may long that san cam on ban nam ' +
    'thang bao hang don tan hai ba hop dong ho so mat kinh ten bang man bon nha ke vu cap tra lai chi do bai ' +
    'xe dung tinh gap ai chat tu le tang anh dan hoc'
  ).split(/\s+/),
);

export const VIETNAMESE_ASCII_LISTS = { STRONG, WEAK };

/** Two-syllable collocations: each counts as two strong hits. */
const PHRASES = new Set([
  'cam on', 'xin chao', 'xin loi', 'vui long', 'khach san', 'khach hang', 'le tan', 'doi soat', 'tai khoan',
  'ngan hang', 'nhan vien', 'hoa don', 'hoan tien', 'thanh toan', 'dat phong', 'tra phong', 'huy phong',
  'nhan phong', 'gia phong', 'qua dem', 'theo gio', 'mat khau', 'dang nhap', 'dang ky', 'doanh thu', 'bao cao',
  'hop dong', 'ho so', 'giay phep', 'kinh doanh', 'khuyen mai', 'giam gia', 'nhu the', 'lam sao', 'bao nhieu',
  'bao lau', 'co the', 'duoc khong', 'co khong', 'khong co', 'khong the', 'khong duoc', 'cho toi', 'cho minh',
  'toi muon', 'toi can', 'toi bi', 'minh muon', 'giup toi', 'giup minh', 'ban oi', 'anh oi', 'chi oi', 'em oi',
  'nguoi that', 'gap nguoi', 'dien thoai', 'ung dung',
]);

/** Lowercase, drop tone marks and đ, keep a-z syllables. */
function syllables(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .match(/[a-z]+/g) ?? []
  ).filter((s) => s.length >= 2);
}

export interface UnaccentedVietnameseScore {
  strong: number;
  weak: number;
  syllables: number;
  /** (strong + ½ weak) / syllables — how much of the message is Vietnamese vocabulary. */
  density: number;
}

export function scoreUnaccentedVietnamese(text: string): UnaccentedVietnameseScore {
  const words = syllables(text);
  let strong = 0;
  let weak = 0;
  for (let i = 0; i < words.length; i++) {
    const pair = i + 1 < words.length ? `${words[i]} ${words[i + 1]}` : '';
    if (pair && PHRASES.has(pair)) {
      strong += 2;
      i++; // both syllables are consumed by the phrase
    } else if (STRONG.has(words[i])) {
      strong += 1;
    } else if (WEAK.has(words[i])) {
      weak += 1;
    }
  }
  const density = words.length ? (strong + weak / 2) / words.length : 0;
  return { strong, weak, syllables: words.length, density };
}

/**
 * Is this (marks-free or marks-light) Latin text Vietnamese?
 * @param preferVietnamese the session is already Vietnamese — one strong hit and
 *        a higher density are enough, because staying put is the cheap error.
 */
export function looksLikeUnaccentedVietnamese(text: string, preferVietnamese = false): boolean {
  const s = scoreUnaccentedVietnamese(text);
  if (preferVietnamese) return s.strong >= 1 && s.density >= 0.3;
  return s.strong >= 2 && s.density >= 0.4;
}
