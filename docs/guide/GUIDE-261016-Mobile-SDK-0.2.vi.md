# Hướng dẫn tích hợp SharpTalk vào app Android (Kotlin SDK 0.2.0)

> **Đối tượng.** Dev app Go2Joy (Kotlin 2.2.0). **Phiên bản.** SDK 0.2.0, cập nhật 2026-10-19 (cách giao và yêu cầu androidx).
> **Tham chiếu.** `PLN-261015-Go2Joy-Kotlin-SDK-0.2`, `REQ-261015-Go2Joy-Kotlin-App-Widget`,
> `sdk/android/README.md`, hợp đồng bridge `모바일SDK연동가이드_Mobile-SDK.ko.md`, chữ ký danh tính
> `임베드SDK설치가이드_Embed-SDK.ko.md` §3.4.

SDK là một thư viện nhỏ bọc **cùng một widget** mà web đang dùng trong WebView. Sửa nội dung, theme, agent trên console thì
app nhận ngay, không cần phát hành lại. App chỉ cần: mở màn chat, đưa danh tính đã ký, đóng màn khi widget yêu cầu.

## 1. Cài đặt

### 1.1 Yêu cầu của app chủ

Tất cả đã kiểm bằng app thử chạy trên emulator (TCR-261016 mục 7, 10 và 11).

| Hạng mục | Yêu cầu | Ghi chú |
|---|---|---|
| Kotlin | **2.1.0 trở lên** | Thư viện build bằng 2.2.0. Kotlin 2.0.x trở xuống không đọc được (trình biên dịch dừng với lỗi nội bộ). App dùng Kotlin 2.1 vẫn giữ stdlib 2.1 của mình, không bị kéo lên 2.2.0 |
| `minSdk` | **21 trở lên** | Thấp hơn thì lỗi gộp manifest. Đã chạy thật trên máy ảo Android 5.0 (API 21), 6.0 (API 23), 15 (API 35) và 16 (API 36); chưa thử trên điện thoại thật. Trên Android 5.x lỗi HTTP 4xx/5xx của trang không được báo riêng, chỉ có lỗi mạng và hết 15 giây chờ |
| `compileSdk`, `targetSdk` | Không đòi mức tối thiểu | SDK không ép app nâng `compileSdk`. Đã build thử với `compileSdk` và `targetSdk` từ 30 đến 36 (mức 36 chạy trên máy ảo Android 16). Lưu ý: nếu app tự khai báo androidx mới thì chính thư viện đó có thể đòi `compileSdk` cao (xem 1.3) |
| androidx của app | **fragment-ktx 1.3.6, core-ktx 1.6.0, lifecycle-runtime-ktx 2.3.1, activity 1.2.4 trở lên** | Đây là mức thấp nhất đã chạy (androidx năm 2021). **fragment 1.2.5 và activity 1.1.0 (năm 2020) làm app sập ngay khi tạo fragment** vì chưa có API kết quả hoạt động. Nhận qua Maven thì Gradle tự nâng lên mức này; app có bản cao hơn thì giữ nguyên |
| Android System WebView của máy | **Chrome 80 trở lên** | Widget là ứng dụng web hiện đại. WebView cũ hơn tải được trang nhưng không chạy được, nên sau 15 giây SDK hiện màn lỗi "cập nhật Android System WebView". Máy có Google Play tự cập nhật WebView; máy không có (hoặc đã tắt cập nhật) thì không dùng được chat |
| JVM của app | 11 hoặc 17 | Cả hai đều đã kiểm |
| AGP | 8.5.2 và 8.10.1 đã kiểm | Thư viện không đòi AGP tối thiểu |
| Activity chủ | `FragmentActivity` (`AppCompatActivity` cũng là một) | `ComponentActivity` thuần sẽ báo lỗi ngay, xem mục 8 |
| Mã Java | Dùng được | `ShopTalkConfig`, `ShopTalkContext`, `ShopTalkAttachments` có hàm tạo ngắn cho Java |

### 1.2 Nhận thư viện: thư mục Maven (khuyên dùng)

