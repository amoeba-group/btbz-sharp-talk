import type { SessionLanguage } from '@sharptalk/types';

/**
 * The shipped scenario scripts and the map from a widget button to the script
 * it runs (PLN-260903 S1-1).
 *
 * A standalone module on purpose: exporting these from scenario.service.ts
 * would put a constant behind a provider import and the console, the config
 * service and the chat service all need them — the circular-import boot crash
 * that tsc cannot catch is a lesson this repo has already paid for
 * (livechat-pin-message-actions).
 */

export type Lang = SessionLanguage;
/**
 * Every script must carry every registered language: unlike tenant overrides,
 * this is the shipped copy, so a `Record` (not a `Partial`) makes a language
 * added to the registry a compile error here rather than a silent English turn.
 */

export interface ScenarioScript {
  /** Echoed into the thread as the user's utterance for the pressed button. */
  utterance: Record<Lang, string>;
  reply: Record<Lang, string>;
  /** Follow-up quick replies; ids are scenario actions or control actions. */
  followUps: Array<{ id: string; label: Record<Lang, string> }>;
}

/** The "Talk to an agent" chip — exported so a system reply (PLN-261012 SG-10) can offer the same one. */
export const FOLLOW_UP_AGENT = {
  id: 'agent_connect',
  label: {
    EN: 'Talk to an agent',
    ES: 'Hablar con un agente',
    KO: '상담원 연결',
    VI: 'Gặp nhân viên hỗ trợ',
    JA: '担当者と話す',
    ZH: '联系人工客服',
  },
};
const FOLLOW_UP_MY_ORDERS = {
  id: 'my_orders',
  label: {
    EN: 'View my orders',
    ES: 'Ver mis pedidos',
    KO: '내 주문 보기',
    VI: 'Xem đơn hàng của tôi',
    JA: '注文を見る',
    ZH: '查看我的订单',
  },
};

/**
 * Deterministic scenario scripts (FR-003 / FR-S1, PLAN-Scenario-Handoff-Alert).
 * Copy is kept consistent with the seeded CS policy KB documents
 * (KB-US-Cosmetics-CS-Policy-Reference-20260707): 30-day window, gently used,
 * cancel-before-preparing, original-payment refunds.
 */
