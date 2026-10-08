# Hướng dẫn tích hợp Cafe24 cho SharpTalk — từ kết nối cửa hàng đến đăng nhập thành viên

> Phiên bản 1.0 · phát hành lần đầu 2026-10-08 · viết theo mã nguồn
> Đối tượng: quản trị viên nền tảng (chương 1 — một lần cho mỗi bản triển khai) · người vận hành tenant (master — chương 2~7)
> Bản trực tuyến: https://shoptalk.amoeba.site/manual (bản HTML và bản dịch EN·VI)
> Đọc trước: [Sổ tay cài đặt nhanh](quick-setup.vi.md) · chi tiết nơi cấp các giá trị xem [Hướng dẫn thông tin xác thực tích hợp thương mại](platform-integration.vi.html)

Đây là hướng dẫn thực hành sắp xếp **theo thứ tự** toàn bộ công việc gắn một gian hàng Cafe24 vào SharpTalk. Mỗi chương theo thứ tự **làm gì → các bước → 💡 mẹo vận hành**, và danh sách kiểm tra ở chương 8 dùng để xác minh đến cùng.

---

## Mục lục
0. [Tổng quan](#0-tổng-quan)
1. [Quản trị viên nền tảng — ứng dụng Developers và cấu hình máy chủ](#1-quản-trị-viên-nền-tảng--ứng-dụng-developers-và-cấu-hình-máy-chủ)
2. [Cài đặt cơ bản của tenant — tên miền cửa hàng · URL cửa hàng](#2-cài-đặt-cơ-bản-của-tenant--tên-miền-cửa-hàng--url-cửa-hàng)
3. [Kết nối gian hàng — đồng ý OAuth](#3-kết-nối-gian-hàng--đồng-ý-oauth)
4. [Đồng bộ đơn hàng](#4-đồng-bộ-đơn-hàng)
5. [Sản phẩm → tri thức](#5-sản-phẩm--tri-thức)
6. [Cài widget — Smart Design](#6-cài-widget--smart-design)
7. [Đăng nhập thành viên · đơn hàng của tôi](#7-đăng-nhập-thành-viên--đơn-hàng-của-tôi)
8. [Danh sách kiểm tra công việc](#8-danh-sách-kiểm-tra-công-việc)
9. [FAQ / xử lý sự cố](#9-faq--xử-lý-sự-cố)

---

## 0. Tổng quan

Tích hợp Cafe24 gồm **ba kết nối**. Ba kết nối này độc lập với nhau, nên chỉ cần bật những gì bạn cần.

```
① Kết nối quản trị (OAuth, chương 3)     cửa hàng → SharpTalk   đọc đơn hàng · sản phẩm (chỉ đọc)
      ├─ Đồng bộ đơn hàng (chương 4)      → AI trả lời "đơn của tôi đến đâu?" bằng đơn hàng thật
      └─ Nhập sản phẩm (chương 5)         → chuyển thành tri thức → AI trích dẫn · gắn liên kết sản phẩm
② Cài widget (Smart Design, chương 6)    SharpTalk → cửa hàng   widget trò chuyện trên mọi trang
③ Đăng nhập thành viên (chương 7)       thành viên ↔ phiên widget   hiện 'Đơn hàng của tôi' trong widget
```

| Thuật ngữ | Ý nghĩa |
|---|---|
| Mall ID | ID gian hàng Cafe24. Là phần `yourmall` trong `yourmall.cafe24.com` |
| Ứng dụng Developers | Ứng dụng dành cho SharpTalk đăng ký tại developers.cafe24.com. Dùng **1 ứng dụng cho mỗi bản triển khai (staging·production)**, và mọi tenant đều kết nối gian hàng của mình qua ứng dụng này |
| Kết nối quản trị | Quy trình người vận hành chính của gian hàng đồng ý cấp quyền cho ứng dụng. Token nhận được sẽ được mã hóa và lưu riêng cho từng tenant |
| Đăng nhập thành viên | Tính năng gắn hội thoại widget với thành viên khi khách hàng (thành viên) của cửa hàng đăng nhập trong widget, dựa trên ID thành viên do Cafe24 xác nhận |

| Chương | Ai | Màn hình |
|---|---|---|
| 1 | Quản trị viên nền tảng | Cafe24 Developers · biến môi trường máy chủ |
| 2~3 | Master của tenant | Cài đặt gian hàng > Cài đặt cơ bản · Cài đặt gian hàng > Tích hợp nền tảng |
| 4~5 | Master của tenant | Cài đặt gian hàng > Tích hợp nền tảng · Kho tri thức |
| 6 | Master của tenant + người phụ trách thiết kế gian hàng | Cài đặt gian hàng > Cài đặt widget · quản trị Cafe24 |
| 7 | Master của tenant | Cài đặt gian hàng > Cài đặt widget |

⚠️ **Kết nối chỉ có quyền đọc.** SharpTalk chỉ đọc đơn hàng · sản phẩm · danh mục và không sửa dữ liệu của gian hàng.

---

## 1. Quản trị viên nền tảng — ứng dụng Developers và cấu hình máy chủ

Chương này chỉ làm **một lần cho mỗi bản triển khai**. Nếu đã có tenant khác đang dùng kết nối Cafe24 thì bỏ qua và chuyển sang chương 2.

### 1.1 Đăng ký ứng dụng Developers

1. Đăng nhập developers.cafe24.com → tạo ứng dụng cho SharpTalk bằng **Tạo ứng dụng**.
2. Trong thông tin ứng dụng, xác nhận **Client ID** và **Client Secret** (sẽ điền vào biến môi trường ở mục 1.3).
3. Ở **Redirect URI**, đăng ký **đúng một** địa chỉ callback của tên miền console.
   Staging `https://shoptalk.amoeba.site/api/v1/auth/cafe24/callback` · Production `https://sharptalk.amoeba.site/api/v1/auth/cafe24/callback`
4. Thêm 4 quyền dưới đây vào **Quyền (Scope)**. Tất cả đều là quyền đọc.

| Quyền | Dùng ở đâu |
|---|---|
| `mall.read_order` | Đồng bộ đơn hàng (chương 4) |
| `mall.read_product` | Nhập sản phẩm (chương 5) |
| `mall.read_category` | Tên danh mục của sản phẩm (chương 5) — thiếu quyền này thì danh mục của tài liệu tri thức sẽ bị trống |
| `mall.read_customer_identifier` | Đăng nhập thành viên (chương 7) |

⚠️ **Cafe24 chỉ nhận một Redirect URI cho mỗi ứng dụng.** Vì vậy kết nối quản trị và đăng nhập thành viên dùng chung một callback (`/auth/cafe24/callback`), và SharpTalk tự phân biệt loại yêu cầu ở bên trong. Staging và production có địa chỉ callback khác nhau, nên hãy **tạo ứng dụng riêng**.

💡 **Mẹo**: **Không cần** quyền thông tin cá nhân của thành viên (`mall.read_personal`). ID thành viên đã có trong phản hồi token đăng nhập thành viên nên không phải đọc tài nguyên thông tin cá nhân. Càng ít quyền thì việc Cafe24 duyệt và người vận hành gian hàng đồng ý càng dễ.

### 1.2 Nếu thêm quyền về sau

Thêm quyền **không áp dụng cho các gian hàng đã kết nối.** Vì token được cấp theo quyền tại thời điểm đồng ý. Sau khi thêm quyền, từng tenant phải **bấm lại [Kết nối Cafe24] ở chương 3 để đồng ý lại**. Nếu chạy tính năng dùng quyền mới mà chưa đồng ý lại, Cafe24 sẽ từ chối với `insufficient_scope`.

### 1.3 Biến môi trường máy chủ

Đặt trong tệp env của container API (`env/backend/.env.{môi_trường}`).

| Biến | Giá trị | Ghi chú |
|---|---|---|
| `CAFE24_CLIENT_ID` | Client ID của ứng dụng | **Bắt buộc** — để trống thì khi kết nối sẽ báo E5010 |
| `CAFE24_CLIENT_SECRET` | Client Secret của ứng dụng | **Bắt buộc** |
| `CAFE24_REDIRECT_URI` | **Giống đến từng ký tự** với địa chỉ callback ở 1.1 | Khác thì trao đổi token sẽ thất bại |
| `CAFE24_CONSOLE_RETURN_URL` | Địa chỉ console (ví dụ: `https://sharptalk.amoeba.site`) | Nơi người vận hành quay về sau khi kết nối |
| `CAFE24_SCOPES` | `mall.read_order,mall.read_product,mall.read_category` | Quyền của kết nối quản trị |
| `CAFE24_CUSTOMER_SCOPES` | `mall.read_customer_identifier` | Quyền của đăng nhập thành viên |
| `CAFE24_SYNC_INTERVAL_MIN` | Ví dụ: `30` | Chu kỳ tự động đồng bộ đơn hàng (phút). `0` là tắt |
| `CAFE24_LOGIN_SYNC_LOOKBACK_DAYS` | Mặc định `30` (tối đa 90) | Phạm vi đồng bộ bổ sung ngay sau khi thành viên đăng nhập |

⚠️ **Đừng để lại dòng có giá trị trống (`CAFE24_SCOPES=`).** Dòng trống không được hiểu là "dùng giá trị mặc định" mà là "giá trị rỗng" — màn hình đồng ý sẽ mở với quyền rỗng, hoặc sau khi kết nối không quay về được console. Biến không dùng thì xóa cả dòng, biến có dùng thì ghi rõ giá trị như bảng trên. `CAFE24_CUSTOMER_REDIRECT_URI`·`CAFE24_API_HOST_TEMPLATE`·`CAFE24_AUTH_HOST_TEMPLATE`·`CAFE24_API_VERSION` nếu không có lý do đặc biệt thì xóa cả dòng.

⚠️ Sau khi đổi env, hãy khởi động lại container API và kiểm tra log khởi động có in `Cafe24 auto-sync enabled — every N min` (hoặc `disabled`) đúng như ý định.

---

## 2. Cài đặt cơ bản của tenant — tên miền cửa hàng · URL cửa hàng

Trước tiên hãy lưu hai giá trị trong thẻ **Cài đặt gian hàng > Cài đặt cơ bản > Cửa hàng**. Lý do phải làm trước khi kết nối là SharpTalk dùng các giá trị này để **kiểm tra "gian hàng này có thực sự là của tenant này không"**.

| Trường | Giá trị cần nhập | Dùng ở đâu |
|---|---|---|
| Tên miền cửa hàng | `yourmall.cafe24.com` | Căn cứ để widget tìm ra tenant này · kiểm tra khớp gian hàng khi kết nối/đồng bộ |
| URL cửa hàng | `https://yourmall.cafe24.com` | Căn cứ để biến liên kết sản phẩm trong trò chuyện thành liên kết bấm được |

**Kiểm tra khớp gian hàng**: Nếu tên miền cửa hàng (hoặc URL cửa hàng) là `*.cafe24.com`, khi ở chương 3 bạn nhập một Mall ID khác để kết nối thì sẽ bị từ chối (E5045), và kết nối đã lưu mà khác gian hàng thì việc đồng bộ đơn hàng cũng bị từ chối. Đây là cơ chế ngăn **sự cố đơn hàng của cửa hàng khác lẫn vào** chỉ vì gõ sai một ký tự.

⚠️ Nếu hai giá trị trỏ tới **hai gian hàng Cafe24 khác nhau** thì không thể tin bên nào, nên cả kết nối lẫn đồng bộ đều bị từ chối. Hãy đặt cả hai cùng một gian hàng.

💡 **Mẹo**: Gian hàng dùng tên miền riêng của thương hiệu (ví dụ: `www.brand.co.kr`) vẫn kết nối được — nhưng vì không có căn cứ để so sánh nên bước kiểm tra khớp gian hàng bị bỏ qua và chỉ ghi cảnh báo vào log máy chủ. Trường hợp này hãy kiểm tra Mall ID thật kỹ. Đăng nhập thành viên (chương 7) chỉ hoạt động trên địa chỉ `*.cafe24.com`.

---

## 3. Kết nối gian hàng — đồng ý OAuth

Thực hiện ở thẻ **Cafe24 (OAuth)** trong **Cài đặt gian hàng > Tích hợp nền tảng**. Chỉ cấp master mới làm được.

1. Nhập ID gian hàng vào ô **Mall ID** (`yourmall`). Dán `yourmall.cafe24.com` hay `https://yourmall.cafe24.com/` cũng được, hệ thống tự chỉ lấy Mall ID.
2. Bấm **[Kết nối Cafe24]** để chuyển sang màn hình đồng ý của Cafe24.
3. Đăng nhập bằng **tài khoản vận hành chính của gian hàng** và đồng ý cấp quyền.
4. Khi quay về console, toast 「Đã kết nối Cafe24: yourmall」 hiện ra và trạng thái chuyển thành **Đã kết nối**. Từ lúc này các nút **[Đồng bộ ngay]**·**[Nhập sản phẩm]** xuất hiện.

| Hiển thị khi quay về | Ý nghĩa · cách xử lý |
|---|---|
| Đã kết nối Cafe24: {gian hàng} | Thành công |
| Cafe24 từ chối các quyền được yêu cầu (invalid_scope) | Ứng dụng Developers chưa có quyền đó → thêm 4 quyền ở 1.1 rồi kết nối lại |
| Cafe24 đã từ chối cấp quyền (access_denied) | Đã hủy ở màn hình đồng ý hoặc tài khoản không có quyền → thử lại bằng tài khoản vận hành chính |
| Kết nối Cafe24 thất bại | Một trong các nguyên nhân dưới đây — xem FAQ chương 9 |

Nguyên nhân thường gặp của 「Kết nối Cafe24 thất bại」:

- Mall ID khác với gian hàng của tên miền cửa hàng (E5045) → kiểm tra tên miền cửa hàng ở chương 2
- Gian hàng đó **đã được kết nối với tenant khác** (E5046) → một gian hàng chỉ kết nối với một tenant
- Ở màn hình đồng ý quá 10 phút (E5011) → làm lại từ đầu
- Máy chủ thiếu giá trị ứng dụng (E5010) → yêu cầu quản trị viên nền tảng làm mục 1.3

💡 **Mẹo**: Cùng một tenant **kết nối lại cùng gian hàng** lúc nào cũng an toàn. Khi đã thêm quyền (mục 1.2) hoặc token hết hạn (mục 4.3), chỉ cần bấm lại [Kết nối Cafe24] là token mới sẽ thay thế.

⚠️ Console **không có nút ngắt kết nối.** Nếu lỡ kết nối sai gian hàng, hãy kết nối lại với gian hàng đúng (cùng tenant thì sẽ được thay thế), hoặc yêu cầu quản trị viên nền tảng xóa thông tin xác thực.

---

## 4. Đồng bộ đơn hàng

Cafe24 không có webhook thời gian thực như Shopify, nên SharpTalk **lấy đơn hàng theo định kỳ.** Đơn hàng lấy về được dùng cho tư vấn AI (hỏi về giao hàng v.v.) và 'đơn hàng của tôi' trong widget (chương 7).

### 4.1 Ba đường đồng bộ

| Đường | Phạm vi | Khi nào |
|---|---|---|
| Nút **[Đồng bộ ngay]** | **7 ngày** gần nhất · tối đa 2.000 đơn | Khi người vận hành bấm |
| Đồng bộ tự động | 7 ngày gần nhất | Mỗi `CAFE24_SYNC_INTERVAL_MIN` phút, cho mọi tenant đã kết nối |
| Bổ sung khi thành viên đăng nhập | **30 ngày** gần nhất (tối đa 90 ngày nếu cấu hình) | Ngay sau khi thành viên đăng nhập trong widget |

### 4.2 Các bước

1. Bấm **[Đồng bộ ngay]**.
2. Kết quả hiển thị trên toast (ví dụ: `Synced 12 order(s)`).
3. Kiểm tra đơn hàng Cafe24 có hiện trong menu **Đơn hàng** của console không.

💡 **Mẹo**: Truy vấn đơn hàng của Cafe24 chỉ cho phép phạm vi **tối đa 3 tháng mỗi lần**. Vì vậy không đường nào lấy quá 90 ngày. Với câu hỏi về đơn hàng cũ, nhân viên tư vấn hãy kiểm tra trực tiếp trong quản trị Cafe24.

### 4.3 Duy trì token

Token kết nối gồm **access token 2 giờ + refresh token 14 ngày**, và SharpTalk tự làm mới mỗi lần sử dụng. Nếu đồng bộ tự động đang bật, việc làm mới diễn ra liên tục nên token không bao giờ hết hạn.

⚠️ Ở bản triển khai tắt đồng bộ tự động, nếu **không đồng bộ gì quá 14 ngày** thì refresh token sẽ hết hạn. Khi đó kết quả đồng bộ hiển thị `Cafe24 store is not connected — reconnect the mall`, và làm lại [Kết nối Cafe24] ở chương 3 là khôi phục được.

---

## 5. Sản phẩm → tri thức

Thông tin sản phẩm trở thành tri thức qua **hai bước**. Đặt bước xem trước ở giữa là để việc cập nhật danh sách sản phẩm không âm thầm thay đổi kho tri thức.

```
[Nhập sản phẩm] (Cài đặt gian hàng > Tích hợp nền tảng)   sản phẩm Cafe24 → danh sách sản phẩm SharpTalk
        │
        ▼
[Đồng bộ từ danh mục sản phẩm] (Kho tri thức)            xem trước → [Chạy đồng bộ] → mỗi sản phẩm 1 tài liệu tri thức + chỉ mục
```

### 5.1 Nhập sản phẩm

1. Bấm **[Nhập sản phẩm]** ở **Cài đặt gian hàng > Tích hợp nền tảng > Cafe24 (OAuth)**.
2. Nếu hiện 「Đã đồng bộ N sản phẩm, M đã lưu trữ — hãy chạy chuyển đổi ở trang Kho tri thức」 là thành công.

- **Đã lưu trữ**: sản phẩm lần này không tìm thấy trên gian hàng (đã xóa · không hiển thị). Chỉ lưu trữ khi lần nhập chạy hoàn tất đến cuối; lần chạy bị ngắt giữa chừng không lưu trữ gì cả.
- Lấy tên sản phẩm · giá · danh mục · giá trị tùy chọn · thẻ sản phẩm. Sản phẩm có mô tả ngắn (dưới 80 ký tự) sẽ được truy vấn thêm mô tả chi tiết.

### 5.2 Chuyển thành tri thức

1. Trong menu **Kho tri thức**, bấm **[Đồng bộ từ danh mục sản phẩm]**.
2. Ở phần xem trước, kiểm tra số lượng mới · cập nhật · gộp · giữ lại.
3. **[Chạy đồng bộ]** → ghi tài liệu → lập chỉ mục (embedding) xong là hoàn tất. Mất vài phút, và vẫn tiếp tục dù đóng cửa sổ.

| Mục xem trước | Ý nghĩa |
|---|---|
| Tài liệu mới / Tài liệu đã cập nhật | Mỗi sản phẩm 1 tài liệu. Chạy lại cũng không tạo bản trùng |
| Biến thể được gộp | Các biến thể màu sắc · dung tích của cùng sản phẩm được gộp vào một tài liệu |
| Giữ nguyên bản viết tay | Tài liệu do người chỉnh sửa không bị ghi đè nội dung, chỉ làm mới liên kết · trạng thái bán |
| Được giữ lại | Sản phẩm có mô tả và thẻ **đều** trống nên không thể làm căn cứ trả lời |

💡 **Mẹo**: Cửa hàng Hàn Quốc thường đăng mô tả chi tiết **chỉ bằng hình ảnh** nên hầu như không có mô tả dạng văn bản. Vì vậy SharpTalk luôn điền danh mục · giá trị tùy chọn · thẻ sản phẩm vào thẻ, để sản phẩm không bị giữ lại dù không có mô tả. Để nâng chất lượng câu trả lời, hãy điền **từ khóa tìm kiếm (thẻ)** và **mô tả ngắn** dạng văn bản cho sản phẩm Cafe24.

⚠️ Dù tri thức đã được tạo, nếu **URL cửa hàng (chương 2)** trống thì trích dẫn sản phẩm trong trò chuyện chỉ hiện dạng chữ không có liên kết. Liên kết sản phẩm Cafe24 được tạo theo dạng `https://yourmall.cafe24.com/product/detail.html?product_no={số}`.

---

## 6. Cài widget — Smart Design

### 6.1 Sao chép đoạn mã

1. Ở thẻ **Cài đặt gian hàng > Cài đặt widget > Cài đặt lên cửa hàng của bạn**, chọn nền tảng **Cafe24**.
2. Sao chép đoạn mã hiển thị. Tên miền cửa hàng (chương 2) đã được điền sẵn.

```html
<!-- SharpTalk widget (Cafe24) -->
<script>
  window.SHARPTALK_WIDGET_CONFIG = {
    shop: "yourmall.cafe24.com",
    locale: "ko",
    widgetUrl: "https://shoptalk.amoeba.site/widget",
    loginPath: "/member/login.html",
    loginReturnParam: "returnUrl"
  };
</script>
<script src="https://shoptalk.amoeba.site/widget/embed.js" defer></script>
```

### 6.2 Dán vào quản trị Cafe24

1. Quản trị Cafe24 → mở **Thiết kế (PC/Mobile) → chỉnh sửa Smart Design**.
2. Mở HTML layout (layout chung) của **thiết kế đang dùng**.
3. Dán đoạn mã ngay trước `</body>` rồi **lưu/triển khai**.
4. **Nếu thiết kế PC và thiết kế mobile tách riêng thì dán vào cả hai**.

💡 **Mẹo**: Hãy **sao chép nguyên văn** đoạn mã từ console. Nếu sửa tay mà làm mất đường dẫn `/widget`, thay vì widget thì màn hình console sẽ phản hồi (mã trạng thái 200) và widget không hiện mà không có lỗi nào.

⚠️ Khi tạo thiết kế mới hoặc đổi thiết kế đang dùng, **thiết kế mới không có đoạn mã.** Sau khi đổi thiết kế nhất định phải dán lại.

---

## 7. Đăng nhập thành viên · đơn hàng của tôi

Cafe24 không có kênh nào báo cho widget biết "thành viên đang đăng nhập là ai". Vì vậy SharpTalk dùng **xác thực khách hàng (OAuth thành viên)** của Cafe24 để gắn hội thoại widget với thành viên bằng ID thành viên do chính Cafe24 xác nhận.

### 7.1 Luồng khách hàng nhìn thấy

1. Trong tab **Đơn hàng** của widget, bấm **[Đăng nhập]**.
2. Đăng nhập Cafe24 (bỏ qua nếu đã đăng nhập) → qua màn hình đồng ý của gian hàng.
3. Widget mở lại ở tab đơn hàng và hiển thị **tối đa 10 đơn hàng trong 30 ngày gần nhất**.
4. Đơn hàng cũ hơn được dẫn qua **[Xem thêm]** → trang tra cứu đơn hàng trong trang của tôi của gian hàng (`/myshop/order/list.html`).

### 7.2 Cài đặt của người vận hành

Chọn **Đăng nhập khách hàng mở bằng** trong **Cài đặt gian hàng > Cài đặt widget > Hành vi của widget**.

| Cách | Hoạt động | Khi nào |
|---|---|---|
| Toàn trang (khuyến nghị) | Đăng nhập trong cùng tab rồi quay lại trang ban đầu, widget tự mở lại | Mặc định · ổn định nhất |
| Cửa sổ popup | Đăng nhập trong cửa sổ nhỏ, xong thì cửa sổ tự đóng và trang giữ nguyên | Khi muốn tránh chuyển trang như ở giỏ hàng |

💡 **Mẹo**: Nếu popup bị trình duyệt chặn, hệ thống tự chuyển sang cách toàn trang và việc đăng nhập vẫn tiếp tục.

### 7.3 Bảo mật · giới hạn

- Token Cafe24 không được chuyển tới widget. Sau khi máy chủ xác nhận xong, chỉ trả về trang gian hàng một **vé dùng một lần (60 giây)**, và widget đổi vé này lấy phiên hội thoại.
- Địa chỉ quay về sau khi đăng nhập **chỉ được phép là địa chỉ `*.cafe24.com` của gian hàng đó**.
- ⚠️ **Khách truy cập qua tên miền riêng không dùng được đăng nhập thành viên.** Vì địa chỉ duy nhất mà widget có thể suy ra Mall ID là `yourmall.cafe24.com`. Trên gian hàng dùng tên miền riêng, tư vấn qua widget vẫn bình thường nhưng 'đơn hàng của tôi' không hiển thị.
- Nếu một gian hàng đang kết nối với hai tenant thì không thể quyết định cho đăng nhập vào tenant nào nên **đăng nhập bị từ chối** (E5046 ở chương 3 ngăn trạng thái này).

---

## 8. Danh sách kiểm tra công việc

**Quản trị viên nền tảng (một lần cho mỗi bản triển khai)**
- [ ] Tạo ứng dụng Developers, Redirect URI = `/api/v1/auth/cafe24/callback` của bản triển khai này
- [ ] 4 quyền: `mall.read_order` · `mall.read_product` · `mall.read_category` · `mall.read_customer_identifier`
- [ ] Trong env có Client ID/Secret · Redirect URI · địa chỉ console · quyền · chu kỳ đồng bộ tự động — **không có dòng trống**
- [ ] Sau khi khởi động lại API, kiểm tra dòng `Cafe24 auto-sync` trong log khởi động

**Master của tenant (cho từng gian hàng)**
- [ ] Cài đặt gian hàng > Cài đặt cơ bản: tên miền cửa hàng `yourmall.cafe24.com`, URL cửa hàng `https://yourmall.cafe24.com`
- [ ] Cài đặt gian hàng > Tích hợp nền tảng: nhập Mall ID → [Kết nối Cafe24] → toast 「Đã kết nối」
- [ ] [Đồng bộ ngay] → đơn hàng Cafe24 hiện trong menu Đơn hàng
- [ ] [Nhập sản phẩm] → Kho tri thức > [Đồng bộ từ danh mục sản phẩm] → xem trước → [Chạy đồng bộ]
- [ ] Cài đặt gian hàng > Cài đặt widget: dán đoạn mã của Cài đặt lên cửa hàng của bạn (Cafe24) vào trước `</body>` của layout Smart Design PC·mobile
- [ ] Widget hiện trên gian hàng, và câu hỏi về sản phẩm nhận được câu trả lời kèm liên kết sản phẩm
- [ ] Dùng thành viên thử nghiệm bấm [Đăng nhập] trong widget → tab đơn hàng hiện đơn hàng của thành viên đó

---

## 9. FAQ / xử lý sự cố

**Q. Bấm [Kết nối Cafe24] thì 「Kết nối Cafe24 thất bại」 hiện ngay.**
Đây là trường hợp thất bại **trước khi** sang màn hình đồng ý. Là một trong: ① Mall ID khác với gian hàng của tên miền cửa hàng (E5045) ② gian hàng đó đã kết nối với tenant khác (E5046) ③ máy chủ thiếu giá trị ứng dụng (E5010). Với ① hãy kiểm tra cài đặt ở chương 2; với ②·③ hãy liên hệ quản trị viên nền tảng.

**Q. Đã đồng ý xong nhưng quay về console lại hiện 「Kết nối Cafe24 thất bại」.**
Đây là trường hợp trao đổi token thất bại. Nguyên nhân phổ biến nhất là `CAFE24_REDIRECT_URI` trong env khác với địa chỉ đã đăng ký trong Developers (kể cả `/` ở cuối, `http`/`https`). Nếu đã ở màn hình đồng ý quá 10 phút thì hãy làm lại từ đầu.

**Q. Hiện 「Cafe24 từ chối các quyền được yêu cầu (invalid_scope)」.**
Quyền mà SharpTalk yêu cầu chưa được đăng ký trong ứng dụng Developers. Phía SharpTalk không cần sửa gì; hãy thêm các quyền ở mục 1.1 vào ứng dụng rồi kết nối lại.

**Q. Kết quả [Đồng bộ ngay] là `refusing to sync: tenant runs on A.cafe24.com but the stored credential is for "B"`.**
Kết nối đã lưu không phải gian hàng của tenant này. Đồng bộ đang bị chặn để đơn hàng của cửa hàng khác không lẫn vào. Hãy làm lại [Kết nối Cafe24] với Mall ID đúng. Nếu báo `names two malls` thì tên miền cửa hàng và URL cửa hàng đang trỏ tới hai gian hàng khác nhau, hãy chỉnh cho khớp ở chương 2.

**Q. Kết quả đồng bộ là `Cafe24 store is not connected — reconnect the mall`.**
Là trường hợp chưa từng kết nối, hoặc không dùng quá 14 ngày nên refresh token đã hết hạn (mục 4.3). Hãy làm lại [Kết nối Cafe24].

**Q. Đã nhập sản phẩm nhưng AI không biết sản phẩm.**
[Nhập sản phẩm] chỉ điền danh sách sản phẩm. Phải làm tiếp **Kho tri thức > [Đồng bộ từ danh mục sản phẩm] → [Chạy đồng bộ]** thì mới được dùng trong câu trả lời (mục 5.2).

**Q. Danh mục của tài liệu tri thức bị trống.**
Gian hàng được kết nối khi chưa có quyền `mall.read_category`. Hãy thêm quyền vào ứng dụng (mục 1.1), đồng ý lại bằng [Kết nối Cafe24], rồi chạy lại [Nhập sản phẩm] và đồng bộ danh mục sản phẩm.

**Q. Trích dẫn sản phẩm trong trò chuyện không có liên kết.**
**URL cửa hàng** trong Cài đặt gian hàng > Cài đặt cơ bản đang trống hoặc khác địa chỉ gian hàng. Hãy lưu thành `https://yourmall.cafe24.com`.

**Q. Widget không hiện trên gian hàng.**
Hãy kiểm tra ① đoạn mã có nằm trong layout của **thiết kế đang dùng hiện tại** không (sẽ mất khi đổi thiết kế) ② có ở cả thiết kế PC lẫn mobile không ③ `shop` trong đoạn mã có giống tên miền cửa hàng ở Cài đặt gian hàng > Cài đặt cơ bản không. Cách nhanh là xem trong tab Network của công cụ dành cho nhà phát triển của trình duyệt xem `embed.js` có được tải về dưới dạng JavaScript không (nếu là HTML thì địa chỉ sai).

**Q. Thành viên đã đăng nhập nhưng widget vẫn ở trạng thái chưa đăng nhập.**
Hãy kiểm tra ① nếu khách đang truy cập qua tên miền riêng thì đăng nhập thành viên không hoạt động (mục 7.3) ② ứng dụng có quyền `mall.read_customer_identifier` không ③ gian hàng chỉ kết nối với tenant này không. Dù thất bại, khách vẫn lặng lẽ quay về trang ban đầu, nên lý do phải xem ở các dòng `Cafe24 customer-auth … failed` / `Cafe24 member sign-in callback failed` trong log máy chủ.

**Q. Đăng nhập được nhưng 'đơn hàng của tôi' trống.**
Là trường hợp trong 30 ngày gần nhất không có đơn hàng nào bằng ID thành viên đó, hoặc chưa được đồng bộ. Ngay sau khi đăng nhập, đồng bộ bổ sung phạm vi 30 ngày chạy tự động, nhưng nếu không có quyền tra cứu đơn hàng (`mall.read_order`) thì sẽ thất bại. Đơn hàng của khách không phải thành viên không có ID thành viên nên không hiển thị.

**Q. Staging và production có dùng chung một ứng dụng Developers được không?**
Không được. Ứng dụng Cafe24 chỉ nhận một Redirect URI nên không thể đồng thời hỗ trợ hai bản triển khai có địa chỉ callback khác nhau. Hãy tạo mỗi bản triển khai một ứng dụng.
