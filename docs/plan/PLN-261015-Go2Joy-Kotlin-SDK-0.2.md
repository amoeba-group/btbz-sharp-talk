# PLN-261015-Go2Joy-Kotlin-SDK-0.2

> **Kế hoạch.** SDK Android `sdk/android` 0.2.0 + widget + API + console để app Go2Joy (Kotlin 2.2.0) nhúng chat
> theo chuẩn trong `REQ-261015-Go2Joy-Kotlin-App-Widget` v1.1, kèm lộ trình triển khai hai bên G0 đến G6.
> **Phiên bản.** 1.1 (2026-10-15). **Trạng thái.** DỰ THẢO, chờ duyệt. Không triển khai trước khi duyệt.
> **Nhánh.** `feature/go2joy-kotlin-app-widget`, rebase trên `main` `e0610355`.
> **Artifact mô phỏng.** `PLN-261015-Go2Joy-Kotlin-SDK-0.2.mockup.html` và `.mockup.png` cùng thư mục: 8 màn hình
> dựng theo widget thật (ảnh `img/PLN-261015-SharpTalk-for-Go2Joy/01-widget-home.jpg`, `02-widget-answer.jpg`);
> mã đặt phòng, số liệu, tên người là giả định.

## 0. Bức tranh triển khai G0 đến G6

| Giai đoạn | Ai | Việc | Thời gian | Kết quả |
|---|---|---|---|---|
| **G0 Chốt với team** | Cả hai | Amoeba chốt hợp đồng identify (Q1); Go2Joy trả lời 6 câu về app; chọn môi trường pilot (staging hoặc production Hàn Quốc trước, self-hosted sau M3); duyệt PLN này | 2 đến 3 ngày | Quyết định ghi vào REQ §7 |
| **G1 Admin cấu hình console** | Admin Go2Joy | Nhúng & SDK phát secret; Nguồn đồng ý = điều khoản host; agent `hotel-admin` lời chào, 4 nút, tri thức; theme màu và logo, chỉ tab chat, menu card; Kết nối nhân viên; kiểm bằng web và trình mô phỏng app | 1 ngày | Những gì app sẽ hiện |
| **G2 Backend ký** | Dev backend Go2Joy | Endpoint trả gói danh tính ký HMAC bằng secret trong env; dùng chung web và app; tự kiểm với `/public/embed/identify` trên staging | 0,5 đến 1 ngày | `authenticated = true`, badge khách sạn trên console |
| **G3 SDK 0.2.0** | Amoeba | S1 đến S6 dưới đây, song song G1 và G2; phát hành AAR + guide + release notes | 6 ngày | `shoptalk-android-0.2.0.aar` |
| **G4 Cài vào app** | Dev app Go2Joy | Gradle, màn chat, `identityProvider`, listener, entry "Hỗ trợ Go2Joy", `setContext` ở màn đặt phòng, `logout()`; build internal testing | 1 đến 2 ngày | Build nội bộ |
| **G5 UAT trên máy thật** | Cả hai | 14 hạng mục §7 trên staging với tài khoản Hotel Admin thật; lỗi widget hoặc SDK do Amoeba, lỗi app hoặc endpoint do Go2Joy | 2 đến 3 ngày | Biên bản TCR |
| **G6 Phát hành và vận hành** | Cả hai | Play rollout từng phần; admin bật agent, pilot; theo dõi thống kê, chuyển nhân viên, `/metrics`, cảnh báo. Sau đó: nội dung sửa trên console có hiệu lực ngay; widget deploy server app nhận ngay; SDK hoặc địa chỉ widget đổi mới cần phát hành app | Theo lịch app | Pilot chạy |

Khoảng 2 tuần từ G0 tới pilot trên máy thật. Khớp PLN-261015: M3 máy chủ Go2Joy 26/10, giai đoạn 1 kết thúc 31/10;
pilot app chạy trên staging hoặc production Hàn Quốc trước, đổi `widgetUrl` sang self-hosted khi M3 xong.

## 1. Quyết định giả định

