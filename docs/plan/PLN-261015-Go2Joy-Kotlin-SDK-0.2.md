# PLN-261015-Go2Joy-Kotlin-SDK-0.2

> **Kế hoạch.** SDK Android `sdk/android` 0.2.0 + widget + API để app Go2Joy (Kotlin 2.2.0) nhúng chat theo chuẩn
> trong `REQ-261015-Go2Joy-Kotlin-App-Widget`.
> **Trạng thái.** DỰ THẢO, chờ duyệt. Không triển khai trước khi duyệt.
> **Nhánh.** `feature/go2joy-kotlin-app-widget` (từ `main` `7992e71d`).
> **Artifact mô phỏng.** `PLN-261015-Go2Joy-Kotlin-SDK-0.2.mockup.html` và `.mockup.png` cùng thư mục: 8 màn hình
> dựa trên giao diện widget thật (ảnh `img/PLN-261015-SharpTalk-for-Go2Joy/01-widget-home.jpg`, `02-widget-answer.jpg`).

## 1. Quyết định giả định

| ID | Giả định | Nguồn |
|---|---|---|
| A1 | SDK chuyển tiếp **gói danh tính ký sẵn** nguyên văn; không phụ thuộc hợp đồng `attributes` hay `claims` | REQ §3.1 nguyên tắc 2, Q1 |
| A2 | Ký lại qua `identityProvider` mỗi khi cần; bỏ cache JSON identify | REQ G2 |
| A3 | Header mặc định WIDGET (chạy ngay hôm nay); NATIVE là tùy chọn cho màn dưới toolbar app | REQ Q2 |
| A4 | Camera bật qua intent chụp, không quyền CAMERA; FileProvider trong SDK | REQ Q3 |
| A5 | Ép sáng WebView; không làm dark mode widget | REQ Q4 |
| A6 | Ngữ cảnh lưu dạng dòng SYSTEM trong hội thoại, không bảng mới, **không SQL** | REQ FR-M15 |
| A7 | AAR file + tùy chọn source module; Compose là module riêng | REQ Q8, Q9 |
| A8 | Push, badge chưa đọc, dark mode widget, trục bề mặt console, iOS: ngoài phạm vi | REQ Q5, Q6, Q7, Q10 |

## 2. Phạm vi

**Trong.** SDK 0.2.0 (`:shoptalk`, `:shoptalk-compose`, `:sample`), widget (tham số `chrome`, lệnh `settings`,
`end`, `back`, `context`), API (`context` trong message), guide mobile vi + ko, TCR trên máy thật, release notes.

**Ngoài.** FCM, badge ngoài màn chat, dark mode widget, design theo bề mặt trong console, iOS, hợp nhất hai hợp đồng
identify (việc của nhóm backend, REQ Q1).

## 3. Thiết kế

### 3.1 API SDK 0.2.0

