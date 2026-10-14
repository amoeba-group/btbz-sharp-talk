# PLN-261014 — Go2Joy Stage 1: kế hoạch hành động theo kịch bản và lộ trình chi tiết

| | |
|---|---|
| **Loại** | Kế hoạch điều hành (không có thay đổi giao diện — "no UI impact") |
| **Ngày lập** | 14/10/2026 (thứ Tư) |
| **Căn cứ** | Bản trả lời checklist `docs/report/RPT-261013-Go2Joy-Checklist-Response.{vi,en,ko}.md`; RPT tổng hợp `docs/implementation/RPT-261013-Go2Joy-Integration-Final.md`; PLN-261012; checklist PDF của Go2Joy (12/10/2026) |
| **Mã nguồn** | `feature/go2joy-stage1-complete` (`fb10b1d0`, trên origin, chưa merge, chưa deploy) |
| **Người quyết** | Amoeba (dev@amoeba.group) cho phần [A]; Go2Joy cho phần [G]; chung [A+G] |

## Mục lục

1. Mục đích và cách dùng tài liệu
2. Kết quả rà soát ba bản trả lời
3. Các bài toán phải giải (B1–B8)
4. Nguyên tắc điều hành
5. Kịch bản và điểm rẽ nhánh (KB-A … KB-F)
6. Lộ trình chi tiết theo giai đoạn (14/10 → 20/11)
7. Gói việc phía Amoeba (WP-01 … WP-14)
8. Tiêu chí go/no-go từng cổng
9. Nhịp làm việc, vai trò và kênh
10. Rủi ro ngoài danh sách của PDF
11. Việc làm ngay (14–15/10)
- Phụ lục A. Ma trận bài toán → kịch bản → gói việc
- Phụ lục B. Mẫu thông điệp gửi Go2Joy kèm ba bản trả lời

---

## 1. Mục đích và cách dùng tài liệu

Ba bản trả lời checklist (vi/en/ko) đã nói **"đã làm gì, còn thiếu gì"**. Tài liệu này trả lời câu tiếp theo: **"làm gì, theo thứ tự nào, nếu Go2Joy không giao đúng hạn thì rẽ đi đâu"**, với lộ trình theo ngày từ 14/10 đến hết đợt rà soát pilot (20/11).

Cách dùng:
- Mục 3 liệt kê **bài toán** (B1–B8). Mỗi bài toán có ít nhất một kịch bản (mục 5) và một gói việc (mục 7) giải nó — xem ma trận ở Phụ lục A.
- Mục 5 là phần quan trọng nhất: **mỗi mốc ngày có một câu hỏi rẽ nhánh**; trả lời "có/không" là biết đi kịch bản nào, không phải họp lại.
- Mục 6 là lịch; mục 8 là tiêu chí qua cổng; mục 11 là việc cho hôm nay và ngày mai.

---

## 2. Kết quả rà soát ba bản trả lời

Rà soát ngày 14/10 theo ba hướng độc lập: (a) đối chiếu bản tiếng Việt với mã nguồn, RPT tổng hợp, các RPT/TCR từng luồng, `CONFIG.md`, mẫu env, `sql/`, git; (b) so khớp bản tiếng Anh với bản tiếng Việt; (c) so khớp bản tiếng Hàn với hai bản còn lại. Mọi sửa đã áp vào ba tệp `.md` và dựng lại ba PDF.

### 2.1 Kết luận

- **Không có sai số liệu.** Mọi con số (4.938/4.950/9/3; 1.074 cột; 19 SQL mới; 155 kiểm thử widget; 27 ảnh; 25 chủ đề/50 bài; 30 câu hiệu chỉnh; 642/625/97,4 %; 200 nghìn hội thoại/0,5 s/0,3 s; 97/97; runbook 13 mục; sổ tay 13 chương/10 bài tập/12 câu; 685 đoạn; DPIA 9/5; ±600 s; 8 giờ; cache 30–60 s; 0,62; 180 ngày; Chrome 154; ~3 MB) đều truy được nguồn. Mọi đường dẫn tệp được trích dẫn đều tồn tại trên nhánh `feature/go2joy-stage1-complete`.
- **Ba bản song song về cấu trúc và nội dung**: 16 mục lớn, 26 mục vừa, 16 mục R, 199 dòng bảng mỗi bản; không có câu, dòng bảng hay trạng thái nào thiếu ở bản nào; các mục "giới hạn nói thẳng" (§1.4, §2.1, §12) không bị làm nhẹ ở bản dịch.
- **Chưa kiểm được**: nội dung PDF gốc của Go2Joy (ngày, hạn từng mục, danh sách sáu quyết định, bảng rủi ro) — PDF không nằm trong repo nên các trích dẫn "theo PDF" được giữ nguyên như đã viết.

### 2.2 Sai lệch đã sửa (áp cho cả ba bản trừ khi ghi khác)

