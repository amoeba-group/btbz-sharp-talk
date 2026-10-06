# TCR-261006 — Cổng "chưa đăng nhập" theo trợ lý + identify v2 / ngữ cảnh khách sạn (PLN-261001 v1.1, S1 + S1b)

- Ngày: 2026-10-06 · Căn cứ: `docs/plan/PLN-261001-Go2Joy-Guest-Login-Gate.md` v1.1 (Q1–Q10 đã duyệt) · Nhánh: `feature/guest-login-gate`
- Phạm vi PR #1 (backend + lược đồ): B1–B9, H1, H3-API, H4, H5-API, H6, H7. Console/widget (W1–W8, V1–V5, H2 client) là PR #2.
- Môi trường: worktree Windows, Node 22, jest/ts-jest (map `@sharptalk/*` → src), `tsc --noEmit` qua `tsconfig.check.json` (map src; dist của checkout chính không chứa export mới), dev stack Docker (MySQL :3316 / Redis :6389 / RabbitMQ :5682).

## 1. Đơn vị (jest, `apps/api`)

### 1.1 Spec mới
| # | Spec | Ca | Kết quả |
|---|---|---|---|
| U1 | `embed/embed.service.v2.spec.ts` | canonical v2 đúng chuỗi `userId\|hotelSn\|role\|iat`; v2 hợp lệ → `identity_claims` (signed=true, verifiedAt) + `customers.last_claims`; claims + hash v1 → E5048 (Q8); đổi hotelSn sau ký → E5048; `iat` quá cửa sổ 600s → E5048; v1 vẫn chạy và claims = null | 6/6 PASS |
| U2 | `ai-engine/ai-config.service.scenario-audience.spec.ts` | không audience → mọi người; guest thấy guest+all; verified thấy verified+all; sanitize giữ guest/verified, bỏ giá trị lạ; sanitizeGuestGuidance: https-only, notice theo ngôn ngữ, template phải có `{hotelSn}`, camel/snake, rỗng → null; guestPolicy trong payload persona (agent gated / cột thiếu → open / không agent → open) | 9/9 PASS |
| U3 | `chat/chat.service.guest-gate.spec.ts` | `partnerContextOf` (đủ trường / thiếu tên / không ký → undefined); `partnerLabelOf`; `loginRequiredMessage` (mặc định theo ngôn ngữ, override tenant theo ngôn ngữ, fallback); 6 ngôn ngữ `loginRequired` | 8/8 PASS |

### 1.2 Spec cập nhật
| # | Spec | Bổ sung | Kết quả |
|---|---|---|---|
| U4 | `chat/rag-retrieval-scope.spec.ts` | `guestOnly` thêm vị từ `g.guest_visible = 1` + `kb.category IS NOT NULL`; không `guestOnly` → scope byte-identical | PASS |
| U5 | `knowledge/kb-category.service.spec.ts` | `setGuestVisible` bật/tắt; từ chối catalog; `list()` trả cờ, mặc định đóng; `ensure()` không chạm cờ | PASS |
| U6 | `agent/agent-alert.service.spec.ts` | `summary()` thêm dòng `Partner: …` khi có nhãn; không nhãn → text y hệt trước | PASS |
| U7 | `session/session.mapper.spec.ts` | response có `guestPolicy: 'open'`, `guestGuidance: null` mặc định; pass-through khi gated | PASS |
| U8 | `session/session.service.spec.ts` | `privacyNotice()` thêm 2 trường mặc định | PASS |
| U9 | 6 spec `chat/chat.service.*.spec.ts` | stub RAG thêm `agentGuestPolicy → 'open'` (cổng không rẽ nhánh) | 13 suite / 121 PASS |

