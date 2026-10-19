# Câu hỏi về nền tảng Android của Go2Joy (gửi trước khi giao SDK)

> Gửi cho đội Android của Go2Joy. Mục đích: bảo đảm thư viện SharpTalk (thư mục Maven hoặc tệp AAR, Kotlin) cài vào và chạy được ngay, không phải
> thử sai trên máy của họ. Mỗi câu có chỗ lấy câu trả lời trong dự án và nêu Amoeba sẽ làm gì tùy câu trả lời.
> Cơ sở: Amoeba đã thử thư viện với nhiều cấu hình app giả lập (TCR-261016 mục 7 và 11). Go2Joy mới cho biết Kotlin 2.2.0; các mục còn lại chưa biết.
> Cập nhật 19/10/2026: thêm nhóm A2 (câu 16 đến 19) sau khi thử các cách giao thư viện; câu 7 đổi theo cách giao mới.

## A. Bắt buộc trả lời (mỗi câu có thể làm hỏng việc cài đặt)

| # | Câu hỏi | Lấy ở đâu | Nếu câu trả lời là… |
|---|---|---|---|
| 1 | Phiên bản Kotlin chính xác trong app? | `gradle/libs.versions.toml` hoặc `build.gradle` gốc, dòng `kotlin` | 2.1.0 trở lên: dùng được. Dưới 2.1: AAR không đọc được, Amoeba phải build lại bằng Kotlin thấp hơn hoặc giao mã nguồn |
| 2 | `minSdk` của app? | `app/build.gradle(.kts)`, `defaultConfig` | 21 trở lên: dùng được (21 đến 23 đã chạy trên máy ảo, chưa thử máy thật; nhờ đội Android của Go2Joy thử trên máy của họ). Dưới 21: cần bàn |
| 3 | Màn hình dựng bằng Jetpack Compose, XML hay cả hai? | màn nơi sẽ đặt nút "Hỗ trợ" | XML: dùng Fragment trực tiếp. Compose: dùng thêm module Compose, xem câu 4 |
| 4 | Activity chứa màn chat kế thừa lớp nào? | tìm `class ... : XxxActivity()` | `AppCompatActivity` hoặc `FragmentActivity`: dùng được. **`ComponentActivity` thuần (mẫu Compose của Android Studio): màn chat sập**, phải đổi lớp cha và theme sang AppCompat |
| 5 | Phiên bản AGP và Gradle? | `gradle/libs.versions.toml` mục `agp`, `gradle/wrapper/gradle-wrapper.properties` | Đã thử AGP 8.5.2 và 8.10.1. Dưới 8.5 thì Amoeba thử thêm |
| 6 | Mã Java trong app có gọi SDK không? | tìm các tệp `.java` ở màn sẽ nhúng | Không cần thay gì: hàm tạo ngắn cho Java đã có. Hỏi để biết có phải kiểm thêm phía Java không |
| 7 | App lấy thư viện bên ngoài bằng cách nào: Maven riêng (Artifactory, Nexus, GitHub Packages), hay chép tệp AAR vào `libs/`? Có được thêm một kho Maven (kể cả một thư mục trong repo) không? | cách đang dùng cho SDK khác (bản đồ, thanh toán); `settings.gradle` mục `repositories` | Có Artifactory hoặc Nexus: Amoeba giao thư mục Maven để họ tải lên đó. Thêm được thư mục trong repo: giải nén vào `third_party/` (cách A, một dòng khai báo). Không thêm được kho: giao AAR kèm bảng mức tối thiểu của androidx (phương án dự phòng, dễ sai hơn) |

## A2. Bổ sung sau khi thử các cách giao thư viện (19/10/2026)

Các câu này đổi kết quả cài đặt nhưng chưa có trong nhóm A.

