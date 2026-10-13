# RPT-261013 — s1b: hết hạn claims, chống phát lại, dấu vết kiểm toán, bộ kiểm thử bảo mật

- Ngày: 2026-10-13 · PLN: `PLN-261012-Go2Joy-Stage1-Gap-Closure` §3.1 · REQ: D-04, D-05, D-13 (và D-03/D-07 phần còn lại của S1); SG-03, SG-04, SG-50, "phần theo dõi S1", kiểm thử bảo mật bổ sung (Gate 3/4)
- Nhánh `feature/go2joy-s1b-identity-audit` (nền `test/go2joy-integration` `f7266697`; **chưa push**, chưa có PR)
- Kiểm thử chi tiết: `docs/test/TCR-261013-s1b-identity-audit.md`

## 1. Thay đổi

| Commit | Việc |
|---|---|
| `46b324a8` | **Nền móng**: `effectiveIdentity()` (`session/identity.util.ts`) + bộ nhớ đệm chính sách; `tenants.identity_policy`, `conversations.hotel_sn/actor_role/ai_agent_id` + chỉ mục; enum đóng `REFUSAL_REASON` + trace builder; E5096/E5097; cờ phản hồi cộng thêm trên `SessionResponse`/`ChatTurnResponse`/`ConversationResponse`/`ScenarioTurnResponse` |
| `d9d5b914` | **SG-03**: claims quá `IDENTITY_MAX_AGE_HOURS` (mặc định 8, ghi đè theo tenant) coi như **khách** ở mọi nơi ra quyết định; `E5096` khi một lời gọi bị từ chối vì hết hạn; widget phát `identity-expired`, `embed.js` chuyển tiếp tới `ShopTalk.on('identity-expired')` (loader trước đó bỏ qua `ivy:event`); thẻ console "Chính sách đăng nhập có chữ ký" (MASTER) + trạng thái "hết hạn" ở đầu hội thoại, 6 ngôn ngữ. Đường chat cũng đóng dấu hội thoại và lưu `retrieval_trace.reason` + `agentId` cho mọi tin hệ thống/từ chối (SG-50 a, b) |
| `20f32f14` | **SG-04**: chống phát lại (Redis `SET NX`), `refuseV1`; **SG-50 c**: audit `embed.*`; **theo dõi S1**: đồng ý theo chủ thể dữ liệu, DSAR đưa `identity_level` về guest, logout đóng issue, fork phát CJM `session_start`, backfill dấu hội thoại; bộ kiểm thử bảo mật UAT giai đoạn 4; `CONFIG.md`, env mẫu Go2Joy, guide SDK |
| `de0e0fe4` | **SG-50 c, d**: audit `kb.category_guest_visible_changed`; `moderation_logs` thử lại một lần + log ERROR; dấu hội thoại cho Messenger; whitelist trace của analytics |
| `3891a4e9` | **Sửa lỗi sẵn có tìm thấy khi chạy widget thật**: `host-bridge` thêm một listener `message` cho mỗi hook đăng ký nên mỗi tin của host tới mỗi handler nhiều lần (`identify` chạy 2 lần; khi fork có thể tách 2 phiên). Một listener dùng chung; test đỏ khi bỏ sửa |
| (commit tài liệu; SHA trong `git log` của nhánh) | Tài liệu TCR/RPT |

### Quyết định thiết kế (và lệch so với PLN)

