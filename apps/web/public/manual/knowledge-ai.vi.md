# Sổ tay đăng ký tri thức·cài đặt AI SharpTalk — Pipeline tri thức và vận hành tiếp khách

> Phiên bản 1.2 · Bản đầu 2026-08-24 · **cập nhật 2026-10-24** · Biên soạn dựa trên mã nguồn
> Đối tượng: người vận hành tenant · phụ trách CS (khuyến nghị master/director — Cài đặt AI chỉ dành cho cấp bậc cao)
> Bản trực tuyến: https://shoptalk.amoeba.site/manual (có bản HTML và bản dịch EN·VI)
> Ký hiệu: ✅ đã triển khai / 🟡 đang chuẩn bị·lộ trình. Tài liệu tiên quyết: [Sổ tay thiết lập nhanh](quick-setup.vi.md)

> ⚠ Bản dịch AI, đang chờ hiệu đính bởi người bản ngữ. Bản tiếng Hàn là bản chuẩn.

Mỗi chương được sắp xếp theo thứ tự **giải thích thuật ngữ → quy trình → 💡 mẹo vận hành**.

---

## Mục lục
0. [Hiểu pipeline trả lời của AI](#0-hiểu-pipeline-trả-lời-của-ai)
1. [Hiểu cấu trúc tri thức](#1-hiểu-cấu-trúc-tri-thức)
2. [Đăng ký tri thức](#2-đăng-ký-tri-thức)
3. [Kiểm chứng·quản lý chất lượng tri thức](#3-kiểm-chứngquản-lý-chất-lượng-tri-thức)
4. [Cài đặt AI](#4-cài-đặt-ai)
5. [Cài đặt tiếp khách live chat](#5-cài-đặt-tiếp-khách-live-chat)
6. [Vòng lặp kiểm chứng·cải thiện](#6-vòng-lặp-kiểm-chứngcải-thiện)
7. [Danh sách kiểm tra vận hành](#7-danh-sách-kiểm-tra-vận-hành)
8. [FAQ / Xử lý sự cố](#8-faq--xử-lý-sự-cố)

---

## 0. Hiểu pipeline trả lời của AI

Đây là toàn bộ luồng xử lý một tin nhắn của khách hàng. Mọi cài đặt trong tài liệu này đều
là việc điều chỉnh một điểm nào đó trong luồng này.

```
Tin nhắn của khách hàng
  │
  ▼
① Phân loại ý định ──── nếu cần đơn hàng·thông tin cá nhân → hướng dẫn xác minh danh tính (đăng nhập)
  │               khớp deny-list: quy tắc "Không trả lời" → chuyển ngay /
  │               quy tắc "Trả lời rồi chuyển" → trả lời qua ②~④ rồi mới chuyển
  ▼
② Tìm kiếm tri thức (RAG) ── tìm căn cứ liên quan trong các tài liệu tri thức đã đăng ký
  │
  ▼
③ Tạo câu trả lời ──── soạn câu trả lời từ persona·quy tắc trả lời + căn cứ tìm được, tính độ tin cậy
  │
  ▼
④ Kiểm duyệt ─── kiểm tra quy tắc cấm (không đạt thì không hiển thị cho khách)
  │
  ▼
⑤ Rẽ nhánh: độ tin cậy đủ → trả lời khách hàng (+nguồn)
        độ tin cậy thấp / bị chặn / khách yêu cầu gặp người → hàng chờ nhân viên tư vấn (escalation)
```

- **Ngôn ngữ trả lời** theo ngôn ngữ phiên của khách hàng (en/es/ko/vi/ja/zh).
- Tin nhắn do nhân viên tư vấn gửi cũng đi qua ④ kiểm duyệt y hệt (không thể bỏ qua).

---

## 1. Hiểu cấu trúc tri thức

**Thuật ngữ**

| Thuật ngữ | Ý nghĩa |
|---|---|
| Tài liệu tri thức (document) | Một bài viết AI dùng làm căn cứ trả lời. Gồm tiêu đề·danh mục·nội dung |
| **Bảng tri thức (board)** | **Lớp biên tập nơi mọi tri thức được viết·duyệt trước** (`/knowledge/board`). Tài liệu đã đăng trở thành căn cứ trả lời sau khi được "đưa vào KB" |
| Đưa vào KB | Nâng tài liệu trên bảng thành tài liệu kho tri thức (KB). Đưa vào lại sẽ cập nhật cùng một tài liệu (không tạo bản sao) |
| Embedding | Thao tác lập chỉ mục chuyển tài liệu thành vector tìm kiếm được. Tự động thực hiện khi đăng ký·sửa |
| RAG | Cách tìm tài liệu liên quan đến câu hỏi và chỉ tạo câu trả lời từ căn cứ đó |
| Nguồn (source) | Kết nối tự động lấy tài liệu từ bên ngoài (bảng tin·Google Drive·Notion) |
| Nhóm | 3 phân loại lớn của tài liệu: **CounselInfo** (tư vấn — chính sách·FAQ) / **ProductInfo** (sản phẩm — từ catalog) / **OperationInfo** (cẩm nang vận hành) |
| Danh mục | Phân loại chi tiết dưới nhóm. Quản lý **theo cặp (nhóm, tên)**; phạm vi agent (§3.5) cũng gắn vào danh mục |
| Đang bật/hiển thị (active) | Có nằm trong phạm vi tìm kiếm hay không. **Tài liệu tắt không được dùng làm căn cứ trả lời** |
| Độ tin cậy (confidence) | Chỉ số câu trả lời được căn cứ hỗ trợ đến đâu. Thấp thì chuyển tiếp nhân viên tư vấn |

Bố cục màn hình Kho tri thức (`/knowledge`): trên cùng là banner bảng tri thức và **Đề
xuất bổ sung tri thức**; bên trái quản lý nguồn·hướng dẫn sử dụng·danh mục·tài liệu; bên
phải cố định **bảng QA (trả lời bằng tri thức)** và **Rà soát mâu thuẫn**, nên có thể qua
lại giữa đăng ký↔kiểm chứng trong cùng một màn hình. **Các tab nhóm** phía trên danh sách
tài liệu (Tất cả / CounselInfo / ProductInfo / OperationInfo) quyết định đối tượng thao
tác của tài liệu·danh mục·công cụ hàng loạt.

---

## 2. Đăng ký tri thức

### 2.0 Con đường chuẩn — Smart Knowledge Board (khuyến nghị)

Con đường chuẩn là viết·duyệt mọi tri thức trên bảng trước, rồi đưa vào KB. Trên thẻ tài
liệu, **[Viết trên bảng]** là nút chính; [Thêm tài liệu KB] (thêm trực tiếp) chỉ dành cho
**trường hợp khẩn**.

**Quy trình**: banner **[Mở bảng]** đầu trang `/knowledge` hoặc **[Viết trên bảng]** trên
thẻ tài liệu →
1. Viết: `nhóm` (CounselInfo/ProductInfo/OperationInfo) / `Phân loại cấp 1·cấp 2` /
   `Nhóm (phụ trách)` / `tiêu đề` / `thẻ` / nội dung markdown + tệp đính kèm (tối đa
   50MB/tệp, có [Chèn vào nội dung]). Viết `[[Tiêu đề tài liệu]]` trong nội dung để liên
   kết tài liệu bảng khác (xem backlink ở bảng *Liên kết* bên phải — liên kết **theo tiêu
   đề**, đổi tên sẽ hiển thị liên kết cũ là "chưa viết").
2. **[Lưu nháp]** (Bản nháp) → **[Đăng]** (Đã đăng) — tài liệu chưa đăng thì không thể
   đưa vào KB.
3. **[Mô phỏng]**: nhập câu hỏi của khách để kiểm tra trước khi đưa vào KB xem tài liệu
   này có được trích dẫn không, cùng độ tin cậy·độ tương đồng. **Golden-set A/B** chạy các
   câu hỏi kiểm chứng đã đăng ký (§6.3) hai lần — không có và có tài liệu — để cho thấy
   mức cải thiện (mỗi câu hỏi gọi LLM 2 lần — xác nhận rồi mới chạy).
4. **[Đưa vào KB]**: người duyệt chọn danh mục (nếu bỏ trống thì dùng phân loại cấp 2 rồi
   cấp 1) và tài liệu KB được tạo. **Đưa vào lại sẽ cập nhật cùng một tài liệu KB** và tự
   động embedding lại. Sau khi sửa bản gốc trên bảng, huy hiệu **"chưa cập nhật bản sửa"**
   hiển thị cho đến khi đưa vào lại.
5. Cộng tác: **bình luận** bên phải (gõ `@` để nhắc đồng nghiệp — các lần nhắc dồn vào hộp
   `@tôi` trên danh sách bảng), và **[Tạm hoãn]/[Đưa vào lại]/[Về trạng thái đã đăng]** để
   chuyển trạng thái qua lại.

**Di trú FAQ hàng loạt**: **[Nhập FAQ]** trên danh sách bảng — xuất bảng FAQ/Hỏi đáp hiện
có ra CSV/XLSX rồi tải lên; mỗi dòng trở thành một tài liệu bảng ở trạng thái đã đăng (cột
bắt buộc title·content, tùy chọn category1·category2·tags; tiêu đề trùng bị bỏ qua).

💡 **Mẹo**
- Sửa tài liệu KB đã đưa vào ngay phía KB sẽ làm nó **lệch** khỏi bản gốc trên bảng — chi
  tiết tài liệu hiển thị cảnh báo và [Mở bản gốc trên bảng]. Hãy sửa trên bảng rồi đưa vào
  lại.
- Nếu mô phỏng báo "không được trích dẫn", hãy bổ sung tiêu đề·nội dung bằng từ ngữ của
  khách rồi mô phỏng lại — nhanh hơn một bước so với đưa vào KB rồi mới kiểm tra bằng bảng QA.

### 2.1 Đăng ký·sửa tài liệu thủ công (dành cho trường hợp khẩn)

**Quy trình**: thẻ tài liệu → **[Thêm tài liệu KB]** → chọn `nhóm` / nhập `tiêu đề` /
`danh mục` (gợi ý tự động chỉ hiện danh mục của nhóm đã chọn) / `nội dung` → lưu.
Bấm tiêu đề để mở cửa sổ chi tiết, và quản lý các mục sau trong **[Sửa]**:

| Trường | Công dụng |
|---|---|
| URL gốc | Liên kết tài liệu ngoài làm căn cứ (mở trực tiếp từ danh sách) |
| Hiệu lực từ | Ngày chính sách có hiệu lực |
| Chu kỳ rà soát (ngày) | Quá hạn thì danh sách hiển thị huy hiệu `stale` (cần rà soát) → §3.3 |
| Nội dung | Khi lưu sẽ **tự động embedding lại** (cập nhật chỉ mục tìm kiếm) |

💡 **Mẹo**
- 1 tài liệu = 1 chủ đề. Thay vì dồn "giao hàng+hoàn tiền+đổi hàng" vào một tài liệu, hãy
  tách ra đăng ký thì tìm kiếm mới chính xác.
- Đưa vào tiêu đề·nội dung **cách nói thực tế của khách hàng** ("giao hàng mất bao lâu",
  "khi nào được hoàn tiền"). Tìm kiếm dựa trên độ tương đồng nên càng gần từ ngữ của khách
  càng dễ khớp.
- Chính sách phiên bản cũ đừng xóa mà hãy **tắt hiển thị (vô hiệu)** để loại khỏi
  căn cứ. Lịch sử còn lại và dễ khôi phục.
- Danh sách nay **ưu tiên tiêu đề**: các cột là nhóm (chỉ ở tab Tất cả)·**huy hiệu nguồn
  gốc** (trực tiếp/bảng/tệp/YouTube/Drive/Notion/danh mục)·danh mục·tiêu đề·ngày sửa; công
  tắc hiển thị·trạng thái·xóa v.v. chuyển vào menu **⋯ (Thêm)** cuối hàng. Bộ lọc hiển
  thị/nguồn gốc/trạng thái và sắp xếp đều chạy phía máy chủ. Tài liệu trạng thái "đang
  chờ" **vẫn được dùng ngay trong tìm kiếm từ khóa** — chỉ tìm kiếm ngữ nghĩa phải đợi
  chỉ mục.

### 2.2 Tri thức sản phẩm — đồng bộ danh mục sản phẩm · CSV · hướng dẫn sử dụng

**Thuật ngữ**

| Thuật ngữ | Ý nghĩa |
|---|---|
| Bộ nhớ đệm sản phẩm | Danh sách sản phẩm gốc đã đồng bộ từ nền tảng (Cafe24 v.v.) (kết quả đồng bộ sản phẩm ở màn hình cài đặt) |
| Đồng bộ danh mục sản phẩm | Thao tác chuyển bộ nhớ đệm sản phẩm → tài liệu tri thức sản phẩm. 2 bước **xem trước → thực thi** |
| Gộp biến thể | Gom các biến thể phân tách bằng gạch ngang như "Son-Đỏ/Son-Hồng" thành 1 sản phẩm đại diện |
| Giữ bản biên tập | Bảo toàn tài liệu sản phẩm đã được người vận hành chỉnh tay, không để đồng bộ ghi đè |
| Hướng dẫn sử dụng | Tài liệu cách dùng chung theo **loại sản phẩm** (ví dụ: "Cách dùng sản phẩm son môi") — là căn cứ trả lời riêng biệt với tài liệu sản phẩm |

**Quy trình ① Đồng bộ danh mục sản phẩm**: phần đầu thẻ tài liệu → **[Đồng bộ từ danh mục sản phẩm]**
1. **Xem trước** chạy trước — hiển thị số lượng đã quét và kết quả dự kiến (tạo mới / sửa /
   giữ bản biên tập / gộp hấp thu / không đổi / treo lại), ước lượng lô embedding, và danh
   sách mẫu các mục sẽ gộp.
2. Kiểm tra trong mẫu gộp xem **các sản phẩm khác nhau có bị gom nhầm thành một không** rồi bấm **[Thực thi]**.
3. Theo dõi 2 dòng tiến độ (soạn / embedding), sau khi xong kiểm tra **số mục embedding thất
   bại** trong bảng kết quả (mục thất bại không tìm kiếm được nên phải chạy lại).

**Quy trình ② Nhập CSV sản phẩm**: **[Nhập CSV sản phẩm]** → chọn tệp → kiểm tra thống kê
kết quả (đã phân tích/tạo/sửa/bỏ qua/không hợp lệ/đã embedding) và lỗi theo dòng (hiển thị
tối đa 20 mục). Tải lại cùng sản phẩm sẽ ghi đè (upsert).

**Quy trình ③ Hướng dẫn sử dụng**: thẻ *Hướng dẫn sử dụng* hiển thị huy hiệu đã viết/chưa
viết theo từng loại sản phẩm. **[Viết]** → lưu tiêu đề·nội dung (từ 20 ký tự trở lên).

💡 **Mẹo**
- **Nhất định phải xem trước.** Gộp sai (các dòng sản phẩm khác nhau bị gom chung) chỉ có
  thể bắt được ở bước xem trước, trước khi thực thi.
- Khi sản phẩm thay đổi trên nền tảng, phải chạy **2 bước theo thứ tự**: đồng bộ sản phẩm
  ở [Cài đặt gian hàng] → đồng bộ danh mục sản phẩm ở [Kho tri thức] thì mới phản ánh vào tri thức.
- Với cửa hàng có mô tả sản phẩm sơ sài, thẻ tag chính là nguyên liệu của tri thức — dọn
  gọn tag sản phẩm phía nền tảng sẽ nâng chất lượng câu trả lời.

### 2.3 Tích hợp nguồn ngoài (bảng tin · Google Drive · Notion)

**Thuật ngữ**

| Thuật ngữ | Ý nghĩa |
|---|---|
| Tài khoản dịch vụ | Tài khoản robot dùng cho tích hợp Google Drive. Phải chia sẻ thư mục cho email của tài khoản này thì mới đọc được |
| Integration | Đơn vị cho phép công cụ ngoài truy cập trong Notion. Cần "kết nối" vào trang đích |
| Số đếm kết quả đồng bộ | Số mục tạo·sửa·bỏ qua·ẩn. `dropped`/`truncated` là **cảnh báo có phần không lấy về được** |

**Quy trình**
1. **Đăng ký thông tin xác thực** (2 thẻ dưới bảng nguồn):
   - Google Drive: dán JSON khóa tài khoản dịch vụ → **chia sẻ thư mục đích cho email tài
     khoản dịch vụ** được hiển thị → [Kiểm tra kết nối]
   - Notion: đăng ký token (`ntn_…`) → trong Notion **kết nối integration** vào trang/DB đích → [Kiểm tra kết nối]
2. **[Thêm nguồn]** → chọn loại (board / gdrive / notion) → gdrive nhập `ID thư mục`,
   notion nhập `ID trang·DB hoặc URL chia sẻ`
3. Chạy **↻(đồng bộ)** trên hàng nguồn → kiểm tra số đếm kết quả ở cột *Đồng bộ lần cuối*

Loại được hỗ trợ: bảng tin (board) ✅ · Google Drive ✅ · Notion ✅ · nguồn kho lưu trữ GitHub (repository) **không được hỗ trợ**.

💡 **Mẹo**
- Nếu kết quả đồng bộ hiện cảnh báo đỏ **dropped/truncated**, nghĩa là trang quá lớn hoặc
  quá sâu nên một phần bị cắt. Hãy mở tài liệu đó kiểm tra phần cuối có nguyên vẹn không,
  và chia nhỏ bản gốc rồi đồng bộ lại. Lỗi Notion hiển thị lý do ngay trong ô *Đồng bộ lần
  cuối* — nếu thấy "trang chưa được chia sẻ với integration", hãy mở trang trong Notion và
  thêm integration ở ⋯ → Connections.
- Nếu đồng bộ đột nhiên trả về **0 mục** (bị hủy chia sẻ thư mục, hủy kết nối integration
  v.v.), hệ thống giữ nguyên các tài liệu hiện có mà không ẩn chúng — hãy khôi phục kết nối trước.
- Bấm vào ô trạng thái của nguồn để bật↔tắt. Nguồn tắt chỉ dừng đồng bộ, các tài liệu đã
  lấy về vẫn còn.
- **[Xem lịch sử chuyển đổi]** (biểu tượng cạnh tên nguồn): xem lịch sử các lần đồng bộ
  (thành công/thất bại · tạo/cập nhật/giữ/ẩn · lập chỉ mục · thời gian · lý do) và danh
  sách tài liệu đã chuyển đổi từ nguồn này.
- **Xóa nguồn là an toàn** — chỉ nguồn bị xóa; tài liệu của nó không bị xóa mà bị **vô
  hiệu hóa** và loại khỏi tìm kiếm (có thể bật lại từ danh sách tài liệu).

### 2.4 Tải xuống hàng loạt ↔ nhập hàng loạt (vòng CSV/XLSX)

**[Tải xuống hàng loạt ▾]** (CSV/Excel) và **[Nhập hàng loạt]** trên thẻ tài liệu dùng
chung một hợp đồng cột: `category · title · content` (bắt buộc) + `external_key ·
source_url` (tùy chọn). **Hai nút này chỉ xuất hiện khi đã chọn tab nhóm** (ẩn ở tab Tất
cả — vì phải xác định nhóm đích).

**Quy trình**: chọn tab nhóm → tải tài liệu hiện có bằng [Tải xuống hàng loạt] và chỉnh
sửa → tải lên lại bằng [Nhập hàng loạt]. Các hàng có cùng `external_key` (hoặc cùng **tiêu
đề đã cắt khoảng trắng**) sẽ cập nhật tài liệu hiện có thay vì tạo bản sao; hàng không đổi
bị bỏ qua. Toast kết quả báo số tạo·cập nhật·bỏ qua.

- Tối đa 5.000 hàng / 5MB. CSV **chỉ nhận UTF-8** — từ Excel tiếng Hàn, hãy lưu dạng
  "CSV UTF-8" hoặc tải lên chính tệp `.xlsx`.
- Tab CounselInfo có khối tải **Hướng dẫn tư vấn chung** (KB tư vấn khởi đầu dùng ngay) —
  tải về, chỉnh thời hạn·chi phí theo chính sách cửa hàng rồi tải lên để lấp đầy tri thức
  ban đầu trong một lần.
- Tài liệu đến từ nguồn ngoài (danh mục·bảng·Notion·Drive) vẫn sửa được, nhưng **lần đồng
  bộ tiếp theo có thể ghi đè** — nguyên tắc là sửa ở bản gốc.

### 2.5 Nhập bằng AI (tệp·YouTube → bản nháp → bảng)

**[Nhập bằng AI]** — tải lên tệp (pdf·docx·xlsx·csv·md, tối đa 15MB) hoặc URL YouTube có
phụ đề công khai, AI sẽ tách nội dung thành **các bản nháp cấp bài viết**.

**Quy trình**: chọn nhóm (cẩm nang tư vấn/gợi ý sản phẩm/cẩm nang vận hành) → tải tệp hoặc
nhập URL video → **[Bắt đầu phân tích]** (tác vụ chạy nền — có thể rời màn hình) → duyệt
bản nháp (chọn, chỉnh tiêu đề/danh mục, chú ý huy hiệu "cần kiểm tra") → **[Lưu N mục đã
chọn]**.

⚠️ Bản nháp đã lưu được đăng **lên bảng**, không vào thẳng KB — hãy duyệt trên bảng rồi
đưa vào KB (§2.0). Tệp không có lớp văn bản (như PDF scan) và video không có phụ đề thì
không phân tích được.

---

## 3. Kiểm chứng·quản lý chất lượng tri thức

**Thuật ngữ**

| Thuật ngữ | Ý nghĩa |
|---|---|
| Bảng QA tri thức | Bảng thử nghiệm đặt câu hỏi với tri thức từ góc nhìn khách hàng (cố định bên phải) |
| Nguồn trích dẫn (citation) | Danh sách tài liệu làm căn cứ cho câu trả lời. Hiển thị kèm chỉ số độ tương đồng |
| Mâu thuẫn (conflict) | Trạng thái hai tài liệu bị phát hiện chứa **nội dung mâu thuẫn nhau** |
| stale | Huy hiệu tài liệu đã quá chu kỳ rà soát, cần xác nhận lại |
| Khoảng trống tri thức (gap) | Chủ đề khách đã hỏi nhưng tri thức không có câu trả lời — hệ thống đề xuất thành bản nháp tài liệu |
| Đề xuất câu trả lời (proposal) | Đề xuất nâng câu trả lời thực tế của nhân viên tư vấn thành tài liệu tri thức (bắt buộc người duyệt) |
| Revision | Ảnh chụp lịch sử thay đổi của tài liệu. Hỗ trợ xem diff và khôi phục |

### 3.1 Bảng QA tri thức — nhất định kiểm tra sau khi đăng ký

**Quy trình**: chọn agent (**Tất cả (góc nhìn người vận hành)** hoặc một agent cụ thể —
kiểm thử đúng theo phạm vi agent §3.5 được thấy) → nhập câu hỏi → kiểm tra câu trả lời +
**chỉ số độ tin cậy** + **danh sách nguồn** (độ tương đồng theo tài liệu) → nếu tài liệu
căn cứ sai thì bấm **[Sửa]** cạnh nguồn (tài liệu đó mở ngay ở chế độ sửa) → sửa xong bấm
**[Hỏi lại]** để kiểm tra lại.

💡 **Mẹo**
- Nếu câu trả lời hiện huy hiệu **bị kiểm duyệt chặn** nghĩa là vướng quy tắc cấm (§4.5) —
  đây là câu trả lời mà nếu là khách hàng thật thì đã không được hiển thị.
- Nếu nguồn có huy hiệu `conflicted`/`stale`, hãy xử lý tài liệu đó trước. Chủ đề có độ tin
  cậy thấp phần lớn là do thiếu tài liệu hoặc tài liệu xa rời từ ngữ của khách hàng.
- Mỗi khi đổi chính sách, thói quen ném "3 câu hỏi khách có thể hỏi" vào bảng QA là bài
  kiểm tra hồi quy rẻ nhất (tự động hóa xem §6.3 câu hỏi vàng).

### 3.2 Rà soát mâu thuẫn

**Quy trình**: bảng *Rà soát mâu thuẫn* bên phải → theo từng mục kiểm tra kết luận (**Mâu
thuẫn/Trùng lặp/Liên quan**), độ tương đồng và lý do phán định của hai tài liệu → chọn
hành động:

| Hành động | Tác dụng |
|---|---|
| Theo A · ẩn B / Theo B · ẩn A | Giữ bên được chọn và tắt bên còn lại |
| Giữ cả hai | Phán định không phải mâu thuẫn — cả hai vẫn bật |
| Không phải mâu thuẫn | Đóng mục mâu thuẫn này |
| Đánh giá lại cặp này | Sửa tài liệu xong yêu cầu đánh giá lại (mục đánh giá thất bại cũng thử lại tại đây) |

Có thể quét lại toàn bộ tài liệu bằng **[Quét lại]**.

💡 **Mẹo**: mâu thuẫn thường sinh ra do **khi sửa chính sách mà không gỡ phiên bản cũ**.
Đừng dừng ở "Theo A" — hãy ghi ngày hiệu lực (Hiệu lực từ) vào tài liệu được giữ để lần sửa
chính sách sau không lặp lại chuyện này.

### 3.3 Chu kỳ rà soát·quản lý stale / lịch sử thay đổi

- Đặt `chu kỳ rà soát (ngày)` trong phần sửa tài liệu; quá hạn thì danh sách gắn huy hiệu
  `stale`. Bấm **[Đánh dấu đã rà soát]** trong hộp trạng thái rà soát ở chi tiết tài liệu
  thì thời hạn được tính lại.
- Trong **tab lịch sử thay đổi** của cửa sổ chi tiết, có thể xem diff theo từng revision và **[Khôi phục]**.

💡 **Mẹo**: tài liệu hay thay đổi như phí giao hàng·khuyến mãi nên đặt chu kỳ rà soát ngắn
khoảng 30 ngày, tài liệu ổn định như thông báo pháp lý đặt dài — khi đó huy hiệu stale trở
thành danh sách việc cần làm thực thụ.

### 3.4 Đề xuất bổ sung tri thức · đề xuất câu trả lời (vòng khép kín)

- **Đề xuất bổ sung tri thức** (đầu màn hình, chỉ hiện khi có mục): các chủ đề hay bị
  chuyển tiếp, ý định không có tài liệu căn cứ và cách nhân viên đã xử lý được tích lũy
  thành ứng viên cho KB. **[Duyệt thành tài liệu tri thức]** (tạo tài liệu sau khi sửa
  tiêu đề·nội dung) hoặc **[Bỏ qua]** — không có gì được áp dụng tự động.
- **Đề xuất câu trả lời** (hiện khi có mục chờ): đề xuất đưa câu trả lời thực tế của nhân
  viên tư vấn vào tri thức. Kiểm tra câu hỏi·câu trả lời·liên kết hội thoại nguồn rồi
  **[Duyệt]** hoặc **[Từ chối]** (lý do hiển thị cho người đề xuất).

💡 **Mẹo**: hai kênh này là con đường để tri thức tự lớn lên. Tạo thói quen dọn sạch mỗi
tuần một lần sẽ giảm nguyên nhân gốc của "AI cứ chuyển sang nhân viên tư vấn". Trước khi
duyệt, nhất định kiểm tra **thông tin cá nhân (mã đơn hàng·tên) không còn sót trong câu trả
lời** — tài liệu tri thức sẽ được tái sử dụng làm căn cứ cho câu trả lời của mọi khách hàng.

### 3.5 Phạm vi agent của danh mục (tri thức theo từng agent)

Mỗi hàng trong thẻ *Danh mục* hiển thị phạm vi hiện tại dưới dạng nút — **"Tất cả agent"**
(mặc định; phạm vi trống = mở cho tất cả) hoặc **"Agent n/tổng"**.

**Quy trình**: bấm nút → chọn **Tất cả agent (mặc định)** / **Chỉ agent đã chọn** → lưu.
Thu hẹp phạm vi nghĩa là chỉ agent được chọn mới trích dẫn được tài liệu của danh mục đó
(tái sử dụng câu trả lời cũng theo cùng phạm vi).

💡 **Mẹo**
- ⚠️ **Agent tạo sau không thấy được danh mục đã bị thu hẹp** — thêm agent mới thì hãy rà
  lại các phạm vi.
- Danh mục sinh từ catalog (thương hiệu) luôn dùng được bởi mọi agent và không thể giới
  hạn phạm vi.
- Chọn agent trong bảng QA (§3.1) là cách chắc chắn nhất để kiểm chứng "agent này thực sự
  thấy gì".

---

## 4. Cài đặt AI
*(Menu trái **[Cài đặt AI]** — quyền truy cập: master/director)*

**Thuật ngữ**

| Thuật ngữ | Ý nghĩa |
|---|---|
| Nhân viên AI (agent) | Đơn vị bot tư vấn có bộ persona·quy tắc riêng. Có thể tạo nhiều bot khác nhau cho từng kênh·trang |
| Nhân viên mặc định | Agent mà widget dùng khi không chỉ định riêng (luôn hoạt động) |
| Đoạn mã điểm vào | Đoạn mã cài đặt để mở widget với một agent cụ thể |
| Persona / quy tắc trả lời | Mô tả giọng điệu·nguyên tắc của bot / danh sách quy tắc nhất định phải tuân thủ (được nạp vào bước ③ pipeline §0) |
| Nút kịch bản | Nút menu nhanh dưới cùng của widget. Chọn trong 7 loại hành động; **nhãn quản lý theo từng ngôn ngữ** |
| Hội thoại mặc định | Chỉnh nội dung phản hồi·chip tiếp theo của **7 kịch bản có sẵn** trong SharpTalk (§4.7) |
| Chức năng AI (function) | 5 vị trí AI được dùng (chat/rag/summary/assist/moderation) — mỗi vị trí chỉ định một công cụ |
| Quy tắc kiểm duyệt | Quy tắc cấm kiểm tra tin nhắn gửi đi (bước ④ pipeline §0) |
| Tái sử dụng câu trả lời | Chức năng phát lại câu trả lời cũ đã duyệt cho cùng câu hỏi, không gọi LLM |
| Ghi chú thay đổi | Dòng ghi chú để lại khi lưu persona·quy tắc — tra cứu trong lịch sử thay đổi cài đặt |

### 4.1 Nhân viên AI (đa persona)

**Quy trình**: chọn một agent trong thẻ *Nhân viên AI* thì các thẻ persona·quy tắc trả lời
bên dưới chuyển thành **của agent đó**. Dùng **[Thêm nhân viên]** đặt tên·mã (chữ thường)
để tạo agent mới, và quản lý **[Đặt làm mặc định]** / công tắc hoạt động / **[Xóa]**. Sao
chép **đoạn mã điểm vào** của từng agent và cài lên trang·kênh cụ thể thì bot đó sẽ tiếp khách.

Khi sửa agent, hai trường danh tính hướng tới khách hàng được đặt riêng:
- **Tên hiển thị trên widget** — hiện ở phần đầu widget (bỏ trống thì dùng tên hiển thị
  của cửa hàng).
- **Tin nhắn phản hồi đầu tiên** — viết theo từng tab ngôn ngữ. Là bong bóng đầu tiên của
  phiên được gán agent này; ngôn ngữ bỏ trống dùng tin nhắn đầu chung của cửa hàng.

Ngay dưới thẻ agent, thẻ **"Cài đặt áp dụng cho {agent}"** tóm tắt dạng chỉ đọc **các giá
trị thực sự được áp dụng** (kể cả giá trị mặc định thay thế) cho lời chào·persona·quy tắc
trả lời·nút hiển thị — việc chỉnh sửa làm ở từng mục tương ứng.

💡 **Mẹo**
- Agent được **gán một lần khi phiên bắt đầu** — đổi đoạn mã giữa chừng cũng không đổi bot
  của phiên đang diễn ra.
- Vào bằng mã không tồn tại thì tự động rơi về agent mặc định, nên widget không bao giờ chết.
- "Nhân viên AI" ở đây không liên quan đến tài khoản nhân viên tư vấn (con người). Tài
  khoản người thật nằm ở menu [Người dùng].

### 4.2 Persona·quy tắc trả lời

**Quy trình**: viết nội dung persona → nhập **ghi chú thay đổi** → lưu. Quy tắc trả lời
thêm từng dòng bằng [Thêm quy tắc] (dòng trống bị loại khi lưu).

💡 **Mẹo**
- Persona chứa danh tính·tông giọng ("thân thiện, súc tích, lịch sự"), quy tắc chứa **ràng
  buộc hành vi** ("không khẳng định hoàn tiền đã hoàn tất") — tách ra như vậy sẽ dễ quản lý.
  Thông tin sự thật (phí giao hàng v.v.) không đặt ở đây mà đưa vào **tài liệu tri thức** —
  persona không được tìm kiếm.
- Sau khi lưu, hiệu lực có thể mất tối đa 60 giây do bộ nhớ đệm.
- Trong thẻ *Lịch sử thay đổi* có thể mở phiên bản cũ và **[Nạp vào ô soạn thảo]**, nhưng
  chỉ nạp thì chưa áp dụng — **phải lưu** mới có hiệu lực.

### 4.3 Nút kịch bản

**Quy trình**: chọn tab **Ngôn ngữ của nhãn** (6 ngôn ngữ) ở trên, rồi từng hàng chỉnh
`nhãn` (tối đa 60 ký tự) / `hành động` / ô chọn `đang bật` / thứ tự (↑↓) / **[Agent]**
(agent nào hiển thị nút này — tất cả agent dùng chung hoặc chỉ agent đã chọn).
- **Nhãn theo từng ngôn ngữ**: nhãn nhập chỉ áp dụng cho tab ngôn ngữ đang chọn; các ngôn
  ngữ khác giữ nguyên. 6 nút mặc định (Tình trạng giao hàng·Hủy / Hoàn tiền·Hỗ trợ sản
  phẩm·Liên hệ hỗ trợ·Cộng tác viên·Đơn hàng của tôi) có sẵn nhãn cho cả 6 ngôn ngữ.
- Gợi ý dưới mỗi nhãn cho biết **kịch bản có sẵn** mà nút thực sự chạy — "không có kịch
  bản" nghĩa là nhãn được gửi làm tin nhắn chat và AI trả lời. Chỉnh nội dung kịch bản ở
  §4.7 Hội thoại mặc định.

7 loại hành động:

| Hành động | Hành vi thực tế trong widget |
|---|---|
| Tình trạng giao hàng | Câu trả lời cố định về chính sách giao hàng + nút tiếp theo |
| Hủy / Hoàn tiền | Câu trả lời cố định về hủy·hoàn tiền·trả hàng + nút tiếp theo |
| Hỗ trợ sản phẩm | Menu con (cách dùng·thành phần·hàng về lại v.v.) |
| Liên hệ hỗ trợ | Biểu mẫu để lại liên hệ — đường kết nối nhân viên tư vấn |
| Đơn hàng của tôi | Chuyển đến tab đơn hàng sau khi xác minh danh tính |
| Cộng tác viên | Thẻ giới thiệu hợp tác |
| Gửi tin nhắn | **Gửi nguyên văn nhãn làm câu hỏi** → AI trả lời dựa trên tri thức |

Bấm **[Sửa câu trả lời]** để chỉnh nội dung phản hồi theo từng hành động bằng **tab 6 ngôn
ngữ** và cấu hình các chip tiếp theo (nhãn·hành động·URL). Trình soạn mở với nội dung mặc
định **đã điền sẵn trong ô** — sửa thì ghi đè, để nguyên thì không lưu gì. **[Khôi phục
mặc định]** đưa về ban đầu bất cứ lúc nào.

💡 **Mẹo**
- Muốn biến câu hỏi thường gặp thành nút, hãy dùng hành động **Gửi tin nhắn** với nhãn là
  câu hỏi (ví dụ: "Điều kiện miễn phí giao hàng là gì?").
- Thay vì xóa nút, hãy bỏ chọn `đang bật` để ẩn — kích hoạt lại sẽ dễ. Khuyến nghị luôn bật
  **Liên hệ hỗ trợ** — khách không tìm được nhân viên tư vấn sẽ rời đi.
- Đảm bảo nội dung câu trả lời cố định và nội dung chính sách trong tài liệu tri thức
  **không lệch nhau** — khi sửa chính sách hãy cập nhật cùng lúc.

### 4.4 Chức năng AI (công cụ·tham số)

**Quy trình**: trên hàng của từng chức năng chọn công cụ áp dụng, nhập `temperature` (0~1)·
`max_tokens` rồi lưu riêng từng mục. Chức năng chưa chỉ định hiển thị huy hiệu
`kế thừa/mặc định/stub` cùng tên công cụ thực tế đang áp dụng.

Công dụng của 5 chức năng:

| Chức năng | Công dụng thực tế |
|---|---|
| chat | Điều khiển hội thoại như phân loại ý định tin nhắn khách hàng |
| rag | **Tạo câu trả lời dựa trên tri thức — phần chính của câu trả lời khách nhìn thấy** |
| summary | Tóm tắt hội thoại (lịch sử·bản tóm tắt khi chuyển tiếp) |
| assist | Hỗ trợ AI trong bảng điều khiển của nhân viên tư vấn |
| moderation | Phán định LLM cho quy tắc cấm dạng ngữ cảnh (context) |

**Chuỗi dự phòng**: công cụ đã chọn không dùng được → mặc định của tenant → mặc định của
nền tảng → **stub** (trả lời demo) — tự động hạ bậc theo thứ tự đó nên hội thoại không bị đứt.

💡 **Mẹo**
- **max_tokens** là trần độ dài câu trả lời — trả lời chat thì 512~1024 là đủ.
- ⚠️ **temperature không được áp dụng cho công cụ Anthropic (Claude).** Các mô hình Claude
  hiện hành từ chối tham số lấy mẫu nên hệ thống chủ đích không gửi. Nhập cũng bị bỏ qua;
  chỉ áp dụng cho các công cụ dòng OpenAI.
- Còn huy hiệu `stub` thì chưa phải chất lượng dịch vụ thật. Công cụ (engine) đến từ hai
  nơi: **engine riêng của tenant** (thẻ *Engine AI* trong [Cài đặt gian hàng → Cài đặt cơ
  bản] — đăng ký bằng API key của bạn, được ưu tiên hơn engine nền tảng, chi phí tính vào
  tài khoản của bạn) và engine nền tảng cung cấp (quản trị viên nền tảng đăng ký ở
  `/admin/ai-engines`). Mức sử dụng thực tế xem ở thẻ *Mức dùng AI* cùng tab (kèm cảnh báo
  số lần rơi về stub).
- Mô hình embedding cho tìm kiếm tri thức không có trong màn hình này — được máy chủ quản
  lý dùng chung cho mọi tenant.

### 4.5 Quy tắc kiểm duyệt (cấm)

**Quy trình**: **[Thêm quy tắc]** → chọn loại/phạm vi/hành động:

| Mục | Lựa chọn | Ý nghĩa |
|---|---|---|
| Loại | Từ / Cụm từ | Khớp chứa (không phân biệt hoa thường) |
| | Biểu thức chính quy | Khớp mẫu (ví dụ: `\bphẫu thuật\b`) |
| | Ngữ cảnh (LLM) | Viết "cần chặn cái gì" thành câu, AI sẽ phán định từng tin nhắn |
| Phạm vi | Chỉ AI / Chỉ nhân viên / Cả hai | Kiểm tra tin nhắn của bên gửi nào |
| Hành động | Chặn | Không gửi tin nhắn ra (nếu là câu trả lời AI thì chuyển sang chuyển tiếp nhân viên tư vấn) |
| | Che | Chỉ phần vướng bị xử lý thành ▇▇▇ rồi chuyển đi |
| | Diễn đạt lại | AI sửa thành câu an toàn rồi chuyển đi |

💡 **Mẹo**
- Cổng kiểm duyệt này **không thể tắt**, và nếu bản thân việc kiểm tra thất bại thì vì an
  toàn sẽ xử lý là **chặn**. Nếu tin nhắn của nhân viên tư vấn bị từ chối gửi (có thông báo
  chặn), hãy đổi cách diễn đạt rồi gửi lại.
- Loại ngữ cảnh (LLM) dùng công cụ của chức năng moderation — nếu đang stub thì không có
  chất lượng phán định, hãy dùng sau khi kết nối công cụ thật.
- Quy tắc từ khóa quá mức sẽ chặn cả câu trả lời bình thường. Khuyến nghị bắt đầu bằng
  **Che/Diễn đạt lại**, xem log rồi mới nâng lên chặn. Quy tắc có hiệu lực trong tối đa 60 giây.

### 4.6 Tái sử dụng câu trả lời

**Quy trình**: trong thẻ *Tái sử dụng câu trả lời* có thể tìm các cặp hỏi-đáp đã lưu (lọc
chỉ mục đang bật), sửa/xóa từng mục, hoặc **[Tắt tất cả]** (sau khi xác nhận) để dừng hàng loạt.

💡 **Mẹo**: câu trả lời tái sử dụng được gửi ngay cho cùng câu hỏi mà không gọi LLM nên
nhanh và rẻ, nhưng **khi chính sách thay đổi, câu trả lời cũ có thể vẫn được gửi nguyên
xi.** Hãy đưa việc tìm·sửa hoặc tắt các mục liên quan vào danh sách kiểm tra mỗi khi sửa
chính sách. Câu trả lời tái sử dụng vẫn phải qua kiểm duyệt, và cũng tuân theo phạm vi
agent của danh mục (§3.5).

### 4.7 Hội thoại mặc định (7 kịch bản có sẵn)

Thẻ *Hội thoại mặc định* liệt kê **toàn bộ kịch bản SharpTalk cung cấp sẵn** — không chỉ
các kịch bản do nút kịch bản chạy mà cả **những kịch bản khách chỉ đến được qua chip tiếp
theo** — tổng cộng 7 (hủy/hoàn tiền · hủy đơn · chính sách hoàn tiền · trả/đổi hàng ·
chính sách giao hàng · trợ giúp đơn hàng · trợ giúp sản phẩm chung).

**Quy trình**: bấm **[Xem / sửa]** trên hàng kịch bản → chọn ngôn ngữ → chỉnh `Câu của
khách` (câu hiển thị trong hội thoại như thể khách tự nhập khi bấm nút) / `nội dung phản
hồi` / `chip tiếp theo` / `sau khi trả lời` (ở lại chat·mở đơn hàng của tôi·mở biểu mẫu
liên hệ·mở thẻ cộng tác viên·kết nối nhân viên·mở URL) → lưu.

💡 **Mẹo**
- Huy hiệu trên mỗi hàng cho biết đường tiếp cận: **"Nút menu · {hành động}"** (chạy bằng
  nút kịch bản) vs **"Chỉ qua chip tiếp theo"**. Số ngôn ngữ đã sửa ("Đã sửa n ngôn ngữ")
  cũng hiển thị.
- Nội dung mặc định mở với ô đã điền sẵn — để nguyên thì không lưu gì, sửa thì ghi đè.
  **[Khôi phục mặc định]** đưa về ban đầu.
- Đảm bảo nội dung kịch bản cố định và chính sách trong tài liệu tri thức **không lệch
  nhau** — sửa chính sách thì cập nhật cùng lúc (danh sách kiểm tra §7).

---

## 5. Cài đặt tiếp khách live chat
*(Tab **[Cài đặt gian hàng] → Chuyển nhân viên** — tách khỏi tab Cài đặt cơ bản từ 2026-10-24)*

**Thuật ngữ**

| Thuật ngữ | Ý nghĩa |
|---|---|
| Escalation (chuyển tiếp) | Việc AI đẩy hội thoại sang hàng chờ nhân viên tư vấn |
| Handoff (chuyển tiếp tư vấn) | Bộ cài đặt quyết định phân công·thời gian·hướng dẫn sau khi chuyển tiếp |
| Giờ làm việc | Khung giờ nhân viên tư vấn tiếp khách. Ngoài khung này chuyển sang hướng dẫn ngoài giờ·tiếp nhận qua email |
| SLA | Thời gian mục tiêu phản hồi. Tiêu chuẩn đánh giá mức độ trễ trong bảng điều khiển live chat |
| Hàng chờ (waiting) | Trạng thái hội thoại đã chuyển tiếp đang đợi nhân viên tư vấn tiếp nhận |

### 5.1 Người phụ trách·giờ làm việc·hướng dẫn ngoài giờ

**Quy trình**: trong tab *Chuyển nhân viên*
1. **Nhân viên được phân công** — tích chọn nhân viên tư vấn sẽ nhận chuyển tiếp (bỏ
   trống thì báo cho mọi nhân viên; ai nhận trước người đó tiếp)
2. Công tắc **Chỉ kết nối trong giờ làm việc** → múi giờ·giờ bắt đầu/kết thúc·ngày trong
   tuần, khi cần thêm công tắc **giờ nghỉ** (câu hỏi trong giờ nghỉ xử lý như ngoài giờ)
3. **Email ngoài giờ** — địa chỉ nhận câu hỏi ngoài giờ làm việc (hiển thị cảnh báo nếu chưa cấu hình SMTP)
4. **Thông báo ngoài giờ gửi cho khách hàng** — viết theo từng tab ngôn ngữ (bỏ trống thì dùng nội dung mặc định)
5. **Mục tiêu SLA của bảng yêu cầu** — thường/khẩn cấp (giờ, 1~168h; mặc định 24h/4h) — là
   tiêu chuẩn cho huy hiệu trễ ⚠️/🔥 trên bảng
6. **Chuyển tiếp bắt buộc theo chính sách (deny-list)** — đăng ký quy tắc từ khóa (phân
   tách bằng phẩy) + loại yêu cầu + nhãn phụ trách + **cách hiển thị với khách**. Hai chế
   độ: **Không trả lời** (chuyển ngay không phản hồi, mặc định) / **Trả lời rồi chuyển**
   (trả lời từ kho tri thức trước rồi vẫn chuyển) — kiểu nào nhân viên cũng được gọi, và
   yêu cầu (issue) được tạo sẽ tự động gán loại·nhãn

💡 **Mẹo**
- Đặt **múi giờ** của giờ làm việc chính xác theo cửa hàng — cửa hàng ở Mỹ mà để giờ Hàn
  Quốc thì hướng dẫn sẽ ngược hết.
- Muốn dùng tiếp nhận email ngoài giờ thì cấu hình SMTP máy chủ phải có trước. Thấy cảnh
  báo thì đề nghị quản trị viên nền tảng.
- Không chỉ định người phụ trách nào thì hội thoại chuyển tiếp chỉ dồn trong hàng chờ
  chung. Hãy chỉ định tối thiểu 1 người.

### 5.1a Danh mục tư vấn·quy tắc phân công

1. Trong **[Quản lý danh mục tư vấn]**, tạo các chủ đề tư vấn mà khách sẽ chọn (ví dụ: đặt
   phòng·thanh toán) và đặt ở trạng thái **Hiển thị**. Khi cần, nhập tên vi/en trong ▸ *Tên theo ngôn ngữ*.
2. Viết **quy tắc phân công** theo thứ tự từ trên xuống. Quy tắc = danh mục tư vấn + nghiệp vụ
   (từ khóa) + thông tin khách hàng (khu vực·tỉnh/thành·ngôn ngữ…) → người phụ trách (nhóm × nhóm
   nhãn hoặc cá nhân). Hội thoại được kết nối theo **quy tắc đầu tiên** khớp tất cả điều kiện.
3. Nhập danh mục tư vấn·khu vực… vào ô **Kiểm tra phân công** phía trên các quy tắc để xem
   trước hội thoại sẽ đến ai, rồi **lưu**.

⚠️ Lưu ý
- Chip nhãn ở dòng *Nghiệp vụ* chỉ khớp với hội thoại đến từ chuyển tiếp bắt buộc theo chính
  sách. Nhãn nhóm nhân viên tư vấn hãy chọn ở *Người phụ trách* (trình soạn thảo sẽ hiện cảnh báo).
- Nhân viên chưa chấp nhận lời mời sẽ không được phân công. Nếu nhóm có 0 nhân viên đang hoạt
  động thì quy tắc đó bị bỏ qua.
- Nếu khách không chọn danh mục tư vấn thì chỉ những quy tắc để trống danh mục tư vấn mới khớp.
  Đặt một quy tắc mặc định không có điều kiện ở cuối cùng sẽ an toàn.

→ Hướng dẫn từng màn hình (nhóm & nhãn → danh mục tư vấn → quy tắc phân công → yêu cầu của khách → cảnh báo): [Hướng dẫn phân công nhân viên](agent-assignment.vi.md)

### 5.2 Hiểu điều kiện chuyển tiếp (escalation)

Các trường hợp AI chuyển sang nhân viên tư vấn:

| Kích hoạt | Hành vi |
|---|---|
| **Độ tin cậy thấp** | Kèm câu "Tôi kết nối bạn với nhân viên tư vấn nhé?" vào câu trả lời và đưa vào hàng chờ |
| **Bị kiểm duyệt chặn** | Không hiển thị câu trả lời AI, hướng dẫn kết nối nhân viên tư vấn rồi đưa vào hàng chờ |
| **Khách yêu cầu** | Nút kịch bản *Liên hệ hỗ trợ* hoặc yêu cầu rõ ràng → vào hàng chờ ngay (nếu có danh mục tư vấn đang hiển thị, widget sẽ hỏi danh mục tư vấn trước rồi kết nối theo quy tắc của danh mục đó) |
| **Chuyển tiếp bắt buộc theo chính sách (deny-list)** | Quy tắc "Không trả lời": vào hàng chờ **ngay lập tức, không có phản hồi AI**. Quy tắc "Trả lời rồi chuyển": trả lời từ tri thức trước rồi vào hàng chờ. Tin nhắn vẫn được lưu·hiển thị bình thường, và yêu cầu được đóng dấu loại·nhãn (đây không phải chức năng chặn tin nhắn) |

💡 **Mẹo**
- Ngưỡng độ tin cậy không điều chỉnh được trên màn hình (chính sách trong mã) — nếu chuyển
  tiếp xảy ra thường xuyên, cách ứng phó đúng không phải là chỉnh ngưỡng mà là **bổ sung tri
  thức** (xác định nguyên nhân bằng bảng QA §3.1).
- Xử lý hội thoại đã chuyển tiếp (tiếp nhận·bản tóm tắt AI·kết thúc·phân công lại) làm tại
  bảng điều khiển live chat (`/live-chat`) — xem chương live chat của sổ tay tổng hợp.

---

## 6. Vòng lặp kiểm chứng·cải thiện
*(Studio bên phải của **[Cài đặt AI]** + thẻ kiểm tra hồi quy)*

**Thuật ngữ**

| Thuật ngữ | Ý nghĩa |
|---|---|
| Xem thử | Bảng thử nghiệm trò chuyện với bot mà không tạo phiên khách hàng thật |
| Huấn luyện AI | Chức năng phản hồi bằng ngôn ngữ tự nhiên "hãy trả lời thế này" để nhận **đề xuất** thay đổi cấu hình, chỉ áp dụng khi được duyệt |
| Đề xuất (proposal) | Thẻ phương án thay đổi cấu hình do huấn luyện tạo ra. Có thể áp dụng/bỏ qua/hoàn tác |
| Câu hỏi vàng | Danh sách câu hỏi đại diện muốn liên tục theo dõi chất lượng trả lời (đầu vào của kiểm tra hồi quy) |
| Kiểm tra hồi quy | Sau khi đổi cấu hình·tri thức, chạy lại toàn bộ câu hỏi vàng để xác nhận câu trả lời không tệ đi |
| Đo độ dao động | Chức năng chạy lặp lại cùng câu hỏi để xem câu trả lời dao động đến đâu |

### 6.1 Xem thử

**Quy trình**: tab **Xem thử** của studio → chọn ngôn ngữ → **[Phiên mới]** → chọn chế độ
(khách hàng/nhân viên) rồi nhập tin nhắn. Phản hồi hiển thị **huy hiệu agent** phụ trách và
**trạng thái chuyển tiếp**. Bấm **[Huấn luyện câu này]** trên từng phản hồi để đính lượt hội
thoại đó vào phần huấn luyện.

💡 **Mẹo**: đã đổi cấu hình thì sau khi lưu phải bắt đầu bằng **[Phiên mới]** mới thấy hội
thoại với cấu hình mới. Hãy đổi ngôn ngữ để kiểm tra các câu hỏi chính — ngôn ngữ trả lời
theo ngôn ngữ phiên. Phiên xem thử **không được tính vào số hội thoại của dashboard·thống
kê** — cứ thoải mái kiểm thử.

### 6.2 Huấn luyện AI

**Quy trình**: tab **Huấn luyện AI** → chọn chủ đề hoặc [Chủ đề mới] → kiểm tra lượt tham
chiếu đã đính từ Xem thử rồi ra chỉ dẫn bằng ngôn ngữ tự nhiên (ví dụ: "Hướng dẫn hoàn tiền
dài quá. Gói trong 3 câu") → xem xét nội dung thay đổi trong **thẻ đề xuất** được tạo →
**[Áp dụng]** / **[Bỏ qua]** / sau khi áp dụng có **[Hoàn tác]**.

💡 **Mẹo**
- Huấn luyện **không thay đổi gì nếu chưa được duyệt.** Hãy đọc nội dung thay đổi thực tế
  (diff persona·quy tắc) trên thẻ đề xuất rồi mới áp dụng.
- **Thông tin sự thật** kiểu "miễn phí giao hàng cho đơn từ 50.000 won" là việc của tài
  liệu tri thức, không phải của huấn luyện — huấn luyện là công cụ tinh chỉnh giọng điệu·quy
  tắc hành vi.
- Câu chữ hơi khác đi là dao động bình thường. **Độ tin cậy giảm·chuyển tiếp tăng** mới là
  tín hiệu bất thường thật sự.

### 6.3 Kiểm tra hồi quy (câu hỏi vàng)

**Quy trình**: thẻ *Kiểm tra hồi quy* → đăng ký câu hỏi vàng (10~20 câu đại diện) →
**[Chạy ngay]** → trong danh sách các lần chạy gần đây bấm **[So với lần trước]** để so
sánh song song thay đổi của câu trả lời. **[Đo độ dao động]** cho thấy mức dao động của
cùng một câu hỏi. Các câu hỏi đăng ký ở đây cũng được **golden-set A/B của phần mô phỏng
trên bảng tri thức** (§2.0) tái sử dụng — làm thước đo mức cải thiện của tài liệu trước
khi đưa vào KB.

💡 **Mẹo**
- Đưa vào câu hỏi vàng: ① câu hỏi gắn trực tiếp với doanh thu (giao hàng·hoàn tiền) ② câu
  từng bị trả lời sai ③ câu thuộc diện chính sách sắp sửa đổi.
- Lấy việc chạy một lần **ngay sau khi thay đổi tri thức hàng loạt·đồng bộ danh mục sản
  phẩm·sửa persona** làm thói quen vận hành. Huy hiệu `truncated` trong kết quả nghĩa là số
  câu hỏi vượt trần thực thi nên chỉ chạy được một phần.

---

## 7. Danh sách kiểm tra vận hành

**Khi chính sách thay đổi** (ví dụ: sửa phí giao hàng)
- [ ] Sửa bản gốc trên bảng → **[Đưa vào lại]** (tài liệu đăng ký trực tiếp thì sửa tài
  liệu — tự động embedding lại) + tắt phiên bản cũ
- [ ] Kiểm tra nội dung Hội thoại mặc định (chính sách giao hàng·hủy/hoàn tiền và các kịch
  bản có sẵn khác, §4.7)
- [ ] Tìm các mục tái sử dụng câu trả lời → sửa/tắt câu trả lời cũ
- [ ] Kiểm tra 3 câu hỏi đại diện bằng bảng QA → chạy hồi quy câu hỏi vàng
- [ ] Cập nhật ngày hiệu lực·chu kỳ rà soát của tài liệu

**Thói quen hằng tuần**
- [ ] Dọn Đề xuất bổ sung tri thức·đề xuất câu trả lời (§3.4)
- [ ] Xử lý các mục chờ trong Rà soát mâu thuẫn (§3.2)
- [ ] Rà soát tài liệu có huy hiệu `stale` và huy hiệu "chưa cập nhật bản sửa" trên bảng
  (§3.3·§2.0)
- [ ] Chủ đề hay bị chuyển tiếp trong live chat → bổ sung tri thức
- [ ] Nếu vừa tạo agent AI mới, rà lại phạm vi agent của các danh mục (§3.5)

---

## 8. FAQ / Xử lý sự cố

**Q. Đã đăng ký tài liệu mà AI không biết nội dung đó.**
Kiểm tra ① có phải chỉ đăng lên bảng mà **chưa đưa vào KB** không (tài liệu bảng chưa đưa
vào thì chưa là căn cứ trả lời) ② tài liệu có đang bật (hiển thị ON) không ③ danh mục có
bị **phạm vi agent** che khỏi agent hiện tại không (§3.5 — kiểm chứng bằng cách chọn đúng
agent trong bảng QA) ④ tài liệu có xuất hiện trong danh sách nguồn của bảng QA không. Nếu
không hiện, hãy bổ sung tiêu đề·nội dung bằng từ ngữ của khách hàng. Cũng kiểm tra kết quả
đồng bộ danh mục sản phẩm có mục embedding thất bại không.

**Q. Đã chạy Nhập bằng AI mà danh sách tài liệu không có gì.**
Bản nháp của Nhập bằng AI được đăng **lên bảng**, không vào thẳng KB. Phải duyệt trên bảng
rồi **[Đưa vào KB]** thì mới xuất hiện trong danh sách tài liệu·căn cứ trả lời (§2.5).

**Q. AI cứ chuyển sang nhân viên tư vấn.**
Kiểm tra độ tin cậy·nguồn của câu hỏi đó trong bảng QA. Không có tài liệu căn cứ thì đăng
ký là lời giải; có mà độ tin cậy thấp thì tách nhỏ tài liệu và bổ sung từ ngữ.

**Q. Tin nhắn của nhân viên tư vấn bị từ chối gửi.**
Đó là kiểm duyệt chặn. Hãy đổi cách diễn đạt vướng quy tắc cấm (§4.5) rồi gửi lại. Nếu quy
tắc quá gắt, đề nghị master nới hành động (chặn→che).

**Q. Câu trả lời chỉ ra tiếng Anh.**
Ngôn ngữ trả lời theo **ngôn ngữ phiên của khách hàng**. Hãy chỉ định ngôn ngữ trong Xem
thử để kiểm tra. Viết persona bằng tiếng Hàn hay không không liên quan đến ngôn ngữ trả lời.

**Q. Đồng bộ Google Drive/Notion được 0 mục.**
Phần lớn là do chia sẻ thư mục (email tài khoản dịch vụ) hoặc kết nối integration Notion bị
đứt. Hãy làm lại từ [Kiểm tra kết nối] ở thẻ thông tin xác thực.

**Q. Áp dụng đề xuất huấn luyện xong câu trả lời trở nên kỳ lạ.**
Khôi phục bằng **[Hoàn tác]** trên thẻ đề xuất đó; cũng có thể mở phiên bản trước trong
*Lịch sử thay đổi*, nạp vào ô soạn thảo rồi lưu.

**Q. Cùng một câu hỏi mà câu trả lời mỗi lần hơi khác nhau.**
Là dao động bình thường của LLM (mức dao động xem bằng [Đo độ dao động] §6.3). Nếu khác
nhau không phải ở câu chữ mà ở **nội dung**, hãy nghi ngờ mâu thuẫn tri thức (§3.2). Lưu ý
điều chỉnh temperature không áp dụng cho công cụ Anthropic (§4.4).

---

*Tiên quyết: [Sổ tay thiết lập nhanh](quick-setup.vi.md) · tham chiếu toàn bộ màn hình:
[Sổ tay người dùng (tổng hợp)](user-manual.vi.md) · chuyên sâu cài đặt AI:
AI-SETTINGS-GUIDE · widget: hướng dẫn cài đặt widget*