Amoeba giao tệp `shoptalk-android-0.2.0-maven.zip` (khoảng 160 KB) kèm mã SHA-256 của tệp zip. Bên trong là một kho Maven nhỏ: AAR, tệp POM
khai báo các thư viện cần thiết, siêu dữ liệu Gradle, mã nguồn và checksum cho từng tệp. Không commit tệp này vào repo của Amoeba;
trong repo của Go2Joy thì tùy đội.

**Cách A: để thư mục trong repo của app** (không cần Artifactory):

```bash
unzip shoptalk-android-0.2.0-maven.zip -d third_party/shoptalk-maven
```

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven {
            url = uri("third_party/shoptalk-maven")
            content { includeGroup("site.amoeba.shoptalk") }   // chỉ nhóm của Amoeba lấy từ thư mục này
        }
    }
}
```

```kotlin
// app/build.gradle.kts: MỘT dòng, không cần khai báo androidx nào thêm
dependencies {
    implementation("site.amoeba.shoptalk:shoptalk-android:0.2.0")
    // Chỉ khi app dùng Compose (mục 8); tự kéo theo shoptalk-android và fragment-compose:
    // implementation("site.amoeba.shoptalk:shoptalk-compose:0.2.0")
}
```

**Cách B: công ty đã có Artifactory, Nexus hoặc GitHub Packages.** Tải nguyên nội dung thư mục lên kho đó (giữ cấu trúc
`site/amoeba/shoptalk/...`). App chỉ cần hai đoạn trên, thay đường dẫn bằng địa chỉ kho của họ.

Vì sao dùng cách này:
- POM chỉ nêu **mức thấp nhất** của androidx và stdlib. Gradle chọn bản cao hơn giữa app và thư viện, nên app giữ androidx của mình, không bị nâng
  bản và không bị ép nâng `compileSdk`. Đã kiểm: app có fragment 1.5.7 và core-ktx 1.10.1 vẫn giữ nguyên hai bản đó; app Kotlin 2.1.20 vẫn giữ stdlib 2.1.20.
- App quá cũ (fragment 1.2.5) cũng được Gradle tự nâng lên 1.3.6, thay vì sập.
- Nâng phiên bản sau này chỉ là đổi số trong một dòng; có mã nguồn và checksum để kiểm tra.
- Nếu build của họ bật kiểm tra checksum thư viện (dependency verification), cần thêm checksum của `site.amoeba.shoptalk` vào tệp xác minh;
  mỗi tệp trong thư mục có sẵn `.sha256`.

### 1.3 Phương án dự phòng: tệp AAR trần

Dùng khi build không cho thêm kho. AAR nằm trong zip tại `site/amoeba/shoptalk/shoptalk-android/0.2.0/shoptalk-android-0.2.0.aar`
(Amoeba cũng gửi riêng nếu cần). **AAR không có POM, nên app phải tự có các thư viện sau, từ phiên bản này trở lên:**

```kotlin
// app/build.gradle.kts
dependencies {
    implementation(files("libs/shoptalk-android-0.2.0.aar"))
    // Mức thấp nhất đã chạy. Nếu app ĐÃ có bản cao hơn thì giữ nguyên, đừng hạ; nếu thiếu thì thêm đúng các dòng này.
    implementation("androidx.fragment:fragment-ktx:1.3.6")
    implementation("androidx.core:core-ktx:1.6.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.3.1")
    // Chỉ khi app dùng Compose (mục 8):
    // implementation(files("libs/shoptalk-compose-0.2.0.aar"))
    // implementation("androidx.fragment:fragment-compose:1.8.5")
}
```

> ⚠️ **Đừng dán phiên bản androidx mới nhất "cho chắc".** Phiên bản cũ của hướng dẫn này ghi `core-ktx:1.15.0` và `fragment-ktx:1.8.5`.
> Dán nguyên văn vào app có `compileSdk 34` thì **build thất bại** (core 1.15.0 đòi `compileSdk` 35, fragment 1.8.5 đòi 34). Dùng đúng mức tối thiểu ở trên
> hoặc giữ bản app đang có.

Muốn nhúng dạng mã nguồn: `include(":shoptalk")` (và `":shoptalk-compose"`) trỏ tới thư mục trong `sdk/android`.

Quyền `INTERNET`, `FileProvider` cho camera và khai báo `<queries>` đã nằm trong manifest của thư viện, tự gộp vào app. Không cần khai báo thêm.
Thư viện không chứa mã native (`.so`), nên không vướng yêu cầu trang bộ nhớ 16 KB của Google Play.

## 2. Mở màn chat

```kotlin
class SupportActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_support)          // có một FrameLayout id container
        if (savedInstanceState == null) {
            val chat = ShopTalkChatFragment.newInstance(
                ShopTalkConfig(
                    widgetUrl = cfg.widgetUrl,   // staging: https://shoptalk.amoeba.site/widget/
                    shop = cfg.shop,             // "https://www.go2joy.vn"
                    agent = cfg.agent,           // "hotel-admin"
                    locale = "vi",
                )
            )
            supportFragmentManager.commit { replace(R.id.container, chat, CHAT_TAG) }
        }
    }

    // GẮN Ở ĐÂY, mỗi lần: lần đầu và cả sau khi Activity bị tạo lại.
    override fun onResumeFragments() {
        super.onResumeFragments()
        (supportFragmentManager.findFragmentByTag(CHAT_TAG) as? ShopTalkChatFragment)?.apply {
            identityProvider = ShopTalkIdentityProvider { api.sharpTalkIdentity() }   // mục 3
            listener = object : ShopTalkListener {
                override fun onCloseRequest() { finish() }                              // BẮT BUỘC
            }
        }
    }

    private companion object { const val CHAT_TAG = "shoptalk-chat" }
}
```

> ⚠️ **Đừng chỉ gắn `identityProvider` và `listener` trong khối `if (savedInstanceState == null)`.** `identityProvider` và `listener` là trường thường,
> không được lưu. Khi Activity bị tạo lại (dark mode, đổi cỡ chữ hệ thống, xoay màn nếu Activity không tự xử lý), `FragmentManager` dựng một
> fragment **mới** không có hai trường này: người dùng chat như khách và **không có lỗi nào báo ra**. Đã tái hiện trên emulator: mẫu gắn một lần mất
> nhận diện sau khi bật dark mode, mẫu gắn trong `onResumeFragments` thì vẫn nhận diện lại (TCR-261016 mục 11).
>
> Cũng đừng gọi `findFragmentByTag` ngay sau `commit { }` trong `onCreate`: `commit` chạy bất đồng bộ nên lúc đó chưa có fragment. Cần ngay
> thì dùng `commitNow { }`, hoặc gắn trong `onResumeFragments` như trên.

### 2.1 Giá trị cấu hình

| Tham số | Giá trị Go2Joy | Ghi chú |
|---|---|---|
| `widgetUrl` | Staging: `https://shoptalk.amoeba.site/widget/` | Bắt buộc `https`. Self-hosted (đề xuất `sharptalk.go2joy.vn`, DNS chưa có) đổi sau M3. **Đặt trong remote config của app** để đổi không cần phát hành |
| `shop` | `https://www.go2joy.vn` | **Khóa tra tenant** (khớp `tenants.shop_domain`), **không phải domain của app** |
| `agent` | `hotel-admin` | Agent của giai đoạn 1; mỗi điểm vào có thể ghim agent khác |
| `locale` | `vi` | Ngôn ngữ giao diện ban đầu (en, es, ko, vi, ja, zh). Gửi qua bridge, không nằm trong URL. `setLocale()` đổi sau đó và đổi luôn chữ của màn lỗi, hộp chọn đính kèm |
| `accessKey` | (tùy) | Chỉ khi tenant bật kiểm soát truy cập widget; gửi dạng `?access=` |
| `header` | `null` (mặc định) | `null`: không gửi tham số, **admin chọn trên console** header widget hay header native. `NATIVE`: ẩn header widget, app tự vẽ toolbar (`chrome=native`). `WIDGET`: ép dùng header widget (`chrome=widget`). Giá trị app đặt luôn thắng cài đặt admin |
| `startTab` | `null` | Tab mở khi widget sẵn sàng (`CHAT`, `ORDERS`, `NOTIFICATIONS`) |
| `attachments` | `camera = true, multiple = true` | Xem mục 6 |
| `errorHotline` | `"1900 638 838"` (ví dụ) | Hiện trên màn lỗi, chạm để gọi |
| `allowInsecureUrl` | `false` | **Chỉ debug.** Cho phép `http://` tới `localhost`, `127.0.0.1`, `10.0.2.2` (emulator tới máy dev). Host http khác vẫn bị từ chối. Sai cấu hình thì `ShopTalkConfig(...)` ném `IllegalArgumentException` ngay khi tạo |

