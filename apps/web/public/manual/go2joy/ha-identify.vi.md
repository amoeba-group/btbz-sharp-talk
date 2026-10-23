# Tích hợp đăng nhập Hotel Admin — đặc tả v1.4

> Đặc tả tích hợp người dùng đăng nhập v1.4 dành cho đội phát triển HA của Go2Joy (2026-10-24). Hoàn thành khi mọi mục trong checklist ở đầu tài liệu đều đạt. Lịch trình và người phụ trách: [yêu cầu công việc](work-request.vi.html). Để in hoặc gửi: [PDF](ha-identify.vi.pdf)


> Khi nhân viên HA mở widget trong lúc đang đăng nhập, **HA server ký dữ liệu nhân viên và khách sạn**, và HA FE chuyển gói dữ liệu đó cho widget **nguyên trạng**.
> SharpTalk xác minh chữ ký, đăng ký khách sạn là khách hàng doanh nghiệp và nhân viên là người liên hệ, tiếp nối hội thoại theo từng tài khoản khách sạn, và phân tuyến đến đội phụ trách khu vực của khách sạn.
> **Trong v1.4, HA không tính khu vực.** HA chỉ gửi mã số tỉnh/thành (`province_sn`). SharpTalk xác định tên và khu vực từ danh sách tỉnh/thành của Go2Joy.

| Mục | Chi tiết |
|---|---|
| Gửi đến | Đội phát triển Go2Joy Hotel Admin (HA) (backend, FE) · PM Go2Joy |
| Người gửi | SharpTalk (Amoeba) |
| Ngày / phiên bản | 2026-10-24 · **v1.4** (v1.3 2026-10-22 · v1.0 PDF 2026-10-20 đã hết hiệu lực) |
| Môi trường | HA UAT `https://go2joy-ha-uat.go2joy.io` ↔ SharpTalk staging `https://shoptalk.amoeba.site` · Production là server Go2Joy `https://sharptalk.go2joy.vn` (đang chờ cài đặt) |
| Tài liệu liên quan | [Yêu cầu công việc](GUIDE-261023-Go2Joy-Work-Request.vi.md) (số WR, lịch trình) · [v1.3](GUIDE-261022-Go2Joy-HA-Identify-v1.3.md) (đặc tả trước) |
| Mã mẫu | [sharptalk_identity.php](files/sharptalk_identity.php.txt) · [vectors.php](files/vectors.php.txt) (chạy các test vector) |

---

## ✅ Việc HA cần làm — checklist

**Checklist này là phần cốt lõi của tài liệu.** Một mục được xem là xong khi phần kiểm tra của mục đó đạt.

### A. HA backend (WR-01 · WR-02) — Thứ Ba 10/27
- [ ] **A1. Chỉ lưu khóa ký (embed secret) trong biến môi trường của HA server.** Không đưa vào FE, trình duyệt, ứng dụng, log hay tài liệu. SharpTalk gửi giá trị staging qua kênh bảo mật (vào ngày WR-02 được chốt).
  Kiểm tra: chuỗi secret không xuất hiện ở bất kỳ đâu trong repository hay bundle.
- [ ] **A2. Tạo một endpoint chỉ gọi được khi có phiên đăng nhập** (ví dụ `GET /api/v1/staff/sharptalkIdentity`).
  Kiểm tra: gọi khi chưa đăng nhập trả về 401.
- [ ] **A3. Đọc giá trị từ phiên HA và DB.** Không dựng từ giá trị do trình duyệt gửi lên.
- [ ] **A4. `userId = "ha:" + userSn`.** Dùng mã số nhân viên, giá trị không bao giờ thay đổi. Không dùng ID đăng nhập (`go2joysupport` v.v.).
- [ ] **A5. Đúng 4 thuộc tính**: `hotel_id` · `hotel_name` · `province_sn` · `role`.
  - **Không gửi key nằm ngoài danh sách này**, chẳng hạn `hotel_code`·`hotel_group_id`·`user_id`·`user_sn`·`district` (chúng bị loại khỏi phép tính chữ ký nên sẽ nhận 401).
  - Cũng không gửi `region`·`province` (tên). Trong giai đoạn chuyển tiếp sẽ không bị 401, nhưng `province_sn` được ưu tiên. Sau giai đoạn chuyển tiếp sẽ thành 401.