| # | Vị trí | Trước | Sau | Mức |
|---|---|---|---|---|
| 1 | R5 Đầu ra | `CORS_ORIGINS` "trong `CONFIG.md`" | `CONFIG.md` không có biến này; sửa thành `docs/guide/ENV-Config-Guide.md`, `apps/api/src/main.ts`, mẫu env | Sai tham chiếu |
| 2 | R2 Đầu ra | sổ tay "chương 3–5" | "chương 1, 3, 5–6" (hàng chờ ở ch.1; Người dùng và nhãn ch.5; Chuyển cho nhân viên ch.6) | Sai số chương |
| 3 | Phase 2, §13.2 | "K2–K5 trong runbook staging" | Không có tài liệu đó; K1–K5 nằm trong `PLN-261001-Go2Joy-Guest-Login-Gate` (S3) | Tham chiếu không tồn tại |
| 4 | §2.1, Phase 2 Gate 2, R6, §13.2 | "áp 19 SQL trên staging" | 19 tệp mới, nhưng `261001-guest-login-gate.sql` đã áp staging 07/10 → **còn 18** | Thiếu chính xác |
| 5 | Phụ lục A | "19 tệp `sql/2610*.sql`" | Mẫu khớp 27 tệp (8 tệp đã có trên `main`); liệt kê rõ từ `261001-guest-login-gate.sql` đến `261019-golden-gate-columns.sql` | Mơ hồ |
| 6 | §7 | Thiếu NFR-006 | Thêm dòng NFR-006 (đa tenant 5.500, overlay ≤ 300 ms) — ngoài phạm vi Stage 1, không đo | Bỏ sót |
| 7 | R5 Trạng thái | "đóng gói Pretendard cục bộ (không phụ thuộc jsDelivr)" | Phông cục bộ chỉ bật khi đặt `WIDGET_FONT_CSS_URL` (profile Go2Joy đã đặt); mặc định hệ thống vẫn là jsDelivr | Nói quá |
| 8 | R16 Cần từ Go2Joy | "hồ sơ VN đang đặt 180 ngày" | Profile env Go2Joy đặt `CONVERSATION_LOG_RETENTION_DAYS=180` (mặc định 365); thông báo `vn_pdpl` nội suy giá trị này | Thiếu chính xác |
| 9 | §3.1 R12 | 🟡 | ✅ hợp đồng nháp · 🔴 chờ phân công (khớp §5) | Lệch bảng tóm tắt |
| 10 | §3.1 R4 | ✅ phía Amoeba · ⬜ chờ Go2Joy | ✅ loader · 🟡 chưa kiểm trên trang thật · ⬜ chờ Go2Joy (khớp §5) | Lệch bảng tóm tắt |
| 11 | §3.2 Phase 4–5, §6 Phase 5, §8.2 | Ngày PDF và ngày đề xuất lẫn nhau ("từ 26/10, đề xuất") | Ghi rõ "PDF 26/10; đề xuất 02/11", pilot "02–15/11", mở rộng "≈ 16/11" | Mâu thuẫn nội bộ |
| 12 | §4 | "RPT s4", "RPT s5b"… (mã luồng không có trong tên tệp) | Tên tệp thật: `RPT-261013-Partner-Data`, `RPT-261013-Resilience-Observability`, … | Không tra được |
| 13 | Tiêu đề "Căn cứ" | RPT tổng hợp ghi nhánh local `test/go2joy-integration`, 159 commit | Ghi chú nhánh PR 167 commit/792 tệp cùng nội dung mã; cập nhật luôn phần đầu RPT tổng hợp | Nguồn lệch |
| 14 | R6, R11 | Không dẫn nguồn "staging đã có tenant Go2Joy"; "25 chủ đề" | Dẫn K1 của PLN-261001; thêm "7 nhóm danh mục" | Bổ sung |
| 15 | §1.2 | "Tiếng Việt + tiếng Anh" (sổ tay) | "Tiếng Việt (đầy đủ) + tiếng Anh (tóm tắt)" | Nói quá |
| 16 | Bản tiếng Anh (9 chỗ) | "⬜ Go2Joy" mất chữ "chờ"; "more than one extra day"; "trust the assistant near money data"; "no actions are needed"; vài câu vụng | Khôi phục "pending"; "cannot be provided within one day"; "touch money-related data"; "no write access is needed"; thêm thuật ngữ G2J | Câu chữ |
| 17 | Bản tiếng Hàn (32 chỗ) | "처리자" dùng cho cả bên kiểm soát lẫn bên xử lý; "검열"/"모더레이션" lẫn lộn; "재알림" vs "점검"; "Decree 13/2023" để nguyên tiếng Anh; nhãn tiếng Việt thiếu chú giải; "8.2절대로"; "등급 번역" | Bên kiểm soát → "컨트롤러(관리 주체)", sổ nhà xử lý → "수탁 처리자(프로세서) 등록부"; thống nhất "모더레이션", "사람 연결", "CS / Sales Admin", "일괄 점검"; "시행령 13/2023"; thêm chú giải; "8.2절에 따름"; "직급 번역" | Thuật ngữ pháp lý, nhất quán |

### 2.3 Còn để ngỏ (không sửa trong bản trả lời)

- Bản tiếng Việt chưa có người bản ngữ bên ngoài rà; bản tiếng Hàn chưa có người bản ngữ rà (đã nêu trong §12.5 của bản trả lời).
- Các mốc và hạn "theo PDF" không kiểm được vì PDF không trong repo; nếu Go2Joy sửa PDF, cần cập nhật §3.1, §6, §9, §10.

---

## 3. Các bài toán phải giải (B1–B8)

| # | Bài toán | Vì sao khó | Hạn thực tế | Chủ thể |
|---|---|---|---|---|
| **B1** | **Gate 2 (16/10): SharpTalk chạy đúng trên trang đăng nhập staging của Hotel Admin** | Mã mới chưa merge/deploy; chưa có URL staging, CSP thật (R3–R5); kho tri thức chưa nạp lên staging (K2–K5) | 16/10 | A + G |
| **B2** | **Gate 3 (21/10): trả lời bằng dữ liệu thật cho người đã đăng nhập** | Không có đặc tả/khóa API (R8/R9) thì không thể đạt theo nghĩa đen; chữ ký identify phía Go2Joy chưa triển khai (R7) | 21/10 | G (đầu vào) · A (tích hợp) |
| **B3** | **Gate 4: UAT đủ tin cậy trong thời gian ngắn** | UAT 2 ngày; cách ly khách sạn/vai trò phải chứng minh với tài khoản thật (R1); ngưỡng cổng khách chưa đo với embedding thật | 23/10 (PDF) → đề xuất 28/10 | A + G |
| **B4** | **Pilot trên hạ tầng Go2Joy** | Gói cài đặt chưa từng `docker build`/cài Linux/`nginx -t`; chưa có máy chủ production (R6/R15) | 26/10 (PDF) → đề xuất 02/11 | G (máy chủ) · A (gói) |
| **B5** | **PDPL hợp lệ trước khi có dữ liệu nhân viên khách sạn thật** | Câu chữ pháp lý là bản nháp; bên kiểm soát, căn cứ, thời hạn lưu, chuyển dữ liệu ra nước ngoài cần luật sư Go2Joy (R16) | trước pilot | G (pháp lý) · A (kỹ thuật) |
| **B6** | **Đầu vào từ Go2Joy chưa có** (R1–R3, R8–R9, R13–R16, trục phiên bản, chủ đề chỉ-Quản-lý) | Không kiểm soát được; mọi trễ dời lịch 1:1 nếu không có đường vòng | 13–21/10 | G |
| **B7** | **Nợ kỹ thuật còn mở trước merge** | SA RBAC (menu Đơn hàng trả 403); phông Pretendard 3 MB; `AI_ALERT_EMAIL`/`ALERT_EMAIL_SUBJECT_PREFIX` cho IVY/KR/staging; 8 biến env thiếu trong mẫu self-hosted; `pilot_denied`/`consent` không đếm được | trước 15/10 (merge) | A |
| **B8** | **Chất lượng với mô hình và embedding thật** | Chưa đo P95, tỉ lệ trích dẫn, chọn công cụ tiếng Việt; NFR-001 "token đầu ≤ 2 s" không đo được vì không streaming | 21–28/10 | A |

---

## 4. Nguyên tắc điều hành

1. **Không chờ.** Mọi việc phụ thuộc Go2Joy đều có **đường vòng** đã chuẩn bị (mô phỏng, dữ liệu mẫu, staging Amoeba). Đường vòng chỉ để không đứng im; **không thay thế** việc kiểm trên hệ thống thật, và phải ghi rõ "đã kiểm trên mô phỏng" trong mọi báo cáo.
2. **Tách "kiểm chức năng" khỏi "dựng hạ tầng".** Phase 2–4 trên staging Amoeba; hạ tầng Go2Joy chỉ bắt buộc từ production.
3. **Mỗi cổng có tiêu chí đo được** (mục 8) và quyết định go/no-go ghi thành văn bản trong kênh chung, có ngày và người quyết.
4. **An toàn dữ liệu là điều kiện cứng.** Một vụ lộ chéo khách sạn/vai trò = dừng mở rộng, bất kể chỉ số khác.
5. **Mọi tính năng mới có nút tắt không cần deploy** (cờ theo tenant/agent): `guest_policy`, pilot allowlist, `PARTNER_DATA_ENABLED`, chế độ phiên bản KB, strict region. Bật theo thứ tự "ít rủi ro trước", và **chỉ bật `login_guidance` sau khi identify thật chạy**.
6. **SQL trước, mã sau.** Staging chạy `DB_SYNCHRONIZE=false`; 19 tệp SQL áp theo thứ tự trong RPT tổng hợp mục 3 trước khi deploy; kiểm bằng boot log + tuổi container + mã HTTP của route mới (401 = đã deploy, 404 = chưa, 502 = sập).
7. **Mọi báo cáo cho Go2Joy nói rõ mức kiểm**: đã kiểm thật / mô phỏng / chưa kiểm. Không để ba bản trả lời và các báo cáo sau này lệch nhau.

