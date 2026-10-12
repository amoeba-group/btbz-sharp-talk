# PLN-261012 — Go2Joy Stage 1: đóng khoảng trống và củng cố phần đã có

- Ngày: 2026-10-12 · Yêu cầu: "lên plan nhận định kỹ để implement luôn phần chưa có, và phần đã có muốn cải thiện"
- REQ: `docs/analysis/REQ-261012-Go2Joy-Stage1-Gap-Closure.md` (D-01…D-20 là lỗi/rủi ro hiện có; SG-01…SG-85 là yêu cầu)
- Phạm vi: bảo mật danh tính và phiên · phân quyền KB theo vai trò · phiên bản KB · dữ liệu đối tác (mock trước) · cờ pilot theo khách sạn · audit, mô phỏng cổng, số liệu pilot · định tuyến (hiện diện thật) · PDPL · hạ tầng và vận hành trên phía Go2Joy. **Có UI** (wireframe ở §5) và **có migration** (§4).
- Trạng thái: **đã duyệt Phương án 2 (2026-10-13)**; các quyết định còn lại ở §9 giữ mặc định đề xuất cho đến khi bạn đổi. Tiến độ ở §11.
- Nhánh hiện trạng làm nền: `test/go2joy-integration` `73ff8acf` (đã push). Nhánh tài liệu này: `feature/go2joy-stage1-gap-plan` (local).

## 1. Tóm tắt quyết định

| # | Câu hỏi | Đề xuất | Lý do |
|---|---|---|---|
| 1 | Pilot 10/26 có cần dữ liệu thật (Gate 3)? | **Không.** Pilot mở bằng KB + ngữ cảnh đã ký. Giao ngay bản hợp đồng OpenAPI v0 (SG-30) và module `partner-data` chạy mock sau cờ tắt; client thật khi có R8/R9 | PDF tự ghi phương án này ở bảng rủi ro; R8 chưa tới; xây phần cứng chống rò (hotelSn từ claims, không từ lời người dùng) trước khi có API thật |
| 2 | Tra cứu dữ liệu: gắn vào luồng hiện tại hay tool-calling? | **Bước tiền xử lý** (giống `orderContext`), không dùng tool-calling ở pha 1 | Adapter LLM chỉ nhận văn bản; tool-calling cần viết lại adapter và vòng lặp (6–8 ngày) mà không thêm an toàn. Tool-calling để pha 2 |
| 3 | Bậc quyền KB | Thêm `kb_categories.min_audience` (`public\|partner\|manager`), **NULL = hành vi cũ**; theo **nhóm**, chưa theo tài liệu | Tương thích ngược, không đổi SQL cổng khách; theo tài liệu thêm 1,5 ngày, để sau |
| 4 | Lễ tân hỏi nội dung của quản lý | Trả lời cố định "hãy hỏi tài khoản Quản lý" kèm nút gặp nhân viên, ghi `ROLE_MANAGER_ONLY`; không báo CS tự động | Không lộ nội dung; không tạo việc cho CS khi người hỏi chỉ thiếu quyền |
| 5 | Đổi người/khách sạn trên cùng trình duyệt | **Tạo phiên mới** (tách), giữ nâng cấp khách → người dùng trên cùng phiên; thêm đăng xuất phía server | Một hội thoại = một (người, khách sạn, vai trò); cần cho cách ly, audit và số liệu |
| 6 | Hết hạn claims | `IDENTITY_MAX_AGE` mặc định **8 giờ**, quá hạn coi là khách, widget phát `identity-expired` để Hotel Admin ký lại | Phù hợp ca làm việc, đóng lỗ hổng "claims sống mãi" |
| 7 | Hiện diện nhân viên | Công tắc "Trực" + `last_seen` cùng lần poll 10 s; online = trực **và** thấy ≤ 90 s | Không phụ thuộc hệ thống ngoài; khắc phục D-09 |
| 8 | Cờ pilot | Bảng `tenant_pilot_hotels` + bộ nhớ đệm 60 s; khách sạn ngoài danh sách: **ẩn widget** (đổi được sang thông báo); khách chưa đăng nhập theo công tắc tenant | Có hiệu lực ngay không cần đăng nhập lại; Hotel Admin vẫn có thể tự bỏ tải embed.js |
| 9 | Phiên bản KB | `ui_version` ở tài liệu + chính sách tenant `kb_version_policy {referenceVersion,onMismatch}`; lệch → thêm một câu cố định sau kiểm duyệt; chưa gán → cảnh báo trong console | `reviewed_at` đã có làm ngày xác nhận; chỉ thêm một cột. **Chờ chốt trục phiên bản** |
| 10 | Pháp lý | Hồ sơ `vn_pdpl` (vi/en) nội suy thời hạn lưu và vùng xử lý phía server; **câu chữ do Go2Joy/luật sư duyệt** | Banner vi hiện còn CCPA/GA/365 ngày/Hoa Kỳ cố định (D-17) |
| 11 | Đường cắt lịch | Xem §6: **Phương án 2 (đề xuất)** dời UAT và pilot khoảng 1 tuần; **Phương án 1** giữ lịch nhưng cắt sâu | Tổng khoảng trống ≈ 133 người-ngày; lịch PDF chỉ chứa nổi phần P0 và một phần P1 |
| 12 | Cách chia nhánh | Mỗi luồng một nhánh, rebase theo thứ tự `S1 → S2 → S3 → S4 → S5`; lỗi nằm trong nhánh chưa mở PR (D-01, D-11, D-12) **sửa thẳng vào nhánh gốc** | Tránh PR vá chồng PR; các nhánh cùng sửa `chat.service.ts`, `rag.service.ts` |

## 2. Nguyên tắc và thứ tự

- **Không mở rộng thêm bề mặt trước khi bịt rò rỉ**: P0 trước, rồi P1, P2, P3. Mỗi mức có cổng kiểm riêng (§7).
- **Mặc định tắt và theo tenant** cho mọi hành vi mới; tenant không bật thì byte-identical (cột mới NULL = hành vi cũ).
- **Mọi thay đổi schema đi kèm SQL thủ công** (staging `DB_SYNCHRONIZE=false`), `npm run migrations:manifest`, đồng bộ `docker/init-sql/01-schema.sql`, mục `## Migration` trong PR; áp SQL trước khi deploy mã.
- **Chuỗi mới**: `t()` + 6 ngôn ngữ + `npm run i18n:check`; chuỗi phía API vào `SYSTEM_MESSAGES` (6 ngôn ngữ). Lưu/cập nhật/xoá có toast.
- **Sau mỗi thay đổi entity phải boot API thật** (`Nest application successfully started`), vì `tsc` không bắt lỗi kiểu cột `Object` của TypeORM.
- **Đồng bộ lại các nhánh đã tồn tại**: các nhánh mới xây trên `test/go2joy-integration`; khi 7 PR gốc merge vào `main`, rebase từng nhánh.

