/**
 * Consent notice copy (PLN-261001 §2).
 *
 * The six lines of the consent banner used to live only in the widget bundle,
 * in six languages, written for a store: a lodging tenant's shoppers were told
 * we collect their "order lookups". The copy now comes from the server —
 * an industry PROFILE supplies it, and a tenant may overwrite individual lines.
 *
 * Three rules shape this file:
 *   1. A tenant that configured nothing must see exactly what it sees today,
 *      so the profile falls back to the commerce text when nothing is set.
 *   2. An empty box is not an edit. A blank override falls through to the
 *      profile rather than publishing an empty line in a legal notice.
 *   3. One language filled in does not blank the other five — each language
 *      resolves independently, and the profile's own EN is the last resort.
 */

import type { LocalizedText, SessionLanguage } from './language';

export const PRIVACY_PROFILE = {
  COMMERCE: 'commerce',
  LODGING: 'lodging',
  GENERIC: 'generic',
  /**
   * Vietnam personal-data notice (PLN-261012 SG-70, REQ D-17). The other
   * profiles supply only the two lines that differ by industry and lean on the
   * widget's bundled text for the rest — and that bundled text is a CCPA/GA4
   * notice, which is wrong for a Vietnamese partner. This profile therefore
   * supplies EVERY line itself and never falls through to the bundle.
   *
   * ⚠️ DRAFT WORDING — Go2Joy's counsel must confirm the governing statute and
   * the legal basis for processing and for the cross-border transfer (the repo
   * only ever cited Decree 13/2023; whether the 2025 Personal Data Protection
   * Law applies, and its article numbers, is NOT confirmed here), and the
   * Vietnamese text needs a native-speaker review. See
   * docs/guide/GUIDE-261013-Go2Joy-PDPL-Checklist.md. None of that caveat is
   * shown to end users; it lives in code and docs on purpose.
   */
  VN_PDPL: 'vn_pdpl',
} as const;
export type PrivacyProfile = (typeof PRIVACY_PROFILE)[keyof typeof PRIVACY_PROFILE];

/**
 * The lines the consent banner renders. The first six are the original set; the
 * last three (PLN-261012 SG-70) exist only for profiles that must name the
 * controller, the cross-border transfer and the data-subject rights. Appended,
 * not interleaved: the banner decides the on-screen order, and unknown keys are
 * dropped at normalisation, so this list is also the allowlist for what a
 * tenant may store.
 */
export const PRIVACY_NOTICE_KEYS = [
  'title',
  'body',
  'items',
  'purpose',
  'retention',
  'aiProcessor',
  'controller',
  'crossBorder',
  'rights',
] as const;
export type PrivacyNoticeKey = (typeof PRIVACY_NOTICE_KEYS)[number];

/**
 * Values the SERVER fills into `{{retentionDays}}` / `{{region}}` before the
 * notice leaves the API (PLN-261012 SG-70). Interpolating here — not in the
 * widget — is the point: the number a shopper reads is the number the purge
 * job enforces, read from the same env, so the notice cannot drift from what
 * the deployment actually does.
 */
export interface PrivacyNoticeContext {
  /** The enforced conversation-log retention window, in days. */
  retentionDays?: number | null;
  /** AI_PROCESSING_REGION code (US/EU/VN/KR/JP/SG, or anything an operator set). */
  region?: string | null;
}

/**
 * Region names per language, mirroring the widget's own `regions.*` strings so
 * the banner and the chat footer say the same thing. An unknown code is shown
 * as written (same as the widget's `defaultValue`).
 */
const REGION_NAME: Record<SessionLanguage, Record<string, string>> = {
  EN: { US: 'the United States', EU: 'the European Union', VN: 'Viet Nam', KR: 'South Korea', JP: 'Japan', SG: 'Singapore' },
  ES: { US: 'Estados Unidos', EU: 'la Unión Europea', VN: 'Vietnam', KR: 'Corea del Sur', JP: 'Japón', SG: 'Singapur' },
  KO: { US: '미국', EU: '유럽연합', VN: '베트남', KR: '대한민국', JP: '일본', SG: '싱가포르' },
  VI: { US: 'Hoa Kỳ', EU: 'Liên minh châu Âu', VN: 'Việt Nam', KR: 'Hàn Quốc', JP: 'Nhật Bản', SG: 'Singapore' },
  JA: { US: '米国', EU: '欧州連合', VN: 'ベトナム', KR: '韓国', JP: '日本', SG: 'シンガポール' },
  ZH: { US: '美国', EU: '欧盟', VN: '越南', KR: '韩国', JP: '日本', SG: '新加坡' },
};

