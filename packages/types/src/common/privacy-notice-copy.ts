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
} as const;
export type PrivacyProfile = (typeof PRIVACY_PROFILE)[keyof typeof PRIVACY_PROFILE];

/** The lines the consent banner renders, in render order. */
export const PRIVACY_NOTICE_KEYS = [
  'title',
  'body',
  'items',
  'purpose',
  'retention',
  'aiProcessor',
] as const;
export type PrivacyNoticeKey = (typeof PRIVACY_NOTICE_KEYS)[number];

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
      if (text) kept[key] = text;
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
): ResolvedPrivacyNotice {
  const lang = (language ?? 'EN') as SessionLanguage;
  const own = PROFILE_COPY[profile]?.[lang] ?? {};
  const en = PROFILE_COPY[profile]?.EN ?? {};
  const overridden = overrides?.[lang] ?? {};
  const out: ResolvedPrivacyNotice = {};
  for (const key of PRIVACY_NOTICE_KEYS) {
    const value = overridden[key]?.trim() || own[key] || en[key];
    if (value) out[key] = value;
  }
  return out;
}

/** The profile text itself — the console shows it as the placeholder to edit against. */
export function privacyProfileCopy(
  profile: PrivacyProfile,
  language: SessionLanguage | null | undefined,
): ResolvedPrivacyNotice {
  return resolvePrivacyNotice(profile, null, language);
}

/** Typed export for `LocalizedText` users (the console edits one language at a time). */
export type { LocalizedText };
