# Sổ tay thiết lập nhanh SharpTalk — Từ khi mở tenant đến phiên tư vấn đầu tiên

> Phiên bản 1.2 · Bản đầu 2026-08-24 · **Cập nhật 2026-10-24** · Biên soạn dựa trên mã nguồn
> Đối tượng: **Quản trị viên nền tảng** (chương 1) · **Quản trị viên tenant mới** (chương 2~8)
> Bản trực tuyến: https://shoptalk.amoeba.site/manual (có bản HTML và bản dịch EN·VI)
> Ký hiệu: ✅ đã triển khai / 🟡 đang chuẩn bị·lộ trình. URL staging chuẩn `https://shoptalk.amoeba.site`

> ⚠ Bản dịch AI, đang chờ hiệu đính bởi người bản ngữ. Bản tiếng Hàn là bản chuẩn.

Tài liệu này chỉ đề cập con đường ngắn nhất để mở một cửa hàng (tenant) mới cho đến khi
**widget trò chuyện thực sự bắt đầu tiếp khách hàng**. Về cách thiết lập chuyên sâu
tri thức·AI, xem [Sổ tay đăng ký tri thức·cài đặt AI](knowledge-ai.vi.md).

---

## Mục lục
0. [Trước khi bắt đầu](#0-trước-khi-bắt-đầu)
1. [<Quản trị viên nền tảng> Mở tenant](#1-mở-tenant)
2. [<Quản trị viên tenant> Đăng nhập lần đầu](#2-đăng-nhập-lần-đầu)
3. [Tích hợp nền tảng thương mại](#3-tích-hợp-nền-tảng-thương-mại)
4. [Cài đặt·cài lên trang widget trò chuyện](#4-cài-đặtcài-lên-trang-widget-trò-chuyện)
5. [Cài đặt AI tối thiểu](#5-cài-đặt-ai-tối-thiểu)
6. [Nhập tri thức lần đầu](#6-nhập-tri-thức-lần-đầu)
7. [(Tùy chọn) Mời thành viên·chuyển tiếp tư vấn](#7-tùy-chọn-mời-thành-viênchuyển-tiếp-tư-vấn)
8. [Danh sách kiểm tra hoàn tất](#8-danh-sách-kiểm-tra-hoàn-tất)
9. [Xử lý sự cố](#9-xử-lý-sự-cố)

---

## 0. Trước khi bắt đầu

**Thuật ngữ**

| Thuật ngữ | Ý nghĩa |
|---|---|
| Tenant (gian hàng) | Một cửa hàng "vào ở" trong SharpTalk. Dữ liệu·cài đặt·tri thức được tách biệt hoàn toàn theo từng cửa hàng |
| Slug | Đoạn địa chỉ đăng nhập riêng của tenant. Được gắn vào cuối URL như `https://shoptalk.amoeba.site/user/ivyusa` |
| Quản trị viên nền tảng | Quản trị viên của đơn vị vận hành SharpTalk, đăng nhập qua `/admin` (có quyền mở tenant) |
| Quản trị viên tenant (master) | Cấp bậc cao nhất trong bảng điều khiển cửa hàng. Quản lý toàn bộ thành viên·quyền·cài đặt |
| Mật khẩu tạm thời | Mật khẩu dùng một lần do hệ thống cấp khi mời. **Chỉ hiển thị trên màn hình đúng một lần** |

**Cần chuẩn bị**
- Tài khoản quản trị viên nền tảng (`/admin/login`)
- **Tên miền cửa hàng** của cửa hàng sẽ mở (ví dụ: `example.myshopify.com`, `mallid.cafe24.com`)
- **Địa chỉ email** của người sẽ được mời làm quản trị viên tenant
- Thông tin xác thực của nền tảng cần tích hợp (xem chương 3 — quản trị viên tenant chuẩn bị)

**Thời gian cần thiết**: thao tác admin ~5 phút + thiết lập tenant lần đầu ~30 phút (không tính thời gian chờ duyệt tích hợp nền tảng)

---

## 1. Mở tenant
*(Quản trị viên nền tảng · `/admin/tenants`)*

### 1.1 Tạo tenant mới

`/admin/tenants` → nút **[Gian hàng mới]** → nhập 4 trường trong hộp thoại:

| Trường | Bắt buộc | Mô tả |
|---|---|---|
| Tên | ✅ | Tên hiển thị của cửa hàng |
| Đường dẫn đăng nhập (slug) | — | Để trống sẽ tự tạo từ tên. Khi nhập sẽ tự chuyển thành chữ thường |
| Tên miền cửa hàng | ✅ | Tên miền đại diện của cửa hàng. Shopify là `*.myshopify.com`, Cafe24 là tên miền của mall v.v. — **dùng chung cho mọi nền tảng** |
| Gói dịch vụ | ✅ | `starter` / `growth` / `enterprise` / `custom` — menu được cung cấp mặc định khác nhau theo gói. Sau khi mở, đổi tại **[Gói & add-on]** trên hàng của tenant (add-on quy trình yêu cầu base/bridge/native cũng ở đó) |

💡 **Mẹo — quy tắc slug**: chỉ chữ thường·số·gạch ngang, không được trùng với tên màn hình
của bảng điều khiển (`admin`, `login`, `dashboard`, `settings` v.v. — các từ dành riêng).
Nếu nhập từ dành riêng, máy chủ sẽ tự động thêm hậu tố `-shop`. Slug chính là URL đăng nhập,
nên khuyến nghị chọn giá trị dễ nhớ với cửa hàng.

### 1.2 (Tùy chọn) Điều chỉnh menu được cung cấp

Trên hàng của tenant → **[Menu]** → chọn một trong 3 chế độ cho từng menu:

| Chế độ | Ý nghĩa |
|---|---|
| Theo gói | Giữ nguyên mặc định của gói dịch vụ (mặc định) |
| Buộc cung cấp | Cung cấp cho tenant này bất kể gói |
| Không cung cấp | Không cung cấp bất kể gói |

Cột kết quả thay đổi ngay lập tức, và hàng nào được đặt ngoại lệ sẽ hiển thị dấu `*`.

💡 **Mẹo**: menu bị chặn ở đây sẽ không hiển thị kể cả khi master của tenant cấp quyền
theo cấp bậc (cấu trúc 2 tầng: admin cung cấp → quyền nội bộ của tenant). Bảng yêu cầu
(issue board) còn cần cài đặt chế độ quy trình đi kèm.

### 1.3 Mời quản trị viên tenant + cấp mật khẩu tạm thời

Trên hàng của tenant → **[Người dùng]** → `/admin/tenants/…/users` → **[Mời người dùng]**:

1. Nhập `email`, giữ `cấp bậc` ở mặc định **master** (vì là quản trị viên đầu tiên)
2. Bấm **[Gửi lời mời]** → **hộp thoại mật khẩu tạm thời** hiện ra ngay

```
┌─ Đã cấp mật khẩu tạm thời ───────────────────┐
│ Mật khẩu tạm thời của user@shop.com           │
│ ┌──────────────────────────┐                 │
│ │  TmpXXXXXXXXX!           │   [Sao chép]    │
│ └──────────────────────────┘                 │
│ ⚠️ Giá trị này chỉ hiển thị một lần ngay      │
│    bây giờ. Hãy chuyển qua kênh an toàn;      │
│    khi đăng nhập lần đầu bắt buộc phải đổi.   │
└──────────────────────────────────────────────┘
```

> ⚠️ **Mật khẩu tạm thời KHÔNG được gửi qua email.** Quản trị viên phải sao chép giá trị
> hiển thị một lần trong hộp thoại này và **tự tay chuyển giao**. Nếu lỡ đóng cửa sổ và mất
> giá trị, hãy dùng nút **[Mật khẩu tạm]** trên hàng người dùng đó để cấp lại (giá trị cũ
> sẽ bị vô hiệu).

💡 **Mẹo — bảo mật khi chuyển giao**: đừng để mật khẩu trong nội dung email hay nhóm chat.
Hãy chuyển qua tin nhắn bảo mật 1:1 hoặc điện thoại, và quy trình mở tenant chỉ hoàn tất
khi đã xác nhận đăng nhập lần đầu (= đổi mật khẩu bắt buộc) xong. Lịch sử cấp phát được ghi
vào nhật ký kiểm tra (`/admin/audit`).

### 1.4 Chuyển giao URL đăng nhập

Thẻ ở đầu cùng màn hình hiển thị **URL trang đăng nhập** của tenant này (`https://…/slug`).
Bấm **[Sao chép]** và gửi kèm cùng mật khẩu tạm thời.

3 thứ cần chuyển giao: ① URL đăng nhập ② email (ID tài khoản) ③ mật khẩu tạm thời

---

## 2. Đăng nhập lần đầu
*(Quản trị viên tenant · `https://shoptalk.amoeba.site/user/<slug>`)*

### 2.1 Đăng nhập

Truy cập URL được cung cấp, màn hình đăng nhập hiển thị tên cửa hàng sẽ hiện ra. Đăng nhập
bằng email + mật khẩu tạm thời.

💡 **Mẹo**: nếu thấy "Không tìm thấy cửa hàng", hãy kiểm tra chính tả slug trong URL.
Bật **Ghi nhớ email** thì từ lần sau trình duyệt này sẽ tự điền email.

### 2.2 Đổi mật khẩu bắt buộc

Ngay sau khi đăng nhập, **cửa sổ đổi mật khẩu không thể đóng** sẽ hiện ra (không thể hủy —
không thể dùng bảng điều khiển với mật khẩu tạm thời).

- Nhập `mật khẩu hiện tại (tạm thời)` + `mật khẩu mới` + `xác nhận`
- 3 quy tắc mật khẩu mới hiển thị ✓/✕ theo thời gian thực khi gõ:
  **① Tối thiểu 10 ký tự ② Ít nhất 3 trong 4 loại: chữ hoa·chữ thường·số·ký tự đặc biệt ③ Không phải mật khẩu phổ biến**
- Mật khẩu chứa email của chính mình, hoặc trùng mật khẩu ngay trước đó, sẽ bị máy chủ từ chối

### 2.3 Đăng ký MFA (xác thực 2 bước)

Cấp bậc master·director **bắt buộc đăng ký MFA (TOTP)** theo chính sách bảo mật.

| Thuật ngữ | Ý nghĩa |
|---|---|
| TOTP | Mã 6 chữ số do ứng dụng xác thực (Google Authenticator v.v.) tạo mỗi 30 giây |
| Mã khôi phục | 10 mã dùng một lần thay thế khi mất ứng dụng xác thực — **chỉ hiển thị một lần ngay sau khi đăng ký** |

- Trước ngày hiệu lực: biểu ngữ vàng gia hạn ở trên cùng (hiện hạn chót) → có thể đăng ký trước tại Trang của tôi
- Sau ngày hiệu lực: cửa sổ đăng ký chặn việc dùng bảng điều khiển cho đến khi đăng ký xong
- Đăng ký: quét QR (hoặc nhập khóa thủ công) → nhập mã 6 chữ số từ ứng dụng → **tải về/lưu giữ
  10 mã khôi phục** → hoàn tất. Từ đó mỗi lần đăng nhập nhập thêm mã 6 chữ số

💡 **Mẹo**: mã khôi phục chỉ hiển thị đúng lúc này một lần. Nhất định phải lưu lại. Nếu mất
cả ứng dụng xác thực lẫn mã khôi phục thì chỉ có thể gỡ bằng **[Đặt lại MFA]** của quản trị
viên (admin hoặc master của cửa hàng).

---

## 3. Tích hợp nền tảng thương mại
*(Menu trái của bảng điều khiển **[Cài đặt gian hàng]** → tab **Tích hợp nền tảng**)*

> Trang cài đặt gồm **8 tab**: Cài đặt cơ bản (công cụ AI · mức dùng · storefront ·
> tùy chọn tri thức) / Chuyển nhân viên / Cài đặt widget / Tích hợp nền tảng / Marketing & Helpdesk /
> Kênh nhắn tin / Cài đặt khác / Thông báo quyền riêng tư. Chương này là tab
> *Tích hợp nền tảng*, chương 4 là tab *Cài đặt widget*.

Trong các ô của tab Tích hợp nền tảng, bấm **[Cấu hình]** của nền tảng cần dùng để mở cửa
sổ tích hợp. Nút **[Hướng dẫn kết nối]** ở góc trên bên phải của tab chỉ rõ tìm thông tin
xác thực của từng nền tảng ở đâu.
⚠️ **Lưu ≠ đã kết nối**: sau khi lưu thông tin xác thực, trạng thái là "Chưa kiểm tra" —
phải qua được **[Kiểm tra kết nối]** mới thành "Đã kết nối" (thất bại là "Lỗi").

| Thuật ngữ | Ý nghĩa |
|---|---|
| Thông tin xác thực (credential) | Khóa·token để truy cập API của nền tảng. Được lưu mã hóa; sau khi lưu chỉ hiển thị là "Đã lưu" thay vì giá trị |
| Kiểm tra kết nối | Nút gọi API thật một lần bằng thông tin xác thực đã lưu để kiểm tra tính hợp lệ |
| Đồng bộ (sync) | Thao tác lấy dữ liệu đơn hàng·sản phẩm của nền tảng về bộ nhớ đệm của SharpTalk |

### 3.1 Cafe24 ✅

**Đường khuyến nghị — thẻ kết nối OAuth**: tại thẻ *Cafe24 (OAuth)* của tab Tích hợp nền tảng
1. Nhập `mall ID` (phần mallID trong `mallID.cafe24.com`)
2. **[Kết nối]** → chuyển đến trang ủy quyền của Cafe24 → đăng nhập·chấp thuận quyền → tự động quay lại bảng điều khiển
3. Xác nhận huy hiệu Đã kết nối rồi chạy **[Đồng bộ ngay]** (đơn hàng) / **[Đồng bộ sản phẩm]**

💡 **Mẹo**: đồng bộ sản phẩm chỉ nạp đến **bộ nhớ đệm** sản phẩm. Để AI dùng các sản phẩm
này trong câu trả lời, phải chạy riêng **Đồng bộ từ danh mục sản phẩm** (xem trước→thực thi)
ở màn hình [Kho tri thức] — xem [Sổ tay tri thức·AI chương 2.2](knowledge-ai.vi.md).

Đường thủ công (khi đã có sẵn token): cũng có thể nhập trực tiếp `mall_id` +
`access_token` (+ client_id/secret) vào hộp thoại của ô Cafe24. Kết nối OAuth là cách chuẩn.

### 3.2 Shopify ✅

Hộp thoại của ô Shopify:

| Trường | Bắt buộc |
|---|---|
| Tên miền cửa hàng (`*.myshopify.com`) | ✅ |
| Token truy cập Admin API | ✅ |
| Khóa API / API Secret | Tùy chọn |

Sau khi lưu, chạy theo thứ tự **[Kiểm tra kết nối] → [Đồng bộ ngay] → [Đăng ký webhook]**.
Phải đăng ký webhook thì thay đổi trạng thái đơn hàng·giao hàng mới được phản ánh vào thông
báo của widget theo thời gian thực. Quy trình cấp token xem hướng dẫn tích hợp Shopify.

### 3.3 Odoo · WooCommerce · Haravan ✅

Nhập thông tin xác thực vào hộp thoại của từng ô (Odoo: `URL máy chủ` / `tên DB` /
`tên người dùng` / `API Key`), qua được **[Kiểm tra kết nối]** rồi lấy dữ liệu bằng
**[Nhập sản phẩm] / [Đồng bộ đơn hàng]** trong cùng hộp thoại. Để AI dùng các sản phẩm
đã nhập trong câu trả lời, vẫn phải chạy riêng đồng bộ danh mục ở màn hình [Kho tri thức]
(giống mẹo ở 3.1).

### 3.4 URL storefront

Nhập **địa chỉ trang dành cho khách hàng** của cửa hàng vào thẻ *Cửa hàng (storefront)*
trên **tab Cài đặt cơ bản**. Nếu chưa đặt, liên kết sản phẩm trong widget sẽ bị vô hiệu
(thẻ hiển thị cảnh báo).

> Ngoài ra Klaviyo·Yotpo (marketing)·Gorgias (helpdesk) nằm ở tab *Marketing & Helpdesk*,
> các kênh nhắn tin (Telegram·Viber·Gmail v.v.) ở tab *Kênh nhắn tin* — cùng kiểu ô/thẻ.
> Tài liệu này lược bỏ phần đó.

---

## 4. Cài đặt·cài lên trang widget trò chuyện
*(**[Cài đặt gian hàng] → tab Cài đặt widget**)*

### 4.1 Cài widget lên trang

Trong **thẻ hướng dẫn cài đặt**, chọn tab nền tảng (Shopify / Cafe24 / WooCommerce / Odoo)
để xem đoạn mã cài đặt và các bước hướng dẫn cho nền tảng đó. Mọi khối mã đều có nút sao chép.

- **Shopify**: 3 cách — App embed (khuyến nghị) / ScriptTag / dán mã thủ công
- **Cafe24**: đoạn mã chuyên dụng dán vào thiết kế mall (đã bao gồm đường dẫn đăng nhập thành viên)
- **WooCommerce**: đoạn mã PHP cho `functions.php` / **Odoo**: đoạn mã HTML đa dụng

Trong **thẻ Embed & SDK**:
- Sao chép đoạn mã cài đặt đa dụng (`embed.js`)
- **Tên miền được phép**: danh sách tên miền nơi widget sẽ hiển thị. Để trống thì URL storefront được áp dụng
- **Khóa bí mật ký (signing secret)**: dùng khi liên kết danh tính thành viên (đăng nhập liên kết).
  **Khi [Tạo], giá trị chỉ hiển thị một lần** — hãy sao chép ngay và chuyển cho người phụ trách máy chủ

💡 **Mẹo**: sau khi cài, mở trang cửa hàng thật và kiểm tra launcher (nút bong bóng chat)
xuất hiện ở góc dưới bên phải là cách xác minh chắc chắn nhất. Nếu không hiện, xem
[chương 9 Xử lý sự cố](#9-xử-lý-sự-cố).

### 4.2 Nội dung·hành vi (thẻ Hành vi của widget)

| Mục | Mô tả |
|---|---|
| Cách đăng nhập | `redirect` (chuyển đến trang đăng nhập của cửa hàng rồi quay lại, mặc định) / `popup` (đăng nhập bằng cửa sổ popup) |
| Múi giờ | Múi giờ chuẩn của cửa hàng — dùng cho hiển thị giờ làm việc v.v. |
| Tên hiển thị | Tên cửa hàng hiện trên đầu widget (tối đa 80 ký tự) |
| Lời chào lần đầu truy cập / Lời chào khi đã đăng nhập | Viết riêng theo **6 tab ngôn ngữ** (EN/ES/KO/VI/JA/ZH) (tối đa 500 ký tự) — nội dung mặc định hiển thị dưới ô nhập ("Nội dung mặc định:") |

💡 **Mẹo**: nếu để trống lời chào cho một ngôn ngữ, nội dung mặc định sẽ được gửi. Có thể
viết kỹ trước cho một ngôn ngữ chủ lực, phần còn lại điền sau cũng được.

### 4.3 Tab·chủ đề giao diện

**Thẻ Tab của widget**: chọn tab hiển thị trong 3 tab Thông báo / Đơn hàng / Trò chuyện
(phải giữ tối thiểu 1 tab — không thể tắt tab cuối cùng), vị trí thanh tab là trên/dưới.

**Thẻ Chủ đề widget**: `màu thương hiệu` (bộ chọn/HEX) · `kiểu phần đầu` (trắng/màu thương hiệu) ·
tải lên `logo` · `launcher` vị trí (trái/phải)·kích thước (sm/md/lg)·biểu tượng
(chat/dấu hỏi/tai nghe/logo). Có thể xem ngay ở phần xem trước bên phải.

**Thẻ Widget tùy chỉnh** (dưới thẻ chủ đề): muốn đổi cả phông chữ, cỡ chữ, bo góc, kích thước
bảng, biểu tượng nút mở thì bấm **[Tạo widget tùy chỉnh]**, đặt tên thiết kế rồi bấm **[Dùng]**.
Có hiệu lực ngay, không cần triển khai, và luôn có thể **[Về widget cơ bản]**. Tải phông và
biểu tượng lên thẻ **Tệp thiết kế** trước. Chi tiết: Sổ tay người dùng chương 14.

💡 **Mẹo**: chỉ cần chọn **một màu thương hiệu duy nhất**. Các bậc sáng và màu chữ được
tính tự động theo chuẩn tương phản (4.5:1), nên không có chuyện "chọn màu sáng xong chữ
không đọc được". Chủ đề đã lưu sẽ có hiệu lực **từ phiên widget tiếp theo của khách hàng**.
Chi tiết: hướng dẫn cài đặt widget.

---

## 5. Cài đặt AI tối thiểu
*(Menu trái **[Cài đặt AI]**)*

Màn hình Cài đặt AI có bố cục: các thẻ cài đặt bên trái, **studio Xem thử/Huấn luyện** bên
phải. Ở giai đoạn mở tenant chỉ cần kiểm tra ba điều.

| Thuật ngữ | Ý nghĩa |
|---|---|
| Persona | Đoạn văn mô tả giọng điệu·thái độ·nguyên tắc của bot tư vấn AI. Quyết định tông của mọi câu trả lời AI |
| Quy tắc trả lời | Danh sách quy tắc AI nhất định phải tuân thủ (mỗi dòng = 1 quy tắc) |
| Công cụ AI (engine) | Mô hình AI tạo câu trả lời. Chọn trong số các công cụ do quản trị viên nền tảng đăng ký |
| stub | Bộ trả lời demo hoạt động không cần khóa AI thật. **Không phải chất lượng cho dịch vụ thật** |

1. Viết phần giới thiệu cửa hàng·giọng điệu·điều cấm vào thẻ **Persona của bot** rồi lưu
   (ví dụ: *"Là tư vấn viên thân thiện và súc tích của cửa hàng OO. Chỉ trả lời từ tri thức được cung cấp."*)
2. Đăng ký tối thiểu 2~3 mục trong **Quy tắc trả lời**
   (ví dụ: "Không khẳng định hoàn tiền đã hoàn tất", "Không cam đoan ngày giao hàng cụ thể")
3. Kiểm tra công cụ áp dụng của từng chức năng trong thẻ **Chức năng AI** — **nếu thấy huy hiệu
   `stub` nghĩa là chưa kết nối công cụ thật**. Hai cách khắc phục: ① đăng ký **công cụ
   riêng bằng API key của mình** tại thẻ *Công cụ AI* trong [Cài đặt gian hàng → Cài đặt
   cơ bản] (ưu tiên hơn công cụ của nền tảng; chi phí tính vào tài khoản của mình)
   ② đề nghị quản trị viên nền tảng đăng ký công cụ chung (`/admin/ai-engines`).

💡 **Mẹo**: nút kịch bản (menu nhanh dưới cùng của widget) đã có sẵn 6 loại mặc định
(Tình trạng giao hàng·Hủy/Hoàn tiền·Hỗ trợ sản phẩm·Liên hệ hỗ trợ·Cộng tác viên·Đơn hàng
của tôi) được áp dụng tự động **kèm nhãn cho cả 6 ngôn ngữ**, nên ở giai đoạn mở tenant
không cần đụng đến. Cách viết persona·quy tắc và toàn bộ cài đặt AI: xem
[Sổ tay tri thức·AI chương 4](knowledge-ai.vi.md).

---

## 6. Nhập tri thức lần đầu
*(Menu trái **[Kho tri thức]**)*

AI **chỉ trả lời từ tri thức đã đăng ký**. Nếu chưa có tri thức, đa số câu hỏi sẽ bị chuyển
sang nhân viên tư vấn, nên hãy nạp tri thức chính sách cốt lõi ngay ở giai đoạn mở tenant.
Con đường nhanh nhất là **Hướng dẫn tư vấn chung**:

1. Trên các tab nhóm phía trên thẻ tài liệu, chọn **CounselInfo** → **[Nhập hàng loạt]** →
   tải về **Hướng dẫn tư vấn chung** (KB tư vấn khởi đầu dùng ngay, cỡ 90 dòng) dạng
   CSV/XLSX từ khối hướng dẫn
2. Chỉnh thời hạn·phí·chính sách theo cửa hàng của mình → tải lên trong cùng cửa sổ →
   kiểm tra số dòng tạo mới/cập nhật
   - Giao hàng·hủy/hoàn tiền·đổi/trả·FAQ được nạp trong một lần. Sửa lại file rồi tải
     lên lần nữa sẽ **cập nhật không tạo trùng** (round-trip)
3. Tài liệu riêng lẻ đăng ký bằng **[Viết trên bảng]** (khuyến nghị — đăng rồi
   [Đưa vào KB]) hoặc **[Thêm tài liệu KB]** (dùng khi gấp)
4. Nhập những câu khách hàng có thể hỏi vào **bảng QA tri thức** bên phải để kiểm tra câu
   trả lời·nguồn trích dẫn·độ tin cậy — nếu tài liệu vừa đăng ký xuất hiện trong danh sách
   nguồn là thành công

💡 **Mẹo**: đưa vào tiêu đề·nội dung **cách nói thực tế của khách hàng** (ví dụ: "giao hàng
mất bao lâu") sẽ tăng tỷ lệ khớp khi tìm kiếm. Quy trình bảng tri thức, đăng ký hàng loạt
tri thức sản phẩm (đồng bộ danh mục·CSV), nhập bằng AI (pdf·docx·md·YouTube), tích hợp
nguồn ngoài (Google Drive·Notion), kiểm chứng·quản lý chất lượng được đề cập trong
[Sổ tay tri thức·AI](knowledge-ai.vi.md).

---

## 7. (Tùy chọn) Mời thành viên·chuyển tiếp tư vấn

- **Mời thành viên**: menu **[Người dùng]** → [Mời người dùng] → chọn email·cấp bậc
  (director/manager/staff)·nhãn công việc → **hộp thoại mật khẩu tạm thời** giống chương 1
  hiện ra (hiển thị 1 lần·tự tay chuyển giao). Quyền truy cập từng menu điều chỉnh theo
  cấp bậc tại thẻ *Quyền truy cập menu* trong [Cài đặt gian hàng → Cài đặt khác] (chỉ master).
- **Chuyển cho nhân viên (handoff)**: trong tab [Cài đặt gian hàng → Chuyển nhân viên], chỉ
  định nhân viên tư vấn phụ trách, quy tắc phân công (nhóm × nhãn theo danh mục tư vấn·khu
  vực), giờ làm việc, email chuyển tiếp ngoài giờ. Muốn khách chọn chủ đề tư vấn trên widget
  thì đặt danh mục ở trạng thái Hiển thị trong *Quản lý danh mục tư vấn*. Sau khi tạo quy tắc,
  hãy dùng **Kiểm tra phân công** để xem hội thoại sẽ đến ai. Chi tiết xem
  [Sổ tay tri thức·AI chương 5](knowledge-ai.vi.md).

---

## 8. Danh sách kiểm tra hoàn tất

- [ ] Tạo tenant + mời quản trị viên·chuyển giao mật khẩu tạm (admin)
- [ ] Đăng nhập lần đầu → đổi mật khẩu → đăng ký MFA
- [ ] Tích hợp nền tảng: lưu thông tin xác thực + **kiểm tra kết nối đạt** (trạng thái
  "Đã kết nối") + (Shopify) đăng ký webhook
- [ ] Đặt URL storefront (tab Cài đặt cơ bản)
- [ ] Cài đoạn mã widget → **xác nhận launcher hiển thị trên cửa hàng thật**
- [ ] Viết tên hiển thị·lời chào
- [ ] Lưu persona·quy tắc trả lời, xác nhận công cụ AI không phải `stub`
- [ ] Tải lên Hướng dẫn tư vấn chung (hoặc đăng ký từ 3 tài liệu chính sách cốt lõi trở lên) → kiểm tra câu trả lời bằng bảng QA
- [ ] Hỏi trực tiếp trong widget để xác nhận câu trả lời AI + hiển thị nguồn (đầu-cuối)

---

## 9. Xử lý sự cố

**Q. Không đăng nhập được (mật khẩu tạm thời).**
Mật khẩu tạm thời khi cấp lại sẽ vô hiệu hóa giá trị cũ. Hãy kiểm tra xem có phải bản cấp
mới nhất không; nếu vẫn không được, đề nghị quản trị viên cấp lại. Cũng kiểm tra xem slug
trong URL đăng nhập có phải của cửa hàng khác không (thất bại từ 2 lần trở lên sẽ có hướng
dẫn trên màn hình).

**Q. Tôi lỡ đóng cửa sổ mật khẩu tạm thời.**
Không thể xem lại giá trị. Hãy cấp lại bằng nút **[Mật khẩu tạm]** trên hàng người dùng.

**Q. Widget không hiện trên cửa hàng.**
Kiểm tra theo thứ tự: ① đoạn mã có nằm trên trang đã triển khai thực tế không ② tên miền đó
có trong danh sách tên miền được phép của thẻ Embed không (nếu để trống thì theo URL
storefront) ③ làm mới bộ nhớ đệm trình duyệt.

**Q. Câu trả lời của AI máy móc một cách kỳ lạ.**
Xem thẻ Chức năng AI có huy hiệu `stub` không. Stub là bộ trả lời demo. Hãy đăng ký công
cụ riêng tại thẻ *Công cụ AI* trong [Cài đặt gian hàng → Cài đặt cơ bản], hoặc đề nghị
quản trị viên nền tảng đăng ký công cụ chung. Cảnh báo "dự phòng n lần" trong thẻ
*Mức dùng AI* cũng là dấu hiệu tương tự.

**Q. AI cứ chuyển sang "kết nối nhân viên tư vấn".**
Nhiều khả năng chưa có tài liệu tri thức về chủ đề đó hoặc tài liệu đang tắt. Đăng ký tài
liệu theo chương 6 và kiểm tra bằng bảng QA.

**Q. Đã đổi cài đặt nhưng widget vẫn như cũ.**
Cài đặt widget (nội dung·chủ đề·tab) có hiệu lực từ **phiên tiếp theo** của khách hàng.
Hãy đóng rồi mở lại widget hoặc làm mới trang.

---

*Bước tiếp theo: [Sổ tay đăng ký tri thức·cài đặt AI](knowledge-ai.vi.md) — toàn bộ
pipeline tri thức, cài đặt AI chi tiết, ứng phó live chat, vòng lặp cải thiện chất lượng.*
