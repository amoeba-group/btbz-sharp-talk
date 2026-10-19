# Hướng dẫn kết nối Notion với SharpTalk cho Go2Joy

- Đối tượng: Quản trị workspace Notion của Go2Joy (chủ sở hữu integration "HA-UserGuide")
- Ngày kiểm tra: 19/10/2026 (đo thực tế trên staging)
- Hướng dẫn trước (28/08/2026, theo integration "Truc connection") không còn đúng sau khi đổi token ngày 16/10; tài liệu này thay thế.

> Những việc quản trị Notion của Go2Joy cần làm để SharpTalk đọc được trang Notion làm tri thức cho AI tư vấn. Thao tác hoàn toàn trong Notion, mỗi trang khoảng 1 phút.

## 1. Tình trạng hiện tại

Cấu hình phía SharpTalk đã hợp lệ. Token hoạt động, và chúng tôi đã kiểm tra trực tiếp qua Notion API danh tính cùng phạm vi truy cập của integration.

| Mục | Kết quả |
|---|---|
| Integration đã đăng ký | **HA-UserGuide** (đổi ngày 16/10) |
| Workspace của integration | **Go2Joy** |
| Trang integration nhìn thấy | **Chỉ 1 trang** — "Hướng dẫn sử dụng Hotel Admin" (ID `bfb56ba4…`) |

Cả 3 nguồn Notion đã đăng ký trong SharpTalk đều đồng bộ thất bại vì cùng một lý do: **trang chưa được kết nối (Connections) với integration "HA-UserGuide".**

| # | Nguồn trong SharpTalk | Trang Notion đã đăng ký | Trạng thái |
|---|---|---|---|
| 1 | Go2Joy Hotel FAQ (Notion) | `hotel-go2joy.notion.site/FAQ-f03737634c38…` | ❌ Chưa kết nối |
| 2 | Hướng dẫn sử dụng Hotel Admin | `…8968fee0bb548347a35e01756b4cc89c` | ❌ Chưa kết nối (integration chỉ thấy trang cùng tên có ID `bfb56ba4…` — xem 2-D) |
| 3 | Hướng dẫn đăng ký khách sạn trên Go2Joy | `…2026dfbd464d800085cedea4c57f8d15` | ❌ Chưa kết nối |

## 2. Việc cần làm phía Go2Joy

### A. Kết nối 3 trang với integration (khoảng 1 phút mỗi trang)

Với từng trang trong 3 trang dưới đây:

1. Mở trang trong Notion.
2. Bấm **⋯** ở góc trên bên phải → chọn **Connections** ở phần dưới menu.
3. Gõ **HA-UserGuide** → chọn → **xác nhận** cấp quyền truy cập.
4. Khi "HA-UserGuide" xuất hiện trong **⋯ → Connections** của trang là xong.

Các trang cần kết nối:

- **Go2Joy Hotel FAQ** — `https://hotel-go2joy.notion.site/FAQ-f03737634c3848339910d50f7e77bf7b`
- **Hướng dẫn sử dụng Hotel Admin** — ID `8968fee0bb548347a35e01756b4cc89c` (xem 2-D)
- **Hướng dẫn đăng ký khách sạn trên Go2Joy** — ID `2026dfbd464d800085cedea4c57f8d15`

**Trang con tự động kế thừa.** Chỉ cần kết nối trang cha, không cần làm từng trang con.

### B. "Publish to web" không phải là kết nối

Trang FAQ đang được publish tại `hotel-go2joy.notion.site`. Publish chỉ cho phép xem bằng trình duyệt; **Notion API chỉ đọc được trang đã được kết nối với integration**, bất kể trang có public hay không. Vì vậy vẫn phải làm bước A.

### C. Kiểm tra workspace

Integration "HA-UserGuide" được cài trong workspace **Go2Joy**. Cả 3 trang phải nằm trong workspace này thì "HA-UserGuide" mới xuất hiện khi tìm trong Connections. Nếu không tìm thấy, trang đang ở workspace khác: chuyển trang sang Go2Joy, hoặc tạo integration mới trong workspace đó và đăng ký lại token (xem mục E).

