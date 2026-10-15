# REQ-261015-Go2Joy-Kotlin-App-Widget

> **Yêu cầu.** Nhúng widget SharpTalk vào ứng dụng Android của Go2Joy (Kotlin 2.2.0) bằng SDK Kotlin, cấu hình từ
> console trên trình duyệt như đã làm cho Hotel Admin web, với concept UX phù hợp mobile, và cho admin Go2Joy một
> chỗ trên console để thao tác phần app tách khỏi phần web.
> **Phiên bản.** 1.1 (2026-10-15). 1.0 là bản phân tích SDK; 1.1 gom toàn bộ buổi thảo luận: bản chất AAR so với
> `embed.js`, bức tranh admin trên console, preview, tab ứng dụng di động, ma trận khả thi, lộ trình G0 đến G6.
> **Nhánh.** `feature/go2joy-kotlin-app-widget`, rebase trên `main` `e0610355` (PLN-261015 v1.1).
> **Trạng thái.** Phân tích. Kế hoạch: `docs/plan/PLN-261015-Go2Joy-Kotlin-SDK-0.2.md` (chờ duyệt).
> **Kế thừa.** `REQ-260826-Go2Joy-Kotlin-Mobile-SDK`, `PLN-260827-Kotlin-Android-SDK`, `RPT-260829`, `TCR-260828`,
> `FIX-260828-Widget-AppMode-Defects`, `PLN-261015-SharpTalk-for-Go2Joy-Project-Plan` v1.1 (D2 thuộc tính ký, D9 đồng
> ý theo điều khoản host, §8 địa chỉ staging), `PLN-261001-Go2Joy-Guest-Login-Gate` v1.1 (claims v2, nhánh PR
> `feature/go2joy-stage1-complete`), `docs/guide/모바일SDK연동가이드_Mobile-SDK.ko.md`,
> `docs/guide/임베드SDK설치가이드_Embed-SDK.ko.md`, `docs/guide/위젯설정가이드_Widget-Settings.ko.md`.

## 1. Bối cảnh và mục tiêu

- Hotel Admin web (`ha.go2joy.vn`, Vue 2) đã nhúng được widget qua `embed.js`; nội dung, agent, theme, menu kịch bản,
  danh tính đều cấu hình từ console. Go2Joy muốn kênh thứ hai là **app Android** cho lễ tân và quản lý khách sạn,
  app viết bằng Kotlin 2.2.0 (thông tin từ Go2Joy, chưa biết Compose hay XML, minSdk, AGP).
- Tenant go2joy có **6 AI agent** (Hotel Partner "Joydesk" là mặc định; **Hotel Admin, mã `hotel-admin`, là agent
  giai đoạn 1** theo PLN-261015; còn Default, Landing Guest, Admin Staff, Ads Partner). Giai đoạn 2 (PLN-261015 §11.1)
  thêm agent theo từng khách sạn cho khách đặt phòng trên app người dùng. SDK Kotlin vì thế phải là **một SDK cho
  nhiều điểm vào, nhiều agent**.
- Tình trạng `main` ngày 15/10 (PLN-261015 v1.1): D2 thuộc tính ký, D3 định tuyến vùng × nghiệp vụ, D4 cảnh báo, D5
  badge, D7 đánh giá độ chính xác, D9 đồng ý theo điều khoản host **đã lên staging và production Hàn Quốc** cho
  tenant go2joy; ngôn ngữ mặc định `vi`, múi giờ `Asia/Ho_Chi_Minh`. Phía Go2Joy còn nợ: máy chủ, SSH, DNS
  (`sharptalk.go2joy.vn` chưa có bản ghi), mã ký ở Hotel Admin server, danh sách vùng và nhân viên, Zalo OA, điều
  khoản. Mốc M3 cài máy chủ Go2Joy 26/10, kết thúc giai đoạn 1 ngày 31/10.
- Mục tiêu tài liệu: chốt **chuẩn tích hợp Kotlin** để mọi app của Go2Joy nhúng cùng một cách, cấu hình cùng một chỗ,
  và trả lời rõ admin thao tác gì, thấy gì, cái gì nằm trong app.

Các câu hỏi đã trả lời trong buổi thảo luận, được gom vào tài liệu này:

| Câu hỏi | Trả lời ngắn | Mục |
|---|---|---|
| Gắn SDK Kotlin có giống dán script JS trên web không | Cùng ý tưởng, khác cơ chế: AAR đóng vai `embed.js`, WebView đóng vai iframe, cầu nối là Kotlin | §2.2 |
| Admin cấu hình trên trình duyệt, app chỉ nhúng, có khả thi không | Có, phần lớn chạy ngay; giao diện chưa tách được web và app | §2.3, §4 |
| Admin thao tác gì cho phần app | Hôm nay không có khu vực riêng; 3 việc đụng tới app, còn lại dùng chung | §2.5 |
| Console có preview app như web không | Chưa; chỉ có preview web và trình mô phỏng dev ngoài console | §2.6 |
| Độ khả thi từng hạng mục | Pilot: cao; khu vực app trên console: trung bình; push nền, nối tiếp web và app: thấp trong phạm vi này | §4 |
| Bức tranh triển khai từ team tới app | G0 chốt, G1 admin console, G2 backend ký, G3 SDK, G4 cài app, G5 UAT, G6 phát hành | PLN §0 |

## 2. AS-IS

### 2.1 Đã có trên `main`

| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| `sdk/android` 0.1.0 | AAR, `ShopTalkChatFragment` bọc WebView, bridge `ShopTalkAndroid`, giao thức JSON, file chooser, bàn phím, khôi phục state, hàng đợi 20 lệnh, tự gửi lại identify khi reload | Kotlin 2.0.20, AGP 8.5.2, Gradle 8.7, minSdk 24, compileSdk 35, JVM 17, phụ thuộc chỉ core-ktx + fragment-ktx |
| Widget app mode | `?embed=1&mode=app`: không launcher, panel mở sẵn, toàn màn hình, X gửi `ivy:close-request`, thanh tab tự ẩn khi còn một tab, safe-area đáy | `host-bridge.ts`, `WidgetPanel.tsx` |
| Bridge app → widget | `ivy:identify {user}`, `ivy:command` open/close/toggle/locale/logout | `useEmbedCommands.ts` |
| Bridge widget → app | `ivy:ready`, `ivy:close-request`, `ivy:event identified`, `ivy:open-url`, `ivy:unread` | SDK 0.1.0 chỉ bắt ba cái đầu |
| Identify | v1 `HMAC(userId)`; **D2**: `attributes` {hotel_id, hotel_name, region, province, role} ký theo chuỗi `userId\nkey=value…`, lưu `sessions.identity_attributes`; **đang chạy trên staging và production Hàn Quốc** | `embed/identity-attributes.ts` |
| Đồng ý | **D9** `tenants.consent_source = host_terms`: người dùng đã ký được ghi nhận đồng ý, không hiện banner; vẫn hiện dòng thông báo AI; bật khi chuyển vận hành | SQL `261015-tenant-consent-source.sql` |
| Địa chỉ staging của tenant go2joy | `https://shoptalk.amoeba.site/widget/?mode=app&shop=https%3A%2F%2Fwww.go2joy.vn&agent=hotel-admin` | PLN-261015 §8; `shop` khớp `tenants.shop_domain`, không phải domain app |
| Tài liệu | Guide mobile (ko) §1 đến §8, guide embed §3.4 ký `attributes`, guide cài đặt widget, trình mô phỏng `widget/webview-test.html` | |
| Kiểm chứng | Galaxy S21 Android 15 ngày 28/08: 13/13 unit, 8 hạng mục trên máy, 5 lỗi widget đã sửa; chưa kiểm link ngoài trên máy, chưa kiểm API 24 | TCR-260828 |

### 2.2 Bản chất: AAR so với `embed.js`

| Lớp | Web | App Kotlin |
|---|---|---|
| Thứ được "dán" | `embed.js` chạy trong trang | AAR chạy trong APK |
| Khung chứa widget | iframe do `embed.js` tạo | WebView do AAR tạo |
| Trang bên trong | widget `/widget/?embed=1` | cùng widget, thêm `mode=app` |
| Nút mở chat | launcher nổi do `embed.js` vẽ | nút của app mở màn hình |
| Gửi lệnh vào widget | `postMessage` từ trang cha | `evaluateJavascript` gọi `window.__shoptalkHost` |
| Widget báo ra | `postMessage` lên trang cha | `window.ShopTalkAndroid.postMessage` |
| Danh tính | `ShopTalk.identify(...)` bằng JS | hàm Kotlin, cùng gói ký, cùng `/public/embed/identify` |
| Cấu hình nội dung, theme, agent | từ console lúc mở | giống hệt |
| Đổi địa chỉ widget hoặc agent | sửa HTML, hiệu lực ngay | sửa code app, phát hành lại |