export const SCENARIOS: Record<string, ScenarioScript> = {
  cancel_refund: {
    utterance: {
      EN: 'I need help with a cancellation, refund, or return.',
      ES: 'Necesito ayuda con una cancelación, reembolso o devolución.',
      KO: '취소/환불/반품 관련 도움이 필요해요.',
      VI: 'Tôi cần hỗ trợ về hủy đơn, hoàn tiền hoặc trả hàng.',
      JA: 'キャンセル・返金・返品について相談したいです。',
      ZH: '我需要关于取消、退款或退货的帮助。',
    },
    reply: {
      EN: 'I can help with cancellations, refunds, and returns. What would you like to do?',
      ES: 'Puedo ayudarte con cancelaciones, reembolsos y devoluciones. ¿Qué te gustaría hacer?',
      KO: '취소, 환불, 반품을 도와드릴게요. 어떤 것을 도와드릴까요?',
      VI: 'Tôi có thể hỗ trợ bạn về hủy đơn, hoàn tiền và trả hàng. Bạn muốn làm gì?',
      JA: 'キャンセル・返金・返品についてお手伝いできます。どちらをご希望ですか。',
      ZH: '我可以帮您处理取消、退款和退货。您想办理哪一项？',
    },
    followUps: [
      {
        id: 'cancel_order',
        label: {
          EN: 'Cancel an order',
          ES: 'Cancelar un pedido',
          KO: '주문 취소',
          VI: 'Hủy đơn hàng',
          JA: '注文をキャンセル',
          ZH: '取消订单',
        },
      },
      {
        id: 'refund_policy',
        label: {
          EN: 'Refund policy & timeline',
          ES: 'Política y plazos de reembolso',
          KO: '환불 정책·소요기간',
          VI: 'Chính sách và thời gian hoàn tiền',
          JA: '返金ポリシー・所要期間',
          ZH: '退款政策与时间',
        },
      },
      {
        id: 'return_exchange',
        label: {
          EN: 'Return / exchange an item',
          ES: 'Devolver / cambiar un artículo',
          KO: '반품·교환',
          VI: 'Trả hoặc đổi sản phẩm',
          JA: '返品・交換',
          ZH: '退货 / 换货',
        },
      },
      FOLLOW_UP_AGENT,
    ],
  },
  cancel_order: {
    utterance: {
      EN: 'I would like to cancel my order.',
      ES: 'Quiero cancelar mi pedido.',
      KO: '주문을 취소하고 싶어요.',
      VI: 'Tôi muốn hủy đơn hàng của mình.',
      JA: '注文をキャンセルしたいです。',
      ZH: '我想取消我的订单。',
    },
    reply: {
      EN: 'Orders can be canceled free of charge before they enter preparing status — usually within about 1 hour of placing the order. Go to Orders, open the order, and tap Cancel. Once an order has shipped it can no longer be canceled; please request a return after delivery instead. Canceled orders are refunded in full to your original payment method.',
      ES: 'Los pedidos se pueden cancelar sin cargo antes de que entren en preparación, normalmente dentro de la primera hora. Ve a Pedidos, abre el pedido y toca Cancelar. Una vez enviado, ya no se puede cancelar; solicita una devolución tras la entrega. Los pedidos cancelados se reembolsan por completo a tu método de pago original.',
      KO: '주문은 상품 준비 단계 진입 전(보통 주문 후 1시간 이내)까지 무료로 취소할 수 있어요. 주문 탭에서 해당 주문을 열어 취소를 눌러 주세요. 이미 출고된 주문은 취소가 불가하며, 수령 후 반품으로 진행해 주세요. 취소된 주문은 원결제 수단으로 전액 환불됩니다.',
      VI: 'Đơn hàng có thể hủy miễn phí trước khi chuyển sang trạng thái chuẩn bị hàng — thường trong khoảng 1 giờ sau khi đặt. Bạn vào mục Đơn hàng, mở đơn cần hủy và nhấn Hủy. Đơn đã gửi đi thì không thể hủy; vui lòng yêu cầu trả hàng sau khi nhận. Đơn đã hủy sẽ được hoàn toàn bộ về phương thức thanh toán ban đầu.',
      JA: 'ご注文は準備中ステータスになる前（通常はご注文から約1時間以内）であれば無料でキャンセルできます。「注文」タブから該当のご注文を開き、キャンセルをタップしてください。出荷後のキャンセルはできませんので、お受け取り後に返品をお申し込みください。キャンセルされたご注文は、元のお支払い方法へ全額返金いたします。',
      ZH: '订单在进入备货状态之前（通常为下单后约 1 小时内）可免费取消。请前往「订单」页面，打开该订单并点击取消。订单一旦发货便无法取消，请在收货后申请退货。已取消的订单将全额退回至您的原支付方式。',
    },
    followUps: [
      FOLLOW_UP_MY_ORDERS,
      {
        id: 'refund_policy',
        label: {
          EN: 'When will I get my refund?',
          ES: '¿Cuándo recibiré mi reembolso?',
          KO: '환불은 언제 되나요?',
          VI: 'Khi nào tôi nhận được tiền hoàn?',
          JA: '返金はいつになりますか',
          ZH: '退款什么时候到账？',
        },
      },
      FOLLOW_UP_AGENT,
    ],
  },
  refund_policy: {
    utterance: {
      EN: 'How do refunds work?',
      ES: '¿Cómo funcionan los reembolsos?',
      KO: '환불은 어떻게 진행되나요?',
      VI: 'Việc hoàn tiền diễn ra như thế nào?',
      JA: '返金はどのように行われますか。',
      ZH: '退款是如何处理的？',
    },
    reply: {
      EN: 'Refunds go back to your original payment method — card refunds are typically processed within 5–10 business days after we receive and inspect the return; mail-in returns can take up to 30 days end to end. Gift returns are issued as store credit. Original shipping fees are refunded only when the return is due to our error.',
      ES: 'Los reembolsos se emiten a tu método de pago original: los reembolsos a tarjeta suelen procesarse en 5–10 días hábiles tras recibir e inspeccionar la devolución; las devoluciones por correo pueden tardar hasta 30 días en total. Los regalos se reembolsan como crédito de tienda. Los gastos de envío originales solo se reembolsan si la devolución se debe a un error nuestro.',
      KO: '환불은 원결제 수단으로 진행돼요. 카드 환불은 반품 상품 수령·검수 후 보통 5–10영업일 내 처리되며, 우편 반품은 전체 최대 30일까지 걸릴 수 있어요. 선물 반품은 스토어 크레딧으로 지급됩니다. 최초 배송비는 판매자 과실인 경우에만 환불돼요.',
      VI: 'Tiền hoàn được trả về phương thức thanh toán ban đầu — hoàn tiền qua thẻ thường được xử lý trong 5–10 ngày làm việc sau khi chúng tôi nhận và kiểm tra hàng trả lại; trả hàng qua bưu điện có thể mất tới 30 ngày cho toàn bộ quy trình. Hàng tặng được hoàn dưới dạng tín dụng mua sắm tại cửa hàng. Phí vận chuyển ban đầu chỉ được hoàn khi việc trả hàng là do lỗi của chúng tôi.',
      JA: '返金は元のお支払い方法へお戻しします。カードでの返金は、返品商品の受領・検品後、通常5〜10営業日以内に処理されます。郵送での返品は全体で最大30日ほどかかる場合があります。ギフトの返品はストアクレジットでのご返金となります。当初の送料は、当社の不備による返品の場合のみ返金いたします。',
      ZH: '退款将退回您的原支付方式——收到并检验退货商品后，银行卡退款通常在 5–10 个工作日内处理；邮寄退货整个流程最长可能需要 30 天。礼品退货将以店铺购物金形式发放。原始运费仅在因我方失误导致退货时才予以退还。',
    },
    followUps: [
      {
        id: 'return_exchange',
        label: {
          EN: 'Start a return',
          ES: 'Iniciar una devolución',
          KO: '반품 시작하기',
          VI: 'Bắt đầu trả hàng',
          JA: '返品を始める',
          ZH: '开始退货',
        },
      },
      FOLLOW_UP_AGENT,
    ],
  },
  return_exchange: {
    utterance: {
      EN: 'I would like to return or exchange an item.',
      ES: 'Quiero devolver o cambiar un artículo.',
      KO: '반품 또는 교환을 하고 싶어요.',
      VI: 'Tôi muốn trả lại hoặc đổi một sản phẩm.',
      JA: '商品を返品または交換したいです。',
      ZH: '我想退货或换货。',
    },
    reply: {
      EN: 'Returns and exchanges are accepted within 30 days of purchase for items in new or gently used condition, with proof of purchase. Return shipping is free with our prepaid label. Gift cards, final-sale, and certain hygiene-sensitive items are not returnable. For exchanges, the fastest option is to return the item and place a new order. If your item arrived damaged, defective, or incorrect, contact us within 7 days with a photo and we will replace it free of charge.',
      ES: 'Aceptamos devoluciones y cambios dentro de los 30 días posteriores a la compra para artículos nuevos o poco usados, con comprobante de compra. El envío de devolución es gratis con nuestra etiqueta prepagada. Las tarjetas de regalo, artículos de venta final y ciertos productos de higiene no son retornables. Para cambios, lo más rápido es devolver el artículo y hacer un nuevo pedido. Si tu artículo llegó dañado, defectuoso o incorrecto, contáctanos en un plazo de 7 días con una foto y lo reemplazaremos sin costo.',
      KO: '반품·교환은 구매 후 30일 이내, 새 상품 또는 가볍게 사용(gently used)한 상태이고 구매 증빙이 있으면 가능해요. 프리페이드 라벨 사용 시 반품 배송비는 무료입니다. 기프트카드, 파이널 세일, 일부 위생 민감 품목은 반품이 불가해요. 교환은 반품 후 재주문이 가장 빠릅니다. 파손·불량·오배송 상품은 수령 후 7일 이내 사진과 함께 문의해 주시면 무상 교체해 드려요.',
      VI: 'Chúng tôi nhận trả hàng và đổi hàng trong vòng 30 ngày kể từ khi mua, với sản phẩm còn mới hoặc đã dùng nhẹ và có chứng từ mua hàng. Phí gửi trả miễn phí khi dùng nhãn vận chuyển trả trước của chúng tôi. Thẻ quà tặng, hàng sale cuối cùng (final sale) và một số mặt hàng nhạy cảm về vệ sinh không được trả lại. Với việc đổi hàng, cách nhanh nhất là trả sản phẩm rồi đặt đơn mới. Nếu sản phẩm bị hư hỏng, lỗi hoặc giao sai, vui lòng liên hệ trong vòng 7 ngày kèm ảnh, chúng tôi sẽ đổi miễn phí cho bạn.',
      JA: '返品・交換は、ご購入から30日以内で、新品または軽度の使用状態かつ購入証明がある商品に限りお受けします。当社の元払いラベルをご利用の場合、返送料は無料です。ギフトカード、ファイナルセール品、一部の衛生商品は返品いただけません。交換をご希望の場合は、返品後に新しくご注文いただくのが最も早い方法です。破損・不良・誤配送の商品は、お受け取りから7日以内にお写真を添えてご連絡ください。無償で交換いたします。',
      ZH: '自购买之日起 30 天内，商品处于全新或轻微使用状态并有购买凭证的，可以退货或换货。使用我们的预付运单退货免运费。礼品卡、最终特卖商品以及部分卫生敏感商品不支持退货。如需换货，最快的方式是先退货再重新下单。若商品在收到时已损坏、有瑕疵或发错，请在 7 天内附照片联系我们，我们将免费为您更换。',
    },
    followUps: [
      FOLLOW_UP_MY_ORDERS,
      {
        id: 'refund_policy',
        label: {
          EN: 'Refund timeline',
          ES: 'Plazos de reembolso',
          KO: '환불 소요기간',
          VI: 'Thời gian hoàn tiền',
          JA: '返金の所要期間',
          ZH: '退款时间',
        },
      },
      FOLLOW_UP_AGENT,
    ],
  },
  shipping_policy: {
    utterance: {
      EN: 'How long does shipping take?',
      ES: '¿Cuánto tarda el envío?',
      KO: '배송은 얼마나 걸리나요?',
      VI: 'Giao hàng mất bao lâu?',
      JA: '配送はどのくらいかかりますか。',
      ZH: '配送需要多长时间？',
    },
    reply: {
      EN: 'Orders ship within 1–2 business days, and standard US delivery takes 3–5 business days. Once your order ships you can track it in real time from the Orders tab. If your package has not arrived within the expected window, let me know and I can check the tracking status with you.',
      ES: 'Los pedidos se envían en 1–2 días hábiles y la entrega estándar en EE. UU. tarda 3–5 días hábiles. Cuando tu pedido se envíe, podrás rastrearlo en tiempo real desde la pestaña Pedidos. Si tu paquete no llega en el plazo previsto, avísame y revisamos el estado del envío juntos.',
      KO: '주문은 1–2영업일 내 출고되며, 미국 내 표준 배송은 3–5영업일이 소요돼요. 출고 후에는 주문 탭에서 실시간으로 배송을 추적할 수 있어요. 예상 기간이 지나도 도착하지 않았다면 말씀해 주세요. 배송 상태를 함께 확인해 드릴게요.',
      VI: 'Đơn hàng được gửi đi trong 1–2 ngày làm việc, và giao hàng tiêu chuẩn trong nước Mỹ mất 3–5 ngày làm việc. Sau khi đơn được gửi, bạn có thể theo dõi theo thời gian thực trong mục Đơn hàng. Nếu quá thời gian dự kiến mà kiện hàng chưa đến, hãy cho tôi biết để cùng kiểm tra tình trạng vận chuyển.',
      JA: 'ご注文は1〜2営業日以内に出荷し、米国内の通常配送は3〜5営業日でお届けします。出荷後は「注文」タブからリアルタイムで配送状況をご確認いただけます。予定期間を過ぎてもお届けがない場合はお知らせください。配送状況を一緒に確認いたします。',
      ZH: '订单将在 1–2 个工作日内发货，美国境内标准配送需 3–5 个工作日。发货后，您可以在「订单」页面实时追踪物流。如果超过预计时间仍未收到包裹，请告诉我，我可以帮您查询配送状态。',
    },
    followUps: [FOLLOW_UP_MY_ORDERS, FOLLOW_UP_AGENT],
  },
  order_help: {
    utterance: {
      EN: 'I have a question about my order.',
      ES: 'Tengo una pregunta sobre mi pedido.',
      KO: '주문 관련 문의가 있어요.',
      VI: 'Tôi có câu hỏi về đơn hàng của mình.',
      JA: '注文について質問があります。',
      ZH: '我有关于订单的问题。',
    },
    reply: {
      EN: 'You can check order status, tracking, and history in the Orders tab — sign in or use guest order lookup with your order number and email. I can also answer questions about changing an address, canceling, or returning an order. What do you need help with?',
      ES: 'Puedes ver el estado, el rastreo y el historial en la pestaña Pedidos: inicia sesión o usa la búsqueda de pedido como invitado con tu número de pedido y correo. También puedo responder dudas sobre cambiar la dirección, cancelar o devolver un pedido. ¿En qué te ayudo?',
      KO: '주문 상태·배송 추적·주문 내역은 주문 탭에서 확인할 수 있어요. 로그인하거나 주문번호+이메일로 비회원 조회도 가능합니다. 주소 변경, 취소, 반품 관련 질문도 도와드릴 수 있어요. 무엇을 도와드릴까요?',
      VI: 'Bạn có thể xem trạng thái đơn hàng, theo dõi vận chuyển và lịch sử mua hàng trong mục Đơn hàng — hãy đăng nhập hoặc tra cứu dành cho khách bằng mã đơn hàng và email. Tôi cũng có thể giải đáp về việc đổi địa chỉ, hủy đơn hay trả hàng. Bạn cần hỗ trợ điều gì?',
      JA: 'ご注文状況・配送追跡・注文履歴は「注文」タブでご確認いただけます。ログインいただくか、注文番号とメールアドレスでゲスト注文照会をご利用ください。住所変更・キャンセル・返品に関するご質問にもお答えできます。どのようなご用件でしょうか。',
      ZH: '您可以在「订单」页面查看订单状态、物流追踪和历史订单——请登录，或使用订单号和邮箱进行访客订单查询。关于修改地址、取消订单或退货的问题我也可以解答。请问需要什么帮助？',
    },
    followUps: [
      FOLLOW_UP_MY_ORDERS,
      {
        id: 'cancel_order',
        label: {
          EN: 'Cancel an order',
          ES: 'Cancelar un pedido',
          KO: '주문 취소',
          VI: 'Hủy đơn hàng',
          JA: '注文をキャンセル',
          ZH: '取消订单',
        },
      },
      {
        id: 'shipping_policy',
        label: {
          EN: 'Shipping times',
          ES: 'Tiempos de envío',
          KO: '배송 기간',
          VI: 'Thời gian giao hàng',
          JA: '配送期間',
          ZH: '配送时间',
        },
      },
      FOLLOW_UP_AGENT,
    ],
  },
  product_help_general: {
    utterance: {
      EN: 'I have a question about a product.',
      ES: 'Tengo una pregunta sobre un producto.',
      KO: '상품 관련 문의가 있어요.',
      VI: 'Tôi có câu hỏi về sản phẩm.',
      JA: '商品について質問があります。',
      ZH: '我有关于商品的问题。',
    },
    reply: {
      EN: 'Happy to help with products! Usage instructions and full ingredient lists are on each product detail page, and you can ask me anything here — for example "Is the Repair Serum okay for sensitive skin?" or "How do I use the Vital Cream?" If a product is out of stock, I can set up a restock alert for you.',
      ES: '¡Encantada de ayudarte con los productos! Las instrucciones de uso y la lista completa de ingredientes están en la página de cada producto, y aquí puedes preguntarme lo que quieras, por ejemplo: "¿El Repair Serum sirve para piel sensible?". Si un producto está agotado, puedo crear una alerta de reposición.',
      KO: '상품 관련해 도와드릴게요! 사용법과 전체 성분은 각 상품 상세 페이지에서 확인할 수 있고, 여기서 바로 질문하셔도 돼요. 예: "리페어 세럼은 민감성 피부에도 괜찮나요?" 품절 상품은 재입고 알림을 설정해 드릴 수 있어요.',
      VI: 'Rất sẵn lòng hỗ trợ bạn về sản phẩm! Hướng dẫn sử dụng và danh sách thành phần đầy đủ có trên trang chi tiết của từng sản phẩm, và bạn cũng có thể hỏi tôi trực tiếp tại đây — ví dụ "Repair Serum có dùng được cho da nhạy cảm không?". Nếu sản phẩm hết hàng, tôi có thể tạo thông báo khi có hàng trở lại cho bạn.',
      JA: '商品についてよろこんでお手伝いします。使い方や全成分は各商品の詳細ページに掲載していますが、ここで直接ご質問いただくこともできます。例：「リペアセラムは敏感肌でも使えますか」。品切れの商品については、再入荷のお知らせを設定いたします。',
      ZH: '很高兴为您解答商品相关问题！使用方法和完整成分表都在各商品详情页，您也可以直接在这里问我，例如「修护精华适合敏感肌吗？」。如果商品缺货，我可以为您设置到货通知。',
    },
    followUps: [
      {
        id: 'return_exchange',
        label: {
          EN: 'Return / exchange',
          ES: 'Devolución / cambio',
          KO: '반품·교환',
          VI: 'Trả / đổi hàng',
          JA: '返品・交換',
          ZH: '退货 / 换货',
        },
      },
      FOLLOW_UP_AGENT,
    ],
  },
};