| Mức | Nội dung | Ý nghĩa |
|---|---|---|
| **P0** | SG-01, 02, 05, 06 (phần chống tái dùng), 60, 61, 62, 65 | Chặn rò rỉ và lỗi định tuyến trước khi người dùng thật dùng |
| **P1** | SG-03, 04, 10, 11, 20, 30, 31, 50, 51, 52 (tối thiểu), 63, 64 | Cần để qua UAT (Gate 3/4) |
| **P2** | SG-40, 52 (UI), 53, 66, 70, 80–85 | Cần trước pilot sản xuất |
| **P3** | SG-32, 33, 67, bậc quyền theo tài liệu, 👍/👎, streaming | Trong hoặc sau pilot |

## 3. Thiết kế theo luồng việc

### 3.1 S1 — Bảo mật danh tính và phiên (SG-01–06, 50)

**SG-01 (D-01).** Một dòng: `retrieveHybrid(tenantId, query, TOP_K, preferGroup, scopeAgentId, opts)` ở [rag.service.ts:659](apps/api/src/domain/chat/rag.service.ts:659). Test hồi quy: câu hỏi tiếp nối của khách vẫn không trả tài liệu ngoài nhóm công khai (`rag-answer-scope.spec.ts` khẳng định `opts` tới **cả hai** lời gọi). Sửa thẳng vào nhánh `feature/guest-login-gate` vì PR chưa mở.

**SG-02 tách phiên và đăng xuất thật.**
- `EmbedService.identify`: nếu `session.customerId` khác khách mới, hoặc `identityClaims.hotelSn` khác, **tạo phiên mới** (sao chép tenant, agent, ngôn ngữ, đồng ý), trả `session_token` mới trong phản hồi; widget thay token. Khách → người dùng (chưa có `customerId`) giữ nguyên phiên. Cùng người, cùng khách sạn: idempotent.
- `POST /public/embed/logout` (`@Public`, giới hạn tần suất): xoá `identity_claims`, `customerId`, đặt khách, kết thúc hội thoại nếu do AI giữ, xoá cache token → phiên Redis.
- Widget ([useEmbedCommands.ts](apps/widget/src/hooks/useEmbedCommands.ts)): `logout` gọi API; `<ChatTab key={sessionToken}>`; `queryClient.clear()`; chạy `adoptSessionConsent` cho phiên mới; `identify` lỗi trên phiên đã xác thực thì đặt lại thành khách mới (sửa chú thích sai); làm mới `customerName`.
- Tương thích: tenant Shopify/Odoo gọi `identify` cùng một người liên tục nên không bị tách. Widget cũ bỏ qua token mới trả về nên **phát hành widget và API cùng lúc** và giữ phản hồi cũ hợp lệ.

**SG-03 hết hạn claims.** `effectiveIdentity(session)` trung tâm: claims cũ hơn `IDENTITY_MAX_AGE` (mặc định 8 giờ, cấu hình theo tenant) coi như khách; dùng tại `handleUserMessage` (cổng), `partnerContextOf`, `partnerLabelOf`, `stampRegion`, mapper console. Quá hạn trả E5049 (`IDENTITY_EXPIRED`). `embed.js` chuyển tiếp `ivy:event` thành `ShopTalk.on('identity-expired')` (hiện bị bỏ qua) để Hotel Admin ký lại không cần tải lại.

**SG-04 chống phát lại.** Redis `SET NX` theo hash, TTL = 2 × cửa sổ (1200 s), giá trị = token phiên đầu; token khác dùng cùng hash bị từ chối. Cờ tenant `refuse_identify_v1` (mặc định tắt).

**SG-05.** `privacy.service` xoá `identity_claims` khi DSAR xoá.

**SG-06 / SG-10 (phần tái dùng).** `answer_reuse.audience_rank TINYINT NULL`; ghi theo hạng của phiên sinh ra câu trả lời; phát lại khi hạng người xem ≥ hạng ghi (NULL: chặn nếu tenant có bậc, mượn cơ chế `tenantScopesKnowledge`). Không ghi câu trả lời của nhân viên khi tenant có bậc (hoặc đóng dấu). Không tái dùng khi lượt dùng dữ liệu đối tác (SG-31).

**SG-50 stamps và lý do từ chối.**
- `conversations.hotel_sn`, `actor_role`, `ai_agent_id`, đóng dấu lúc tạo hội thoại từ phiên (nhờ SG-02 một hội thoại ↔ một danh tính). Chỉ mục `(tenant_id, hotel_sn, created_at)`.
- Enum đóng `REFUSAL_REASON` (`guest_gate`, `auth_gate`, `consent`, `pilot_denied`, `role_manager_only`, `moderation`, `low_confidence`, `embedder_degraded`, `policy_deny`) vào `retrieval_trace` của mọi tin hệ thống/từ chối cùng `agentId`; `audit_logs` (actor `system`) cho `embed.identify_ok`, `identify_rejected`, `identity_forked`, `logout`, `kb.category_access_changed`, `tenant.pilot_*`; thử lại và ghi lỗi khi `moderation_logs` thất bại.
- Mã lỗi mới (khối trống kế tiếp, kiểm khi viết mã): E5049 `IDENTITY_EXPIRED`.

### 3.2 S2 — Phân quyền KB, phiên bản KB, cổng khách (SG-10, 11, 20, 51)

**SG-10 bậc truy cập.**
- Schema: `kb_categories.min_audience VARCHAR(16) NULL`. NULL = cũ (`guest_visible=1` là public, ngược lại partner). Chỉ `'manager'` được truy xuất đọc; `guest_visible` vẫn là cờ công khai duy nhất. `setAccess()` ghi cả hai cột; endpoint `/guest-visible` cũ còn dùng được và xoá `'manager'` khi bật public.
- Mã: `Audience`, `audienceOf(session)` trong `packages/types` (mức xác thực khác `verified` → public; role `manager` hoặc `internal` → manager; còn lại verified → partner, fail-closed; phiên v1 `identityClaims=null` → partner). `RetrievalOpts.audience` trong `baseQuery` thêm `NOT EXISTS (… min_audience='manager' …)` cho mọi người không phải quản lý (kể cả khách của agent `open`).
- Vì Qdrant không lọc theo nhóm và `LEG_LIMIT=8` lấy trước khi lọc (D-15): khi có phạm vi, lấy nhiều hơn (8 → khoảng 24).
- Lễ tân hỏi chủ đề quản lý: ở nhánh độ tin cậy thấp ([chat.service.ts:1064](apps/api/src/domain/chat/chat.service.ts:1064)), chạy `groundingReport({audience:'manager'})`; nếu đạt ngưỡng trả `managerOnly` (6 ngôn ngữ trong `SYSTEM_MESSAGES`, tenant ghi đè như `guest_guidance.notice`) + chip "gặp nhân viên", trace `{reason:'role_manager_only', actorRole, requiredRole}`. Một lượt embed phụ chỉ ở nhánh này.
- Nút kịch bản: thêm đối tượng `manager`; `scenario.service.ts` kiểm lúc bấm (hiện không kiểm).
- Console: `CategoryManagerCard` đổi công tắc thành 3 trạng thái (W1); audit đổi bậc; i18n ×6.
- **SG-11:** đổi vai trò trên cùng phiên → hội thoại mới (đi cùng SG-02; nếu không, lịch sử lượt quản lý vào prompt của lễ tân).
- CSV import: `ensure()` không ghi bậc, nhóm mới vẫn đóng (fail-closed); cần bước mở trong console. Cột bậc truy cập trong CSV để sau.

