import { localized } from '@sharptalk/types';
import type { LocalizedText } from '@sharptalk/types';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { PARTNER_REFUSAL_REASON } from './partner-data.constants';
import type { PartnerRefusalReason } from './partner-data.constants';

/**
 * What the customer reads when a partner lookup is refused or degraded
 * (PLN-261012 SG-31). Backend errors stay English by convention; these are chat
 * turns, so — like ChatService's SYSTEM_MESSAGES — they follow the session
 * language. Wording is the draft for Go2Joy's review, not final copy.
 */
export const PARTNER_NOTICES = {
  // The signed-in role may not read this topic (a receptionist asking for settlement).
  roleDenied: {
    EN: 'This information is only available to manager accounts. Please ask your hotel\'s manager to look it up, or ask to speak with an agent.',
    ES: 'Esta información solo está disponible para cuentas de gerente. Pide a la persona gerente de tu hotel que la consulte, o solicita hablar con un agente.',
    KO: '이 정보는 관리자(Manager) 계정에서만 안내해 드릴 수 있습니다. 호텔 관리자에게 확인을 요청하시거나 상담원 연결을 요청해 주세요.',
    VI: 'Thông tin này chỉ dành cho tài khoản Quản lý. Vui lòng nhờ quản lý của khách sạn tra cứu, hoặc yêu cầu gặp nhân viên để được hỗ trợ.',
    JA: 'この情報はマネージャーアカウントのみご案内できます。ホテルのマネージャーにご確認いただくか、担当者への接続をご依頼ください。',
    ZH: '此信息仅限经理账户查看。请联系酒店经理查询，或请求转接客服人员。',
  },
  // Signed claims missing from the data's point of view: expired or never verified.
  claimsStale: {
    EN: 'To look up your hotel\'s data I need a current sign-in. Please sign in again from Hotel Admin, then ask me once more.',
    ES: 'Para consultar los datos de tu hotel necesito una sesión iniciada vigente. Vuelve a iniciar sesión desde Hotel Admin y pregúntame de nuevo.',
    KO: '호텔 데이터를 조회하려면 유효한 로그인이 필요합니다. Hotel Admin에서 다시 로그인한 뒤 한 번 더 질문해 주세요.',
    VI: 'Để tra cứu dữ liệu của khách sạn, tôi cần phiên đăng nhập còn hiệu lực. Vui lòng đăng nhập lại từ Hotel Admin rồi hỏi lại tôi.',
    JA: 'ホテルのデータを確認するには、有効なログインが必要です。Hotel Adminからもう一度ログインして、改めてご質問ください。',
    ZH: '查询酒店数据需要有效的登录状态。请从 Hotel Admin 重新登录后再提问。',
  },
  // A hotel other than the signed-in one was named, or the parameters were not allowed.
  paramRejected: {
    EN: 'I can only look up data for the hotel you are signed in with. For another hotel, please sign in with that hotel\'s account.',
    ES: 'Solo puedo consultar los datos del hotel con el que iniciaste sesión. Para otro hotel, inicia sesión con la cuenta de ese hotel.',
    KO: '로그인하신 호텔의 데이터만 조회할 수 있습니다. 다른 호텔은 해당 호텔 계정으로 로그인해 주세요.',
    VI: 'Tôi chỉ tra cứu được dữ liệu của khách sạn bạn đang đăng nhập. Với khách sạn khác, vui lòng đăng nhập bằng tài khoản của khách sạn đó.',
    JA: 'ログイン中のホテルのデータのみ確認できます。別のホテルについては、そのホテルのアカウントでログインしてください。',
    ZH: '我只能查询您当前登录的酒店的数据。如需查询其他酒店，请使用该酒店的账户登录。',
  },
  // The data service did not answer (or answered with something unusable): do not guess figures.
  unavailable: {
    EN: 'I cannot reach the hotel data system right now, so I will not guess any figures. We will confirm and an agent will follow up with you here.',
    ES: 'Ahora mismo no puedo acceder al sistema de datos del hotel, así que no voy a adivinar cifras. Lo confirmaremos y un agente te responderá aquí.',
    KO: '지금은 호텔 데이터 시스템에 연결할 수 없어 금액 등 수치를 추측해서 안내하지 않겠습니다. 확인 후 상담원이 이 대화창에서 답변드리겠습니다.',
    VI: 'Hiện tôi chưa tra cứu được dữ liệu khách sạn từ hệ thống nên sẽ không đoán số liệu. Chúng tôi sẽ xác nhận lại và nhân viên sẽ hỗ trợ bạn ngay tại đây.',
    JA: 'ただいまホテルのデータシステムに接続できないため、金額などの数値を推測してお答えすることはいたしません。確認のうえ、担当者がこちらでご連絡します。',
    ZH: '目前无法连接酒店数据系统，因此不会猜测金额等数据。我们确认后，客服人员会在此回复您。',
  },
  // The drafted answer contained a figure the data did not support.
  unverified: {
    EN: 'I could not confirm the figures in my answer against your hotel\'s data, so I will not share them. We will confirm and an agent will follow up with you here.',
    ES: 'No pude confirmar las cifras de mi respuesta con los datos de tu hotel, así que no las compartiré. Lo confirmaremos y un agente te responderá aquí.',
    KO: '답변에 포함된 수치를 호텔 데이터로 확인할 수 없어 안내해 드리지 않겠습니다. 확인 후 상담원이 이 대화창에서 답변드리겠습니다.',
    VI: 'Tôi chưa xác nhận được các số liệu trong câu trả lời với dữ liệu khách sạn của bạn nên sẽ không cung cấp. Chúng tôi sẽ xác nhận lại và nhân viên sẽ hỗ trợ bạn ngay tại đây.',
    JA: '回答に含まれる数値をホテルのデータで確認できなかったため、お伝えできません。確認のうえ、担当者がこちらでご連絡します。',
    ZH: '我无法将回答中的数据与您酒店的数据核对，因此不会提供这些数据。我们确认后，客服人员会在此回复您。',
  },
} satisfies Record<string, LocalizedText>;

