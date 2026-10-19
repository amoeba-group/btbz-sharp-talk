/**
 * The greeting the widget shows when a tenant has not written its own.
 *
 * ONE source for two consumers (the same reason the language registry lives in
 * `language.ts`): the widget renders these, and the console shows them as the
 * starting value of the greeting fields — a console that re-declared them would
 * drift from the widget the day either changed, and nothing on screen would say so.
 *
 * Placeholders are single-brace `{shop}` / `{name}`, matching what a tenant
 * types into the console; the widget substitutes both the same way.
 */
export const WIDGET_COPY_DEFAULTS = {
  firstVisit: {
    EN: 'Hi! Welcome to {shop}. How can we help you today? Pick a topic below or type your question.',
    ES: '¡Hola! Bienvenido a {shop}. ¿En qué podemos ayudarte hoy? Elige un tema abajo o escribe tu pregunta.',
    KO: '안녕하세요! {shop}에 오신 것을 환영합니다. 무엇을 도와드릴까요? 아래에서 주제를 선택하거나 궁금한 점을 입력해 주세요.',
    VI: 'Xin chào! Chào mừng bạn đến với {shop}. Chúng tôi có thể giúp gì cho bạn? Hãy chọn một chủ đề bên dưới hoặc nhập câu hỏi của bạn.',
    JA: 'こんにちは！{shop}へようこそ。本日はどのようなご用件でしょうか？下記からトピックを選ぶか、ご質問を入力してください。',
    ZH: '您好！欢迎来到 {shop}。今天有什么可以帮您？请在下方选择主题或输入您的问题。',
  },
  loginGreeting: {
    EN: 'Hi {name}! Welcome back to {shop}. How can we help you today? Pick a topic below or type your question.',
    ES: '¡Hola {name}! Bienvenido de nuevo a {shop}. ¿En qué podemos ayudarte hoy? Elige un tema abajo o escribe tu pregunta.',
    KO: '{name}님 반갑습니다. 무엇을 도와드릴까요? 아래에서 주제를 선택하거나 궁금한 점을 입력해 주세요.',
    VI: 'Xin chào {name}! Chào mừng bạn quay lại {shop}. Chúng tôi có thể giúp gì cho bạn? Hãy chọn một chủ đề bên dưới hoặc nhập câu hỏi của bạn.',
    JA: '{name}さん、おかえりなさい。本日はどのようなご用件でしょうか？下記からトピックを選ぶか、ご質問を入力してください。',
    ZH: '{name}，欢迎回到 {shop}。今天有什么可以帮您？请在下方选择主题或输入您的问题。',
  },
  /** Greeting pill beside the closed launcher (PLN-261019 P2); shown only when the theme turns it on. */
  launcherTeaser: {
    EN: 'Hi! {shop} is here to help.',
    ES: '¡Hola! {shop} está aquí para ayudarte.',
    KO: '안녕하세요! {shop}이(가) 도와드릴게요.',
    VI: 'Xin chào! {shop} sẵn sàng hỗ trợ bạn!',
    JA: 'こんにちは！{shop}がサポートします。',
    ZH: '您好！{shop} 随时为您服务。',
  },
} as const;