| ID | Giả định | Nguồn |
|---|---|---|
| A1 | SDK chuyển tiếp **gói danh tính ký sẵn** nguyên văn; không phụ thuộc hợp đồng `attributes` hay `claims` | REQ §3.1, Q1 |
| A2 | Giai đoạn 1 Go2Joy ký theo `attributes` (đã chạy trên production); SDK và guide ghi "gói danh tính", tham chiếu guide embed §3.4 | REQ Q1 |
| A3 | Ký lại qua `identityProvider` mỗi khi cần; bỏ cache JSON identify | REQ G2 |
| A4 | Header mặc định WIDGET (chạy ngay hôm nay); NATIVE là tùy chọn | REQ Q2 |
| A5 | Camera bật qua intent chụp, FileProvider trong SDK | REQ Q3 |
| A6 | Ép sáng WebView; không làm dark mode widget | REQ Q4 |
| A7 | Ngữ cảnh lưu dạng dòng SYSTEM, **không SQL** | REQ FR-M15 |
| A8 | AAR file + tùy chọn source module; Compose là module riêng | REQ Q8, Q9 |
| A9 | Preview App trong console (FR-C01) nằm trong 0.2; tab Ứng dụng di động (FR-C02 đến C05) là S9 tùy chọn sau pilot | REQ Q6 |
| A10 | Push, badge ngoài màn chat, dark mode widget, iOS: ngoài phạm vi | REQ Q5, Q7, Q10 |
| A11 | `widgetUrl`, `shop`, mã agent đặt trong remote config của app | REQ Q11 |

## 2. Phạm vi

**Trong.** SDK 0.2.0 (`:shoptalk`, `:shoptalk-compose`, `:sample`), widget (tham số `chrome`, lệnh `settings`,
`end`, `back`, `context`), API (`context` trong message), console (nút Web | App trong card Thiết kế widget), guide
mobile vi + ko, TCR trên máy thật, release notes. Tùy chọn S9: tab Ứng dụng di động.

**Ngoài.** FCM, badge ngoài màn chat, dark mode widget, iOS, hợp nhất hai hợp đồng identify (nhóm backend, REQ Q1).

## 3. Thiết kế

### 3.1 API SDK 0.2.0

```kotlin
data class ShopTalkConfig(
    val widgetUrl: String,                      // staging: https://shoptalk.amoeba.site/widget/ · self-hosted đề xuất (M3, DNS chưa có): sharptalk.go2joy.vn
    val shop: String? = null,                   // "https://www.go2joy.vn" — khớp tenants.shop_domain của tenant go2joy; không phải domain app
    val agent: String? = null,                  // "hotel-admin" — agent giai đoạn 1 theo PLN-261015
    val locale: String? = null,                 // "vi"
    val accessKey: String? = null,              // ?access= khi tenant bật widget_access
    val header: ShopTalkHeader = ShopTalkHeader.WIDGET,   // WIDGET | NATIVE  → ?chrome=native
    val startTab: ShopTalkTab? = null,
    val attachments: ShopTalkAttachments = ShopTalkAttachments(camera = true, multiple = true),
    val errorHotline: String? = null,           // hiện trên màn lỗi, tùy chọn
    val allowInsecureUrl: Boolean = false,      // chỉ debug: http://10.0.2.2:5174
)

/** Gói danh tính do backend Go2Joy ký. SDK không đọc nội dung, chỉ chuyển tiếp. */
class ShopTalkIdentity private constructor(internal val user: JSONObject) {
    companion object {
        /** `{ "userId": "...", "hash": "...", "attributes": {...} }` hoặc `{ ..., "claims": {...} }` */
        fun fromJson(raw: String): ShopTalkIdentity
        fun of(userId: String, hash: String, attributes: Map<String, String>? = null,
               claims: Map<String, Any>? = null, name: String? = null,
               email: String? = null, phone: String? = null): ShopTalkIdentity
    }
}

fun interface ShopTalkIdentityProvider { suspend fun identity(): ShopTalkIdentity? }   // null = khách

data class ShopTalkContext(val screen: String, val ref: String? = null,
                           val label: String? = null, val prefill: String? = null)

sealed interface ShopTalkError {
    data class LoadFailed(val code: Int, val description: String) : ShopTalkError
    data object LoadTimeout : ShopTalkError
    data class IdentityProviderFailed(val cause: Throwable) : ShopTalkError
    data object BridgeMalformed : ShopTalkError
}

interface ShopTalkListener {
    fun onReady() {}
    fun onCloseRequest()                                  // bắt buộc: đóng màn
    fun onIdentified(ok: Boolean) {}
    fun onIdentityExpired() {}                            // SDK đã tự ký lại; chỉ báo
    fun onOpenUrl(url: Uri): Boolean = false              // true = app tự xử lý
    fun onUnread(count: Int) {}
    fun onError(error: ShopTalkError) {}
}

class ShopTalkChatFragment : Fragment() {
    var listener: ShopTalkListener?
    var identityProvider: ShopTalkIdentityProvider?       // gọi khi ready, reload, identity-expired
    fun identify(identity: ShopTalkIdentity)              // một lần, vẫn hỗ trợ
    fun open(tab: ShopTalkTab); fun setLocale(locale: String); fun logout()
    fun setContext(context: ShopTalkContext?)             // null = bỏ chip
    fun openSettings(); fun endConversation(); fun reload()
    companion object { fun newInstance(config: ShopTalkConfig): ShopTalkChatFragment }
}

// :shoptalk-compose
@Composable fun ShopTalkChat(config: ShopTalkConfig, identityProvider: ShopTalkIdentityProvider?,
                             listener: ShopTalkListener, modifier: Modifier = Modifier)
```

