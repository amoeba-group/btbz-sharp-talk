# REQ-261015-Go2Joy-Kotlin-App-Widget

> **Yêu cầu.** Nhúng widget SharpTalk vào ứng dụng Android của Go2Joy (Kotlin 2.2.0) bằng SDK Kotlin,
> cấu hình từ console trên trình duyệt như đã làm cho Hotel Admin web, với concept UX phù hợp mobile.
> **Nhánh.** `feature/go2joy-kotlin-app-widget` (từ `main` `7992e71d`, 2026-10-15).
> **Trạng thái.** Phân tích. Kế hoạch triển khai: `docs/plan/PLN-261015-Go2Joy-Kotlin-SDK-0.2.md` (chờ duyệt).
> **Kế thừa.** `REQ-260826-Go2Joy-Kotlin-Mobile-SDK` (FR-K1…K12, quyết định D1…D7), `PLN-260827-Kotlin-Android-SDK`
> (Q1…Q5), `RPT-260829-Kotlin-Android-SDK`, `TCR-260828-Kotlin-Android-SDK`, `FIX-260828-Widget-AppMode-Defects`,
> `PLN-261015-SharpTalk-for-Go2Joy-Project-Plan` (D2 thuộc tính ký, D9 đồng ý theo điều khoản host),
> `PLN-261001-Go2Joy-Guest-Login-Gate` v1.1 (claims v2, trên nhánh PR `feature/go2joy-stage1-complete`),
> `docs/guide/모바일SDK연동가이드_Mobile-SDK.ko.md`, `docs/guide/임베드SDK설치가이드_Embed-SDK.ko.md`.

## 1. Bối cảnh và mục tiêu

- Hotel Admin web của Go2Joy đã nhúng được widget qua `embed.js`; nội dung, agent, theme, menu kịch bản, danh tính
  đều cấu hình từ console. Go2Joy nay muốn kênh thứ hai: **ứng dụng Android Go2Joy Partner**, viết bằng Kotlin 2.2.0,
  cho lễ tân và quản lý khách sạn dùng tại quầy.
- Tenant go2joy đang có **6 AI agent** (Hotel Partner "Joydesk" mặc định, Hotel Admin, Default, Landing Guest,
  Admin Staff, Ads Partner). Giai đoạn 2 theo PLN-261015 §11.1 sẽ thêm **agent theo từng khách sạn** cho khách đặt
  phòng trên app người dùng. SDK Kotlin vì thế phải là **một SDK dùng cho nhiều điểm vào, nhiều agent**, không phải
  một bản ghép riêng cho một màn hình.
- Mục tiêu của tài liệu này: chốt **chuẩn tích hợp Kotlin** (API SDK, hợp đồng bridge, cấu hình, UX mobile) để mọi
  app của Go2Joy, hiện tại và giai đoạn 2, nhúng cùng một cách và cấu hình cùng một chỗ.

## 2. AS-IS

### 2.1 Đã có trên `main`

| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| `sdk/android` 0.1.0 | AAR, `ShopTalkChatFragment` bọc WebView, bridge `ShopTalkAndroid`, giao thức JSON, file chooser, bàn phím, khôi phục state, hàng đợi 20 lệnh, tự gửi lại identify khi reload | Kotlin 2.0.20, AGP 8.5.2, Gradle 8.7, minSdk 24, compileSdk 35, JVM 17, phụ thuộc chỉ core-ktx + fragment-ktx |
| Widget app mode | `?embed=1&mode=app`: không launcher, panel mở sẵn, toàn màn hình, X gửi `ivy:close-request`, thanh tab tự ẩn khi còn một tab, safe-area đáy | `host-bridge.ts`, `WidgetPanel.tsx` |
| Bridge app → widget | `ivy:identify {user}`, `ivy:command` open/close/toggle/locale/logout | `useEmbedCommands.ts` |
| Bridge widget → app | `ivy:ready`, `ivy:close-request`, `ivy:event identified`, `ivy:open-url`, `ivy:unread` | SDK 0.1.0 chỉ bắt ba cái đầu |
| Identify | v1 `HMAC(userId)`; **D2**: `attributes` {hotel_id, hotel_name, region, province, role} ký theo chuỗi `userId\nkey=value…` | `embed/identity-attributes.ts`, lưu `sessions.identity_attributes` |
| Đồng ý | **D9** `tenants.consent_source = host_terms`: người dùng đã ký được ghi nhận đồng ý, không hiện banner; vẫn hiện dòng thông báo AI | SQL `261015-tenant-consent-source.sql` |
| Cấu hình widget | Theo tenant: theme, design, tabs, copy, login mode, embed origins, widget access. Theo agent: persona, greeting, rules, menu kịch bản, phạm vi tri thức, guest policy | Xem §2.2 |
| Tài liệu | Guide mobile (ko) §1 đến §8, guide embed §3.4 ký `attributes`, trình mô phỏng `widget/webview-test.html` | |
| Kiểm chứng | Galaxy S21 Android 15 ngày 28/08: 13/13 unit, 8 hạng mục trên máy, 5 lỗi widget đã sửa; chưa kiểm link ngoài trên máy, chưa kiểm API 24 | TCR-260828 |

### 2.2 Cấu hình: cái gì theo agent, cái gì theo tenant

| Nhóm | Theo agent (`ai_agents`, chọn bằng `?agent=`) | Theo tenant (chung mọi agent, mọi bề mặt) |
|---|---|---|
| Nội dung | persona, lời chào đa ngữ, rules, menu kịch bản và chip trả lời, phạm vi tri thức, thông báo riêng tư, guest policy | copy widget (tên hiển thị, lời chào lần đầu) |
| Giao diện | — | theme (màu, header, logo, launcher), design (font, cỡ chữ, radius, panel, kiểu menu, customCss), tabs và vị trí tab |
| Vận hành | định tuyến đội theo agent | pilot, consent source, login mode, embed origins, widget access, notification channels |

Hệ quả: app có thể ghim agent khác nhau cho từng điểm vào, nhưng **không thể có giao diện riêng cho app khác với
web**. Đây là khoảng trống kiến trúc duy nhất không giải được bằng cấu hình hiện có (xem Q6).

### 2.3 Hai hợp đồng identify đang tồn tại song song