export type PartnerNoticeKey = keyof typeof PARTNER_NOTICES;

export interface PartnerNoticePolicy {
  key: PartnerNoticeKey;
  /** Recorded on the message trace as `reason`. */
  reason: PartnerRefusalReason;
  /** Also page a human (the "confirm later + hand-off" path). A mere permission refusal does not. */
  handoff: boolean;
}

/**
 * How an error code (E5100..E5108) reaches the customer. A refusal the customer
 * can fix themselves (wrong role, expired sign-in, another hotel's name) is a
 * notice only — paging CS for it would create work with nothing to do. A
 * failure on our side (upstream down, unusable reply, unverifiable figures) is
 * a notice AND a hand-off, so a person confirms the numbers.
 */
export function partnerNoticePolicy(code: string): PartnerNoticePolicy {
  switch (code) {
    case ERROR_CODE.PARTNER_ROLE_DENIED.code:
      return { key: 'roleDenied', reason: PARTNER_REFUSAL_REASON.ROLE_DENIED, handoff: false };
    case ERROR_CODE.PARTNER_CLAIMS_STALE.code:
      return { key: 'claimsStale', reason: PARTNER_REFUSAL_REASON.CLAIMS_STALE, handoff: false };
    case ERROR_CODE.PARTNER_PARAM_REJECTED.code:
    case ERROR_CODE.PARTNER_TOPIC_UNKNOWN.code:
      return { key: 'paramRejected', reason: PARTNER_REFUSAL_REASON.PARAM_REJECTED, handoff: false };
    case ERROR_CODE.PARTNER_ANSWER_UNVERIFIED.code:
      return { key: 'unverified', reason: PARTNER_REFUSAL_REASON.UNVERIFIED, handoff: true };
    default:
      // E5100 unavailable, E5105 invalid reply, E5106 not configured, E5108 rate limited, anything unknown.
      return { key: 'unavailable', reason: PARTNER_REFUSAL_REASON.UNAVAILABLE, handoff: true };
  }
}

export function partnerNoticeText(key: PartnerNoticeKey, language: string): string {
  return localized(PARTNER_NOTICES[key], language);
}