---

## 5. Kịch bản và điểm rẽ nhánh

### 5.1 Tổng quan kịch bản

| Mã | Kịch bản | Điều kiện kích hoạt | Hệ quả chính | Pilot khi đó |
|---|---|---|---|---|
| **KB-A** | **Đủ đầu vào đúng hạn** (chuẩn) | R1–R3, R13 trước 15/10; R7 (ký phía Go2Joy) trước 20/10; R8/R9 trước 17/10; R14–R16 trước 28/10; máy chủ production trước 30/10 | Đi đúng lộ trình mục 6 | 02/11, dữ liệu thật, trên hạ tầng Go2Joy |
| **KB-B** | **API đối tác chậm** | Không có R8/R9 trước 17/10, hoặc có nhưng lệch hợp đồng nháp nhiều | Gate 3 theo **định nghĩa mới** (SSO + phân quyền + hợp đồng API đã đối chiếu); tra cứu dữ liệu đối tác **tắt** trong pilot đợt 1; bật khi có API | 02/11, "tri thức + ngữ cảnh ký"; dữ liệu thật thêm giữa pilot |
| **KB-C** | **Không có tài khoản / staging HA** | R1–R3 trễ quá 16/10 | Gate 2 đạt trên **trang host mô phỏng có CSP nghiêm ngặt** (Gate 2a); Gate 2b lặp lại trên staging thật khi có; bản đồ vai trò lập từ buổi trình diễn | Không thay đổi nếu R1–R3 có trước 24/10; nếu không, pilot lùi 1:1 |
| **KB-D** | **Hạ tầng Go2Joy chưa sẵn** | Không có máy chủ production + người vận hành trước 30/10 | Pilot đợt 1 chạy **trên hạ tầng Amoeba** (tenant riêng, ≤ 10 khách sạn, dữ liệu tối thiểu), thông báo PDPL ghi rõ nơi lưu; chuyển sang hạ tầng Go2Joy bằng diễn tập sao lưu/khôi phục khi sẵn sàng | 02/11 trên Amoeba; chuyển máy chủ trong tuần 2 của pilot hoặc sau Gate 5 |
| **KB-E** | **PDPL chưa chốt** | Luật sư Go2Joy chưa xác nhận trước 28/10 | Pilot đợt 1 chỉ gồm **tài khoản nội bộ Go2Joy** (vai trò `internal`) và khách sạn do Go2Joy sở hữu/kiểm soát, **không** có khách sạn đối tác bên ngoài; không xuất CSV hội thoại ra ngoài Go2Joy | 02/11 "pilot nội bộ"; mở cho đối tác khi PDPL chốt |
| **KB-F** | **Xấu nhất: B + C + D** | Không API, không tài khoản thật, không hạ tầng trước 30/10 | Chuyển thành **"pilot kỹ thuật"** 1 tuần trên Amoeba với nhân viên Go2Joy; mục tiêu duy nhất: chứng minh SSO thật, cách ly, cổng khách, định tuyến với người thật; pilot đối tác lùi sang khi có đầu vào | Pilot kỹ thuật 02–06/11; pilot đối tác ≥ 16/11 |

Kịch bản **kết hợp được** (ví dụ B + D). Khi hai kịch bản cùng xảy ra, áp dụng cả hai hệ quả.

### 5.2 Điểm rẽ nhánh theo ngày

| Ngày | Câu hỏi | Có → | Không → |
|---|---|---|---|
| **15/10 (T5)** | Go2Joy đã trả lời Gate 0 (ngày cấp R1–R3, đầu mối R13)? | KB-A | Gửi nhắc có hạn 16/10; chuẩn bị KB-C (WP-04) |
| **16/10 (T6)** | Có URL staging HA + CSP đã mở (R3–R5)? | Gate 2 thật | Gate 2a trên trang mô phỏng; đặt Gate 2b ngay khi có R3 (KB-C) |
| **17/10 (T6)** | Có Swagger/Postman và khóa test (R8/R9)? | WP-07 bắt đầu, Gate 3 đủ nghĩa | KB-B: Gate 3 định nghĩa mới; `PARTNER_DATA_ENABLED=false` cho pilot |
| **20/10 (T2)** | Go2Joy đã ký identify ở máy chủ và gọi được trên staging HA (R7)? | Kiểm SSO thật 20–21/10 | Gate 3 chỉ có SSO mô phỏng; **không bật `login_guidance`**; lùi phần "SSO thật" vào tuần UAT |
| **24/10 (T6)** | Có tài khoản Quản lý (≥ 2 khách sạn) + Lễ tân thật (R1)? | Kiểm cách ly thật trong UAT | UAT chỉ với tài khoản mô phỏng → Gate 4 **có điều kiện**; pilot đợt 1 ≤ 5 khách sạn |
| **28/10 (T4)** | Luật sư Go2Joy xác nhận PDPL (R16)? Danh sách pilot (R14)? Quy trình phát hành (R15)? | Gate 4 đầy đủ | KB-E nếu thiếu R16; nếu thiếu R14 → pilot với danh sách do Go2Joy đề xuất tạm ≤ 5 |
| **30/10 (T6)** | Máy chủ production Go2Joy + người vận hành đã diễn tập cài đặt? | Pilot trên Go2Joy 02/11 | KB-D: pilot trên Amoeba |
| **13/11 (T6)** | Pilot 2 tuần đạt tiêu chí mục 8 (Gate 5)? | Mở rộng đợt 2 từ 16/11 | Kéo dài pilot 1 tuần, bổ sung tri thức theo lý do chuyển người |

### 5.3 Chi tiết từng kịch bản

#### KB-A — Đủ đầu vào đúng hạn
- Đi đúng mục 6. Điểm cần giữ: thứ tự bật tính năng trên staging — (1) deploy + SQL, (2) K2 nhóm công khai, (3) K4 URL đăng nhập/đăng ký, (4) K5 chip, (5) pilot allowlist, (6) **K3 `login_guidance` sau cùng, chỉ khi identify thật chạy**, (7) partner data `mock` → `live` khi có khóa.
- Rủi ro riêng của KB-A: chủ quan vì "mọi thứ đã có". Giữ nguyên tắc 7 (mức kiểm).

