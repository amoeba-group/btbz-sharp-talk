# RPT-261013 — Tra cứu dữ liệu đối tác (partner-data): hợp đồng, module, client thật, nối vào chat (stream s4)

- Ngày: 2026-10-13 · Kế hoạch: `docs/plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md` §3.4 (SG-30, SG-31, SG-32) · Kiểm thử: `docs/test/TCR-261013-Partner-Data.md`
- Nhánh: `feature/go2joy-s4-partner-data` (từ `test/go2joy-integration` `f7266697`) · PR: chưa mở · Chưa push, chưa deploy
- ⚠️ **API thật của Go2Joy (R8/R9) chưa được giao.** Tất cả xây theo hợp đồng nháp của Amoeba (`docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml`) và kiểm bằng mock + máy chủ giả cục bộ. Chưa có lần gọi nào tới Go2Joy.
- Mặc định TẮT: `PARTNER_DATA_ENABLED` (env) **và** `tenants.partner_data_enabled` (tenant) đều phải bật; `PARTNER_API_MODE` mặc định `mock`.

## 1. Đã làm
| Lớp | Thay đổi |
|---|---|
| SG-30 hợp đồng | `docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml` (OpenAPI 3.0.3, v0): `policies`, `rates`, `bookings`, `settlement` + `ping`; tham số đóng, **không có hotelSn/hotel_id ở bất kỳ query/body nào**; khách sạn đi bằng `X-Hotel-Sn` do máy chủ SharpTalk đặt từ claims đã xác minh + khóa dịch vụ + chữ ký HMAC tùy chọn (có vector kiểm); mô hình lỗi, giới hạn tốc độ, phân trang, phiên bản, idempotency, tối giản PII. Kèm `API-REQ-Go2Joy-Partner-Data.md` (vi/en): mục đích, cần gì từ Go2Joy (R8/R9), câu hỏi mở. Một spec giữ cho tài liệu và `TopicRegistry` đồng bộ |
| SG-31 module | `apps/api/src/domain/partner-data/`: `PartnerCtx` có nhãn (chỉ từ `partnerCtxOf(session)`: claims đã ký, chưa quá 8 h, vai trò hợp lệ); `TopicRegistry` (danh sách chủ đề đóng, tham số đóng từ chối khóa kiểu hotel, vai trò theo chủ đề, projector danh sách trắng bỏ PII, định dạng khối dữ liệu); `money.util` (VND số nguyên, bất biến tiền tính phía server); bộ kiểm số sau sinh; bộ dò chủ đề xác định vi/en/ko; `PartnerDataService.resolve` (không bao giờ ném); `PartnerLookupLogService` (không bao giờ ném); `PartnerDataStep` (bước chat); cờ env + tenant; thông báo 6 ngôn ngữ; API cài đặt + audit |
| SG-32 client | `MockGo2JoyClient` (fixture theo hotelSn gồm khách sạn decoy 9999) và `HttpGo2JoyClient` (GET duy nhất, timeout, thử lại có jitter khi lỗi mạng/5xx, ngắt mạch theo tenant, SSRF guard dùng chung với probe, kiểm echo hotel + schema, cache Redis 30–60 s khóa theo tenant **và hotelSn**, chữ ký tùy chọn), chọn bằng `PARTNER_API_MODE`; credential từ `integration_credentials` (AES-256-GCM) qua luồng nhà cung cấp chung; "Test connection" (`/v0/ping`) |
| Nối chat/RAG | `ChatService` (tham số cuối, tùy chọn): bước giữa `orderContext` và tra cứu tái dùng → khối `PARTNER_DATA` + bằng chứng, `AnswerOpts.partnerData` cạnh `orderBlock` (quy tắc sao chép-không-tính, độ tin cậy sàn 0,6), **bỏ tái dùng ở cả lookup và record**, bằng chứng ở `retrieval_trace.partnerEvidence` (**không** vào `citations`), danh sách bảo vệ theo lời gọi cho moderation (mã 13–16 chữ số), kiểm số sau kiểm duyệt trước chân trang → hạ cấp "xác nhận sau + chuyển người"; thông báo cố định cho từ chối; bộ phân loại gán "ngoài phạm vi" không chặn câu hỏi đối tác. **Chọn bộ dò từ khóa/regex thay vì mở rộng JSON `classifyIntent`** (lý do ở `partner-intent.util.ts`) |
| Cấu hình + console | Nhà cung cấp `go2joy_partner_api` (`base_url`, `api_key`, `signing_secret` tùy chọn) ở **cả** `packages/types` `INTEGRATION_FIELDS` **và** bản chép tay `apps/web/.../integration-providers.ts`; thẻ "Partner data lookup" trong Tenant Settings › Other (master) với toast; i18n ×6 |
| Golden | `golden_questions.partner_ctx {hotelSn, role, mockSet}`; chạy qua cùng step với mock (không bao giờ API thật); `KnowledgeService.ask` nhận lượt đối tác; DTO `partner_hotel_sn/partner_role/partner_mock_set`, TSV cột 4; trần 60 câu giữ nguyên |
| Schema | 3 SQL (§3), `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv` |
| Mã lỗi | E5100–E5108 (E5109 để dành) |
| Tài liệu vận hành | `CONFIG.md` (bảng biến mới), `.env.SharpTalk-VN-Go2Joy.example` |

