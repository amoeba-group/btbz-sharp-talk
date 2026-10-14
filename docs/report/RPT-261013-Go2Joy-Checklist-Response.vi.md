# Phản hồi Checklist tích hợp Go2Joy × SharpTalk (Stage 1)

| | |
|---|---|
| **Văn bản được phản hồi** | *Go2Joy × SharpTalk 연동 체크리스트 및 일정표 · Integration Checklist & Schedule* (12/10/2026, @김익용), 11 trang |
| **Người lập** | Amoeba (SharpTalk) |
| **Ngày lập** | 13/10/2026 |
| **Căn cứ** | Nhánh mã nguồn `feature/go2joy-stage1-complete` (`fb10b1d0`, đã có trên origin, 167 commit / 792 tệp so với `main`, **chưa merge vào `main`, chưa deploy staging hay production**); báo cáo `docs/implementation/RPT-261013-Go2Joy-Integration-Final.md` (viết trên nhánh tích hợp local `test/go2joy-integration`, cùng nội dung mã) |
| **Bản đi kèm** | Bản tiếng Anh: `RPT-261013-Go2Joy-Checklist-Response.en.md` · Bản tiếng Hàn: `RPT-261013-Go2Joy-Checklist-Response.ko.md` |

## Mục lục

1. Tóm tắt điều hành
2. Cách đọc tài liệu
3. Bảng tổng quan
4. Bản đồ năng lực đã xây dựng
5. Phản hồi chi tiết các yêu cầu gửi Go2Joy (R1–R16)
6. Phản hồi theo giai đoạn và cổng (Phase 0–5, Gate 0–5)
7. Đối chiếu yêu cầu phi chức năng
8. Lịch: nhận định và đề xuất
9. Rủi ro và biện pháp
10. Quyết định cần chốt ở kickoff
11. Giá trị với người dùng và ý nghĩa lâu dài
12. Giới hạn cần nói thẳng
13. Việc tiếp theo
- Phụ lục A. Danh mục đầu ra
- Phụ lục B. Thuật ngữ

---

## 1. Tóm tắt điều hành

### 1.1 Kết luận

Phần việc của Amoeba cho Stage 1 **đã được xây dựng gần như trọn vẹn ở mức mã nguồn và kiểm chứng ở môi trường local**: cầu nối danh tính có chữ ký (SSO), phân quyền nội dung theo vai trò Quản lý/Lễ tân, cổng khách chưa đăng nhập, cờ pilot theo khách sạn, định tuyến CS/Sales Admin theo đội và vùng, module tra cứu dữ liệu đối tác, số liệu pilot, tuân thủ PDPL (bản nháp), gói triển khai trên hạ tầng của Go2Joy và sổ tay vận hành tiếng Việt.

Điều **chưa thể hoàn tất nếu thiếu đầu vào của Go2Joy**, theo mức ảnh hưởng đến lịch:

1. Đặc tả và khóa API đối tác (R8, R9) — quyết định Gate 3 "trả lời bằng dữ liệu thật".
2. Tài khoản Hotel Admin và Super Admin (R1, R2) — quyết định bản đồ menu theo vai trò và UAT cách ly.
3. Chữ ký identify ở máy chủ Go2Joy và việc gọi lại khi đổi khách sạn/đăng xuất (R7).
4. Chủ sở hữu pháp lý của thông báo PDPL (R16), danh sách khách sạn pilot (R14), chỗ đặt hạ tầng (R6).

### 1.2 Số liệu chính

| Chỉ tiêu | Kết quả |
|---|---|
| Bài kiểm thử API (bản gộp cuối) | 4.938 đạt trên 4.950 (9 bị bỏ qua; 3 lỗi nền của Windows, giống hệt trên `main`) |
| Kiểm tra kiểu (`tsc`) cho API, web, widget | 0 lỗi cả ba |
| Boot API thật trên cơ sở dữ liệu tạm | Thành công |
| Schema do mã sinh ra so với tệp khởi tạo cài mới | Khớp, 1.074 cột |
| Migration SQL mới | 19 tệp, áp **trước** khi deploy mã |
| Sổ tay vận hành CS/Sales Admin | Tiếng Việt (đầy đủ) + tiếng Anh (tóm tắt), 27 ảnh chụp thật |

### 1.3 Lịch đề xuất

| Mốc | PDF | Đề xuất |
|---|---|---|
| Gate 2 | 16/10 | 16/10 (Amoeba deploy staging khoảng 15/10) |
| Gate 3 | 21/10 | 21/10, **định nghĩa lại**: SSO + phân quyền + hợp đồng API; dữ liệu thật chuyển sang giai đoạn pilot |
| Gate 4 (UAT) | 23/10 | **28/10** |
| Pilot | 26/10 | **02/11** (xác nhận cùng Go2Joy) |

### 1.4 Năm điều cần biết trung thực

1. Ngưỡng cổng khách **chưa được đo bằng embedding thật** (Voyage + Qdrant).
2. Tra cứu dữ liệu đối tác mới chạy với **dữ liệu mẫu và máy chủ giả** vì chưa có API thật.
3. Gói cài đặt cho hạ tầng Go2Joy **chưa từng được build hay chạy thật**.
4. Nội dung PDPL và các bản dịch chưa được luật sư/người bản ngữ rà soát.
5. Hiệu năng với mô hình thật và chỉ số kinh doanh (re-booking) **chưa đo được**.

---

## 2. Cách đọc tài liệu

### 2.1 Ký hiệu trạng thái

| Ký hiệu | Nghĩa |
|---|---|
| ✅ | Đã triển khai trong mã và đã kiểm chứng ở môi trường local của Amoeba (kiểm thử tự động, boot API thật, smoke HTTP, trình duyệt; mức kiểm ghi ở từng mục). **Chưa chạy trên hệ thống thật của Go2Joy.** |
| 🟡 | Đã dựng một phần, hoặc dựng theo hợp đồng do Amoeba tự viết vì chưa có đầu vào của Go2Joy |
| 🔴 | Chưa làm được vì bị chặn bởi đầu vào chưa có |
| ⬜ | Việc thuộc phía Go2Joy |

**"Đã làm" không có nghĩa là "đã chạy trên staging/production".** Toàn bộ mã nằm trong một nhánh chờ PR; 19 file SQL mới phải được áp trước khi deploy (trên staging còn 18, vì `261001-guest-login-gate.sql` đã áp ngày 07/10; staging chạy `DB_SYNCHRONIZE=false`).

### 2.2 Khuôn trình bày của từng mục R

Mỗi yêu cầu R1–R16 được trả lời theo năm phần cố định: **Nhận định** (vì sao quan trọng), **Trạng thái** (đã làm gì, kiểm thế nào), **Đầu ra** (tệp, màn hình, API cụ thể), **Cần từ Go2Joy** (việc và hạn), **Giá trị lâu dài**.

---

## 3. Bảng tổng quan

### 3.1 Yêu cầu gửi Go2Joy (R1–R16)

| # | Hạng mục | Hạn | Trạng thái | Việc của Go2Joy |
|---|---|---|---|---|
| R1 | Tài khoản Hotel Admin (Quản lý + Lễ tân) | 13/10 | 🔴 chờ | Cấp 2 tài khoản + dữ liệu mẫu |
| R2 | Super Admin hoặc buổi trình diễn | 13/10 | 🔴 chờ | Cấp tài khoản hoặc xếp lịch trình diễn |
| R3 | Thông tin truy cập staging | 13/10 | 🔴 chờ | URL staging, IP allowlist/VPN |
| R4 | Chèn embed.js vào trang đăng nhập | 14/10 | ✅ loader · 🟡 chưa kiểm trên trang thật · ⬜ chờ Go2Joy | Chèn 1 dòng, chỉ định người phụ trách |
| R5 | CSP & CORS | 14/10 | ✅ phía Amoeba · ⬜ chờ Go2Joy | Áp cấu hình theo hướng dẫn |
| R6 | Chỗ đặt staging | 14/10 | 🟡 | Đồng ý dùng staging Amoeba tạm |
| R7 | Tài liệu xác thực | 14/10 | ✅ hợp đồng đã xây · ⬜ chờ triển khai | Ký ở máy chủ, gọi lại khi đổi khách sạn |
| R8 | Danh sách và đặc tả API | 14/10 | 🔴 chờ · ✅ hợp đồng nháp | Gửi đặc tả, đối chiếu hợp đồng nháp |
| R9 | Khóa test API | 16/10 | 🔴 chờ · ✅ client đã sẵn | Cấp khóa, giới hạn tần suất |
| R10 | Thông tin front-end / phiên bản | 14/10 | ✅ cơ chế · 🟡 chờ trục phiên bản | Chốt trục phiên bản |
| R11 | Mẫu dữ liệu vận hành | 16/10 | 🟡 | FAQ, loại CS, hướng dẫn mới nhất |
| R12 | Hợp tác phát triển API mới | 16/10 | ✅ hợp đồng nháp · 🔴 chờ phân công | Thỏa thuận ai xây |
| R13 | Chỉ định đầu mối | 13/10 | ⬜ chờ | Nêu tên PM, kỹ thuật, vận hành |
| R14 | Khách sạn pilot | 21/10 | ✅ cờ pilot · ⬜ chờ danh sách | Danh sách đợt 1 |
| R15 | Quy trình phát hành/sự cố | 21/10 | ✅ khung · ⬜ chờ điểm quyết định | Điền phê duyệt, khung giờ, tiêu chí rollback |
| R16 | Xử lý dữ liệu cá nhân (PDPL) | 21/10 | 🟡 bản nháp | Luật sư xác nhận căn cứ, thời hạn lưu |

### 3.2 Giai đoạn và cổng

| Giai đoạn | Thời gian | Cổng | Tình trạng phía Amoeba | Điều kiện còn lại |
|---|---|---|---|---|
| 0. Khởi động | 12/10 | Gate 0 | ✅ | Go2Joy hồi âm ngày cấp |
| 1. Hiện trạng và phạm vi | 12–14/10 | Gate 1 (14/10) | 🟡 nháp phạm vi + hợp đồng API sẵn | R1–R3, R7, R8, R10 |
| 2. Áp dụng staging | 15–16/10 | Gate 2 (16/10) | 🟡 mã sẵn; chờ merge, SQL, deploy | R3–R5; deploy khoảng 15/10 |
| 3. Đăng nhập và API | 19–21/10 | Gate 3 (21/10) | 🟡 SSO + phân quyền xong; 🔴 dữ liệu thật | R8, R9 |
| 4. UAT | 22–23/10 (PDF) | Gate 4 (PDF 23/10; đề xuất 28/10) | 🟡 công cụ kiểm thử sẵn | UAT của Go2Joy; R14–R16 |
| 5. Production và mở rộng | PDF từ 26/10; đề xuất 02/11 | Gate 5 | 🟡 gói + runbook sẵn | Hạ tầng production; kết quả pilot |