```kotlin
data class ShopTalkConfig(
    val widgetUrl: String,                      // staging hiện tại: https://shoptalk.amoeba.site/widget/ · self-hosted đề xuất (PLN-261015 D1, chưa chốt): sharptalk.go2joy.vn
    val shop: String? = null,                   // "https://www.go2joy.vn" — khớp tenants.shop_domain của tenant go2joy trên staging (PLN-261015 §8); không phải domain app
    val agent: String? = null,                  // hotel-admin (agent giai đoạn 1 theo PLN-261015)
    val locale: String? = null,                 // vi
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

Trình tự khi ready: SDK gọi `identityProvider.identity()`; kết quả khác null thì gửi `ivy:identify`; null thì
khách; lỗi thì `onError(IdentityProviderFailed)` và khách. `ivy:event identity-expired` kích hoạt lại cùng trình tự.
`identify(identity)` thủ công chỉ gửi một lần và không được gửi lại khi reload.

### 3.2 Giao thức bridge

| Hướng | Thông điệp | Trạng thái |
|---|---|---|
| App → widget | `ivy:identify {user}` với `user` nguyên văn từ backend | sửa: pass-through |
| App → widget | `ivy:command` `open`, `close`, `toggle`, `locale`, `logout` | giữ |
| App → widget | `ivy:command` `settings` (mở hoặc đóng Preferences), `end` (kết thúc hội thoại), `back` (đóng Preferences nếu đang mở, trả `{handled}`), `context {screen, ref, label, prefill}` | **mới** |
| Widget → app | `ivy:ready`, `ivy:close-request`, `ivy:event identified`, `ivy:open-url`, `ivy:unread` | giữ, SDK bắt đủ |
| Widget → app | `ivy:event identity-expired` (có trên nhánh PR; `main` chưa phát) | SDK bắt, bỏ qua nếu không tới |
| Widget → app | `ivy:event back {handled: boolean}` | **mới**, trả lời cho `back` |

URL: giữ `embed=1&mode=app&shop&agent&access`; thêm `chrome=native`; nhận `surface=app` và bỏ qua.

### 3.3 Widget

| Việc | Tệp | Ghi chú |
|---|---|---|
| `chrome=native` ẩn `<header>` của `WidgetPanel` và `PilotNoticePanel`; dòng thông báo AI giữ nguyên | `lib/host-bridge.ts` (`isNativeChrome()`), `components/widget/WidgetPanel.tsx` | Nút Kết thúc trong dòng thông báo giữ |
| Lệnh `settings`, `end`, `back` | `hooks/useEmbedCommands.ts`, store `showSettings` nâng lên store | `end` gọi đúng hành động của nút "Kết thúc" |
| Lệnh `context`: lưu `hostContext` trong store; chip trên composer, nút ✕; `prefill` điền ô nhập nếu ô trống; gửi `context` cùng tin kế tiếp rồi giữ cho tới khi đổi | `store/widgetStore.ts`, `components/chat/ChatTab.tsx`, `hooks/useChat.ts`, `services/chatService` | i18n 6 ngôn ngữ cho nhãn chip và a11y |
| `accept` thêm `capture` không cần; Android chooser xử lý | — | |
| Test node: `chrome` param, ba lệnh, chip ngữ cảnh, gửi kèm `context` | `*.test.ts(x)` | |

### 3.4 API

| Việc | Tệp | Ghi chú |
|---|---|---|
| `SendMessageRequest.context?: { screen, ref?, label? }` (snake_case: `screen`, `ref`, `label`), MaxLength 120 mỗi trường | `chat/dto/request/*.ts` | Thêm, không bắt buộc |
| Khi `context` đổi so với lần trước trong hội thoại: ghi tin SYSTEM "Mở từ {label} ({screen} {ref})" trước tin người dùng; lưu lần cuối trong `conversation.metadata` nếu đã có cột JSON, nếu không thì so với tin SYSTEM gần nhất | `chat/chat.service.ts` | Không SQL |
| Prompt: thêm ghi chú ngữ cảnh "Người dùng đang ở màn {screen}, mã {ref}" vào system note của lượt đó | `chat/*prompt*` | Không đưa `ref` vào tool-calling |
| Jest: context mới ghi SYSTEM một lần; context không đổi không ghi; prompt có ghi chú | `chat.service.spec.ts` | |

Console: dòng SYSTEM đã hiển thị trong Live chat; không cần sửa.

### 3.5 Wireframe

**W1. Điểm vào trong app Go2Joy Partner (app của Go2Joy, chỉ minh họa vị trí)**
```
┌──────────────────────────────┐
│ ◧ Go2Joy Partner        🔔 ⚙ │  ← toolbar app (cam Go2Joy)
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
│ │ Xin chào! Chào mừng bạn  │ │  ← lời chào của agent (cấu hình console)
│ │ đến với Go2Joy Support…  │ │
│ └──────────────────────────┘ │
│  ▢ Xem đặt phòng hôm nay     │  ← menu kịch bản kiểu card (cấu hình tenant)
│  ▢ Cách nhận phòng cho khách │
│  ▢ Khiếu nại đặt phòng       │
│  ▢ Hỏi về đối soát           │
│                              │
├──────────────────────────────┤
│ 📷 📎 [Nhập tin nhắn…    ] ➤ │  ← composer; 📷 mở chooser (W4)
└──────────────────────────────┘
```

**W3. Vào từ màn Đặt phòng (lệnh `context`)**
```
┌──────────────────────────────┐
│ ←  Hỗ trợ Go2Joy          ⋮  │
├──────────────────────────────┤
│ ✦ dòng thông báo AI          │
│      ── Mở từ Đặt phòng ──   │  ← dòng SYSTEM (server ghi, console cũng thấy)
│         #G2J-8841            │
│ ┌──────────────────────────┐ │
│ │ Xin chào! … chủ đề bên   │ │
│ │ dưới hoặc nhập câu hỏi.  │ │
│ └──────────────────────────┘ │
│                              │
├──────────────────────────────┤
│ ⌖ Đặt phòng #G2J-8841 ·      │  ← chip ngữ cảnh, ✕ bỏ
│   Chờ nhận phòng          ✕  │
│ 📷 📎 [Khách không đến, tôi  │  ← prefill, ô nhập còn sửa được
│        cần báo no-show…   ] ➤│
└──────────────────────────────┘
```

**W4. Chooser đính kèm (SDK, native)**
```
┌──────────────────────────────┐
│ (chat mờ phía sau)           │
│                              │
├──────────────────────────────┤
│  📷 Chụp ảnh                 │  ← ACTION_IMAGE_CAPTURE + FileProvider
│  🖼 Chọn từ thư viện          │  ← FileChooserParams.createIntent(), đa chọn
│  📄 Tệp (PDF, Excel, Word)   │
│  ── Hủy ──                   │
└──────────────────────────────┘
```

**W5. Màn lỗi (SDK, native)**
```
┌──────────────────────────────┐
│ ←  Hỗ trợ Go2Joy             │
├──────────────────────────────┤
│                              │
│            ⚠                 │
│  Không kết nối được với      │
│  Hỗ trợ Go2Joy               │
│  Kiểm tra mạng rồi thử lại.  │
│                              │
│        [ Thử lại ]           │  ← reload()
│   Gọi hotline 1900 638 838   │  ← config.errorHotline, tùy chọn
│                              │
└──────────────────────────────┘
```

**W6. Chữ ký bị từ chối (widget, trạng thái khách)**
```
┌──────────────────────────────┐
│ ←  Hỗ trợ Go2Joy          ⋮  │
├──────────────────────────────┤
│ ⚠ Không xác minh được tài    │  ← dải cảnh báo, "Thử lại" gọi lại provider
│   khoản. Bạn đang trò chuyện │
│   ẩn danh.          [Thử lại]│
│ ┌──────────────────────────┐ │
│ │ Xin chào! …              │ │  ← vẫn chat được (nguyên tắc 5)
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**W7. Console, Live chat (không sửa UI)**
```
│ 08:31  ── Mở từ Đặt phòng #G2J-8841 (bookings) ──   │  ← dòng SYSTEM
│ 08:31  Lễ tân: Khách không đến, tôi cần báo no-show  │
│        [Lễ tân · A In Hotel Del Luna · Miền Nam]     │  ← badge D2/D5 có sẵn
```

Backend-only phần API: không có UI mới ngoài dòng SYSTEM đã có.

## 4. Giai đoạn

| Giai đoạn | Việc | Tệp chính | Công | Kiểm |
|---|---|---|---|---|
| **S1 SDK lõi** | `ShopTalkIdentity`, `ShopTalkIdentityProvider`, protocol pass-through, parse `identity-expired`/`open-url`/`unread`/`back`, listener mới, `accessKey`, `header`, `startTab`, `context`, `settings`, `end`, `reload`; bỏ cache identify; toolchain Kotlin 2.2.0 + `compilerOptions`; `allowInsecureUrl` | `sdk/android/shoptalk/src/main/kotlin/site/amoeba/shoptalk/*`, `internal/ShopTalkProtocol.kt`, `build.gradle.kts`, `gradle/wrapper` | 1,5 ngày | JVM unit: identity JSON nguyên văn hai dạng, inbound mới, injection an toàn |
| **S2 Widget** | `chrome=native`, lệnh `settings`/`end`/`back`/`context`, chip ngữ cảnh, prefill, gửi `context`; i18n 6 ngôn ngữ | `apps/widget/src/{lib,hooks,store,components/chat,components/widget}`, `i18n/locales/*` | 1 ngày | vitest; `npm run i18n:check`; tsc |
| **S3 API** | `context` trong message DTO, dòng SYSTEM, ghi chú prompt | `apps/api/src/domain/chat/*` | 0,5 ngày | jest 3 ca; boot thật |
| **S4 SDK native UX** | chooser camera + FileProvider + manifest `<provider>` `<queries>`, màn lỗi + timeout 15 s, ép sáng, back qua `OnBackPressedCallback`, `:shoptalk-compose` | `ShopTalkChatFragment.kt`, `res/layout/shoptalk_error.xml`, `res/xml/shoptalk_paths.xml`, `AndroidManifest.xml`, module mới | 1,5 ngày | sample trên máy |
| **S5 Sample + tài liệu** | sample mô phỏng Partner app 4 màn; guide mobile vi (mới) + ko (cập nhật §2, §3, §6); README; release notes 0.2.0; AAR | `sdk/android/sample/*`, `docs/guide/모바일SDK연동가이드_Mobile-SDK.ko.md`, `docs/guide/GUIDE-2610xx-Mobile-SDK.vi.md`, `sdk/android/README.md` | 1 ngày | `assembleRelease` |
| **S6 Kiểm chứng** | TCR trên Galaxy S21 API 35 + emulator API 24: 14 hạng mục §7; sửa lỗi phát hiện | `docs/test/TCR-2610xx-Kotlin-SDK-0.2.md` | 0,5 ngày | |
| **S7 Go2Joy** | endpoint ký (gói nguyên văn), nhúng Fragment hoặc Compose, menu entry, UAT | phía Go2Joy | 1,5 đến 2,5 ngày | UAT chung |

Tổng SharpTalk **6 ngày**; có thể chạy S1+S2+S3 song song bằng ba agent với worktree riêng (cách làm trong
`go2joy-branches-rebased-1012`).

## 5. Side-impact

| Thay đổi | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Widget `chrome=native` | Chỉ khi có tham số; web embed không đổi | Test "không tham số = như cũ" |
| Lệnh mới qua bridge | Loader web bỏ qua lệnh lạ; AAR 0.1.0 bỏ qua sự kiện lạ | NFR-M05 |
| `context` trong message | Tin SYSTEM mới trong hội thoại có ngữ cảnh; thống kê đếm tin SYSTEM không đổi (đã loại SYSTEM trước đó, kiểm lại) | Jest kiểm đếm |
| Prompt có ghi chú ngữ cảnh | Thay đổi nhỏ trong prompt cho session có context; golden set không ảnh hưởng vì không có context | Chạy golden sau S3 |
| Bỏ cache identify trong SDK | App 0.1.0 dựa vào gửi lại khi reload sẽ mất hành vi đó nếu nâng mà không đặt provider | Release notes: "đặt `identityProvider` khi nâng" |
| Toolchain SDK lên 2.2.0 | Máy build cần JDK 17, AGP trong dải KGP 2.2.0 | README |
| Ép sáng WebView | Chỉ WebView của SDK | — |
| Hai hợp đồng identify | SDK không ảnh hưởng; guide phải viết theo hợp đồng sau hợp nhất | Guide tách mục "gói danh tính" tham chiếu guide embed |

Không chạm `*.entity.ts`, không thêm `sql/`. Nếu sau này chọn lưu context vào cột riêng thì mới cần migration.

## 6. Migration

Không có. S3 dùng tin SYSTEM đã có; S1, S2, S4, S5 không chạm schema.

## 7. Kiểm thử (TCR dự kiến)

| # | Hạng mục | Nơi |
|---|---|---|
| 1 | Identity JSON hai dạng (`attributes`, `claims`) đi qua bridge nguyên văn; thiếu `hash` thì từ chối tại SDK | JVM |
| 2 | Provider gọi khi ready, reload, `identity-expired`; lỗi provider → khách + `onError` | JVM + máy |
| 3 | `chrome=native` ẩn header; `settings`, `end`, `back` hoạt động; back đóng Preferences trước | vitest + máy |
| 4 | `context`: chip, ✕, prefill không ghi đè ô đang gõ; tin kế tiếp mang `context`; SYSTEM ghi một lần; console thấy | vitest + jest + máy |
| 5 | Chooser: chụp ảnh, thư viện đa chọn, tệp; hủy không khóa chooser lần sau; xoay màn khi chooser mở | máy |
| 6 | Màn lỗi: tắt mạng, DNS sai, 500; Thử lại; timeout 15 s | máy |
| 7 | Ép sáng trong app dark | máy |
| 8 | Cỡ chữ hệ thống 130 %, xoay ngang, process death | máy |
| 9 | Link ngoài, `tel:`, `mailto:` mở ngoài; `onOpenUrl` trả true thì SDK không mở | máy |
| 10 | Đổi tài khoản trên cùng máy | máy + staging |
| 11 | `consent_source = host_terms`: không popup cho người đã ký; khách vẫn thấy banner | staging |
| 12 | API 24 emulator: tối thiểu 1, 3, 5 | emulator |
| 13 | AAR 0.2.0 với widget cũ và AAR 0.1.0 với widget mới không crash | máy |
| 14 | Không log userId, hash, nội dung | review log |

## 8. Rủi ro

| Rủi ro | Ảnh hưởng | Đối phó |
|---|---|---|
| Hợp đồng identify chưa hợp nhất khi Go2Joy viết endpoint | Go2Joy viết hai lần | SDK pass-through; Go2Joy trả gói do ta quy định; chốt Q1 trong tuần |
| App Partner là Compose và Go2Joy không muốn fragment-compose | Wrapper không dùng được | Fallback `AndroidView { FragmentContainerView }` trong guide |
| Intent chụp ảnh bị chặn trên máy không có app camera mặc định | Nút chụp không phản hồi | Kiểm `resolveActivity`; ẩn mục chụp khi không có |
| WebView cũ trên API 24 thiếu tính năng CSS | Lệch bố cục | TCR 12; ghi minimum WebView version vào guide |
| Prompt có ngữ cảnh làm AI "bịa" số đặt phòng | Sai thông tin | Ghi chú prompt chỉ dùng làm bối cảnh, số liệu vẫn chỉ từ tool |

## 9. Lịch và phụ thuộc

- Bắt đầu sau duyệt. S1 đến S3 song song 2 ngày, S4 2 ngày, S5 và S6 1 ngày. Giao AAR 0.2.0 + guide vào ngày 6.
- Go2Joy song song: endpoint ký, build nội bộ có entry "Hỗ trợ Go2Joy". UAT chung tuần kế.
- Khớp PLN-261015 (1 giai đoạn kết thúc 31/10) nếu bắt đầu trước 20/10; trong PLN-261014 là kênh thứ hai ở Phase 3.

## 10. Artifact mô phỏng

`PLN-261015-Go2Joy-Kotlin-SDK-0.2.mockup.html` (mở bằng trình duyệt) và `.mockup.png`: 8 khung màn hình
dựng theo giao diện widget thật (màu Go2Joy, dòng thông báo AI, lời chào, 4 nút nhanh, trả lời có nguồn, chip
"Gặp nhân viên hỗ trợ", composer), đánh dấu phần **Mới 0.2** (header native, chip ngữ cảnh, chooser camera, màn
lỗi, dải từ chối chữ ký) và bảng so sánh concept web với app.