## 3. Danh tính: backend ký, app chỉ chuyển tiếp

Nguyên tắc: **secret không bao giờ nằm trong app.** HMAC do backend Go2Joy tạo bằng secret trong biến môi trường (secret phát ở
console: Cài đặt tenant › Cài đặt widget › card "Nhúng & SDK" › "Liên kết đăng nhập").

### 3.1 Luồng

```
App mở màn chat ──► widget báo ready ──► SDK gọi identityProvider.identity()
                                              │
                                              ▼
                        App gọi backend Go2Joy (xác thực bằng token của app)
                                              │  trả về gói đã ký { userId, hash, attributes, ... }
                                              ▼
                  SDK gửi nguyên văn gói đó cho widget (ivy:identify) ──► onIdentified(ok)
```

SDK **không đọc, không sửa, không cache** gói danh tính; chỉ kiểm tra có `userId` và `hash` (chuỗi không rỗng). Vì vậy app không
phải đổi code khi hợp đồng ký đổi (`attributes` hay `claims`). Provider được gọi **mỗi lần** cần: widget ready, mỗi lần reload,
và khi widget báo `identity-expired`. Chữ ký luôn mới, không bao giờ gửi lại chữ ký cũ.

```kotlin
chat.identityProvider = ShopTalkIdentityProvider {
    // Chạy trên main; chuyển luồng cho mạng.
    withContext(Dispatchers.IO) {
        val json = api.sharpTalkIdentity()          // GET /api/sharptalk/identity, đã xác thực
        ShopTalkIdentity.fromJson(json)             // ném IllegalArgumentException nếu thiếu userId/hash
    }
}
```