---

## 4. Bản đồ năng lực đã xây dựng

| Năng lực | Người dùng được gì | Trạng thái | Tài liệu chính |
|---|---|---|---|
| **Danh tính có chữ ký (SSO)** | Trợ lý biết ai, khách sạn nào, vai trò gì; không thể giả mạo | ✅ | Hướng dẫn SDK (`docs/guide/임베드SDK설치가이드_Embed-SDK.ko.md`) |
| **Cách ly theo người/khách sạn/vai trò** | Đổi người hoặc khách sạn thì phiên mới; người sau không thấy hội thoại người trước | ✅ | `RPT-261013-s1b-identity-audit` |
| **Bậc quyền tri thức** (Công khai / Đã đăng nhập / Chỉ Quản lý) | Lễ tân không thấy nội dung tiền bạc của Quản lý | ✅ | `RPT-261013-w2a-access-tiers` |
| **Cổng khách chưa đăng nhập** | Người ngoài hệ thống chỉ nhận nội dung công khai và được chỉ tới trang đăng nhập/đăng ký | ✅ cơ chế · 🟡 ngưỡng chưa đo | `RPT-261013-w3a-gate-simulator` |
| **Phiên bản giao diện cho tri thức** | Trợ lý biết khi hướng dẫn có thể lệch phiên bản Hotel Admin | ✅ | `RPT-261013-s2b-KB-UI-Version` |
| **Tra cứu dữ liệu đối tác** (chỉ đọc) | Câu trả lời về giá, chính sách, đặt phòng, đối soát theo dữ liệu của chính khách sạn | 🟡 dữ liệu mẫu | Hợp đồng OpenAPI, `RPT-261013-Partner-Data`, `RPT-261013-w2c-tool-loop` |
| **Định tuyến CS/Sales Admin** | Đúng đội, đúng vùng, đúng người đang trực; nhắc khi không ai nhận | ✅ | `RPT-261013-s3b-Routing-Extras`, sổ tay |
| **Cờ pilot theo khách sạn** | Mở rộng từng nhóm khách sạn, không cần triển khai lại | ✅ | `RPT-261013-s5d-pilot-flag` |
| **Số liệu pilot** | Thấy trợ lý làm được gì, ở đâu, vì sao phải chuyển người | ✅ | `RPT-261013-w2b-analytics-pilot` |
| **Chịu lỗi và quan sát** | Sự cố không làm người dùng bí đường; vận hành có metric, cảnh báo | ✅ · 🟡 chưa thử nhà cung cấp thật | `RPT-261013-Resilience-Observability` |
| **PDPL và dữ liệu cá nhân** | Thông báo minh bạch, DSAR, thời hạn lưu | 🟡 bản nháp | Danh mục PDPL, DPIA |
| **Triển khai trên hạ tầng Go2Joy** | Go2Joy tự cài, sao lưu, rollback, vận hành | 🟡 chưa chạy thật | Runbook |
| **Sổ tay và đào tạo CS/Sales Admin** | Đội vận hành dùng được ngay, có bài tập | ✅ | Sổ tay `go2joy-ops` |

---

## 5. Phản hồi chi tiết các yêu cầu gửi Go2Joy (R1–R16)

### A. Tài khoản và truy cập (R1–R3)

#### R1 — Tài khoản test Hotel Admin
*Quản lý (nhiều khách sạn) + Lễ tân (một khách sạn), kèm khách sạn/phòng/đặt phòng thử. Hạn 13/10.*

- **Nhận định.** Đầu vào quan trọng nhất của Phase 1. Hai vai trò này ánh xạ trực tiếp sang `manager` và `receptionist` trong chữ ký identify v2 và quyết định ranh giới nội dung (đối soát, đổi tài khoản ngân hàng, quyền nhân viên chỉ dành cho Quản lý). Thiếu tài khoản thật, Amoeba chỉ suy ra phạm vi quyền từ tài liệu công khai và mô phỏng.
- **Trạng thái.** 🔴 chưa có tài khoản (theo thông tin Amoeba có). Đã làm để không bị chặn: ✅ mô hình hóa ba vai trò (`manager`, `receptionist`, và `internal` cho nhân viên Go2Joy) trong chữ ký và trong bậc truy cập tri thức; ✅ bộ kiểm cách ly với dữ liệu giả lập nhiều khách sạn; 🟡 kho tri thức nền viết từ màn hình Hotel Admin công khai, chưa đối chiếu với tài khoản thật.
- **Đầu ra.** Enum vai trò và bậc truy cập (`packages/types/src/common/enum.types.ts`, `audience.ts`); bộ kiểm `embed.service.rebind.spec.ts`, `embed.service.v2.spec.ts`.
- **Cần từ Go2Joy.** Hai tài khoản trên staging; tối thiểu hai khách sạn cho tài khoản Quản lý (để kiểm "đổi khách sạn"); tỉnh/thành của mỗi khách sạn (để kiểm định tuyến theo vùng).
- **Giá trị lâu dài.** Phân quyền đúng vai trò khiến chủ khách sạn **tin** trợ lý: lễ tân không thấy nội dung tiền bạc của quản lý, quản lý không bị trả lời chung chung. Niềm tin này quyết định việc họ dùng lâu dài hay chỉ thử một lần.

#### R2 — Tài khoản Super Admin hoặc buổi trình diễn
*Chỉ đọc/giới hạn; nếu không được thì trình diễn màn hình + danh sách menu. Hạn 13/10.*

- **Nhận định.** Mở ra nhóm nhiệm vụ "nhân viên Go2Joy hỗ trợ khách sạn" mà trợ lý có thể đỡ tay (tự trả lời / tra cứu / hỗ trợ xử lý / chuyển người). Amoeba đề xuất chọn trình diễn nếu cấp tài khoản chậm hơn 1 ngày (mục 10).
- **Trạng thái.** 🔴 chưa có. ✅ Amoeba đã xây sẵn nơi nhận kết quả phân loại: bậc truy cập tri thức, đội CS/SA, hàng chờ theo đội/vùng.
- **Đầu ra.** Console Go2Joy: Users & Labels, Agent handoff, hàng chờ trong Live chat (sổ tay `apps/web/public/manual/go2joy-ops.vi.md`, chương 1, 3, 5–6).
- **Cần từ Go2Joy.** Tài khoản chỉ đọc hoặc lịch trình diễn.
- **Giá trị lâu dài.** Mỗi nhiệm vụ nhân viên làm tay mà trợ lý đỡ được là chi phí CS giảm theo quy mô — đúng kỷ luật chi phí và nhân lực mỏng của Go2Joy.

#### R3 — Thông tin truy cập staging
*URL staging Hotel Admin; IP allowlist hoặc VPN nếu bị giới hạn. Hạn 13/10.*

- **Nhận định.** Điều kiện để kiểm widget trên đúng trang đăng nhập và đúng chính sách CSP của Go2Joy. Không có thì chỉ kiểm được trên trang giả.
- **Trạng thái.** 🔴 chưa có. ✅ Amoeba đã kiểm widget với một trang host giả lập (loader, ẩn/hiện, sự kiện hết hạn danh tính) bằng trình duyệt thật.
- **Đầu ra.** Hướng dẫn CSP/CORS song ngữ (R5).
- **Cần từ Go2Joy.** URL, cách truy cập.
- **Giá trị lâu dài.** Phát hiện sớm xung đột CSP/CORS tránh sự cố "widget không hiện" vào ngày pilot — loại lỗi làm người dùng mất niềm tin ngay buổi đầu.

### B. Áp dụng staging (R4–R6)

#### R4 — Chèn embed.js vào trang đăng nhập staging
*Một dòng; chỉ định người phụ trách front-end. Hạn 14/10.*

- **Nhận định.** Việc chèn đơn giản; điểm cần cẩn thận là **hành vi khi người dùng chưa đăng nhập** (trang đăng nhập chính là nơi ai cũng là "khách") và việc widget chuyển đúng trạng thái sau khi đăng nhập.
- **Trạng thái.** ✅ loader sẵn sàng: đường thăm dò danh tính và tiêu đề iframe cấu hình được; ẩn/hiện đảo ngược được (ví dụ ẩn cho khách sạn ngoài pilot rồi hiện lại khi đổi khách sạn); phát sự kiện cho host khi danh tính hết hạn. 🟡 chưa kiểm trên trang đăng nhập thật của Go2Joy.
- **Đầu ra.** `apps/widget/public/embed.js`; mục sự kiện và ẩn/hiện trong hướng dẫn SDK; 155 bài kiểm thử widget đạt.
- **Cần từ Go2Joy.** Chèn dòng mã; chỉ định người phụ trách.
- **Giá trị lâu dài.** Một dòng mã, không đổi giao diện host: chi phí tích hợp thấp, mở rộng sang nhiều trang Hotel Admin sau này không cần dự án mới.

#### R5 — Cho phép CSP & CORS
*Đăng ký domain widget/API vào `script-src`, `frame-src`, `connect-src` và CORS. Hạn 14/10.*

- **Nhận định.** Rủi ro "widget không tải" chủ yếu đến từ đây; cấu hình CSP đúng là bắt buộc.
- **Trạng thái.** ✅ Amoeba đã kiểm từng khẳng định trong mã (loader, iframe, phông chữ, GA4) và viết hướng dẫn nêu đúng từng chỉ thị: `script-src` (nguồn widget; đoạn nhúng trong console là inline nên cần nonce hoặc tệp riêng), `frame-src`/`child-src`, `connect-src` (nguồn widget và `'self'`), không cần gì cho `img/style/font` ở host; CORS dùng danh sách origin chính xác (không dùng ký tự đại diện). ✅ thêm `frame-ancestors` cấu hình bằng biến môi trường cho nginx của widget; ✅ đóng gói phông Pretendard cục bộ, bật bằng `WIDGET_FONT_CSS_URL` (đã đặt trong profile Go2Joy; mặc định hệ thống vẫn dùng jsDelivr). Chưa chạy `nginx -t` vì chưa dựng image.
- **Đầu ra.** `docs/guide/GUIDE-261013-Go2Joy-HotelAdmin-CSP-CORS.md` (vi/en); biến `CORS_ORIGINS` (trong `docs/guide/ENV-Config-Guide.md`, `apps/api/src/main.ts` và các mẫu env), `WIDGET_FRAME_ANCESTORS`, `WIDGET_FONT_CSS_URL` (trong `CONFIG.md` và các mẫu env).
- **Cần từ Go2Joy.** Áp cấu hình theo hướng dẫn; cung cấp danh sách origin Hotel Admin.
- **Giá trị lâu dài.** Giới hạn "ai được nhúng" bảo vệ thương hiệu và dữ liệu của Go2Joy; hướng dẫn một trang giúp đội front-end làm đúng ngay lần đầu.