1. **Đối tượng bị tính tuổi**: chỉ phiên có **claims đã ký** (identify v2). v1 (không claims), đăng nhập Shopify/Cafe24 và khách **không bao giờ** bị tính tuổi — không có `verifiedAt` để tính và các nền tảng đó có vòng đời phiên riêng; đòn bẩy cho v1 là `identity_policy.refuseV1`. PLN nói "E5049 IDENTITY_EXPIRED" nhưng E5049 đã bị `WIDGET_LOGO_REJECTED` chiếm → dùng **E5096**.
2. **Quá hạn có nghĩa là gì**: `level=guest`, `claims=null`, **`customerId=null`** (cổng xác thực đơn hàng và menu kịch bản cũng theo). `customer_id` lưu trên phiên **không** bị xoá (chỉ là cách nhìn); host ký lại cùng người/khách sạn/vai trò thì làm mới **tại chỗ**, không tách phiên.
3. **Biên**: "cũ hơn tuổi tối đa" nghĩa là *nghiêm ngặt* (đúng bằng vẫn hợp lệ); `verifiedAt` không đọc được = hết hạn (fail-closed); `verifiedAt` ở tương lai không bị tính tuổi.
4. **Công tắc vận hành**: `IDENTITY_MAX_AGE_HOURS=0` tắt hạn toàn nền tảng (hoàn tác khẩn cấp không cần deploy; giá trị rác rơi về 8). `IDENTIFY_REPLAY_GUARD=false` tắt bộ chống phát lại. Cả hai mặc định **bật**, ghi trong `CONFIG.md` và env mẫu Go2Joy.
5. **Cờ không phải lỗi**: `identityExpired:true` (chỉ khi đúng) trên lượt chat/kịch bản/poll và `identityExpiresAt` trên phản hồi phiên (để widget hẹn giờ **trước** khi tin nhắn kế tiếp chạm cổng); widget cũ bỏ qua. `E5096` chỉ ở nơi một lời gọi bị từ chối (`requireCustomer`: đơn hàng, DSAR).
6. **Chống phát lại**: khoá `embed:idrep:{tenant}:{sha256(hash)}`, TTL `2 × 600 = 1200 s`, giá trị là **digest SHA-256** của token đầu (PLN ghi "giá trị = token đầu"; digest đủ để so sánh và không để lộ thêm thông tin xác thực). Chỉ chữ ký **đã xác thực** mới được ghi. Cùng token gửi lại = idempotent; **bổ sung ngoài PLN**: gửi lại một `identify` đã **tách phiên** trả về đúng phiên đã tạo (nếu không mỗi lần thử lại sẽ thêm một dòng `sessions`) và phiên đã tách tự `identify` lại với cùng chữ ký được. v1 không đi qua bộ này (không có `iat`). Redis hỏng → **fail-open** (ghi log + audit `replayGuard:'unavailable'`); cửa sổ ±600 s vẫn bảo vệ.
7. **Một lỗi duy nhất cho mọi từ chối** của `identify` (E5048/401): chữ ký sai, thiếu secret, `iat` ngoài cửa sổ, phát lại, v1 bị từ chối — không có oracle; lý do thật chỉ vào log và `audit_logs`. `iat` phải là **số nguyên** ngay trong service (trước chỉ DTO kiểm).
8. **Audit**: PLN ghi actor `system` cho cả `kb.category_access_changed`; với lật `guest_visible` mình dùng **người dùng console làm actor** (ai đã mở nhóm là câu hỏi đầu tiên sau sự cố), `system` chỉ khi không có người dùng. `embed.*` đúng là `system`. Metadata không có PII: user id là khoá 16 hex theo tenant (`sha256(tenant:userId)`), `identify_rejected` khử trùng 1 dòng/phút/(tenant, lý do, user) để kẻ dò không làm phình bảng.
9. **Dấu hội thoại**: tạo ở `ChatService.getOrCreateConversation` (widget, nút kịch bản, sandbox preview dùng chung đường này) và `messenger-ingest.resolveConversation` (qua `ChatService.conversationStamps`); không còn nơi nào khác tạo hội thoại. `hotel_sn`/`actor_role` chỉ khi claims đã ký **và còn hạn**; **bổ sung**: khi khách đăng nhập tiếp trên cùng phiên, `identify` điền dấu cho hội thoại **đang mở chưa có dấu** (không ghi đè, không đụng hội thoại đã kết thúc) — nếu không, hội thoại bắt đầu lúc còn là khách sẽ rơi khỏi số liệu theo khách sạn.
10. **Enum lý do**: PLN liệt kê 9, brief thêm `identity_expired` → 10. `embedder_degraded`, `pilot_denied`, `role_manager_only` **chỉ định nghĩa** (stream khác dùng). Lý do của tin bàn giao là từ trong enum đóng (`moderation_blocked→moderation`, `policy→policy_deny`); `user_request` **không phải từ chối** nên giữ nguyên. Sự kiện cảnh báo (`EscalationEvent.reason`, `agent_alerts.reason`) **giữ từ cũ** vì kênh/console đang dùng. Tin **đồng ý** không được lưu (fail-closed, chưa có hội thoại) nên không có dòng để gắn trace.
11. **Đồng ý theo chủ thể** (câu hỏi treo cuối PLN §11): chọn "buộc hiện lại cho người mới". API: fork **cùng** khách hàng giữ đồng ý, **khác** khách hàng bắt đầu `pending` (kể cả người trước `declined`). Widget: phiên fork và phiên khách sau logout/`identify` lỗi được nhận với `replayConsent:false` và **xoá bản ghi đồng ý lưu trong trình duyệt** (nếu không widget phát lại "đồng ý" của người trước lên phiên mới). **Tác dụng phụ cần biết**: sau `ShopTalk.logout()` người dùng ẩn danh sẽ thấy lại banner đồng ý một lần.

