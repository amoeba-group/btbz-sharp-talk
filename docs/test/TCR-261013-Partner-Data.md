# TCR-261013 — Tra cứu dữ liệu đối tác (partner-data): hợp đồng, module, client thật, nối vào chat (stream s4)

- Ngày: 2026-10-13 · Căn cứ: `docs/plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md` §3.4 (SG-30, SG-31, SG-32) · REQ §3.3 · Nhánh: `feature/go2joy-s4-partner-data` (từ `test/go2joy-integration` `f7266697`)
- ⚠️ **Phạm vi kiểm chứng.** API thật của Go2Joy (R8/R9) **chưa được giao**. Mọi thứ dưới đây được kiểm với **bản mock** và **một máy chủ giả `http.createServer` chạy cục bộ** theo đúng hợp đồng nháp của chính chúng tôi (`docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml`). **Chưa có một lần gọi nào tới hệ thống Go2Joy.** Tên header, mã lỗi, giới hạn là đề xuất.
- Mặc định **TẮT**: cần `PARTNER_DATA_ENABLED` ở máy chủ **và** công tắc tenant `tenants.partner_data_enabled`; `PARTNER_API_MODE=mock` mặc định.

## 1. Đơn vị / tích hợp (jest, `apps/api`)
| # | Nhóm | Spec | Ca | Kết quả |
|---|---|---|---:|---|
| U1 | Tiền: Money số nguyên VND, bất biến base+extra−giảm trực tiếp−Flash Sale−coupon=final tính phía server, bất biến đối soát, định dạng vi/en | `money.util.spec.ts` | 21 | PASS |
| U2 | `PartnerCtx` chỉ tạo bằng `partnerCtxOf`: claims ký, còn hạn (8 h, env), vai trò hợp lệ; chưa ký / quá hạn / từ tương lai / hotel sai / thiếu tenant bị từ chối (E5102) | `partner-ctx.spec.ts` | 7 | PASS |
| U3 | Tham số đóng: 21 cách viết khóa hotel (`hotelSn`, `hotel_id`, `Hotel-SN`, `propertyId`, `tenant_id`…) bị từ chối E5104 chỉ báo KHÓA không báo giá trị; khóa lạ, `__proto__`, kiểu sai, giá trị sai khuôn | `partner-params.util.spec.ts` | 32 | PASS |
| U4 | `TopicRegistry`: danh sách chủ đề đóng (E5103), vai trò theo chủ đề (settlement chỉ manager/internal), hình thức tra cứu bookings đúng một dạng, projector là danh sách trắng (tên/SĐT/ghi chú khách bị loại), từ chối bất biến tiền / tiền tệ lạ, làm sạch văn bản đối tác (ký tự điều khiển, dấu phân cách prompt), định dạng + danh sách bảo vệ | `partner-topics.spec.ts` | 17 | PASS |
| U5 | Bộ kiểm số sau sinh: cùng giá trị khác kiểu viết (1.200.000 ₫ / 1,200,000 VND / 1200000 / 1,2 triệu / 450k), số bịa → hạ cấp, tự cộng/làm tròn/đổi tiền → hạ cấp, mã sai → hạ cấp, số trong câu hỏi được lặp lại, số nhỏ lấy từ KB nhưng **số tiền thì không** | `partner-numbers.util.spec.ts` | 17 | PASS |
| U6 | Bộ dò chủ đề vi/en/ko (không LLM): tham số (kiểu giá, loại phòng, ngày, kỳ, trạng thái), câu hỏi "cách làm" không có mã/ngày không thành tra cứu, SĐT và ngày không bị nhầm mã đặt phòng, phát hiện nhắc **khách sạn khác**, **không bao giờ** phát sinh tham số hotel | `partner-intent.util.spec.ts` | 26 | PASS |
| U7 | `MockGo2JoyClient`: fixture theo hotelSn; **khách sạn decoy 9999 không bao giờ lộ** sang 1721/2204; mã đặt phòng của khách sạn khác = "không tìm thấy" (null) giống mã không tồn tại; phụ thu cuối tuần tính phía server; phân trang | `mock-go2joy.client.spec.ts` | 9 | PASS |
| U8 | `HttpGo2JoyClient` với máy chủ giả cục bộ: GET duy nhất, `X-Hotel-Sn` từ ctx và **không có hotel trong query**, chữ ký HMAC kiểm lại được ở phía nhận + vector cố định, timeout từng lần, **thử lại 5xx một lần cùng `X-Request-Id`**, rớt kết nối, **4xx không thử lại**, 429→E5108, 404→null, không JSON / sai cú pháp / quá lớn → E5105, **không theo redirect**, chưa cấu hình → E5106, **hotel echo khác ctx bị loại và không cache**, khóa cache chứa tenant **và hotelSn**, cache hit, **không phục vụ cache của khách sạn khác**, **mục cache bị đầu độc bị bỏ qua (kiểm lại)**, not-found cache 15 s, ngắt mạch (mở / nhanh không gửi / phục hồi / theo tenant), SSRF guard mặc định + allow-list của vận hành, URL cơ sở có credentials/query/sai scheme | `http-go2joy.client.spec.ts` | 27 | PASS |
| U9 | `PartnerDataService.resolve`: **tham số chứa mã khách sạn bị từ chối và KHÔNG có yêu cầu nào được gửi** (cả 4 chủ đề, 7 biến thể), chủ đề lạ E5103, **lễ tân bị chặn settlement (E5101) trước khi gọi API**, **fixture chéo khách sạn không trả gì**, echo hotel sai bị loại (E5105), tiền sai bất biến bị loại, PII không vào view, bằng chứng + hash bản chụp, **không bao giờ ném** (lỗi upstream, lỗi bất ngờ, DB không ghi được log) | `partner-data.service.spec.ts` | 23 | PASS |
| U10 | `PartnerLookupLogService` **không bao giờ ném** (insert lỗi, tạo row lỗi, đầu vào độc hại); tham số đã che; tham số bị từ chối ghi theo KHÓA | `partner-lookup-log.service.spec.ts` | 8 | PASS |
| U11 | `PartnerDataStep`: không làm gì khi env tắt / tenant tắt / khách / claims chưa ký / không có chủ đề; khối dữ liệu dựng phía server theo ngôn ngữ; thông báo (vai trò, claims hết hạn, **nhắc khách sạn khác**, API sập → có chuyển người, trả lời sai hotel → không bao giờ lộ dữ liệu); `verify` hạ cấp số bịa (E5107, có hàng log); `handles()` | `partner-data.step.spec.ts` | 24 | PASS |
| U12 | Cờ env/tenant (mặc định TẮT, `PARTNER_API_MODE` gõ sai = mock), cache cờ, audit bật/tắt, controller chỉ cho user tenant, credential service giải mã AES-256-GCM / cache / lỗi giải mã = "chưa cấu hình" | `partner-settings.spec.ts` | 13 | PASS |
| U13 | Hợp đồng OpenAPI ↔ `TopicRegistry` đồng bộ: tham số truy vấn đúng bằng tập đóng của từng chủ đề, **không có tham số hotel nào ngoài header X-Hotel-Sn**, chỉ GET, không requestBody, ma trận vai trò settlement, bất biến tiền | `partner-contract.spec.ts` | 9 | PASS |
| U14 | **Chat** (`handleUserMessage`): khối dữ liệu vào `AnswerOpts.partnerData`; bằng chứng ở `retrieval_trace.partnerEvidence` và **KHÔNG vào `citations`** (reply cũng không); danh sách bảo vệ tới moderation; **bỏ qua tái dùng ở cả lookup lẫn record** (kể cả khi kho có sẵn câu khớp); số bịa → câu trả lời bị giữ, thông báo + chuyển người, câu bịa không được lưu; thread đang chờ không báo lần hai; từ chối vai trò / claims / khách sạn khác không gọi mô hình; **bộ phân loại gán "ngoài phạm vi" không chặn câu hỏi đối tác**; tenant/phiên không dùng tính năng và ChatService dựng không có step **giống hệt cũ** | `chat.service.partner-data.spec.ts` | 19 | PASS |
| U15 | `RagService.answer` với `partnerData`: khối giữa `PARTNER_DATA_START/END`, quy tắc "chỉ là dữ liệu / sao chép nguyên văn / không tính", nâng độ tin cậy ≥ 0,6, **prompt giống hệt cũ khi không có/để trống**, đi cùng khối đơn hàng | `rag-partner-data.spec.ts` | 6 | PASS |
| U16 | Moderation: danh sách bảo vệ theo lời gọi giữ mã 16 chữ số và chuỗi giống SĐT, vẫn che phần còn lại, chỉ cho lời gọi đó, cùng danh sách của tenant, `mergeProtected` | `moderation.protect-per-call.spec.ts` | 9 | PASS |
| U17 | Golden: câu hỏi có hotel/role/mock-set chạy qua cùng step với **mock** (không bao giờ API thật, dù `PARTNER_API_MODE=live`), vai trò bị từ chối chấm được, chéo khách sạn chấm được, "khách sạn khác" chấm được; `sanitizePartnerCtx`, cột TSV thứ 4; `GoldenService` chuẩn bị lượt đối tác, **không im lặng chạy thiếu ngữ cảnh**, mock set lạ = lỗi từng câu không mất cả lượt, **giữ trần 60 câu**, lưu/sửa/xóa ngữ cảnh | `partner-golden.service.spec.ts`, `golden.service.partner.spec.ts` | 12 + 8 | PASS |
| U18 | `KnowledgeService.ask` với lượt đối tác (đường golden): gọi cũ y hệt, ids vào moderation protect, số bịa → hạ cấp, câu hợp lệ qua, thông báo từ chối làm câu trả lời không gọi mô hình | `knowledge-ask-partner.spec.ts` | 5 | PASS |
| U19 | "Test connection" `go2joy_partner_api`: SSRF guard (http / loopback / metadata / RFC1918 bị chặn trước khi gửi), `/v0/ping` với bearer và **không có header hotel**, khóa bị từ chối không lộ trong thông báo, không theo redirect, trường INTEGRATION_FIELDS | `ecommerce-probe.partner.spec.ts` | 7 | PASS |
| U20 | Toàn bộ jest API | | xem §4 | xem §4 |