- Trả `null` = chưa ai đăng nhập: người dùng chat với tư cách khách. Nếu trước đó **đã có người được nhận diện trên máy này**, SDK tự
  đăng xuất widget (về khách mới) trước khi tiếp tục. Nếu chưa từng có ai, SDK không động tới hội thoại khách.
- Provider ném lỗi: SDK gọi `onError(ShopTalkError.IdentityProviderFailed(cause))` và **không đổi gì** (lỗi backend của app không nói được ai đang đăng nhập).
- **Tự đăng xuất khi đổi người dùng.** SDK nhớ dấu vết SHA-256 của `userId` lần nhận diện trước, theo từng widget và cửa hàng, trong
  `SharedPreferences` riêng của app (không lưu `userId` thô). Khi `userId` mới khác, hoặc provider trả `null` sau một người dùng,
  SDK gửi `logout` rồi mới `identify`. Nhờ vậy người sau không vào nhầm hội thoại của người trước dù app quên gọi `logout()`
  (lỗi đã tái hiện trên emulator, TCR-261016 §8 và §9). Cùng một người mở lại app thì giữ nguyên hội thoại.
- Dấu vết chỉ chuyển sang người mới **sau khi widget xác nhận nhận diện**. Trong lúc chờ, nó ở trạng thái "cần reset": nếu app bị tắt, lệnh bị mất
  hoặc chữ ký bị từ chối, lần mở sau chỉ tốn một lần đăng xuất thừa (người đó nhận một phiên mới), không bao giờ lộ hội thoại.