#### KB-B — API đối tác chậm
- **Trước 17/10**: gửi lại hợp đồng nháp kèm **bảng đối chiếu 1 trang** (endpoint → "có/chưa/khác") để Go2Joy điền trong 30 phút thay vì đọc OpenAPI.
- **Gate 3 định nghĩa mới**: (a) identify thật từ staging HA → phiên ký; (b) phân quyền vai trò/khách sạn chứng minh bằng tài khoản thật hoặc mô phỏng (ghi rõ); (c) Go2Joy đã đối chiếu hợp đồng và chốt ai xây (R12).
- **Pilot đợt 1**: `PARTNER_DATA_ENABLED=false`; trợ lý trả lời chính sách/giá bằng tri thức tĩnh có nhãn phiên bản; câu hỏi cần số liệu riêng của khách sạn → "xác nhận sau + chuyển người" (đã có lý do từ chối riêng). Thẻ Pilot sẽ cho thấy tỉ lệ câu hỏi này → **chính là bằng chứng** để Go2Joy ưu tiên xây API.
- **Khi có API giữa pilot**: WP-07 (adapter + `mock` → `live` trên staging, kiểm với 10 khách sạn pilot, rồi bật production). Không cần deploy lại nếu chỉ đổi cấu hình nhà cung cấp `go2joy_partner_api`.

#### KB-C — Không có tài khoản / staging HA
- **Gate 2a (16/10)**: trang host mô phỏng do Amoeba dựng, bật CSP **đúng như hướng dẫn** (không `unsafe-inline`, `frame-ancestors` đúng domain), chạy identify v2 mẫu PHP/Node, có "đổi khách sạn" và "đăng xuất". Biên bản ghi rõ "mô phỏng".
- **Gate 2b**: lặp lại trong ≤ 1 ngày khi có R3–R5. Không bỏ bước này.
- **Bản đồ vai trò**: xin **buổi trình diễn 45 phút** (chia sẻ màn hình, ghi hình nếu Go2Joy đồng ý) thay cho tài khoản; Amoeba lập bản đồ menu + phân loại nhiệm vụ trong 1 ngày sau đó.
- **UAT**: vẫn chạy với tài khoản mô phỏng nhưng Gate 4 ghi "có điều kiện"; pilot đợt 1 thu hẹp ≤ 5 khách sạn cho tới khi kiểm cách ly với tài khoản thật.

#### KB-D — Hạ tầng Go2Joy chưa sẵn
- **Điều kiện để pilot trên Amoeba**: tenant riêng cho Go2Joy; ≤ 10 khách sạn; thông báo PDPL (hồ sơ `vn_pdpl`) nêu **nơi lưu là hạ tầng Amoeba** và thời hạn; Go2Joy xác nhận bằng văn bản; không bật tra cứu dữ liệu đối tác nếu Go2Joy không đồng ý API gọi từ hạ tầng Amoeba.
- **Chuyển máy chủ**: dùng chính quy trình sao lưu mã hóa → khôi phục trong runbook; diễn tập trên staging trước; chọn khung giờ thấp điểm; sau chuyển, giữ hạ tầng Amoeba 7 ngày chỉ đọc để đối chiếu rồi xóa có nhật ký.
- Song song, **WP-08 diễn tập cài đặt** vẫn chạy để không bị dồn vào cuối.

#### KB-E — PDPL chưa chốt
- Pilot đợt 1 = "nội bộ": tài khoản `internal` của nhân viên Go2Joy + khách sạn do Go2Joy kiểm soát. Dữ liệu cá nhân phát sinh là của nhân viên Go2Joy (bên kiểm soát tự xử lý được).
- Không xuất CSV hội thoại ra khỏi hệ thống Go2Joy; chấm độ chính xác trên màn hình.
- Chuẩn bị sẵn 3 phiên bản câu chữ thông báo (theo căn cứ: hợp đồng / đồng ý / lợi ích hợp pháp) để luật sư chọn thay vì viết từ đầu (WP-10).

#### KB-F — Xấu nhất
- "Pilot kỹ thuật" 02–06/11 với 5–10 nhân viên Go2Joy: SSO thật (nếu R7 có), cách ly, cổng khách, định tuyến CS/SA, sổ tay. Mục tiêu đo: 0 vụ lộ, P95, tỉ lệ tự xử lý trên bộ câu hỏi nội bộ.
- Mỗi tuần sau đó: kiểm lại điểm rẽ 5.2; pilot đối tác bắt đầu trong vòng 5 ngày làm việc sau khi có R1 + R16 (API không bắt buộc).

---

## 6. Lộ trình chi tiết theo giai đoạn

Ký hiệu chủ thể: [A] Amoeba · [G] Go2Joy · [A+G] chung. Mỗi giai đoạn có **Mục tiêu**, **Việc**, **Đầu ra**, **Tiêu chí đạt**, **Rẽ nhánh**.

### Giai đoạn 0 — Gửi trả lời và chốt nội bộ (14/10 T4 → 15/10 T5)

**Mục tiêu.** Go2Joy nhận ba bản trả lời + yêu cầu quyết định; Amoeba dọn nợ kỹ thuật để merge.

| # | Việc | Chủ thể | Hạn | Ghi chú |
|---|---|---|---|---|
| 0.1 | Hoàn tất rà soát ba bản (mục 2), sửa, dựng lại PDF | A | 14/10 | — |
| 0.2 | Gửi Go2Joy: 3 PDF + thông điệp Phụ lục B (nêu 6 + 2 quyết định, hạn trả lời 15/10) | A | 14/10 | Kênh: email + nhóm chat nếu có |
| 0.3 | Mở PR `feature/go2joy-stage1-complete` → `main` với `PR-BODY-go2joy-stage1-complete.md` (mục Migration 19 SQL, trong đó `261001-guest-login-gate.sql` đã áp staging 07/10) | A | 14/10 | `gh` chưa cài → mở qua URL |
| 0.4 | Quyết định nợ B7: SA RBAC Đơn hàng (ẩn menu hoặc cấp quyền đọc), Pretendard (giữ với ghi chú OFL hoặc chuyển về CDN có fallback), đặt `AI_ALERT_EMAIL` + `ALERT_EMAIL_SUBJECT_PREFIX=[IVY Chat]` cho staging IVY và `CONSOLE_FRAME_ANCESTORS` cho KR | A | 15/10 | WP-05 |
| 0.5 | Bổ sung 8 biến env thiếu vào mẫu self-hosted (`env:check` sạch) | A | 15/10 | WP-05 |
| 0.6 | Chuẩn bị WP-04 trang host mô phỏng CSP nghiêm ngặt (phòng KB-C) | A | 15/10 | 0,5 ngày |

**Đầu ra.** PR mở; ba PDF đã gửi; danh sách quyết định gửi Go2Joy; staging sẵn sàng nhận deploy.
**Tiêu chí đạt.** PR không conflict, CI xanh (hoặc kết quả kiểm cục bộ đính kèm); Go2Joy xác nhận đã nhận.
**Rẽ nhánh.** 15/10 chưa có hồi âm Gate 0 → nhắc lần 2 với hạn 16/10; đi KB-C song song.

### Giai đoạn 1 — Staging và Gate 2 (15/10 T5 → 16/10 T6)

**Mục tiêu.** Mã mới chạy trên staging Amoeba với kho tri thức Go2Joy; Gate 2 (thật hoặc 2a).

