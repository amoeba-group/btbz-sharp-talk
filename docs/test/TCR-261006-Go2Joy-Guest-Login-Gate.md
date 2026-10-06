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