## 2. Tệp
- Mới: `apps/api/src/domain/partner-data/**` (constants, ctx, params, project, topics, numbers, intent, messages, money, api client, mock + fixtures, http client, credential, flag, log entity + service, data service, step, settings service/controller/mapper/DTO, golden service + util, module; 14 file spec; thêm 7 spec ở chat, moderation, knowledge, ai-coach, tenant), `apps/web/src/domain/partner-data/{PartnerDataCard.tsx, partner-data.hooks.ts, partner-data.service.ts}`, `docs/guide/API-REQ-Go2Joy-Partner-Data.{md,openapi.yaml}`, `sql/261016-{partner-lookup-logs,tenant-partner-data-flag,golden-partner-ctx}.sql`, TCR/RPT này
- Sửa nhỏ, cục bộ (dùng để merge): `chat/chat.service.ts` (+~150 dòng: import, tham số cuối, bước đối tác, 6 điểm nối, `answerWithPartnerNotice`, `handoff` nhận `notice/trace`), `chat/rag.service.ts` (+~35: `AnswerOpts.partnerData`, hằng số, khối prompt), `chat/chat.module.ts`, `moderation/moderation.service.ts` (+`protect`, `mergeProtected`), `knowledge/knowledge.service.ts` (`ask` nhận lượt đối tác), `ai-coach/{golden.service,golden-grade.util,ai-coach.controller,ai-coach.mapper,ai-coach.module,dto/request/golden.request,entity/golden-question.entity}.ts`, `tenant/{ecommerce-probe.util.ts,entity/tenant.entity.ts}`, `global/constant/error-code.constant.ts` (cuối đối tượng), `app.module.ts`, `packages/types/src/common/enum.types.ts`, `apps/web/src/domain/settings/{integration-providers.ts,SettingsEtcPage.tsx}`, `apps/web/src/i18n/locales/*/settings.json` (nối cuối các đối tượng có sẵn), `CONFIG.md`, env example

## 3. Migration (áp TRƯỚC khi deploy mã; staging `DB_SYNCHRONIZE=false`)
| Thứ tự | Tệp | Nội dung | Hoàn tác |
|---|---|---|---|
| 1 | `sql/261016-partner-lookup-logs.sql` | bảng `partner_lookup_logs` (`CREATE TABLE IF NOT EXISTS`, 3 chỉ mục) | `DROP TABLE partner_lookup_logs` |
| 2 | `sql/261016-tenant-partner-data-flag.sql` | `tenants.partner_data_enabled tinyint(1) NOT NULL DEFAULT 0` | `DROP COLUMN` |
| 3 | `sql/261016-golden-partner-ctx.sql` | `golden_questions.partner_ctx json NULL` | `DROP COLUMN` |