- [ ] **A6. `province_sn` = `provinceSn` Go2Joy của khách sạn đang chọn** (`sn` của Province Feed, chuỗi số, ví dụ Hồ Chí Minh = `"1"`).
- [ ] **A7. `role` = mã vai trò HA** (giá trị không phụ thuộc ngôn ngữ giao diện). Gửi cho SharpTalk **bảng mã** (mã · tên hiển thị tiếng Việt/tiếng Anh).
- [ ] **A8. Khi chọn "Tất cả khách sạn"**, bỏ `hotel_id` · `hotel_name` · `province_sn` và chỉ ký `role`.
- [ ] **A9. Tuân theo thứ tự chuẩn hóa**: **NFC → gộp khoảng trắng (kể cả NBSP) → trim → 120 ký tự (`mb_substr`)**. Cần extension PHP `intl`·`mbstring`.
- [ ] **A10. Bỏ hẳn giá trị rỗng (loại bỏ field)**. Áp dụng cho các thuộc tính và cho `name` · `email` · `phone` (`email` rỗng trả về 400).
- [ ] **A11. `hash = hex(HMAC-SHA256(secret, chuỗi ký))`**. Chuỗi ký dùng định dạng ở mục 5.1 (key theo thứ tự bảng chữ cái).
- [ ] **A12. Test vector T1 ~ T6 đều khớp** (5.4). Gửi kết quả cho SharpTalk.
- [ ] **A13. Chỉ trả gói phản hồi qua HTTPS cho phiên đã đăng nhập. Không ghi log gói này.**

### B. HA FE (WR-04) — Thứ Tư 10/28
- [ ] **B1. Không dựng gói dữ liệu trong trình duyệt.** **Xóa** `sharptalkSignIn` hiện tại (dựng từ giá trị profile) và giá trị khởi tạo `hash: "testing"`.
- [ ] **B2. Lấy phản hồi của A2 và chuyển nguyên trạng cho `SharpTalk.identify(response)`** (không thêm hay sửa key).
- [ ] **B3. Gọi lại khi**: xác nhận đăng nhập · tải lại trang · **đổi khách sạn đang chọn (kể cả Tất cả khách sạn)** · đổi ngôn ngữ HA.
- [ ] **B4. Gọi `SharpTalk.logout()` khi**: bấm nút đăng xuất · **tự động đăng xuất do hết hạn phiên/token** · ngay trước khi tài khoản khác đăng nhập · đăng xuất ở tab khác (sự kiện `storage` v.v.).
- [ ] **B5. `locale`**: giữ như hiện tại, `localStorage.lang` → `vi`/`en`. Gọi `setLocale` khi giá trị thay đổi.
- [ ] **B6. Cho phép domain SharpTalk trong CSP (`script-src` · `frame-src` · `connect-src`) và CORS.**
- [ ] **B7. Đặt 3 chỗ dùng domain SharpTalk** (src của `embed.js` · `widgetUrl` · kiểm tra origin của `ivy:event`) **sau một thiết lập môi trường duy nhất** (để chỉ cần đổi một lần khi chuyển sang production).
  Kiểm tra (toàn bộ B): DevTools › Network `POST …/public/embed/identify` **200** (`consentState: "granted"`), và trang nhận được `ivy:event` `identified {ok: true}`.