## 2. Chứng minh test đỏ khi bỏ thuộc tính an toàn (mutation)
Mỗi dòng: sửa MỘT chỗ trong mã nguồn, chạy các spec liên quan, mong ít nhất một ca đỏ, rồi `git checkout` trả lại. Kịch bản: `scratchpad/s4_mutations.py` (không commit).

| # | Thay đổi (bỏ thuộc tính an toàn) | Kết quả |
|---|---|---|
| M01 | Bỏ nhánh từ chối khóa kiểu hotel (lý do `hotel_param`) | **ĐỎ** — 29 ca đỏ / 2 suite |
| M02 | **Chấp nhận** khóa hotel (bỏ cả kiểm khóa lạ) | **ĐỎ** — 3 ca đỏ / 2 suite |
| M03 | Bỏ danh sách vai trò theo chủ đề | **ĐỎ** — 6 ca đỏ / 3 suite |
| M04 | Bỏ kiểm hạn claims | **ĐỎ** — 3 ca đỏ / 2 suite |
| M05 | Chấp nhận claims chưa ký | **ĐỎ** — 1 ca đỏ |
| M06 | Bỏ kiểm echo hotel của phản hồi | **ĐỎ** — 4 ca đỏ / 3 suite |
| M07 | Khóa cache không chứa hotelSn | **ĐỎ** — 2 ca đỏ |
| M08 | Bỏ kiểm lại mục cache (mục bị đầu độc được tin) | **ĐỎ** — 1 ca đỏ |
| M09 | Không bỏ tái dùng ở **lookup** | **ĐỎ** — 1 ca đỏ |
| M10 | Không bỏ tái dùng ở **record** | **ĐỎ** — 1 ca đỏ |
| M11 | Bằng chứng lọt vào `citations` | **ĐỎ** — 1 ca đỏ |
| M12 | Bỏ kiểm số sau sinh trong chat | **ĐỎ** — 2 ca đỏ |
| M13 | Bộ kiểm số chấp nhận mọi thứ | **ĐỎ** — 11 ca đỏ / 3 suite |
| M14 | Chat không truyền danh sách bảo vệ cho moderation | **ĐỎ** — 1 ca đỏ |
| M15 | Moderation bỏ qua danh sách bảo vệ theo lời gọi | **ĐỎ** — 7 ca đỏ |
| M16 | Bỏ kiểm bất biến tiền | **ĐỎ** — 3 ca đỏ / 3 suite |
| M17 | 4xx bị thử lại | **ĐỎ** — 1 ca đỏ |
| M18 | Ngắt mạch không bao giờ mở | **ĐỎ** — 2 ca đỏ |
| M19 | Bỏ SSRF guard | **ĐỎ** — 1 ca đỏ |
| M20 | Log service ném lại lỗi | **ĐỎ** — 3 ca đỏ / 2 suite |
| M21 | Step chạy cả khi công tắc máy chủ tắt | **ĐỎ** — 1 ca đỏ |
| M22 | Bỏ từ chối "khách sạn khác" | **ĐỎ** — 2 ca đỏ / 2 suite |
| M23 | Projector để lọt tên khách (PII) | **ĐỎ** — 2 ca đỏ / 2 suite |
| M24 | Golden chạy im lặng thiếu ngữ cảnh đối tác | **ĐỎ** — 1 ca đỏ |
| M25 | Bộ dò bỏ qua số khách sạn khác trong tin nhắn (cả hai chỗ) | **ĐỎ** — 7 ca đỏ / 2 suite |
| M26 | `knowledge.ask` (đường golden) bỏ kiểm số | **ĐỎ** — 1 ca đỏ |
| M27 | Prompt mất quy tắc sao chép-không-tính | **ĐỎ** — 1 ca đỏ |
| M28 | Bỏ sàn độ tin cậy cho dữ liệu đối tác | **ĐỎ** — 1 ca đỏ |
| M29 | Câu hỏi đối tác lại bị nhãn "ngoài phạm vi" từ chối | **ĐỎ** — 1 ca đỏ |