- App vẫn nên gọi `chat.logout()` ở chính chỗ nó xóa phiên đăng nhập của mình: SDK chỉ ra tay ở lần nhận diện kế tiếp, còn `logout()` xóa ngay.
- Xóa dữ liệu app hoặc cài lại thì dấu vết mất theo WebView; khôi phục sao lưu sang máy khác có thể mang dấu vết nhưng không mang WebView, hậu quả
  chỉ là một lần đăng xuất thừa.
- `chat.identify(identity)` thủ công vẫn còn nhưng **chỉ gửi một lần**, không gửi lại khi reload. Dùng provider cho app thật.
- `ShopTalkUser` (0.1.0) còn biên dịch được nhưng đã deprecated.

### 3.2 Backend ký (Node.js, ví dụ)

Chuỗi ký = `userId` + xuống dòng + từng dòng `khóa=giá trị` **theo thứ tự chữ cái của khóa**. Khóa cho phép:
`hotel_id`, `hotel_name`, `region`, `province`, `role`; giá trị ≤ 120 ký tự, không xuống dòng; **giá trị rỗng phải bỏ khỏi cả
`attributes` lẫn chuỗi ký.** `region` nên là `north` / `central` / `south`.

```js
// GET /api/sharptalk/identity — dùng chung cho web và app
const attrs = { hotel_id: 'H-1024', hotel_name: 'A In Hotel', region: 'south', role: 'reception' };
const signing = [String(user.id), ...Object.keys(attrs).sort().map((k) => `${k}=${attrs[k]}`)].join('\n');
const hash = crypto.createHmac('sha256', process.env.SHOPTALK_EMBED_SECRET).update(signing).digest('hex');
res.json({ userId: String(user.id), hash, name: user.name, attributes: attrs });
```

Gửi `attributes` mà chỉ ký `userId` thì bị **từ chối** (chặn việc sửa vùng để đổi nhân viên tiếp nhận). Hợp đồng `claims`
(chữ ký có `iat`, hết hạn) chưa hợp nhất; khi đó backend đổi chuỗi ký, **app không đổi**. Tự kiểm bằng
`POST /public/embed/identify` trên staging trước khi nhúng vào app.

## 4. Listener

```kotlin
object : ShopTalkListener {
    override fun onCloseRequest() { finish() }                 // bắt buộc: đóng màn khi người dùng bấm X hoặc Back
    override fun onReady() {}
    override fun onIdentified(ok: Boolean) {}                  // ok=false: chữ ký bị từ chối, vẫn chat như khách
    override fun onIdentityExpired() {}                        // SDK đã tự xin chữ ký mới, chỉ để biết
    override fun onOpenUrl(url: Uri): Boolean = false          // true = app tự xử lý; false = SDK mở ACTION_VIEW
    override fun onUnread(count: Int) {}                       // badge trên menu của app
    override fun onError(error: ShopTalkError) {}
}
```

Tất cả method trừ `onCloseRequest` có mặc định rỗng. Exception ném trong listener bị chặn và ghi log, không làm hỏng WebView.

`onOpenUrl`: chỉ link `http`, `https`, `mailto`, `tel` tới được đây; scheme khác (`intent:`, `file:`, `content:`...) bị SDK chặn. Link
từ widget (`ivy:open-url`) chỉ cho `http`/`https`.

`ShopTalkError`: `LoadFailed(code, description)`, `LoadTimeout`, `IdentityProviderFailed(cause)`, `BridgeMalformed`.
SDK không log `userId`, `hash`, nội dung tin nhắn hay đường dẫn tệp; app cũng đừng log chúng.

## 5. Điều khiển từ app

| Gọi | Tác dụng |
|---|---|
| `chat.open(ShopTalkTab.ORDERS)` | Mở tab |
| `chat.setLocale("vi")` | Đổi ngôn ngữ (được áp lại sau reload) |
| `chat.setContext(ShopTalkContext(screen, ref, label, prefill))` | Hiện chip "đang ở màn nào", điền sẵn ô nhập nếu đang trống; ngữ cảnh đi kèm tin kế tiếp. `setContext(null)` bỏ chip. Được áp lại sau reload |
| `chat.openSettings()` | Mở Tùy chọn (ngôn ngữ, quyền riêng tư) |
| `chat.endConversation()` | Kết thúc hội thoại (như nút "Kết thúc" của widget) |
| `chat.reload()` | Tải lại widget, hỏi lại provider |
| `chat.logout()` | Về khách |