**SG-20 phiên bản KB.**
- Schema: `kb_documents.ui_version VARCHAR(16) NULL`; `tenant_ai_config.kb_version_policy JSON NULL {referenceVersion, onMismatch:'caveat'|'hide'|'off'}` (cùng mẫu `guest_guidance`). Ngày xác nhận dùng `reviewed_at` đã có.
- Hành vi: chưa gán → không cảnh báo trong câu trả lời nhưng đánh dấu "chưa gán" trong console. Lệch → thêm **một câu cố định** (6 ngôn ngữ) **sau kiểm duyệt**, cùng mẫu chân trang (không đưa vào kho tái dùng), đọc `ui_version` của các tài liệu được trích tại thời điểm trả lời nên cũng phủ trường hợp phát lại. `hide` = thêm điều kiện vào `baseQuery`. Đổi phiên bản tham chiếu → `answerReuse.deactivateAll`.
- Điểm chạm: `RetrievedChunk.uiVersion`, `ask().sources`, `kb-document.entity`, `kb-revision.service`, `knowledge.service` (danh sách, cập nhật), `knowledge.request/mapper`, `bulk-import/export` (cột `ui_version`, giữ giá trị khi tệp cũ không có cột, tính vào `textUnchanged`), `scripts/go2joy/build-ha-policies-kb.py`; console: cột, bộ lọc, huy hiệu, thẻ cấu hình (W2). Khi backfill phải ghi `updated_at = updated_at` (bẫy của `migration_kb_provenance.sql`).
- **Chờ chốt trục phiên bản**: CSV hiện ghi "Hotel Admin v23.3.0/v23.4.0"; FR-010 và R10 dùng v0.4.1–v0.12.0.

**SG-51 cổng khách đo được.**
- Tách `decideGate(tenantId, agentId, {identityLevel, identityClaims}, query)` khỏi [chat.service.ts:908-939](apps/api/src/domain/chat/chat.service.ts:908), dùng chung cho chat và mô phỏng. `RagService.groundingReport()` trả độ tin cậy cùng danh sách (id, nhóm, độ tương đồng) và cờ `degraded`; `groundingConfidence` gọi lại nó.
- Trace cho **mọi** quyết định (kể cả cho qua): `grounded`, `threshold`, `topSimilarity`, 3 nhóm đầu, `vectorProvider`, `audience`. Không ghi nội dung câu hỏi. Tách `EMBEDDER_DEGRADED` khỏi `LOW_CONFIDENCE` (mốc 0,2 hiện không phân biệt được).
- Mô phỏng: mở rộng `POST /knowledge/ask` thêm `as_audience`; ô chọn "Thử với tư cách…" trong `KnowledgeQaPanel` (W3). Kèm test để bảo đảm tham số thật sự tới tầng truy xuất (đã có tiền lệ lỗi "điều khiển không làm gì" trong `knowledge-ask-agent-scope.spec.ts`).
- Hiệu chỉnh: `golden_questions` thêm `audience` và `expect_gate`; CLI `gate:calibrate` quét ngưỡng trên bộ có nhãn (khoảng 10 câu partner + 5 câu public theo TCR-261006 §7.2), báo precision/recall theo đối tượng. **Cần Voyage + Qdrant thật, chạy trên staging.** Vì độ tin cậy chỉ có hai mode, mục tiêu hiệu chỉnh thực tế là chọn giữa các mốc 0,5/0,6/… chứ không phải liên tục.

### 3.3 S3 — Định tuyến (SG-60–67)

- **SG-60 hiện diện.** `agent_profiles.last_seen`; endpoint `PUT /agent/profile` đã có, bổ sung: console gọi nó khi bật/tắt "Trực" và gắn `last_seen` vào lần poll cảnh báo 10 s hiện có. Online = `status='online'` **và** `last_seen` ≤ `AGENT_PRESENCE_TTL_SEC` (90). Chỉ báo hiện diện trong danh sách người dùng (W5). Không có công tắc "Trực" → coi là không trực (sửa lỗi "online mãi mãi").
- **SG-61 bộ tỉnh VN.** `packages/types/src/common/region-vn.ts`: 63 tên cũ + 34 tên sau sáp nhập + biệt danh; sửa chuẩn hoá cho `Ð`, hậu tố "city", ", Việt Nam", Hanoi/Sài Gòn/HCMC/TT Huế. Nút "Nạp bộ có sẵn" điền bảng 4 vùng; tỉnh chưa ánh xạ → `logger.warn` khử trùng + dòng "chưa ánh xạ: X" trong cảnh báo và nhãn vùng "?" trong hàng chờ. Kiểm `regionRouting` phía server. **Chỉ gán hai đội** (Bắc/Nam) cho từng loại, đúng định nghĩa Go2Joy; tên Tây Nguyên, Đông Nam Bộ, ĐBSCL không là danh mục riêng mà là tên tỉnh thuộc các loại hiện có.
- **SG-62.** `escalate()` ngoài giờ: đặt `replyChannel='email'` và `needsContactEmail`, giống `handoff()` ([chat.service.ts:1345-1366](apps/api/src/domain/chat/chat.service.ts:1345)). Trình dọn idle bỏ qua hội thoại WAITING chưa từng có người nhận.
- **SG-63.** Quét cảnh báo chưa ai nhận: sau `ALERT_UNCLAIMED_MINUTES` (mặc định 5) chuyển thành phát chung và đăng "CHƯA AI NHẬN" lên Slack. Cột `conversations.escalated_at` để tính tuổi.
- **SG-64.** `PATCH /agent/conversations/:id/routing {support_type, region?}`: cập nhật nhãn, chạy lại chọn người, báo người nhận, `audit`, ghi chú trong luồng; cho cả bậc staff có nhãn CS ("Chuyển sang Kinh doanh"); khách chọn nhầm đội dùng đường này.
- **SG-65.** `u.status === 'active'` ở cả hai nhánh; tính cảnh báo đang chờ vào tải; tie-break theo `last_seen`/tải; đóng dấu lại hoặc xoá `support_region` khi nhân viên đổi vùng và khi gán; Messenger không gọi bước hỏi đội.
- **SG-66.** Bộ đếm theo đội và vùng, tuổi từ `escalated_at`, mặc định lọc "vùng của tôi" (W6).
- **SG-67 (P3).** Chế độ `regionRouting.mode:'strict'` (`target_region` trên cảnh báo, hộp thư và webhook theo vùng, mở rộng theo thời gian), bảng `hotel_provinces` + CSV khi host không gửi tỉnh, giờ làm việc theo đội.