Trình tự khi ready: SDK gọi `identityProvider.identity()`; khác null thì gửi `ivy:identify`; null thì khách; lỗi thì
`onError(IdentityProviderFailed)` và khách. `ivy:event identity-expired` kích hoạt lại cùng trình tự.
`identify(identity)` thủ công chỉ gửi một lần, không gửi lại khi reload.

Phía app Go2Joy, toàn bộ phần "dán" là:

```kotlin
implementation(files("libs/shoptalk-android-0.2.0.aar"))

val chat = ShopTalkChatFragment.newInstance(ShopTalkConfig(widgetUrl = cfg.widgetUrl, shop = cfg.shop, agent = cfg.agent))
chat.identityProvider = ShopTalkIdentityProvider { api.sharpTalkIdentity() }
chat.listener = object : ShopTalkListener { override fun onCloseRequest() = finish() }
supportFragmentManager.commit { replace(R.id.container, chat) }
```

### 3.2 Giao thức bridge

| Hướng | Thông điệp | Trạng thái |
|---|---|---|
| App → widget | `ivy:identify {user}` với `user` nguyên văn từ backend | sửa: pass-through |
| App → widget | `ivy:command` `open`, `close`, `toggle`, `locale`, `logout` | giữ |
| App → widget | `ivy:command` `settings`, `end`, `back`, `context {screen, ref, label, prefill}` | **mới** |
| Widget → app | `ivy:ready`, `ivy:close-request`, `ivy:event identified`, `ivy:open-url`, `ivy:unread` | giữ, SDK bắt đủ |
| Widget → app | `ivy:event identity-expired` (nhánh PR; `main` chưa phát) | SDK bắt, bỏ qua nếu không tới |
| Widget → app | `ivy:event back {handled}` | **mới** |

URL: giữ `embed=1&mode=app&shop&agent&access`; thêm `chrome=native`; nhận `surface=app` và bỏ qua (S9 dùng).

### 3.3 Widget

| Việc | Tệp | Ghi chú |
|---|---|---|
| `chrome=native` ẩn `<header>` của `WidgetPanel`; dòng thông báo AI giữ | `lib/host-bridge.ts`, `components/widget/WidgetPanel.tsx` | |
| Lệnh `settings`, `end`, `back`; `showSettings` nâng lên store | `hooks/useEmbedCommands.ts`, `store/widgetStore.ts` | `end` gọi đúng hành động nút "Kết thúc" |
| Lệnh `context`: `hostContext` trong store; chip trên composer, nút ✕; `prefill` điền nếu ô trống; gửi `context` cùng tin kế tiếp | `components/chat/ChatTab.tsx`, `hooks/useChat.ts`, `services/chatService` | i18n 6 ngôn ngữ |
| Test node: `chrome`, ba lệnh, chip ngữ cảnh, gửi kèm `context` | `*.test.ts(x)` | |

### 3.4 API

| Việc | Tệp | Ghi chú |
|---|---|---|
| `SendMessageRequest.context?: { screen, ref?, label? }`, MaxLength 120 | `chat/dto/request/*.ts` | Thêm, không bắt buộc |
| Ngữ cảnh đổi so với lần trước trong hội thoại: ghi tin SYSTEM "Mở từ {label} ({screen} {ref})" trước tin người dùng | `chat/chat.service.ts` | Không SQL |
| Prompt: ghi chú "Người dùng đang ở màn {screen}, mã {ref}" cho lượt đó; không đưa `ref` vào tool-calling | `chat/*prompt*` | |
| Jest: ghi SYSTEM một lần; không đổi không ghi; prompt có ghi chú | `chat.service.spec.ts` | |