### C. Kiểm tra UAT chung (WR-05) — 10/29 ~ 10/30
- [ ] **C1. Tất cả mục trong checklist mục 8 đều đạt** (cùng với SharpTalk).
- [ ] **C2. Tài khoản test**: 1 `Quản lý` (nhiều khách sạn) + 1 `Lễ tân` (1 khách sạn), bao gồm khách sạn ở miền Bắc và miền Nam (WR-14).

### D. Triển khai production (WR-06) — trước UAT production
- [ ] **D1. Áp dụng embed secret production.** Khác với staging (SharpTalk gửi qua kênh bảo mật).
- [ ] **D2. Chuyển sang domain production**: `https://sharptalk.go2joy.vn/widget/embed.js` · `widgetUrl` · kiểm tra origin.
- [ ] **D3. Áp dụng CSP và CORS production. Chia sẻ trước lịch triển khai HA.**
  Kiểm tra: identify trả về 200 trên HA production. Gói tạo bằng secret staging trả về 401 trên production.

---

## Thay đổi trong v1.4
| Mục | v1.0 (PDF 10/20) | v1.3 | **v1.4** |
|---|---|---|---|
| `userId` | ID đăng nhập | `"ha:" + userSn` | Giống v1.3 |
| Key thuộc tính được ký | `hotel_id` · `hotel_name` · `province` · `region` · `role` | Giống | **`hotel_id` · `hotel_name` · `province_sn` · `role`** |
| Tỉnh/thành | Tên tỉnh/thành | Tên tỉnh/thành | **`province_sn`** = `provinceSn` Go2Joy |
| Khu vực | HA tính (3 giá trị) | HA tính (5 mã) | **Không gửi**. SharpTalk tính |
| Vai trò | Tên hiển thị (`Lễ tân`) | Tên hiển thị | **Mã vai trò** |
| Chuẩn hóa | trim · 120 ký tự | + NFC | **NFC → gộp khoảng trắng → trim → 120 ký tự** |
| "Tất cả khách sạn" | Chưa định nghĩa | Chỉ gọi lại | Bỏ 3 key khách sạn, chỉ ký `role` |
| Giá trị rỗng | Bỏ thuộc tính·email rỗng | Giống | Bỏ cả `name` · `email` · `phone` rỗng |
| Test vector | T1 · T2 | T1 ~ T5 | **T1 ~ T6** (không dùng các vector trước nữa) |

**Lý do thay đổi**
- Nếu cả HA và SharpTalk đều giữ bảng khu vực riêng, hai bảng sẽ lệch nhau. Nguồn duy nhất là Province Feed của Go2Joy Partner API.
- Tên tỉnh/thành và tên hiển thị vai trò thay đổi theo ngôn ngữ HA (vi/en), nên giá trị được ký có thể khác nhau. Số và mã thì không thay đổi.

**Giai đoạn chuyển tiếp**: Hiện tại SharpTalk vẫn chấp nhận định dạng v1.3 (key `province` · `region`). Nếu `province_sn` cũng được gửi, **giá trị xác định từ `province_sn` được ưu tiên**. Khi HA đã chuyển sang v1.4 và qua UAT, chúng tôi sẽ ngừng hỗ trợ key v1.3 và thông báo ngày cụ thể.

## 1. SharpTalk làm gì
| Bước | Chi tiết |
|---|---|
| Xác minh | Dựng chuỗi ký từ đúng các giá trị nhận được và so sánh HMAC. Nếu không khớp: 401 E5048 (vẫn là khách vãng lai) |
| Tỉnh/thành · khu vực | `province_sn` → điền **tên tỉnh/thành và khu vực** từ danh sách tỉnh/thành Go2Joy (80 mục, Partner API Province Feed, làm mới hằng ngày). Số không có trong danh sách được lưu không kèm khu vực và chuyển đến người phụ trách mặc định |
| Đăng ký | Khách sạn = khách hàng doanh nghiệp (`hotel_id`), nhân viên = người liên hệ (`userId`), ghi nhận vai trò |
| Tính liên tục | Tiếp nối hội thoại trước theo từng tài khoản khách sạn (sau khi kết thúc phiên, trên PC khác, với nhân viên khác) |
| Phân tuyến | Danh mục tư vấn khách chọn × khu vực của khách sạn → đội × nhãn công việc (quy tắc do Go2Joy quản lý trong console) |

