# Widget trò chuyện·hỗ trợ khách hàng SharpTalk — Sổ tay người dùng (tổng hợp)

> Phiên bản 2.2.0 · Bản đầu 2026-07-01 · Sửa đổi toàn diện 2026-08-24 · **Cập nhật 2026-10-24** (dựa trên mã nguồn — tab Chuyển nhân viên·danh mục tư vấn·Trung tâm cảnh báo)
> Đối tượng: người vận hành tenant · nhân viên tư vấn · quản trị viên nền tảng
> Quy ước ký hiệu: **✅ đã triển khai / 🟡 đang chuẩn bị·lộ trình**. Ghi trung thực theo mã nguồn thực tế.
>
> ⚠ Bản dịch AI, đang chờ hiệu đính bởi người bản ngữ. Bản tiếng Hàn là bản chuẩn.
>
> Người mở tenant lần đầu hãy bắt đầu từ [Sổ tay thiết lập nhanh](quick-setup.vi.md),
> người muốn tinh chỉnh tri thức·AI xem [Sổ tay đăng ký tri thức·cài đặt AI](knowledge-ai.vi.md).
> Tài liệu này là **sổ tay tham chiếu lướt qua toàn bộ các màn hình**.

---

## Mục lục
1. [Bắt đầu (đăng nhập·vai trò·menu)](#1-bắt-đầu)
2. [Widget khách hàng](#2-widget-khách-hàng)
3. [Luồng trả lời của AI (tóm tắt)](#3-luồng-trả-lời-của-ai-tóm-tắt)
4. [Bảng điều khiển live chat](#4-bảng-điều-khiển-live-chat)
5. [Bảng yêu cầu](#5-bảng-yêu-cầu)
6. [Lịch sử hội thoại](#6-lịch-sử-hội-thoại)
7. [Nhật ký công việc](#7-nhật-ký-công-việc)
8. [Thống kê](#8-thống-kê)
9. [Tổng quan](#9-tổng-quan)
10. [Khách hàng·đơn hàng·sản phẩm](#10-khách-hàngđơn-hàngsản-phẩm)
11. [Chiến dịch](#11-chiến-dịch)
12. [Đánh giá](#12-đánh-giá)
13. [Tri thức·cài đặt AI (liên kết)](#13-tri-thứccài-đặt-ai)
14. [Cài đặt gian hàng](#14-cài-đặt-gian-hàng)
15. [Thông báo quyền riêng tư·Trang của tôi](#15-thông-báo-quyền-riêng-tưtrang-của-tôi)
16. [Bảng điều khiển quản trị viên nền tảng](#16-bảng-điều-khiển-quản-trị-viên-nền-tảng)
17. [FAQ / Xử lý sự cố](#17-faq--xử-lý-sự-cố)

---

## 1. Bắt đầu

### 1.1 Truy cập bảng điều khiển
- Bảng điều khiển tenant: `https://shoptalk.amoeba.site/user/<slug>` — địa chỉ đăng nhập riêng theo từng cửa hàng.
- Quản trị viên nền tảng: `/admin/login`.
- Đăng nhập bằng email + mật khẩu (JWT). Tài khoản được mời đăng nhập lần đầu bằng **mật
  khẩu tạm thời** rồi qua bước **đổi bắt buộc** (từ 10 ký tự·3 loại ký tự·cấm mật khẩu phổ biến).
- master/director và quản trị viên hệ thống bị bắt buộc đăng ký **MFA (TOTP)** (trước ngày
  hiệu lực có biểu ngữ gia hạn → sau ngày hiệu lực có hộp thoại chặn). Khi đăng ký, 10 mã
  khôi phục chỉ hiển thị **một lần duy nhất**.
- Toàn bộ quy trình onboarding: [Sổ tay thiết lập nhanh chương 1~2](quick-setup.vi.md).

### 1.2 Vai trò·quyền hạn (RBAC)
- **Cấp bậc (rank)**: master · director · manager · staff / **Nhãn công việc**: consult (tư vấn) ·
  accounting (kế toán) · operations (vận hành). Quản trị viên hệ thống: super · admin.
- Hiển thị menu theo **2 tầng**: ① menu mà quản trị viên nền tảng cung cấp cho tenant (mặc
  định theo gói + ngoại lệ) → ② quyền theo cấp bậc do master của tenant quy định + ngoại lệ
  theo người dùng (thẻ *Quyền truy cập menu* trong [Cài đặt gian hàng]). Nhập URL trực tiếp
  cũng bị máy chủ kiểm tra lại và chặn.
- Chính sách hiển thị theo chủ sở hữu (ACL) áp dụng bổ sung bên trên quyền chức năng.

### 1.3 Menu bảng điều khiển
Bấm logo ở thanh bên sẽ mở **danh sách thẻ các màn hình truy cập được** (`/menu`).

| Menu | Đường dẫn | Công dụng |
|---|---|---|
| Tổng quan | `/dashboard` | KPI·câu hỏi phổ biến·trạng thái tích hợp |
| Trò chuyện trực tiếp | `/live-chat` | Tư vấn thời gian thực·xử lý chuyển tiếp |
| Bảng yêu cầu | `/issues` | Bảng kanban ticket yêu cầu (tenant dùng quy trình native) |
| Lịch sử hội thoại | `/history` | Tra cứu hội thoại cũ·kiểm tra căn cứ |
| Nhật ký công việc | `/work-log` | Truy vết kiểm tra thao tác của nhân viên tư vấn |
| Thống kê | `/statistics` | Phân tích câu hỏi·kênh·nhân viên·kết quả·hài lòng·khung giờ |
| Cài đặt AI | `/ai-setting` | Agent·persona·quy tắc·kịch bản·hội thoại mặc định·nối công cụ·kiểm duyệt·huấn luyện |
| Kho tri thức | `/knowledge` | Bảng tri thức (`/knowledge/board`)·tài liệu·nguồn·kiểm chứng |
| Khách hàng / Đơn hàng / Sản phẩm | `/customers` `/orders` `/products` | Tra cứu·quản lý dữ liệu đệm |
| Chiến dịch / Đánh giá | `/campaigns` `/reviews` | Quản lý gửi tin·đánh giá |
| Người dùng | `/users` | Mời thành viên·cấp bậc·nhãn |
| Cài đặt gian hàng | `/settings` | 8 tab: Cài đặt cơ bản / Chuyển nhân viên / Cài đặt widget / Tích hợp nền tảng / Marketing & Helpdesk / Kênh nhắn tin / Cài đặt khác / Thông báo quyền riêng tư (§14) |
| Trung tâm cảnh báo | `/live-chat/alerts` | Lịch sử·phân công·xác nhận cảnh báo chuyển tư vấn (🔔 trên header → Xem tất cả, §4.4) |
| Trang của tôi | `/my-page` | Hồ sơ·mật khẩu·MFA |
| Quản trị | `/admin/*` | Quản lý nền tảng (chỉ quản trị viên hệ thống) |

---

## 2. Widget khách hàng

### 2.1 Bố cục màn hình
- **Launcher** trên trang cửa hàng (vị trí·kích thước·biểu tượng theo cài đặt chủ đề của
  tenant) → bấm để mở bảng (toàn màn hình trên di động / thẻ nổi trên desktop).
- Phần đầu: tên hiển thị của cửa hàng (hoặc logo), **chuyển ngôn ngữ** (6 thứ tiếng
  en/es/ko/vi/ja/zh — khi chuyển, ngôn ngữ phiên cũng được cập nhật lên máy chủ nên ngôn
  ngữ trả lời của AI đổi theo), cài đặt (bánh răng), đóng.
- **Tab**: Thông báo / Đơn hàng / Trò chuyện — tab nào hiện, theo thứ tự·vị trí nào
  (trên/dưới) theo cài đặt của tenant. Chỉ còn 1 tab thì thanh tab tự ẩn.

### 2.2 Tab thông báo·đơn hàng
- Chip của tab thông báo: `Tất cả · Sự kiện` / chip của tab đơn hàng: `Đơn hàng (danh sách
  đơn) · Giao hàng · Đánh giá · Yêu cầu`. **Tắt một tab thì các chip của nó được hấp thu
  vào tab còn lại** — tắt tab không làm mất chức năng.
- Mỗi mục: biểu tượng·tiêu đề·huy hiệu trạng thái·nội dung·thời gian tương đối·chấm chưa
  đọc. Mục chưa đọc mới nhất được làm nổi bật.
- **Chi tiết đơn hàng**: sản phẩm·tổng tiền·bậc theo dõi giao hàng·**tra cứu vận chuyển**·
  **hỏi về đơn này** (đưa mã đơn hàng vào chat)·**viết đánh giá** theo từng sản phẩm (sao
  1~5 + nhận xét).
- Danh sách đơn hàng nội tuyến chỉ hiển thị giai đoạn gần đây; "Xem thêm" dẫn đến trang cá
  nhân của chính cửa hàng (Cafe24 là trang danh sách đơn, còn lại là trang tài khoản).

### 2.3 Tab trò chuyện
- Trên cùng: **thông báo tư vấn bằng AI** + liên kết **kết thúc tư vấn** (chỉ khi đang diễn ra).
- **Biểu ngữ đồng ý**: hiển thị khi vào lần đầu hoặc khi phiên bản thông báo thay đổi.
  Trước khi đồng ý, các chức năng cần thông tin cá nhân bị hạn chế.
- **Nút kịch bản**: menu nhanh do tenant cấu hình (mặc định 6 loại). Hỗ trợ sản phẩm mở
  menu con (cách dùng·thành phần·đổi/trả·hàng về lại). Sau câu trả lời có các chip nhanh
  (đơn của tôi/giao hàng/trả hàng/kết nối nhân viên tư vấn).
- **Xác minh danh tính (AuthGate)** 2 cách: ① đăng nhập cửa hàng — redirect (mặc định) hoặc
  popup theo cài đặt của tenant, tự xử lý đường dẫn đăng nhập Cafe24/Shopify, khi quay lại
  widget tự mở lại ② tra cứu đơn không cần tài khoản — mã đơn hàng+email (có giới hạn số lần).
- **Đính kèm**: ảnh ≤10MB (gồm HEIC — tự chuyển đổi) / tệp ≤20MB (pdf·txt·csv·docx·xlsx),
  tối đa 5 tệp mỗi tin nhắn. Có thể gửi chỉ tệp không kèm chữ.
- **Chọn danh mục tư vấn**: nếu tenant có danh mục tư vấn đang hiển thị cho khách, khi khách
  bấm [Kết nối nhân viên hỗ trợ] thẻ "Bạn cần hỗ trợ về vấn đề gì?" sẽ hiện trước và hội
  thoại được kết nối tới nhóm phụ trách của danh mục tư vấn đã chọn. Khi AI chuyển sang nhân
  viên tư vấn, cùng thẻ này cũng hiện dưới thông báo; chọn thì hội thoại được kết nối lại tới
  nhóm phụ trách đó (1 lần cho lựa chọn đầu tiên, trong khi chưa ai tiếp nhận). Bấm [Bỏ qua]
  thì kết nối như trước. Nếu không có danh mục tư vấn nào đang hiển thị thì kết nối ngay,
  không hiện thẻ (§14.1).
- **Chỉ báo chờ** 3 loại: AI đang soạn / nhân viên tư vấn đang trả lời / chờ chuyển tiếp
  (chưa có nhân viên tư vấn được phân công).
- **Kết thúc·mức độ hài lòng**: khách kết thúc thì sau xác nhận sẽ hiển thị đã kết thúc.
  Hội thoại đã kết thúc hiển thị thẻ **mức độ hài lòng (5 mức emoji = 1~5 điểm)** trong
  vòng 24 giờ. Gửi tin nhắn mới sẽ bắt đầu phiên tư vấn mới.

### 2.4 Cài đặt (bánh răng)
- **Quản lý đồng ý**: xem trạng thái·thời điểm·phiên bản, rút lại (xác nhận 2 bước — rút
  lại thì dừng tư vấn), đồng ý lại.
- Sau khi đăng nhập: **từ chối nhận marketing** (một công tắc duy nhất — từ chối khuyến
  mãi·phiếu giảm giá·mời đánh giá; thông báo đơn hàng·giao hàng vẫn gửi bình thường),
  **từ chối bán·chia sẻ dữ liệu** (CCPA/CPRA), **xuất dữ liệu của tôi** (tải JSON),
  **xóa dữ liệu của tôi** (xác nhận 2 bước — hoàn tất thì widget về trạng thái đăng xuất).
- Ma trận nhận tin theo danh mục×kênh đã bị gỡ khỏi widget và chuyển sang **chính sách của
  cửa hàng (cài đặt kênh thông báo trong bảng điều khiển)**.

---

## 3. Luồng trả lời của AI (tóm tắt)

```
Tin nhắn khách hàng → phân loại ý định (cần thông tin cá nhân → hướng dẫn xác minh danh tính)
  → khớp chuyển tiếp bắt buộc theo chính sách (deny-list):
      quy tắc "Không trả lời" → chuyển thẳng nhân viên tư vấn, không qua AI
      quy tắc "Trả lời rồi chuyển" → trả lời từ tri thức trước, rồi vẫn chuyển tiếp
  → tìm kiếm tri thức (RAG) → tạo câu trả lời (persona+quy tắc, tính độ tin cậy) → kiểm duyệt
  → độ tin cậy đủ: trả lời khách + nguồn / thiếu·bị chặn·khách yêu cầu: hàng chờ nhân viên tư vấn
```

- Tin nhắn do nhân viên tư vấn gửi cũng qua kiểm duyệt y hệt (không thể bỏ qua, lỗi thì chặn).
- Cách điều chỉnh từng điểm trong pipeline: [Sổ tay tri thức·AI](knowledge-ai.vi.md).

---

## 4. Bảng điều khiển live chat
*(`/live-chat` · người có nhãn consult)*

Bố cục 3 cột: **hàng chờ (trái) — hội thoại (giữa) — ngữ cảnh (phải)**. Danh sách tự làm
mới mỗi 5 giây.

### 4.1 Hàng chờ (trái)
- Phạm vi: **Tất cả / Cần nhân viên / Đã kết thúc** (mặc định Tất cả — hội thoại AI đang
  tiếp cũng hiển thị). Tab **Nhóm** ở hàng thứ hai là gộp nhóm phiên (§4.5).
- Lọc kênh + **lọc theo AI agent** (tất cả agent / từng agent). Tìm theo tên/email khách.
  Kênh: Widget·Telegram·Viber·Zalo·LINE·WhatsApp·WeChat·KakaoTalk·SMS·Email — hội thoại
  đến qua btbz relay cũng hiển thị đúng tên messenger gốc. **SMS chỉ nhận**: có huy hiệu
  và ô trả lời bị tắt.
- Mỗi hàng: **bí danh phiên** (nhân viên tư vấn sửa được nội tuyến; chưa đặt thì tên
  khách→email→ID phiên), huy hiệu kênh·trạng thái, chip AI agent được gán, chip "tự động
  trả lời OFF", tin nhắn cuối, thời gian trôi qua.
- **Ghim**: rê chuột lên hàng để hiện biểu tượng ghim. Hội thoại được ghim luôn nằm đầu
  danh sách — **dùng chung cả nhóm, tối đa 3 mỗi cửa hàng** (cái thứ 4 bị từ chối; hãy bỏ
  ghim một cái trước).
- Hàng bộ lọc·tìm kiếm được giữ cố định khi cuộn; chỉ vùng bên trong của 3 khung cuộn riêng.

### 4.2 Hội thoại (giữa)
- **Điều khiển tự động trả lời** ở phần đầu: `theo mặc định kênh / tự động / duyệt rồi gửi
  / tắt` + huy hiệu trạng thái hiện tại (AI đang trả lời / nhân viên trả lời / chờ duyệt).
  Hội thoại đã được nhân viên tư vấn tiếp nhận thì việc nhân viên trả lời được ưu tiên bất
  kể cài đặt này.
- Nút: **[Nhận]** (tiếp nhận — gán phụ trách), **[Trả về AI]** (chỉ khi ở trạng thái nhân
  viên — giao hội thoại lại cho AI, có hộp xác nhận), **[Kết thúc]**, **[Đồng bộ]** (làm
  mới thủ công), **[Ghim/Bỏ ghim]**, **[Chỉ định]** (đổi phụ trách sang AI agent khác hoặc
  nhân viên — đổi AI agent áp dụng **từ câu trả lời tiếp theo**).
- **4 thao tác trên tin nhắn khách** — hiện khi rê chuột lên bong bóng của khách (ẩn khi
  AI đang tự động trả lời hội thoại):
  | Thao tác | Tác dụng |
  |---|---|
  | Dịch | Chọn ngôn ngữ → bong bóng bản dịch **chỉ hiển thị trong bảng điều khiển** ngay dưới bản gốc (khách không thấy) |
  | Tra cứu kiến thức | Sao chép nội dung tin nhắn vào bảng tra cứu tri thức bên phải và truy vấn ngay |
  | Trả lời trích dẫn | Hiện chip trích dẫn phía trên ô soạn — khi gửi, phần trích dẫn được ghép vào tin nhắn |
  | Ghi nhận tin nhắn này thành sự cố | Tạo issue từ đoạn trích+loại+ghi chú (nếu hội thoại đã có issue thì thêm thành ghi chú) |
- **Chế độ duyệt rồi gửi**: bản nháp của AI hiện trong bảng có thể chỉnh sửa (kèm độ tin
  cậy), bấm **[Duyệt gửi]** thì gửi đi dưới danh nghĩa nhân viên tư vấn (kiểm duyệt·kiểm
  tra áp dụng như nhau). Cũng có thể [Hủy bỏ].
- **Soạn tin nhắn**: văn bản + đính kèm (cùng hạn mức với widget khách — ảnh 10MB/tệp
  20MB/tối đa 5). Gửi bị từ chối nghĩa là kiểm duyệt chặn — đổi cách diễn đạt rồi thử lại.
  **Kênh SMS chỉ nhận** nên ô soạn bị tắt.
- Dưới bong bóng trả lời AI có **[Lưu câu trả lời này vào kho tri thức]** (chỉ
  master/director): chụp câu trả lời thành bản nháp tài liệu tri thức.
- Tin nhắn cũ tải bằng "Tải tin nhắn cũ hơn".

### 4.3 Ngữ cảnh (phải)
- **Tóm tắt của AI**: tóm tắt hội thoại đến hiện tại·ý định·cảm xúc·hành động khuyến nghị.
  (Khi chọn một nhóm, chỗ này trở thành bảng **báo cáo hành trình khách hàng** — §4.5.)
- **Tra cứu tri thức**: hỏi trực tiếp kho tri thức ngay trong hội thoại (một cú bấm dùng
  tin nhắn cuối của khách) → xem câu trả lời·nguồn (huy hiệu stale/mâu thuẫn, lối tắt đến
  tài liệu) → **[Gửi cho khách] / [Sửa rồi gửi] (điền vào ô soạn) / [Đề xuất vào kho tri
  thức]** (đăng ký chờ người phụ trách tri thức duyệt).
- **Thẻ khách hàng**: tên·email·điện thoại·hạng + **liên kết khách hàng** (tìm và nối) /
  **tạo khách hàng**.
- Thẻ **đơn hàng gần đây**.
- **Bảng yêu cầu** (tenant quy trình native): số yêu cầu·trạng thái·loại·số lần mở lại,
  [Giải quyết]/[Từ chối] (bắt buộc lý do: không thể theo chính sách/phân công sai/spam),
  chọn phân công lại, dòng thời gian sự kiện.

### 4.4 Cảnh báo chuyển tiếp·Trung tâm cảnh báo·tự động kết thúc
- **Cảnh báo escalation**: khi có chuyển tiếp mới, dù đang ở đâu trong bảng điều khiển,
  trong 10 giây sẽ hiện popup cảnh báo. Popup hiển thị lý do (độ tin cậy thấp/kiểm duyệt
  chặn/khách yêu cầu/kết nối lại do chọn danh mục tư vấn) cùng **khách sạn·khu vực·danh mục
  tư vấn**, **Phân công: tên nhân viên tư vấn** ("Tất cả" nếu không có quy tắc phù hợp) và
  **tên quy tắc**. Cảnh báo hiển thị cho mọi nhân viên tư vấn của cùng tenant; cảnh báo đã
  phân công cho nhân viên khác có thêm nhãn *Giao cho nhân viên khác*.
  - **[Bỏ qua]**: chỉ ẩn trên màn hình của bạn (đánh dấu đã đọc). Cảnh báo·nhắc lại của người
    được phân công vẫn giữ nguyên.
  - **[Mở hội thoại]**: chuyển tới hội thoại. Nếu bạn là người được phân công hoặc đó là
    cảnh báo gửi tất cả thì cảnh báo được **xác nhận** (ngừng nhắc lại).
- **🔔 trên header**: số cảnh báo chưa đọc. Bấm vào sẽ mở 20 cảnh báo gần nhất (đã đọc hay
  chưa·phân công·trạng thái·người xác nhận); *Xem tất cả* dẫn tới **Trung tâm cảnh báo**
  (`/live-chat/alerts`).
- **Trung tâm cảnh báo**: lọc theo Tất cả / Giao cho tôi / Gửi tất cả, trạng thái (chưa xác
  nhận·đã xác nhận), khoảng thời gian (1·7·30·90 ngày), danh mục tư vấn. Bấm vào hàng để tới
  hội thoại; cảnh báo bạn có thể xác nhận sẽ có nút [Xác nhận].
- **Cài đặt cảnh báo (cá nhân)**: *Cài đặt cảnh báo* trong ngăn 🔔 hoặc Trung tâm cảnh báo —
  popup (Mọi cảnh báo / Chỉ cảnh báo giao cho tôi (gồm cảnh báo gửi tất cả) / Tắt), âm thanh
  (nghe thử), thông báo desktop của trình duyệt (cần quyền trình duyệt), nhận email khi được
  phân công cho tôi. Tắt popup thì mọi cảnh báo vẫn còn trong 🔔 và Trung tâm cảnh báo.
- Trên header hội thoại live chat, danh mục tư vấn khách đã chọn hiển thị bằng huy hiệu
  `Tư vấn: Thanh toán`, và cũng được ghi lại thành dòng hệ thống trong hội thoại.
- **Tự động kết thúc hội thoại bị bỏ quên** (hành vi máy chủ, chỉ kênh widget): cả hai bên
  im lặng 30 phút thì gửi "Còn gì tôi có thể giúp thêm không?", không phản hồi trong 1 phút
  thì kết thúc. Hội thoại quá 7 ngày được kết thúc lặng lẽ. Hội thoại đang chờ hồi âm email
  không bị tự động kết thúc.

### 4.5 Gộp nhóm phiên & báo cáo hành trình khách hàng
- **[Chọn]** ở đầu danh sách → tích 2 phiên trở lên → **[Tạo nhóm]**. 2 loại: **dòng thời
  gian** (các phiên của một khách theo thứ tự thời gian) / **dự án** (hội thoại của các bên
  liên quan cùng một vụ việc). Có thể tạo nhóm mới hoặc thêm vào nhóm sẵn có.
- **Phòng nhóm** (vào từ tab *Nhóm* của hàng chờ): toàn bộ phiên thành viên gộp thành một
  dòng thời gian. Gửi tin là **1:1** — phải chọn **người nhận** trước. Trong cài đặt nhóm
  có thể gỡ thành viên hoặc **giải tán nhóm**; giải tán vẫn giữ nguyên mọi hội thoại và
  tin nhắn.
- **Báo cáo hành trình khách hàng** (bảng bên phải khi chọn nhóm): **[Tạo báo cáo]** (toàn
  bộ / khoảng thời gian) → ① Tóm tắt ② Lịch sử tiếp xúc ③ Họ hỏi gì ④ Thời gian giải quyết
  ⑤ Hành trình (5A) ⑥ Nhu cầu (giả thuyết) ⑦ Hành động tiếp theo. **Số liệu do mã nguồn
  đếm; AI chỉ viết phần diễn giải** — nhóm lớn mất vài chục giây, có thể rời màn hình.
  Chọn 2 báo cáo cũ để **phân tích so sánh** (có cảnh báo khi khác phiên bản tiêu chí).
- **Tiêu chí viết báo cáo** (bật/tắt từng mục·số câu hỏi hàng đầu·trần mẫu·độ dài trích
  dẫn·cụm từ cấm) quản lý tại *Tiêu chí báo cáo hành trình* trong [Cài đặt gian hàng →
  Cài đặt khác] (chỉ master). Lưu sẽ tạo phiên bản mới; báo cáo cũ giữ phiên bản lúc viết.

---

## 5. Bảng yêu cầu
*(`/issues` · chỉ tenant có chế độ quy trình **native** — nếu không, chỉ hiển thị thông báo)*

Là **bảng kanban** quản lý yêu cầu dưới dạng ticket (issue).

- Cột: `Đã tiếp nhận → Đang xử lý → Đã giải quyết / Đã từ chối → Đã đóng` (chỉ kéo được các
  bước di chuyển hợp lệ — di chuyển sai sẽ bật về. Môi trường cảm ứng dùng hộp chọn di
  chuyển trên thẻ).
- KPI trên cùng: tiếp nhận·đang xử lý·**chưa phân công**·thời gian giải quyết trung
  bình·tỷ lệ mở lại (làm mới 30 giây).
- Thẻ: số yêu cầu·loại·**huy hiệu SLA (⚠️ sắp trễ / 🔥 quá hạn)**·số lần mở lại·bí danh
  phiên·câu cuối của khách·người phụ trách (huy hiệu nhãn+tên hoặc chưa phân công)·**công
  tắc khẩn cấp/thường**.
- **Từ chối** bắt buộc lý do (không thể theo chính sách/phân công sai/spam + ghi chú). Sau
  giải quyết/từ chối có thể mở lại.
- Bấm thẻ → xem trước 10 lượt hội thoại gần nhất (chỉ đọc, việc xem được ghi vào kiểm tra)
  → [Mở phiên] để vào live chat.
- Thao tác **[Ghi nhận tin nhắn này thành sự cố]** trong live chat (§4.2) cũng tạo issue.
- Giờ chuẩn SLA đặt tại tab [Cài đặt gian hàng → Chuyển nhân viên] (thường/khẩn cấp, 1~168 giờ, mặc định 24h/4h).
- Chế độ quy trình (native hay không) là cài đặt **Gói/Add-on** của quản trị viên nền tảng
  (§16) — nếu chỉ được cấp menu mà chưa bật chế độ thì chỉ hiển thị màn hình thông báo.

---

## 6. Lịch sử hội thoại
*(`/history`)*

- Bộ lọc: khoảng thời gian · người phụ trách (có nhãn consult) · trạng thái · có
  escalation hay không · **tìm trong nội dung tin nhắn** (chạy bằng nút tìm — việc tra cứu
  thuộc diện ghi kiểm tra) · bao gồm hội thoại xem thử hay không.
- Bấm hàng → hộp thoại toàn văn hội thoại: khách/người phụ trách/kênh/**ngôn ngữ**/meta bắt
  đầu·kết thúc + bong bóng theo từng phát ngôn. **Mỗi câu trả lời AI hiển thị chip tài liệu
  căn cứ (tiêu đề+độ tương đồng, bấm để đến tài liệu tri thức) và huy hiệu độ tin cậy**,
  nên truy được vì sao trả lời như vậy. Tại thời điểm chuyển tiếp có huy hiệu lý do.
- Việc tra cứu được ghi vào kiểm tra (thông báo ở cuối hộp thoại). Xuất dữ liệu (CSV v.v.) 🟡 chưa có.

---

## 7. Nhật ký công việc
*(`/work-log`)*

Truy vết kiểm tra thao tác của nhân viên tư vấn (lăng kính nhân viên của cùng kho lưu với
nhật ký kiểm tra của quản trị viên).
Bộ lọc: khoảng thời gian·nhân viên tư vấn·hành động (nhận/gửi tin nhắn/liên kết khách/tạo
khách/kết thúc/xem hội thoại/xem toàn văn).
Cột: thời gian·nhân viên tư vấn·hành động·đối tượng·kết quả (thành công/thất bại).

---

## 8. Thống kê
*(`/statistics` · bộ lọc thời gian dùng chung, mặc định 30 ngày gần nhất)*

6 mục cấp cao — **Phân tích câu hỏi / Kênh / Nhân viên / Kết quả / Mức độ hài lòng /
Khung giờ**.

- **Phân tích câu hỏi**: 4 tab con (**ý định / tri thức đã dùng / từ khóa / nhóm câu hỏi
  tương tự**). Biểu đồ xu hướng + bảng (số lượng·tỷ trọng·**tỷ lệ chuyển tiếp**·**không có
  nguồn**·**độ tin cậy trung bình**). Hàng có dấu ⚠ là hàng chuyển tiếp cao hoặc tin cậy
  thấp — **danh sách ưu tiên bổ sung tri thức** (ở *tri thức đã dùng*, bấm hàng để đến tài
  liệu). Dựa trên ảnh chụp theo ngày nên số liệu vẫn còn khi log hội thoại bị xóa; nếu
  tổng hợp ngưng quá 2 ngày sẽ có biểu ngữ cảnh báo.
- **Kênh**: theo từng kênh — số hội thoại·tin nhắn của khách·**tin nhắn mỗi hội thoại
  (trung vị)**·chuyển nhân viên. Hãy xem trung vị trước — một hội thoại hàng trăm lượt sẽ
  kéo lệch hẳn giá trị trung bình.
- **Nhân viên**: bảng **AI agent** và bảng **nhân viên tư vấn**. Hội thoại·câu trả lời đã
  gửi·đã giải quyết·mức hài lòng (hiển thị kèm số lượt đánh giá — mẫu mỏng thì diễn giải
  thận trọng).
- **Kết quả**: cách các hội thoại đã kết thúc. Giải quyết (khách đánh giá / nhân viên đóng
  / đóng sau xác nhận) vs chưa giải quyết (đang diễn ra / kết thúc không thao tác đóng /
  **khách nói câu cuối**). **Cùng định nghĩa** với báo cáo hành trình và Tổng quan — hội
  thoại mà khách nói câu cuối tức là còn câu hỏi, không tính là giải quyết.
- **Mức độ hài lòng**: điểm trung bình·số phản hồi·tỷ lệ phản hồi·phân bố 1~5 + bảng
  **theo nhân viên / theo phiên** (bộ lọc điểm·nhân viên).
- **Khung giờ**: lưới thứ×giờ (tin nhắn của khách) — tính theo **múi giờ của tenant**, có
  cảnh báo dùng UTC khi tenant chưa đặt múi giờ.

Các mục Kênh·Nhân viên·Kết quả·Khung giờ tính trực tiếp từ log hội thoại nên **không tra
được quá hạn lưu trữ** (Phân tích câu hỏi·Mức độ hài lòng là ảnh chụp nên còn nguyên).

---

## 9. Tổng quan
*(`/dashboard`)*

- 6 KPI (mỗi cái liên kết đến màn hình tương ứng): tư vấn đang diễn ra · thông báo hôm nay
  · tỷ lệ AI tự giải quyết · Top N chưa giải quyết · tổng hội thoại · tổng đơn hàng.
- **Tỷ lệ AI tự giải quyết** = phần các hội thoại đã kết thúc mà câu hỏi của khách không
  còn treo lại — cùng định nghĩa với mục *Kết quả* của Thống kê và báo cáo hành trình. Số
  hội thoại chỉ đếm hội thoại khách thật, **loại trừ phiên xem thử của Cài đặt AI**.
- Xếp hạng **câu hỏi phổ biến**, **trạng thái tích hợp** (huy hiệu theo nhà cung cấp —
  Shopify·Cafe24·Odoo·Haravan·Klaviyo·Yotpo·Notion·Google Drive v.v.; "đã kết nối" nghĩa
  là **đã qua kiểm tra kết nối**, không phải chỉ lưu thông tin, §14), **5 đơn hàng gần nhất**.

---

## 10. Khách hàng·đơn hàng·sản phẩm

### 10.1 Khách hàng (`/customers`)
Danh sách (tên·email·**hạng**·số đơn·tổng chi tiêu·ngày tham gia) + tìm theo email. Thứ duy
nhất sửa được là **đổi hạng** (guest/subscriber/regular). Hạng được dùng để phân loại khách
trong widget·tiếp khách bằng AI.

### 10.2 Đơn hàng (`/orders`)
Danh sách chỉ đọc các đơn hàng đồng bộ từ nền tảng (mã đơn·trạng thái·số tiền·số sản phẩm·ngày).

### 10.3 Sản phẩm (`/products`)
Tra cứu catalog sản phẩm đã đồng bộ (gồm cả sản phẩm lưu trữ).
- KPI: tổng·đang bán·lưu trữ·**số đã vào kho tri thức** (kèm thời điểm đồng bộ cuối).
- Huy hiệu **đã vào kho tri thức hay chưa** trong danh sách rất quan trọng — sản phẩm
  `chưa có` là sản phẩm **AI không thể dùng trong câu trả lời.** Kiểm tra mô tả·tag·SKU
  trong hộp thoại chi tiết. Sản phẩm hoàn toàn không có mô tả sẽ không được chuyển thành
  tri thức (ghi rõ trong chi tiết).
- Quy trình đưa vào tri thức (đồng bộ danh mục sản phẩm): [Sổ tay tri thức·AI chương 2.2](knowledge-ai.vi.md).

---

## 11. Chiến dịch
*(`/campaigns` · operations)*

- Trường khi tạo: tên · **kênh (email / sms / kakao)** · tin nhắn · **liên kết** (không /
  handle sản phẩm / URL https — tính hợp lệ kiểm tra tại thời điểm gửi).
- Bấm **[Gửi]** trong danh sách sẽ **gửi ngay lập tức (không có hộp xác nhận)** — hãy cẩn thận.
- 🟡 Gửi theo lịch·giao diện xây dựng đối tượng nằm trong lộ trình. Hiện tại là luồng tạo → gửi ngay.

---

## 12. Đánh giá
*(`/reviews`)*

Danh sách quản lý đánh giá sản phẩm khách để lại qua widget (khách·mục đơn hàng·số
sao·nội dung·trạng thái).
Hành động duy nhất là **ẩn ↔ bỏ ẩn** — ẩn rồi thì **chính người viết vẫn tiếp tục nhìn
thấy** (chỉ loại khỏi hiển thị trên cửa hàng).

---

## 13. Tri thức·cài đặt AI

Toàn bộ: đăng ký tri thức (thủ công/catalog/CSV/nguồn ngoài), kiểm chứng (bảng QA·rà soát
mâu thuẫn·đề xuất khoảng trống), cài đặt AI (agent·persona·quy tắc·kịch bản·công cụ·kiểm
duyệt·tái sử dụng câu trả lời), vòng lặp cải thiện (xem thử·huấn luyện·kiểm tra hồi quy)
được tổng hợp trong **[Sổ tay đăng ký tri thức·cài đặt AI](knowledge-ai.vi.md)**. Giải
thích chuyên sâu theo màn hình xem AI-SETTINGS-GUIDE.

Tóm tắt điểm cốt lõi:
- AI **chỉ trả lời từ các tài liệu tri thức đang bật**. Chuyển tiếp thường xuyên nghĩa là
  thiếu tri thức.
- Con đường chuẩn của tri thức: soạn và duyệt trên **Smart Knowledge Board**
  (`/knowledge/board`) trước, rồi **chấp nhận** vào KB (có mô phỏng trước khi chấp nhận).
  Thêm tài liệu trực tiếp chỉ dành cho sửa khẩn cấp.
- Tri thức chia theo 3 nhóm (CounselInfo / ProductInfo / OperationInfo) × danh mục; **phạm
  vi agent** của danh mục có thể giới hạn tri thức cho từng AI agent cụ thể.
- Công cụ hàng loạt: **tải xuống ↔ đăng ký hàng loạt** (vòng khứ hồi CSV/XLSX), **AI
  import** (pdf·docx·xlsx·csv·md·phụ đề YouTube → duyệt bản nháp → đăng lên bảng).
- Mọi tin nhắn gửi đi (AI·nhân viên tư vấn) đều qua kiểm duyệt. Khi lỗi sẽ **chặn** một
  cách an toàn.
- Huấn luyện AI·thay đổi cấu hình đi qua **cổng phê duyệt** — hãy xem xét đề xuất rồi mới
  áp dụng.

## 14. Cài đặt gian hàng

`/settings` gồm **8 tab** (trước đây là một màn "Cài đặt" duy nhất → 2026-08-24 thành 7 tab →
2026-10-24 tách riêng tab *Chuyển nhân viên*). Tab cũng là đơn vị cấp menu — tab mà quản trị
viên nền tảng không cấp sẽ không hiển thị (tab *Chuyển nhân viên* cùng đơn vị cấp với *Cài đặt cơ bản*).

| Tab | Nội dung |
|---|---|
| Cài đặt cơ bản | **Công cụ AI** (đăng ký công cụ riêng của tenant — ưu tiên hơn công cụ nền tảng; kiểm tra kết nối·đặt mặc định; gọi bằng khóa của bạn thì tính phí vào tài khoản của bạn) · **Mức dùng AI** (số lần gọi/token theo kỳ và trục, cảnh báo rơi về stub — không ước tính tiền) · Cửa hàng (storefront) · **Tùy chọn tri thức** (có hiển thị thẻ "hướng dẫn sử dụng" trên trang Kiến thức hay không — dành cho tenant kiểu cửa hàng, mặc định tắt) |
| Chuyển nhân viên | Nhân viên tư vấn phụ trách · **Quy tắc phân công** (danh mục tư vấn × nghiệp vụ × thông tin khách hàng → nhóm nhân viên tư vấn, **Kiểm tra phân công**·cảnh báo, **Quản lý danh mục tư vấn**) · nhắc lại khi chưa tiếp nhận · giờ làm việc·giờ nghỉ · email/nội dung ngoài giờ · SLA · chuyển tiếp bắt buộc theo chính sách (§14.1) |
| Cài đặt widget | Chủ đề widget (màu thương hiệu·header·logo·vị trí nút mở) · **Widget tùy chỉnh** (tạo nhiều thiết kế có tên — phông chữ, cỡ chữ, bo góc, kích thước bảng, biểu tượng nút mở — lưu tại đây và áp dụng một cái bằng **[Dùng]**: có hiệu lực ngay, không cần triển khai; **[Về widget cơ bản]**, liên kết xem trước, nhân bản, **xuất/nhập gói** JSON, **Lịch sử** (mỗi lần lưu giữ lại trạng thái trước để khôi phục), lưu trữ·xóa. Ô CSS đã lọc chỉ hiện với tenant được quản trị viên nền tảng bật tiện ích) · **Tệp thiết kế** (phông woff2/ttf/otf·biểu tượng·hình ảnh·tài liệu thiết kế tải lên thư mục riêng của tenant — giữ nguyên qua các lần triển khai, hiển thị dung lượng theo khu vực) · bố cục tab · hành vi (tên hiển thị·lời chào — **6 tab ngôn ngữ**, kèm nội dung mặc định) · Nhúng/SDK · hướng dẫn cài lên cửa hàng — chi tiết: [Sổ tay tạo widget tùy chỉnh](custom-widget.vi.md) |
| Tích hợp nền tảng | Các ô Shopify · Cafe24 · WooCommerce · Odoo · Haravan + nút **[Hướng dẫn tích hợp]** góc phải trên (tìm từng thông tin xác thực ở đâu) |
| Marketing & Helpdesk | Klaviyo · Yotpo · Gorgias |
| Kênh nhắn tin | Telegram · Viber · trung tâm AmoebaTalk · btbz messenger relay · Gmail (Zalo·LINE·WhatsApp sắp hỗ trợ) |
| Cài đặt khác | Kênh thông báo · quyền truy cập menu (master) · tiêu chí báo cáo hành trình (master, §4.5) · thông tin xác thực đã lưu · **Ảnh chụp cài đặt** (12 trường cài đặt — chủ đề widget·nội dung·tab·thông báo v.v. — cùng thư viện widget tùy chỉnh lưu thành một tệp JSON; so sánh rồi khôi phục, tải về, xóa; không bao giờ chứa thông tin xác thực hay bí mật) |
| Thông báo quyền riêng tư | URL chính sách · phiên bản thông báo đồng ý (§15) |

- **Đã lưu ≠ đã kết nối**: lưu thông tin xác thực thì trạng thái là "chưa kiểm tra". Chỉ
  khi **[Kiểm tra kết nối]** đạt mới thành "đã kết nối" ("lỗi" nếu thất bại) — huy hiệu
  tích hợp trên Tổng quan cũng theo trạng thái này.
- Odoo·WooCommerce·Haravan lấy dữ liệu bằng **[Nhập sản phẩm] / [Đồng bộ đơn hàng]** trong
  hộp cấu hình (Cafe24 có thẻ OAuth riêng; Shopify có [Đồng bộ ngay]+[Đăng ký webhook]).
  Để AI dùng được sản phẩm đã nhập, cần thêm bước đồng bộ catalog trong [Kho tri thức]
  (§10.3).
- Quy tắc **chuyển tiếp bắt buộc theo chính sách (deny-list)** có 2 chế độ hiển thị với
  khách: **Không trả lời** (chuyển thẳng, không qua AI — mặc định) / **Trả lời rồi
  chuyển** (trả lời từ tri thức trước rồi vẫn chuyển) — kiểu nào nhân viên cũng được gọi.
### 14.1 Chuyển nhân viên — Danh mục tư vấn và quy tắc phân công

**Danh mục tư vấn** là chủ đề tư vấn mà khách chọn trên widget (ví dụ: đặt phòng·thanh toán·
đăng ký phòng). Quản lý tại **[Quản lý danh mục tư vấn]** ở đầu phần quy tắc phân công.
- Thêm bằng mã (chữ Latin·số·_) và tên. **Mã không thể đổi sau khi tạo**; tên·thứ tự có thể
  đổi bất cứ lúc nào.
- **Hiển thị/Ẩn**: chỉ danh mục ở trạng thái Hiển thị mới xuất hiện trên thẻ widget (tạo mới
  thì mặc định là Hiển thị).
- **Tên theo ngôn ngữ** (bấm ▸ để mở): nếu có tên theo ngôn ngữ của khách thì hiển thị tên đó,
  không có thì hiển thị tên mặc định.
- Danh mục tư vấn đang được quy tắc·nhóm·nhãn sử dụng thì không xóa được, và hệ thống cho biết
  nó đang được dùng ở đâu.
- Dấu 👁 trên chip quy tắc nghĩa là danh mục tư vấn đó đang hiển thị cho khách.

**Quy tắc phân công** được kiểm tra từ trên xuống; hội thoại được kết nối tới **nhóm nhân
viên tư vấn (nhóm × nhãn)** và nhân viên chỉ định riêng của **quy tắc đầu tiên khớp cả danh
mục tư vấn · nghiệp vụ · thông tin khách hàng**. Nếu không có quy tắc nào khớp thì báo cho
nhân viên tư vấn phụ trách; nếu cũng không có nhân viên phụ trách thì báo cho tất cả.
- Dòng **Danh mục tư vấn**: chỉ so với giá trị khách đã chọn. Với khách không chọn thì chỉ
  các quy tắc để trống danh mục tư vấn mới khớp.
- Dòng **Nghiệp vụ**: xét từ khóa câu hỏi và nhãn do quy tắc *chuyển tiếp bắt buộc theo
  chính sách (deny)* gắn vào. Chip nhãn ở dòng nghiệp vụ chỉ khớp với hội thoại đến từ quy
  tắc chính sách, vì vậy nhãn nhóm nhân viên tư vấn hãy chọn ở *Người phụ trách* bên dưới.
- Dòng **Thông tin khách hàng**: Khu vực (Miền Bắc·Bắc Trung Bộ·Miền Trung·Nam Trung Bộ·Miền
  Nam — khu vực khách sạn do ứng dụng chủ ký và gửi), tỉnh/thành, ngôn ngữ, mức xác thực,
  hạng·loại khách hàng, khách sạn, vai trò, đường truy cập.
- Ví dụ: *Thanh toán · Miền Nam* = danh mục tư vấn Thanh toán + Khu vực Miền Nam·Nam Trung Bộ
  → nhóm South × nhãn kế toán.
- Khi khách chọn danh mục tư vấn, hội thoại theo quy tắc của danh mục đó thay vì ưu tiên kết
  nối nhân viên tư vấn trước đó.

**Kiểm tra phân công**: nhập danh mục tư vấn·khu vực·tỉnh/thành·ngôn ngữ vào ô phía trên các
quy tắc rồi bấm [Kiểm tra] — hệ thống dùng **các quy tắc đang chỉnh sửa, trước khi lưu** để cho
biết hội thoại sẽ đến ai, cùng lý do các quy tắc bị bỏ qua (không khớp danh mục tư vấn·không
khớp điều kiện khu vực·0 người có thể phân công…). Không gửi cảnh báo nào.

**Cảnh báo** (không chặn việc lưu): ① dùng sai nhãn ở dòng nghiệp vụ ② tên có địa danh nhưng
không có điều kiện khu vực·tỉnh/thành ③ hiện có 0 nhân viên tư vấn có thể phân công (hiển thị
số người chưa chấp nhận lời mời). Người dùng chưa chấp nhận lời mời sẽ không được phân công.

→ Hướng dẫn từng màn hình (nhóm & nhãn → danh mục tư vấn → quy tắc phân công → yêu cầu của khách → cảnh báo): [Hướng dẫn phân công nhân viên](agent-assignment.vi.md)

→ [Sổ tay thiết lập nhanh chương 3~4](quick-setup.vi.md) ·
hướng dẫn cài đặt widget

---

## 15. Thông báo quyền riêng tư·Trang của tôi

- **Thông báo quyền riêng tư** (một tab của [Cài đặt gian hàng], `/settings/privacy` — địa
  chỉ cũ `/privacy-notice` tự chuyển hướng; master/director): quản lý URL chính sách xử lý
  và **phiên bản thông báo đồng ý**. ⚠️ **Nâng phiên bản sẽ hiển thị lại biểu ngữ đồng ý
  cho tất cả khách hàng**, nên chỉ nâng khi thực sự thay đổi nội dung thông báo.
- **Trang của tôi** (`/my-page`): hồ sơ (cấp bậc·nhãn·workspace), đổi mật khẩu, đăng ký/gỡ MFA.

---

## 16. Bảng điều khiển quản trị viên nền tảng
*(`/admin/*` · quản trị viên hệ thống)*

| Màn hình | Đường dẫn | Công dụng |
|---|---|---|
| Tổng quan | `/admin` | Số tenant·trạng thái tích hợp |
| Gian hàng | `/admin/tenants` | Tạo (tên·slug·tên miền·gói) · **Gói/Add-on** · **menu được cung cấp** · tạm ngưng/kích hoạt |
| Người dùng của tenant | `/admin/tenants/…/users` | Mời · **cấp mật khẩu tạm thời (hiển thị 1 lần·không gửi mail)** · đặt lại MFA · tạm ngưng |
| Công cụ AI | `/admin/ai-engines` | Đăng ký công cụ (nhà cung cấp·mô hình·khóa API)·quản lý kích hoạt — tenant chọn theo từng chức năng |
| Nhật ký kiểm tra | `/admin/audit` | Truy vết thao tác đặc quyền (cấp mật khẩu tạm·đổi quyền·xem PII v.v.) |

- Hộp thoại **Gói/Add-on**: gói (`starter`/`growth`/`enterprise`/`custom` — mỗi gói có bộ
  menu mặc định; đổi gói vẫn giữ các ghi đè theo từng menu) + **add-on quy trình issue**
  (`base` không dùng / `bridge` nối helpdesk ngoài / `native` bật bảng issue·kanban).
  Trong danh sách, chế độ khác base hiển thị huy hiệu "Issues: {chế độ}" ở cột gói.
  Chỉ tenant được bật ô **Cho phép CSS widget tùy chỉnh** mới thêm được CSS đã lọc vào widget
  tùy chỉnh (chỉ các lớp ổn định `.st-*` và thuộc tính màu/phông/khoảng cách). Cột **Tệp**
  trong danh sách tenant là dung lượng thư mục của tenant (tệp thiết kế·ảnh chụp).

Chi tiết quy trình mở tenant: [Sổ tay thiết lập nhanh chương 1](quick-setup.vi.md).

---

## 17. FAQ / Xử lý sự cố

**Q. Bot cứ chuyển sang nhân viên tư vấn.**
Thiếu tri thức là nguyên nhân phổ biến nhất. Xác định nguyên nhân bằng các hàng ⚠ trong
Thống kê (`/statistics`) và bảng QA tri thức, rồi bổ sung tài liệu. Cũng kiểm tra xem từ
khóa đó có nằm trong deny-list (chuyển tiếp bắt buộc theo chính sách) không — quy tắc
"Không trả lời" bỏ qua AI một cách có chủ đích, còn quy tắc "Trả lời rồi chuyển" thì dù
đã trả lời vẫn gọi nhân viên. Danh mục của tài liệu cũng có thể mang **phạm vi agent**
khiến agent hiện tại không thấy tri thức đó.

**Q. Câu trả lời của nhân viên tư vấn không gửi được.**
Là kiểm duyệt chặn. Đổi cách diễn đạt rồi thử lại; nếu quy tắc quá gắt, đề nghị master điều chỉnh.

**Q. Hội thoại tự nhiên kết thúc.**
Là tự động kết thúc hội thoại bị bỏ quên (30 phút im lặng → nhắc → kết thúc, §4.4). Khách
gửi tin nhắn lại sẽ bắt đầu phiên tư vấn mới.

**Q. Không thấy bảng yêu cầu.**
Chỉ dành cho tenant có chế độ quy trình native — kiểm tra cài đặt **Gói/Add-on** của quản
trị viên nền tảng có phải `native` không. Nếu menu hoàn toàn không có, hãy kiểm tra menu
được cung cấp/quyền theo cấp bậc (2 tầng).

**Q. Màn hình cài đặt trông khác với mô tả cũ.**
`/settings` gồm **8 tab** (Cài đặt gian hàng, §14). Từ 2026-10-24, chuyển tiếp tư vấn
(handoff) nằm ở tab riêng **Chuyển nhân viên**, quyền truy cập menu ở tab *Cài đặt khác*.

**Q. Khách đã gọi nhân viên tư vấn mà không thấy thẻ danh mục tư vấn.**
Kiểm tra trong [Chuyển nhân viên → Quản lý danh mục tư vấn] xem có danh mục tư vấn nào ở
trạng thái **Hiển thị** không. Nếu không có danh mục nào Hiển thị thì kết nối ngay, không hiện thẻ.

**Q. Đã tạo quy tắc nhưng hội thoại không được phân công cho nhóm đã chỉ định.**
Nhập cùng điều kiện vào **Kiểm tra phân công** phía trên các quy tắc — lý do bị bỏ qua sẽ hiện
ra. Nguyên nhân thường gặp: dùng chip nhãn ở dòng nghiệp vụ, thiếu điều kiện khu vực, thành
viên nhóm chưa chấp nhận lời mời (0 người có thể phân công).

**Q. Số liệu Tổng quan/Thống kê giảm so với trước.**
Có thể là bình thường — số hội thoại nay **loại trừ phiên xem thử của Cài đặt AI**, và với
định nghĩa "giải quyết" đã thống nhất, hội thoại mà khách nói câu cuối không còn được tính
là giải quyết (§8·§9).

**Q. Đã đổi cài đặt widget mà không thấy phản ánh.**
Widget đọc cấu hình mới từ **phiên tiếp theo của khách hàng**. Hãy đóng-mở lại widget hoặc
làm mới trang.

**Q. Khách không nhận được thông báo (email v.v.).**
Kiểm tra theo thứ tự: ① kênh đó có đang bật trong chính sách kênh thông báo của bảng điều
khiển không ② khách có từ chối nhận marketing không (chỉ ảnh hưởng loại khuyến mãi). Kênh
mà cửa hàng đã tắt thì khách không thể tự bật.

**Q. Đã đổi temperature mà câu trả lời vẫn vậy.**
Công cụ Anthropic (Claude) không áp dụng temperature (mô hình từ chối nên không gửi). Chỉ
max_tokens có hiệu lực.

**Q. Không có khóa AI mà vẫn hoạt động.**
Đó là câu trả lời demo của bộ chuyển đổi stub. Trước khi vận hành thật nhất định phải đăng
ký·chỉ định công cụ thật.

**Q. Đã ẩn đánh giá mà khách vẫn thấy.**
Bình thường — ẩn chỉ loại khỏi hiển thị trên cửa hàng, còn với chính người viết thì vẫn giữ.

---

*Tài liệu liên quan: [Sổ tay thiết lập nhanh](quick-setup.vi.md) ·
[Sổ tay đăng ký tri thức·cài đặt AI](knowledge-ai.vi.md) ·
hướng dẫn cài đặt widget · AI-SETTINGS-GUIDE ·
hướng dẫn tích hợp ứng dụng di động (WebView·Android SDK) ·
tài liệu giới thiệu dịch vụ · SPEC.md*