#### R6 — Chỗ đặt SharpTalk staging
*Trên hạ tầng Go2Joy, hoặc đồng ý dùng staging Amoeba với dữ liệu giả. Hạn 14/10.*

- **Nhận định.** Amoeba đề xuất **dùng staging Amoeba với dữ liệu giả cho Phase 2–4** và dành hạ tầng Go2Joy cho production (đúng như bảng rủi ro của PDF), để việc dựng hạ tầng không chặn việc kiểm chức năng.
- **Trạng thái.** 🟡 staging Amoeba đã có tenant Go2Joy và kho tri thức nền (bước K1 trong `PLN-261001-Go2Joy-Guest-Login-Gate`); các tính năng mới **chưa được deploy lên staging** (chờ merge, áp 18 SQL còn lại, deploy). Hạ tầng Go2Joy: gói cài đặt đã viết, chưa chạy thật (mục 6, Phase 5).
- **Đầu ra.** Danh sách SQL theo thứ tự áp (`RPT-261013-Go2Joy-Integration-Final.md`, mục 3); runbook cài đặt.
- **Cần từ Go2Joy.** Đồng ý dùng staging tạm; sau đó chỉ định máy chủ production.
- **Giá trị lâu dài.** Tách "kiểm chức năng" khỏi "dựng hạ tầng" giúp pilot không trễ vì hạ tầng và sớm chứng minh Go2Joy tự vận hành được hệ thống.

### C. Tài liệu kỹ thuật và API (R7–R12)

#### R7 — Tài liệu cơ chế xác thực
*Session/JWT/OAuth, hạn và gia hạn token, ID người dùng, vai trò, khách sạn. Hạn 14/10.*

- **Nhận định.** Amoeba chọn **không phụ thuộc cơ chế đăng nhập nội bộ của Hotel Admin**: máy chủ Go2Joy chỉ cần tạo một chữ ký HMAC trên bộ (người dùng, khách sạn, vai trò, thời điểm) rồi đưa cho widget. Cách này không đòi Go2Joy tiết lộ cấu trúc phiên/JWT, không phụ thuộc phiên bản Hotel Admin, và chống giả mạo vì bí mật nằm ở máy chủ.
- **Trạng thái.** ✅ hợp đồng identify v2 đã triển khai và kiểm kỹ:
  - Chuỗi ký `userId|hotelSn|role|iat[|province]` (HMAC, khóa bí mật theo tenant); vai trò hợp lệ `manager`, `receptionist`, `internal`; tên và mã khách sạn đi kèm nhưng không nằm trong chữ ký (chỉ để hiển thị); tỉnh nằm trong chữ ký khi được gửi.
  - Cửa sổ thời gian ±10 phút; chữ ký sai/thiếu/đổi khách sạn/đổi tỉnh đều bị từ chối như nhau.
  - **Tách phiên** khi người, khách sạn hoặc vai trò đổi; **đăng xuất phía máy chủ**; **danh tính hết hạn sau 8 giờ** (ghi đè theo tenant; `0` để tắt khẩn cấp), widget báo host ký lại không cần tải lại trang; **chống phát lại** một chữ ký trên hai phiên; tùy chọn từ chối hẳn identify v1.
  - Người khác dùng cùng trình duyệt phải đồng ý lại thông báo quyền riêng tư.
- **Đầu ra.** `apps/api/src/domain/embed/*`, `session/identity.util.ts`; hướng dẫn SDK kèm mẫu ký PHP; bộ kiểm bảo mật (`embed.service.v2.spec.ts`, `embed.service.rebind.spec.ts`…): `iat` tương lai, ranh giới ±600 giây, chữ ký của tenant khác, phát lại, xoay khóa; mỗi sửa gỡ ra thì kiểm thử đỏ (kiểm thử đột biến).
- **Cần từ Go2Joy.** Ký ở máy chủ; gọi `identify` sau đăng nhập và **mỗi lần đổi khách sạn**; gọi `ShopTalk.logout()` khi đăng xuất; lắng nghe sự kiện `identity-expired` để ký lại; xác nhận nơi lưu khóa bí mật.
- **Giá trị lâu dài.** Nền móng chống rò dữ liệu chéo khách sạn — rủi ro lớn nhất của hệ thống đa khách sạn. Cơ chế ký rõ ràng cũng giúp thêm kênh mới (ứng dụng di động, trang khác) mà không phải đàm phán lại.

#### R8 — Danh sách và đặc tả API hiện có
*Swagger/OpenAPI/Postman: khách sạn, phòng/sản phẩm (theo giờ, qua đêm, theo ngày), chính sách, đặt phòng, khuyến mãi. Hạn 14/10.*

- **Nhận định.** Quyết định Gate 3. Không có đặc tả, Amoeba **không thể** kiểm tra trợ lý trả lời bằng dữ liệu thật. Vì vậy Amoeba làm ngược lại: tự viết hợp đồng API tối thiểu (đúng tinh thần Phase 1 "nháp yêu cầu API" và Phase 3 "thiết kế API còn thiếu") để Go2Joy chỉ cần đối chiếu và trả lời "đã có/chưa có".
- **Trạng thái.** 🔴 chưa nhận đặc tả. ✅ hợp đồng nháp v0 (OpenAPI 3.0, chỉ đọc) cho bốn chủ đề: chính sách (hủy/hoàn/nhận-trả phòng), giá phòng (theo giờ/qua đêm/theo ngày, số tiền là số nguyên VND), đặt phòng, đối soát. **Nguyên tắc cứng: không có tham số mã khách sạn trong bất kỳ yêu cầu nào** — khách sạn được xác định bằng thông tin xác thực dịch vụ cộng tiêu đề do máy chủ SharpTalk dựng từ danh tính đã ký; API phải từ chối khi không khớp. Kèm mô hình lỗi, giới hạn tần suất, phân trang, tính idempotent, tối thiểu hóa dữ liệu cá nhân.
- **Đầu ra.** `docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml` và bản giải thích song ngữ `docs/guide/API-REQ-Go2Joy-Partner-Data.md`.
- **Cần từ Go2Joy.** Đối chiếu hợp đồng nháp với API sẵn có; chỉ ra API nào đã có, API nào thiếu (R12); gửi Swagger/Postman.
- **Giá trị lâu dài.** Hợp đồng chỉ đọc, đóng tham số, không nhận mã khách sạn từ lời người dùng bảo đảm ở mức kiến trúc rằng **dù mô hình AI bị đánh lừa hay nhầm, nó vẫn không thể đọc dữ liệu khách sạn khác** — điều làm chủ khách sạn yên tâm cho trợ lý chạm vào dữ liệu tiền bạc.

#### R9 — Khóa test API
*Khóa staging, giới hạn tần suất, giới hạn IP gọi. Hạn 16/10.*

- **Nhận định.** Cần cho kiểm thử tích hợp thật; giới hạn tần suất của Go2Joy quyết định cách cấu hình thời gian chờ, thử lại và bộ nhớ đệm.
- **Trạng thái.** 🔴 chưa có khóa. ✅ client HTTP thật đã viết theo hợp đồng nháp và kiểm với máy chủ giả cục bộ:
  - chỉ gọi GET; thời gian chờ từng lần và tổng ngân sách; thử lại một lần có jitter khi lỗi mạng/5xx; ngắt mạch;
  - chặn SSRF (từ chối địa chỉ riêng/HTTP thường trừ khi vận hành cho phép);
  - loại bỏ phản hồi khi khách sạn API trả về khác khách sạn trong danh tính;
  - bộ nhớ đệm 30–60 giây có mã khách sạn trong khóa; nhật ký tra cứu không ghi dữ liệu cá nhân.
  - Công tắc `PARTNER_DATA_ENABLED`, `PARTNER_API_MODE=mock|live`; mặc định **tắt**.
- **Đầu ra.** `apps/api/src/domain/partner-data/*`; cấu hình thông tin xác thực trong console (nhà cung cấp `go2joy_partner_api`: địa chỉ gốc, khóa API, khóa ký tùy chọn).
- **Cần từ Go2Joy.** Khóa staging, giới hạn tần suất, danh sách IP gọi.
- **Giá trị lâu dài.** Khả năng chịu lỗi sẵn có: API đối tác chậm hoặc sập không làm trợ lý "đơ" mà chuyển sang "xác nhận sau + chuyển người", bảo vệ trải nghiệm người dùng khi đối tác có sự cố.

#### R10 — Thông tin front-end Hotel Admin
*Phiên bản vận hành hiện hành (trong khoảng v0.4.1–v0.12.0), framework, đa ngôn ngữ. Hạn 14/10.*

- **Nhận định.** Hướng dẫn chỉ đúng khi khớp phiên bản giao diện người dùng đang thấy; sai phiên bản là nguyên nhân phổ biến khiến nhân viên "làm theo trợ lý mà không thấy nút" (yêu cầu FR-010).
- **Trạng thái.** ✅ mỗi tài liệu tri thức có nhãn phiên bản giao diện (`ui_version`); cài đặt tenant "Phiên bản giao diện tham chiếu" với chế độ khi lệch: thêm lưu ý / ẩn tài liệu / tắt; khi lệch, câu trả lời được thêm **một câu cố định đa ngôn ngữ** sau bước kiểm duyệt; tài liệu chưa gắn phiên bản được đánh dấu trong console; nhập/xuất CSV có cột phiên bản (tệp cũ không làm mất phiên bản đã gắn). 🟡 **trục phiên bản chưa chốt**: tệp chính sách hiện cite "v23.x", PDF dùng "v0.4.1–v0.12.0"; mã so sánh **không phụ thuộc trục** (bằng nhau sau khi bỏ khoảng trắng, chữ hoa và chữ `v` đầu).
- **Đầu ra.** `packages/types/src/common/kb-version.ts`; cột `kb_documents.ui_version`, `tenant_ai_config.kb_version_policy` (`sql/261016-kb-ui-version.sql`); màn hình Kho tri thức và Cài đặt AI.
- **Cần từ Go2Joy.** Chốt trục phiên bản và phiên bản đang chạy production; cung cấp phiên bản cho từng nhóm tài liệu hoặc cho phép Amoeba gắn theo bản phát hành.
- **Giá trị lâu dài.** Khi Hotel Admin ra phiên bản mới, trợ lý **tự biết** tài liệu nào có thể lỗi thời thay vì âm thầm hướng dẫn sai — cơ chế giữ chất lượng trả lời bền theo thời gian, quyết định liệu người dùng còn tin trợ lý sau 6 tháng.

#### R11 — Mẫu dữ liệu vận hành
*FAQ khách sạn, loại và tần suất yêu cầu CS (ẩn danh), cấu trúc dữ liệu "Chat với khách"/"Tin nhắn từ G2J", hướng dẫn mới nhất. Hạn 16/10.*