### 3.4 S4 — Dữ liệu đối tác (SG-30, 31; SG-32, 33 ở P3)

- **SG-30 hợp đồng.** `docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml` (v0) mô tả các chủ đề: `policies`, `rates` (theo giờ / qua đêm / theo ngày), `bookings`, `settlement`; mỗi chủ đề có tham số đóng (không có `hotelSn`/`hotel_id`), mô hình lỗi và giới hạn tần suất. Gửi Go2Joy xem xét theo PDF Phase 3.
- **SG-31 module `domain/partner-data/`.**
  - `PartnerDataService.resolve(ctx, topic, params)`; `TopicRegistry` (danh sách cho phép, lược đồ tham số đóng từ chối `hotelSn`/`hotel_id`, vai trò được phép, bộ chiếu tối giản PII, phân rã tiền).
  - `PartnerCtx` là kiểu có nhãn chỉ tạo bằng `partnerCtxOf(session)`, đòi `identityClaims.signed`, `verifiedAt` còn mới và vai trò. Khoá cache Redis (30–60 s) chứa `hotelSn`; phản hồi có `hotelSn` echo khác `ctx` bị loại.
  - `PartnerApiClient` giao diện; `MockGo2JoyClient` (fixture theo `hotelSn`); `HttpGo2JoyClient` sau (SG-32); chọn bằng `PARTNER_API_MODE=mock|live`; `PARTNER_DATA_ENABLED` và cờ theo tenant (mặc định tắt); timeout khoảng 4 s.
  - `money.util`: `Money` số nguyên VND, phân rã server tính (cơ bản + phụ thu − giảm trực tiếp − Flash Sale − coupon = cuối cùng) có kiểm bất biến; chuỗi đã định dạng sẵn; kiểm sau sinh: mọi số tiền trong câu trả lời phải có trong khối dữ liệu, sai → hạ về "xác nhận sau" + chuyển người.
  - Nối vào chat: bước tiền xử lý giữa [chat.service.ts:957](apps/api/src/domain/chat/chat.service.ts:957) và :983, trả khối `PARTNER_DATA` + bằng chứng, đưa vào `AnswerOpts.partnerData` bên cạnh `orderBlock` ([rag.service.ts:698](apps/api/src/domain/chat/rag.service.ts:698)); chủ đề và tham số lấy từ JSON `classifyIntent` mở rộng (không thêm lời gọi LLM). Không tái dùng khi dùng dữ liệu đối tác; trace `partnerEvidence` **riêng** (không vào `citations`, vì widget nhận nguyên khối `citations` và cơ chế tự giải quyết vé đếm độ tin cậy). Thêm danh sách bảo vệ theo từng lời gọi để bộ che PII mặc định (`\b\d{13,16}\b`) không che mã đặt phòng/đối soát dài.
  - Cấu hình & console: thêm nhà cung cấp `go2joy_partner_api` (`base_url`, `api_key`) vào `INTEGRATION_FIELDS` ([enum.types.ts:461](packages/types/src/common/enum.types.ts:461)) và danh sách nhà cung cấp chép tay ở `apps/web/src/domain/settings/integration-providers.ts` (sửa hai nơi); dùng lại lưu mã hoá AES-256-GCM, luồng lưu/thử và bộ chống SSRF.
  - Bảng `partner_lookup_logs` (tenant, hội thoại, tin nhắn, phiên, `hotel_sn`, role, chủ đề, tham số đã che, trạng thái, độ trễ, hash bản chụp). Mã lỗi E5095… (`PARTNER_API_UNAVAILABLE`, `PARTNER_ROLE_DENIED`, `PARTNER_CLAIMS_STALE`, `PARTNER_TOPIC_UNKNOWN`) chỉ ghi và ánh xạ sang thông báo + chuyển người (luồng chat không ném lỗi).
- **Kiểm thử:** tham số chứa mã khách sạn bị từ chối; fixture chéo khách sạn không trả gì; vai trò lễ tân bị chặn chủ đề đối soát; golden có trường hotel/role/mock.
- **SG-33 (pha 2):** mở rộng hợp đồng adapter (`tools`, `toolUses`, `stopReason`, khối nội dung), bộ chạy vòng lặp, xử lý stub/degraded giữa vòng, tương đương OpenAI; kiểm duyệt vẫn chạy một lần trên văn bản cuối.

### 3.5 S5 — Cờ pilot, số liệu, tuân thủ, hạ tầng (SG-40, 52, 53, 66, 70, 80–85)