29/29 mutation bị bắt (M25 lần đầu bị bỏ qua vì mỏ neo xuất hiện hai lần trong tệp; đã chạy lại thay cả hai chỗ). Sau mỗi lần, tệp được `git checkout` về bản đã commit; cây làm việc sạch ở cuối.


## 3. Kiểm thật trên API thật (scratch DB `scratch_s4`, port 3022, seed `ivyusa`, AI engine stub, `PARTNER_API_MODE=mock`)
| # | Kịch bản | Kết quả |
|---|---|---|
| L1 | Boot thật sau khi thêm `PartnerLookupLog`, `Tenant.partnerDataEnabled`, `GoldenQuestion.partnerCtx` (cột nullable có `type` tường minh, bài học A-1) | `Nest application successfully started`; `SHOW COLUMNS` đúng `partner_lookup_logs` (16 cột, 3 chỉ mục), `tenants.partner_data_enabled tinyint(1) NOT NULL DEFAULT 0`, `golden_questions.partner_ctx json NULL`; route `GET/PUT /api/v1/partner-data/settings` được map |
| L2 | `PUT /partner-data/settings` với `enabled: "yes"` | 400 (DTO `@IsBoolean`) |
| L3 | Bật tenant → `audit_logs` | hàng `partner_data.enabled`, `target=tenant:1`, metadata `mode=mock` |
| L4 | Phiên widget thật: ensure → consent → **identify v2 có chữ ký** (manager 1721, receptionist 1721) → `POST /chat/message` | 6 lượt: 3 lượt manager (giá, mã đặt phòng 16 chữ số, đối soát) → câu trả lời AI, `answeredFrom=partner_data`, `partnerEvidence[0]` đúng chủ đề + `hotelSn=1721`, `citations` chỉ là KB (6 mục); lễ tân hỏi đối soát → thông báo "chỉ dành cho tài khoản Quản lý", không chuyển người, trace `partner_role_denied / E5101`; manager hỏi "khách sạn 2204" → thông báo "chỉ tra cứu khách sạn bạn đang đăng nhập", trace `partner_param_rejected / E5104` |
| L5 | `partner_lookup_logs` sau L4 | 5 hàng: 3 `ok` (hotel 1721, manager, tham số đóng `{date,rateType,roomType}` / `{bookingCode}` / `{period,status}`, `source=mock`, hash bản chụp), 1 `denied E5101` (receptionist), 1 `rejected E5104` với `{"rejectedKeys":["hotel_mention"]}` (**không có giá trị**) |
| L6 | Golden qua HTTP: tạo 4 câu có `partner_hotel_sn / partner_role`, bulk TSV cột 4, vai trò sai (`ceo`) bị bỏ (lưu `null`); hai lượt chạy + so sánh | câu vai trò lễ tân → thông báo Quản lý, **PASS**; "khách sạn 2204" → thông báo từ chối, **PASS**; câu giá và câu mã đặt phòng với engine **stub** (không sao chép số) → **FAIL** "missing: 425.000" / "missing: G2J2610170001" — đúng kỳ vọng: bộ chấm bắt được câu trả lời không chứa số của khối dữ liệu |
| L7 | Console (trình duyệt, vite 5192 → API 3022): Tenant Settings › Other settings (master) | thẻ "Partner data lookup" hiện (huy hiệu cam "Sample data (mock)…"), tick/bỏ tick + Save → toast "Partner data lookup setting saved"; mở "Go2Joy partner data API" → ba ô (Base URL, API key, Signing secret (optional)); nhập URL `http://127.0.0.1:9` + khóa giả, Save → toast "Integration settings saved."; Test connection → toast + trạng thái **"Blocked: URL must use https"** (SSRF guard chạy) |