- **Nhận định.** Chất lượng trả lời phụ thuộc kho tri thức; dữ liệu thật về câu hỏi và tần suất là cách duy nhất để biết nên viết gì trước.
- **Trạng thái.** 🟡 kho tri thức nền đã có và đã dùng thử: 25 chủ đề / 50 bài song ngữ Việt-Anh, xếp trong 7 nhóm danh mục (21 chủ đề chính sách Hotel Admin viết từ các màn hình, cộng 4 chủ đề **công khai** cho người chưa là đối tác: đăng nhập và lỗi thường gặp, đổi mật khẩu, đăng ký làm đối tác, liên hệ Go2Joy). "Vòng phản hồi" đã có từ trước: hệ thống đề xuất **việc bổ sung tri thức** từ ba nguồn — cụm câu hỏi hay bị chuyển người, câu trả lời không có nguồn, cách nhân viên đã xử lý — để người phụ trách duyệt. Việc nhập dữ liệu của Go2Joy vẫn chờ.
- **Đầu ra.** `reference/go2joy-ha-policies-kb-260916.csv` (nhập hàng loạt qua console), `scripts/go2joy/build-ha-policies-kb.py`; bộ câu hỏi chuẩn (golden); `reference/go2joy-gate-calibration-set.csv` (30 câu **nháp** cần Go2Joy rà).
- **Cần từ Go2Joy.** Các mẫu dữ liệu nêu trên.
- **Giá trị lâu dài.** Mỗi câu hỏi thực tế được ghi lại thành tri thức mới biến trợ lý thành tài sản **tăng giá trị theo thời gian** — đối lập với một kho FAQ tĩnh.

#### R12 — Hợp tác phát triển API mới
*Với API R8 không có: Amoeba thiết kế → Go2Joy phát triển (hoặc thỏa thuận Amoeba làm). Hạn 16/10 (thỏa thuận).*

- **Nhận định.** "Amoeba viết hợp đồng, Go2Joy xây bên mình" là cách nhanh nhất vì Go2Joy hiểu dữ liệu và quyền của mình, còn Amoeba không cần chạm vào cơ sở dữ liệu của Go2Joy.
- **Trạng thái.** ✅ hợp đồng nháp (R8) đã sẵn để Go2Joy xem xét — đúng mục Phase 3 "OpenAPI cho API còn thiếu → Go2Joy review". 🔴 chưa có thỏa thuận ai xây. Thứ tự ưu tiên đã đặt: chính sách → giá → đặt phòng → đối soát (khớp bảng rủi ro PDF: "API tối thiểu trước").
- **Đầu ra.** Như R8.
- **Cần từ Go2Joy.** Thỏa thuận phân công xây.
- **Giá trị lâu dài.** Một hợp đồng chỉ đọc được thiết kế một lần dùng cho cả Stage 1 và Stage 2.

### D. Tổ chức và vận hành (R13–R16)

#### R13 — Chỉ định đầu mối
*PM, kỹ thuật (backend/front-end/hạ tầng), vận hành, kênh kiểm tra hằng ngày. Hạn 13/10.*

- **Nhận định.** Cần ngay vì nhiều quyết định (trục phiên bản, chủ đề chỉ dành cho Quản lý, khách sạn pilot, phạm vi nội dung công khai) phải do người của Go2Joy quyết.
- **Trạng thái.** ⬜ chờ. ✅ Amoeba đã chuẩn bị mẫu liên hệ trong runbook và quy trình sự cố (để trống có đánh dấu rõ).
- **Đầu ra.** `docs/guide/INCIDENT-RESPONSE.md` (bảng liên hệ), runbook mục 10; kênh cảnh báo vận hành (webhook/email) cấu hình bằng biến môi trường.
- **Cần từ Go2Joy.** Tên và kênh liên lạc.
- **Giá trị lâu dài.** Một kênh kiểm tra hằng ngày rút thời gian ra quyết định từ ngày xuống giờ trong hai tuần gấp rút.

#### R14 — Khách sạn pilot
*Danh sách đợt 1 (số lượng thỏa thuận), liên hệ từng khách sạn, tiêu chí thứ tự mở rộng. Hạn 21/10.*

- **Nhận định.** Danh sách pilot nhỏ giảm rủi ro UAT ngắn; cờ theo khách sạn là cơ chế tăng dần phạm vi mà không cần triển khai lại.
- **Trạng thái.** ✅ cờ pilot theo **mã khách sạn đã ký** (không tin tên/mã tự khai): bảng danh sách theo tenant; thêm từng khách sạn/dán danh sách/nhập CSV (có xem trước); khách sạn ngoài danh sách bị chặn **ở máy chủ trước khi gọi mô hình** (không lưu hội thoại, không tốn chi phí); widget ẩn hoặc hiện thông báo tùy cấu hình; khách chưa đăng nhập theo công tắc riêng; thêm khách sạn có hiệu lực trong tối đa khoảng 60 giây mà không cần đăng nhập lại; mọi thay đổi có nhật ký kiểm toán.
- **Đầu ra.** `domain/pilot/*`; bảng `tenant_pilot_hotels` và cột `tenants.pilot_access` (`sql/261016-tenant-pilot-hotels.sql`); thẻ "Phạm vi pilot theo khách sạn" trong Cài đặt widget; thẻ Pilot trong Thống kê (mục 6, Phase 5).
- **Cần từ Go2Joy.** Danh sách khách sạn đợt 1 (mã khách sạn đúng như gửi trong chữ ký) và tiêu chí mở rộng (đề xuất ở mục 11.4).
- **Giá trị lâu dài.** Mở rộng từng nhóm dựa trên số liệu thật thay vì "bật tất cả" giúp mỗi đợt mở rộng có bằng chứng chất lượng, giữ trải nghiệm tốt cho nhóm người dùng đầu tiên — nhóm tạo truyền miệng cho đợt sau.

#### R15 — Quy trình phát hành và xử lý sự cố
*Phê duyệt phát hành, khung giờ, tiêu chí rollback, liên hệ sự cố. Hạn 21/10.*

- **Nhận định.** Quy trình phải khớp cách Go2Joy đang phát hành Hotel Admin. Amoeba cung cấp khung, Go2Joy điền các điểm quyết định.
- **Trạng thái.** ✅ khung đã viết — runbook 13 mục: vai trò, dữ liệu đi ra ngoài, giao gói cài đặt và kiểm checksum, cài lần đầu, TLS/CSP, **danh mục phê duyệt phát hành** (sao lưu trước; **áp SQL trước rồi mới deploy mã**; kiểm khói bằng nhật ký "successfully started", tuổi container và mã trạng thái route mới: 401 = đã deploy, 404 = chưa, 502 = sập), rollback bằng thẻ image kèm hướng dẫn SQL hoàn tác (từ chối nếu giữa hai bản có migration không thể đảo), diễn tập sao lưu/khôi phục, giám sát, xử lý sự cố (đồng hồ báo cáo vi phạm dữ liệu 72 giờ), DSAR và lưu trữ, quản lý khóa (không xoay `CRED_ENC_KEY` tùy tiện), quy trình hỗ trợ của Amoeba. Kiểm bằng bộ thử nghiệm kịch bản (97/97) và MySQL tạm; **chưa chạy cài đặt thật**.
- **Đầu ra.** `docs/guide/RUNBOOK-261013-Go2Joy-SelfHosted.md`, `docs/guide/INCIDENT-RESPONSE.md`, `scripts/*self-hosted*`.
- **Cần từ Go2Joy.** Quy trình phê duyệt, khung giờ phát hành, tiêu chí rollback, liên hệ sự cố.
- **Giá trị lâu dài.** Quy trình phát hành rõ ràng biến sản phẩm từ "demo" thành "dịch vụ vận hành" — khách sạn chỉ dựa vào trợ lý hằng ngày khi nó ổn định và có người chịu trách nhiệm.

#### R16 — Xác nhận xử lý dữ liệu cá nhân
*Phạm vi dữ liệu tài khoản nhân viên và nhật ký hội thoại, thời hạn lưu, câu chữ đồng ý PDPL nếu cần. Hạn 21/10.*

- **Nhận định.** **Không thể do Amoeba tự quyết**: bên kiểm soát dữ liệu là Go2Joy; căn cứ pháp lý (tuân thủ hợp đồng B2B hay đồng ý), thời hạn lưu và việc chuyển dữ liệu ra nước ngoài (Anthropic, Voyage tại Hoa Kỳ) cần luật sư của Go2Joy xác nhận. Kho mã hiện chỉ trích Nghị định 13/2023; Luật bảo vệ dữ liệu cá nhân mới cần được xác nhận.
- **Trạng thái.** 🟡 khung kỹ thuật đã xong, **nội dung pháp lý là bản nháp**:
  - Hồ sơ thông báo `vn_pdpl` (vi/en): bên kiểm soát, loại dữ liệu (tin nhắn, thông tin khách sạn/vai trò đã ký, thông tin thiết bị), mục đích, bên nhận (Anthropic và Voyage tại Hoa Kỳ), chuyển ra nước ngoài, thời hạn lưu **nội suy từ cấu hình thật** (không thể lệch với thực tế), quyền của chủ thể, liên hệ DPO. Banner widget không còn ghi "CCPA" hay "Google Analytics".
  - Lưu bằng chứng đồng ý (cấp/rút/phiên bản) vào nhật ký kiểm toán; đồng ý theo từng người.
  - Công cụ DSAR phía vận hành (tra cứu khách theo email/điện thoại/mã ngoài; xuất; xóa; có nhật ký kiểm toán); xóa danh tính khi xóa dữ liệu.
  - Thời hạn lưu mở rộng (tùy chọn, mặc định tắt) cho khách hàng và nhật ký kiểm toán.
  - Cập nhật DPIA (9 mục sử dụng AI thay cho 5 mục cũ), sổ nhà xử lý (thêm Notion, trung tâm AmoebaTalk, SMTP, jsDelivr, hạ tầng Go2Joy; trạng thái hợp đồng xử lý dữ liệu đều "TBD"), liên hệ sự cố (để trống có đánh dấu).