### D. "Hướng dẫn sử dụng Hotel Admin": xác nhận đúng trang

ID đăng ký trong SharpTalk là `8968fee0…`, nhưng integration hiện chỉ thấy trang cùng tên có ID `bfb56ba4…`. Có 2 khả năng:

- Trang đã được nhân bản hoặc di chuyển nên đổi ID → nếu `bfb56ba4…` là bản mới nhất, chỉ cần báo chúng tôi; SharpTalk sẽ đổi ID nguồn (Go2Joy không cần làm gì thêm).
- Là 2 trang khác nhau → kết nối cả trang `8968fee0…` theo mục A.

Cách kiểm tra: mở trang trong Notion và xem 32 ký tự cuối trên thanh địa chỉ.

### E. Lưu ý khi thay token (integration)

Ngày 16/10 integration đổi từ "Truc connection" sang "HA-UserGuide" nên **mọi trang đã kết nối với integration cũ không còn hiển thị với integration mới** (Connections được quản lý riêng theo từng integration). Nếu sau này cần đổi token:

1. Tạo integration mới,
2. **Kết nối lại tất cả trang** đang dùng làm nguồn SharpTalk,
3. Đăng ký token mới trong console SharpTalk.

Tốt nhất là giữ nguyên token hiện tại.

## 3. Sau khi kết nối: Go2Joy tự kiểm tra được

1. Console SharpTalk → **Tri thức** → bảng **Nguồn** → bấm **↻** (đồng bộ) ở dòng nguồn tương ứng.
2. Thành công: thông báo xanh và thời gian đồng bộ (màu đen) trên dòng nguồn.
3. Thất bại: thông báo đỏ hiển thị nguyên nhân và cách xử lý. Thấy thông báo dưới đây nghĩa là bước A chưa xong.
4. Sau khi đồng bộ thành công, hỏi thử trong chat widget: AI sẽ trích dẫn nội dung trang.

Ví dụ thông báo thất bại:

```
Không thể đọc đích của nguồn.
Could not find page with ID: f0373763-… Make sure the relevant pages and databases are shared with your integration "HA-UserGuide".
Trang Notion chưa được chia sẻ với integration — mở trang trong Notion, ⋯ → Connections, thêm integration.
```

Ví dụ thông báo thành công: `Đồng bộ: tạo 1, cập nhật 0`

## 4. Phạm vi và giới hạn

| Mục | Nội dung |
|---|---|
| Phạm vi | Trang chính + trang con cấp 1. Trang lồng sâu hơn không được thu thập. |
| Chỉ văn bản | Đoạn văn, tiêu đề, danh sách, toggle, bảng, code. Không thu thập hình ảnh, tệp, embed. |
| Giới hạn | Tối đa 200 trang mỗi lần, khoảng 30.000 ký tự mỗi trang. Trang quá dài nên tách thành trang con. |
| Cập nhật | Sửa trên Notion không tự cập nhật. Bấm ↻ lại trong console, chỉ phần thay đổi được cập nhật. |
| Xóa trang | Trang bị xóa sẽ được ẩn, không xóa vĩnh viễn. |
| Bảo mật | Token được mã hóa, chỉ đọc. Chỉ truy cập được trang đã kết nối và trang con của nó. |

## 5. Danh sách phản hồi

- [ ] Đã kết nối HA-UserGuide vào trang FAQ (`f0373763…`)
- [ ] Đã kết nối HA-UserGuide vào "Hướng dẫn đăng ký khách sạn…" (`2026dfbd…`)
- [ ] "Hướng dẫn sử dụng Hotel Admin": đã kết nối `8968fee0…`, hoặc xác nhận `bfb56ba4…` là bản mới nhất
- [ ] Ảnh chụp danh sách Connections (tùy chọn)

Liên hệ: đội vận hành SharpTalk (kênh liên lạc hiện có).
