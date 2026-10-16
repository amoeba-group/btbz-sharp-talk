# TCR-261016-Go2Joy-Kotlin-App-Widget

> Kết quả kiểm thử cho `PLN-261015-Go2Joy-Kotlin-SDK-0.2` v1.1 (REQ-261015). Nhánh `feature/go2joy-kotlin-app-impl`
> (từ `main` `c676353b`). Ngày chạy: 2026-10-16, máy Windows 11, Node 22, Java 17, MySQL 8 trong Docker.
> Build Gradle/AAR đã chạy thật (§5). **Chưa kiểm được:** chạy trên thiết bị hoặc emulator (§6).

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

## 6. Chưa kiểm: thiết bị và emulator

Không có thiết bị nào kết nối (`adb devices` rỗng) và không cài emulator: system image API 35 nặng khoảng 1,5 đến
2 GB, vượt quá chỗ trống và RAM của máy này. Việc còn lại là TCR 14 hạng mục (camera, chooser, màn lỗi, xoay màn,
cỡ chữ 130 %, back, link ngoài, đổi tài khoản, dark mode) trên thiết bị thật hoặc emulator. Cách nhẹ nhất: cắm điện
thoại Android bật USB debugging rồi

```bash
adb reverse tcp:5174 tcp:5174 && adb reverse tcp:3010 tcp:3010
./gradlew :sample:installDebug   # sample dùng http://localhost:5174/ qua allowInsecureUrl
```