- **Đầu ra.** `packages/types/src/common/privacy-notice-copy.ts`, màn hình Thông báo quyền riêng tư, công cụ DSAR trong console, `docs/guide/GUIDE-261013-Go2Joy-PDPL-Checklist.md` (danh sách quyết định Go2Joy/luật sư cần chốt), `docs/guide/AI-DPIA-GATE.md`, `docs/guide/PROCESSOR-REGISTER.md`.
- **Lỗ hổng đã biết (ghi trong DPIA).** Hai tính năng AI cho nhân viên (`agent_translate`, `agent_briefing`) gửi văn bản hội thoại chưa che dữ liệu cá nhân tới nhà cung cấp AI; che số tài khoản ngân hàng/mã số thuế chưa làm; thông báo của các profile khác vẫn còn nội dung mẫu 365 ngày/Hoa Kỳ.
- **Cần từ Go2Joy.** Thời hạn lưu (profile env Go2Joy đặt `CONVERSATION_LOG_RETENTION_DAYS=180`, mặc định hệ thống 365; thông báo `vn_pdpl` nội suy giá trị này — chưa phải giá trị pháp lý), căn cứ pháp lý, tên bên kiểm soát, DPO, người duyệt bản tiếng Việt.
- **Giá trị lâu dài.** Tuân thủ rõ ràng và minh bạch về dữ liệu đi đâu là điều kiện để doanh nghiệp lớn và khách sạn có yêu cầu pháp lý nghiêm ngặt dám dùng lâu dài; thông báo viết ẩu là rủi ro pháp lý cho Go2Joy chứ không chỉ cho Amoeba.

---

## 6. Phản hồi theo giai đoạn và cổng

Chủ thể theo PDF: [A] Amoeba, [G] Go2Joy, [A+G] chung.

### Phase 0 — Khởi động và gửi yêu cầu (12/10)

| Hạng mục | Chủ thể | Trạng thái | Ghi chú |
|---|---|---|---|
| Gửi yêu cầu R1–R16 | A | ✅ | Đã gửi bằng chính PDF; tài liệu này là phản hồi trạng thái |
| Kickoff: phạm vi, lịch, sở hữu dữ liệu/hosting | A+G | 🟡 | Amoeba đã chuẩn bị đề xuất cho sáu quyết định (mục 10) |
| Chỉ định đầu mối, kênh hằng ngày (R13) | G | ⬜ | Chờ |
| **Gate 0**: nhận yêu cầu, hồi âm ngày cấp | | ⬜ | Chờ hồi âm của Go2Joy |

### Phase 1 — Hiện trạng và xác định phạm vi (12–14/10)

| Hạng mục | Chủ thể | Trạng thái | Ghi chú |
|---|---|---|---|
| Cung cấp tài khoản, staging (R1–R3) | G | ⬜ | Chờ |
| Bản đồ menu và tính năng Hotel Admin theo vai trò | A | 🔴 | Cần R1. Đã có thay thế: danh mục nhiệm vụ theo FR-1xx (`docs/analysis/REQ-260831-SharpTalk-Go2Joy-Requirements.md`) và mô hình vai trò trong mã. Có tài khoản thì lập trong 1 ngày làm việc |
| Bản đồ menu Super Admin và nhiệm vụ nhân viên Go2Joy | A | 🔴 | Cần R2 |
| Phân loại nhiệm vụ: tự trả lời / tra cứu / hỗ trợ xử lý / chuyển người | A | 🟡 | Khung đã thành hành vi hệ thống (xem chú thích dưới); phân loại theo từng nhiệm vụ cụ thể chờ R1/R2 |
| Đối chiếu hướng dẫn Notion với màn hình thực | A | 🟡 | Đã làm cho phần công khai; đối chiếu theo tài khoản thật chờ R1 |
| Nháp yêu cầu API từ dữ liệu trợ lý cần | A | ✅ | Hợp đồng nháp v0 (R8) |
| Cung cấp tài liệu xác thực, đặc tả API, thông tin front-end (R7, R8, R10) | G | ⬜ | Chờ; Amoeba đã đưa hợp đồng danh tính để Go2Joy xác nhận |
| **Gate 1 (14/10)**: thống nhất phạm vi + nháp API | | 🟡 | Amoeba sẵn sàng; cần Go2Joy xem xét |

*Chú thích phân loại nhiệm vụ.* **Tự trả lời**: kho tri thức, câu trả lời ngắn có cấu trúc. **Tra cứu**: module dữ liệu đối tác, chỉ đọc. **Hỗ trợ xử lý**: hướng dẫn từng bước, **không thực hiện thao tác không thể hoàn tác** (nguyên tắc FR-005). **Chuyển người**: hỏi đội CS/Business, định tuyến theo vùng, chuyển ngoài giờ qua email.

### Phase 2 — Áp dụng staging (15–16/10)

| Hạng mục | Chủ thể | Trạng thái | Ghi chú |
|---|---|---|---|
| Hosting staging hoặc đồng ý staging Amoeba tạm (R6) | G | ⬜ | Amoeba đề xuất phương án tạm |
| Deploy staging, ngôn ngữ vi, theme Hotel Admin | A | 🟡 | Ngôn ngữ vi đầy đủ cho widget và console; theme (một màu chủ đạo + kiểu tiêu đề) cấu hình được theo tenant, cần màu thương hiệu của Go2Joy; deploy bản mới chờ merge + áp SQL |
| Chèn embed.js, cho phép CSP/CORS (R4, R5) | G | ⬜ | Hướng dẫn đã sẵn |
| Câu trả lời khi chưa đăng nhập: tài khoản, FAQ cách dùng, nối CS | A | ✅ cơ chế · 🟡 phạm vi | Xem chi tiết dưới bảng |
| Nạp kho tri thức ban đầu | A | ✅ | 25 chủ đề/50 bài (R11); nhập lên staging và thiết lập nhóm công khai là các bước K2–K5 trong `PLN-261001-Go2Joy-Guest-Login-Gate` (mục S3), chờ deploy |
| Kiểm widget, câu trả lời, giao diện di động | A+G | 🟡 | Widget có bố cục di động; **chưa kiểm trên Hotel Admin thật** |
| **Gate 2 (16/10)**: SharpTalk chạy đúng trên trang đăng nhập staging | | 🟡 | Amoeba: merge + áp 18 SQL còn lại + deploy khoảng 15/10. Go2Joy: R3–R5 |

*Câu trả lời khi chưa đăng nhập — chi tiết.* Mỗi trợ lý có lựa chọn "Chỉ hướng dẫn đăng nhập hoặc đăng ký": người chưa đăng nhập chỉ nhận câu trả lời từ các nhóm tài liệu được đánh dấu công khai; câu hỏi khác nhận lời nhắc ngắn kèm nút mở trang đăng nhập/đăng ký; vẫn có thể tiếp tục như khách hoặc yêu cầu gặp nhân viên. Lỗ hổng rò phạm vi ở câu hỏi tiếp nối đã được sửa và bảo vệ bằng lỗi biên dịch. 🟡 **FAQ cách dùng hiện vẫn bị khóa** (chỉ 4 chủ đề tài khoản là công khai) vì đây là quyết định của Go2Joy (mục 10, quyết định 5). **Ngưỡng cổng chưa đo bằng embedding thật**; mặc định giữ chế độ trả lời bình thường cho tới khi hiệu chỉnh.

### Phase 3 — Liên kết đăng nhập và API (19–21/10)

| Hạng mục | Chủ thể | Trạng thái | Ghi chú |
|---|---|---|---|
| Kiểm tra mức phù hợp của API hiện có | A | 🔴 | Chặn bởi R8 |
| Thiết kế SSO: phiên HA → token ký → cầu nối danh tính | A | ✅ | Xem R7. Bổ sung so với PDF: **tỉnh có ký** (định tuyến CS/SA theo vùng) và quản lý vòng đời (hết hạn, đăng xuất, tách phiên) |
| OpenAPI cho API còn thiếu → Go2Joy review | A | ✅ | Nháp v0 (R8, R12) |
| Áp dụng embed.js và chuyển token ở màn hình sau đăng nhập | G | ⬜ | Hướng dẫn SDK có mẫu |
| Kiểm SSO, phân quyền theo vai trò và khách sạn (RBAC) | A | ✅ mã · 🟡 chưa tài khoản thật | Chi tiết dưới bảng |
| Kết nối công cụ tra cứu sản phẩm/chính sách | A | 🟡 | Module hoàn thiện, **chỉ chạy dữ liệu mẫu và máy chủ giả**; chi tiết dưới bảng |
| Deploy API mới lên staging (nếu có) | G | ⬜ | Chờ |
| **Gate 3 (21/10)**: trả lời bằng dữ liệu thật cho người đã đăng nhập | | 🔴 | **Không thể đạt theo nghĩa đen khi chưa có R8/R9.** Đề xuất định nghĩa lại (mục 8) |

*Phân quyền (RBAC) — chi tiết.*
- **Theo vai trò:** nhóm tri thức có ba bậc — công khai, đối tác đã đăng nhập, chỉ Quản lý — được thực thi ngay tại truy xuất (kể cả khách của trợ lý đang ở chế độ bình thường). Lễ tân hỏi chủ đề của Quản lý nhận câu "hãy nhờ tài khoản Quản lý" kèm nút gặp nhân viên, **không lộ nội dung** và không tạo việc cho CS. Nút kịch bản có đối tượng `manager` được kiểm lúc bấm. Câu trả lời tái dùng được xếp hạng theo bậc, không phát lại câu trả lời của Quản lý cho Lễ tân.
- **Theo khách sạn:** tách phiên khi đổi khách sạn/vai trò; một hội thoại tương ứng đúng một bộ (người, khách sạn, vai trò) và được đóng dấu vào hội thoại để báo cáo; lịch sử của khách sạn trước không đi vào lời nhắc của khách sạn sau (kiểm bằng HTTP thật và kiểm thử đột biến).

*Công cụ tra cứu — chi tiết.* Hai chế độ: (a) **tra cứu trước** (mặc định) — hệ thống nhận diện chủ đề, lấy dữ liệu và dựng khối dữ liệu phía máy chủ; (b) **tool-calling** (tùy chọn, mặc định tắt) — mô hình chọn tra cứu cần thiết nhưng không viết câu trả lời cuối. Mọi lời gọi đều qua cùng bộ kiểm quyền theo vai trò, bộ kiểm số tiền và kiểm duyệt. Số tiền do máy chủ tính, không để mô hình tự tính; câu trả lời có số không khớp dữ liệu bị hạ thành "xác nhận sau + chuyển người".

### Phase 4 — Kiểm thử tích hợp và UAT (22–23/10)

| Hạng mục | Chủ thể | Trạng thái | Ghi chú |
|---|---|---|---|
| Kiểm cách ly theo vai trò/khách sạn, hết hạn token, đăng nhập lại | A | ✅ | Chi tiết dưới bảng |
| Đánh giá chất lượng: độ chính xác, tỉ lệ chuyển người, kiểm duyệt | A | ✅ công cụ · 🟡 số đo thật | Chi tiết dưới bảng |
| Kiểm hiệu năng, bảo mật: thời gian phản hồi, giả mạo token, che dữ liệu cá nhân | A | 🟡 | Chi tiết dưới bảng |
| UAT của đội vận hành Go2Joy | G | ⬜ | Sổ tay và bài tập đã sẵn để UAT có kịch bản |
| Xác nhận khách sạn pilot, quy trình phát hành, xử lý dữ liệu (R14–R16) | G | ⬜ | Chờ |
| Tài liệu vận hành và đào tạo | A | ✅ | Chi tiết dưới bảng |
| **Gate 4 (23/10)**: duyệt UAT và duyệt phát hành production | | 🟡 | Công cụ sẵn; điều kiện còn lại thuộc Go2Joy và các phép đo cần môi trường thật (mục 8) |