**Bảng khu vực** (`region` của Province Feed)

| STT | Mã | Tên |
|---|---|---|
| 1 | `south` | Miền Nam |
| 2 | `north` | Miền Bắc |
| 3 | `central` | Miền Trung |
| 4 | `north_center` | Bắc Trung Bộ |
| 5 | `south_center` | Nam Trung Bộ |
| 10 | `region_10` | Chưa có tài liệu (17 thành phố của Manila). Sẽ chốt sau khi nhận phản hồi cho yêu cầu công việc WR-27 |

## 2. Dữ liệu gửi đi (v1.4)
| Field | Được ký | Giá trị | Nguồn trong HA (ví dụ) | Ví dụ |
|---|---|---|---|---|
| `userId` | Có | `"ha:" + userSn` | Mã số nhân viên trong DB HA | `ha:1001` |
| `attributes.hotel_id` | Có | `hotelSn` của khách sạn đang chọn (chuỗi) | Khách sạn đang chọn trong phiên | `"1721"` |
| `attributes.hotel_name` | Có | Tên khách sạn | Khách sạn trong DB HA | `A In Hotel Del Luna` |
| `attributes.province_sn` | Có | `provinceSn` của tỉnh/thành nơi có khách sạn (chuỗi) | Khách sạn trong DB HA → provinceSn | `"1"` |
| `attributes.role` | Có | Mã vai trò HA | Key vai trò trong DB HA | `RECEPTIONIST` (ví dụ. Mã thật sẽ có trong phản hồi A7) |
| `name` · `email` · `phone` | Không | Để hiển thị. Bỏ field khi rỗng | Profile | `G2J SUPPORT` |

## 3. Luồng yêu cầu
```
HA FE ──(phiên đã đăng nhập)──▶ HA server  GET /api/v1/staff/sharptalkIdentity
                         └ giá trị từ phiên/DB → chuẩn hóa → ký → trả gói
HA FE ── SharpTalk.identify(gói nguyên trạng) ──▶ widget iframe
widget ── POST /api/v1/public/embed/identify ──▶ SharpTalk
                         └ xác minh chữ ký → province_sn → tên tỉnh/thành/khu vực → khách hàng doanh nghiệp/người liên hệ → liên kết hội thoại
widget ── ivy:event { event: "identified", ok } ──▶ HA FE (tùy chọn: ghi log)
```

## 4. Chuỗi ký
```
không có thuộc tính : userId
có thuộc tính       : userId + "\n" + key=value + "\n" + key=value ...   (key theo thứ tự bảng chữ cái)

hash = hex( HMAC-SHA256( key = SHARPTALK_EMBED_SECRET, message = chuỗi ký (UTF-8) ) )
       → 64 ký tự hex chữ thường

Ví dụ (T2):
ha:1001
hotel_id=1721
hotel_name=A In Hotel Del Luna
province_sn=1
role=RECEPTIONIST
```
- Thứ tự key: `hotel_id` → `hotel_name` → `province_sn` → `role`.
- Giá trị gửi đi phải **giống hệt** giá trị đã ký (kể cả khoảng trắng, chữ hoa/thường và dấu thanh).

## 5. Triển khai

