# RPT-261013 — Go2Joy Stage 1: tổng hợp triển khai đầy đủ ở local (nhánh tích hợp)

- Ngày: 2026-10-13 · Nhánh: `test/go2joy-integration` (**local**; bản đã push lên origin `73ff8acf` là bản cũ, chưa có các thay đổi này) · Base: `main` 9fd31630 · PLN: `PLN-261012-Go2Joy-Stage1-Gap-Closure` (Phương án 2, mở rộng thành toàn bộ SG-xx theo yêu cầu "implement đủ ở local trước")
- Phạm vi: 159 commit, 787 tệp (+89 nghìn dòng); 19 file SQL mới. Mọi luồng được làm ở worktree riêng rồi gộp có kiểm chứng.
- Trạng thái: **chưa PR, chưa merge vào `main`, chưa deploy ở môi trường nào.**
- Cập nhật 2026-10-14: toàn bộ nội dung này (cộng các commit docs/RPT/TCR và sổ tay) đã được đưa lên nhánh PR `feature/go2joy-stage1-complete` (`fb10b1d0`, trên origin; 167 commit / 792 tệp so với `main`). Số liệu kiểm chứng ở §2 áp dụng cho cả hai nhánh (cùng nội dung mã). Bản trả lời checklist gửi Go2Joy: `docs/report/RPT-261013-Go2Joy-Checklist-Response.{vi,en,ko}.md`.

## 1. Đối chiếu yêu cầu

| Yêu cầu | Kết quả | Luồng / nhánh | Báo cáo chi tiết |
|---|---|---|---|
| SG-01 rò rỉ phạm vi khách (D-01) | Xong; lỗi biên dịch nếu thiếu phạm vi | `feature/guest-login-gate` | FIX-261012 |
| SG-02, 05 tách phiên, logout, DSAR xoá claims | Xong | `feature/go2joy-s1-session-security` | RPT-261012-P0 |
| SG-60, 61, 62, 65 hiện diện, bộ tỉnh VN, ngoài giờ, sửa nhỏ | Xong | `feature/go2joy-s3-routing-presence` | RPT-261012-P0 |
| SG-03, 04, 50 hết hạn claims, chống phát lại, dấu hội thoại, lý do từ chối, audit | Xong | s1b | RPT-261013-s1b |
| SG-30, 31, 32 hợp đồng OpenAPI, module dữ liệu đối tác, client HTTP | Xong **theo hợp đồng của chính ta**; chưa gọi Go2Joy thật | s4 | RPT-261013-Partner-Data |
| SG-20 phiên bản giao diện KB | Xong; so sánh không phụ thuộc trục phiên bản | s2b | RPT-261013-s2b |
| SG-40 cờ pilot theo khách sạn | Xong | s5d | RPT-261013-s5d |
| SG-83, 84 quan sát, timeout, ngắt mạch, hạ cấp | Xong | s5b | RPT-261013-Resilience-Observability |
| SG-80, 81 hạ tầng, backup, rollback, runbook | Xong; **chưa từng chạy `docker build`/deploy** | s5c | RPT-261013-s5c |
| SG-70, 82, 53 PDPL, CSP/CORS, NFR | Xong; **nội dung pháp lý là bản nháp** | s5a | RPT-261013-s5a |
| SG-63, 64, 66, 67 + phần còn lại SG-65 | Xong | s3b | RPT-261013-s3b |
| SG-10, 11, 06 bậc quyền KB | Xong | w2a | RPT-261013-w2a |
| SG-52 số liệu pilot | Xong | w2b | RPT-261013-w2b |
| SG-33 vòng tool-calling | Xong, **mặc định tắt**; chỉ kiểm với máy chủ giả | w2c | RPT-261013-w2c |
| SG-51 mô phỏng cổng, hiệu chỉnh ngưỡng | Xong; **chưa có số đo với embedding thật** | w3a | RPT-261013-w3a |
| SG-85 sổ tay vận hành CS/SA (vi + en) | Xong, 27 ảnh chụp thật | w3b | RPT-261013-w3b |
| Lỗi sản phẩm do rà soát sổ tay tìm ra | 8/8 mục đã sửa (xem RPT) | w3c | RPT-261013-w3c |

## 2. Kiểm chứng trên bản gộp cuối (điều phối chạy lại)

