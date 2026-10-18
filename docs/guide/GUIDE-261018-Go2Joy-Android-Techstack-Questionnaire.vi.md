# Câu hỏi về nền tảng Android của Go2Joy (gửi trước khi giao SDK)

> Gửi cho đội Android của Go2Joy. Mục đích: bảo đảm thư viện SharpTalk (file AAR, Kotlin) cài vào và chạy được ngay, không phải
> thử sai trên máy của họ. Mỗi câu có chỗ lấy câu trả lời trong dự án và nêu Amoeba sẽ làm gì tùy câu trả lời.
> Cơ sở: Amoeba đã thử AAR với nhiều cấu hình app giả lập (TCR-261016 §7). Go2Joy mới cho biết Kotlin 2.2.0; các mục còn lại chưa biết.

## A. Bắt buộc trả lời (mỗi câu có thể làm hỏng việc cài đặt)

| # | Câu hỏi | Lấy ở đâu | Nếu câu trả lời là… |
|---|---|---|---|
| 1 | Phiên bản Kotlin chính xác trong app? | `gradle/libs.versions.toml` hoặc `build.gradle` gốc, dòng `kotlin` | 2.1.0 trở lên: dùng được. Dưới 2.1: AAR không đọc được, Amoeba phải build lại bằng Kotlin thấp hơn hoặc giao mã nguồn |
| 2 | `minSdk` của app? | `app/build.gradle(.kts)`, `defaultConfig` | 21 trở lên: dùng được (21 đến 23 chưa chạy thử máy thật, Amoeba thử trên máy của họ). Dưới 21: cần bàn |
| 3 | Màn hình dựng bằng Jetpack Compose, XML hay cả hai? | màn nơi sẽ đặt nút "Hỗ trợ" | XML: dùng Fragment trực tiếp. Compose: dùng thêm module Compose, xem câu 4 |
| 4 | Activity chứa màn chat kế thừa lớp nào? | tìm `class ... : XxxActivity()` | `AppCompatActivity` hoặc `FragmentActivity`: dùng được. **`ComponentActivity` thuần (mẫu Compose của Android Studio): màn chat sập**, phải đổi lớp cha và theme sang AppCompat |
| 5 | Phiên bản AGP và Gradle? | `gradle/libs.versions.toml` mục `agp`, `gradle/wrapper/gradle-wrapper.properties` | Đã thử AGP 8.5.2 và 8.10.1. Dưới 8.5 thì Amoeba thử thêm |
| 6 | Mã Java trong app có gọi SDK không? | tìm các tệp `.java` ở màn sẽ nhúng | Không cần thay gì: hàm tạo ngắn cho Java đã có. Hỏi để biết có phải kiểm thêm phía Java không |
| 7 | App phân phối thư viện cách nào: file AAR đặt vào `libs/`, hay Maven riêng (Artifactory, Nexus, GitHub Packages)? | cách đang dùng cho SDK khác (bản đồ, thanh toán) | Maven riêng: Amoeba đóng gói thêm POM để khỏi phải tự khai báo androidx. AAR: dùng như hướng dẫn |

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

## C. Cách lấy nhanh các câu trả lời kỹ thuật (A1 đến A5)

Chạy trong thư mục dự án app rồi gửi kết quả:

```bash
./gradlew --version
grep -nE "kotlin|agp|minSdk|targetSdk|compileSdk" gradle/libs.versions.toml app/build.gradle* build.gradle* 2>/dev/null
./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep -E "androidx.fragment|androidx.core:core|androidx.appcompat|androidx.activity"
```

## D. Kiểm tra nhanh sau khi nhận AAR

Amoeba gửi kèm app mẫu (`sdk/android/sample`). Đội Android chạy `./gradlew :sample:installDebug` trên một máy thật, trỏ tới môi trường
staging của Amoeba, để xác nhận WebView và mạng của họ chạy được trước khi nhúng vào app chính.
