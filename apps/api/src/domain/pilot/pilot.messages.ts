import type { LocalizedText } from '@sharptalk/types';

/**
 * What a hotel that is not on the pilot list is told (PLN-261012 SG-40, W8:
 * "Chưa áp dụng cho khách sạn của bạn"), in the six registered languages.
 *
 * Kept here rather than in ChatService's SYSTEM_MESSAGES table because two places
 * need the same wording — the soft system reply a refused chat turn gets, and the
 * `notice` the session response hands the widget for its notice panel — and
 * PilotService cannot import ChatService without a file-level cycle. PilotService
 * resolves it (tenant override first) and ChatService only relays the result.
 *
 * DRAFT COPY: Go2Joy has not supplied wording. A tenant overrides it per language
 * in the console (`pilot_access.notice`); the Vietnamese line follows W8 of the
 * plan and still wants a native reviewer's pass before the pilot.
 */
export const PILOT_NOTICE: LocalizedText = {
  EN: "This assistant isn't available for your hotel yet. Please contact your account manager if you need support.",
  ES: 'Este asistente aún no está disponible para tu hotel. Si necesitas ayuda, contacta con tu gestor de cuenta.',
  KO: '이 상담 서비스는 아직 귀하의 호텔에는 적용되지 않았습니다. 지원이 필요하시면 담당 매니저에게 문의해 주세요.',
  VI: 'Chưa áp dụng cho khách sạn của bạn. Nếu cần hỗ trợ, vui lòng liên hệ quản lý tài khoản của bạn.',
  JA: 'このアシスタントはまだお客様のホテルではご利用いただけません。サポートが必要な場合は、担当マネージャーまでご連絡ください。',
  ZH: '此助手暂未对您的酒店开放。如需支持，请联系您的客户经理。',
};
