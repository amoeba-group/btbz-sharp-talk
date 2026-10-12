# RPT-260916 — Go2Joy QW1: sửa nhận diện tiếng Việt + bộ KB chính sách Hotel Admin + việc còn chờ trên console

- Căn cứ: `docs/analysis/AN-260916-Go2Joy-Partnership-Fit-QuickWins.md` §5 QW1 (người dùng chỉ đạo "Làm QW1, bắt đầu từ sửa lỗi tiếng Việt", 2026-09-16).
- Phạm vi QW1: (1) sửa lỗi VI→ES · (2) dọn kịch bản/seed thương mại điện tử khỏi tenant go2joy · (3) nạp KB chính sách lấy từ Hotel Admin + 2 khoảng trống KB.
- Trạng thái: **(1) xong, chờ PR/merge · (3) file nhập đã soạn và kiểm tra, chờ nhập · (2) chờ thao tác console** (§4).

## 1. (1) Sửa nhận diện tiếng Việt — xong

| Mục | Giá trị |
|---|---|
| FIX doc | `docs/bug-fix/FIX-260916-Vietnamese-Detected-As-Spanish.md` |
| Nhánh / commit | `feature/fix-vi-language-detection` · `7522ad8` (từ `origin/main eebe9e7`) |
| PR | **chưa mở** — máy thực hiện không có `gh`; link tạo PR: `https://github.com/amoeba-group/btbz-sharp-talk/pull/new/feature/fix-vi-language-detection`, nội dung PR đã soạn (gửi kèm phiên làm việc) |
| Thay đổi | `global/util/detect-language.util.ts` (lớp VIETNAMESE_ONLY trước ES; tách SPANISH_ONLY/ACUTE; VIETNAMESE_SHARED + tham số `bias`), `chat/chat.service.ts` (truyền `session.language` vào 2 lời gọi), 2 spec |
| Test | spec đích 54/54 · `tsc --noEmit` pass · toàn bộ jest apps/api trên Windows 1890/1893 (3 fail là spec phụ thuộc dấu `\` đường dẫn và CRLF: heic-conversion, embed-loader, board-attachment — không liên quan; CI Linux xác nhận) |
| Migration | không |
| Deploy | staging: chưa (sau merge). Kiểm chứng: widget go2joy `?locale=en` + 2 câu Việt → `sessions.language = VI` |

## 2. (3) Bộ KB chính sách Hotel Admin — file nhập đã soạn

| Mục | Giá trị |
|---|---|
| File nhập | `reference/go2joy-ha-policies-kb-260916.csv` — **42 dòng = 21 chủ đề × VI/EN**, cột `category,title,content,external_key,source_url` (đúng khuôn `bulk-export`/`bulk-import`; upsert theo `external_key` nên nhập lại không tạo trùng) |
| Sinh file | `scripts/go2joy/build-ha-policies-kb.py` (nguồn sự thật nằm trong script; sửa nội dung → chạy lại) |
| Kiểm tra | chạy `parseCsvRecords` của repo trên file: 42 bản ghi, 42 external_key duy nhất, không thiếu cột bắt buộc, giới hạn độ dài đạt, xuống dòng trong `content` giữ nguyên |
| Nguồn sự thật | Hotel Admin UAT v23.3.0 (màn hình, chuỗi i18n, 4 thông báo "Tin nhắn từ G2J" đọc 16/09/2026). Mỗi tài liệu ghi dòng "Nguồn: …" để RAG trích dẫn và để rà lại khi HA đổi phiên bản (FR-010) |

Danh mục (category) và chủ đề:

| Category | external_key | Chủ đề |
|---|---|---|
| HA · Đối soát & thanh toán | POL-01…05 | lịch & hạn đối soát (thứ Tư 16:30 → thứ Năm 17:00) · quy trình hoàn tất & 2(+1) loại khiếu nại · công thức công nợ/hoa hồng/GTGT 5%/TNCN 2%/phí dịch vụ · nhận file qua email công nợ (3 bước) · đổi tài khoản ngân hàng |
| HA · Đặt phòng: hủy & no-show | POL-06…10 | trạng thái & 3 loại đặt phòng · hủy (lý do bắt buộc, yêu cầu hủy, F+10) · no-show 4 kết quả · xác nhận nhận phòng & kênh thông báo (bỏ SMS 02/2024) · chính sách hủy tự thiết lập (mặc định 1h/2h/12h) |
| HA · Loại phòng & giá | POL-11…13, 21 | **tạo loại phòng lần đầu (khoảng trống KB §6-① RPT-260829)** · tồn phòng/khóa nhanh/khóa phòng · Flash Sale/Giảm giá trực tiếp/Phụ thu (NĐ 81/2018 ≤50%) · sản phẩm đi kèm |
| HA · Khuyến mãi & chiến dịch | POL-14…16 | coupon Go2Joy vs Hotel CRM (tài trợ %) · chiến dịch push (AI chọn đối tượng, bản thử) · tem |
| HA · Tài khoản & nhân viên | POL-17, 18 | nhân viên & ma trận phân quyền (Quản lý/Lễ tân) · Chat với khách (đăng ký, tạm dừng, vi phạm) |
| HA · Liên hệ & thông báo Go2Joy | POL-19, 20 | hotline/email/Tin nhắn từ G2J · tóm tắt thông báo 2024–2026 (đối soát 2T8 làm lại, F+10…) |

Hai khoảng trống KB của RPT-260829 §6: ① *đăng ký phòng & giá lần đầu* → POL-11 (đầy đủ theo form Tạo loại phòng); ② *lịch/chính sách đối soát* → POL-01 + POL-03. Điều **không** có trong nguồn nên không viết: danh mục 11 lý do hủy phòng (HA chỉ lộ cấu trúc, không lộ danh sách), chính sách tỉ lệ hủy/khiếu nại 12/11/2024 (thông báo chỉ dẫn link ngoài).

## 3. Hướng dẫn nhập KB (console tenant go2joy, người có tài khoản)

1. Knowledge → tab "지식베이스문서" → **Nhập hàng loạt (일괄등록)** → chọn `reference/go2joy-ha-policies-kb-260916.csv` → xem trước → nhập. Kỳ vọng: 42 created (lần đầu) hoặc updated (lần sau).
2. Nhúng (embedding) chạy theo lô sau nhập — kiểm tra cột trạng thái chuyển `embedded`; nếu `pending` kéo dài, chạy lại "재색인".
3. **Phân loại → scope agent (P0, cùng bài học RPT-260829 §4.3)**: 6 category mới mặc định `agents: []` = mọi trợ lý thấy. Gán: 5 category HA → agent **10 (Hotel Partner/Joydesk)** + **9 (Admin Staff)**; "HA · Liên hệ & thông báo Go2Joy" → 9, 10 (+11 Ads Partner nếu muốn). Không gán cho 8 (Landing Guest).
4. Thử 5 câu trong widget (agent hotel-partner, locale vi): "Hạn hoàn tất đối soát là khi nào?" · "Khách không đến thì báo thế nào?" · "Tạo loại phòng mới cần nhập gì?" · "Sao đối soát kỳ 2 tháng 8 của tôi bị đổi?" · "Số hotline Go2Joy?" — mỗi câu phải trích dẫn 1 tài liệu POL-xx.

## 4. (2) Dọn kịch bản/seed thương mại điện tử — chờ console

Điều tra mã: seed KB "Mỹ phẩm Mỹ" chỉ chạy cho **tenant seed (ivyusa)** (`seed.runner.ts`), không tự vào go2joy. Phần "37% câu test e-commerce" trong lưu lượng đến từ **nút kịch bản mặc định** (`DEFAULT_SCENARIO_BUTTONS`: Tình trạng giao hàng · Hủy/Hoàn tiền · Hỗ trợ sản phẩm · Liên hệ hỗ trợ · …) được widget hiển thị khi tenant chưa lưu `scenario_buttons` riêng, và kịch bản trả lời `scenario-scripts.ts` (đơn hàng, vận chuyển, trả hàng).

Việc cần làm trên console go2joy (AI 설정 → 시나리오, cần đăng nhập — tôi không được nhập mật khẩu thay; nếu bạn đăng nhập trong browser pane tôi thao tác tiếp):
1. Với **agent 10 Hotel Partner**: tắt 4 nút mặc định; tạo nút kịch bản mới (nhãn VI/EN/KO), action `message` với câu mở đầu tương ứng:
   - "Đối soát & thanh toán" / "Reconciliation & payment" / "정산·지급" → "Tôi cần hỏi về kỳ đối soát và thanh toán công nợ."
   - "Hủy phòng / Khách không đến" / "Cancel / No-show" / "취소·노쇼" → "Tôi cần hướng dẫn hủy đặt phòng hoặc báo khách không đến."
   - "Loại phòng & giá" / "Room types & rates" / "객실·요금" → "Tôi cần hướng dẫn tạo loại phòng, giá, Flash Sale hoặc khóa phòng."
   - "Khuyến mãi & chiến dịch" / "Promotions & campaigns" / "프로모션·캠페인" → "Tôi muốn hỏi về coupon, Hotel CRM hoặc chiến dịch quảng cáo."
   - "Gặp nhân viên Go2Joy" / "Talk to Go2Joy staff" / "고투조이 담당자 연결" → action `contact_support` (giữ).
2. Với **agent 8 Landing Guest** (khách): tắt "Tình trạng giao hàng"/"Hỗ trợ sản phẩm"; giữ "Hủy / Hoàn tiền" nhưng sửa lời đáp kịch bản `cancel_refund` theo chính sách hủy Go2Joy (POL-07/10) trong ScenarioReplyEditor; thêm "Giờ nhận/trả phòng" (action `message`).
3. Kiểm tra `kb_documents` tenant 4 không còn tài liệu category `policy/warranty/faq/product` gốc e-commerce (nếu có do tạo tenant sớm → ẩn/xóa).
4. Xóa bản ghi `answer_reuse` sinh từ câu test e-commerce nếu có (Knowledge → 답변 재사용).

## 5. Việc tiếp theo
- Bạn mở PR từ link §1 (dán nội dung PR đã gửi) → CI → `gh pr merge --squash --admin` → deploy staging → kiểm chứng VI (§1).
- Nhánh thứ hai `feature/go2joy-qw1-kb-policies` (CSV + script + RPT này) mở PR riêng — không đụng mã chạy.
- Sau nhập KB và scope agent: chạy lại 20 câu mô phỏng của RPT-260829 §4 + 5 câu §3 → ghi kết quả vào RPT này (mục "Kết quả nhập").
- QW2 (nhúng Joydesk vào HA UAT) cần Go2Joy thêm 1 script tag và ta thêm origin `go2joy-ha-uat.go2joy.io` vào embed allow-list của tenant — REQ/PLN riêng.
