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
| 2 | `PATCH` entry trỏ agent không tồn tại | 400 `E5095` |
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
- Camera, bàn phím, xoay màn, link ngoài, dark mode: cần thiết bị.

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
| F2 | Cao, quyền riêng tư | Nhận diện người khác mà **không** `logout()`: máy chủ gắn phiên cũ sang khách mới, khách mới thấy hội thoại cũ. Tái hiện hai lần (A sang người mới, B sang C). Hợp đồng `attributes` trên main không tách phiên | **Mở.** Giảm nhẹ bằng hướng dẫn (bắt buộc `logout()`). Nên làm thêm: SDK ghi nhớ băm của userId lần trước và tự `logout` khi khác; máy chủ từ chối hoặc tách phiên (nhánh stage1-complete có tách phiên) |
| F3 | Thấp | Menu dạng thẻ hiện nhãn tiếng Anh trong ngôn ngữ `vi`; thẻ đồng ý có hai dòng tiếng Anh ("What we collect", "Why") | Mở, ở widget web |
| F4 | Thấp | Sau khi kết thúc, danh sách không cuộn xuống hết nên thẻ đánh giá bị ô nhập che nửa dưới tới khi cuộn | Mở |
| F5 | Nội dung | Kịch bản mở đầu và kho tri thức trong DB nháp là của cửa hàng Mỹ (Delivery Status, chính sách Mỹ), AI trả lời dài tiếng Anh. Chưa phải nội dung khách sạn Go2Joy | Mở, không thuộc SDK |
| F6 | Môi trường | Sau khi Docker khởi động lại, container đã chạy nhưng cổng chưa mở ra máy chủ; `docker restart` mới mở | Ghi nhận |