*Kiểm cách ly — chi tiết.* Người khác/khách sạn khác/vai trò khác → phiên mới; cùng người cùng khách sạn → không tách; chữ ký sai không ghi gì. Hết hạn sau 8 giờ → coi như khách và widget báo host ký lại. Cửa sổ ±600 giây, `iat` tương lai/không hợp lệ, chữ ký của tenant khác, phát lại giữa hai phiên, xoay khóa, sửa vai trò/mã khách sạn. Cách ly tri thức theo bậc, cách ly tái dùng câu trả lời, cách ly dữ liệu đối tác giữa các khách sạn (bản ghi mồi của khách sạn khác không bao giờ được trả về). Quy tắc chất lượng: mỗi sửa bảo mật được chứng minh bằng việc **gỡ sửa ra thì kiểm thử đỏ**.

*Đánh giá chất lượng — chi tiết.*
- *Tỉ lệ chuyển người, tự xử lý, lý do từ chối, kiểm duyệt:* thẻ Pilot trong Thống kê (Phase 5).
- *Độ chính xác:* bộ câu hỏi chuẩn (golden) chấm theo nội dung kỳ vọng/cấm; thêm hai trường **đối tượng** và **cổng cần** để chấm cả hành vi cổng khách/Quản lý.
- *Cổng khách:* ô "Thử với tư cách…" trong Kho tri thức thử bốn góc nhìn (khách chưa đăng nhập, đối tác đã đăng nhập, lễ tân, quản lý) và hiển thị quyết định của cổng, độ tin cậy so với ngưỡng, các phân loại khớp kèm bậc, và đúng câu trả lời khách sẽ thấy. Lệnh `npm run gate:calibrate` chọn ngưỡng trên bộ câu hỏi có nhãn (ưu tiên không rò) và **in cảnh báo rồi thoát mã 3 khi chỉ có embedding giả**.
- Mô hình và embedding thật: chưa kiểm.

*Hiệu năng và bảo mật — chi tiết.* **Bảo mật:** giả mạo/phát lại/hết hạn đã kiểm (trên); che dữ liệu cá nhân trong nhật ký và bản ghi kiểm duyệt đã có (số điện thoại Việt Nam, email, mã thẻ…). **Hiệu năng:** mỗi lượt ghi thời gian từng giai đoạn (phân loại, truy xuất, sinh, kiểm duyệt) vào dấu vết và vào biểu đồ `/metrics`; **chưa đo với mô hình thật**. Hệ thống **không có phát trực tiếp (streaming)** nên mốc "token đầu tiên ≤ 2 giây" của NFR-001 không đo được — Amoeba đề nghị định nghĩa lại thành "thời gian đến phản hồi đầu tiên" hoặc làm streaming (xung đột với yêu cầu kiểm duyệt trước khi xuất).

*Tài liệu vận hành và đào tạo — chi tiết.* **Sổ tay vận hành Go2Joy cho CS và Sales Admin** (tiếng Việt + bản tóm tắt tiếng Anh): 13 chương, 10 bài tập thực hành, bảng tóm tắt một trang, bảng thuật ngữ, 12 câu kiểm tra; 27 ảnh chụp từ console thật (dữ liệu giả). Mọi nhãn trích dẫn được đối chiếu với giao diện thật (685 đoạn in đậm/nghiêng tra theo tệp ngôn ngữ). Hai nhà rà soát độc lập tìm được vấn đề, đã sửa hoặc ghi lại; các lỗi sản phẩm tìm thấy (đổi tên vai trò, nút Nhận im lặng khi lỗi, thiếu tên hiển thị nhân viên, bản dịch cấp bậc, cảnh báo ghi "độ tin cậy thấp" khi dữ liệu đối tác sập, thẻ liên hệ có số IVY…) **đã được sửa**.

### Phase 5 — Triển khai production và mở rộng dần (từ 26/10 theo PDF; Amoeba đề xuất 02/11, xem mục 8.2)

| Hạng mục | Chủ thể | Trạng thái | Ghi chú |
|---|---|---|---|
| Hosting production (đơn tenant trên hạ tầng Go2Joy) | G | ⬜ | Gói và runbook đã có (R6, R15) |
| Deploy production, giám sát và cảnh báo | A | ✅ mã · 🟡 chưa chạy thật | Chi tiết dưới bảng |
| Bật cho khách sạn pilot bằng cờ theo khách sạn | G | ✅ phía Amoeba | Hotel Admin vẫn có thể thêm một lớp bằng cách không tải embed.js cho khách sạn ngoài pilot |
| Vận hành pilot 2 tuần, xem lại chỉ số (PDF 26/10–06/11; đề xuất 02–15/11) | A+G | ✅ công cụ | Thẻ Pilot, chi tiết dưới bảng |
| Kế hoạch mở rộng: số khách sạn mỗi đợt, điều kiện | A+G | 🟡 | Đề xuất ở mục 11.4 |
| **Gate 5**: qua rà soát pilot → mở rộng sau 2 tuần pilot (PDF 09/11; theo đề xuất ≈ 16/11) | | ⬜ | Phụ thuộc kết quả pilot |

*Giám sát và cảnh báo — chi tiết.*
- `/metrics` dạng Prometheus (bảo vệ bằng token): số yêu cầu, số lượt trò chuyện theo kết quả, lời gọi mô hình theo nhà cung cấp và độ trễ, lỗi truy xuất vector, quyết định kiểm duyệt, chuyển người theo lý do, thời gian từng giai đoạn.
- Kiểm tra sẵn sàng: cơ sở dữ liệu, Redis, Qdrant, tình trạng engine AI.
- Cảnh báo vận hành (webhook/email, chống lặp): nhà cung cấp mô hình lỗi nhiều hoặc ngắt mạch mở, vector sập, cơ sở dữ liệu/Redis lỗi, lỗi dọn dữ liệu, gate chất lượng sau deploy thất bại. Người nhận cấu hình bằng biến môi trường, **không có người nhận mặc định của Amoeba**.
- Báo lỗi (webhook, có che dữ liệu, giới hạn tần suất) và bộ chuyển đổi tùy chọn cho Sentry nếu có cài; hướng dẫn kèm quy tắc cảnh báo Prometheus mẫu (`docs/guide/GUIDE-261013-Observability-Alerting.md`).

*Thẻ Pilot — chi tiết.* Gom theo khách sạn, vai trò hoặc ngày: số hội thoại; **tự xử lý** (không chuyển người và không có tin nhân viên — khác tỉ lệ giải quyết cũ vốn tính cả hội thoại do nhân viên đóng); tỉ lệ chuyển người theo lý do; độ tin cậy trung bình và tỉ lệ không có nguồn; kiểm duyệt; mức hài lòng (CSAT); số lần cổng khách; thống kê tra cứu dữ liệu đối tác; P50/P95 thời gian; số khách sạn hoạt động so với danh sách pilot và **danh sách khách sạn im lặng**; **xuất CSV hội thoại đã che dữ liệu cá nhân** để người của Go2Joy chấm độ chính xác bằng tay. Đo trên 200 nghìn hội thoại thử: báo cáo 14 ngày khoảng 0,5 giây, xuất 5.000 dòng khoảng 0,3 giây. Lý do `pilot_denied` và đồng ý không được lưu nên không đếm được (màn hình nói rõ thay vì hiện số 0).

---

## 7. Đối chiếu yêu cầu phi chức năng (REQ-260831)

| Yêu cầu | Nội dung | Trạng thái | Ghi chú trung thực |
|---|---|---|---|
| NFR-001 | Phản hồi: token đầu ≤ 2 giây, hoàn tất ≤ 6 giây (P95) | 🟡 | Có đo thời gian từng giai đoạn; chưa đo với mô hình thật; không có streaming nên mốc "token đầu" không đo được |
| NFR-002 | Trích dẫn nguồn 100% cho câu trả lời chính sách/giá/tiện ích | 🟡 | Có ngưỡng độ tin cậy, ghi nguồn và chuyển người khi thiếu căn cứ; chưa đo tỉ lệ trích dẫn trên lưu lượng thật |
| NFR-003 | Nhận diện ngôn ngữ sai ≤ 1% | 🟡 | Bộ 642 câu: đạt 100% trên 625 câu đưa vào ngưỡng kiểm, 97,4% trên cả 642 (gồm câu cực ngắn/khó); chưa đo trên lưu lượng thật |
| NFR-004 | Sẵn sàng 99,5%/tháng; sự cố thì hạ cấp "xác nhận sau + chuyển người" | 🟡 | Hạ cấp đã làm và kiểm với nhà cung cấp giả (timeout, ngắt mạch, vector sập vẫn trả lời bằng từ khóa với độ tin cậy giới hạn); độ sẵn sàng còn phụ thuộc hạ tầng |
| NFR-005 | PDPD: che dữ liệu cá nhân, thời hạn lưu, chuyển ra nước ngoài | 🟡 | Khung kỹ thuật xong; câu chữ pháp lý là bản nháp (R16) |
| NFR-006 | Mở rộng đa tenant: 5.500 tenant, overlay ≤ 300 ms | — | Ngoài phạm vi Stage 1 (triển khai đơn tenant cho Go2Joy); không đo |
| NFR-007 | Mỗi câu trả lời ghi agent, bằng chứng, tenant, vai trò | ✅ | Hội thoại được đóng dấu khách sạn, vai trò, agent; vết lý do từ chối đóng cho mọi từ chối; nhật ký kiểm toán cho identify/logout/tách phiên |
| NFR-008 | Dấu tiếng Việt, kể cả phông monospace | 🟡 | Đã kiểm một lần bằng Chrome 154/Windows/Consolas: đạt; chưa kiểm macOS/Linux |
| NFR-009 | Hồi quy rào chắn là cổng phát hành | 🟡 | Có bộ golden, kiểm cổng khách theo đối tượng, kiểm thử đột biến; cổng sau-deploy chạy được trong deploy self-hosted bằng cờ, chưa chạy thật |
| NFR-010 | Từ chối có mã lý do, kiểm toán được | ✅ | Danh sách lý do đóng (cổng khách, chỉ-Quản-lý, kiểm duyệt, độ tin cậy thấp, chính sách, danh tính hết hạn, engine lỗi, các lý do dữ liệu đối tác…); riêng `pilot_denied` và `consent` hiện chỉ có nhật ký máy chủ |

---

## 8. Lịch: nhận định và đề xuất

### 8.1 Nhận định

