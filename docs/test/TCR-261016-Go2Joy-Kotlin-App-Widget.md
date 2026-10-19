# TCR-261016-Go2Joy-Kotlin-App-Widget

> Kết quả kiểm thử cho `PLN-261015-Go2Joy-Kotlin-SDK-0.2` v1.1 (REQ-261015). Nhánh `feature/go2joy-kotlin-app-impl`
> (từ `main` `c676353b`). Ngày chạy: 2026-10-16, máy Windows 11, Node 22, Java 17, MySQL 8 trong Docker.
> Build Gradle/AAR đã chạy thật (§5). Emulator Android 15 (API 35) đã chạy một phần (§6); chưa có thiết bị thật.

## 1. Kiểm thử đơn vị

| Phạm vi | Lệnh | Kết quả |
|---|---|---|
| `packages/types` (mobile-app-config: chuẩn hóa, gộp theme) | `npx jest` | 176/176 (12 ca mới) |
| API `chat` (host-context util, dòng SYSTEM, RAG) | `npx jest src/domain/chat` | đạt (11 ca mới) |
| API `tenant` (MobileAppConfigService) | `npx jest src/domain/tenant` | 86/86 trước khi thêm spec; spec mới 8/8 |
| API toàn bộ | `npx jest` | 2277 đạt, 5 lỗi ở 4 suite: `attachment.service`, `heic-conversion`, `board-attachment` (EPERM thư mục tạm / dấu `\` của Windows), `embed-loader` (đã có từ trước, không liên quan thay đổi này) |
| Widget (bridge, context, chrome) | `node --test test/*.test.mjs` | 50/50 (8 ca mới) |
| `tsc --noEmit` api, widget, web | | sạch |
| `npm run i18n:check` | | 6 ngôn ngữ đủ khóa |
| Build production widget, console | `vite build` | thành công |
| SDK Kotlin, phần không phụ thuộc Android (trước khi có Android SDK) | `scratchpad/verify/run.sh` (compiler Kotlin 2.0.21, shim org.json, stub Uri) | 50/50 |
| SDK Kotlin, build thật với `android.jar` | `gradle :shoptalk:testReleaseUnitTest` | 50/50 (Config 14, Identity 11, Policies 5, Protocol 20) |

## 2. Migration

Kiểm trên DB `kimpl_mig` nạp từ `docker/init-sql/01-schema.sql` của `main` (chưa có cột):

| Bước | Kết quả |
|---|---|
| Trước khi chạy | cột `tenants.mobile_app_config` chưa có |
| Chạy `sql/261016-tenant-mobile-app-config.sql` | cột `json NULL` được tạo |
| Chạy lần hai | `ERROR 1060 Duplicate column`, không hỏng dữ liệu (chạy theo hướng dẫn guard trong tệp) |
| Rollback `DROP COLUMN` | cột biến mất |
| Boot thật với `DB_SYNCHRONIZE=true` trên DB trống | 94 bảng, trùng số bảng trong init-sql; cột có từ entity |

## 3. Chạy thật trên máy (API + widget + console)

Môi trường: API build từ nhánh chạy cổng 3010 trên DB nháp `db_kimpl` (seed của dự án, tenant đổi thành `go2joy`,
`shop_domain = https://www.go2joy.vn`, thêm agent `hotel-admin`, AI engine `stub`); widget dev 5174; console dev 5173.
Boot thật: `Nest application successfully started`.

| # | Kiểm | Kết quả |
|---|---|---|
| 1 | `GET /tenants/mobile-app` khi chưa lưu | `configured=false`, mặc định |
| 2 | `PATCH` entry trỏ agent không tồn tại | 400 `E5150` (lúc chạy ban đầu là `E5095`, đổi vì trùng mã với nhánh stage1-complete, xem §10) |
| 3 | `PATCH` hợp lệ | lưu, chuẩn hóa (screen viết thường, brand `#0EA5E9`) |
| 4 | `PATCH` `font_size=99` | 400 (validation) |
| 5 | `PATCH` không đăng nhập | 401 |
| 6 | `GET /public/widget/app-config?shop=` | 200, `Cache-Control: no-store`; shop lạ trả `config:null` |
| 7 | Audit | dòng `tenant.mobile_app_updated` |
| 8 | Chat thật: tin 1 kèm context A, tin 2 cùng nơi, tin 3 context B, tin 4 không context, tin 5 `screen` 500 ký tự | một dòng SYSTEM "Mở từ Đặt phòng #G2J-8841" trước tin 1, không có dòng ở tin 2, một dòng mới "…#G2J-8847" ở tin 3, không dòng ở tin 4, tin 5 bị từ chối `E5003` |
| 9 | Widget trong simulator, app mode, `agent=hotel-admin` | áp đúng cấu hình đã lưu: màu `14 165 233`, font hệ thống, cỡ chữ 15 px (`--ivy-root-size` 17,14 px), menu chip, ẩn header khi admin chọn native |
| 10 | Quyền ưu tiên header | không có `chrome`: theo admin; `chrome=native`: ẩn; `chrome=widget`: hiện, bất kể admin |
| 11 | Lệnh `context` | chip "Đặt phòng · #G2J-8841", ô nhập điền sẵn, lệnh thứ hai không ghi đè chữ đang có; gửi xong chip biến mất và dòng SYSTEM được ghi |
| 12 | Lệnh `settings`, `back` | `back` lần một trả `handled:true` (đóng Preferences), lần hai `handled:false` |
| 13 | Lệnh `end` | mở đúng hộp xác nhận "End this conversation?", Cancel đóng, gửi lại mở lại |
| 14 | Console, Cài đặt widget, mục "Mobile app" | hiện giá trị đã lưu; đổi header sang widget: khung điện thoại xem trước hiện header ngay (bản nháp chưa lưu, qua `postMessage`); thêm màn hình, sửa nhãn; Lưu: dòng cấu hình trong DB đúng, banner "Unsaved changes" tắt, nút Lưu vô hiệu |

Lỗi tìm thấy khi chạy thật và đã sửa (không bắt được bằng `tsc`): console value-import `@sharptalk/types` làm vỡ
bundle trình duyệt (`does not provide an export named MOBILE_APP_DEFAULTS`); sửa bằng import trực tiếp từ nguồn
như các tệp khác trong console (commit `8f27c23c`).

## 4. Chưa phủ

- `identify` ký thật từ app và `identity-expired`: cần backend Go2Joy hoặc secret của tenant; chỉ kiểm bằng test đơn vị.
- Câu trả lời AI có `HOST_CONTEXT` trong prompt: chạy với engine `stub`, chưa so với model thật; cần chạy golden set trên staging.
- Camera, bàn phím, xoay màn, link ngoài, dark mode: đã chạy trên emulator (§6, §8, §10); còn lại cần điện thoại thật (§10.7).

## 5. Build Gradle và AAR (chạy ngày 2026-10-16)

Máy: Windows 11, JDK 17, RAM trống khoảng 2,6 GB, ổ C còn 2,2 GB. Vì vậy cài tối thiểu và chạy tiết kiệm:
Android SDK chỉ có `cmdline-tools`, `platforms;android-35`, `build-tools;35.0.0`, `platform-tools` (578 MB, ở
`C:\Users\nhutp\android-sdk`, ngoài repo); không cài emulator và system image; dùng Gradle 8.14.3 có sẵn ở
`C:\Gradle` thay vì tải wrapper 8.7; `--no-daemon --max-workers=2 -Xmx1536m` và Kotlin compiler chạy trong tiến trình
Gradle (`-Pkotlin.compiler.execution.strategy=in-process`) để không có thêm JVM nền; đã tắt dev server và xóa cache
jest trước khi build.

| Bước | Lệnh | Kết quả |
|---|---|---|
| Biên dịch lần đầu | `:shoptalk:assembleDebug` | thành công, 2 phút 5 giây; lần đầu code Android biên dịch với `android.jar` (Kotlin 2.2.0, AGP 8.5.2) |
| Test, AAR, sample | `:shoptalk:testReleaseUnitTest :shoptalk:assembleRelease :shoptalk-compose:assembleRelease :sample:assembleDebug` | thành công. Lần đầu lỗi biên dịch test: `JSONObject.similar` không có trong `org.json` của `android.jar`; đã thay bằng so sánh cấu trúc tự viết trong `ShopTalkIdentityTest` |
| Lint | `:shoptalk:lintRelease :shoptalk-compose:lintRelease` | 0 error, 2 cảnh báo mỗi module (phụ thuộc có bản mới hơn; đổi locale lúc chạy cần cấu hình App Bundle) |
| Đóng gói | | `dist/shoptalk-android-0.2.0.aar` 89 KB, `dist/shoptalk-compose-0.2.0.aar` 4,6 KB, `sample-debug.apk` 2,7 MB. `dist/` không commit |
| Nội dung AAR | `unzip -l` | `classes.jar`, manifest có FileProvider và `<queries>`, `proguard.txt`, `shoptalk_file_paths.xml`, strings 6 ngôn ngữ |
| App tiêu thụ chỉ có AAR, Kotlin 2.2.0, R8 bật | app mẫu tách rời, `implementation(files("libs/shoptalk-android-0.2.0.aar"))` | `assembleRelease` thành công, APK 267 KB sau minify; `mapping.txt` cho thấy `ShopTalkBridge.postMessage` giữ nguyên tên (`@JavascriptInterface`), dù tên lớp bị đổi |

Lưu ý khi app dùng AGP 8.5.2 với Kotlin 2.2.0: tác vụ lint của AGP in dòng `e: … Module was compiled with an
incompatible version of Kotlin … expected version is 2.0.0` cho cả `kotlin-stdlib 2.2.0`. Đó là bộ phân tích Kotlin
2.0.0 nằm trong lint của AGP 8.5, không phải lỗi của AAR, và build vẫn thành công. Muốn hết dòng này thì nâng AGP
(KGP 2.2.0 hỗ trợ tới 8.10.0).

Chưa chạy bằng wrapper 8.7 như `gradle-wrapper.properties` ghi; kết quả ở trên là với Gradle 8.14.3.

## 6. Emulator Android 15 (API 35), chạy ngày 2026-10-16

AVD `kimpl35` (RAM thấp, image x86_64, `adb reverse` 5174 và 3010), app mẫu `site.amoeba.shoptalk.sample` bản debug,
API local 3010 trên DB nháp `db_kimpl`, widget dev 5174. Identity do script ký phía host: chuỗi `userId` + từng dòng
`key=value` theo thứ tự chữ cái, HMAC-SHA256 bằng secret của tenant (secret chỉ có trong DB nháp).

| # | Kiểm | Kết quả |
|---|---|---|
| E1 | App tải widget trong WebView thật, shop `https://www.go2joy.vn`, agent `hotel-admin` | đạt: giao diện theo cấu hình đã lưu trong console (màu sky, chip menu, cỡ chữ, header của widget) |
| E2 | Identify có chữ ký + `attributes` | đạt: log `identified ok=true`; session mới `identity_level=verified`, `customer_id` có, `identity_attributes` đủ 5 khóa (hotel_id, hotel_name, region, province, role) |
| E3 | Đồng ý quyền riêng tư | đạt: `consent_state=granted` |
| E4 | Nút "Context: booking" | đạt: chip + ô nhập điền sẵn "Guest did not show up…" |
| E5 | Gửi tin | đạt: thread có dòng SYSTEM "Mở từ Booking #G2J-8841…" (`screen=bookings`, `ref`, `label` trong `retrieval_trace.hostContext`), tin người dùng, tin AI (engine stub, có nguồn tham khảo) |
| E6 | Bố cục: thanh debug của app mẫu + fragment | đạt sau khi sửa (xem dưới) |
| E7 | Đổi cấu hình lúc đang chạy: cỡ chữ hệ thống 130 %, dark mode, xoay ngang | widget tải lại trong khoảng 2 giây (lần nào host cũng phải ký lại), bản dark mode giữ nền sáng như thiết kế, 130 % hiển thị đủ sau khi sửa ô nhập, ngang màn dùng được nhưng vùng tin nhắn rất thấp. Chip context mất sau khi Activity bị tạo lại |
| E8 | Đính kèm: hộp chọn "Chụp ảnh / Chọn từ thư viện / Tệp" (tiếng Việt), trình chọn ảnh hệ thống (không cần quyền) | đạt; **ảnh chọn xong không tới widget** (lỗi dưới), sau sửa: thanh đính kèm có ảnh thu nhỏ, gửi đi, `message_attachments` có bản ghi `image/png` 213 554 byte, AI trả lời |
| E9 | Mất đường tới widget rồi mở app | đạt: màn "Không kết nối được với bộ phận hỗ trợ" + nút Thử lại ngay khi tải lỗi; bấm Thử lại sau khi nối lại thì vào được chat |

Lỗi tìm thấy khi chạy trên emulator và đã sửa:

| Lỗi | Nguyên nhân | Sửa |
|---|---|---|
| Màn lỗi "Không kết nối được" | Vite mặc định nghe `[::1]`, `adb reverse` chỉ tới IPv4 | chạy `vite --host 127.0.0.1` (chỉ ảnh hưởng cách chạy dev, ghi vào README) |
| Host phải ký hai lần mỗi lần tải | widget báo `ivy:ready` từ hai chỗ | `onWidgetReady()` bỏ qua lần lặp trong cùng một lần tải |
| Dải trống dưới thanh công cụ của host | fragment đệm toàn bộ inset status bar dù host đã chừa | chỉ đệm phần inset thực sự chồng lên view, tính lại khi view đổi vị trí |
| Thanh debug của sample chồng lên status bar | target 35 edge-to-edge | sample tự đệm status bar |
| Chọn ảnh từ thư viện không có tác dụng, không báo lỗi (Android 15) | trình chọn ảnh trả `RESULT_OK` với `data = null` và ảnh nằm trong `clipData`; `FileChooserParams.parseResult` chỉ đọc `data` nên trả null | SDK tự đọc cả `data` lẫn `clipData`, `parseResult` chỉ còn là phương án dự phòng |
| Nút gửi bị cắt ở cỡ chữ 130 % | ô nhập trong khung flex thiếu `min-w-0` | thêm `min-w-0` vào ô nhập của widget |
| Dòng SYSTEM và chip lặp mã tham chiếu ("Booking #G2J-8841 #G2J-8841") | host đã ghi mã trong label | API và chip chỉ thêm `#ref` khi label chưa chứa; có test |

Còn lặp: `ShopTalkListener.onReady` vẫn gọi hai lần (chỉ callback thông báo, không ảnh hưởng ký).

Chưa kiểm: chụp ảnh bằng camera, chọn tệp PDF/Word qua trình chọn tệp, màn lỗi do hết 15 giây (mới thử lỗi tải ngay), API 24,
mở link ngoài, `back` của hệ thống, đổi tài khoản (logout rồi identify khác), TalkBack, thiết bị thật.

## 7. Ma trận tương thích với app của khách (2026-10-18)

Mục tiêu: biết AAR 0.2.0 dùng được với những cấu hình app nào, vì Go2Joy mới cho biết Kotlin 2.2.0 và chưa nói Compose hay XML, minSdk, AGP.
Cách kiểm: một app tối thiểu chỉ có AAR (`implementation(files(...))`, không có POM) cộng androidx tối thiểu, bật R8, `assembleRelease`; Gradle 8.14.3.

| # | Cấu hình app khách | Kết quả |
|---|---|---|
| M1 | Kotlin 2.2.0, AGP 8.5.2, JVM 17, minSdk 24, target 35 | đạt |
| M2 | như M1 nhưng JVM target 11 (mặc định của Android Studio), kèm một lớp Java tham chiếu SDK | đạt, lớp của app ở bytecode Java 11, AAR là Java 17 vẫn dùng được |
| M3 | Kotlin 2.1.20 | đạt |
| M4 | **Kotlin 2.0.21** | **lỗi**: trình biên dịch Kotlin dừng với lỗi nội bộ khi đọc metadata của AAR (build bằng 2.2.0). Hướng dẫn cũ ghi "Kotlin ≤ 2.2.0 đều đọc được" là sai |
| M5 | AGP 8.10.1 (mới nhất mà Kotlin 2.2.0 hỗ trợ) | đạt |
| M6 | androidx cũ: fragment 1.5.7, appcompat 1.6.1, core 1.10.1 | đạt (build); chưa chạy |
| M7 | targetSdk 34 | đạt (build); chưa chạy |
| M8 | minSdk 21 | lỗi ở AAR đầu tiên (minSdk 24). Đã hạ minSdk của SDK và module Compose xuống 21; lint minSdk 21 không còn lỗi (một chỗ dùng API 23 được đánh dấu `@RequiresApi`, thêm callback lỗi cũ cho API 21 và 22). Sau sửa: đạt (build) |
| M9 | App Java gọi `new ShopTalkConfig("url")` | lỗi ở AAR đầu tiên (thiếu `@JvmOverloads`). Đã thêm cho `ShopTalkConfig`, `ShopTalkAttachments`, `ShopTalkContext`, `ShopTalkUser`, kèm 3 test Java. Sau sửa: đạt |
| M10 | Compose, Activity kế thừa `ComponentActivity` (mẫu Compose chuẩn của Android Studio) | **sập khi mở màn chat**: `IllegalStateException: View ...AndroidComposeView is not within a subclass of FragmentActivity` (chạy thật trên emulator API 35) |
| M11 | Compose, Activity kế thừa `AppCompatActivity` | đạt: không sập, màn lỗi native hiện đúng (địa chỉ widget thử không phải widget thật) |

Siêu dữ liệu AAR: `minCompileSdk=1`, `minAndroidGradlePluginVersion=1.0.0`, tức AAR không đòi compileSdk hay AGP tối thiểu. Chưa kiểm app có compileSdk 34 (máy chỉ cài nền tảng 35).

Chưa kiểm: AGP dưới 8.5, Gradle dưới 8.7, Kotlin 2.3 trở lên, app đã bật `android.enableJetifier`, thiết bị không có Google Play Services, WebView cũ trên Android 7 đến 9.

Sau khi hạ minSdk và thêm `@JvmOverloads` (2026-10-19): test SDK 53/53 (có thêm 3 test Java), lint 0 lỗi ở minSdk 21, app thử minSdk 21 với lớp Java gọi
`new ShopTalkConfig(url)` build thành công, app Compose minSdk 21 build và chạy trên emulator API 35: màn lỗi vẫn hiện khi tên miền không phân giải
(đường `onReceivedError` mới). **Chưa chạy trên máy hoặc emulator Android 5 đến 6**: máy chỉ có image API 35.

## 8. Chạy đủ ở local (2026-10-19)

Môi trường: Docker (MySQL, Redis, RabbitMQ, Qdrant) bật lại sau khi máy tắt; API build mới từ nhánh, cổng 3010, DB nháp `db_kimpl`; widget và console Vite;
emulator Android 15; app mẫu với AAR 0.2.0 mới nhất (minSdk 21, `@JvmOverloads`). Người dùng ký bằng HMAC phía host như bản chạy thật.

| # | Kiểm | Kết quả |
|---|---|---|
| V1 | Người dùng mới A mở app, danh tính ký có thuộc tính | đạt: phiên `verified`, đủ 5 thuộc tính, hội thoại sạch |
| V2 | Nút ngữ cảnh đặt phòng, gửi tin | đạt: chip "Booking #G2J-8841" **không lặp mã**, điền sẵn ô nhập, dòng hệ thống "Mở từ Booking #G2J-8841", tin AI. Console nhân viên thấy cùng dòng hệ thống |
| V3 | Console Live chat | đạt: nhãn "Hotel: A In Hotel Del Luna", "South", "Reception", agent "Hotel Admin" |
| V4 | Đính kèm ảnh từ thư viện, gửi | đạt: bản ghi `image/png` 213 554 byte gắn đúng phiên, AI trả lời |
| V5 | Logout | **lỗi đã sửa**: máy chủ mở phiên khách mới nhưng màn hình vẫn hiện tin của người trước (trạng thái tin nhắn của widget không đặt lại khi đổi phiên). Sau sửa: chỉ còn lời chào |
| V6 | Đổi sang người dùng B sau logout | đạt: khách hàng riêng, phiên riêng, không thấy tin của A |
| V7 | Xoay ngang, cỡ chữ 130 %, dark mode khi đã có hội thoại | đạt: widget tải lại, lịch sử còn, ô nhập và nút gửi hiện đủ, không sập, host được ký lại mỗi lần. Ngang màn vùng tin nhắn thấp |
| V8 | Cài đặt, nút Back của hệ thống | đạt: màn riêng tư, đồng ý, tiếp thị, CCPA, tải và xóa dữ liệu; Back đóng cài đặt và ở lại app |
| V9 | Kết thúc hội thoại và đánh giá | đạt: hộp xác nhận, trạng thái `ended`, chấm 5 sao lưu `csat_rating = 5` |
| V10 | Mất đường tới widget rồi Thử lại | đạt: màn lỗi tiếng Việt ngay khi tải lỗi, bấm Thử lại sau khi nối lại thì vào chat |
| V11 | Console, mục Mobile app: đổi kiểu menu mở đầu sang thẻ có biểu tượng, lưu | đạt: DB và endpoint công khai có `menuStyle: card`; app sau khi xóa dữ liệu hiện thẻ có biểu tượng, không phát hành lại app. Đã trả về `chip` |

Bộ test tự động chạy cùng lúc:

| Bộ | Kết quả |
|---|---|
| `packages/types` jest | 176/176 |
| API `chat` và `tenant` jest | 322/322 (42 suite) |
| Widget `node --test` | 50/50 |
| SDK Kotlin `testReleaseUnitTest` | 53/53 |
| `tsc` api, widget, web | sạch |
| `i18n:check` | 6 ngôn ngữ đủ khóa |

### Phát hiện

| # | Mức | Phát hiện | Trạng thái |
|---|---|---|---|
| F1 | Cao | Sau `logout` giao diện vẫn hiện tin của người trước | **Đã sửa** trong `useChat` (đặt lại tin, con trỏ và trạng thái khi token đổi; bỏ qua phản hồi của phiên cũ) |
| F2 | Cao, quyền riêng tư. **Đã giảm nhẹ ở SDK, xem §9** | Nhận diện người khác mà **không** `logout()`: máy chủ gắn phiên cũ sang khách mới, khách mới thấy hội thoại cũ. Tái hiện hai lần (A sang người mới, B sang C). Hợp đồng `attributes` trên main không tách phiên | **Mở.** Giảm nhẹ bằng hướng dẫn (bắt buộc `logout()`). Nên làm thêm: SDK ghi nhớ băm của userId lần trước và tự `logout` khi khác; máy chủ từ chối hoặc tách phiên (nhánh stage1-complete có tách phiên) |
| F3 | Thấp | Menu dạng thẻ hiện nhãn tiếng Anh trong ngôn ngữ `vi`; thẻ đồng ý có hai dòng tiếng Anh ("What we collect", "Why") | Mở, ở widget web |
| F4 | Thấp | Sau khi kết thúc, danh sách không cuộn xuống hết nên thẻ đánh giá bị ô nhập che nửa dưới tới khi cuộn | Mở |
| F5 | Nội dung | Kịch bản mở đầu và kho tri thức trong DB nháp là của cửa hàng Mỹ (Delivery Status, chính sách Mỹ), AI trả lời dài tiếng Anh. Chưa phải nội dung khách sạn Go2Joy | Mở, không thuộc SDK |
| F6 | Môi trường | Sau khi Docker khởi động lại, container đã chạy nhưng cổng chưa mở ra máy chủ; `docker restart` mới mở | Ghi nhận |

## 9. SDK tự đăng xuất khi đổi người dùng (2026-10-19)

Sửa F2: SDK nhớ dấu vết SHA-256 của `userId` đã nhận diện lần trước (theo widget và cửa hàng) và gửi `logout` trước `identify` khi người dùng đổi
hoặc khi provider trả `null` sau một người dùng. Lỗi của provider không đổi gì. Quy tắc nằm trong lớp thuần `SessionOwner`.

**Thiết kế sau khi rà soát lại.** Bản đầu ghi người mới vào bộ nhớ trước khi đăng xuất thật sự xảy ra: app bị tắt hoặc lệnh bị bỏ sót đúng lúc đó thì
bộ nhớ nói "B" trong khi phiên vẫn của A, và lần mở sau B vào thẳng phiên của A. Bản cuối ghi `reset` ("chủ phiên chưa rõ, đăng xuất trước khi nhận diện")
rồi chỉ chuyển sang dấu vết người mới khi widget báo `identified ok`; lưu bằng `commit()` để không mất khi tiến trình chết. Hệ quả xấu nhất còn lại
là một lần đăng xuất thừa.

**Lỗi đua trong widget tìm thấy khi chạy thiết bị.** Khi mở lại app với người dùng khác (hoặc ca bị gián đoạn), lệnh `logout` và `identify` của SDK đến lúc
widget còn đang chờ lần tạo phiên đầu tiên của chính trang. Phản hồi muộn đó (a) đặt lại token phiên cũ, hoặc (b) nhận luôn lệnh `identify` đang chờ, nên
nhận diện rơi vào phiên cũ trong khi widget chuyển sang phiên khách mới: người dùng thành khách dù SDK đã ghi là đã nhận diện. Ca "người cũ trở lại sau gián đoạn"
hỏng 2 trên 2 lần. Sửa trong widget: `sessionEpoch` tăng khi `logout`; phản hồi tạo phiên bắt đầu trước đó bị bỏ qua.

| # | Kiểm | Kết quả |
|---|---|---|
| O1 | Test đơn vị `SessionOwnerTest` (15 ca): lần đầu, cùng người không ghi gì, khác người, dấu vết `reset` giữa chừng, tắt app trước xác nhận, nhận diện bị từ chối, khách rồi đăng nhập, đăng xuất rồi `null` lần nữa, đăng xuất chưa gửi được, theo từng widget và cửa hàng, không lưu `userId` thô, dấu vết ổn định | 15/15; tổng SDK 68/68, lint 0 lỗi, build release, app mẫu và app khách R8 minSdk 21 JVM 11 thành công |
| O2 | Thiết bị M0: P1 đăng nhập, gửi một tin | phiên của P1, 2 tin, dấu vết = SHA-256 của P1 |
| O3 | M1: mở lại với P2, app **không** gọi `logout()` | khách hàng mới, phiên mới; phiên của P1 còn nguyên; dấu vết = P2 |
| O4 | M2: provider ném lỗi | không đổi gì: cùng phiên, dấu vết không đổi |
| O5 | M3: P3 qua `identify()` thủ công gọi trước khi widget sẵn sàng | phiên mới cho P3, dấu vết = P3 |
| O6 | M4: P3 lại qua `identify()` | không tạo phiên mới |
| O7 | M5: dấu vết bị ép về `reset` (mô phỏng gián đoạn), P3 trở lại | **sau sửa widget**: phiên mới được gắn đúng P3, dấu vết về P3. Trước sửa: phiên khách mới không có danh tính |
| O8 | M6: xoay màn hình hai lần cùng người | không tạo phiên mới |
| O9 | M7: app không còn người đăng nhập (provider trả `null`) | phiên khách mới, dấu vết xóa |
| O10 | Lặp 6 lần đổi qua lại A, B và 3 lần "gián đoạn rồi trở lại" | 9/9 đạt: mỗi lần phiên mới đúng khách hàng, không phiên nào đổi chủ, dấu vết khớp |

Còn lại: hợp đồng `attributes` trên main vẫn gắn lại phiên khi một app khác (không dùng SDK, như web) nhận diện người khác mà không `logout`; chỗ đó cần máy chủ tách phiên
(nhánh stage1-complete). Khi người cũ trở lại sau một lần gián đoạn, họ nhận phiên mới thay vì phiên cũ của mình.

## 10. Rà soát lần hai và chạy đủ trên ba mức Android (2026-10-19)

### 10.1 Cách kiểm

Widget thật chỉ chạy trên WebView hiện đại, còn mục tiêu là kiểm **mã native của SDK** trên Android cũ. Vì vậy dùng một trang giả lập widget viết bằng
JavaScript cũ (ES5), nói đúng giao thức cầu nối (`ivy:ready`, `identified`, `back`, nhận lệnh `locale`, `identify`, `logout`, `context`) và gửi mọi lệnh nhận
được về máy chủ kiểm, nên kết quả đọc được bằng văn bản chứ không phải ảnh chụp. Trang có thêm ô chọn tệp và một địa chỉ `/silent` không bao giờ báo sẵn sàng.
App mẫu bật StrictMode ở bản debug. Identity vẫn được ký phía host như bản chạy thật.

### 10.2 Ma trận thiết bị

| Mức | Emulator | WebView | 13 kiểm tra giao thức | Sập của app | Vi phạm StrictMode do mã SDK |
|---|---|---|---|---|---|
| API 21, Android 5.0.2 | x86_64 Google APIs | Chrome 37 | **13/13** | 0 | 0 |
| API 23, Android 6.0 | x86_64 Google APIs | Chrome 44 | **13/13** | 0 | 0 (còn các vi phạm đọc đĩa do hệ thống tạo WebView) |
| API 35, Android 15 | x86_64 Google APIs | Chrome 124 | **13/13** | 0 | 0 |

13 kiểm tra: (1) người đầu tiên: ngôn ngữ rồi nhận diện; (2) người khác mà app không gọi `logout()`: đăng xuất **trước** nhận diện; (3) cùng người mở lại: chỉ nhận diện,
không đăng xuất; (4) app không còn người đăng nhập: đăng xuất, không nhận diện; (5) người mới sau khi đã đăng xuất: nhận diện, không đăng xuất thừa; (6) nút ngữ cảnh tới trang;
(7) hộp chọn đính kèm của SDK mở từ ô chọn tệp; (8) hủy rồi mở lại (callback đã được trả); (9) mất kết nối: màn lỗi `LoadFailed` (API 21 đi qua callback cũ `onReceivedError`);
(10) Thử lại sau khi có mạng: trang tải và danh tính tới; (11) trang không bao giờ sẵn sàng: chưa lỗi ở giây 9, `LoadTimeout` sau 15 giây; (12) nút Back hệ thống tới trang dưới dạng `back`;
(13) trang trả "không xử lý" thì app mẫu tự đóng.

Làm tay thêm: API 23, chọn ảnh từ Gallery của Android 6 tới trang đúng tên, kích thước 316 688 byte, loại `image/png` (nhánh kết quả trả `data`; Android 15 trả `clipData`, đã kiểm ở §8);
hộp chọn tệp và bộ chọn của hệ thống hiện đúng. API 21: `/sdcard` của ảnh giả lập chỉ đọc nên không đẩy được ảnh, chỉ kiểm hộp thoại, hủy, mở lại.

### 10.3 Phát hiện và xử lý

| # | Mức | Phát hiện | Cách thấy | Xử lý |
|---|---|---|---|---|
| G1 | Cao | Bộ nhớ chủ phiên của SDK đọc ghi `SharedPreferences` **trên luồng giao diện**: ổ đĩa bận làm đơ chat, app bật StrictMode `penaltyDeath` bị phạt | StrictMode báo `DiskReadViolation` và `DiskWriteViolation` từ `PrefsSessionStore`; lần chạy đầu mất nhận diện không đều khi máy đang ghi nặng | một luồng riêng dùng chung cho mọi fragment (ghi theo thứ tự); dấu "reset" vẫn nằm trên đĩa **trước** khi gửi lệnh vào trang; lỗi bộ nhớ thì coi như phiên của người khác. Sau sửa: 0 vi phạm từ mã SDK trên cả ba mức |
| G2 | Trung bình | Lần kiểm khôi phục chip bằng xoay màn trước đó **không chứng minh gì**: app mẫu khai báo `configChanges` nên xoay không tạo lại Activity | đọc lại `AndroidManifest` của app mẫu | kiểm lại bằng dark mode (tạo lại thật): `ready` một lần, chip "Booking #G2J-8841" trở lại, ô nhập vẫn trống (không lặp chữ điền sẵn) |
| G3 | Cao khi hợp nhất | Mã lỗi `E5095` của nhánh này trùng với `REGION_ROUTING_INVALID` của nhánh stage1-complete; client dịch theo mã nên sẽ hiện nhầm thông báo | so danh sách mã của 51 nhánh | đổi sang **E5150** (khối trống sau E5145 đến E5149, không nhánh nào dùng); HTTP thật: `PATCH /tenants/mobile-app` agent lạ trả 400 `E5150`; console dịch theo mã (6 ngôn ngữ) |
| G4 | Trung bình | Menu mở đầu hiện tiếng Anh ở lần mở đầu tiên dù app đặt tiếng Việt | đọc nhãn nút bằng DevTools của WebView | lệnh `locale` của app đến sau lần lấy menu, nên menu về theo ngôn ngữ mặc định của máy chủ và được lưu 60 giây. Nay làm mới menu sau khi đồng bộ ngôn ngữ phiên; 3/3 lần cài mới ra tiếng Việt |
| G5 | Thấp | Thẻ đánh giá bị ô nhập che nửa dưới cho tới khi cuộn tay | ảnh chụp sau khi kết thúc hội thoại | hiệu ứng cuộn thêm điều kiện hiện thẻ; ảnh sau sửa: thẻ vào đủ khung |
| G6 | Thấp | Màn lỗi dùng nút xám mặc định; `ShopTalkChat` sập với thông báo về "View" khó hiểu khi host là `ComponentActivity` | ảnh chụp, ma trận tương thích §7 | nút lấy `colorPrimary` của theme app (rồi `colorAccent`); Compose báo thẳng cách sửa và bỏ qua trong @Preview |
| G7 | Trung bình | Widget thật trên WebView Chrome 37: trang trắng 15 giây rồi màn lỗi nói "kiểm tra mạng", sai nguyên nhân | chạy widget thật trên API 21 | widget cần Chrome 80 trở lên (dùng `??` và module); khi hết giờ chờ mà WebView cũ hơn thì thông điệp là "cập nhật Android System WebView" (6 ngôn ngữ). Ảnh sau sửa đúng như vậy |
| G8 | Không phải lỗi SDK | Nhận diện mất không đều (5 trên 10 lần) khi chạy bằng trang giả lập | log của bên cung cấp danh tính: được hỏi nhưng không trả lời | trang giả lập báo `ready` ngay lúc đang phân tích HTML, nhanh hơn `onPageStarted` đến luồng chính, nên trạng thái sẵn sàng bị đặt lại. Widget thật chỉ sẵn sàng sau vài trăm mili giây nên không gặp. Trang giả chờ 600 ms; sau đó 10/10 |

### 10.4 Kiểm thêm trên Android 15 (API 35)

| Kiểm | Kết quả |
|---|---|
| Camera (ứng dụng camera ảo của emulator) qua mục "Chụp ảnh" | ảnh `image/jpeg` 32 463 byte tới widget, gửi đi, lưu đúng phiên |
| Chọn PDF qua mục "Tệp" | `application/pdf` 193 byte, loại `file`, lưu đúng phiên |
| Link ngoài (`https://…`) trong tin nhắn | mở bằng Chrome (ACTION_VIEW), Back quay lại app, hội thoại còn nguyên, không phiên mới. Widget chỉ tự nhận địa chỉ trần, không dựng `[chữ](địa chỉ)` (thiết kế của widget) |
| Nút Back hệ thống khi không có gì mở | SDK hỏi widget, widget trả "không xử lý", `onCloseRequest` đóng app |
| Truy cập: cây truy cập của widget thật qua DevTools | 18 điều khiển tương tác, **0 thiếu tên** (tab, nút gửi, đính kèm, cài đặt, ngôn ngữ, đóng, đồng ý, từ chối, ô nhập, các nút menu) |
| Phục hồi chip sau khi Activity tạo lại | đạt (G2) |
| `ShopTalkListener.onReady` | 1 lần mỗi lần tải |
| Nút Thử lại theo màu app | màu `colorAccent` của theme mẫu |

### 10.5 Kiểm tự động trên mã hiện tại

| Bộ | Kết quả |
|---|---|
| `packages/types` jest | 176/176 |
| SDK Kotlin `testReleaseUnitTest` | 72/72 (thêm 4 ca đọc phiên bản WebView) |
| Widget `node --test` | 50/50 |
| API `chat`, `tenant`, `embed` jest | 365/366; ca lỗi là `embed-loader` "keeps the widget iframe sandboxed" |
| API toàn bộ | 2279/2282; 3 ca lỗi nền của Windows: `heic-conversion`, `embed-loader`, `board-attachment` |
| `tsc` api, widget, web | sạch |
| `i18n:check` | 6 ngôn ngữ đủ khóa |
| Lint SDK và Compose | 0 lỗi |

Ca `embed-loader` được chạy lại trên một bản sạch của `origin/main` và lỗi y hệt, nên có từ trước, không liên quan nhánh này.

### 10.6 Hợp nhất

Thử hợp nhất khô bằng `git merge-tree` (không động tới thư mục làm việc): với `origin/main` (không tụt, đi trước 24 commit lúc thử) hợp nhất **sạch**. Với `feature/go2joy-stage1-complete`
có 7 tệp xung đột do nhánh này, ngoài các xung đột sẵn có giữa main và nhánh đó: `chat/rag.service.ts`, `tenant/entity/tenant.entity.ts`, `error-code.constant.ts`, `widget/hooks/useChat.ts`,
`widget/services/chatService.ts`, `widget/store/widgetStore.ts`, `packages/types/src/index.ts`. Đều là hai bên cùng thêm vào chỗ kề nhau (khóa export, cột entity, tham số, trường store), giải bằng giữ cả hai.
Nhánh stage1-complete đã tách phiên ở máy chủ khi người khác nhận diện trên phiên đã gắn người trước (`principalChanged` rồi tạo phiên mới) và widget của nó nhận phiên mới, nên phần lỗi tách phiên cho web
và app không dùng SDK được giải ở đó. Chưa hợp nhất thử trên thiết bị (hợp đồng nhận diện `attributes` của main và `claims` v2 của nhánh đó vẫn là quyết định Q1).

### 10.7 Chưa kiểm

- Điện thoại thật: camera thật, bàn phím, hiệu năng, WebView cập nhật qua Play, hãng có biến thể WebView riêng.
- TalkBack thật (mới kiểm cây truy cập, chưa kiểm thứ tự đọc và cử chỉ).
- Android 7 đến 14 (kiểm 5.0, 6.0, 15; API 22 đi chung đường mã với 21, API 24 đến 34 đi chung đường với 23 và 35).
- Bộ chọn ảnh hệ thống của Android 5 (thẻ nhớ ảo chỉ đọc).
- Hiệu năng bộ nhớ lâu, xoay liên tục, chuyển nền rồi quay lại sau khi hệ thống thu hồi tiến trình.

## 11. Cách giao thư viện: thư mục Maven và mức androidx tối thiểu (2026-10-19)

### 11.1 Vấn đề

Tệp AAR không có POM, và dự án chưa có cấu hình xuất bản, nên app của Go2Joy phải tự khai báo androidx. Hướng dẫn cũ bảo họ thêm `core-ktx 1.15.0` và
`fragment-ktx 1.8.5` ("bỏ nếu app đã có"). Chạy thử một app khách giả (Kotlin 2.2.0, AGP 8.5.2) trên emulator Android 15 với trang giả lập widget:

| # | Cấu hình app khách | Cách lấy SDK | Kết quả trước khi sửa |
|---|---|---|---|
| P1 | Đoạn khai báo trong hướng dẫn cũ, `compileSdk 34` | AAR trần | **Build thất bại**: `core 1.15.0` đòi `compileSdk` 35 |
| P2 | androidx năm 2020 (fragment 1.2.5, activity 1.1.0, core 1.3.2, lifecycle 2.2.0) | AAR trần | **App sập** khi tạo fragment: `NoClassDefFoundError ... ActivityResultContracts$StartActivityForResult` |
| P3 | androidx 2023, `compileSdk 34`, kho Maven với POM ghim `core-ktx 1.15.0` và `fragment-ktx 1.8.5` | Maven (bản thử) | **Build thất bại**, cùng nguyên nhân P1 |
| P4 | androidx 2021 (fragment 1.3.6, core 1.6.0, activity 1.2.4, lifecycle 2.3.1) hoặc 2023 | AAR trần | Chạy đủ: locale, context, identify đến trang |

Ranh giới nằm giữa năm 2020 và 2021: Activity Result API xuất hiện từ fragment 1.3.0 và activity 1.2.0.

### 11.2 Thay đổi

- Thêm xuất bản Maven cho `:shoptalk` và `:shoptalk-compose` (nhóm `site.amoeba.shoptalk`, phiên bản lấy từ `gradle.properties`), kèm mã nguồn.
- **POM khai báo mức tối thiểu**: `fragment-ktx 1.3.6`, `core-ktx 1.6.0`, `lifecycle-runtime-ktx 2.3.1`, `kotlin-stdlib 2.1.0` (build bằng Kotlin 2.2.0 nhưng
  `coreLibrariesVersion = 2.1.0` và `apiVersion = 2.1`, nên trình biên dịch chặn mọi API stdlib mới hơn mức tối thiểu). Thư viện biên dịch được với các mức này, 72 test đạt.
- Lệnh một dòng: `./gradlew deliveryZip` tạo `dist/maven/` và `dist/shoptalk-android-0.2.0-maven.zip` (159.312 byte; gồm AAR, POM, siêu dữ liệu Gradle, mã nguồn,
  checksum từng tệp; thư mục được xóa trước khi xuất bản để không lẫn tệp cũ). Zip bỏ `maven-metadata.xml*` (có dấu thời gian `lastUpdated`, chỉ cần cho phiên bản động) nên cùng mã nguồn cho cùng SHA-256 (xem 11.4).
- App mẫu khai báo androidx mới như một app thật (core-ktx 1.15.0, fragment-ktx 1.8.5, lifecycle 2.8.7); việc kiểm mức tối thiểu do ma trận dưới đây đảm nhiệm.
- Hướng dẫn: viết lại mục 1 (yêu cầu, cách nhận thư viện, phương án AAR trần kèm mức tối thiểu, cảnh báo về đoạn dán cũ) và mục 2 (gắn provider và listener trong
  `onResumeFragments`); thêm hai dòng vào danh sách kiểm tra; sửa hướng dẫn tiếng Hàn và README; thêm nhóm câu hỏi A2 vào bộ câu hỏi cho Go2Joy.

### 11.3 Kết quả sau khi sửa

Mọi ca dùng thư mục giải nén sạch từ zip (như client làm), app khách giả trên emulator Android 15 (API 35), trang giả lập widget:

| # | Cấu hình app khách | Cách lấy SDK | Kết quả |
|---|---|---|---|
| V1 | Chỉ MỘT dòng khai báo + appcompat 1.3.1, không dòng androidx nào, `compileSdk 34` | Maven | Đạt |
| V2 | androidx 2023 (fragment 1.5.7, core 1.10.1), `compileSdk 34`, không ghim | Maven | Đạt; Gradle giữ fragment 1.5.7 và core-ktx 1.10.1 của app |
| V3 | androidx 2020 (fragment 1.2.5), `compileSdk 34`, không ghim | Maven | **Đạt** (trước đây sập): Gradle tự nâng fragment lên mức tối thiểu |
| V4 | androidx mới nhất, `compileSdk 35` | Maven | Đạt |
| V5 | Đúng mức tối thiểu (2021) ghim cứng, `compileSdk 34` | Maven | Đạt |
| V6 | Host dùng **Kotlin 2.1.20**, một dòng khai báo | Maven | Đạt; stdlib giữ 2.1.20 (không bị kéo lên 2.2.0) |
| R1 | Kho là thư mục tương đối `third_party/shoptalk-maven` kèm `includeGroup` (đúng dòng hướng dẫn) | Maven | Đạt |
| R2 | Mức tối thiểu của hướng dẫn mục 1.3, `compileSdk 34` | AAR trần | Đạt |
| C1 | Module Compose, host `AppCompatActivity`, một dòng `shoptalk-compose` | Maven | Đạt (locale, identify đến trang) |
| C2 | Module Compose, host `ComponentActivity` | Maven | Báo lỗi chủ ý nêu cách sửa, không sập mờ |

Kiểm bổ sung:

| Kiểm | Kết quả |
|---|---|
| 72 test đơn vị SDK, lint SDK và Compose | Đạt, 0 lỗi |
| 13 kiểm tra giao thức trên emulator Android 15 với app mẫu dựng từ cấu hình mới | 13/13; 0 vi phạm StrictMode do mã SDK; app mẫu không sập |
| 9 lượt đổi người dùng và gián đoạn với widget và API thật | 9/9, không phiên nào đổi chủ |
| 32 tệp checksum trong thư mục giải nén (sau khi bỏ `maven-metadata.xml*`) | Khớp cả 32 |

### 11.4 Gắn nhà cung cấp danh tính: hướng dẫn cũ dễ làm mất nhận diện

Hướng dẫn cũ đặt `identityProvider` và `listener` trên fragment ngay lúc tạo, chỉ khi Activity mới. Hai app thử, cùng bật dark mode để buộc Activity tạo lại:

| App thử | Nhận diện lần mở đầu | Sau khi Activity tạo lại | Nút Back |
|---|---|---|---|
| Gắn một lần khi tạo mới (đúng mẫu cũ) | có | **mất**: người dùng chat như khách, không có lỗi nào | đóng |
| Gắn trong `onResumeFragments` | có | **còn** | đóng |

Hướng dẫn nay dùng mẫu thứ hai. Cũng ghi rõ: `commit { }` chạy bất đồng bộ nên `findFragmentByTag` ngay sau đó trả về rỗng.

### 11.5 Chưa kiểm

- Android 5.0 và 6.0 với bản thư viện mới (AVD và ảnh hệ thống đã xóa sau lần kiểm trước). Thay đổi chỉ ở đường biên dịch (mức androidx, stdlib), không đụng mã
  riêng của từng bản Android, và các lượt kiểm trên androidx 2021 (gần mức tối thiểu) chạy trên Android 15; nhưng chưa chạy lại 13 kiểm tra trên API 21 và 23.
- `targetSdk` 36 và Android 16, `compileSdk` từ 33 trở xuống, Kotlin 2.0 (đã biết không đọc được), điện thoại thật.
- Build của client có kiểm tra checksum hoặc khóa phiên bản (cần thêm checksum của nhóm `site.amoeba.shoptalk`).

### 11.4 Tính tái lập của bản giao (phát hiện khi chạy lại ngày 2026-10-19)

Build sạch lần hai cho cùng mã nguồn: hai AAR và các POM giống từng byte (`db33ac9c…`, `cf1e3c5c…`), nhưng zip có SHA-256 khác bản đầu
(`e362b616…` so với `14861643…`). Nguyên nhân duy nhất: `maven-metadata.xml` ghi `lastUpdated` theo giờ build. Sửa: `deliveryZip` loại `**/maven-metadata.xml*`
(Gradle không cần tệp này với phiên bản cố định; ma trận 12.5 chạy trên thư mục không có nó. Chưa thử tải thư mục lên Artifactory hoặc Nexus thật). Hai lần build liên tiếp sau khi sửa cho cùng
SHA-256 `dd9e620e78a9f7f1e17f0c58f2f85cbc365d43a6fdc39aecb7586c5b2e12e3e9`, 159.312 byte.

## 12. Chạy lại toàn bộ ở local với bản giao cuối (2026-10-19)

Mục đích: đóng các mục "chưa chạy lại" của §11 trên đúng tệp zip sẽ giao. Mọi ca app khách dùng thư mục giải nén sạch từ zip này.

### 12.1 Phần mềm chung và SDK

| Kiểm | Kết quả |
|---|---|
| `i18n:check` (en làm gốc), `env:check` | Đủ 5 ngôn ngữ; mọi biến API đọc đều có trong mẫu |
| `tsc --noEmit` cho `packages/types`, `packages/common`, `apps/widget`, `apps/web`, `apps/api` | 0 lỗi |
| Jest `packages/types` | 176/176 |
| Widget `node --test test/*.test.mjs` | 50/50 |
| Jest `apps/api` | 2.279/2.282. 3 ca lỗi là lỗi nền của Windows (`embed-loader.spec`: dấu xuống dòng CRLF; `board-attachment.service.spec` và `heic-conversion.spec`: đường dẫn dùng `\`). Nhánh này không sửa các module đó |
| SDK: `clean`, test, lint, `assembleDebug` app mẫu, `deliveryZip` | Thành công; 72/72 test; lint SDK 0 lỗi (6 cảnh báo), Compose 0 lỗi (2 cảnh báo) |
| Hai AAR dựng lại từ đầu | Giống từng byte với bản đã giao |

Ghi chú công cụ: `npm run typecheck|lint|test` (turbo) không chạy được trong worktree này vì liên kết `node_modules/.bin` hỏng, và `radius:check` lỗi đường dẫn
`C:\C:\...` trên Windows. Cả hai là lỗi môi trường có từ trước, nên các kiểm tra trên chạy trực tiếp từng công cụ.

### 12.2 Mười ba kiểm tra giao thức trên ba phiên bản Android (app mẫu, trang giả lập widget)

| Máy ảo | WebView | Kết quả | Sập app | StrictMode do mã SDK |
|---|---|---|---|---|
| Android 5.0.2 (API 21) | Chrome 37 | 13/13 | 0 | 0 |
| Android 6.0 (API 23) | Chrome 44 | 13/13 | 0 | 0 |
| Android 15 (API 35) | Chrome 124 | 13/13 | 0 | 0 |

Trên Android 6.0 bản AOSP, hệ thống ghi 196 vi phạm StrictMode đọc đĩa. Tất cả nằm trong `WebViewFactory` của nền tảng khi dựng `WebView(context)` lần đầu
(khung duy nhất của mã chúng ta là dòng `ShopTalkChatFragment.onCreateView` gọi `WebView(context)`); không có khung nào của `site.amoeba.shoptalk.internal`.

### 12.3 Phiên và danh tính với widget và API thật (Android 15)

| Kiểm | Kết quả |
|---|---|
| 6 lượt đổi người dùng A/B và 3 lượt gián đoạn (chủ phiên bị đặt `reset` rồi cùng người quay lại) | 9/9; không phiên nào đổi chủ |
| Kho chủ phiên, 8 bước M0 đến M7 (đọc phiên trong MySQL và tệp `shoptalk_sdk_session.xml`) | Đúng cả tám. M1: người thứ hai có phiên và khách hàng mới, phiên người thứ nhất còn nguyên 2 tin; M2: provider lỗi thì không đổi gì; M3: `identify()` thủ công đổi người tạo phiên mới; M4: cùng người gọi lại không tạo phiên; M5: chủ bị đặt `reset` thì người đó quay lại chỉ mở một phiên mới và kho về đúng dấu vân tay; M6: xoay hai lần không tạo phiên; M7: đăng xuất khỏi app tạo phiên khách và xóa chủ |

### 12.4 compileSdk và targetSdk (app khách giả, một dòng khai báo)

| # | Cấu hình | Kết quả |
|---|---|---|
| S1 | `compileSdk 33`, `targetSdk 33`, androidx 2021 (fragment 1.3.6, core 1.6.0) | Build và chạy đạt |
| S2 | `compileSdk 33`, `targetSdk 33`, androidx 2020 (fragment 1.2.5) | Đạt (POM nâng fragment lên mức tối thiểu) |
| S3 | `compileSdk 36`, `targetSdk 36` (xác nhận `targetSdk=36` bằng `dumpsys package`), AGP 8.10.1 | Build và chạy đạt trên Android 15 |

Giới hạn: S3 chạy trên máy ảo Android 15, nên các thay đổi hành vi dành riêng cho Android 16 chưa được kiểm.

### 12.5 Ma trận cấu hình app khách (từ zip mới), theo phiên bản Android

| Cấu hình app khách | Android 5.0 | Android 6.0 | Android 15 |
|---|---|---|---|
| androidx 2020 (fragment 1.2.5), `compileSdk 34` | Đạt | Đạt | Đạt |
| androidx 2021 ghim đúng mức tối thiểu, `compileSdk 34` | Đạt | Đạt | Đạt |
| androidx mới nhất, `compileSdk 35` | Đạt | Đạt | Đạt |

Ca một dòng khai báo, appcompat 1.3.1, không dòng androidx nào (M1) chỉ chạy lại trên Android 15 (Đạt). "Đạt" nghĩa là build thành công, không sập app và trang nhận đủ locale, context và identify.

Ghi chú về cảnh báo build: khi ghép host Kotlin 2.2.0 với AGP 8.5.2, R8 (D8) in cảnh báo "parsing kotlin metadata" cho chính các lớp của app khách (9 lớp
trong app thử), không cho lớp nào của SDK. Đó là chuyện bộ công cụ cũ so với Kotlin mới, không làm hỏng build; AGP mới hơn (8.10.1) chạy sạch.

### 12.6 Vẫn chưa kiểm

- Điện thoại thật (camera thật, hiệu năng, WebView cập nhật qua Play, biến thể WebView của hãng) và TalkBack thật.
- Hành vi riêng của Android 16 (targetSdk 36 mới chỉ chạy trên Android 15).
- compileSdk 30 đến 32, AGP cũ hơn 8.5, host Kotlin 2.0.x (SDK yêu cầu từ 2.1, đã ghi trong hướng dẫn).
- Tải thư mục Maven lên một Artifactory hoặc Nexus thật (mới thử kho dạng thư mục tương đối).
- Widget thật trên WebView cũ hơn Chrome 80 (cố ý không hỗ trợ; SDK hiện thông báo cập nhật WebView).