- **SG-40 pilot.** Bảng `tenant_pilot_hotels(tenant_id, hotel_sn, note, active, added_by, created_at)` (bảng vì cần CSV và audit; `widget_access` giới hạn 50 mục) + `tenants.pilot_access JSON {enabled, guestAllowed, nonPilot:'hide'|'notice', notice:{lang}}`; bộ nhớ đệm Redis 60 s. **Kiểm có thẩm quyền** trong `ChatService.handleUserMessage` sau cổng đồng ý và trong `ScenarioService`, bằng `hotelSn` đã ký; trả thông báo hệ thống nhẹ, không lưu, không gọi LLM. Phản hồi `identify`/`ensure` có `pilot:{eligible}`. Không chặn lúc tạo phiên vì chưa biết khách sạn. Widget khởi đầu ẩn và chỉ hiện khi khách được phép hoặc khách sạn đủ điều kiện; thêm tin `ivy:visibility` đảo ngược được (hiện `hideFrame` gỡ iframe vĩnh viễn, [embed.js:595](apps/widget/public/embed.js:595)). Console: `PilotAccessCard` cạnh `WidgetAccessCard` (MASTER) (W4); audit `tenant.pilot_*`.
- **SG-52 số liệu.** `GET /analytics/pilot?group=hotel|role|day`: hội thoại, tự xử lý (không chuyển người và không có tin nhân viên; không dùng `aiResolutionRate` hiện tại vì tính cả hội thoại do nhân viên đóng), tỉ lệ chuyển theo lý do, độ tin cậy trung bình, tỉ lệ không nguồn, moderation (đọc `moderation_logs` qua `conversation_id`), CSAT, số lần cổng khách, khách sạn hoạt động so với danh sách pilot. Xuất CSV hội thoại để chấm tay; thẻ "Pilot" trong Thống kê (W7). 👍/👎 để P3.
- **SG-53.** Đo thời gian từng lượt (đo "thời gian đến phản hồi đầu tiên" vì không có streaming; định nghĩa lại NFR-001 hoặc xây streaming, xung đột với kiểm duyệt trước khi xuất); bộ ≥ 500 câu nhận diện ngôn ngữ và cổng đánh giá; kiểm trực quan ễ ợ ữ ặ ậ trong font monospace (`RichText`, các textarea tiếng Việt).
- **SG-70 PDPL.** `PRIVACY_PROFILE.VN_PDPL` (cột `varchar(16)` đủ); mở rộng `PRIVACY_NOTICE_KEYS` thêm `controller`, `crossBorder`, `rights`; hồ sơ cung cấp cả `title`/`body`/`retention`/`aiProcessor` (không còn CCPA hoặc GA); nội suy `{{retentionDays}}`, `{{region}}` phía server; hiển thị trong `ConsentBanner`, `PrivacyNoticePage`, 6 file `settings.json`; bump phiên bản đồng ý; thời hạn lưu mở rộng sang `customers` và `audit_logs`, sửa chú thích sai ở `.env.self-hosted.example:169-171` (0/trống = 365 ngày, không phải mãi mãi); nhật ký bằng chứng đồng ý; công cụ DSAR phía vận hành; cập nhật `AI-DPIA-GATE.md` (9 giá trị `feature:` thực tế so với 5 đã ghi), `PROCESSOR-REGISTER.md` (thêm Notion, hub AmoebaTalk, SMTP, jsDelivr, hạ tầng Go2Joy; trạng thái DPA đều "TBD"), liên hệ trong `INCIDENT-RESPONSE.md` (đều "〔지정 필요〕"). Điền `CONVERSATION_LOG_RETENTION_DAYS` theo giá trị pháp lý; giữ `AI_PROCESSING_REGION=US`.
- **SG-80–81 hạ tầng.** Phân phối image có tag và checksum (`npm ci`, base cố định); đồng bộ `init-sql` (6 migration thiếu, D-18) và chạy kiểm migration cả lần cài đầu; gỡ mặc định Amoeba (`widget-url.ts:15`, `AI_ALERT_EMAIL`, `ALERT_EMAIL_FROM`, seed ivyusa và tài khoản amoeba, cổng golden chỉ nằm ở staging); backup mã hoá + xoay + lịch + Qdrant; rollback bằng tag image + SQL hoàn tác; giới hạn log Docker; runbook 13 mục (vai trò, egress, phân phối, cài đặt, TLS/CSP, duyệt phát hành, rollback, backup, giám sát, sự cố 72 giờ A05, DSAR/lưu, quản lý khoá CRED_ENC_KEY, quy trình hỗ trợ của Amoeba).
- **SG-82 CSP/CORS.** Trang tài liệu cho front-end Go2Joy: `script-src` (nguồn widget; đoạn nhúng trong console là inline nên cần nonce hoặc tệp riêng), `frame-src`/`child-src` (nguồn widget), `connect-src` (nguồn widget và `'self'` vì loader dò `/apps/ivy/identity`, đường dẫn Shopify sẽ 404 — làm cho cấu hình được), `CORS_ORIGINS` đúng origin Hotel Admin (không dùng ký tự đại diện). Thêm `frame-ancestors` cho nginx widget; đóng gói font Pretendard cục bộ (iframe hiện lấy jsDelivr); đặt được tiêu đề iframe (hiện "IVY USA Support", [embed.js:470](apps/widget/public/embed.js:470)).
- **SG-83/84 quan sát và suy giảm.** `/metrics`; kênh cảnh báo webhook/email tổng quát (mất dịch vụ, lỗi engine không chỉ hết tín dụng, lỗi purge/backup; mặc định gửi Go2Joy thay vì dev@amoeba.group); readiness thêm Redis và Qdrant; theo dõi lỗi tương thích Sentry; timeout, thử lại, ngắt mạch cho Anthropic và Voyage; khi vector hỏng vẫn dùng fulltext (độ tin cậy 0,2 hiện làm mọi lượt chuyển người); thông báo sự cố riêng bằng tiếng Việt ("sẽ xác nhận lại" + chuyển người), widget thử lại hoặc đề nghị chuyển người sau lỗi.
- **SG-85 tài liệu vận hành (vi).** Chương cho CS/SA: hỏi đội, bảng vùng, vai trò/khu vực, cổng khách, bậc truy cập KB, chân trang, bật/tắt "Trực"; giờ làm việc; DSAR; bump đồng ý; sổ tay đào tạo với bài tập; rà soát bởi người bản ngữ.

## 4. Schema và migration (dự kiến; áp SQL thủ công trước khi deploy mã)

| Thứ tự | Tệp SQL | Nội dung | Luồng |
|---|---|---|---|
| 1 | `261013-answer-reuse-audience.sql` | `answer_reuse.audience_rank TINYINT NULL` | S1/S2 |
| 2 | `261013-kb-access-tier.sql` | `kb_categories.min_audience VARCHAR(16) NULL` | S2 |
| 3 | `261014-conversation-stamps.sql` | `conversations.hotel_sn`, `actor_role`, `ai_agent_id`, `escalated_at`; chỉ mục `(tenant_id, hotel_sn, created_at)` | S1/S3 |
| 4 | `261014-kb-ui-version.sql` | `kb_documents.ui_version`; `tenant_ai_config.kb_version_policy JSON` | S2 |
| 5 | `261015-agent-profile-last-seen.sql` | `agent_profiles.last_seen DATETIME NULL` | S3 |
| 6 | `261015-tenant-pilot-hotels.sql` | bảng `tenant_pilot_hotels`; `tenants.pilot_access JSON NULL` | S5 |
| 7 | `261016-partner-lookup-logs.sql` | bảng `partner_lookup_logs` | S4 |
| 8 | `261016-tenant-identity-policy.sql` | `tenants.identity_policy JSON` (`maxAgeHours`, `refuseV1`) | S1 |
| P3 | `hotel_provinces`, `agent_alerts.target_region` | R3, R2 nghiêm | S3 |

Mỗi tệp: không dùng `AFTER`, có ghi chú idempotent và hoàn tác; cập nhật `docker/init-sql/01-schema.sql` (kể cả 6 migration đang thiếu); `npm run migrations:manifest`; kiểm `node scripts/check-migrations.mjs --check` (lưu ý trên Windows báo lỗi do CRLF kể cả trên `main`, đối chiếu bằng `git diff --ignore-space-at-eol`). Cột kiểu nullable luôn ghi `type` tường minh trong `@Column`.

## 5. Wireframe (chỉ phần có UI)