Dọn sau kiểm: dừng API và vite của nhánh này (theo PID), `DROP DATABASE scratch_s4`; không đụng `db_sharptalk`.

## 4. Tổng hợp chạy
| Kiểm | Kết quả |
|---|---|
| `tsc -p tsconfig.check.json --noEmit` api / web / widget | 0 lỗi / 0 / 0 |
| jest `apps/api` toàn bộ (một lần cuối) | **2777 PASS**, 3 FAIL (2780 ca; 264 suite: 261 pass, 3 fail). 3 suite lỗi là lỗi nền Windows đã biết, không phải của nhánh này: `embed/embed-loader.spec.ts`, `attachment/heic-conversion.spec.ts`, `board/board-attachment.service.spec.ts`. Nền `test/go2joy-integration` là 2478 PASS → nhánh này thêm **299** ca (311 ca ở 21 spec liên quan trừ 12 ca cũ của `ecommerce-probe.util.spec.ts`) |
| jest `packages/types` | 262 PASS (12 suite) |
| jest `packages/common` (`jest.check.config.js`) | 64 PASS (2 suite) |
| widget `node --test test/*.test.mjs` | 61 PASS |
| `npm run i18n:check` | es, ko, vi, ja, zh: complete |
| `npm run migrations:manifest` + `git diff --ignore-space-at-eol --stat sql/artefacts.tsv` | chỉ thêm 3 dòng của nhánh (`261016-golden-partner-ctx`, `261016-partner-lookup-logs`, `261016-tenant-partner-data-flag`); sau commit không còn khác biệt |
| 3 SQL trên một DB tạm (tạo `tenants`, `golden_questions` tối thiểu, áp từng tệp, áp lại phần CREATE) | không lỗi, idempotent; DB tạm đã xóa |
| Boot thật (§3 L1) | `Nest application successfully started` |
| Mutation (§2) | 29/29 bị bắt |