/** Name of an AI-processing region in a language; unknown codes pass through. */
export function aiRegionName(region: string, language: SessionLanguage): string {
  const code = region.trim().toUpperCase();
  return REGION_NAME[language]?.[code] ?? REGION_NAME.EN[code] ?? region.trim();
}

/**
 * Fill `{{retentionDays}}` and `{{region}}` in one line. A value the context
 * does not carry leaves its token alone (the caller, not this function, decides
 * what a missing value means) — but every server call site passes both.
 */
export function interpolateNoticeLine(
  text: string,
  language: SessionLanguage,
  ctx: PrivacyNoticeContext | undefined,
): string {
  if (!ctx || !text.includes('{{')) return text;
  let out = text;
  if (ctx.retentionDays != null && Number.isFinite(ctx.retentionDays)) {
    out = out.replace(/\{\{\s*retentionDays\s*\}\}/g, String(ctx.retentionDays));
  }
  if (ctx.region != null && ctx.region.trim()) {
    out = out.replace(/\{\{\s*region\s*\}\}/g, aiRegionName(ctx.region, language));
  }
  return out;
}

/**
 * Marker for a spot the tenant still has to fill in (controller name, address,
 * DPO contact). The VN_PDPL profile ships these as `[[…]]` so an unedited
 * draft is visibly unfinished rather than silently wrong; the console warns
 * while any are left in the notice a shopper would see.
 */
const UNFILLED_PLACEHOLDER = /\[\[[^\]]*\]\]/;

export function hasUnfilledPlaceholder(text: string | null | undefined): boolean {
  return !!text && UNFILLED_PLACEHOLDER.test(text);
}

/** Per-language overrides, only for the lines a tenant actually rewrote. */
export type PrivacyNoticeCopy = Partial<
  Record<SessionLanguage, Partial<Record<PrivacyNoticeKey, string>>>
>;

/** One resolved notice, ready to render. Missing keys = the widget's own copy. */
export type ResolvedPrivacyNotice = Partial<Record<PrivacyNoticeKey, string>>;

/**
 * What differs between industries is WHAT WE COLLECT and WHY. Title, retention
 * and the AI line are the same promise everywhere, so they are not repeated per
 * profile — the widget keeps rendering its own text for anything absent here,
 * which is also what an older widget build does with the whole payload.
 * (`vn_pdpl` is the exception: it is a complete notice, see below.)
 */