### 1.3 Toàn bộ
`npx jest --silent` (apps/api): **208/211 suite, 2114/2117 test PASS**. 3 fail là spec phụ thuộc đường dẫn `\` và CRLF trên Windows (`heic-conversion`, `embed-loader`, `board-attachment`) — không liên quan, giống mọi lần chạy Windows trước (CI Linux xanh).

## 2. Kiểu & lược đồ
| # | Kiểm tra | Kết quả |
|---|---|---|
| T1 | `tsc --noEmit -p tsconfig.check.json` (apps/api, map `@sharptalk/*` → src) | PASS |
| T2 | `packages/types` `tsc` build | PASS |
| T3 | `node scripts/check-migrations.mjs --manifest` → `sql/artefacts.tsv` có 5 dòng `261001-guest-login-gate.sql` (ai_agents.guest_policy, kb_categories.guest_visible, tenant_ai_config.guest_guidance, sessions.identity_claims, customers.last_claims) | PASS |
| T4 | `docker/init-sql/01-schema.sql` có 5 cột tương ứng (first boot) | PASS |
| T5 | Entity: cột JSON/union khai `type` tường minh (A-1) | PASS (xem T6) |
| T6 | **Thực boot** API từ source (`ts-node -T -r tsconfig-paths/register`, dev stack Docker, `DB_SYNCHRONIZE=true`) | xem §4 |

## 3. Kịch bản tích hợp (chạy trên staging sau khi áp SQL + deploy — PR #2 mới có UI)
| # | Kịch bản | Kỳ vọng |
|---|---|---|
| S1 | Agent `open` (ivyusa): 5 câu mẫu trước/sau | trả lời byte-identical; `authReason` chỉ xuất hiện = `order` ở cổng đơn hàng |
| S2 | go2joy agent 10 `login_guidance`, phiên guest, hỏi "hạn hoàn tất đối soát" | `needsAuth: true`, `authReason: 'login'`, body = `loginRequired` VI (hoặc override), **không** gọi LLM (log `guest gate: sign-in prompt`) |
| S3 | Cùng phiên hỏi "đăng ký đối tác thế nào" (category công khai bật) | trả lời có trích dẫn từ category `guest_visible = 1` |
| S4 | Phiên guest xin gặp người | vẫn chuyển người (wantsHuman đứng trước cổng) |
| S5 | identify v2 (secret staging, HMAC canonical, iat hiện tại) | 200, `identityClaims.signed = true`; GET `/agent/sessions?hotel=1721` lọc ra phiên; header có claims |
| S6 | identify v2 với hash v1 + claims | 401 E5048, log `claims require v2 signature`-style mismatch |
| S7 | Chuyển người từ phiên có claims | email/Slack có dòng `Partner: … (hotelSn) · role`; ticket Gorgias có ghi chú `[SharpTalk] Partner: …` |
| S8 | Khách hàng: `GET /customers?hotel=A In` | hàng có `lastClaims` |
| S9 | Nút kịch bản audience `guest`/`verified` qua `/ai-config/scenario` trước/sau identify | đổi bộ chip |

## 4. Kết quả thực boot (T6) — 2026-10-06 20:00
- `npm run db:up` (sharptalk_mysql/redis/rabbitmq/qdrant) → `cd apps/api && ts-node -T -r tsconfig-paths/register src/main.ts` (TS_NODE_PROJECT=tsconfig.check.json): **`Nest application successfully started`** sau ~18s, không có `DataTypeNotSupportedError`/lỗi entity (A-1 OK).
- WARN duy nhất: `LegacyRouteConverter /api/v1/*` (có sẵn) và `ProductSyncService tenant 2 fetch failed` (Shopify không reachable offline) — không liên quan.
- `DB_SYNCHRONIZE=true` tạo 5 cột khớp `sql/261001-guest-login-gate.sql` (information_schema):

| table | column | type | null | default |
|---|---|---|---|---|
| ai_agents | guest_policy | varchar(16) | NO | open |
| kb_categories | guest_visible | tinyint(1) | NO | 0 |
| tenant_ai_config | guest_guidance | json | YES | NULL |
| sessions | identity_claims | json | YES | NULL |
| customers | last_claims | json | YES | NULL |

→ SQL thủ công cho staging/prod tương đương lược đồ entity; API đã dừng sau kiểm tra (port 3000 trả lại).

## 5. S2 — Console + widget (PR #2, nhánh `feature/guest-login-gate-ui`) — 2026-10-06

### 5.1 Đơn vị / kiểu / i18n
| # | Kiểm tra | Kết quả |
|---|---|---|
| S2-T1 | `tsc --noEmit` apps/web (map `@sharptalk/*` → src) | PASS |
| S2-T2 | `tsc --noEmit` apps/widget (map src) | PASS |
| S2-T3 | `tsc --noEmit` apps/api (thêm `partnerLink` vào list/state/mapper) | PASS |
| S2-T4 | `node --test` widget, 8 file: `embed-open-url` (4 ca mới: redirect / popup / sai source·origin / URL không http) + `host-bridge` (3 ca mới `openHostUrl`: frame → `ivy:open-url` kèm mode, native → cùng message, standalone → `window.open`, từ chối `javascript:`) | **50/50** |
| S2-T5 | jest `src/domain/agent` (+ `partner-link.spec.ts` 4 ca: thay thế `{hotelSn}`, URL-encode, không ký → null, thiếu template → null) | 17 suite / 122 PASS |
| S2-T6 | `npm run i18n:check` sau khi thêm 20 khóa aiSetting · 6 knowledge · 13 livechat · 6 customers · 5 widget `auth.*` | es/ko/vi/ja/zh **complete** |

### 5.2 Trình duyệt (dev stack Docker + API/console/widget chạy từ worktree, đăng nhập seed master ivyusa)
| # | Màn hình | Thao tác | Kết quả |
|---|---|---|---|
| S2-B1 | AI Settings › sửa trợ lý (W1) | Tạo trợ lý tạm `guest-test` → modal có fieldset "Visitors who are not signed in" (2 radio) → chọn "Only guide…" → Save | Toast "Agent saved." ; `/session/ensure` của phiên trên agent này trả `guestPolicy: login_guidance` |
| S2-B2 | AI Settings › Guest guidance (W2 + W8) | Nhập login/signup URL UAT, lời nhắc VI, template `…?hotelSn={hotelSn}` → Save → reload | Toast "AI configuration saved." ; 4 giá trị giữ nguyên sau reload |
| S2-B3 | AI Settings › Scenario buttons (W4) | 6 nút đều có select "Show to" (Everyone / Not signed in / Signed in) | Hiển thị đúng |
| S2-B4 | Knowledge › Categories (W3) | Category mới "HA Login Test" có nút "Signed-in only" → bấm | Toast "Category is now visible to guests.", nút đổi "Visible to guests" (globe xanh). Category "chưa đăng ký" (faq/policy…) không có nút — giống các nút Rename/Hide hiện có |
| S2-B5 | Widget (demo storefront localhost:5174, `?agent=guest-test`, phiên guest) (V1) | Hỏi "When is the reconciliation deadline for hotel partners?" | Trả lời **ngay** bằng system message "This information is for signed-in partners…" (không gọi LLM) + thẻ "Sign in to continue" với [Sign in] [Create a partner account] [Continue as guest] |
| S2-B6 | Widget › bấm [Sign in] (V2) | Widget gửi `ivy:open-url` → embed.js của trang demo | Loader khởi tạo điều hướng tới `go2joy-ha-uat.go2joy.io/sign-in` (browser pane chặn điều hướng ngoài — ghi nhận ở thông báo popup); logic redirect/popup được pin bằng S2-T4 |
| S2-B7 | identify v2 (H1/H7, qua `POST /public/embed/identify` với secret dev vừa tạo) | (a) claims + hash v1 → (b) claims + hash v2 canonical `userId\|1721\|receptionist\|iat` | (a) **401 E5048** (Q8) ; (b) **201** `authenticated: true`, `customerName`, `guestPolicy`, `guestGuidance` |
| S2-B8 | Widget sau identify | Hỏi lại câu S2-B5 | Trả lời đầy đủ từ KB (cổng bỏ qua vì phiên đã xác thực) |
| S2-B9 | Live chat (W6) | Danh sách: dòng phụ "A In Hotel Del Luna · HCM_001_001721 · signed"; mở phiên: header "Receptionist @ A In Hotel Del Luna · HCM_001_001721 · signed · 10/6/2026…" + nút "Open in host system" (title = `https://go2joy-ha-uat.go2joy.io/hotel-info-tabs?hotelSn=1721`); AI Briefing: "Partner of A In Hotel Del Luna · HCM_001_001721 · Receptionist" | Đúng |
| S2-B10 | Live chat › lọc khách sạn (W6) | `1721` → chỉ phiên đối tác; `no-such-hotel` → "No active sessions." | Đúng |
| S2-B11 | Customers (W7) | Cột "Hotel (latest)" = "A In Hotel Del Luna (1721) · Receptionist"; ô tìm `1721` → 1–1 of 1; tên lạ → "No customers found." | Đúng (API `POST /customers/search {hotel:'1721'}` → totalCount 1) |

Dọn dữ liệu sau kiểm: xóa agent `guest-test`, category "HA Login Test", `guest_guidance = NULL`, `embed_secret = NULL`, bật lại `must_change_password` của seed master (SQL trên DB dev local).

### 5.3 Chưa kiểm trên trình duyệt (để S4 staging)
- V4 (refetch chip sau `ShopTalk.identify` từ trang host) — identify ở S2-B7 gọi thẳng API nên không đi qua `useEmbedCommands`; đường code được review, không có test tự động.
- `audience` chip end-to-end (dev không cấu hình nút guest/verified) — lọc server đã có spec S1 (U2).
- `ivy:open-url` trên Android/iOS native — hoãn theo Q6 (RN đã xử lý `Linking.openURL`).
- Lời nhắc VI override: widget chạy EN trong phiên thử nên dùng lời mặc định EN; override theo ngôn ngữ có spec U3.

### 5.4 Sai lệch so với PLN (ghi để duyệt)
- **W8** (`hostLinkTemplate`) đặt trong card "Guest guidance" của AI Settings thay vì Settings › Embed: cùng JSON `guest_guidance`, cùng capability `AI_SETTINGS_MANAGE`, một đường lưu; Embed card nằm dưới `@RequireRank(master/director)` và không gọi `/ai-config`.
- **W2** nằm trong AI Settings (sau Scenario buttons) chứ không "cạnh Handoff" vì HandoffSection đã chuyển sang Settings › Basic từ trước.
- Backend thêm `partnerLink` (API tính từ template + claims đã ký) vào `/agent/sessions` và chi tiết hội thoại thay vì console tự ghép template — staff không có quyền đọc `/ai-config`.