## 2. Tệp chính

- API: `session/identity.util.ts` (mới), `session.service/mapper/controller`, `embed.service/module/controller`, `chat.service/controller`, `scenario.service`, `agent.service/mapper/agent-console.controller`, `ai-config.service`, `tenant.entity/service/controller/mapper/request`, `conversation.entity`, `privacy.service`, `moderation.service`, `kb-category.service`, `knowledge.controller`, `messenger-ingest.service`, `analytics.service`, `error-code.constant` (E5096–E5097).
- Types: `common/identity-policy.ts`, `common/refusal-reason.ts` (mới), `api/widget.types.ts`, `index.ts`.
- Widget: `public/embed.js` (một khối nhỏ, tự chứa), `lib/identity-expiry.ts` (mới), `lib/session-swap.ts`, `lib/api-client.ts`, `hooks/useChat.ts`, `useSession.ts`, `useEmbedCommands.ts`.
- Console: `IdentityPolicyCard.tsx` (mới), `SettingsWidgetPage.tsx`, `settings.hooks/service`, `PartnerContext.tsx`, `LiveChatPage.tsx`, `live-chat.service`, `history.service`, locales `settings`, `livechat` ×6.
- Schema/cấu hình/tài liệu: `sql/261016-tenant-identity-policy.sql`, `sql/261016-conversation-stamps.sql`, `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql`, `CONFIG.md`, env mẫu VN-Go2Joy, `docs/guide/임베드SDK설치가이드_Embed-SDK.ko.md` (§3.4, §3.5, bảng API).

## 3. PHASE 0 — phân tích sâu (kết quả)

**Nơi đọc claims / mức danh tính trước khi sửa** (tìm theo ký hiệu; mọi nơi *ra quyết định* nay dùng `effectiveIdentity`):

| Nơi | Đọc để | Nay |
|---|---|---|
| `chat.service` cổng khách (`identityLevel`) | chặn khách ở agent `login_guidance` | `identity.level` |
| `chat.service` cổng xác thực đơn hàng + `orderContext` (`customerId`) | đòi đăng nhập / lấy đơn | `identity.customerId` (**PLN không nêu**) |
| `partnerContextOf`, `partnerLabelOf` | dòng prompt, nhãn cảnh báo | `identity.claims` |
| `stampRegion` → `regionLookup` | định tuyến vùng | claims hiệu lực |
| `ai-config.service.getScenarioForSession` (`identityLevel`) | menu nút theo đối tượng | mức hiệu lực (**PLN không nêu**) |
| `session.service.requireCustomer` (`identityLevel`) | đơn hàng, DSAR | E5096 khi hết hạn (**PLN không nêu**) |
| `session.mapper` (`authenticated`) | widget | `authenticated=false` khi hết hạn |
| console: `agent.service`/`mapper`/`agent-console.controller`/`LiveChatPage` | hiển thị | cờ `identityExpired`, vẫn hiện khách sạn (là lịch sử) |
| `agent.service` tìm theo khách sạn (`JSON_EXTRACT identity_claims`) | tìm kiếm lịch sử | **giữ nguyên** (không phải quyết định) |
| `external-ticket.service.partnerNote` | ghi chú vé ngoài | **giữ nguyên**: mô tả ngữ cảnh lúc tạo vé; cắt nó khi hết hạn sẽ làm mất ghi chú của hội thoại đã bắt đầu trong hạn |
| `privacy.service` (DSAR), `embed.service`, `messenger-ingest` (tạo phiên khách) | ghi | DSAR thêm `identity_level` |

**Nơi tạo hội thoại**: `ChatService.getOrCreateConversation` (tin nhắn widget, nút kịch bản, sandbox preview — cùng đường) và `MessengerIngestService.resolveConversation`. Không có nơi nào khác (agent console, seed, script backfill chỉ cập nhật).