### 5.1 HA server (PHP) — [sharptalk_identity.php](files/sharptalk_identity.php.txt)
```php
<?php
// SharpTalk identify package — HA server (spec v1.4). Requires PHP intl + mbstring.

/** NFC → collapse whitespace (incl. NBSP) → trim → 120 chars. Order matters. */
function sharptalk_clean($value): string {
    $v = Normalizer::normalize((string) $value, Normalizer::FORM_C);
    if ($v === false) { $v = (string) $value; }
    $v = preg_replace('/[\s\x{00A0}\x{2000}-\x{200B}\x{3000}]+/u', ' ', $v);
    $v = trim($v);
    return mb_substr($v, 0, 120, 'UTF-8');
}

/**
 * @param string     $userSn   staff number from the HA DB (never the login ID)
 * @param array|null $hotel    ['sn' => …, 'name' => …, 'provinceSn' => …] or null for "all hotels"
 * @param string     $roleCode HA role code (language independent)
 * @param array      $profile  ['name' => …, 'email' => …, 'phone' => …] — display only, not signed
 */
function sharptalk_identity(string $userSn, ?array $hotel, string $roleCode, array $profile, string $secret): array {
    $attributes = ['role' => $roleCode];
    if ($hotel !== null) {
        $attributes['hotel_id']    = $hotel['sn'];
        $attributes['hotel_name']  = $hotel['name'];
        $attributes['province_sn'] = $hotel['provinceSn'];
    }
    $clean = [];
    foreach ($attributes as $k => $v) {
        $c = sharptalk_clean($v);
        if ($c !== '') { $clean[$k] = $c; }          // empty values are left out of signing AND payload
    }
    ksort($clean, SORT_STRING);
    $userId = 'ha:' . sharptalk_clean($userSn);
    $lines = [$userId];
    foreach ($clean as $k => $v) { $lines[] = $k . '=' . $v; }
    $hash = hash_hmac('sha256', implode("\n", $lines), $secret);

    $package = ['userId' => $userId, 'hash' => $hash];
    foreach (['name', 'email', 'phone'] as $f) {     // unsigned; drop when empty
        $c = sharptalk_clean($profile[$f] ?? '');
        if ($c !== '') { $package[$f] = $c; }
    }
    if ($clean) { $package['attributes'] = $clean; }
    return $package;
}

// Controller (login session required):
// $staff = currentStaff(); $hotel = selectedHotelOrNull();
// return json(sharptalk_identity($staff->sn, $hotel ? ['sn' => $hotel->sn, 'name' => $hotel->name,
//        'provinceSn' => $hotel->provinceSn] : null, $staff->roleCode,
//        ['name' => $staff->fullName, 'email' => $staff->email, 'phone' => $staff->mobile],
//        getenv('SHARPTALK_EMBED_SECRET')));
```

### 5.2 HA FE
```html
<script>
  window.SHARPTALK_WIDGET_CONFIG = {
    shop: "https://www.go2joy.vn",
    widgetUrl: SHARPTALK_ORIGIN + "/widget",        // B7: one setting per environment
    agent: "hotel-partner",
    locale: (localStorage.getItem("lang") || "vi").toLowerCase()
    // no `user` block, no hash here (B1)
  };
  window.SharpTalk = window.SharpTalk || { q: [] };
  function sharptalkCall(method, arg) {
    if (typeof window.SharpTalk[method] === "function") window.SharpTalk[method](arg);
    else window.SharpTalk.q.push([method, arg]);
  }
</script>
<script src="SHARPTALK_ORIGIN/widget/embed.js" defer></script>
```
```js
// B2 · B3: after sign-in, on reload, on hotel change (incl. "all hotels"), on language change
async function sharptalkSignIn() {
  const pkg = await haApi.get('/api/v1/staff/sharptalkIdentity'); // signed on the server
  sharptalkCall('identify', pkg);                                // UNCHANGED
}
// B4: sign-out button, session/token expiry, before another account signs in, other tab signed out
function sharptalkSignOut() { sharptalkCall('logout'); }
window.addEventListener('storage', (e) => { if (e.key === 'profile' && !e.newValue) sharptalkSignOut(); });
// B5
function sharptalkSetLocale(lang) { sharptalkCall('setLocale', String(lang || 'vi').toLowerCase()); }
// optional log
window.addEventListener('message', (e) => {
  if (e.origin !== SHARPTALK_ORIGIN || e.data?.type !== 'ivy:event') return;
  if (e.data.event === 'identified') console.info('[SharpTalk] identify', e.data.ok ? 'OK' : 'rejected');
});
```