## 5. Ca biên đã cân nhắc nhưng KHÔNG kiểm / giới hạn đã biết
- **Không có API thật.** Hợp đồng, tên header, mã lỗi, chữ ký, giới hạn tốc độ, định dạng mã đặt phòng/loại phòng đều là giả định của chúng tôi; có thể phải sửa khi nhận R8/R9.
- Bộ dò chủ đề là **từ khóa/regex vi/en/ko** (lý do ở đầu `partner-intent.util.ts`): độ phủ thấp hơn LLM, câu hỏi nối tiếp không nêu chủ đề ("còn cuối tuần thì sao?") không tra cứu mà trả lời từ KB; từ vựng viết trước khi biết từ vựng thật của Go2Joy — mở rộng theo `partner_lookup_logs`.
- Bộ kiểm số **không** bắt số viết bằng chữ ("hai đêm"); số nhỏ (ngày, giờ, %) được phép lấy từ câu hỏi hoặc đoạn KB đã trích; số tiền và số ≥ 5 chữ số chỉ được lấy từ khối dữ liệu (một ví dụ giá trong KB sẽ **không** thay được giá thật của khách sạn — cố ý: hạ cấp còn hơn nói sai tiền).
- Đa chủ đề: một chủ đề lỗi ⇒ cả lượt thành thông báo (không trả dữ liệu từng phần).
- Câu trả lời của **nhân viên** (`AgentService.ingestReplyForReuse`) vẫn được ghi vào kho tái dùng không có chiều khách sạn — thuộc SG-06 (S1/S2), không đổi ở đây.
- Credential của tenant được giải mã và cache 60 s trong bộ nhớ; lưu khóa mới có hiệu lực trong vòng 60 s.
- Chưa kiểm với Redis thật cho cache của client (dùng cache giả); `RedisService.get/set` là cùng API đã dùng ở nơi khác.
- Console: chỉ kiểm ngôn ngữ English bằng trình duyệt; sáu ngôn ngữ kiểm bằng `i18n:check` (khóa đủ), chưa đọc từng bản dịch trên giao diện.