**W1 — Nhóm tài liệu: ba mức truy cập (Knowledge › Nhóm)**
```
┌ Nhóm tài liệu ─────────────────────────────────────────────────────────────┐
│ Nhóm                       Tài liệu   Ai được xem                          │
│ Đăng nhập & đăng ký đối tác    4      [ Công khai ▾ ]                      │
│ Chính sách hủy phòng          12      [ Đối tác đã đăng nhập ▾ ]           │
│ Đối soát & tài khoản ngân hàng 6      [ Chỉ Quản lý ▾ ]   ⚠ Lễ tân sẽ được │
│                                         hướng dẫn nhờ tài khoản Quản lý     │
│ Lựa chọn: Công khai · Đối tác đã đăng nhập · Chỉ Quản lý                    │
└────────────────────────────────────────────────────────────────────────────┘
```

**W2 — Phiên bản giao diện (Knowledge › tài liệu và Cài đặt AI)**
```
Danh sách tài liệu:  Tiêu đề ………………  Nhóm ……  [v0.9.2]  Xác nhận 08/10   ┐ bộ lọc: [Tất cả ▾]
                     Tiêu đề ………………  Nhóm ……  [Chưa gán ⚠]                 ┘  Lệch / Chưa gán
┌ Phiên bản giao diện tham chiếu ─────────────────────────────────────┐
│ Phiên bản hiện hành: [ v0.12.0 ]                                    │
│ Khi tài liệu lệch phiên bản:  (•) Thêm lưu ý  ( ) Ẩn  ( ) Tắt        │
│ Lưu ý hiển thị (đa ngôn ngữ): "Hướng dẫn này theo bản v0.9.2…"       │
│ [Lưu]                                       Toast: Đã lưu cấu hình  │
└─────────────────────────────────────────────────────────────────────┘
```

**W3 — Thử với tư cách (Knowledge › Hỏi đáp thử)**
```
Agent: [ Joydesk ▾ ]   Thử với tư cách: [ Khách chưa đăng nhập ▾ ]  (Đối tác · Quản lý · Lễ tân)
Câu hỏi: [ Hạn hoàn tất đối soát là khi nào?                        ] [Hỏi]
┌ Kết quả ──────────────────────────────────────────────────────────┐
│ Quyết định: ✖ Từ chối — GUEST_LOGIN_REQUIRED                       │
│ Độ tin cậy 0,50 / ngưỡng 0,45 · Nhà cung cấp vector: voyage         │
│ Nhóm khớp: Đối soát (partner) 0,81 · Hủy phòng (partner) 0,62       │
│ Câu trả lời sẽ hiện: "Nội dung này dành cho đối tác đã đăng nhập…"  │
└────────────────────────────────────────────────────────────────────┘
```

**W4 — Phạm vi pilot (Cài đặt › Widget)**
```
┌ Phạm vi pilot theo khách sạn ─────────────────────────────────────┐
│ [x] Chỉ phục vụ các khách sạn trong danh sách                     │
│ Khách sạn ngoài danh sách:  (•) Ẩn widget  ( ) Hiện thông báo     │
│ Khách chưa đăng nhập (trang login): [x] Vẫn hiện widget            │
│ Thông báo (VI) [Chưa áp dụng cho khách sạn của bạn…            ]  │
│ Khách sạn (12)   [ + Thêm ] [ Dán danh sách ] [ Nhập CSV ]         │
│  1721  A In Hotel Del Luna     ghi chú: đợt 1        [Xóa]        │
│  2204  Khách sạn Biển Xanh     ghi chú: đợt 1        [Xóa]        │
│ [Lưu]                                    Toast: Đã cập nhật pilot  │
└───────────────────────────────────────────────────────────────────┘
```

**W5 — Hiện diện và bảng tỉnh (Live chat, Users, Tenant Settings)**
```
Đầu Live chat:   [● Trực ▾]   (Trực / Không trực)         Người dùng:  Tên      Vai trò  Vùng   Trạng thái
                                                                       Lan N.   CS       Bắc    ● Trực · 12 s
                                                                       Minh T.  SA       Nam    ○ Không trực
Bảng tỉnh → vùng:  [Nạp bộ có sẵn (63+34 tỉnh)]   Thử một tỉnh: [ Sài Gòn ] → Nam Trung… ✔
Cảnh báo ví dụ:  …Vùng: ? (chưa ánh xạ: "Tp Quy Nhơn")
```

**W6 — Hàng chờ: bộ đếm, tuổi, chuyển đội (Live chat)**
```
Tất cả đội 14 · Hỗ trợ khách hàng 9 · Kinh doanh 5      Vùng: [ Vùng của tôi ▾ ]
 #4821  Khách sạn Sao Mai (1721) · Quản lý   [Kinh doanh] [Bắc]   chờ 07:42  ⚠ chưa ai nhận
Đầu hội thoại:   Đội: Hỗ trợ khách hàng  Vùng: Nam      [ Chuyển sang… ▾ → Kinh doanh · CS ]
                 ↳ Toast: Đã chuyển sang Kinh doanh; SA đội Nam được báo
```

**W7 — Thống kê › Pilot**
```
Nhóm theo: ( ) Khách sạn  ( ) Vai trò  ( ) Ngày        [Xuất CSV hội thoại]
Khách sạn      Hội thoại  Tự xử lý  Chuyển người (lý do)       Tin cậy TB  Không nguồn  CSAT
1721 Del Luna      38       71%     29% (low_confidence 18%)       0.74         6%        4.5
Hoạt động 9 / Danh sách pilot 12
```

**W8 — Widget (không có màn hình mới, chỉ thông điệp)**
```
[Lễ tân hỏi đối soát]    Bot: "Nội dung này dành cho tài khoản Quản lý. Vui lòng nhờ quản lý của khách sạn…"  [Gặp nhân viên]
[Khách sạn ngoài pilot]  (widget ẩn)  hoặc:  "Chưa áp dụng cho khách sạn của bạn."
[Sự cố AI/Voyage]        Bot: "Hệ thống đang bận, chúng tôi sẽ xác nhận lại và nhân viên sẽ hỗ trợ bạn."  [Thử lại] [Gặp nhân viên]
[Banner đồng ý VN_PDPL]  Tiêu đề · Bên kiểm soát · Mục đích · Nơi xử lý ({{region}}) · Lưu {{retentionDays}} ngày · Quyền · DPO
```

## 6. Giai đoạn, ước lượng và đường cắt (người-ngày)