### 5.3 Ví dụ gói dữ liệu (T2)
```json
{
  "userId": "ha:1001",
  "hash": "fb670d6fbaac555b40b2f9896ec7de0604a1fad83aaf9e892f293f1d3be9faa7",
  "name": "G2J SUPPORT",
  "attributes": { "hotel_id": "1721", "hotel_name": "A In Hotel Del Luna", "province_sn": "1", "role": "RECEPTIONIST" }
}
```

### 5.4 Test vector (v1.4)
Secret dùng để test là `test-secret-do-not-use` (không phải secret thật). Các hash dưới đây được tính độc lập bởi **mã xác minh trên server SharpTalk** và bởi **mã mẫu PHP ở 5.1 (PHP 8.3 + intl)**, và kết quả khớp nhau. Mã vai trò và `userSn` là giá trị ví dụ.

| # | Đầu vào | Hash kỳ vọng |
|---|---|---|
| T1 | `ha:1001` · không có thuộc tính | `244f6fa4c1c48d077d54bd632b0897042fa413e36d55921517c462e2af51e618` |
| T2 | `ha:1001` · hotel_id=`1721`, hotel_name=`A In Hotel Del Luna`, province_sn=`1`, role=`RECEPTIONIST` | `fb670d6fbaac555b40b2f9896ec7de0604a1fad83aaf9e892f293f1d3be9faa7` |
| T3 | `ha:2002` · hotel_id=`2001`, hotel_name=`Huế Garden Hotel`, province_sn=`32`, role=`OWNER` | `0df74c490621c521a673b7bbd6014e6e3141a086d04c7c2f8de3699d31e581d7` |
| T4 | `ha:3003` · hotel_id=`3001`, hotel_name=`Hạ Long Bay Hotel`, province_sn=`15`, role=`RECEPTIONIST` | `7e5cf87cdd3dc38574ec8f3f9fe6671e9650806d28f4741a55bb508f53b77ea9` |
| T5 | `ha:1001` · role=`MANAGER` (**Tất cả khách sạn**) | `d57dc894632e52a7ca62d97f4cbec924eb33982dff23f57058b7299d24f57f20` |
| T6 | Cùng giá trị với T3 nhưng nhập lộn xộn: hotel_id=`" 2001"` (khoảng trắng đầu), hotel_name=`"  Hu" + "ế" + "  Garden Hotel "` (ế dạng tách rời · khoảng trắng kép · NBSP), province_sn=`32` (kiểu số) → ký sau khi chuẩn hóa theo 5.1 | **Phải bằng T3** `0df74c490621c521a673b7bbd6014e6e3141a086d04c7c2f8de3699d31e581d7` |

- Chạy: `docker run --rm -v "$PWD/scripts/go2joy/php":/w php:8.3-cli sh -c 'apt-get update -qq && apt-get install -y -qq libicu-dev && docker-php-ext-install intl && php /w/vectors.php'`
- Tỉnh/thành/khu vực thu được (giá trị SharpTalk lưu): T2 Hồ Chí Minh · `south`, T3 Thừa Thiên Huế · `north_center`, T4 Quảng Ninh · `north`, T5 không có (người phụ trách mặc định).
- Không dùng các vector v1.0 ~ v1.3 (chỉ T1 là giống).