**Poll có rò qua fork không?** Không ở phía máy chủ: `GET /chat/conversation` đọc `findLatestConversation(session.id)`; fork tạo **hàng `sessions` mới**, nên token mới không có hội thoại nào và token cũ chỉ thấy hội thoại của mình (có test với ChatService + EmbedService thật). Phần còn lại: (a) tab khác còn giữ token cũ vẫn thấy hội thoại cũ (cùng trình duyệt, ngoài phạm vi); (b) **tái dùng câu trả lời** (`answer_reuse`) khoá theo tenant/ngôn ngữ/agent chứ không theo khách sạn — câu trả lời sinh ra cho khách sạn 1721 có thể phát lại cho 2204 (**SG-06, stream khác**, không sửa ở đây); (c) bộ nhớ đệm phiên 30 s chứa `verifiedAt` nên việc hết hạn tính theo đồng hồ hiện tại, không bị cũ.

**Phiên hết hạn/dọn thế nào hôm nay**: không có TTL phiên. Widget nhúng luôn mở phiên **mới** mỗi lần tải trang (không resume), bản độc lập mới resume theo token lưu; Shopify dùng cửa sổ 24 h cuộn. Dọn dẹp duy nhất là `retention.service` (phiên cũ hơn `CONVERSATION_LOG_RETENTION_DAYS` và không còn hội thoại tham chiếu; `0`/trống = giữ mãi). Nghĩa là một SPA như Hotel Admin giữ widget mở nhiều ngày thì claims **sống mãi** trước SG-03 — đúng D-04.

**Cũng phát hiện khi làm**: (1) mọi test dựng `verifiedAt` cố định (`'2026-10-06…'`, `'x'`) sẽ **đỏ sau SG-03** vì claims cũ hơn 8 giờ — đã sửa hai spec của nhánh này, **các nhánh khác cần sửa fixture tương tự khi gộp**; (2) `adoptSessionConsent` của widget phát lại đồng ý đã lưu **cho mọi phiên pending** nên chỉ đổi API là chưa đủ để buộc người mới đồng ý lại; (3) `ChatService.getOrCreateConversation(sessionId)` không nhận phiên nên không thể đóng dấu — đổi chữ ký thành `(sessionId, session?)` (tham số tuỳ chọn); (4) bộ test cũ của embed dùng `redis = { del }` — thay bằng kho `SET NX` trong bộ nhớ (`embed-test-doubles-spec.ts`).

## 4. Kết quả kiểm (cây cuối của nhánh)

| Kiểm | Kết quả |
|---|---|
| `tsc -p tsconfig.check.json` api, web, widget | 0 lỗi ×3 |
| jest API toàn bộ | 254 suite / 2712 test: 2709 đạt, 3 lỗi nền Windows (`embed-loader`, `heic-conversion`, `board-attachment.service`), không phải của stream này |
| jest `packages/types` / `packages/common` | 281 / 64 đạt |
| widget `node --test test/*.test.mjs` | 84/84 (nền 61) |
| `npm run i18n:check` | đủ 6 ngôn ngữ |
| `npm run migrations:manifest` | chỉ thêm 5 dòng (hai tệp SQL mới) |
| Boot API thật (DB tạm `scratch_s1b`, cổng 3021) | `Nest application successfully started`; cột/chỉ mục mới có trong DB (`SHOW COLUMNS`/`SHOW INDEX`); đã `DROP DATABASE` sau khi xong |
| "Bỏ sửa thì thất bại" | 32 bản sửa được tạm hoàn nguyên, cả 32 làm test đỏ (bảng ở TCR §3); cây sạch sau khi khôi phục |
| Smoke HTTP trên API thật | 35/35 (TCR §6) |
| Console trên trình duyệt thật | thẻ chính sách lưu/toast/audit; nhãn "expired" ở hàng chờ và đầu hội thoại (TCR §6) |
| Widget thật + host giả | identify, `identity-expired`, host ký lại, cùng phiên; fork một lần (TCR §6) |

Số test mới của nhánh: 231 jest API (+ 17 types) và 23 node widget.

## 5. Migration và trạng thái triển khai

| Hạng mục | Dev (`db_sharptalk`) | Staging | Production |
|---|---|---|---|
| Mã | Chưa (chỉ chạy trên DB tạm `scratch_s1b`) | Chưa — chưa push, chưa PR | Chưa |
| `sql/261016-tenant-identity-policy.sql` | Chưa áp (DB dev dùng chung, **không đụng**) | **Chưa — phải áp trước khi deploy** (`DB_SYNCHRONIZE=false`) | Chưa |
| `sql/261016-conversation-stamps.sql` | Chưa áp | **Chưa — phải áp trước khi deploy** | Chưa |
| PR / commit đã merge | không có | — | — |