| Mức | Nội dung | Ngày |
|---|---|---:|
| **P0** | SG-01 0,25 · SG-02 2,75 · SG-05 0,1 · SG-06 (chống tái dùng) 0,5 · SG-60 1,5 · SG-61 1 · SG-62 0,75 · SG-65 0,5 · kiểm thử định danh 1,5 | **8,9** |
| **P1** | SG-03 1,25 · SG-04 0,75 · kiểm thử bảo mật bổ sung 2 · SG-10/11 8,25 · SG-20 7 · SG-30 1,5 · SG-31 (mock) 13,5 · SG-50 2,5 · SG-51 6 · SG-52 (tối thiểu) 3 · SG-63 1 · SG-64 1,5 | **48,3** |
| **P2** | SG-40 6 · SG-52 UI 3 · SG-53 6,5 · SG-66 1 · SG-70 9,5 · SG-80+81 14 · SG-82 3,25 · SG-83 7,5 · SG-84 3 · SG-85 4,5 | **58,3** |
| **P3** | SG-32 2,5 · SG-33 7 · SG-67 5 · bậc theo tài liệu 1,5 · 👍/👎 1,5 | **17,5** |
| | **Tổng** (không gồm streaming 6–8 ngày) | **≈ 133** |

### Hai phương án theo lịch PDF (Gate 2 = 10/16, Gate 3 = 10/21, UAT = 10/22–23, pilot = 10/26)

| | Phương án 1 — giữ lịch, cắt sâu | Phương án 2 — **đề xuất**: dời UAT và pilot khoảng 1 tuần |
|---|---|---|
| Gate 2 (10/16) | Phát hành 7 PR gốc + **P0** (8,9 ngày) | Như phương án 1 |
| Gate 3 (10/21) | SSO (SG-03, 04), hợp đồng OpenAPI (SG-30); **không có RBAC theo vai trò** (giảm nhẹ: không nạp chủ đề dành cho Quản lý vào KB pilot) | + **SG-10/11** (bậc quyền), SG-30, SG-03/04 |
| UAT | + SG-50, SG-51 (lõi) + kiểm thử bảo mật | + SG-63/64, SG-20 (lõi 4,5), SG-52 tối thiểu, báo cáo UAT |
| Pilot | + cờ pilot **phía Hotel Admin** (0,5 tài liệu), SG-70 tối thiểu (6), SG-82 (3,25), SG-84 (3) | + SG-40 (6), SG-83 cảnh báo/readiness (3,5), SG-85 (2,5), SG-70 đầy đủ |
| Tổng ngày | **≈ 34** | **≈ 67** |
| Hoãn | SG-10, SG-20, SG-31, SG-52, SG-53, SG-66, SG-80–83 đầy đủ, SG-85, P3 | SG-31, SG-52 UI, SG-53, SG-66, SG-80/81 (chạy theo nhịp R6 của Go2Joy), P3 |
| Rủi ro | Lễ tân có thể thấy nội dung quản lý nếu KB chứa; KB không gắn phiên bản; chưa đo UAT bằng số liệu | Cần khoảng 4 luồng song song; cần Go2Joy đồng ý dời mốc (PDF ghi Phase 5 là đề xuất, sẽ chốt cùng) |

Giả định năng lực: mỗi luồng một worktree riêng (S1–S5), người duyệt PR theo cổng. Tôi **chưa biết** năng lực song song thực của bạn; ước lượng người-ngày là khối lượng, không phải lịch cam kết. SG-80–81 (giao image, runbook, backup) phụ thuộc R6 và có thể trễ độc lập; riêng **đồng bộ `init-sql` (D-18)** nên làm sớm vì cài mới đang lỗi 500.

### Lộ trình theo ngày (Phương án 2)

| Cửa sổ | Việc | Cổng |
|---|---|---|
| 10/12–10/15 | Mở và merge 7 PR gốc (kèm SG-01 trong PR gate); áp 3 SQL staging; deploy staging; làm K2–K5; **P0 luồng S1/S3** | Gate 2 (10/16) |
| 10/19–10/21 | SG-02 hoàn thiện, SG-03/04, SG-10/11, SG-30, SG-50; chốt trục phiên bản KB | Gate 3 (10/21): SSO + RBAC + OpenAPI v0 |
| 10/22–10/28 | SG-20 lõi, SG-51 + hiệu chỉnh với Voyage thật, SG-63/64, SG-52 tối thiểu, kiểm thử bảo mật bổ sung, báo cáo UAT | Gate 4 (đề xuất 10/28) |
| 10/29–11/02 | SG-40, SG-70, SG-82–85 | Pilot (đề xuất 11/02) |
| Pilot | SG-31 → SG-32 khi có R8/R9, SG-33, SG-52 UI, SG-53, SG-67 | Gate 5 |

## 7. Kiểm thử và tiêu chí nghiệm thu

| Cổng | Tiêu chí | Cách kiểm |
|---|---|---|
| Gate 2 | Khách chưa đăng nhập không nhận tài liệu ngoài nhóm công khai, kể cả câu hỏi tiếp nối; định tuyến theo vùng có hiện diện thật; ngoài giờ khách để lại email và nhận trả lời | Spec hồi quy SG-01 (hai lời gọi truy xuất đều có `opts`); spec thang chọn người với hồ sơ có/không `last_seen`; spec `escalate` ngoài giờ; smoke trên staging |
| Gate 3 | Đổi người hoặc khách sạn tạo phiên mới; đăng xuất xoá claims; claims quá 8 giờ bị coi là khách; hash phát lại bị từ chối; lễ tân không nhận nội dung nhóm Quản lý | `embed.service.v2.spec` mở rộng (người khác tách phiên, cùng người khác khách sạn tách, cùng người cùng khách sạn idempotent, `identify` lỗi đặt lại, logout phía server, hết hạn, phát lại giữa hai phiên, ranh giới ±600 s, `iat` NaN/tương lai, hash của tenant khác, sau xoay secret); `rag-retrieval-scope.spec` (vị từ manager); spec phát lại câu trả lời quản lý không tới lễ tân; v1-verified coi như partner; luồng `managerOnly`; kiểm vòng lặp "không lộ lịch sử khách sạn 1 sang khách sạn 2" |
| Gate 4 | Có số liệu theo khách sạn/vai trò; từ chối đều có mã lý do; cổng khách có precision/recall đo bằng Voyage thật; token giả mạo/hết hạn bị từ chối; che PII | Endpoint `/analytics/pilot`, CLI `gate:calibrate` (staging), golden có `audience`, bộ kiểm bảo mật, soát log |
| Pilot | Khách sạn ngoài danh sách không được phục vụ; thông báo PDPL đúng; sự cố AI có thông báo đúng; runbook diễn tập | Spec và smoke SG-40; kiểm banner; ngắt Voyage/Anthropic giả lập; diễn tập backup/restore và rollback |