### 3.5 Console

| Việc | Tệp | Ghi chú |
|---|---|---|
| **S8** Card Thiết kế widget: nút Web \| App; App = iframe `WIDGET_URL/?shop=…&mode=app&agent=<agent chọn>&preview=<token>` trong khung 390×780; nút "Gửi identify thử" (gọi `window.__shoptalkHost` qua `contentWindow` vì cùng origin, như `webview-test.html`) và "Đổi ngôn ngữ"; chọn agent từ danh sách tenant | `apps/web/src/domain/settings/WidgetDesignsCard.tsx`, i18n 6 ngôn ngữ | 0,5 ngày, không SQL. Khi widget có `chrome=native` thì vẽ thanh header giả |
| **S9 tùy chọn** Tab Ứng dụng di động: card Giao diện app (`widget_theme.design.surfaces.app`, widget áp khi `surface=app`), card Điểm vào (bảng màn hình → agent, API `GET /public/widget/app-config?shop=`), card Phiên bản SDK, card Kiểm thử | `apps/web/src/domain/settings/*`, `apps/api/src/domain/tenant/*`, `packages/types` | 3 đến 4 ngày; Điểm vào cần cột JSON mới `tenants.mobile_app_config` → SQL |

### 3.6 Wireframe

**W1. Điểm vào trong app Go2Joy (minh họa vị trí)**
```
┌──────────────────────────────┐
│ ◧ Go2Joy                🔔 ⚙ │  ← toolbar app
│ A In Hotel Del Luna · Quận 1 │
├──────────────────────────────┤
│ [Đặt phòng] [Đối soát]       │
│ [Khuyến mãi] [Doanh thu]     │
│ [Đánh giá]   [Thông báo]     │
│ [Chat với khách]             │
│ [Hỗ trợ Go2Joy  ● Mới]  ←── mở ShopTalkChatFragment, agent=hotel-admin
├──────────────────────────────┤
│ Trang chủ  Đặt phòng  Cài đặt│
└──────────────────────────────┘
```

**W2. Màn chat, header NATIVE (`chrome=native`)**
```
┌──────────────────────────────┐
│ ←  Hỗ trợ Go2Joy          ⋮  │  ← app: back, tiêu đề, menu (Ngôn ngữ · Quyền riêng tư · Kết thúc)
│    Go2Joy Support · AI + NV  │
├──────────────────────────────┤
│ ✦ Cuộc trò chuyện này có sử  │  ← widget: dòng thông báo AI (giữ)
│   dụng AI … tại Hoa Kỳ.      │
│ ┌──────────────────────────┐ │
│ │ Xin chào! Chào mừng bạn  │ │  ← lời chào của agent (console)
│ │ đến với Go2Joy Support…  │ │
│ └──────────────────────────┘ │
│  ▢ Xem đặt phòng hôm nay     │  ← menu kịch bản kiểu card (console)
│  ▢ Cách nhận phòng cho khách │
│  ▢ Khiếu nại đặt phòng       │
│  ▢ Hỏi về đối soát           │
├──────────────────────────────┤
│ 📷 📎 [Nhập tin nhắn…    ] ➤ │  ← 📷 mở chooser (W4)
└──────────────────────────────┘
```

**W3. Vào từ màn Đặt phòng (lệnh `context`)**
```
┌──────────────────────────────┐
│ ←  Hỗ trợ Go2Joy          ⋮  │
├──────────────────────────────┤
│ ✦ dòng thông báo AI          │
│      ── Mở từ Đặt phòng ──   │  ← dòng SYSTEM (server ghi, console thấy)
│         #G2J-8841            │
│ ┌──────────────────────────┐ │
│ │ Xin chào! …              │ │
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ ⌖ Đặt phòng #G2J-8841 ·      │  ← chip ngữ cảnh, ✕ bỏ
│   Chờ nhận phòng          ✕  │
│ 📷 📎 [Khách không đến, tôi  │  ← prefill, còn sửa được
│        cần báo no-show…   ] ➤│
└──────────────────────────────┘
```