| Kiểm | Kết quả |
|---|---|
| `tsc` api, web, widget (map src) | 0 lỗi ×3 |
| jest API toàn bộ | 4950 test; 4938 đạt, 9 bỏ qua (spec SQL thật cần biến môi trường), **3 lỗi nền Windows**: `embed-loader`, `heic-conversion`, `board-attachment.service` (cùng lỗi trên `main`) |
| jest `packages/types` / `packages/common` | 474 / 65 đạt |
| widget `node --test test/*.test.mjs` | 155/155 |
| `npm run i18n:check` | đủ 6 ngôn ngữ |
| `npm run initsql:check` | 225 artefact khớp `01-schema.sql` |
| Boot API thật trên DB tạm | `Nest application successfully started` |
| Schema do entity sinh ra so với `docker/init-sql/01-schema.sql` | **cùng 1074 cột, không lệch cột nào** |

Mỗi luồng còn có kiểm riêng (đột biến: mỗi sửa gỡ ra thì test đỏ; boot trên DB tạm; smoke HTTP; trình duyệt) ghi trong RPT/TCR của luồng. Các lần gộp đều xử lý xung đột có chủ đích; điểm đáng nhớ: danh tính hết hạn dùng chung một hàm (`effectiveIdentity`) cho cổng khách, dòng khách sạn trong prompt, định tuyến vùng, cờ pilot và dữ liệu đối tác; thêm lý do từ chối `engine_unavailable` và các lý do `partner_*`.

## 3. Migration (áp **trước** khi deploy mã; staging chạy `DB_SYNCHRONIZE=false`)

Thứ tự theo tên tệp. Tất cả cộng thêm và cho phép NULL; chưa có backfill bắt buộc. Dùng skill `pre-deploy-check` và `scripts/check-migrations.sh` (phân loại thứ tự phát hành và khả năng hoàn tác).

```
sql/261001-guest-login-gate.sql                 (đã áp staging 07/10)
sql/261007-user-role-region.sql                 (chạy với --default-character-set=utf8mb4)
sql/261007-conversation-support-type.sql
sql/261007-conversation-support-region.sql
sql/261015-agent-profile-last-seen.sql
sql/261016-conversation-stamps.sql
sql/261016-golden-partner-ctx.sql
sql/261016-kb-ui-version.sql
sql/261016-partner-lookup-logs.sql
sql/261016-tenant-identity-policy.sql
sql/261016-tenant-partner-data-flag.sql
sql/261016-tenant-pilot-hotels.sql
sql/261017-agent-alerts-target-region.sql
sql/261017-conversation-escalated-at.sql
sql/261017-hotel-provinces.sql
sql/261018-analytics-pilot-indexes.sql          (thêm chỉ mục idx_conv_tenant_created)
sql/261018-kb-access-tier.sql
sql/261018-partner-lookup-mode.sql
sql/261019-golden-gate-columns.sql
```

Với cài mới (`docker/init-sql/01-schema.sql`) đã đồng bộ và có lưới an toàn `npm run initsql:check`.

## 4. Thay đổi hành vi với tenant đang chạy (cần biết trước khi deploy)

- **Danh tính v2 hết hạn sau 8 giờ** (`IDENTITY_MAX_AGE_HOURS`, ghi đè theo tenant; `0` = tắt khẩn cấp). Chỉ áp cho phiên có claims đã ký; v1, Shopify, Cafe24 không bị tính tuổi.
- **`identify` tách phiên** khi người, khách sạn hoặc vai trò đổi. Widget và API phải phát hành cùng lúc. **Consent chỉ được giữ khi cùng người**; người khác phải đồng ý lại. Host phải gọi `ShopTalk.logout()` khi đăng xuất.
- **Câu trả lời của nhân viên** cho hội thoại có khách sạn đã ký **không còn vào kho tái dùng** (kể cả tenant chưa dùng bậc quyền).
- **Quét cảnh báo chưa ai nhận** mặc định BẬT cho tenant có người nhận cấu hình, hỏi đội hoặc định tuyến vùng: tenant đang có người nhận sẽ bắt đầu được nhắc lại sau `ALERT_UNCLAIMED_MINUTES` (mặc định 5).
- **Hiện diện:** nhân viên phải bật "Trực" để được chọn trước; không bật thì mọi cảnh báo thành phát chung.
- **Tiền tố tiêu đề email cảnh báo** mặc định `[SharpTalk]`; tenant IVY/staging phải đặt `ALERT_EMAIL_SUBJECT_PREFIX="[IVY Chat]"` (các mẫu env đã có).
- **`AI_ALERT_EMAIL` không còn mặc định `dev@amoeba.group`**: Amoeba staging và KR production phải đặt biến này; KR production cần thêm `CONSOLE_FRAME_ANCESTORS=https://ama.amoeba.site` để iframe AMA SSO không hỏng.
- **Thẻ liên hệ trong widget** không còn số IVY `1588-0000`: chỉ còn "chat với nhân viên" cho đến khi có cấu hình theo tenant.
- **Lời đồng ý, cổng pilot, dữ liệu đối tác, bậc quyền KB, phiên bản KB, vùng nghiêm** đều mặc định tắt; tenant không cấu hình thì hành vi như cũ.
- Biến môi trường mới: xem `CONFIG.md` và các mẫu env (nhóm `IDENTITY_*`, `PARTNER_*`, `AGENT_PRESENCE_TTL_SEC`, `ALERT_UNCLAIMED_*`, `AI_*_TIMEOUT/BREAKER`, `METRICS_TOKEN`, `OPS_ALERT_*`, `ERROR_WEBHOOK_URL`, `WIDGET_FRAME_ANCESTORS`, `WIDGET_FONT_CSS_URL`, `BACKUP_*`, `SEED_*`, `SHARPTALK_*`).