- **Thứ tự phụ thuộc thật** (khác với thứ tự ngày): R8/R9 → Gate 3 → pilot dùng dữ liệu thật; R1/R2/R3 → bản đồ vai trò và kiểm cách ly với tài khoản thật; R14–R16 → pilot hợp lệ về pháp lý và vận hành.
- **Khối lượng phía Amoeba** đã làm xong ở mức mã; phần còn lại là merge, áp SQL, deploy, kiểm với hệ thống thật, hiệu chỉnh với embedding và mô hình thật.
- **UAT hai ngày** (22–23/10) quá ngắn nếu gồm cả kiểm cách ly, chất lượng với dữ liệu thật và phản hồi vận hành; PDF cũng nêu đây là rủi ro.

### 8.2 Đề xuất

| Mốc | PDF | Đề xuất | Điều kiện |
|---|---|---|---|
| Gate 1 | 14/10 | 14/10 | Go2Joy xem nháp phạm vi và hợp đồng API; chốt sáu quyết định kickoff |
| Gate 2 | 16/10 | 16/10 | Amoeba deploy staging khoảng 15/10; Go2Joy chèn embed.js/CSP (R3–R5) |
| Gate 3 | 21/10 | 21/10 theo định nghĩa mới | SSO + phân quyền vai trò/khách sạn + hợp đồng API; dữ liệu thật chuyển sang pilot nếu chưa có R8/R9 |
| Gate 4 (UAT) | 23/10 | **28/10** | UAT của Go2Joy; hiệu chỉnh ngưỡng cổng khách với embedding thật trên staging; R14–R16 chốt |
| Pilot | 26/10 | **02/11** (đề xuất, xác nhận cùng Go2Joy) | Hạ tầng production sẵn sàng, hoặc pilot chạy tạm trên hạ tầng Amoeba với khách sạn giới hạn |
| Mở rộng | 09/11 | Sau rà soát pilot 2 tuần (≈ 16/11) | Qua tiêu chí ở mục 11.4 |

---

## 9. Rủi ro và biện pháp

| Rủi ro (theo PDF) | Biện pháp phía Amoeba đã làm | Còn lại |
|---|---|---|
| 1. Chậm cấp tài khoản/staging (R1–R6) | Phát triển không phụ thuộc tài khoản (mô phỏng vai trò, dữ liệu mẫu, trang host giả, staging Amoeba tạm) | Go2Joy cam kết ngày cấp; chậm trễ nào cũng dời lịch 1:1 |
| 2. Cần API mới mà Go2Joy thiếu nhân lực | API tối thiểu theo thứ tự chính sách → giá → đặt phòng → đối soát; hợp đồng viết sẵn; pilot mở bằng phạm vi tri thức + ngữ cảnh đã ký; dữ liệu thật thêm trong pilot | Quyết định ai xây (kickoff 3) |
| 3. Không có tài khoản Super Admin | Phương án trình diễn màn hình + danh sách menu; Amoeba lập bản đồ trong 1 ngày sau buổi trình diễn | Go2Joy lên lịch trình diễn |
| 4. Chậm hosting Go2Joy (R6) | Staging dùng hạ tầng Amoeba với dữ liệu giả; gói production sẵn (bundle, runbook, sao lưu mã hóa, rollback) | Chưa chạy thật; cần buổi diễn tập cài đặt trên máy Linux của Go2Joy |
| 5. UAT chỉ 2 ngày | Kiểm thử liên tục (4.938 bài kiểm thử, kiểm thử đột biến, golden, mô phỏng cổng, công cụ hiệu chỉnh); pilot nhỏ bằng danh sách khách sạn; sổ tay + bài tập để UAT có kịch bản | Đề xuất kéo dài UAT (mục 8) |
| 6. Bảo mật token đăng nhập (lộ dữ liệu chéo khách sạn) | Chữ ký, cửa sổ ±10 phút, hết hạn 8 giờ, chống phát lại, tách phiên theo (người, khách sạn, vai trò), đăng xuất phía máy chủ, hợp đồng API không nhận mã khách sạn từ lời người dùng, bậc quyền tri thức, cô lập tái dùng; **cách ly khách sạn là điều kiện Gate 4 như PDF yêu cầu** | Kiểm với tài khoản/khách sạn thật; Go2Joy phải gọi lại identify khi đổi khách sạn |

---

## 10. Quyết định cần chốt ở kickoff

| # | Quyết định | Khuyến nghị của Amoeba | Lý do |
|---|---|---|---|
| 1 | Hình thức Super Admin | **Trình diễn màn hình + danh sách menu** nếu cấp tài khoản không kịp trong 1 ngày | Mục tiêu là biết nhiệm vụ nhân viên, không cần thao tác |
| 2 | Vị trí staging | **Amoeba tạm với dữ liệu giả** cho Phase 2–4; production bắt buộc tại hạ tầng Go2Joy | Không để hạ tầng chặn kiểm chức năng |
| 3 | Ai xây API mới | **Amoeba viết hợp đồng (đã có), Go2Joy xây**; Amoeba chỉ nhận phần được thỏa thuận rõ | Go2Joy hiểu dữ liệu và quyền của mình |
| 4 | Số khách sạn pilot và tiêu chí mở rộng | **10–20 khách sạn đợt 1**, trộn quy mô và vùng (Bắc/Nam), gồm khách sạn có Quản lý đa chi nhánh; tiêu chí ở mục 11.4 | Kiểm được đổi khách sạn và định tuyến vùng |
| 5 | Phạm vi trả lời khi chưa đăng nhập | **Trước mắt chỉ 4 chủ đề tài khoản công khai** (đăng nhập, mật khẩu, đăng ký, liên hệ); mở FAQ cách dùng theo từng nhóm sau khi đo ngưỡng cổng với embedding thật | Chính sách/đối soát/giá chỉ nên mở khi chắc chắn không lộ cho người ngoài hệ thống |
| 6 | Ngày Phase 5 | Theo mục 8.2 | Phản ánh phụ thuộc thật |

Hai quyết định phát sinh ngoài danh sách của PDF cần Go2Joy: **trục phiên bản giao diện** (R10) và **danh sách chủ đề chỉ dành cho Quản lý** (đối soát, đổi tài khoản ngân hàng nhận tiền, quyền nhân viên…).

---

## 11. Giá trị với người dùng và ý nghĩa lâu dài

### 11.1 Từng nhóm người dùng nhận được gì

| Nhóm | Điều họ trải nghiệm | Cơ chế đảm bảo (đã có trong mã) |
|---|---|---|
| **Quản lý khách sạn** | Hỏi và nhận hướng dẫn đúng ngữ cảnh khách sạn mình; chủ đề tiền bạc/quyền hạn chỉ họ nhận được; đổi khách sạn thì trợ lý không "nhớ nhầm" khách sạn cũ; sau này nhận số liệu thật của khách sạn | Danh tính ký, bậc quyền theo nhóm, tách phiên, hợp đồng dữ liệu chỉ đọc |
| **Lễ tân** | Câu hỏi thao tác hằng ngày được trả lời ngắn, từng bước, có đậm/danh sách; hỏi chủ đề của Quản lý được chỉ đường rõ thay vì bị trả lời sai; dùng chung máy quầy an toàn: người sau không thấy hội thoại người trước | Quy tắc trả lời ngắn có cấu trúc, câu "hãy nhờ Quản lý", đăng xuất phía máy chủ, đồng ý theo từng người |
| **Người chưa là đối tác / chưa đăng nhập** | Có nơi hỏi cách đăng nhập, đổi mật khẩu, đăng ký làm đối tác; được chỉ tới đúng trang; không nhận nội dung nội bộ | Cổng khách, 4 chủ đề công khai, nút đăng nhập/đăng ký theo từng ngôn ngữ |
| **CS và Sales Admin của Go2Joy** | Biết ngay khách sạn/vai trò/tỉnh và "đã ký" hay chưa; chỉ nhận đúng loại việc của đội mình và đúng vùng; được báo khi không ai nhận; chuyển nhầm đội sửa được trong một thao tác; có sổ tay và bài tập | Tiêu đề hội thoại, hiện diện "Trực", thang chọn người theo nhãn + vùng, quét "chưa ai nhận", chuyển đội có ghi chú, bộ đếm hàng chờ, sổ tay |
| **Ban điều hành Go2Joy** | Thấy trợ lý đang giải quyết bao nhiêu, ở khách sạn nào, vì sao phải chuyển người; có dữ liệu để quyết định mở rộng | Thẻ Pilot, xuất CSV, danh sách khách sạn im lặng, golden + mô phỏng cổng |

### 11.2 Vì sao có tác động dài hạn

1. **Niềm tin quyết định việc dùng lâu dài.** Một lần lộ dữ liệu chéo khách sạn hoặc hướng dẫn sai về tiền là đủ để chủ khách sạn bỏ trợ lý. Phần lớn công sức vì thế đặt vào những thứ người dùng không thấy nhưng cảm nhận được qua việc "không bao giờ sai điều nghiêm trọng": cách ly cứng ở máy chủ, tham số API đóng, số tiền do hệ thống tính, kiểm số trước khi trả lời, từ chối có lý do kiểm toán được.
2. **Chất lượng bền theo thời gian.** Gắn phiên bản giao diện cho tri thức và cảnh báo khi lệch; vòng phản hồi biến câu hỏi chưa trả lời được thành tri thức mới; bộ golden và công cụ hiệu chỉnh cổng cho phép phát hiện suy giảm trước khi người dùng thấy.
3. **Không để người dùng bí đường.** Khi mô hình/vector sập: thông báo riêng bằng ngôn ngữ của người dùng ("sẽ xác nhận lại, nhân viên sẽ hỗ trợ"), vẫn trả lời bằng từ khóa khi có căn cứ, có nút Thử lại/Gặp nhân viên. Ngoài giờ: xin email để hồi đáp thay vì im lặng. Không ai nhận: hệ thống tự mở rộng người nhận.
4. **Đo được thì cải thiện được.** Số liệu theo khách sạn/vai trò/ngày, tỉ lệ tự xử lý đúng nghĩa, lý do chuyển người và khách sạn im lặng cho biết nên viết thêm tri thức nào, nhóm nào chưa dùng, và đợt mở rộng nào an toàn.
5. **Mở rộng không phải làm lại.** Danh tính ký, cách ly theo khách sạn, bậc quyền, hợp đồng dữ liệu chỉ đọc, cờ theo khách sạn và đo lường là đúng các điều kiện tiên quyết của Stage 2 (khách đặt phòng và lễ tân theo từng khách sạn): làm một lần ở Stage 1, dùng tiếp ở các giai đoạn sau.
6. **Chi phí vận hành thấp, đội mỏng vẫn chạy được.** Hệ thống tự định tuyến, tự nhắc, tự cảnh báo, kèm sổ tay; không đòi hỏi thêm nhân sự chuyên trách — khớp với tín hiệu chiến lược của Go2Joy về đội ngũ mỏng và kỷ luật chi phí.