Vào chat từ màn đặt phòng:

```kotlin
chat.setContext(ShopTalkContext(
    screen = "bookings", ref = "#G2J-8841", label = "Đặt phòng #G2J-8841",
    prefill = "Khách không đến, tôi cần báo no-show",
))
```

Mọi lệnh gọi trước khi widget sẵn sàng được xếp hàng (tối đa 20), không mất.

Khi dùng `header = ShopTalkHeader.NATIVE`, app vẽ toolbar riêng (back, tiêu đề, menu ⋮) và gọi `setLocale`, `openSettings`,
`endConversation` từ menu. Nút Back của toolbar nên gọi cùng đường với nút Back hệ thống (`onBackPressedDispatcher.onBackPressed()`).

**Nút Back.** SDK tự đăng ký xử lý Back: gửi lệnh `back` cho widget; nếu widget đang mở Tùy chọn hoặc hộp thoại và đáp
`handled: true` thì Back chỉ đóng phần đó; nếu không (hoặc widget cũ không đáp trong 500 ms, hoặc đang ở màn lỗi) thì gọi
`onCloseRequest()`.

## 6. Đính kèm và camera

Bấm nút đính kèm trong widget mở hộp chọn của SDK: **Chụp ảnh**, **Chọn từ thư viện** (đa chọn), **Tệp** (PDF, Excel, Word...).

- Chụp ảnh dùng app camera hệ thống (`ACTION_IMAGE_CAPTURE`) với `FileProvider` của SDK (authority
  `${applicationId}.shoptalk.fileprovider`). **Không cần quyền CAMERA.**
- Mục "Chụp ảnh" tự ẩn khi máy không có app camera, khi `attachments.camera = false`, hoặc khi ô chọn tệp không nhận ảnh.
- Hủy chọn luôn trả `null` cho WebView (nếu không, các lần chọn sau sẽ không mở được). Xoay màn hình khi hộp chọn đang mở an toàn.
- ⚠️ **Đừng khai báo `android.permission.CAMERA` trong manifest của app** trừ khi app thật sự dùng và xin quyền lúc chạy: khai báo
  mà chưa được cấp thì intent chụp ảnh của hệ thống ném `SecurityException`. SDK sẽ lùi về thư viện nhưng nút chụp không hoạt động.
- Ảnh chụp lưu tạm ở `cacheDir/shoptalk_capture`, tự dọn tệp quá 24 giờ.

## 7. Màn lỗi, giao diện sáng, bảo mật

- **Màn lỗi native** thay cho màn trắng khi trang chính không tải được (mất mạng, DNS, TLS, HTTP ≥ 400) hoặc **15 giây** không có
  `ivy:ready`. Có thông điệp, nút **Thử lại** (gọi `reload()`) và số hotline nếu có `errorHotline` (chạm để gọi, `ACTION_DIAL`).
  Đồng thời phát `onError(LoadFailed | LoadTimeout)`. Khi hết 15 giây mà WebView của máy cũ hơn Chrome 80, thông điệp đổi thành
  "cập nhật Android System WebView trong Google Play" (6 ngôn ngữ); chỉ đổi lời nhắn, không chặn gì nếu SDK đoán nhầm.
- Nút **Thử lại** lấy màu thương hiệu của app: `colorPrimary` của theme app (AppCompat, MaterialComponents, Material 3), nếu không có thì
  `android:colorAccent`, nếu cũng không thì nút mặc định của hệ thống.
- **StrictMode:** SDK không đọc ghi đĩa hay mạng trên luồng giao diện (bộ nhớ chủ phiên chạy trên luồng riêng). Riêng việc hệ thống tạo WebView
  lần đầu trên Android 5 đến 6 là một vi phạm đọc đĩa của chính Android; app chạy `penaltyDeath` cần bỏ qua đoạn đó.
