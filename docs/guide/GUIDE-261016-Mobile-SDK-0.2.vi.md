# Hướng dẫn tích hợp SharpTalk vào app Android (Kotlin SDK 0.2.0)

> **Đối tượng.** Dev app Go2Joy (Kotlin 2.2.0). **Phiên bản.** SDK 0.2.0, ngày 2026-10-16.
> **Tham chiếu.** `PLN-261015-Go2Joy-Kotlin-SDK-0.2`, `REQ-261015-Go2Joy-Kotlin-App-Widget`,
> `sdk/android/README.md`, hợp đồng bridge `모바일SDK연동가이드_Mobile-SDK.ko.md`, chữ ký danh tính
> `임베드SDK설치가이드_Embed-SDK.ko.md` §3.4.

SDK là một thư viện nhỏ bọc **cùng một widget** mà web đang dùng trong WebView. Sửa nội dung, theme, agent trên console thì
app nhận ngay, không cần phát hành lại. App chỉ cần: mở màn chat, đưa danh tính đã ký, đóng màn khi widget yêu cầu.

## 1. Cài đặt

Yêu cầu: JDK 17, Kotlin 2.2.0 (AAR build bằng 2.2.0; app dùng Kotlin ≤ 2.2.0 đều đọc được), `minSdk 24`, `compileSdk 35`.

Amoeba giao file AAR (không có trên Maven, không commit vào repo):

```kotlin
// app/build.gradle.kts
dependencies {
    implementation(files("libs/shoptalk-android-0.2.0.aar"))
    implementation("androidx.core:core-ktx:1.15.0")         // bỏ nếu app đã có
    implementation("androidx.fragment:fragment-ktx:1.8.5")  // bỏ nếu app đã có
    // Chỉ khi app dùng Compose (xem mục 8):
    // implementation(files("libs/shoptalk-compose-0.2.0.aar"))
}
```

AAR không kéo thêm thư viện nào khác. Quyền `INTERNET`, `FileProvider` cho camera và khai báo `<queries>` đã nằm trong manifest
của AAR, tự gộp vào app. Không cần khai báo thêm.

Muốn nhúng dạng source: `include(":shoptalk")` (và `":shoptalk-compose"`) trỏ tới thư mục trong `sdk/android`.

## 2. Mở màn chat

```kotlin
val chat = ShopTalkChatFragment.newInstance(
    ShopTalkConfig(
        widgetUrl = cfg.widgetUrl,   // staging: https://shoptalk.amoeba.site/widget/
        shop = cfg.shop,             // "https://www.go2joy.vn"
        agent = cfg.agent,           // "hotel-admin"
        locale = "vi",
    )
)
chat.identityProvider = ShopTalkIdentityProvider { api.sharpTalkIdentity() }   // mục 3
chat.listener = object : ShopTalkListener {
    override fun onCloseRequest() { finish() }                                  // BẮT BUỘC
}
supportFragmentManager.commit { replace(R.id.container, chat) }
```

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

- Trả `null` = chưa đăng nhập, người dùng chat với tư cách khách. SDK **không tự logout** khi gặp `null` (giữ hội thoại khách liền mạch).
- Provider ném lỗi: SDK gọi `onError(ShopTalkError.IdentityProviderFailed(cause))` và chat tiếp như khách.
- Đổi tài khoản trên cùng máy: gọi `chat.logout()` rồi `chat.reload()` (provider được hỏi lại).
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
  Đồng thời phát `onError(LoadFailed | LoadTimeout)`.
- **Ép sáng**: widget chưa có dark mode, SDK tắt tối hóa thuật toán của WebView (API 33+ `isAlgorithmicDarkeningAllowed = false`; API
  29-32 `FORCE_DARK_OFF`). Nền màn chat luôn trắng dù app đang theme tối.
- **Bridge chỉ hoạt động khi URL chính cùng origin (scheme, host, port) với `widgetUrl`.** Link ngoài mở bằng trình duyệt hệ thống,
  không bao giờ điều hướng trong WebView chat.
- Chỉ `https` ngoài debug. `allowFileAccess` của WebView tắt.

## 8. Compose

Module riêng, không kéo Compose vào AAR lõi. Activity chủ phải là `FragmentActivity` (`AppCompatActivity` cũng được).

```kotlin
implementation(files("libs/shoptalk-compose-0.2.0.aar"))   // kèm shoptalk-android-0.2.0.aar

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
| ☐ | Secret chỉ ở backend; `hash` do backend ký mỗi lần | Secret trong APK bị lấy ra được |
| ☐ | `identityProvider` được đặt (không dùng `identify()` một lần cho app thật) | Chữ ký có thể hết hạn; SDK không còn cache |
| ☐ | `shop` là `https://www.go2joy.vn`, `agent` là `hotel-admin`, `widgetUrl` lấy từ remote config | Tra tenant, đổi địa chỉ không cần phát hành |
| ☐ | Chuỗi ký `attributes`: `userId\nkhóa=giá trị`, khóa theo thứ tự chữ cái, bỏ giá trị rỗng | Sai là bị từ chối, chat như khách |
| ☐ | Không khai báo `CAMERA` nếu không dùng | Tránh `SecurityException` khi chụp ảnh |
| ☐ | `errorHotline` đã điền | Màn lỗi có lối thoát |
| ☐ | Đổi tài khoản: `logout()` rồi `reload()` | Tránh dính phiên của người trước |
| ☐ | `allowInsecureUrl` chỉ trong build debug | Release phải https |
| ☐ | Giữ `consumer-rules.pro` (đã nằm trong AAR) khi bật minify | `@JavascriptInterface` phải còn |
| ☐ | Không log `userId`, `hash`, nội dung chat | NFR-M01 |
| ☐ | Kiểm trên máy thật: ảnh chụp, thư viện, tệp, tắt mạng, xoay ngang, cỡ chữ 130 % | WebView khác nhau theo máy; API 24 cần WebView đủ mới |

## 11. Giới hạn đã biết ở 0.2.0

- Chưa có push nền, badge ngoài màn chat (chỉ `onUnread` khi màn đang mở), dark mode của widget, iOS.
- Hội thoại gắn với session trên thiết bị; web và app không nối tiếp nhau.
- SDK 0.2.0 chưa tự gọi `GET /public/widget/app-config`; widget gọi để áp cấu hình admin (kể cả `header` khi app để `null`).
- Bridge (`addJavascriptInterface`) gắn vào mọi frame của trang; SDK chặn theo origin của frame chính, không phân biệt iframe con.