Trình duyệt làm sẵn cho web những thứ WebView không làm: chọn tệp, bàn phím đẩy ô nhập, link ra ngoài, lưu session,
hàng đợi lệnh trước khi trang tải. AAR tồn tại để làm thay các việc đó. Go2Joy có thể bỏ AAR và tự viết khoảng 40
dòng theo guide mobile mục 6-thủ công, nhưng sẽ gặp lại 5 lỗi đã sửa trên máy thật.

### 2.3 Cấu hình: theo agent, theo tenant, trong app

| Nhóm | Theo agent (`ai_agents`, chọn bằng `?agent=`) | Theo tenant (chung mọi agent, mọi bề mặt) | Trong app (dev Go2Joy giữ) |
|---|---|---|---|
| Nội dung | persona, lời chào đa ngữ, rules, menu kịch bản và chip trả lời, phạm vi tri thức, thông báo riêng tư, guest policy | copy widget | — |
| Giao diện | — | theme, design (font, cỡ chữ, radius, panel, kiểu menu, customCss), tabs | header native hay widget, hotline màn lỗi |
| Vận hành | định tuyến đội theo agent | pilot, consent source, login mode, embed origins, widget access, notification channels | — |
| Địa chỉ | — | — | `widgetUrl`, `shop`, mã agent cho từng điểm vào, bật camera |

Hệ quả: app ghim được agent khác nhau cho từng điểm vào, nhưng **không thể có giao diện riêng cho app khác với
web**, và admin không chỉnh được những gì nằm trong app nếu không có remote config hoặc tab mới trên console (§3.4).

### 2.4 Hai hợp đồng identify đang tồn tại song song