### 5.5 Phản hồi của SharpTalk
| Kết quả | Ý nghĩa | Xử lý |
|---|---|---|
| 200 | Đã xác minh. Phiên ở trạng thái "đã xác minh", đã liên kết khách hàng doanh nghiệp và người liên hệ | — |
| 401 · E5048 | Chữ ký không khớp: chuỗi·secret·môi trường không khớp, key không xác định, quá 120 ký tự hoặc có xuống dòng, khác biệt NFC/khoảng trắng, `province_sn` không phải số | Đối chiếu với mục 4, chạy lại 5.4 |
| 400 | Lỗi định dạng (email rỗng v.v.) | Bỏ các field rỗng |
| 404 | Không có phiên chat | Widget tự xử lý. Tải lại trang |

## 6. Bảo mật
- Chỉ lưu secret trong biến môi trường của HA server. Secret staging và production khác nhau (SharpTalk gửi qua kênh bảo mật).
- Bất kỳ ai có gói đã ký đều có thể chat với tư cách nhân viên đó và xem các hội thoại trước của khách sạn đó. Không ghi log gói này và không bỏ qua xử lý đăng xuất (B4).
- Việc có thêm thời hạn chữ ký (`ts`) hay không sẽ được quyết định trong yêu cầu công việc WR-03 (nếu thêm, sẽ phát hành cùng với v1.5).
- PC dùng chung (quầy lễ tân): tự động đăng xuất và chuyển tài khoản ở B4 đặc biệt quan trọng.

## 7. Trạng thái phía SharpTalk
| Mục | Trạng thái |
|---|---|
| Hỗ trợ v1.4 (`province_sn` → tên tỉnh/thành/khu vực, song song với v1.3) | Triển khai staging (mục tiêu 10/27) |
| Danh sách tỉnh/thành Go2Joy, 80 mục (đánh chỉ mục theo số) | Đã nạp trên staging · production nạp khi cài đặt |
| Đăng nhập tạm không ký (cho UAT staging) | Kết thúc sau khi A và B hoàn tất |
| Tên hiển thị mã vai trò | Sau khi nhận bảng mã A7 |

## 8. Checklist UAT (WR-05)
| Kiểm tra | Kỳ vọng |
|---|---|
| Widget khi chưa đăng nhập | Khách vãng lai, hiển thị thông báo đồng ý (như hiện tại) |
| Đăng nhập HA → widget | identify **200**, `identified {ok: true}`, không có thông báo đồng ý, tên nhân viên trong lời chào, "đã xác minh" trong console |
| Console › Khách hàng › Khách hàng doanh nghiệp | 1 khách sạn (tên · tỉnh/thành · khu vực, do SharpTalk tính), nhân viên và mã vai trò trong mục người liên hệ |
| Ngôn ngữ HA vi ↔ en | Giá trị được ký không đổi → tiếp tục cùng hội thoại, chỉ ngôn ngữ trả lời thay đổi |
| Đổi khách sạn đang chọn | Khách hàng doanh nghiệp và hội thoại chuyển sang khách sạn mới |
| "Tất cả khách sạn" → kết nối với nhân viên tư vấn | 200, không có khách sạn, người phụ trách mặc định |
| Kết nối với nhân viên tư vấn từ khách sạn ở từng khu vực (north · north_center · south_center · south) → chọn danh mục tư vấn | Phân tuyến đội theo quy tắc trong console, người phụ trách hiển thị trong trung tâm thông báo |
| Tên khách sạn có nhiều dấu thanh (kể cả nhập dạng tách rời) | 200 |
| Nhân viên có email rỗng | 200, không có field email |
| Đăng xuất · hết hạn phiên · tài khoản khác đăng nhập | Khách vãng lai (hoặc tài khoản mới), không thấy hội thoại của nhân viên trước |
| Đổi một giá trị được ký mà không ký lại | 401, khách vãng lai. `name` · `email` · `phone` không được ký nên đổi chúng vẫn trả về 200 |
| Thêm key ngoài danh sách (ví dụ `district`) rồi ký | 401 (key không xác định bị loại khỏi phép tính chữ ký) |