| | `main` (PLN-261015 D2, PR #637, 15/10) | Nhánh PR `feature/go2joy-stage1-complete` (PLN-261001 H1) |
|---|---|---|
| Trường | `attributes: {hotel_id, hotel_name, region, province, role}` | `claims: {hotel_sn, role, iat, province?, hotel_name?, hotel_code?}` |
| Chuỗi ký | `userId\nkey=value` theo thứ tự chữ cái | `userId\|hotelSn\|role\|iat[\|province]` |
| Hết hạn | không | `iat` ±600 s khi ký, danh tính hết hạn sau 8 h, sự kiện `identity-expired` |
| Đổi người, đổi khách sạn | thay thuộc tính trên cùng session | tách session mới, logout phía máy chủ, chống phát lại |
| Pilot theo khách sạn | không | có (`tenant_pilot_hotels`) |
| Cột | `sessions.identity_attributes` | `sessions.identity_claims` |

Hai nhánh chưa hợp nhất. SDK Kotlin **không được phụ thuộc vào bên nào thắng**: app phát hành một lần, hợp đồng
có thể đổi sau. Yêu cầu này quyết định thiết kế ở §3.1.

### 2.4 Khoảng trống

| # | Khoảng trống | Hệ quả nếu bỏ qua |
|---|---|---|
| G1 | `ShopTalkUser` chỉ có `userId`, `hash`, hồ sơ; không có `attributes` hay `claims` | Console không biết khách sạn, vai trò; định tuyến theo vùng (D3) và pilot không chạy |
| G2 | SDK cache JSON identify và gửi lại mỗi lần widget reload | Với hợp đồng có `iat`, chữ ký cũ bị từ chối và phiên đang đăng nhập bị đưa về khách (fail-closed) |
| G3 | SDK bỏ qua `identity-expired`, `ivy:open-url`, `ivy:unread` | Hết hạn không ai ký lại; link mở Hotel Admin không mở; không có badge |
| G4 | Không có `access` key | Tenant bật `widget_access` thì app bị chặn |
| G5 | Không có header native, không có lệnh mở cài đặt hay kết thúc hội thoại từ app | App có toolbar riêng thì hai header chồng nhau |
| G6 | Không có lệnh ngữ cảnh | App không thể mở chat "từ màn đặt phòng #…" |
| G7 | Không có camera, không đa chọn khi đính kèm (Q4 cũ loại trừ camera) | Lễ tân không chụp được sự cố tại quầy |
| G8 | Không có màn lỗi khi WebView không tải được | Màn trắng, không có nút thử lại (FR-K10 chưa làm) |
| G9 | Không ép sáng; widget không có dark mode | App dark thì WebView tự tối thuật toán, lệch màu thương hiệu |
| G10 | Chỉ có Fragment, không có wrapper Compose | App Compose phải tự bọc |
| G11 | Toolchain Kotlin 2.0.20, `kotlinOptions` đã deprecated | Nhúng dạng source vào app Kotlin 2.2.0 thì cảnh báo hoặc lệch cấu hình |
| G12 | Không có push nền (expo-push, web-push, chưa có FCM) | Nhân viên trả lời khi app đóng thì không ai biết |
| G13 | Hội thoại gắn session, session gắn thiết bị | Web và app không nối tiếp một luồng |

### 2.5 Những gì không cần làm nhờ cấu hình có sẵn

- Go2Joy bật `consent_source = host_terms` thì người dùng đã ký không thấy popup đồng ý trong app (D9).
- Đặt `widget_tabs = ['chat']` thì thanh tab tự ẩn.
- Đặt `quickReplyStyle = card` thì menu kịch bản thành thẻ có icon, hợp ngón tay.
- Agent `Hotel Partner` đã có 4 nút nhanh (Xem đặt phòng hôm nay, Cách nhận phòng cho khách, Khiếu nại đặt phòng,
  Hỏi về đối soát) và chip "Gặp nhân viên hỗ trợ".

## 3. TO-BE

### 3.1 Năm nguyên tắc làm chuẩn

1. **Một widget cho mọi kênh.** App chỉ bọc WebView; mọi sửa trên web tới app ngay, không phát hành lại.
2. **Danh tính là một gói ký sẵn, SDK chỉ chuyển tiếp.** Backend Go2Joy trả về nguyên object `user` cho identify
   (`userId`, `hash`, cộng `attributes` hoặc `claims` tùy hợp đồng); SDK gửi nguyên văn qua bridge. SDK không biết
   chuỗi ký, không giữ secret, không giả định hợp đồng.
3. **Ký mới mỗi lần cần, không cache.** SDK gọi `identityProvider` khi widget sẵn sàng, khi reload, khi
   `identity-expired`; không gửi lại gói cũ.
4. **Cấu hình ở server, app chỉ giữ địa chỉ.** App giữ `widgetUrl`, `shop`, `agent`, tùy chọn UX bản địa; mọi thứ
   khác chỉnh từ console và áp dụng ngay.
5. **Không bao giờ màn trắng.** Lỗi tải, mất mạng, từ chối chữ ký đều có trạng thái nhìn thấy được và đường thoát.

### 3.2 Kiến trúc và luồng

```
App Go2Joy Partner (Kotlin 2.2.0)
  ├─ Màn "Hỗ trợ Go2Joy" ──► ShopTalkChatFragment / ShopTalkChat() (Compose)
  │                             ├─ WebView: https://sharptalk.go2joy.vn/widget/?embed=1&mode=app&shop=…&agent=hotel-partner&chrome=native
  │                             ├─ bridge ShopTalkAndroid  ◄──►  window.__shoptalkHost
  │                             └─ identityProvider ──► Backend Go2Joy GET /sharptalk/identity (auth token app)
  │                                                        └─ trả { userId, hash, attributes|claims, name }
  └─ Màn đặt phòng, đối soát… ──► chat.setContext(screen, ref, label)

SharpTalk (self-hosted sharptalk.go2joy.vn, PLN-261015 §4.2)
  ├─ POST /public/session/ensure (shop, agent, access)  → tenant config: theme, tabs, copy, agent menu
  ├─ POST /public/embed/identify (user gói ký)          → xác minh, thuộc tính, consent host_terms
  └─ POST /public/chat/message (+ context)              → AI hoặc chuyển nhân viên; console thấy ngữ cảnh
```

Luồng mở màn: app gọi backend lấy gói ký mới, mở Fragment, widget `ivy:ready`, SDK gửi identify, widget trả
`identified ok`. Quay lại sau nhiều giờ hoặc đổi tài khoản: provider ký lại, server quyết định gắn tiếp hay mở phiên
mới. Logout app: `chat.logout()` rồi xóa WebView storage nếu là xóa tài khoản (D5 cũ).

### 3.3 Yêu cầu chức năng

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-M01 | `ShopTalkIdentity.fromJson(raw)` nhận nguyên gói từ backend; `ShopTalkIdentity.of(userId, hash, attributes?, claims?, name?, email?, phone?)` cho app muốn gõ tay. SDK gửi nguyên văn trong `ivy:identify.user` | P0 |
| FR-M02 | `ShopTalkIdentityProvider` (suspend, trả null = khách). SDK gọi khi ready, reload, `identity-expired`; lỗi provider phát `onError(IDENTITY_PROVIDER_FAILED)` và tiếp tục như khách | P0 |
| FR-M03 | Listener thêm `onIdentityExpired`, `onOpenUrl(url): Boolean` (mặc định SDK mở `ACTION_VIEW`), `onUnread(count)`, `onError(ShopTalkError)` | P0 |
| FR-M04 | `ShopTalkConfig` thêm `accessKey`, `header` (WIDGET hoặc NATIVE), `startTab`, `attachments(camera, multiple)`, `allowInsecureUrl` chỉ debug | P0 |
| FR-M05 | `header = NATIVE`: widget nhận `chrome=native`, ẩn header riêng; app cung cấp back, tiêu đề, menu "Ngôn ngữ, Quyền riêng tư, Kết thúc hội thoại" qua lệnh `locale`, `settings`, `end` | P0 |
| FR-M06 | `chat.setContext(ShopTalkContext(screen, ref?, label?, prefill?))`: widget hiện chip ngữ cảnh trên ô nhập, điền sẵn nếu có; gửi `context` cùng tin nhắn kế tiếp; server ghi một dòng hệ thống trong hội thoại và đưa vào prompt | P1 |
| FR-M07 | Đính kèm: chooser gồm Chụp ảnh, Thư viện, Tệp; đa chọn; FileProvider trong SDK; không cần quyền CAMERA khi dùng intent chụp | P1 |
| FR-M08 | Màn lỗi native khi main frame lỗi hoặc quá 15 s: thông điệp, nút Thử lại, tùy chọn hotline từ config | P0 |
| FR-M09 | Ép sáng WebView (`forceDark` OFF dưới API 33, `isAlgorithmicDarkeningAllowed=false` từ API 33) cho tới khi widget có dark mode | P1 |
| FR-M10 | Module `:shoptalk-compose` với `@Composable ShopTalkChat(config, identityProvider, listener)` dùng `AndroidFragment` (fragment-compose 1.8) | P1 |
| FR-M11 | Toolchain Kotlin 2.2.0, `compilerOptions.jvmTarget = JVM_17`, AGP và Gradle trong bảng tương thích KGP 2.2.0; AAR vẫn chỉ phụ thuộc androidx cơ bản; tùy chọn nhúng source module | P0 |
| FR-M12 | Back của Android = `onCloseRequest` (host đóng màn); khi Preferences đang mở thì back đóng Preferences trước (lệnh `back`) | P1 |
| FR-M13 | Sample app mô phỏng Partner app: entry, màn chat, vào từ đặt phòng, lỗi mạng; dùng cho TCR trên máy thật | P0 |
| FR-M14 | Widget: tham số `chrome=native`; lệnh `settings`, `end`, `back`, `context`; sự kiện giữ nguyên; `surface=app` được nhận và bỏ qua (dành cho Q6) | P0 |
| FR-M15 | API: `POST /public/chat/message` nhận `context` tùy chọn; ghi dòng SYSTEM khi ngữ cảnh đổi; prompt có ghi chú ngữ cảnh. Không thêm bảng, không SQL | P1 |

### 3.4 Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| NFR-M01 | Secret không bao giờ vào app; SDK không log userId, hash, nội dung, URI tệp (giữ REQ-260826 §3.3) |
| NFR-M02 | Chỉ `https` ngoài debug; bridge chỉ hoạt động khi URL chính thuộc `widgetUrl` |
| NFR-M03 | Lần mở đầu trên 4G tới "sẵn sàng gõ" dưới 3 s với font hệ thống; font tùy chỉnh 3 MB là cấu hình tenant, tính riêng |
| NFR-M04 | Cỡ chữ hệ thống 130 % không vỡ bố cục; xoay ngang và khôi phục sau process death giữ hội thoại |
| NFR-M05 | AAR mới dùng được với widget cũ và ngược lại: lệnh lạ bị bỏ qua ở cả hai phía |
| NFR-M06 | Kotlin 2.2.0 tiêu thụ được AAR build bằng Kotlin ≤ 2.2.0; stdlib lấy từ app |

## 4. Phân tích khoảng cách

| Khoảng trống | TO-BE | Việc | Công |
|---|---|---|---|
| G1, G2, G3 | FR-M01, M02, M03 | SDK protocol, provider, listener, test JVM | 1 ngày |
| G4, G5, G12 lệnh | FR-M04, M05, M14 | SDK config; widget `chrome`, lệnh mới | 1 ngày |
| G6 | FR-M06, M15 | Widget chip ngữ cảnh; API message `context`; console hiện dòng hệ thống (có sẵn) | 1 ngày |
| G7, G8, G9, G12 back | FR-M07, M08, M09, M12 | SDK native: chooser camera, error view, ép sáng, back | 1 ngày |
| G10, G11 | FR-M10, M11 | Toolchain, module compose, sample | 1 ngày |
| Kiểm chứng, tài liệu | FR-M13, TCR | Máy thật API 35 và emulator API 24; guide vi + ko; release notes | 1 ngày |
| G12 push, G13 nối tiếp | Ngoài phạm vi | REQ riêng (giữ quyết định Q5 cũ) | — |

Tổng SharpTalk khoảng **6 ngày**. Go2Joy: endpoint ký 0,5 đến 1 ngày, nhúng 0,5 đến 1 ngày, UAT 0,5 ngày.

## 5. Luồng người dùng

| ID | Luồng | Kết quả mong đợi |
|---|---|---|
| U1 | Lễ tân mở "Hỗ trợ Go2Joy" lần đầu | Backend ký, widget mở trong dưới 3 s, lời chào + 4 nút nhanh, không popup đồng ý (host_terms), chỉ dòng thông báo AI |
| U2 | Quay lại hôm sau | Provider ký lại; cùng người cùng khách sạn thì tiếp hội thoại cũ; không hiện lại lời chào lần đầu |
| U3 | Lễ tân khác đăng nhập app trên cùng máy | Provider ký người mới; server tách phiên (nhánh PR) hoặc thay thuộc tính (main); luồng cũ không hiện cho người mới |
| U4 | Bấm "Hỏi về đặt phòng này" trong màn đặt phòng #G2J-8841 | Chat mở với chip ngữ cảnh, ô nhập điền sẵn; console thấy "Mở từ Đặt phòng #G2J-8841"; AI trả lời đúng ngữ cảnh |
| U5 | Gửi ảnh sự cố | Chooser Chụp ảnh / Thư viện / Tệp; tiến trình tải; AI hoặc nhân viên nhận tệp |
| U6 | Mất mạng khi mở | Màn lỗi native, Thử lại; có mạng lại thì vào thẳng hội thoại cũ |
| U7 | Chữ ký bị từ chối (sai secret, lệch giờ) | Vẫn chat được như khách; dải cảnh báo "Không xác minh được tài khoản" + Thử lại; `onIdentified(false)` để app log |
| U8 | AI không đủ căn cứ | Chip "Gặp nhân viên hỗ trợ"; chip đội CS hoặc Sales Admin; "nhân viên đang soạn"; trả lời tới khi màn còn mở |
| U9 | Logout app | `chat.logout()`; xóa WebView storage chỉ khi xóa tài khoản |
| U10 | Khách sạn không nằm trong pilot (chỉ nhánh PR) | Thông báo pilot toàn màn, X đóng màn app |

## 6. Ràng buộc và rủi ro

- **Hai hợp đồng identify** (§2.3) phải hợp nhất trước khi Go2Joy viết endpoint ký; SDK tránh được, backend Go2Joy
  thì không. Đề xuất: Go2Joy viết endpoint trả nguyên gói do SharpTalk quy định, đổi nội dung gói khi hợp nhất.
- Polling 15 đến 30 s dừng khi app xuống nền; không có push nền trong phạm vi này.
- Không có parent origin trong WebView nên `embed_origins` và CSP không có tác dụng; an toàn dựa vào HMAC, pilot,
  rate limit 20 lần/phút.
- Font Pretendard tùy chỉnh 3 MB là cấu hình tenant dùng chung với web; app không ép được riêng cho tới khi có trục
  bề mặt (Q6).
- Hotel Admin web dùng Vue 2; app Partner iOS 8.1.0 chưa có SDK; iOS chỉ có hướng dẫn WKWebView.
- Kotlin 2.2.0: `kotlinOptions` deprecated từ 2.0, thay bằng `compilerOptions`; KGP 2.2.0 có dải Gradle và AGP hỗ trợ
  riêng, kiểm bảng JetBrains khi nâng.

## 7. Quyết định cần chốt

| ID | Quyết định | Đề xuất |
|---|---|---|
| Q1 | Hợp đồng identify dùng cho Go2Joy: `attributes` (main) hay `claims` v2 (nhánh PR) hay hợp nhất | Hợp nhất lấy `claims` v2 làm lõi vì có `iat`, hết hạn, tách phiên; giữ tên khóa `hotel_id`, `region` của D2 trong gói. SDK không bị ảnh hưởng |
| Q2 | Header: NATIVE hay WIDGET cho Partner app | NATIVE khi màn chat nằm dưới toolbar app; WIDGET khi mở Activity toàn màn không toolbar |
| Q3 | Camera và đa chọn | Bật, không quyền CAMERA, FileProvider trong SDK |
| Q4 | Dark mode | Ép sáng ở 0.2; dark mode widget là REQ riêng |
| Q5 | Badge chưa đọc trên nút vào | Ngoài 0.2; cần API đếm theo session và SDK lộ token |
| Q6 | Giao diện theo bề mặt (Web, App) trong console | Giai đoạn 2 tùy chọn: `widget_theme.design.surfaces.app` + tab "App" ở Widget Design, 1,5 đến 2 ngày |
| Q7 | Push nền | Giữ Q5 cũ: ngoài phạm vi, REQ riêng khi Go2Joy chốt dùng FCM của họ |
| Q8 | Phân phối | AAR file như hiện tại; thêm tùy chọn source module cho app muốn build cùng Kotlin 2.2.0 |
| Q9 | Compose | Module riêng `:shoptalk-compose`, không đưa Compose vào AAR lõi |
| Q10 | iOS | Ngoài phạm vi; ước 2 ngày Swift package khi cần |

## 8. Bước tiếp

Duyệt REQ này và PLN-261015-Go2Joy-Kotlin-SDK-0.2 (có wireframe và artifact mô phỏng), chốt Q1 với nhóm đang làm
PLN-261015 trên `main`, rồi mới triển khai S1.