- **Ép sáng**: widget chưa có dark mode, SDK tắt tối hóa thuật toán của WebView (API 33+ `isAlgorithmicDarkeningAllowed = false`; API
  29-32 `FORCE_DARK_OFF`). Nền màn chat luôn trắng dù app đang theme tối.
- **Bridge chỉ hoạt động khi URL chính cùng origin (scheme, host, port) với `widgetUrl`.** Link ngoài mở bằng trình duyệt hệ thống,
  không bao giờ điều hướng trong WebView chat.
- Chỉ `https` ngoài debug. `allowFileAccess` của WebView tắt.

## 8. Compose

Module riêng, không kéo Compose vào AAR lõi. Activity chủ phải là `FragmentActivity` (`AppCompatActivity` cũng được).

> ⚠️ **Mẫu Compose chuẩn của Android Studio tạo `MainActivity : ComponentActivity()`.** Với Activity đó, màn chat **sập ngay khi mở**:
> `IllegalStateException: View ...AndroidComposeView is not within a subclass of FragmentActivity` (đã chạy thật trên Android 15).
> Cách sửa: đổi lớp cha thành `AppCompatActivity` (và dùng theme AppCompat, ví dụ `Theme.AppCompat.Light.NoActionBar` hoặc theme Material
> kế thừa nó) hoặc `FragmentActivity`. `setContent { ... }` vẫn dùng như cũ.

```kotlin
implementation("site.amoeba.shoptalk:shoptalk-compose:0.2.0")   // kéo theo shoptalk-android và fragment-compose qua POM (mục 1.2)
// Dùng AAR trần thì thêm hai AAR và fragment-compose:1.8.5 như mục 1.3. fragment-compose 1.8.x đòi compileSdk 34 trở lên.

@Composable
fun SupportScreen(onClose: () -> Unit) {
    ShopTalkChat(
        config = remember { ShopTalkConfig(widgetUrl = cfg.widgetUrl, shop = cfg.shop, agent = cfg.agent) },
        identityProvider = ShopTalkIdentityProvider { api.sharpTalkIdentity() },
        listener = remember { object : ShopTalkListener { override fun onCloseRequest() = onClose() } },
        modifier = Modifier.fillMaxSize(),
    )
}
```

`ShopTalkChat` dùng `androidx.fragment.compose.AndroidFragment` (fragment-compose 1.8.5). `config` chỉ đọc một lần khi fragment
được tạo; `identityProvider` và `listener` được áp lại mỗi lần recompose. Muốn gọi `setContext`, `openSettings`... thì giữ fragment
từ tham số `onFragment`. Nếu không muốn `fragment-compose`: dùng `AndroidView { FragmentContainerView }` rồi `commit` fragment như mục 2.

## 9. Thử nhanh bằng app mẫu (adb)

`sdk/android/sample` mô phỏng app Go2Joy (provider qua `FakeBackend`, toolbar native, nút ngữ cảnh). Mọi giá trị đặt được qua adb:

```bash
adb shell am start -n site.amoeba.shoptalk.sample/.MainActivity \
  -e widget_url https://shoptalk.amoeba.site/widget/ -e shop https://www.go2joy.vn -e agent hotel-admin \
  -e locale vi -e header native -e hotline "1900 638 838" \
  -e user_id 42 -e user_hash <hmac> -e attributes '{"hotel_id":"H-1024","role":"reception"}'
# gói nguyên văn (kiểu claims): -e identity_json '{"userId":"42","hash":"...","claims":{...}}'
# widget chạy local trên emulator: -e widget_url http://10.0.2.2:5174/ --ez insecure true
```

## 10. Danh sách kiểm tra