| # | Câu hỏi | Lấy ở đâu | Nếu câu trả lời là… |
|---|---|---|---|
| 16 | "Kotlin 2.2.0" là của **app nào**: app lễ tân và quản lý khách sạn (Hotel Admin, Partner), hay app khách đặt phòng? Hai app có chung mã nguồn không? | hỏi trực tiếp đội Android | Giai đoạn 1 gắn vào app lễ tân và quản lý. Nếu Kotlin 2.2.0 là của app khác thì mọi câu trả lời ở nhóm A và B phải hỏi lại cho đúng app sẽ nhúng chat |
| 17 | **Phiên bản androidx thật** trong app (fragment, activity, core, lifecycle, appcompat, và Compose BOM nếu có), cùng `compileSdk` và `targetSdk` | lệnh ở mục C | Từ androidx năm 2021 (fragment 1.3.6, core 1.6.0, activity 1.2.4, lifecycle 2.3.1) trở lên dùng được; giao qua Maven thì Gradle tự nâng nếu thấp hơn. Với AAR trần, thấp hơn mức đó là **app sập** khi mở màn chat. `targetSdk` 34 và 35 đã kiểm, 36 chưa |
| 18 | App có bản **iOS** không? Bản nào cần chat? App có dùng Flutter, React Native hoặc Kotlin Multiplatform không? | hỏi trực tiếp | SDK này chỉ cho Android. iOS mới có hướng dẫn WKWebView (app Partner iOS 8.1.0 đã được nhắc tới), chưa có SDK; cần chốt phạm vi và thời điểm. Flutter, React Native, KMP: màn chat phải đặt trong Activity hoặc view native của Android |
| 19 | Build có chạy **offline**, khóa phiên bản (dependency locking), **kiểm tra checksum thư viện** (dependency verification), hoặc bắt buộc mọi thư viện đi qua Artifactory nội bộ không? | `gradle/verification-metadata.xml`, `*.lockfile`, cấu hình CI | Có kiểm tra checksum: họ thêm checksum của nhóm `site.amoeba.shoptalk` (mỗi tệp có sẵn `.sha256`). Chỉ được dùng Artifactory: tải thư mục Maven lên đó. Offline: dùng thư mục Maven trong repo |

## B. Cần biết để thiết kế đúng

| # | Câu hỏi | Vì sao hỏi |
|---|---|---|
| 8 | Màn chat mở dạng Activity toàn màn hay nằm dưới thanh công cụ của app? | quyết định header native hay header của widget, và cách đệm thanh trạng thái |
| 9 | App dùng điều hướng nào: Navigation Component, Compose Navigation, tự quản lý? | cách đóng màn chat khi widget bấm nút đóng (`onCloseRequest`) |
| 10 | Cấu hình bảo mật mạng: `network_security_config`, ghim chứng chỉ (certificate pinning), proxy hoặc WAF chặn tên miền lạ? | widget tải từ tên miền của Amoeba; nếu bị chặn thì màn chat trống |
| 11 | Có SDK hay thư viện nào khác dùng WebView, `CookieManager` hay `addJavascriptInterface` chung trong app không? | tránh xung đột cờ WebView toàn cục |
| 12 | Bật R8 full mode, có `-dontobfuscate` hoặc rule riêng? Có kiểm tra APK tự động trong CI? | quy tắc giữ lại của SDK đi kèm AAR; cần biết nếu CI chặn cảnh báo |
| 13 | Dòng máy tối thiểu cần hỗ trợ: Android 7 và 8 còn bao nhiêu phần trăm người dùng? Có máy không có Google Play Services (Huawei)? | WebView trên máy cũ hoặc không có Google quản lý khác nhau; Amoeba cần thử máy thật |
| 14 | Ngôn ngữ: app đổi ngôn ngữ lúc chạy hay theo hệ thống? Cần hỗ trợ những ngôn ngữ nào ở màn chat? | SDK nhận `locale`; cần biết khi nào gọi lại |
| 15 | Ai viết endpoint ký danh tính phía backend của Go2Joy, và khi nào? | app chỉ chuyển tiếp chữ ký; thiếu endpoint thì khách luôn là khách vãng lai |

## C. Cách lấy nhanh các câu trả lời kỹ thuật (câu 1 đến 5 và 17)

Chạy trong thư mục dự án app rồi gửi kết quả:

```bash
./gradlew --version
grep -nE "kotlin|agp|minSdk|targetSdk|compileSdk" gradle/libs.versions.toml app/build.gradle* build.gradle* 2>/dev/null
./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep -E "androidx.(fragment|core:core|appcompat|activity|lifecycle:lifecycle-runtime)|kotlin-stdlib" | sort -u
```

## D. Kiểm tra nhanh sau khi nhận thư viện

Amoeba gửi kèm app mẫu (`sdk/android/sample`). Đội Android chạy `./gradlew :sample:installDebug` trên một máy thật, trỏ tới môi trường
staging của Amoeba, để xác nhận WebView và mạng của họ chạy được trước khi nhúng vào app chính.