const PROFILE_COPY: Record<PrivacyProfile, Partial<Record<SessionLanguage, ResolvedPrivacyNotice>>> = {
  commerce: {
    KO: {
      items: '수집 항목: 채팅 메시지, 요청하신 주문 조회 내역, 기본 기기 정보',
      purpose: '이용 목적: 문의 응대 및 고객 지원 제공',
    },
    EN: {
      items: 'What we collect: your chat messages, order lookups you request, and basic device info.',
      purpose: 'Why: to answer your questions and provide customer support.',
    },
    ES: {
      items: 'Qué recopilamos: tus mensajes de chat, las consultas de pedidos que solicites e información básica del dispositivo.',
      purpose: 'Para qué: responder tus preguntas y brindar atención al cliente.',
    },
    VI: {
      items: 'Chúng tôi thu thập: tin nhắn trò chuyện, lịch sử tra cứu đơn hàng bạn yêu cầu và thông tin thiết bị cơ bản.',
      purpose: 'Mục đích: giải đáp thắc mắc và hỗ trợ khách hàng.',
    },
    JA: {
      items: '収集する情報：チャットのメッセージ、ご依頼いただいた注文照会の履歴、基本的な端末情報',
      purpose: '利用目的：お問い合わせへの対応およびカスタマーサポートの提供',
    },
    ZH: {
      items: '收集内容：聊天消息、您请求的订单查询记录、基本设备信息',
      purpose: '使用目的：回复咨询并提供客户支持',
    },
  },
  lodging: {
    KO: {
      items: '수집 항목: 채팅 메시지, 요청하신 예약 조회 내역, 기본 기기 정보',
      purpose: '이용 목적: 문의 응대 및 숙박 이용 지원',
    },
    EN: {
      items: 'What we collect: your chat messages, booking lookups you request, and basic device info.',
      purpose: 'Why: to answer your questions and support your stay.',
    },
    ES: {
      items: 'Qué recopilamos: tus mensajes de chat, las consultas de reservas que solicites e información básica del dispositivo.',
      purpose: 'Para qué: responder tus preguntas y asistirte durante tu estancia.',
    },
    VI: {
      items: 'Chúng tôi thu thập: tin nhắn trò chuyện, lịch sử tra cứu đặt phòng bạn yêu cầu và thông tin thiết bị cơ bản.',
      purpose: 'Mục đích: giải đáp thắc mắc và hỗ trợ kỳ nghỉ của bạn.',
    },
    JA: {
      items: '収集する情報：チャットのメッセージ、ご依頼いただいた予約照会の履歴、基本的な端末情報',
      purpose: '利用目的：お問い合わせへの対応および宿泊のサポート',
    },
    ZH: {
      items: '收集内容：聊天消息、您请求的预订查询记录、基本设备信息',
      purpose: '使用目的：回复咨询并为您的入住提供支持',
    },
  },
  generic: {
    KO: {
      items: '수집 항목: 채팅 메시지, 기본 기기 정보',
      purpose: '이용 목적: 문의 응대',
    },
    EN: {
      items: 'What we collect: your chat messages and basic device info.',
      purpose: 'Why: to answer your questions.',
    },
    ES: {
      items: 'Qué recopilamos: tus mensajes de chat e información básica del dispositivo.',
      purpose: 'Para qué: responder tus preguntas.',
    },
    VI: {
      items: 'Chúng tôi thu thập: tin nhắn trò chuyện và thông tin thiết bị cơ bản.',
      purpose: 'Mục đích: giải đáp thắc mắc của bạn.',
    },
    JA: {
      items: '収集する情報：チャットのメッセージ、基本的な端末情報',
      purpose: '利用目的：お問い合わせへの対応',
    },
    ZH: {
      items: '收集内容：聊天消息、基本设备信息',
      purpose: '使用目的：回复咨询',
    },
  },
  // PLN-261012 SG-70. Only vi + en are written: every other language reads the
  // EN lines (resolvePrivacyNotice falls back per key) rather than the widget's
  // bundled CCPA/GA4 text, which is why this profile fills ALL nine keys.
  // `{{retentionDays}}` / `{{region}}` are filled server-side; `[[…]]` marks the
  // controller details Go2Joy's counsel / the tenant must supply (see
  // hasUnfilledPlaceholder). DRAFT — legal basis, statute and vi phrasing are
  // unconfirmed (docs/guide/GUIDE-261013-Go2Joy-PDPL-Checklist.md).
  vn_pdpl: {
    VI: {
      title: 'Thông báo về xử lý dữ liệu cá nhân',
      body: 'Để hỗ trợ bạn, chúng tôi xử lý một số dữ liệu cá nhân khi bạn trò chuyện. Vui lòng đọc các nội dung bên dưới và chọn "Đồng ý" nếu bạn muốn tiếp tục.',
      controller:
        'Bên kiểm soát dữ liệu: [[tên pháp nhân Go2Joy]], [[địa chỉ]]. Đầu mối bảo vệ dữ liệu cá nhân (DPO): [[email hoặc số điện thoại]].',
      items:
        'Dữ liệu được xử lý: nội dung tin nhắn, thông tin khách sạn và vai trò do Go2Joy xác thực (nếu bạn đã đăng nhập) và thông tin thiết bị cơ bản.',
      purpose: 'Mục đích: giải đáp thắc mắc và hỗ trợ bạn sử dụng dịch vụ.',
      retention:
        'Thời hạn lưu trữ: dữ liệu trò chuyện được giữ tối đa {{retentionDays}} ngày, sau đó sẽ bị xóa.',
      aiProcessor:
        'Bên nhận dữ liệu: tin nhắn của bạn được gửi tới nhà cung cấp AI (Anthropic) và dịch vụ tìm kiếm ngữ nghĩa (Voyage AI) tại {{region}}. Tùy cấu hình, dữ liệu liên quan cũng có thể được chuyển tới dịch vụ gửi email (SMTP) và công cụ nhắn tin nội bộ (Slack) của đội hỗ trợ.',
      crossBorder:
        'Chuyển dữ liệu ra nước ngoài: việc xử lý bằng AI diễn ra tại {{region}}. Nếu nơi đó nằm ngoài Việt Nam, dữ liệu của bạn sẽ được chuyển ra nước ngoài để phục vụ việc xử lý này.',
      rights:
        'Quyền của bạn: được biết, đồng ý hoặc không đồng ý, truy cập, chỉnh sửa, xóa, hạn chế hoặc phản đối việc xử lý dữ liệu, và rút lại sự đồng ý bất cứ lúc nào tại mục "Lựa chọn quyền riêng tư & dữ liệu của tôi" hoặc qua đầu mối bảo vệ dữ liệu nêu trên. Việc rút lại sự đồng ý không ảnh hưởng đến việc xử lý đã thực hiện trước đó.',
    },
    EN: {
      title: 'Personal data processing notice',
      body: 'To help you, we process some personal data while you chat. Please read the points below and choose "Agree" if you want to continue.',
      controller:
        'Data controller: [[Go2Joy legal entity name]], [[address]]. Data protection contact (DPO): [[email or phone]].',
      items:
        'Data we process: your messages, the hotel and role verified by Go2Joy (if you are signed in), and basic device information.',
      purpose: 'Why: to answer your questions and help you use the service.',
      retention:
        'Retention: chat data is kept for up to {{retentionDays}} days, then deleted.',
      aiProcessor:
        'Recipients: your messages are sent to our AI provider (Anthropic) and our semantic search provider (Voyage AI) in {{region}}. Depending on configuration, related data may also reach our email delivery service (SMTP) and the support team\'s internal messaging tool (Slack).',
      crossBorder:
        'Cross-border transfer: AI processing takes place in {{region}}. If that is outside Viet Nam, your data is transferred abroad for this processing.',
      rights:
        'Your rights: to be informed, to agree or refuse, to access, correct, delete, restrict or object to the processing of your data, and to withdraw your consent at any time under "My privacy & data choices" or through the data protection contact above. Withdrawing does not affect processing carried out before it.',
    },
  },
};