**W4. Chooser đính kèm (SDK)**
```
├──────────────────────────────┤
│  📷 Chụp ảnh                 │  ← ACTION_IMAGE_CAPTURE + FileProvider
│  🖼 Chọn từ thư viện          │  ← FileChooserParams.createIntent(), đa chọn
│  📄 Tệp (PDF, Excel, Word)   │
│  ── Hủy ──                   │
└──────────────────────────────┘
```

**W5. Màn lỗi (SDK)**
```
┌──────────────────────────────┐
│ ←  Hỗ trợ Go2Joy             │
├──────────────────────────────┤
│            ⚠                 │
│  Không kết nối được với      │
│  Hỗ trợ Go2Joy               │
│  Kiểm tra mạng rồi thử lại.  │
│        [ Thử lại ]           │  ← reload()
│   Gọi hotline 1900 638 838   │  ← config.errorHotline
└──────────────────────────────┘
```

**W6. Chữ ký bị từ chối (widget)**
```
┌──────────────────────────────┐
│ ←  Hỗ trợ Go2Joy          ⋮  │
├──────────────────────────────┤
│ ⚠ Không xác minh được tài    │  ← dải cảnh báo, Thử lại gọi lại provider
│   khoản. Bạn đang trò chuyện │
│   ẩn danh.          [Thử lại]│
│ ┌──────────────────────────┐ │
│ │ Xin chào! …              │ │  ← vẫn chat được
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**W7. Console, Live chat (không sửa UI)**
```
│ 08:31  ── Mở từ Đặt phòng #G2J-8841 (bookings) ──   │  ← dòng SYSTEM
│ 08:31  Lễ tân: Khách không đến, tôi cần báo no-show  │
│        [Lễ tân · A In Hotel Del Luna · Miền Nam]     │  ← badge D2/D5 có sẵn
```

**W8. Console, card Thiết kế widget với preview App (S8)**
```
┌─ Thiết kế widget ───────────────────────────────────────────────────┐
│ Thiết kế: [Go2Joy cam ▾]   Xem trước:  ( Web ) (● App )             │
│ Agent: [Hotel Admin ▾]     [Gửi identify thử] [Ngôn ngữ: vi ▾]      │
│ ┌──────── 390×780 ────────┐                                         │
│ │ ←  Hỗ trợ Go2Joy     ⋮  │ ← header giả của app khi chrome=native  │
│ │ ✦ dòng thông báo AI     │                                         │
│ │ ┌─────────────────────┐ │                                         │
│ │ │ Xin chào! …         │ │                                         │
│ │ └─────────────────────┘ │                                         │
│ │ ▢ Xem đặt phòng hôm nay │                                         │
│ │ 📷 📎 [Nhập tin nhắn] ➤ │                                         │
│ └─────────────────────────┘                                         │
│ Thiết kế chưa lưu đang được áp (token preview). [Áp dụng] [Hủy]    │
└─────────────────────────────────────────────────────────────────────┘
```

**W9. Console, tab Ứng dụng di động (S9 tùy chọn)**
```
┌─ Cài đặt tenant ─ [Chung] [Cài đặt widget] [Ứng dụng di động] … ──┐
│ ┌─ Giao diện app ───────────┐ ┌─ Điểm vào ──────────────────────┐ │
│ │ Font: (● Hệ thống) ( Web) │ │ Màn hình        │ Agent         │ │
│ │ Cỡ chữ: [14 ▾]            │ │ home            │ Hotel Admin ▾ │ │
│ │ Menu: (● Card) ( Chip)    │ │ bookings        │ Hotel Admin ▾ │ │
│ │ Màu riêng app: [ ] bật    │ │ reconciliation  │ Hotel Admin ▾ │ │
│ └───────────────────────────┘ │ [+ Thêm màn hình]               │ │
│ ┌─ Phiên bản SDK ───────────┐ └─────────────────────────────────┘ │
│ │ SDK tối thiểu: 0.2.0      │ ┌─ Kiểm thử ──────────────────────┐ │
│ │ Widget đang chạy: 1.14.0  │ │ [Mở trình mô phỏng app]         │ │
│ │ Cảnh báo lệch: không      │ │ shop, agent điền sẵn theo tenant│ │
│ └───────────────────────────┘ └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## 4. Giai đoạn