| # | Việc | Chủ thể | Hạn | Ghi chú |
|---|---|---|---|---|
| 1.1 | Merge PR (squash, `--admin` nếu cần) | A | 15/10 sáng | — |
| 1.2 | **Áp 18 SQL còn lại** trên staging theo thứ tự RPT tổng hợp mục 3 (`261001-guest-login-gate.sql` đã áp 07/10); chụp `SHOW COLUMNS` cho 3 bảng mẫu | A | 15/10 | `pre-deploy-check` |
| 1.3 | Deploy staging; kiểm boot log "successfully started", tuổi container, route mới 401 | A | 15/10 | Không chạy `deploy-staging.sh` cục bộ |
| 1.4 | Cấu hình tenant Go2Joy: K2 (nhóm công khai `guest_visible`), K4 (URL đăng nhập/đăng ký UAT `go2joy-ha-uat.go2joy.io` nếu Go2Joy xác nhận), K5 (chip theo đối tượng), `hostLinkTemplate`; **K3 giữ `open`** | A | 15/10 | K1–K5 định nghĩa trong `PLN-261001-Go2Joy-Guest-Login-Gate` (S3), TCR-261006 §6 |
| 1.5 | Nhập CSV tri thức 25 chủ đề/50 bài; gắn `ui_version` theo trục tạm (ghi rõ "tạm" tới khi R10 chốt); chạy bộ golden trên staging | A | 15/10 | WP-02 |
| 1.6 | Chạy `npm run gate:calibrate` với Voyage + Qdrant thật trên staging; ghi ngưỡng đề xuất và ma trận nhầm lẫn; **chưa bật `login_guidance`** | A | 16/10 | WP-03; nếu exit 3 → embedding chưa thật, dừng và sửa cấu hình |
| 1.7 | Pilot allowlist: nhập 2–3 mã khách sạn thử; kiểm chặn ở máy chủ và ẩn/hiện widget | A | 16/10 | — |
| 1.8 | Chèn embed.js + mở CSP/CORS trên staging HA (R4/R5); cung cấp URL (R3) | G | 16/10 | Hướng dẫn CSP/CORS |
| 1.9 | **Gate 2**: kiểm widget trên trang đăng nhập staging HA (tải, ẩn/hiện, mobile, cổng khách với 4 chủ đề công khai) | A+G | 16/10 | Nếu không có 1.8 → Gate 2a trên trang mô phỏng (WP-04) |

**Đầu ra.** Staging chạy bản mới; biên bản Gate 2 (thật hoặc 2a) có ảnh chụp và mức kiểm; ngưỡng cổng khách đo thật.
**Tiêu chí đạt.** Mục 8, cổng 2.
**Rẽ nhánh.** 16/10 không có R3–R5 → KB-C. `gate:calibrate` cho ngưỡng không tách được công khai/nội bộ → giữ `open`, đưa vào rủi ro R-N3 (mục 10).

### Giai đoạn 2 — SSO thật, đối chiếu API, Gate 3 (19/10 T2 → 21/10 T4)

**Mục tiêu.** identify thật từ Hotel Admin; hợp đồng API được đối chiếu; Gate 3 theo định nghĩa phù hợp đầu vào.

| # | Việc | Chủ thể | Hạn | Ghi chú |
|---|---|---|---|---|
| 2.1 | Ký identify v2 ở máy chủ HA (mẫu PHP/Node trong SDK guide); gọi sau đăng nhập, khi đổi khách sạn; `ShopTalk.logout()` khi đăng xuất; lắng nghe `identity-expired` | G | 20/10 | Amoeba hỗ trợ 1 buổi làm việc chung |
| 2.2 | Kiểm SSO thật trên staging: đúng khách sạn/vai trò/tỉnh; đổi khách sạn → phiên mới; đăng xuất → phiên đóng; chữ ký sai bị từ chối (không ghi gì) | A | 21/10 | Có tài khoản thật thì kiểm bằng 2 khách sạn của 1 Quản lý |
| 2.3 | Đối chiếu Swagger/Postman (R8) với hợp đồng nháp; bảng "có/chưa/khác"; chốt ai xây phần thiếu (R12) | A+G | 20/10 | Nếu không có R8 → gửi bảng đối chiếu 1 trang để Go2Joy tự điền |
| 2.4 | Nếu có R9: cấu hình nhà cung cấp `go2joy_partner_api` trên staging, `PARTNER_API_MODE=live`, kiểm 4 chủ đề với 2 khách sạn thật; kiểm "khách sạn trả về ≠ khách sạn ký" bị loại | A | 21/10 | WP-07 |
| 2.5 | Lập bản đồ menu theo vai trò (từ R1) và Super Admin (từ R2 hoặc trình diễn); cập nhật phân loại nhiệm vụ 4 loại | A | 21/10 | WP-06 |
| 2.6 | Chốt trục phiên bản (R10) và danh sách chủ đề chỉ-Quản-lý; gắn `min_audience=manager` cho các nhóm đó; gắn `ui_version` đúng trục | A+G | 21/10 | — |
| 2.7 | Đo hiệu năng với mô hình thật trên staging: P50/P95 từng giai đoạn trên bộ golden; quyết định NFR-001 (định nghĩa lại hay làm streaming) | A | 21/10 | WP-11 |
| 2.8 | **Gate 3** | A+G | 21/10 | Định nghĩa đầy đủ (KB-A) hoặc định nghĩa mới (KB-B) — ghi rõ trong biên bản |

**Đầu ra.** Biên bản SSO thật; bảng đối chiếu API; bản đồ vai trò; ngưỡng/độ trễ đo thật; biên bản Gate 3.
**Tiêu chí đạt.** Mục 8, cổng 3.
**Rẽ nhánh.** 20/10 Go2Joy chưa ký identify → Gate 3 không có "SSO thật"; **tuyệt đối không bật `login_guidance`**; đưa 2.1–2.2 sang tuần UAT.

### Giai đoạn 3 — UAT mở rộng và Gate 4 (22/10 T5 → 28/10 T4)

**Mục tiêu.** Chứng minh cách ly, chất lượng, vận hành với người thật của Go2Joy; chốt R14–R16.

| # | Việc | Chủ thể | Hạn | Ghi chú |
|---|---|---|---|---|
| 3.1 | Gửi bộ UAT: 12 kịch bản theo vai trò (Quản lý 2 khách sạn, Lễ tân, khách chưa đăng nhập, CS, SA), bảng chấm, cách xuất CSV | A | 22/10 | WP-09; dựa trên sổ tay + 10 bài tập |
| 3.2 | UAT đội vận hành Go2Joy (CS/SA): nhận việc, "Trực", định tuyến vùng, "chưa ai nhận", chuyển đội, ngoài giờ | G | 22–24/10 | Amoeba trực kênh, sửa lỗi trong ngày |
| 3.3 | UAT khách sạn thật (nếu R1): cách ly 2 khách sạn; Lễ tân hỏi chủ đề Quản lý; máy quầy dùng chung (đăng xuất, đồng ý lại) | A+G | 24/10 | Không có R1 → mô phỏng, ghi "có điều kiện" |
| 3.4 | Chấm độ chính xác trên CSV đã che dữ liệu (≥ 100 hội thoại UAT); liệt kê khoảng trống tri thức; bổ sung đợt 1 | A+G | 27/10 | Vòng phản hồi tri thức |
| 3.5 | Chạy lại `gate:calibrate` sau khi tri thức đổi; nếu ngưỡng tách tốt → bật `login_guidance` trên **staging** cho agent Hotel Partner, kiểm 1 ngày | A | 27/10 | K3 chỉ trên staging |
| 3.6 | Họp luật sư Go2Joy: chọn căn cứ pháp lý, thời hạn lưu, bên kiểm soát, DPO; cập nhật `vn_pdpl` vi/en; người bản ngữ rà bản vi | G (+A) | 28/10 | WP-10; 3 phương án câu chữ gửi trước |
| 3.7 | Chốt danh sách pilot đợt 1 (10–20 khách sạn, trộn Bắc/Nam, có Quản lý đa chi nhánh) + liên hệ từng khách sạn; nhập allowlist (CSV) | G (+A) | 28/10 | R14 |
| 3.8 | Điền quy trình phát hành/sự cố: phê duyệt, khung giờ, tiêu chí rollback, liên hệ | G | 28/10 | R15, mẫu trong runbook/INCIDENT-RESPONSE |
| 3.9 | Diễn tập cài đặt gói production trên Linux cùng người vận hành Go2Joy (`docker build`, bundle + checksum, cài, `nginx -t`, sao lưu/khôi phục, rollback theo thẻ image) | A+G | 28/10 | WP-08; làm trước trên máy Amoeba 24/10 |
| 3.10 | **Gate 4**: duyệt UAT + duyệt phát hành production | A+G | 28/10 | — |