/**
 * Widget button action → the script it actually runs.
 *
 * This map is why the console's "Delivery status" reply edits never reached a
 * shopper: the console saved the override under `delivery_status` while the
 * runtime asked for `shipping_policy`. Both sides now read this one table
 * instead of each knowing half of it.
 */
export const SCRIPT_BY_BUTTON_ACTION: Record<string, string> = {
  delivery_status: 'shipping_policy',
  cancel_refund: 'cancel_refund',
};

/** The reverse lookup, for reading overrides a console saved under the old key. */
export const BUTTON_ACTION_BY_SCRIPT: Record<string, string> = Object.fromEntries(
  Object.entries(SCRIPT_BY_BUTTON_ACTION).map(([button, script]) => [script, button]),
);

/**
 * How a shopper reaches each script: straight from a menu button, or only as a
 * follow-up chip inside another script. The console lists both — a script no
 * one can see is a script no one can fix.
 */
export const SCRIPT_REACH: Record<string, { via: 'button' | 'follow_up'; buttonAction?: string }> =
  Object.fromEntries(
    Object.keys(SCENARIOS).map((script) => {
      const buttonAction = BUTTON_ACTION_BY_SCRIPT[script];
      return [script, buttonAction ? { via: 'button', buttonAction } : { via: 'follow_up' }];
    }),
  );

/** Normalize a caller's action to the script key the runtime stores under. */
export function resolveScriptAction(action: string): string {
  return SCRIPT_BY_BUTTON_ACTION[action] ?? action;
}

/**
 * Chip ids the widget handles itself rather than as a script.
 * `end_chat` is styled separately in the thread; the other two open a flow.
 */
export const CONTROL_FOLLOW_UP_IDS = new Set(['agent_connect', 'my_orders', 'end_chat']);

/**
 * A follow-up chip only does something if its id names a script or a control.
 * A free-text id (a tenant once saved "주문확인") renders a chip that answers a
 * shopper's tap with "sending failed" — so ids are checked on write, and
 * filtered again on read for what is already stored.
 */
export function isValidFollowUpId(id: string): boolean {
  return CONTROL_FOLLOW_UP_IDS.has(id) || Object.prototype.hasOwnProperty.call(SCENARIOS, id);
}