## 5. Chưa kiểm được (nêu rõ để không hiểu nhầm là đã kiểm)

- **Go2Joy thật:** API đối tác (R8/R9 chưa giao), SSO từ Hotel Admin thật, hạ tầng của Go2Joy, staging.
- **Nhà cung cấp thật:** Anthropic/OpenAI (tool-calling, thời gian phản hồi), Voyage + Qdrant (**ngưỡng cổng khách chưa đo**; với embedding giả cổng không đóng theo chủ đề; phát hiện F-1 của w3a: khi Voyage chạy mà không có kết quả vector trong phạm vi, độ tin cậy dựa vào số tài liệu khớp có thể ≥ 0,62), Slack/SMTP thật.
- **Cài đặt:** chưa từng chạy `docker build`/`save`/`load`/deploy; chưa thử trên Linux; `nginx -t` chưa chạy; cơ chế backup chỉ kiểm với MySQL tạm và Qdrant giả.
- **Giao diện:** nhiều luồng chỉ kiểm bằng DOM; bản dịch es/ko/ja/zh mới kiểm khóa i18n; widget trong trình duyệt thật ở một số đường (thẻ liên hệ, banner đồng ý, nút Thử lại/Gặp nhân viên sau lỗi gửi, form xin email).
- **Pháp lý:** thông báo PDPL (vi/en) là **bản nháp**, cần Go2Joy và luật sư xác nhận căn cứ pháp lý (kho mã chỉ trích Nghị định 13/2023), bên kiểm soát, DPO, thời hạn lưu.
- **Quy mô:** thử 200 nghìn hội thoại cho số liệu pilot; chưa thử khối lượng thật.

## 6. Việc còn mở và quyết định cần bạn

- **Quyết định:** (1) push bản tích hợp mới lên `origin/test/go2joy-integration` (chỉ thêm commit, không force) hay mở PR từng nhánh theo thứ tự; (2) force-push 7 nhánh feature cũ; (3) trục phiên bản KB và danh sách chủ đề chỉ dành Quản lý; (4) quyết định RBAC cho Sales Admin: có menu Đơn hàng nhưng `GET /admin/orders` cần nhãn vận hành nên bị 403 (w3c); (5) file phông Pretendard 3 MB (OFL) đã được commit vào repo — xác nhận giấy phép trước khi đưa vào `main`.
- **Việc kỹ thuật:** chạy `gate:calibrate` trên staging có Voyage + Qdrant trước khi bật `guide_login` cho Go2Joy; chạy tool-calling với engine thật so với tra cứu trước; chế độ `PARTNER_DATA_MODE=tools` còn rủi ro chất lượng với ngày tương đối ("thứ bảy tới"); trường khả năng `tools` của engine chỉ sửa được qua API/SQL; mô hình vi/ko cần người bản ngữ rà soát; thông báo `pilot_denied`/`consent` không được lưu nên số liệu không đếm được; còn 8 biến env thiếu trong mẫu self-hosted do các luồng khác (`env:check`); việc rà chéo `ai-coach` không có audience.
- **Ba lần ngắt giữa chừng** (hạn mức API, token hết hạn) đã được xử lý bằng cách đánh thức lại từng agent từ trạng thái đã commit; không mất việc.