**Đầu ra.** Báo cáo UAT (lỗi, đã sửa, còn mở, mức kiểm); PDPL chốt; allowlist; quy trình phát hành; biên bản diễn tập cài đặt; biên bản Gate 4.
**Tiêu chí đạt.** Mục 8, cổng 4.
**Rẽ nhánh.** Thiếu R16 → KB-E; thiếu máy chủ → KB-D; thiếu R1 → Gate 4 có điều kiện, pilot ≤ 5 khách sạn.

### Giai đoạn 4 — Sẵn sàng production (29/10 T5 → 01/11 CN)

**Mục tiêu.** Hệ thống production (Go2Joy hoặc Amoeba theo kịch bản) sẵn sàng, có giám sát và người trực.

| # | Việc | Chủ thể | Hạn | Ghi chú |
|---|---|---|---|---|
| 4.1 | Cài production theo runbook; áp SQL; deploy; kiểm khói; `/metrics` có token; readiness xanh | G (+A) | 30/10 | KB-D → Amoeba làm trên hạ tầng Amoeba |
| 4.2 | Cấu hình cảnh báo: webhook/email thật của Go2Joy (`OPS_ALERT_*`, `ERROR_WEBHOOK_URL`), thử 1 cảnh báo giả | A+G | 30/10 | Chưa từng kiểm Slack/SMTP thật → làm ở đây |
| 4.3 | Nạp tri thức production (xuất từ staging sau UAT, có `ui_version`); K2/K4/K5; pilot allowlist đợt 1; **K3 theo kết quả 3.5**; partner data theo KB-A/B | A | 31/10 | — |
| 4.4 | Chèn embed.js production HA (chỉ tải cho khách sạn pilot nếu Go2Joy muốn thêm lớp) + CSP production | G | 31/10 | — |
| 4.5 | Sao lưu đầy đủ trước pilot; kiểm khôi phục vào máy tạm | G (+A) | 31/10 | — |
| 4.6 | Lịch trực tuần 1: Amoeba + CS/SA Go2Joy; kênh sự cố; mẫu báo cáo ngày | A+G | 31/10 | WP-12 |
| 4.7 | **Go/no-go pilot** (họp 30 phút, biên bản) | A+G | 31/10 | — |

**Tiêu chí đạt.** Mục 8, "Go pilot".

### Giai đoạn 5 — Pilot 2 tuần (02/11 T2 → 13/11 T6)

**Mục tiêu.** Vận hành thật với khách sạn pilot; đo; bổ sung tri thức theo dữ liệu; không có vụ lộ nào.