**Mục `## Migration` cho PR**: hai tệp SQL ở trên (cộng cột nullable, không `AFTER`, có ghi chú idempotent và hoàn tác); thứ tự **trước khi deploy mã** (mã cũ + cột mới an toàn, mã mới + schema cũ gây 500 do TypeORM chọn cột thiếu); hai tệp độc lập nhau, áp theo thứ tự tên tệp sau các SQL `2610xx` của nhánh trước (`261007-*`, `261015-agent-profile-last-seen`); đồng bộ `docker/init-sql/01-schema.sql` đã làm; `npm run migrations:manifest` đã chạy (`git diff --ignore-space-at-eol --stat sql/artefacts.tsv` chỉ thêm 5 dòng); hoàn tác: `DROP COLUMN` (không mã nào đọc cột trước PR này). Biến môi trường mới: `IDENTITY_MAX_AGE_HOURS`, `IDENTIFY_REPLAY_GUARD` (đã ghi `CONFIG.md` + env mẫu Go2Joy).

## 6. Chưa kiểm được (nêu rõ)

- **UI thật**: đã chạy console (thẻ chính sách, nhãn "expired") và widget + host giả trên trình duyệt thật (xem TCR §6). **Chưa kiểm bằng UI**: banner đồng ý **hiện lại** sau khi đổi người (công cụ điều khiển trình duyệt không bấm được vào iframe khác origin nên không "Accept" được; hành vi chỉ được chứng minh bằng API, phiên fork ở trạng thái `pending`, và bằng test mức module của `session-swap`), ngôn ngữ ngoài tiếng Anh của thẻ chính sách (chỉ có `i18n:check`), bố cục hẹp/di động của thẻ.
- `embed-loader.spec.ts` (lỗi nền Windows): phần loader được phủ bằng hai bộ `node --test` chạy được trên Windows; **chưa chạy trên Linux/CI**.
- Báo E5096 từ `api-client.unwrapError` của widget chưa có test riêng; chuỗi "host ký lại → `identify` cùng phiên" được phủ từng mảnh, chưa chạy xuyên suốt trong trình duyệt với host thật.
- Redis ngắt giữa chừng và Redis cluster (chỉ có test fail-open với double).
- Bộ nhớ đệm chính sách 15 s mỗi tiến trình: sửa chính sách có hiệu lực trong tối đa ~15 s trên từng tiến trình (không có kênh vô hiệu hoá chéo tiến trình).

## 7. Việc còn mở và rủi ro gộp

- **Gộp nhánh**: các stream khác sửa cùng chỗ — `chat.service.ts` (constructor/`handleUserMessage`/`handoff`), `embed.service.ts`, `embed.js` (khối `ivy:event` của mình chèn ngay sau `if (e.origin !== baseOrigin) return;`, tách biệt khỏi chuỗi `else if`), `error-code.constant.ts` (E5096–E5097 chèn sau E5095), locales `settings.json`/`livechat.json` (chèn trước `"widgetAccess"` và `"openInHost"` thay vì cuối tệp), `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql` (cột `identity_policy` sau `embed_secret`; cột dấu trong `conversations` trước `PRIMARY KEY`). Mọi **fixture có `verifiedAt` cũ** ở nhánh khác sẽ đỏ.
- **Phụ thuộc stream khác**: SG-06/SG-10 (tái dùng câu trả lời theo khách sạn/vai trò) vẫn mở; `embedder_degraded`, `pilot_denied`, `role_manager_only` đã có trong enum nhưng chưa nơi nào phát; s5a (compliance/embed) nên đọc §6 mục đồng ý (banner hiện lại sau logout) khi sửa văn bản PDPL.
- **Quyết định treo cho chủ dự án**: (a) chấp nhận banner đồng ý hiện lại sau `logout()`; (b) có cần `IDENTITY_MAX_AGE_HOURS` khác mặc định 8 cho Go2Joy trước pilot không (cấu hình ở console, không cần deploy); (c) khi nào bật `refuseV1` cho Go2Joy (sau khi Hotel Admin ký v2).
- **Ngoài phạm vi, ghi nhận**: số dòng `sessions` vẫn tăng khi tách phiên (đã bớt nhờ gửi lại idempotent); `external-ticket` ghi chú đối tác dùng claims lưu, không phải claims hiệu lực.