| | `main` (PLN-261015 D2, PR #637) | Nhánh PR `feature/go2joy-stage1-complete` (PLN-261001 H1) |
|---|---|---|
| Trường | `attributes: {hotel_id, hotel_name, region, province, role}` | `claims: {hotel_sn, role, iat, province?, hotel_name?, hotel_code?}` |
| Chuỗi ký | `userId\nkey=value` theo thứ tự chữ cái | `userId\|hotelSn\|role\|iat[\|province]` |
| Hết hạn | không | `iat` ±600 s, danh tính hết hạn sau 8 h, sự kiện `identity-expired` |
| Đổi người, đổi khách sạn | thay thuộc tính trên cùng session | tách session mới, logout phía máy chủ, chống phát lại |
| Pilot theo khách sạn | không | có |
| Trạng thái | **đang chạy trên staging và production Hàn Quốc từ 15/10** | chưa hợp nhất, 168 commit, 19 SQL |

SDK Kotlin **không được phụ thuộc vào bên nào thắng**: app phát hành một lần, hợp đồng có thể đổi sau. Phía Go2Joy
thì phụ thuộc, vì endpoint ký phải tạo đúng chuỗi.

### 2.5 Bức tranh admin Go2Joy trên console hôm nay

Console **không có khu vực riêng cho app**. Thao tác của admin theo đường dẫn hiện có:

| Bước | Đường dẫn | Ảnh hưởng | Web hay app |
|---|---|---|---|
| 1. Phát hành khóa ký | Cài đặt tenant › tab Cài đặt widget › card **Nhúng & SDK** › "Liên kết đăng nhập" | Secret giao dev backend; backend ký cho cả web và app | Chung |
| 2. Nguồn đồng ý | Cài đặt tenant › **Nguồn đồng ý** › "Điều khoản ứng dụng chủ" | Người dùng đã ký không thấy popup đồng ý | Chung, quan trọng nhất với app |
| 3. Agent cho app | Cài đặt AI › danh sách agent | Admin chỉnh lời chào, nút nhanh, tri thức của agent; **mã agent nằm trong app** | Riêng app về nội dung |
| 4. Theme, tab, tên hiển thị, lời chào | Cài đặt widget › **Theme widget**, **Cấu hình tab**, **Hành vi widget** | Màu, logo, chỉ tab chat, kiểu menu card | Chung, không tách được |
| 5. Kết nối nhân viên | Cài đặt tenant › **Kết nối nhân viên** | Quy tắc vùng × nghiệp vụ, giờ làm, cảnh báo | Chung |
| 6. Kiểm tra trước khi giao app | `widget/webview-test.html?embed=1&mode=app&shop=…&agent=hotel-admin` | Thấy đúng cái app sẽ hiện | Dành cho app, ngoài console |

Hai card không cần đụng cho app: "Mã cài đặt" (snippet HTML cho web) và "Tên miền được phép" (WebView không có
trang cha nên không áp dụng).

### 2.6 Preview hiện có

| Preview | Ở đâu | Hiện cái gì | Giống app không |
|---|---|---|---|
| Thiết kế widget | Cài đặt widget › card **Thiết kế widget** | iframe `WIDGET_URL/?shop=…&preview=<token>`, cao 720 px: launcher + panel web, áp thiết kế chưa lưu | Không: không `mode=app`, không khung điện thoại |
| Hội thoại | Cài đặt AI › **Xem trước hội thoại** | Khung chat gõ thử với agent, pipeline thật, không cảnh báo nhân viên | Chỉ đúng nội dung |
| Trình mô phỏng dev | `widget/webview-test.html` | Khung 390×780, cầu nối native giả, gửi identify, đổi ngôn ngữ, logout | Có, nhưng ngoài console, không auth, không áp thiết kế chưa lưu |

### 2.7 Khoảng trống

| # | Khoảng trống | Hệ quả nếu bỏ qua |
|---|---|---|
| G1 | `ShopTalkUser` chỉ có `userId`, `hash`, hồ sơ; không có `attributes` hay `claims` | Console không biết khách sạn, vai trò; định tuyến vùng (D3) không chạy từ app |
| G2 | SDK cache JSON identify và gửi lại mỗi lần widget reload | Với hợp đồng có `iat`, chữ ký cũ bị từ chối và phiên bị đưa về khách |
| G3 | SDK bỏ qua `identity-expired`, `ivy:open-url`, `ivy:unread` | Hết hạn không ai ký lại; link mở Hotel Admin không mở; không có badge |
| G4 | Không có `access` key | Tenant bật `widget_access` thì app bị chặn |
| G5 | Không có header native, không có lệnh mở cài đặt hay kết thúc hội thoại từ app | Hai header chồng nhau khi app có toolbar |
| G6 | Không có lệnh ngữ cảnh | App không mở được chat "từ màn đặt phòng #…" |
| G7 | Không có camera, không đa chọn (Q4 cũ loại camera) | Lễ tân không chụp được sự cố tại quầy |
| G8 | Không có màn lỗi khi WebView không tải được | Màn trắng (FR-K10 chưa làm) |
| G9 | Không ép sáng; widget không có dark mode | App dark thì WebView tự tối thuật toán |
| G10 | Chỉ có Fragment | App Compose phải tự bọc |
| G11 | Toolchain Kotlin 2.0.20, `kotlinOptions` đã deprecated | Nhúng dạng source vào app 2.2.0 thì cảnh báo |
| G12 | Không có push nền (chỉ expo-push, web-push) | Nhân viên trả lời khi app đóng thì không ai biết |
| G13 | Hội thoại gắn session, session gắn thiết bị | Web và app không nối tiếp |
| C1 | Console không có khu vực app | Admin không thấy, không chỉnh được địa chỉ, agent theo điểm vào, vỏ native |
| C2 | Console không có preview app | Admin phải dùng trang dev ngoài console |
| C3 | Giao diện không tách theo bề mặt | Đổi font hay màu cho app thì web đổi theo |

### 2.8 Đã giải được bằng cấu hình có sẵn

- `consent_source = host_terms`: người dùng đã ký không thấy popup đồng ý trong app (D9).
- `widget_tabs = ['chat']`: thanh tab tự ẩn.
- `quickReplyStyle = card`: menu kịch bản thành thẻ có icon.
- Agent `hotel-admin` đã có lời chào và 4 nút nhanh (Xem đặt phòng hôm nay, Cách nhận phòng cho khách, Khiếu nại
  đặt phòng, Hỏi về đối soát) và chip "Gặp nhân viên hỗ trợ".
- Ngôn ngữ trả lời theo `locale` của widget, mặc định `vi`.

## 3. TO-BE

### 3.1 Năm nguyên tắc làm chuẩn

1. **Một widget cho mọi kênh.** App chỉ bọc WebView; mọi sửa trên web tới app ngay.
2. **Danh tính là một gói ký sẵn, SDK chỉ chuyển tiếp.** Backend Go2Joy trả nguyên object `user` cho identify
   (`userId`, `hash`, cộng `attributes` hoặc `claims`); SDK gửi nguyên văn. SDK không biết chuỗi ký, không giữ secret.
3. **Ký mới mỗi lần cần, không cache.** SDK gọi `identityProvider` khi widget sẵn sàng, khi reload, khi
   `identity-expired`.
4. **Cấu hình ở server, app chỉ giữ địa chỉ.** App giữ `widgetUrl`, `shop`, `agent`, tùy chọn vỏ native; nên đặt
   trong remote config của app để đổi không cần phát hành.
5. **Không bao giờ màn trắng.** Lỗi tải, mất mạng, từ chối chữ ký đều có trạng thái nhìn thấy và đường thoát.

### 3.2 Kiến trúc và luồng

```
App Go2Joy (Kotlin 2.2.0)
  ├─ Màn "Hỗ trợ Go2Joy" ──► ShopTalkChatFragment / ShopTalkChat() (Compose)
  │     ├─ WebView: https://<origin SharpTalk>/widget/?embed=1&mode=app&shop=https%3A%2F%2Fwww.go2joy.vn&agent=hotel-admin&chrome=native
  │     │     origin: staging shoptalk.amoeba.site hôm nay; self-hosted sharptalk.go2joy.vn khi M3 xong (đề xuất, DNS chưa có)
  │     ├─ bridge ShopTalkAndroid ◄──► window.__shoptalkHost
  │     └─ identityProvider ──► Backend Go2Joy GET /api/sharptalk/identity (ví dụ; auth bằng token app)
  │                                └─ trả { userId, hash, attributes, name }  (hoặc claims sau hợp nhất)
  └─ Màn đặt phòng, đối soát… ──► chat.setContext(screen, ref, label)

SharpTalk
  ├─ POST /public/session/ensure (shop, agent, access)  → cấu hình tenant + agent
  ├─ POST /public/embed/identify (user gói ký)          → xác minh, thuộc tính, consent host_terms
  └─ POST /public/chat/message (+ context)              → AI hoặc nhân viên; console thấy ngữ cảnh

Console (admin Go2Joy)
  ├─ hôm nay: Nhúng & SDK, Nguồn đồng ý, Cài đặt AI, Theme/Tab/Hành vi, Kết nối nhân viên
  └─ đề xuất: card Thiết kế widget có nút Web | App; tab "Ứng dụng di động" (§3.4)
```

### 3.3 Yêu cầu chức năng, SDK, widget, API

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-M01 | `ShopTalkIdentity.fromJson(raw)` nhận nguyên gói từ backend; `ShopTalkIdentity.of(...)` cho app gõ tay. SDK gửi nguyên văn trong `ivy:identify.user` | P0 |
| FR-M02 | `ShopTalkIdentityProvider` (suspend, null = khách). SDK gọi khi ready, reload, `identity-expired`; lỗi provider phát `onError` và tiếp tục như khách | P0 |
| FR-M03 | Listener thêm `onIdentityExpired`, `onOpenUrl(url): Boolean`, `onUnread(count)`, `onError(ShopTalkError)` | P0 |
| FR-M04 | `ShopTalkConfig` thêm `accessKey`, `header` (WIDGET hoặc NATIVE), `startTab`, `attachments(camera, multiple)`, `errorHotline`, `allowInsecureUrl` chỉ debug | P0 |
| FR-M05 | `header = NATIVE`: widget nhận `chrome=native`, ẩn header riêng; app cung cấp back, tiêu đề, menu gọi lệnh `locale`, `settings`, `end` | P0 |
| FR-M06 | `chat.setContext(ShopTalkContext(screen, ref?, label?, prefill?))`: chip ngữ cảnh trên ô nhập, điền sẵn; gửi `context` cùng tin kế tiếp; server ghi dòng hệ thống và đưa vào prompt | P1 |
| FR-M07 | Đính kèm: chooser Chụp ảnh, Thư viện, Tệp; đa chọn; FileProvider trong SDK; không cần quyền CAMERA | P1 |
| FR-M08 | Màn lỗi native khi main frame lỗi hoặc quá 15 s: thông điệp, Thử lại, hotline tùy chọn | P0 |
| FR-M09 | Ép sáng WebView cho tới khi widget có dark mode | P1 |
| FR-M10 | Module `:shoptalk-compose` với `@Composable ShopTalkChat(...)` dùng `AndroidFragment` | P1 |
| FR-M11 | Toolchain Kotlin 2.2.0, `compilerOptions.jvmTarget = JVM_17`; AAR vẫn chỉ phụ thuộc androidx cơ bản; tùy chọn nhúng source module | P0 |
| FR-M12 | Back của Android = `onCloseRequest`; khi Preferences đang mở thì back đóng Preferences trước (lệnh `back`) | P1 |
| FR-M13 | Sample app mô phỏng app Go2Joy: entry, màn chat, vào từ đặt phòng, lỗi mạng | P0 |
| FR-M14 | Widget: tham số `chrome=native`; lệnh `settings`, `end`, `back`, `context`; nhận và bỏ qua `surface=app` | P0 |
| FR-M15 | API: `POST /public/chat/message` nhận `context` tùy chọn; ghi dòng SYSTEM khi ngữ cảnh đổi; prompt có ghi chú ngữ cảnh. Không bảng mới | P1 |

### 3.4 Yêu cầu chức năng, console cho admin

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-C01 | Card **Thiết kế widget** có nút chuyển **Web \| App**. Chế độ App tải iframe `?mode=app&agent=<agent chọn>&preview=<token>` trong khung điện thoại 390×780, kèm "Gửi identify thử" và "Đổi ngôn ngữ" như trang dev; khi SDK 0.2 có `chrome=native` thì vẽ thêm thanh header giả của app | P1 |
| FR-C02 | Tab **Ứng dụng di động** trong Cài đặt tenant, card **Giao diện app**: font, cỡ chữ, kiểu menu, màu riêng cho app, ghi đè theme web; lưu trong `widget_theme.design.surfaces.app`; widget áp khi `surface=app` | P2 (Q6) |
| FR-C03 | Card **Điểm vào**: bảng "màn hình trong app → agent"; SDK đọc bảng này lúc mở thay vì hard-code mã agent | P2 (Q6) |
| FR-C04 | Card **Phiên bản SDK**: SDK tối thiểu, phiên bản widget đang chạy, cảnh báo lệch | P2 |
| FR-C05 | Card **Kiểm thử**: nút mở trình mô phỏng app với đúng `shop` và agent của tenant | P2 |

Khi có FR-C02 đến C05, admin cấu hình app hoàn toàn trên trình duyệt và app chỉ còn giữ địa chỉ widget.

### 3.5 Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| NFR-M01 | Secret không bao giờ vào app; SDK không log userId, hash, nội dung, URI tệp |
| NFR-M02 | Chỉ `https` ngoài debug; bridge chỉ hoạt động khi URL chính thuộc `widgetUrl` |
| NFR-M03 | Lần mở đầu trên 4G tới "sẵn sàng gõ" dưới 3 s với font hệ thống |
| NFR-M04 | Cỡ chữ hệ thống 130 % không vỡ bố cục; xoay ngang và khôi phục sau process death giữ hội thoại |
| NFR-M05 | AAR mới dùng được với widget cũ và ngược lại: lệnh lạ bị bỏ qua ở cả hai phía |
| NFR-M06 | Kotlin 2.2.0 tiêu thụ được AAR build bằng Kotlin ≤ 2.2.0; stdlib lấy từ app |

## 4. Khoảng cách và độ khả thi

| Hạng mục | Khoảng trống | Khả thi | Công | Điều kiện / rủi ro |
|---|---|---|---|---|
| Nhúng widget vào app Kotlin 2.2.0 bằng AAR | — | **Cao** | 0 ngày để chạy thử | AAR 2.0.20 dùng được với app 2.2.0; chưa kiểm API 24 |
| Admin cấu hình nội dung, agent, theme, consent; app nhận ngay | — | **Cao** | 0 | Giao diện chung web và app |
| Danh tính ký từ backend Go2Joy, SDK chuyển tiếp | G1 | **Cao** | SDK 1 ngày, Go2Joy 0,5 đến 1 ngày | Chốt hợp đồng trước khi Go2Joy viết endpoint |
| Ký lại khi hết hạn, bắt đủ sự kiện, màn lỗi, accessKey | G2, G3, G4, G8 | **Cao** | 1,5 ngày | — |
| Header native, lệnh settings / end / back | G5 | **Cao** | 1 ngày | Không SQL |
| Vào chat theo ngữ cảnh | G6 | **Cao** | 1 ngày | Chạy lại golden set sau khi prompt có ngữ cảnh |
| Camera, đa chọn | G7 | **Cao** | 0,5 ngày | Ẩn mục chụp khi máy không có app camera |
| Compose wrapper, toolchain 2.2.0 | G10, G11 | **Cao** | 1 ngày | Go2Joy chưa nói app là Compose hay XML |
| Preview App trong console | C2 | **Cao** | 0,5 ngày | Không thay kiểm trên máy thật |
| Tab Ứng dụng di động: giao diện app, điểm vào → agent, phiên bản SDK, kiểm thử | C1, C3 | **Trung bình** | 3 đến 4 ngày | Cần cột hoặc JSON mới và API; làm sau pilot |
| Badge chưa đọc trên nút vào app | G3 một phần | **Trung bình** | 1 ngày | Cần API đếm theo session và SDK lộ token |
| Dark mode widget | G9 | **Trung bình** | 2 đến 3 ngày | Ảnh hưởng cả web |
| Push khi app đóng | G12 | **Thấp trong phạm vi này** | 3 đến 5 ngày + Go2Joy | Cần FCM của Go2Joy hoặc webhook; đã loại ở Q5 cũ |
| Nối tiếp hội thoại web và app | G13 | **Thấp** | Chưa ước | Đổi mô hình dữ liệu, giai đoạn 2 |
| iOS | — | **Trung bình** | 2 ngày | Chỉ khi Go2Joy yêu cầu |

Tổng SharpTalk cho các mục "Cao": khoảng **6,5 ngày**. Go2Joy: endpoint ký 0,5 đến 1 ngày, nhúng 0,5 đến 1 ngày,
UAT 0,5 ngày. Ba điều kiện bên ngoài quyết định tiến độ hơn kỹ thuật: hợp nhất hợp đồng identify; Go2Joy trả lời
về app; lịch phát hành app của Go2Joy.

## 5. Luồng

### 5.1 Người dùng cuối (lễ tân, quản lý)

| ID | Luồng | Kết quả mong đợi |
|---|---|---|
| U1 | Mở "Hỗ trợ Go2Joy" lần đầu | Backend ký, widget mở trong dưới 3 s, lời chào + 4 nút nhanh, không popup đồng ý, chỉ dòng thông báo AI |
| U2 | Quay lại hôm sau | Provider ký lại; cùng người cùng khách sạn thì tiếp hội thoại cũ |
| U3 | Lễ tân khác đăng nhập app trên cùng máy | Provider ký người mới; server thay thuộc tính (main) hoặc tách phiên (nhánh PR); luồng cũ không hiện cho người mới |
| U4 | Bấm "Hỏi về đặt phòng này" trong màn đặt phòng | Chat mở với chip ngữ cảnh, ô nhập điền sẵn; console thấy "Mở từ Đặt phòng #…"; AI trả lời đúng ngữ cảnh |
| U5 | Gửi ảnh sự cố | Chooser Chụp ảnh / Thư viện / Tệp; tiến trình tải; AI hoặc nhân viên nhận tệp |
| U6 | Mất mạng khi mở | Màn lỗi native, Thử lại; có mạng lại thì vào thẳng hội thoại cũ |
| U7 | Chữ ký bị từ chối | Vẫn chat như khách; dải cảnh báo + Thử lại; `onIdentified(false)` |
| U8 | AI không đủ căn cứ | Chip "Gặp nhân viên hỗ trợ"; chip đội; "nhân viên đang soạn"; trả lời tới khi màn còn mở |
| U9 | Logout app | `chat.logout()`; xóa WebView storage chỉ khi xóa tài khoản |
| U10 | Khách sạn không trong pilot (chỉ nhánh PR) | Thông báo pilot toàn màn, X đóng màn app |

### 5.2 Admin Go2Joy

| ID | Luồng | Hôm nay | Sau FR-C |
|---|---|---|---|
| A1 | Phát hành secret, giao dev backend | Card Nhúng & SDK | Như cũ |
| A2 | Bật đồng ý theo điều khoản | Nguồn đồng ý | Như cũ |
| A3 | Chỉnh nội dung agent cho app | Cài đặt AI, nhưng mã agent nằm trong app | Bảng Điểm vào → agent, app đọc lúc mở |
| A4 | Chỉnh giao diện cho app | Theme chung với web | Card Giao diện app, ghi đè theo bề mặt |
| A5 | Xem trước app | Trang dev ngoài console | Nút Web \| App trong card Thiết kế widget |
| A6 | Kiểm tra phiên bản SDK app đang dùng | Không có | Card Phiên bản SDK |

## 6. Ràng buộc và rủi ro

- **Hai hợp đồng identify** (§2.4). `attributes` đã chạy trên production; `claims` v2 chưa hợp nhất. Go2Joy nên viết
  endpoint trả nguyên gói do SharpTalk quy định, đổi nội dung gói khi hợp nhất.
- Polling 15 đến 30 s dừng khi app xuống nền; không có push nền trong phạm vi này.
- WebView không có parent origin nên `embed_origins` và CSP không có tác dụng; an toàn dựa vào HMAC, pilot, rate limit
  20 lần/phút.
- Font tùy chỉnh 3 MB là cấu hình tenant chung với web cho tới khi có FR-C02.
- `sharptalk.go2joy.vn` chưa có DNS; pilot app chạy trên staging hoặc production Hàn Quốc trước, đổi `widgetUrl` khi
  M3 xong. Đặt `widgetUrl` trong remote config để không phải phát hành lại.
- App Partner iOS 8.1.0 chưa có SDK; chỉ có hướng dẫn WKWebView.
- Kotlin 2.2.0: `kotlinOptions` deprecated từ 2.0, thay bằng `compilerOptions`; kiểm bảng tương thích KGP khi nâng.

## 7. Quyết định cần chốt

| ID | Quyết định | Đề xuất |
|---|---|---|
| Q1 | Hợp đồng identify cho Go2Joy | **Giai đoạn 1 dùng `attributes`** vì đã chạy trên production; endpoint ký của Go2Joy viết theo guide embed §3.4. Khi hợp nhất nhánh PR, bổ sung `iat`, hết hạn, tách phiên mà không đổi tên khóa. SDK không ảnh hưởng |
| Q2 | Header: NATIVE hay WIDGET cho app Go2Joy | NATIVE khi màn chat nằm dưới toolbar app; WIDGET khi mở Activity toàn màn |
| Q3 | Camera và đa chọn | Bật |
| Q4 | Dark mode | Ép sáng ở 0.2; dark mode widget là REQ riêng |
| Q5 | Badge chưa đọc trên nút vào | Ngoài 0.2 |
| Q6 | Tab Ứng dụng di động trên console (FR-C02 đến C05) | Làm sau pilot, 3 đến 4 ngày; preview App (FR-C01) làm ngay trong 0.2 |
| Q7 | Push nền | Ngoài phạm vi, REQ riêng khi Go2Joy chốt FCM |
| Q8 | Phân phối | AAR file; thêm tùy chọn source module |
| Q9 | Compose | Module riêng `:shoptalk-compose` |
| Q10 | iOS | Ngoài phạm vi |
| Q11 | Nơi giữ `widgetUrl` và mã agent trong app | Remote config của app, không hard-code |

## 8. Bước tiếp

Duyệt REQ và PLN-261015-Go2Joy-Kotlin-SDK-0.2 v1.1, chốt Q1 với nhóm đang làm PLN-261015 trên `main`, gửi Go2Joy
6 câu hỏi về app (Compose hay XML, minSdk, AGP, backend cho app, entry point, kênh nhận AAR), rồi mới triển khai S1.

## Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-10-15 | Phân tích SDK, 13 khoảng trống, FR-M01…M15, Q1…Q10 |
| 1.1 | 2026-10-15 | Gom buổi thảo luận: §2.2 bản chất AAR, §2.5 admin console, §2.6 preview, §3.4 FR-C, §4 ma trận khả thi, §5.2 luồng admin, Q1 cập nhật theo production, Q11; rebase trên `main` e0610355 |