export function isPrivacyProfile(value: unknown): value is PrivacyProfile {
  return Object.values(PRIVACY_PROFILE).includes(value as PrivacyProfile);
}

/**
 * Which profile a tenant is on. An explicit choice wins; otherwise the commerce
 * flag decides, so **every tenant that has configured nothing keeps the copy it
 * has today** and a lodging tenant only has to flip one setting.
 */
export function resolvePrivacyProfile(
  stored: string | null | undefined,
  commerceEnabled: boolean,
): PrivacyProfile {
  if (isPrivacyProfile(stored)) return stored;
  return commerceEnabled ? PRIVACY_PROFILE.COMMERCE : PRIVACY_PROFILE.GENERIC;
}

/**
 * Longest a stored line may be. The console box caps at 800; this is the
 * server-side backstop so the JSON column cannot be filled through the API.
 */
export const PRIVACY_NOTICE_LINE_MAX = 1000;

/** Keep only non-empty strings on known keys — a blank box is not an override. */
export function normalizePrivacyNoticeCopy(input: unknown): PrivacyNoticeCopy | null {
  if (!input || typeof input !== 'object') return null;
  const out: PrivacyNoticeCopy = {};
  for (const [lang, lines] of Object.entries(input as Record<string, unknown>)) {
    if (!lines || typeof lines !== 'object') continue;
    const kept: Partial<Record<PrivacyNoticeKey, string>> = {};
    for (const key of PRIVACY_NOTICE_KEYS) {
      const value = (lines as Record<string, unknown>)[key];
      if (typeof value !== 'string') continue;
      const text = value.trim();
      if (text) kept[key] = text.slice(0, PRIVACY_NOTICE_LINE_MAX);
    }
    if (Object.keys(kept).length) out[lang.toUpperCase() as SessionLanguage] = kept;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The notice this session should see: tenant override → profile in that
 * language → profile in English. Anything still missing is left out entirely so
 * the widget falls back to its bundled copy — a key we cannot fill must never
 * travel as an empty string, which would render a blank line in a legal notice.
 */
export function resolvePrivacyNotice(
  profile: PrivacyProfile,
  overrides: PrivacyNoticeCopy | null | undefined,
  language: SessionLanguage | null | undefined,
  /** Server-side values for `{{retentionDays}}` / `{{region}}` (PLN-261012 SG-70). */
  ctx?: PrivacyNoticeContext,
): ResolvedPrivacyNotice {
  const lang = (language ?? 'EN') as SessionLanguage;
  const own = PROFILE_COPY[profile]?.[lang] ?? {};
  const en = PROFILE_COPY[profile]?.EN ?? {};
  const overridden = overrides?.[lang] ?? {};
  const out: ResolvedPrivacyNotice = {};
  for (const key of PRIVACY_NOTICE_KEYS) {
    // Where the line really came from decides the language of the region name:
    // a Korean session reading the profile's EN fallback must see "the United
    // States", not "미국" spliced into an English sentence.
    const tenantLine = overridden[key]?.trim();
    const value = tenantLine || own[key] || en[key];
    if (!value) continue;
    const from: SessionLanguage = tenantLine || own[key] ? lang : 'EN';
    // Applies to a tenant's own wording too, so an operator can write
    // `{{retentionDays}}` in an override and still have it follow the env.
    out[key] = interpolateNoticeLine(value, from, ctx);
  }
  return out;
}

/** The profile text itself — the console shows it as the placeholder to edit against. */
export function privacyProfileCopy(
  profile: PrivacyProfile,
  language: SessionLanguage | null | undefined,
  ctx?: PrivacyNoticeContext,
): ResolvedPrivacyNotice {
  return resolvePrivacyNotice(profile, null, language, ctx);
}

/** Typed export for `LocalizedText` users (the console edits one language at a time). */
export type { LocalizedText };