| Giai đoạn | Việc | Tệp chính | Công | Kiểm |
|---|---|---|---|---|
| **S1 SDK lõi** | `ShopTalkIdentity`, `ShopTalkIdentityProvider`, protocol pass-through, parse sự kiện mới, listener mới, `accessKey`, `header`, `startTab`, `context`, `settings`, `end`, `reload`; bỏ cache identify; toolchain Kotlin 2.2.0 + `compilerOptions`; `allowInsecureUrl` | `sdk/android/shoptalk/src/main/kotlin/site/amoeba/shoptalk/*`, `build.gradle.kts`, `gradle/wrapper` | 1,5 ngày | JVM unit |
| **S2 Widget** | `chrome=native`, lệnh `settings`/`end`/`back`/`context`, chip ngữ cảnh, prefill, gửi `context`; i18n 6 ngôn ngữ | `apps/widget/src/{lib,hooks,store,components}`, `i18n/locales/*` | 1 ngày | vitest; `npm run i18n:check`; tsc |
| **S3 API** | `context` trong message DTO, dòng SYSTEM, ghi chú prompt | `apps/api/src/domain/chat/*` | 0,5 ngày | jest; boot thật |
| **S4 SDK native UX** | chooser camera + FileProvider + manifest, màn lỗi + timeout 15 s, ép sáng, back, `:shoptalk-compose` | `ShopTalkChatFragment.kt`, `res/*`, `AndroidManifest.xml`, module mới | 1,5 ngày | sample trên máy |
| **S5 Sample + tài liệu** | sample mô phỏng app Go2Joy 4 màn; guide mobile vi (mới) + ko (cập nhật §2, §3, §6); README; release notes 0.2.0; AAR | `sdk/android/sample/*`, `docs/guide/*` | 1 ngày | `assembleRelease` |
| **S6 Kiểm chứng** | TCR Galaxy S21 API 35 + emulator API 24: 15 hạng mục §7 | `docs/test/TCR-2610xx-Kotlin-SDK-0.2.md` | 0,5 ngày | |
| **S7 Go2Joy** | endpoint ký, nhúng, menu entry, UAT (G2, G4, G5) | phía Go2Joy | 1,5 đến 2,5 ngày | UAT chung |
| **S8 Console preview App** | nút Web \| App trong card Thiết kế widget (W8) | `apps/web/src/domain/settings/WidgetDesignsCard.tsx` | 0,5 ngày | vitest; chụp màn |
| **S9 Tab Ứng dụng di động (tùy chọn, sau pilot)** | 4 card W9; API app-config; widget áp `surface=app`; SDK đọc app-config | web, api, widget, sdk | 3 đến 4 ngày | jest, vitest, JVM |

Tổng SharpTalk **6,5 ngày** cho S1 đến S8; S9 thêm 3 đến 4 ngày nếu chọn. S1 + S2 + S3 chạy song song bằng ba agent
với worktree riêng.

## 5. Side-impact

| Thay đổi | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Widget `chrome=native` | Chỉ khi có tham số; web không đổi | Test "không tham số = như cũ" |
| Lệnh mới qua bridge | Loader web bỏ qua lệnh lạ; AAR 0.1.0 bỏ qua sự kiện lạ | NFR-M05 |
| `context` trong message | Tin SYSTEM mới trong hội thoại có ngữ cảnh | Jest kiểm đếm thống kê |
| Prompt có ngữ cảnh | Chỉ session có context; golden set không ảnh hưởng | Chạy golden sau S3 |
| Bỏ cache identify trong SDK | App dùng 0.1.0 nâng lên phải đặt `identityProvider` | Release notes |
| Toolchain 2.2.0 | Máy build cần JDK 17, AGP trong dải KGP 2.2.0 | README |
| Preview App trong console | Thêm chế độ trong card có sẵn, không đổi hành vi web | |
| S9 | Cột JSON mới, API công khai mới (chỉ đọc, theo `shop`), widget đọc thêm `surface` | Migration §6; API trả rỗng khi chưa cấu hình |

## 6. Migration

- S1 đến S8: **không có SQL**, không chạm `*.entity.ts`.
- S9 (chỉ khi chọn): `sql/2610xx-tenant-mobile-app-config.sql` thêm `tenants.mobile_app_config` JSON NULL. Áp SQL
  trước khi deploy code; staging chạy `DB_SYNCHRONIZE=false`. Rollback: `DROP COLUMN`. Checkbox áp dụng từng môi
  trường sẽ ghi trong thân PR của S9.