| Nhịp | Việc | Chủ thể |
|---|---|---|
| Hằng ngày (15') | Xem thẻ Pilot: số hội thoại, tự xử lý, chuyển người theo lý do, khách sạn im lặng, P95, cảnh báo; ghi 3 dòng vào kênh chung | A+G |
| Hằng ngày | CS/SA xử lý hàng chờ; ghi "cách đã xử lý" để hệ thống đề xuất tri thức | G |
| 2 lần/tuần | Duyệt đề xuất bổ sung tri thức; cập nhật KB (có `ui_version`); chạy golden | A (+G duyệt nội dung) |
| Tuần 1 (02–06/11) | Chỉ 50 % danh sách pilot (ưu tiên khách sạn có liên hệ tốt); kiểm 0 vụ lộ bằng CSV chấm tay 50 hội thoại/ngày | A+G |
| Tuần 2 (09–13/11) | Toàn bộ danh sách pilot; nếu KB-B có API giữa chừng → bật `live` cho 3 khách sạn trước, rồi toàn pilot | A+G |
| 13/11 | Báo cáo pilot: chỉ số 11.3 của bản trả lời, danh sách lỗi, khoảng trống tri thức, chi phí mô hình; khuyến nghị Gate 5 | A |

**Rẽ nhánh.** Bất kỳ vụ lộ nào → tắt widget cho khách sạn liên quan (allowlist), điều tra trong 24 h, báo cáo, chỉ bật lại sau sửa có kiểm thử đột biến.

### Giai đoạn 6 — Rà soát pilot và mở rộng (16/11 T2 → 20/11 T6)

| # | Việc | Chủ thể |
|---|---|---|
| 6.1 | Họp Gate 5: đối chiếu tiêu chí 11.4 (0 vụ lộ; tự xử lý đúng ≥ ngưỡng; im lặng ≤ ngưỡng; không sự cố nghiêm trọng mở) | A+G |
| 6.2 | Kế hoạch mở rộng đợt 2: số khách sạn, vùng, thứ tự; cập nhật allowlist theo đợt; quy tắc dừng | A+G |
| 6.3 | Chuyển hạ tầng nếu đang ở KB-D | A+G |
| 6.4 | Khởi động chuẩn bị Stage 2 (khách đặt phòng và lễ tân theo khách sạn): REQ mới, tái dùng danh tính/cách ly/bậc quyền | A |
| 6.5 | RPT tổng kết Stage 1 (deploy state, PR, SHA, migration theo env) — chống làm lại | A |

---

## 7. Gói việc phía Amoeba

Ước lượng là ngày-người; "khi có" nghĩa là phụ thuộc đầu vào Go2Joy.

| Mã | Gói việc | Giải bài toán | Phụ thuộc | Ước lượng | Hạn mục tiêu |
|---|---|---|---|---|---|
| WP-01 | Merge PR; áp 18 SQL còn lại trên staging; deploy; kiểm khói | B1 | 0.4 (nợ B7) | 0,5 | 15/10 |
| WP-02 | Cấu hình tenant Go2Joy trên staging: K2/K4/K5, `hostLinkTemplate`, nhập CSV tri thức, `ui_version` tạm, golden | B1 | WP-01 | 0,5 | 15/10 |
| WP-03 | `gate:calibrate` với Voyage + Qdrant thật; chọn ngưỡng; ma trận nhầm lẫn; tái chạy sau khi tri thức đổi | B3, B8 | WP-01 | 0,5 + 0,25 | 16/10, 27/10 |
| WP-04 | Trang host mô phỏng với CSP nghiêm ngặt + identify mẫu, đổi khách sạn, đăng xuất (phòng KB-C; cũng dùng làm demo cho Go2Joy) | B1, B6 | — | 0,5 | 15/10 |
| WP-05 | Đóng nợ B7: SA RBAC Đơn hàng; Pretendard; `AI_ALERT_EMAIL`/`ALERT_EMAIL_SUBJECT_PREFIX`/`CONSOLE_FRAME_ANCESTORS` theo profile; 8 biến env self-hosted; đếm `pilot_denied`/`consent` (ghi lý do vào bảng từ chối) | B7 | — | 1–1,5 | 15/10 (trước merge, trừ đếm lý do có thể sau) |
| WP-06 | Bản đồ menu theo vai trò + Super Admin; phân loại nhiệm vụ 4 loại; cập nhật KB và `min_audience` | B3, B6 | R1/R2 hoặc trình diễn | 1 | +1 ngày sau đầu vào |
| WP-07 | Partner API thật: đối chiếu hợp đồng ↔ Swagger; adapter ánh xạ trường; `mock` → `live` staging; kiểm 4 chủ đề × 2 khách sạn; kiểm loại bỏ sai khách sạn; so tra cứu trước vs tool-calling với mô hình thật | B2, B8 | R8/R9 | 2–3 | +3 ngày sau đầu vào |
| WP-08 | Diễn tập cài đặt: `docker build` cả 3 image, `build-release-bundle`, cài trên VM Linux sạch, `nginx -t`, sao lưu mã hóa → khôi phục, rollback theo thẻ; sửa lỗi phát hiện | B4 | — | 1,5–2 | 24/10 (Amoeba), 28/10 (cùng Go2Joy) |
| WP-09 | Bộ UAT: 12 kịch bản theo vai trò, bảng chấm, hướng dẫn xuất CSV, tiêu chí lỗi mức nghiêm trọng | B3 | — | 0,5 | 22/10 |
| WP-10 | PDPL: 3 phương án câu chữ theo căn cứ pháp lý; danh sách câu hỏi cho luật sư; cập nhật `vn_pdpl` sau họp; người bản ngữ rà vi; trạng thái DPA Anthropic/Voyage | B5 | R16 | 0,5 + 0,5 sau họp | 24/10, 28/10 |
| WP-11 | NFR-001: đo P50/P95 thật; đề xuất định nghĩa "thời gian đến phản hồi đầu tiên" (hiển thị "đang soạn…" + kiểm duyệt trước khi xuất) hoặc ước lượng streaming có kiểm duyệt từng đoạn | B8 | WP-01, mô hình thật | 0,5 (phân tích); 3–5 nếu làm streaming | 21/10 quyết định |
| WP-12 | Vận hành pilot: mẫu báo cáo ngày (3 dòng), lịch trực, quy trình "vụ lộ" (tắt allowlist → điều tra → báo cáo), mẫu báo cáo tuần/pilot | B3, B4 | — | 0,5 | 31/10 |
| WP-13 | Mở rộng nội dung công khai (FAQ cách dùng) theo quyết định 5 của Go2Joy, chỉ sau WP-03 cho ngưỡng tốt; thêm nhóm công khai từng bước | B3 | Quyết định 5, WP-03 | 0,5/đợt | trong pilot |
| WP-14 | Chuyển hạ tầng Amoeba → Go2Joy (chỉ KB-D): diễn tập trên staging, cửa sổ chuyển, đối chiếu, xóa có nhật ký | B4 | KB-D | 1 | tuần 2 pilot hoặc sau Gate 5 |

Tổng phía Amoeba (không tính WP-11 streaming, WP-14): **≈ 10–13 ngày-người** trải trên 14/10–31/10, trong đó khoảng 4 ngày phụ thuộc đầu vào Go2Joy.

---

## 8. Tiêu chí go/no-go từng cổng

| Cổng | Ngày | Tiêu chí cứng (tất cả phải đạt) | Tiêu chí mềm (ghi nhận, không chặn) |
|---|---|---|---|
| **Gate 1** | 14/10 | Go2Joy xác nhận đã nhận 3 bản; trả lời 6 + 2 quyết định hoặc hẹn ngày trả lời ≤ 16/10; có đầu mối R13 | Hợp đồng API được xem |
| **Gate 2** | 16/10 | Staging chạy bản mới (boot log, 401 route mới); 19 SQL áp xong; widget tải trên trang đăng nhập staging HA **hoặc** trang mô phỏng CSP nghiêm ngặt (ghi rõ 2a); 4 chủ đề công khai trả lời đúng; mobile hiển thị | `gate:calibrate` có ngưỡng; theme màu Go2Joy |
| **Gate 3** | 21/10 | identify thật từ HA tạo phiên đúng khách sạn/vai trò (hoặc ghi "mô phỏng" nếu R7 chưa có); đổi khách sạn → phiên mới; chữ ký sai bị từ chối; **KB-A**: 4 chủ đề tra cứu trả lời bằng dữ liệu thật cho 2 khách sạn, sai khách sạn bị loại; **KB-B**: hợp đồng API đã đối chiếu và chốt ai xây | P95 đo thật; bản đồ vai trò |
| **Gate 4** | 28/10 | 0 vụ lộ trong UAT; lỗi mức nghiêm trọng = 0 mở; tài khoản thật đã kiểm cách ly (nếu không → "có điều kiện", pilot ≤ 5); R14 danh sách; R15 quy trình; R16 chốt hoặc KB-E; diễn tập cài đặt thành công (hoặc KB-D) | Độ chính xác chấm tay trên mẫu; CSAT UAT |
| **Go pilot** | 31/10 | Production cài xong, readiness xanh, cảnh báo thật đã thử, sao lưu + khôi phục thử thành công, allowlist đợt 1 nhập, lịch trực, kênh sự cố | — |
| **Gate 5** | 13–16/11 | 0 vụ lộ 2 tuần; tự xử lý đúng ≥ ngưỡng thống nhất ở Gate 4; khách sạn im lặng ≤ ngưỡng; không sự cố nghiêm trọng mở; chi phí mô hình trong dự toán | Xu hướng giảm "độ tin cậy thấp"; CSAT |

---

## 9. Nhịp làm việc, vai trò và kênh

| Việc | Amoeba | Go2Joy PM | Go2Joy kỹ thuật | Go2Joy vận hành (CS/SA) | Luật sư Go2Joy |
|---|---|---|---|---|---|
| Quyết định 6 + 2 ở kickoff | Đề xuất | **Quyết** | Tham vấn | Tham vấn (chủ đề chỉ-Quản-lý) | — |
| Ký identify, embed, CSP (R4/R5/R7) | Hỗ trợ, kiểm | Theo dõi | **Làm** | — | — |
| API (R8/R9/R12) | Hợp đồng, adapter | Phân công | **Cung cấp/xây** | — | — |
| Tri thức (R11) + chấm độ chính xác | Nhập, cấu trúc | — | — | **Cung cấp FAQ, chấm** | — |
| PDPL (R16) | Kỹ thuật, 3 phương án | Điều phối | — | — | **Chốt** |
| Pilot allowlist, quy trình phát hành (R14/R15) | Mẫu | **Quyết** | Điền kỹ thuật | Liên hệ khách sạn | — |
| Go/no-go các cổng | Đề xuất + biên bản | **Quyết** cùng Amoeba | — | — | — |

Nhịp: **kiểm tra hằng ngày 15 phút** (kênh chat, 1 người mỗi bên, 3 câu: hôm qua / hôm nay / vướng); **họp cổng** 30 phút vào ngày cổng; mọi quyết định ghi thành 1 dòng trong kênh (ngày, ai, gì).

---

## 10. Rủi ro ngoài danh sách của PDF

| Mã | Rủi ro | Dấu hiệu sớm | Biện pháp |
|---|---|---|---|
| R-N1 | Go2Joy triển khai identify sai (ký phía trình duyệt, lộ khóa) | Yêu cầu "cho khóa để front-end ký" | Từ chối; hướng dẫn ký phía máy chủ; kiểm bằng cách gửi chữ ký giả phải bị từ chối |
| R-N2 | Bật `login_guidance` khi identify chưa chạy → **mọi đối tác bị chặn** | Hỏi "sao đối tác không được trả lời" | K3 là bước cuối; chỉ bật sau 2.2 đạt; nút tắt về `open` không cần deploy |
| R-N3 | Ngưỡng cổng khách không tách được chủ đề với embedding thật | `gate:calibrate` cho F1 thấp, ma trận nhầm lẫn xấu | Giữ `open`; chỉ mở 4 chủ đề công khai; cân nhắc bộ phân loại theo nhóm thay cho ngưỡng độ tin cậy (việc Stage 1.5) |
| R-N4 | Chi phí mô hình vượt dự toán khi pilot | Thẻ Pilot: số lượt × token/lượt | Hạn mức theo tenant; cảnh báo tín dụng AI đã có; trả lời tái dùng |
| R-N5 | Tri thức lệch phiên bản HA đang chạy (R10 chốt muộn) | Nhân viên "không thấy nút" | `ui_version` + chế độ "thêm lưu ý"; chốt trục ở 2.6 |
| R-N6 | Sổ tay vi chưa người bản ngữ rà → thuật ngữ lệch với CS | CS hỏi lại thuật ngữ trong UAT | Gộp rà soát vào UAT 3.2; sửa cùng ngày |
| R-N7 | Chuyển hạ tầng giữa pilot (KB-D) gây mất dữ liệu/ngừng dịch vụ | — | Diễn tập trên staging; cửa sổ thấp điểm; giữ bản cũ 7 ngày chỉ đọc |
| R-N8 | Dồn việc vào 27–31/10 (UAT + PDPL + cài đặt + allowlist) | — | WP-08 làm trước 24/10 trên máy Amoeba; WP-10 gửi 3 phương án trước 24/10; 3.7 bắt đầu từ 22/10 |
| R-N9 | `tools` mode bật nhầm trên production | Cấu hình engine có `tools` | Mặc định tắt; chỉ bật sau so sánh ở WP-07; ghi trong runbook |

---

## 11. Việc làm ngay (14–15/10)

**Hôm nay 14/10 (Amoeba)**
1. Hoàn tất rà soát ba bản (mục 2), sửa, dựng lại PDF, gửi Go2Joy kèm thông điệp Phụ lục B.
2. Mở PR `feature/go2joy-stage1-complete` → `main` (URL GitHub; thân PR từ `PR-BODY-go2joy-stage1-complete.md`).
3. Quyết 3 điểm nợ: SA RBAC Đơn hàng, Pretendard, email cảnh báo theo profile (WP-05).

**Ngày mai 15/10 (Amoeba)**
4. Merge; áp 18 SQL còn lại trên staging; deploy; kiểm khói (WP-01).
5. K2/K4/K5 + CSV tri thức + golden trên staging (WP-02); K3 giữ `open`.
6. Dựng trang host mô phỏng CSP nghiêm ngặt (WP-04) để sẵn sàng Gate 2a.
7. Bắt đầu `gate:calibrate` với embedding thật (WP-03) — xong 16/10 sáng.

**Chờ từ Go2Joy (hạn 15–16/10)**
- Trả lời Gate 0 và 6 + 2 quyết định; đầu mối (R13).
- R3–R5 để Gate 2 thật; nếu không kịp, xác nhận chấp nhận Gate 2a + hẹn Gate 2b.
- Lịch trình diễn Super Admin (R2) nếu không cấp tài khoản.

---

## Phụ lục A. Ma trận bài toán → kịch bản → gói việc

| Bài toán | Kịch bản liên quan | Gói việc | Cổng kiểm |
|---|---|---|---|
| B1 Gate 2 staging | KB-A, KB-C | WP-01, WP-02, WP-04 | Gate 2 |
| B2 Gate 3 dữ liệu thật | KB-A, KB-B | WP-07 | Gate 3 |
| B3 UAT tin cậy | KB-C, KB-E | WP-03, WP-06, WP-09, WP-12, WP-13 | Gate 4 |
| B4 Hạ tầng Go2Joy | KB-D | WP-08, WP-14 | Go pilot |
| B5 PDPL | KB-E | WP-10 | Gate 4 |
| B6 Đầu vào Go2Joy | KB-B, KB-C, KB-F | WP-04, WP-06 | Gate 1–4 |
| B7 Nợ kỹ thuật | — | WP-05 | trước merge |
| B8 Chất lượng thật | KB-A, KB-B | WP-03, WP-07, WP-11 | Gate 3–4 |

## Phụ lục B. Mẫu thông điệp gửi Go2Joy kèm ba bản trả lời

> Kính gửi anh/chị [đầu mối Go2Joy],
>
> Amoeba gửi bản trả lời chi tiết cho *Checklist tích hợp và lịch trình (12/10)* bằng ba ngôn ngữ (tiếng Việt, tiếng Anh, tiếng Hàn — nội dung giống nhau). Tóm tắt:
> - Phần việc của Amoeba đã xong ở mức mã nguồn và kiểm chứng ở môi trường Amoeba; staging sẽ có bản mới vào 15/10.
> - Để đạt Gate 2 (16/10) và Gate 3 (21/10), Amoeba cần từ Go2Joy theo thứ tự ảnh hưởng: (1) URL staging Hotel Admin + chèn embed.js + mở CSP/CORS (R3–R5); (2) đặc tả và khóa API (R8/R9); (3) tài khoản Quản lý (≥ 2 khách sạn) và Lễ tân (R1); (4) triển khai ký identify ở máy chủ (R7, Amoeba hỗ trợ một buổi chung).
> - Amoeba đề nghị Go2Joy chốt 6 quyết định ở mục 10 của tài liệu và 2 quyết định phát sinh (trục phiên bản Hotel Admin; danh sách chủ đề chỉ dành cho Quản lý) **trước 16/10**.
> - Amoeba đề xuất Gate 4 vào 28/10 và pilot từ 02/11 (mục 8.2); nếu Go2Joy giữ lịch cũ, Amoeba sẽ đi theo kịch bản thu hẹp (pilot ≤ 5 khách sạn) và nêu rõ điều kiện.
>
> Amoeba có thể trình diễn bản staging cho đội Go2Joy vào 16/10 hoặc 17/10, 45 phút. Mong nhận phản hồi về đầu mối và ngày cấp các mục trên trước 15/10 để giữ lịch Gate 2.