### 11.3 Chỉ số đề xuất cho pilot (cần Go2Joy thống nhất ngưỡng)

| Nhóm | Chỉ số | Nguồn đo có sẵn | Ghi chú |
|---|---|---|---|
| An toàn | Số vụ lộ nội dung chéo khách sạn/vai trò | Bộ kiểm cách ly, CSV chấm tay, vết lý do từ chối | **Mục tiêu 0**; một vụ cũng đủ dừng mở rộng |
| Chất lượng | Tỉ lệ tự xử lý đúng (chấm tay trên mẫu CSV) | Thẻ Pilot + CSV | Ngưỡng thống nhất theo kết quả UAT |
| Chất lượng | Tỉ lệ chuyển người theo lý do | Thẻ Pilot | Theo dõi xu hướng giảm của "độ tin cậy thấp" nhờ bổ sung tri thức |
| Chất lượng | Tỉ lệ không có nguồn | Thẻ Pilot | Danh sách khoảng trống tri thức |
| Trải nghiệm | CSAT, thời gian đến phản hồi đầu tiên, P95 hoàn tất | Thẻ Pilot, `/metrics` | Cần mô hình thật mới đo được |
| Áp dụng | Khách sạn hoạt động so với danh sách pilot; khách sạn im lặng | Thẻ Pilot | Phát hiện sớm khách sạn "được cấp quyền mà không dùng" |
| Vận hành | Thời gian chờ nhận, số lần "chưa ai nhận", tỉ lệ chuyển đội | Bộ đếm hàng chờ | Điều chỉnh số người trực |
| Kinh doanh | **Re-booking, số booking/tháng, chi phí CS** | **Chưa đo được** | Cần API đặt phòng (R8) và dữ liệu CS; đề nghị đưa vào giai đoạn mở rộng vì đây là chỉ số lãnh đạo Go2Joy theo dõi |

### 11.4 Tiêu chí mở rộng đề xuất

Một đợt chỉ được mở rộng khi trong 2 tuần liền trước đó:
- (a) không có vụ lộ dữ liệu;
- (b) tỉ lệ tự xử lý đúng đạt ngưỡng đã thống nhất;
- (c) khách sạn im lặng dưới ngưỡng thỏa thuận;
- (d) không có sự cố mức nghiêm trọng chưa đóng.

---

## 12. Giới hạn cần nói thẳng

1. **API đối tác thật:** chưa có đặc tả/khóa; mọi tra cứu chỉ kiểm với dữ liệu mẫu và máy chủ giả; chế độ tool-calling chỉ kiểm với máy chủ Anthropic giả; chất lượng chọn công cụ tiếng Việt/Hàn chưa đo (ngày tương đối như "thứ bảy tới" có thể bị hiểu lệch).
2. **Ngưỡng cổng khách:** chưa đo với Voyage + Qdrant thật. Quan sát với embedding giả: cổng không đóng theo chủ đề (kể cả khách hỏi nội dung chỉ dành cho Quản lý vẫn được "cho qua") — vì vậy giữ mặc định ở chế độ trả lời bình thường và yêu cầu chạy `gate:calibrate` trên staging trước khi bật. Ngoài ra, khi Voyage chạy nhưng không có kết quả vector trong phạm vi, độ tin cậy dựa trên số tài liệu khớp có thể ≥ 0,62; công cụ hiệu chỉnh sẽ cảnh báo trường hợp này.
3. **Cài đặt:** chưa chạy `docker build`, chưa cài thử trên Linux, chưa chạy `nginx -t`; sao lưu/khôi phục mới kiểm với MySQL tạm và Qdrant giả.
4. **Dịch vụ ngoài:** chưa kiểm Slack/SMTP thật, Sentry thật; chưa kiểm trên trang Hotel Admin thật; một số đường trong widget (thẻ liên hệ, banner đồng ý, nút Thử lại/Gặp nhân viên sau lỗi gửi) mới kiểm bằng kiểm thử đơn vị/DOM.
5. **Bản dịch và pháp lý:** es/ko/ja/zh mới kiểm đủ khóa; bản vi cần người bản ngữ rà soát; nội dung PDPL là bản nháp.
6. **Khối lượng:** chưa kiểm với lưu lượng thật (đã thử 200 nghìn hội thoại cho báo cáo pilot).
7. **Quyết định còn mở của Amoeba trước khi merge:** Sales Admin có menu Đơn hàng nhưng điểm cuối cần nhãn vận hành (trả 403); phông Pretendard khoảng 3 MB đã đưa vào repo (giấy phép OFL) cần xác nhận.
8. **Hành vi thay đổi với tenant đang chạy khi deploy:** thời hạn danh tính 8 giờ; tách phiên; đồng ý theo từng người; không lưu câu trả lời của nhân viên (hội thoại có khách sạn đã ký) vào kho tái dùng; bật sẵn quét "chưa ai nhận" cho tenant có cấu hình định tuyến; đổi tiền tố email cảnh báo; bỏ số liên hệ IVY mặc định. Chi tiết: RPT tổng hợp mục 4 và mô tả PR.

---

## 13. Việc tiếp theo

### 13.1 Phía Go2Joy (ảnh hưởng lớn nhất tới lịch)

1. Phản hồi sáu quyết định kickoff (mục 10) cùng hai quyết định phát sinh (trục phiên bản, chủ đề chỉ dành Quản lý) — **ngay**.
2. Chỉ định đầu mối và mở kênh hằng ngày (R13) — **ngay**.
3. Cấp tài khoản Hotel Admin và Super Admin hoặc xếp lịch trình diễn (R1/R2); thông tin staging (R3); chèn embed.js và CSP/CORS (R4/R5).
4. Gửi đặc tả API hiện có và khóa test (R8/R9); xem xét hợp đồng nháp (R12).
5. Triển khai chữ ký identify ở máy chủ; gọi lại khi đổi khách sạn và khi đăng xuất (R7).
6. Chốt danh sách khách sạn pilot, quy trình phát hành, nội dung PDPL với luật sư (R14–R16).

### 13.2 Phía Amoeba

1. Merge nhánh, áp 18 file SQL còn lại trên staging theo thứ tự (`261001-guest-login-gate.sql` đã áp 07/10), deploy, kiểm khói và các bước K2–K5 của `PLN-261001` (khoảng 15/10).
2. Chạy `gate:calibrate` trên staging có Voyage + Qdrant; chọn ngưỡng; chỉ khi đó mới đề xuất bật chế độ "hướng dẫn đăng nhập" cho Go2Joy.
3. Hoàn thiện bản đồ menu theo vai trò ngay khi có R1/R2; điều chỉnh phân loại nhiệm vụ.
4. Diễn tập cài đặt gói production trên máy Linux (cùng Go2Joy), kiểm `nginx -t`, sao lưu/khôi phục thật.
5. Rà soát bản dịch và nội dung PDPL với người bản ngữ/luật sư; quyết định các điểm mở ở mục 12.7.
6. Khi có R8/R9: chuyển module tra cứu từ dữ liệu mẫu sang client thật; đối chiếu chế độ tra cứu trước với tool-calling bằng mô hình thật trước khi bật cho khách sạn pilot.

---

## Phụ lục A. Danh mục đầu ra

| Nhóm | Tệp / vị trí |
|---|---|
| Yêu cầu và kế hoạch | `docs/analysis/REQ-261012-Go2Joy-Stage1-Gap-Closure.md`, `docs/plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md` |
| Tổng hợp triển khai | `docs/implementation/RPT-261013-Go2Joy-Integration-Final.md` (đối chiếu yêu cầu, kiểm chứng, migration, thay đổi hành vi, chưa kiểm được); mỗi luồng có `RPT-261013-*` và `TCR-261013-*` riêng |
| Danh tính (SSO) | `docs/guide/임베드SDK설치가이드_Embed-SDK.ko.md` (hợp đồng, mẫu ký, sự kiện) |
| Hợp đồng API đối tác | `docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml`, `.md`; chế độ tool-calling: `docs/guide/GUIDE-261013-Partner-Data-Tools-Mode.md` |
| CSP/CORS | `docs/guide/GUIDE-261013-Go2Joy-HotelAdmin-CSP-CORS.md` |
| PDPL | `docs/guide/GUIDE-261013-Go2Joy-PDPL-Checklist.md`, `AI-DPIA-GATE.md`, `PROCESSOR-REGISTER.md`, `INCIDENT-RESPONSE.md` |
| Vận hành và hạ tầng | `docs/guide/RUNBOOK-261013-Go2Joy-SelfHosted.md`, `docs/guide/GUIDE-261013-Observability-Alerting.md`, `docker/self-hosted/*`, `scripts/*self-hosted*`, `scripts/build-release-bundle.sh` |
| Sổ tay CS/Sales Admin | `apps/web/public/manual/go2joy-ops.vi.md`/`.html`, `go2joy-ops.en.md`/`.html` |
| Bộ dữ liệu | `reference/go2joy-ha-policies-kb-260916.csv`, `reference/go2joy-gate-calibration-set.csv` (30 câu nháp) |
| Migration | 19 tệp trong `sql/`, từ `261001-guest-login-gate.sql` đến `261019-golden-gate-columns.sql` (danh sách đúng thứ tự áp trong RPT tổng hợp, mục 3, và trong mô tả PR); 8 tệp `2610*` còn lại trong thư mục đã có trên `main` từ trước |
| Mã nguồn | Nhánh `feature/go2joy-stage1-complete` (`fb10b1d0`) trên origin |

## Phụ lục B. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| Hotel Admin (HA) | Hệ thống quản trị dành cho khách sạn đối tác của Go2Joy |
| Quản lý / Lễ tân | Hai vai trò của nhân viên khách sạn (`manager`, `receptionist`); `internal` là nhân viên Go2Joy |
| CS / Sales Admin (SA) | Hai đội của Go2Joy nhận hội thoại chuyển người: hỗ trợ khách hàng / kinh doanh |
| identify v2 | Hợp đồng gửi danh tính có chữ ký từ máy chủ Go2Joy tới widget |
| Cổng khách | Cơ chế giới hạn người chưa đăng nhập vào nội dung công khai |
| Bậc quyền tri thức | Công khai / Đối tác đã đăng nhập / Chỉ Quản lý |
| Pilot theo khách sạn | Danh sách khách sạn được phục vụ, kiểm tra ở máy chủ theo mã khách sạn đã ký |
| Golden | Bộ câu hỏi chuẩn dùng để kiểm hồi quy chất lượng trả lời |
| DSAR | Yêu cầu của chủ thể dữ liệu (xuất, xóa dữ liệu cá nhân) |
| PDPL / PDPD | Luật và Nghị định về bảo vệ dữ liệu cá nhân của Việt Nam |
| G2J | Go2Joy (cách viết tắt dùng trong PDF) |