Đều cộng thêm, có mặc định, không `AFTER`; mã cũ bỏ qua; mã mới chọn các cột này nên **phải áp trước** (cột thiếu → 500). Idempotence: `SHOW COLUMNS … LIKE …` trước khi `ALTER`. Đã chạy thử cả ba (và chạy lại phần CREATE) trên một DB tạm; `docker/init-sql/01-schema.sql` đã đồng bộ; `npm run migrations:manifest` chỉ thêm ba dòng của nhánh này.

## 4. Kết quả kiểm
Xem TCR. Tóm tắt: jest API 2777 PASS (nền 2478, +299 ca mới; 3 suite lỗi nền Windows `embed-loader`, `heic-conversion`, `board-attachment` không thuộc nhánh), `packages/types` 262, `packages/common` 64, widget 61, tsc 0 lỗi ×3 (api, web, widget), `i18n:check` đủ 6 ngôn ngữ, manifest chỉ thêm 3 dòng, 3 SQL áp thử và áp lại được, boot thật (`Nest application successfully started`, cột/bảng đúng), luồng HTTP thật identify v2 → chat với mock, golden qua HTTP, console trên trình duyệt (toggle + toast, kết nối + SSRF guard), và **29/29 mutation an toàn bị bắt**.

## 5. Trạng thái deploy
| Môi trường | Code | Migration |
|---|---|---|
| dev | nhánh; kiểm thật trên scratch DB `scratch_s4` (đã xóa); `db_sharptalk` không đụng | chưa áp vào `db_sharptalk` (dùng cho scratch bằng synchronize) |
| staging | chưa | chưa; áp 3 SQL trên trước deploy |
| production | chưa | chưa |
Bật tính năng: cần `PARTNER_DATA_ENABLED=1` **và** công tắc tenant; ở chế độ `mock` trả lời bằng khách sạn mẫu (**không phải dữ liệu thật**) — console có huy hiệu cảnh báo.

## 6. Khác biệt so với PLN
- **Bộ dò chủ đề xác định (regex) thay vì mở rộng JSON `classifyIntent`** — kế hoạch cho phép chọn, đã chọn vì không đổi prompt của tenant khác, tham số do bộ phân tích của chúng tôi tạo ra (không có hotel từ mô hình), không thêm độ trễ, kiểm thử được. Đánh đổi: độ phủ thấp hơn (câu nối tiếp không có từ khóa không kích hoạt).
- Thêm trường tùy chọn `signing_secret` vào `go2joy_partner_api` (PLN chỉ nêu `base_url`, `api_key`) để thực hiện "header ký" của đề bài; không cấu hình thì yêu cầu đi không ký.
- Bộ kiểm số hai bậc (PLN: "mọi số tiền trong câu trả lời phải có trong khối dữ liệu"): số tiền và số ≥ 5 chữ số **chỉ** lấy từ khối dữ liệu (hoặc lặp lại từ câu hỏi); số nhỏ (ngày, giờ, %) cho phép thêm từ đoạn KB đã trích — để câu trả lời kết hợp chính sách KB không bị hạ cấp oan.
- Thêm `PartnerDataStep.handles()` + một nhánh nhỏ ở `ChatService` để nhãn "ngoài phạm vi" của bộ phân loại không chặn câu hỏi đối tác (PLN không nêu).
- Thông báo **không chuyển người** cho từ chối mà khách tự sửa được (sai vai trò, claims hết hạn, nhắc khách sạn khác) — theo PLN §1 mục 4; **có chuyển người** khi lỗi nằm phía chúng tôi (API sập, trả lời không dùng được, số không kiểm chứng được). Đề bài viết chung "thông báo + chuyển người".
- Cờ theo tenant là cột `tenants.partner_data_enabled` + API riêng `/partner-data/settings` (không đi qua `UpdateWidgetSettingsRequest`) để không động vào DTO/mapper tenant dùng chung.