| ✓ | Mục | Vì sao |
|---|---|---|
| ☐ | `onCloseRequest()` đóng màn | Widget chiếm cả màn; không đóng thì còn màn trắng |
| ☐ | `identityProvider` và `listener` gắn trong `onResumeFragments`, không chỉ khi tạo mới | Activity tạo lại (dark mode, cỡ chữ) thì fragment mới không có hai trường này: người dùng chat như khách, không có lỗi |
| ☐ | Thư viện lấy qua thư mục Maven (hoặc AAR kèm đúng mức tối thiểu ở 1.3); **không** dán androidx mới nhất | `core-ktx 1.15` đòi `compileSdk` 35 và làm hỏng build; fragment 1.2.x làm app sập |
| ☐ | Secret chỉ ở backend; `hash` do backend ký mỗi lần | Secret trong APK bị lấy ra được |
| ☐ | `identityProvider` được đặt (không dùng `identify()` một lần cho app thật) | Chữ ký có thể hết hạn; SDK không còn cache |
| ☐ | `shop` là `https://www.go2joy.vn`, `agent` là `hotel-admin`, `widgetUrl` lấy từ remote config | Tra tenant, đổi địa chỉ không cần phát hành |
| ☐ | Chuỗi ký `attributes`: `userId\nkhóa=giá trị`, khóa theo thứ tự chữ cái, bỏ giá trị rỗng | Sai là bị từ chối, chat như khách |
| ☐ | Không khai báo `CAMERA` nếu không dùng | Tránh `SecurityException` khi chụp ảnh |
| ☐ | `errorHotline` đã điền | Màn lỗi có lối thoát |
| ☐ | Đổi tài khoản: mở app với `userId` khác (không gọi `logout()`) | Người mới thấy hội thoại trống, người cũ còn nguyên hội thoại của mình |
| ☐ | `allowInsecureUrl` chỉ trong build debug | Release phải https |
| ☐ | Giữ `consumer-rules.pro` (đã nằm trong AAR) khi bật minify | `@JavascriptInterface` phải còn |
| ☐ | Không log `userId`, `hash`, nội dung chat | NFR-M01 |
| ☐ | Kiểm trên máy thật: ảnh chụp, thư viện, tệp, tắt mạng, xoay ngang, cỡ chữ 130 % | WebView khác nhau theo máy; máy phải có Android System WebView từ Chrome 80 |

## 11. Giới hạn đã biết ở 0.2.0

- **Đổi cấu hình lúc đang chạy** (dark mode, cỡ chữ hệ thống; xoay màn nếu Activity không khai báo `configChanges`) làm Activity bị tạo lại: widget tải
  lại trong khoảng 2 giây và `identityProvider` được gọi lại để ký (backend của app phải chịu được việc này). Chip ngữ cảnh được SDK khôi phục
  (không kèm chữ điền sẵn). Muốn tránh tải lại, khai báo `android:configChanges="orientation|screenSize|uiMode|fontScale|keyboardHidden"` cho Activity chứa chat.
- Màn ngang dùng được nhưng vùng tin nhắn thấp; nên khóa dọc cho Activity chat nếu thiết kế cho phép.
- Hộp chọn tệp dùng giao diện của theme app chủ (AlertDialog); màn lỗi chỉ đổi màu nút, không đổi biểu tượng và kiểu chữ.
- Trên máy rất cũ (Android 5 đến 6) không có Play Services để cập nhật WebView, chat không chạy được; SDK báo bằng màn lỗi sau 15 giây.
- Android 5.0 đến 5.1: bộ chọn ảnh hệ thống của emulator không kiểm được (thẻ nhớ ảo chỉ đọc); hộp chọn đính kèm, hủy rồi mở lại, màn lỗi và hết giờ chờ đã kiểm.
- Chưa có push nền, badge ngoài màn chat (chỉ `onUnread` khi màn đang mở), dark mode của widget, iOS.
- Hội thoại gắn với session trên thiết bị; web và app không nối tiếp nhau.
- SDK 0.2.0 chưa tự gọi `GET /public/widget/app-config`; widget gọi để áp cấu hình admin (kể cả `header` khi app để `null`).
- Bridge (`addJavascriptInterface`) gắn vào mọi frame của trang; SDK chặn theo origin của frame chính, không phân biệt iframe con.