Mọi nhóm test cần cập nhật: `knowledge-ask-agent-scope.spec.ts`, `chat.service.guest-gate-flow.spec.ts`, `rag-answer-scope.spec.ts`, `rag-retrieval-scope.spec.ts`, `kb-category.service.spec.ts`, `answer-reuse.service.spec.ts`, `bulk-import/export` và `kb-revision` specs, `ai-config.service.scenario-audience.spec.ts`, `golden.service.spec.ts`, các spec định tuyến (`agent-alert.service.spec.ts`, `handoff-router.service.spec.ts`, `chat.service.region-routing.spec.ts`, `chat.service.team-routing.spec.ts`). Bộ chat dùng constructor theo vị trí: **mọi phụ thuộc mới thêm cuối và tuỳ chọn** (chat.service.ts:312-321). Chưa có bộ e2e HTTP (supertest): các điểm cắt qua nhiều tầng (identify → phiên → hội thoại → cảnh báo) cần ít nhất một test tích hợp mới.

## 8. Side-impact và rủi ro

| Rủi ro | Tác động | Biện pháp |
|---|---|---|
| Nhiều luồng cùng sửa `chat.service.ts`, `rag.service.ts`, `embed.service.ts` | Xung đột liên tục (đã thấy ở đợt rebase vừa rồi) | Thứ tự rebase S1 → S5; tái dùng kỹ thuật phát lại lời giải cũ (3-way) |
| Tách phiên khi `identify` | Widget cũ giữ token cũ; tenant Shopify/Odoo | Chỉ tách khi người/khách sạn khác; phát hành widget + API cùng lúc; kiểm trên tenant ivyusa |
| Bậc `manager` và cổng khách | Lọc thêm có thể làm cổng từ chối quá tay (D-15) | Lấy nhiều hơn khi có phạm vi; hiệu chỉnh bằng Voyage thật |
| Thay đổi mô hình tái dùng câu trả lời | Giảm tỉ lệ tái dùng, tăng chi phí LLM | Chỉ tác động tenant có bậc hoặc dữ liệu đối tác |
| Hiện diện (SG-60) | Nhân viên quên bật "Trực" → mọi cảnh báo thành phát chung | Nhắc khi vào console; cảnh báo "không ai trực" cho quản lý; quét chưa ai nhận (SG-63) |
| Dữ liệu thật qua hotelSn | Rò chéo khách sạn nếu `hotelSn` đến từ lời người dùng | Kiểu `PartnerCtx` có nhãn, tham số đóng, test chéo khách sạn, bỏ tái dùng |
| LLM tính sai tiền | Sai số liệu thanh toán | Phân rã server tính + kiểm số sau sinh; không để LLM tính |
| Chuyển dữ liệu ra nước ngoài (Anthropic, Voyage tại Hoa Kỳ) | Điều kiện NFR-005 và R16; Go2Joy sở hữu dữ liệu | Thông báo `vn_pdpl`, sổ nhà xử lý, DPIA; có thể cần chọn vùng hoặc nhà cung cấp khác — **quyết định pháp lý, không phải kỹ thuật** |
| Phiên bản KB nhiều trục | Cảnh báo sai | Chốt trục trước khi gán |
| `embed-loader.spec.ts` lỗi sẵn trên Windows | Che mất lỗi loader thật | Chạy trên Linux/CI cho thay đổi loader (`ivy:visibility`, `identity-expired`) |
| Cổng khách chỉ kiểm bằng embedding giả | Ngưỡng sai | Chặn bật `guest_policy=guide_login` trên Go2Joy cho đến khi chạy `gate:calibrate` |

## 9. Việc phía Go2Joy và quyết định cần bạn xác nhận

**Go2Joy cần cung cấp** (xếp theo ảnh hưởng): R8/R9 (đặc tả và khoá API; mở SG-32), R7 (cách ký identify v2 và khi nào gọi lại), tỉnh khách sạn ký trong identify và file định nghĩa vùng, R10 (trục phiên bản), R16 (thời hạn lưu, câu chữ PDPL, bên kiểm soát, DPO), R14 (danh sách pilot), R6 (nơi đặt hạ tầng), R15 (quy trình phát hành), tên hai nút tiếng Việt, cách xử lý khi không có SA, xác nhận SA trả lời trực tiếp chat, hộp thư theo vùng.

**Cần bạn chốt** (đề xuất mặc định trong ngoặc; chi tiết ở REQ §7):
1. Phương án lịch: **1** (giữ lịch, cắt sâu) hay **2** (dời UAT/pilot ~1 tuần, đề xuất)?
2. Pilot có cần dữ liệu thật không (đề xuất: không; SG-31 mock sau cờ).
3. Trục phiên bản KB (v23.x hay v0.4.1–v0.12.0).
4. Bậc quyền theo nhóm (đề xuất) hay theo tài liệu; danh sách chủ đề chỉ dành Quản lý.
5. Khách sạn ngoài pilot: ẩn (đề xuất) hay thông báo; khách chưa đăng nhập có thấy widget không.
6. Hiện diện: công tắc "Trực" + heartbeat (đề xuất).
7. Thời hạn lưu: 180 ngày hay giá trị pháp lý; ai duyệt câu chữ PDPL bản vi.
8. Phân phối bản cài trên hạ tầng Go2Joy.
9. Đính chính báo cáo đã gửi (REQ §2.3): sửa rồi mới gửi hay gửi kèm ghi chú.
10. Cách chia nhánh/PR: mỗi luồng S1–S5 một nhánh (đề xuất) và có cho phép sửa trực tiếp vào các nhánh chưa mở PR (SG-01, D-11, D-12) hay không.

**Việc tài liệu kèm theo (không chờ duyệt):** sửa hai báo cáo HTML (VI/KO): đổi nguồn ISN-3785, bỏ cam kết "người đang rảnh" cho đến khi SG-60 xong, và ghi rõ trạng thái cổng khách "chưa kiểm với embedding thật".

## 10. Sau khi duyệt

Theo CLAUDE.md: triển khai → `TCR-261012-*.md` (ca kiểm thử, kịch bản tích hợp, ca biên) → `RPT-261012-*.md` (thay đổi, danh sách tệp, kết quả kiểm, **trạng thái deploy: PR, SHA, từng môi trường và migration**). Lỗi đã phát hiện (D-01…) ghi lại bằng `FIX-261012-*.md` kèm mẫu phòng ngừa.

## 11. Tiến độ

| Ngày | Mục | Kết quả | Nhánh / commit |
|---|---|---|---|
| 2026-10-13 | **SG-01 / D-01** rò rỉ phạm vi khách ở câu hỏi tiếp nối | Xong: lượt tìm "câu hiện tại" nhận `opts`; `retrieveHybrid` bắt buộc đủ tham số (thiếu là lỗi biên dịch TS2554, đã thử); 3 test hồi quy (bỏ sửa thì đỏ); tsc 0, jest chat+knowledge+ai-engine 719 đạt; FIX-261012 | `feature/guest-login-gate` `7d577326`, `89df7e7b`, `a8154a89`; gate-ui rebase theo; `test/go2joy-integration` cherry-pick `57db9a9a`, `cd04f1fd`, `370e8c9b` (local, chưa push) |