## 7. VERIFIED / NOT VERIFIED
**VERIFIED (có số liệu ở TCR):** mọi thuộc tính an toàn trong yêu cầu bằng spec **và** bằng mutation; boot thật + cột; luồng HTTP thật (identify v2 → chat) với mock; golden qua HTTP; console trên trình duyệt; tsc ×3, i18n, manifest.
**NOT VERIFIED:** bất kỳ lần gọi nào tới API Go2Joy thật (hợp đồng, header, mã lỗi, chữ ký đều là giả định); chế độ `live` chỉ với máy chủ giả cục bộ; cache Redis thật của client (dùng cache giả); độ chính xác bộ dò chủ đề trên câu hỏi thật của lễ tân/quản lý Go2Joy; chất lượng câu trả lời với mô hình thật (engine stub không sao chép số — golden thật cần Claude); bản dịch 6 ngôn ngữ chưa được người bản ngữ rà (vi/ko/ja/zh/es do tôi viết); Redis cờ tenant 30 s; hiệu năng (NFR-001) — chỉ có độ trễ mock ~1–2 ms.

## 8. Còn lại / rủi ro chéo luồng
- **R8/R9** → thay `MockGo2JoyClient` bằng chế độ `live` sau khi đối chiếu hợp đồng; điều chỉnh `TopicRegistry`/projector theo đặc tả thật; chạy `golden` với Claude thật cho các câu hỏi có `partner_ctx`.
- **s1b** (`effectiveIdentity`): thay thân hàm `effectiveClaims` trong `partner-ctx.ts` (một chỗ, chú thích SWAP POINT) và hợp nhất tên biến môi trường tuổi tối đa (`PARTNER_CLAIMS_MAX_AGE_SEC` ↔ `IDENTITY_MAX_AGE`).
- **s2a/SG-06** (`audience_rank`, kho tái dùng): câu trả lời **của nhân viên** trong hội thoại có dữ liệu đối tác vẫn vào kho tái dùng không có chiều khách sạn (`agent.service.ts` `ingestReplyForReuse`); cần chặn khi hội thoại có `partnerEvidence`/`partner_lookup_logs`.
- **s5a** (retention/PDPL): thêm `partner_lookup_logs` vào `RetentionService.purgeExpired` (bảng có `hotel_sn`, vai trò, id phiên/hội thoại).
- **SG-50** (REFUSAL_REASON): các giá trị `partner_role_denied | partner_claims_stale | partner_param_rejected | partner_unavailable | partner_unverified` nằm ở `trace.reason` của tin hệ thống — gộp vào enum khi làm SG-50. `readableTrace` của console chưa hiển thị `partnerEvidence` (cố ý, chỉ nằm trong DB).
- **Xung đột merge dự kiến:** `chat.service.ts` (cùng các luồng s1b/s2b/s3b/s5d: tham số cuối constructor, vùng giữa `orderContext` và `answerReuse.lookup`, `handoff()`), `rag.service.ts` (cạnh `orderBlock`), `error-code.constant.ts` (cuối đối tượng), `docker/init-sql/01-schema.sql` + `sql/artefacts.tsv`, `golden-question.entity.ts`/`golden.service.ts` (s2a thêm `audience`, `expect_gate`), `settings.json` ×6 (nối cuối), `tenant.entity.ts` (s5d thêm `pilot_access`), `enum.types.ts`.
- Mở rộng sau: thẻ cấu hình golden cho `partner_ctx` trên console (hiện chỉ API + TSV); endpoint đọc `partner_lookup_logs` cho vận hành; SG-33 (tool-calling) dùng lại `PartnerDataService.resolve` với cùng schema đóng.