## 7. Kiểm thử (TCR dự kiến)

| # | Hạng mục | Nơi |
|---|---|---|
| 1 | Identity JSON hai dạng đi qua bridge nguyên văn; thiếu `hash` thì từ chối tại SDK | JVM |
| 2 | Provider gọi khi ready, reload, `identity-expired`; lỗi provider → khách + `onError` | JVM + máy |
| 3 | `chrome=native` ẩn header; `settings`, `end`, `back` hoạt động | vitest + máy |
| 4 | `context`: chip, ✕, prefill không ghi đè ô đang gõ; tin kế tiếp mang `context`; SYSTEM ghi một lần; console thấy | vitest + jest + máy |
| 5 | Chooser: chụp, thư viện đa chọn, tệp; hủy không khóa lần sau; xoay khi chooser mở | máy |
| 6 | Màn lỗi: tắt mạng, DNS sai, 500; Thử lại; timeout 15 s | máy |
| 7 | Ép sáng trong app dark | máy |
| 8 | Cỡ chữ 130 %, xoay ngang, process death | máy |
| 9 | Link ngoài, `tel:`, `mailto:`; `onOpenUrl` trả true thì SDK không mở | máy |
| 10 | Đổi tài khoản trên cùng máy | máy + staging |
| 11 | `consent_source = host_terms`: không popup cho người đã ký; khách vẫn thấy banner | staging |
| 12 | API 24 emulator: tối thiểu 1, 3, 5 | emulator |
| 13 | AAR 0.2.0 với widget cũ và AAR 0.1.0 với widget mới không crash | máy |
| 14 | Không log userId, hash, nội dung | review log |
| 15 | Console preview App: đúng agent, đúng thiết kế chưa lưu, identify thử trả `identified` | vitest + thủ công |

## 8. Rủi ro

| Rủi ro | Ảnh hưởng | Đối phó |
|---|---|---|
| Hợp đồng identify chưa hợp nhất khi Go2Joy viết endpoint | Viết hai lần | A2: ký `attributes` ngay; SDK pass-through; chốt Q1 trong tuần |
| App Go2Joy là Compose và không muốn fragment-compose | Wrapper không dùng được | Fallback `AndroidView { FragmentContainerView }` trong guide |
| Máy không có app camera mặc định | Nút chụp không phản hồi | `resolveActivity`; ẩn mục chụp |
| WebView cũ trên API 24 | Lệch bố cục | TCR 12; ghi minimum WebView trong guide |
| Prompt có ngữ cảnh làm AI bịa số đặt phòng | Sai thông tin | Ghi chú prompt chỉ là bối cảnh; số liệu chỉ từ tool |
| DNS `sharptalk.go2joy.vn` chậm | Pilot app phải đổi địa chỉ sau | A11 remote config |

## 9. Lịch và phụ thuộc

- Bắt đầu sau duyệt. S1 đến S3 song song 2 ngày, S4 2 ngày, S5, S6, S8 1,5 ngày. Giao AAR 0.2.0 + guide ngày 6 đến 7.
- Go2Joy song song: endpoint ký, build nội bộ có entry. UAT chung tuần kế.
- Khớp PLN-261015: pilot app trên staging hoặc production Hàn Quốc trước 31/10; đổi `widgetUrl` sau M3 26/10 nếu
  máy chủ Go2Joy sẵn sàng. Trong PLN-261014 là kênh thứ hai ở Phase 3.

## 10. Artifact mô phỏng

`PLN-261015-Go2Joy-Kotlin-SDK-0.2.mockup.html` và `.mockup.png`: 8 màn hình theo giao diện widget thật, đánh dấu
phần Mới 0.2, kèm bảng so sánh concept web với app. `PLN-261015-Go2Joy-Kotlin-SDK-0.2.prototype.html` và `.prototype.png`:
hai màn hình, admin web tab Ứng dụng di động (W8 + W9 theo giao diện console thật) và màn chat lễ tân trong app Kotlin, số tròn nối cấu hình admin với phần tử app.

## Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-10-15 | API SDK 0.2.0, bridge, W1 đến W7, S1 đến S7 |
| 1.1 | 2026-10-15 | §0 lộ trình G0 đến G6; A2, A9, A11; §3.5 console S8 và S9; W8, W9; §6 migration S9; TCR 15; giá trị `shop`, `agent`, origin theo staging thật; rebase trên `main` e0610355 |
