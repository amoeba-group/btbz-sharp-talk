# TCR-261013 — s1b: bảo mật danh tính (hết hạn, chống phát lại) + dấu vết kiểm toán

- Ngày: 2026-10-13 · RPT: `docs/implementation/RPT-261013-s1b-identity-audit.md` · PLN-261012 §3.1 (SG-03, SG-04, SG-50, phần theo dõi S1) và §7 (Gate 3 danh tính, Gate 4 bộ kiểm thử bảo mật) · REQ D-04, D-05, D-13
- Nhánh `feature/go2joy-s1b-identity-audit` (nền `test/go2joy-integration` `f7266697`, chưa push).
- Số ca tính theo `it()`/`test()`; số cuối ở §2 là kết quả chạy lại trên cây cuối của nhánh.

## 1. Ca đơn vị

| Yêu cầu | Tệp spec | Nội dung chính |
|---|---|---|
| SG-03 hàm trung tâm | `session/identity.util.spec.ts` (30) | `effectiveIdentity`: trong hạn / quá hạn; **biên** đúng bằng tuổi tối đa = còn hiệu lực, quá 1 ms = hết hạn; `verifiedAt` ở tương lai không bị tính tuổi; `verifiedAt` không đọc được = hết hạn (fail-closed); chính sách tenant ghi đè; `IDENTITY_MAX_AGE_HOURS=0` tắt hạn toàn nền tảng; giá trị rác rơi về 8 giờ; **không bao giờ tính tuổi** v1, đăng nhập nền tảng (Shopify/Cafe24), khách, claims chưa ký; `IdentityPolicyCache` (TTL, lỗi không cache, `invalidate`) |
| SG-03 / SG-04 kiểu chung | `packages/types/.../identity-policy.spec.ts` (7), `refusal-reason.spec.ts` (12) | Chuẩn hoá chính sách (0, 1e9, số lẻ, `"true"` bị bỏ; không đặt gì → `null`); enum `REFUSAL_REASON` **đóng** (đúng 10 giá trị); builder trace **loại bỏ** mọi khoá ngoài danh sách trắng (không thể mang câu hỏi của khách), cắt chuỗi, bỏ số không hữu hạn; ánh xạ `moderation_blocked→moderation`, `policy→policy_deny`, `user_request` giữ nguyên |
| SG-03 phiên | `session/session.service.identity.spec.ts` (15) | `identityOf` không đọc tenant khi không có claims ký; đọc chính sách qua cache (10 lần gọi = 1 lần đọc); đọc chính sách lỗi → mặc định (hạn **vẫn bật**); `requireCustomer` quá hạn → **E5096 (401)** cả ở cổng `verified` (DSAR); đăng nhập nền tảng không ảnh hưởng; mapper: quá hạn → `authenticated:false`, `identityExpired:true`, `identityExpiresAt`; khách / nền tảng / không truyền `identity` → **không thêm khoá nào** |
| SG-03 chat | `chat/chat.service.identity.spec.ts` (31) | Claims trong hạn: không bị chặn, prompt nêu khách sạn, hội thoại đóng dấu; quá hạn + agent `login_guidance` → cổng khách nhắc đăng nhập, **trace `identity_expired`**; agent mở: vẫn trả lời nhưng prompt **không còn** tên khách sạn; chính sách tenant (12 h giữ, 2 h cắt); cổng xác thực đơn hàng theo danh tính hiệu lực (quá hạn → `authReason:'order'`; đăng nhập nền tảng không bị tính tuổi); handoff/`escalate`: nhãn đối tác và tra vùng dùng claims hiệu lực (quá hạn → không nhãn, `regionLookup(…, null)`) |
| SG-03 cờ phản hồi | `chat/chat.controller.expiry.spec.ts` (5) | `identityExpired:true` trên lượt chat, lượt kịch bản, poll (kể cả chưa có hội thoại); claims trong hạn / khách / đăng nhập nền tảng → **không có khoá mới**, phản hồi y như cũ |
| SG-03 menu & console | `ai-engine/ai-config.service.scenario-audience.spec.ts` (+4), `agent/agent.service.identity-expiry.spec.ts` (7) | Quá hạn → menu khách quay lại (không còn menu đối tác); chính sách tenant; console: `identityExpired` ở hàng chờ và đầu hội thoại, khách sạn vẫn hiện (là lịch sử), chính sách đọc **một lần mỗi trang**, double `SessionService` cũ không làm hỏng |
| SG-03 tenant | `tenant/tenant.service.identity-policy.spec.ts` (16) | Lưu + audit; không đặt gì → `NULL`; trường bỏ trống **không** giữ giá trị cũ (gửi nguyên); `0`, `-5`, `721`, `1.5`, `NaN`, `1e9` → **E5097** và không lưu; audit lỗi không biến thành lỗi; mapper `toIdentityPolicy` (hạn đang áp dụng, mặc định nền tảng, công tắc tắt); quyền: MASTER+DIRECTOR đọc, chỉ MASTER sửa |
| SG-04 | `embed/embed.service.replay.spec.ts` (44) | Chữ ký v2 đã xác thực nhớ **2 × cửa sổ iat = 1200 s**, khoá = tenant + SHA-256(hash), giá trị là **digest** của token; **cùng** phiên gửi lại = idempotent; phiên **khác** trong cửa sổ → E5048 như chữ ký sai (cùng mã, status, message, thân phản hồi — **không có oracle**); hết hạn bộ nhớ; chữ ký **không** xác thực không bao giờ được ghi; theo tenant; Redis hỏng → **fail-open** (ghi vào audit `replayGuard:'unavailable'`) và cửa sổ iat vẫn áp dụng; v1 không qua bộ chống phát lại; công tắc `IDENTIFY_REPLAY_GUARD=false`; gửi lại một `identify` **đã tách phiên** trả về đúng phiên đã tạo (không tách lần hai), phiên đã tách tự `identify` lại được, phiên thứ ba vẫn bị từ chối; `refuseV1` (từ chối, lý do chỉ trong audit, v2 vẫn qua, tenant không chính sách/`{refuseV1:false}`/`'true'` vẫn nhận v1) |
| SG-50 (c) | cùng tệp | `audit_logs` actor `system`: `identify_ok` (có `hotelSn`, `role`, **không** có user id/tên/email/SĐT/tên khách sạn; user = khoá 16 hex theo tenant), `identity_forked` (nối hai phiên), `identify_rejected` (lý do `iat_window`/`bad_signature`/`replay`/`v1_refused`/`no_secret`; **một dòng/phút/(tenant, lý do, user)**), `logout`; ghi audit lỗi không làm hỏng đăng nhập hay biến từ chối thành 500; double cũ không có audit vẫn chạy |
| Theo dõi S1 | cùng tệp + `embed.service.rebind.spec.ts` | Đồng ý: **cùng** khách hàng đổi khách sạn/vai trò → giữ; **khác** khách hàng → `pending`, không thời điểm/phiên bản (kể cả khi người trước `declined`); khách → người dùng cùng phiên giữ đồng ý. Fork phát CJM `session_start` (bus lỗi không hỏng đăng nhập). Logout đóng issue của hội thoại AI (`customerEnded=false`), lỗi hook chỉ ghi log; không có gì để đóng thì không gọi. Backfill dấu: chỉ hội thoại **mở** và **chưa đóng dấu** của phiên, không ghi đè, không đụng phiên khác / hội thoại đã kết thúc / v1 |
| DSAR | `privacy/privacy.service.erasure-claims.spec.ts` | `identity_level` về `guest` cùng `customerId`, `identity_claims` (bỏ sửa thì thất bại) |
| SG-50 (a,b) | `chat/chat.service.identity.spec.ts` | Dấu hội thoại khi tạo (`hotel_sn`, `actor_role`, `ai_agent_id`): khách chỉ có agent; không có agent = `null`; gọi cũ không có phiên = không đóng dấu; hội thoại mở được tái dùng, **không đóng dấu lại**; cắt theo độ rộng cột. **Mỗi cổng có `retrieval_trace.reason` + `agentId`**: `guest_gate` (kèm độ tin cậy + ngưỡng, **không** có câu hỏi/SĐT), `auth_gate`, `moderation` (cả nhánh small-talk), `low_confidence`, `policy_deny`, `user_request` (gõ tay và nút), `identity_expired`; consent: **không lưu gì** (fail-closed); bất biến "mọi lý do đã lưu ∈ enum đóng ∪ {`user_request`}"; không còn từ cũ `moderation_blocked`/`policy` trong trace; sự kiện cảnh báo **giữ** từ cũ cho kênh/console |
| SG-50 (c, d) | `knowledge/kb-category.service.guest-audit.spec.ts` (7), `moderation/moderation.service.logwrite.spec.ts` (8), `messenger-ingest.service.spec.ts` (+2), `scenario.service.spec.ts` (+1), `analytics.service.spec.ts` (+2) | `kb.category_guest_visible_changed` (người dùng console làm actor; chỉ khi **thật sự đổi**; không có người dùng = `system`; audit lỗi không hoàn tác); `moderation_logs`: thử lại **một lần**, lỗi kéo dài ghi **ERROR** với id và **không** có đoạn trích/SĐT, quyết định (chặn / cho qua) không đổi, dòng thử lại là đối tượng mới và đoạn trích vẫn bị che PII; Messenger đóng dấu agent; nút kịch bản truyền phiên; whitelist trace giữ `reason` + `agentId` (kiểu số), bỏ phần còn lại |

## 2. Bộ kiểm thử bảo mật (UAT giai đoạn 4) — `embed/embed.security.spec.ts` (54)

| Tấn công | Ca | Kết quả mong đợi |
|---|---|---|
| `iat` tương lai | `+660 s`, `+1 ngày` | E5048, không tạo khách hàng |
| **Biên ±600 s** | `-600`, `+600`, `0` nhận; `-601`, `+601` từ chối | đúng ranh giới (đồng hồ giả) |
| `iat` không nguyên | `NaN`, `±Infinity`, số lẻ, chuỗi số, `null`, `undefined`, object, `1.7e9` — **kèm chữ ký khớp đúng giá trị đó** | E5048; phiên vẫn là khách |
| Chữ ký của tenant khác | v2 và v1 bằng khoá tenant khác | E5048; cùng thân với khoá đúng được nhận |
| Claims dưới hash v1 | `claims` + hash `userId` | E5048 (không "hiện nhưng chưa ký") |
| Chữ ký phát lại trên token thứ hai | xem §1 SG-04 | E5048 y hệt chữ ký sai |
| Sau xoay khoá | chữ ký khoá cũ / khoá mới | từ chối / nhận |
| Giả mạo ở DTO (`ValidationPipe` giống `main.ts`) | `role` ∈ {`admin`,`owner`,`MANAGER`,`Manager`,`'receptionist '`,`''`,`manager\|1`,`internal;drop`, số, mảng, object}; `hotel_sn` 33 ký tự, 1 MB, số, mảng, `null`, thiếu; `iat` lẻ/chuỗi/null; `hash` > 128; `user_id` > 120; `province` > 64; `hotel_name` > 200; `hotel_code` > 64; thiếu/sai kiểu token | từ chối; ba vai trò hợp lệ và các giá trị đúng biên (32/128/120/64/200/64) nhận; khoá lạ trong `claims` bị whitelist bỏ |
| Giới hạn tần suất | `identify` và `logout` | `20` lần / `60 000` ms (metadata `@Throttle`) |
| `EMBED_ORIGIN_ENFORCE=true` ở `ensure()` | origin lạ; lookalike (hậu tố, tiền tố, `http`, userinfo `@`); origin được phép; loader cũ không báo origin; chế độ quan sát (mặc định/`false`) | E5047 (403) và **không tạo dòng phiên**; được phép nhận; loader cũ qua; quan sát chỉ ghi log |
| **Cách ly chéo khách sạn sau fork** (ChatService thật + EmbedService thật trên cùng kho bộ nhớ) | Alice (1721) chat → Bob (2204) cùng token | poll của Bob rỗng, poll của token cũ chỉ thấy hội thoại của Alice; Bob chưa đồng ý → tin bị giữ lại (không gọi AI); sau khi Bob đồng ý, **history gửi cho model không chứa gì của Alice**, `partnerContext` nêu `hotelSn 2204` không phải 1721; hai hội thoại có dấu khác nhau; cùng người đổi khách sạn: giữ đồng ý, thread sạch; claims quá hạn → prompt không còn tên khách sạn, hội thoại không đóng dấu |

## 3. Chứng minh "bỏ sửa thì thất bại"

Mỗi bản sửa được **tạm thời hoàn nguyên** (tập lệnh đột biến ghi lại nội dung gốc rồi khôi phục; `git status` sạch sau khi chạy) và bộ test bảo vệ nó phải đỏ. Kết quả (số test đỏ khi bỏ sửa):

| Bản sửa bị hoàn nguyên | Test đỏ khi bỏ sửa |
|---|---:|
| SG-04 replay guard (kill switch) | 8 |
| SG-04 iat must be an integer | 2 |
| SG-04 refuseV1 | 2 |
| SG-03 guest gate reads stored level | 3 |
| SG-03 partnerContextOf reads stored claims | 3 |
| SG-03 order-auth gate reads stored customer | 1 |
| SG-03 region routing reads stored claims | 2 |
| SG-03 E5096 on requireCustomer | 2 |
| SG-03 scenario audience reads stored level | 2 |
| SG-03 response authenticated ignores expiry | 1 |
| SG-03 chat flag never set | 4 |
| SG-03 console expiry flag | 3 |
| SG-03 effectiveIdentity never expires | 11 |
| S1 consent carried for a different customer | 4 |
| S1 DSAR leaves identity_level verified | 1 |
| S1 logout does not close the issue | 1 |
| S1 fork emits no session_start | 1 |
| SG-50 stamp backfill | 1 |
| SG-50 audit events | 13 |
| SG-50 stamps at conversation creation | 6 |
| SG-50 handoff trace is the legacy word | 7 |
| SG-50 guest-gate refusal has no trace | 3 |
| SG-50 moderation log retry | 5 |
| SG-50 guest_visible audit | 3 |
| SG-50 messenger stamps | 1 |
| SG-50 analytics trace whitelist | 1 |
| SG-03 tenant policy range check | 6 |
| SG-03 embed.js forwards identity-expired | 3 |
| S1 widget replays consent onto a fork | 1 |
| S1 widget replays consent after logout | 1 |
| SG-03 widget timer re-arm ignores new signature | 1 |
| SG-03 widget poll flag de-dup | 2 |
| Bộ điều hợp host của widget (một listener dùng chung), chạy riêng sau đợt trên | 1 (`host-bridge.test.mjs`) |

32 bản sửa được thử, **cả 32 đều làm test đỏ** (cây git sạch sau khi khôi phục). Tập lệnh đột biến nằm ngoài kho (scratchpad của phiên); mỗi dòng ở trên là một thay đổi một biểu thức/khối trong mã nguồn (ví dụ `identity.level` thành `session.identityLevel`, `if (!sameCustomer)` thành `if (false)`).

## 4. Widget và loader (node --test, `apps/widget`)

| Tệp | Ca | Nội dung |
|---|---|---|
| `test/embed-identity-expired.test.mjs` (7) | chạy **embed.js thật** trên trang giả | `identity-expired` từ iframe widget tới `ShopTalk.on(...)`; `off()`; handler ném lỗi không chặn handler sau; **chỉ iframe của ta** (sai origin / sai source bị bỏ); `identified` chuyển tiếp kèm `ok`; sự kiện không nằm trong danh sách không chuyển; nhánh mới **không nuốt** `ivy:resize`/`ivy:unread` |
| `test/identity-expiry.test.mjs` (12) | `src/lib/identity-expiry.ts` thật + đồng hồ giả | Hẹn giờ đúng lúc hết hạn (không sớm); phiên đã hết hạn báo ngay; **một lần** dù poll lặp 5 s; timer + poll cùng một lần hết hạn = một sự kiện; **host ký lại → báo cả lần hết hạn kế tiếp**; khách/v1 huỷ timer; phiên khác bắt đầu sạch; `cancel()`; hạn 30 ngày (> giới hạn 32-bit của `setTimeout`) chia nhỏ, không bắn sớm; thời gian hỏng bị bỏ |
| `test/session-swap.test.mjs` (+2) | `src/lib/session-swap.ts` thật | Phiên fork và phiên khách sau logout được nhận với `replayConsent:false` |

`embed-loader.spec.ts` (jest) **lỗi nền trên Windows** nên không dùng được; phần loader được phủ bằng hai bộ node ở trên chạy được trên Windows. **Chưa chạy** `embed-loader.spec.ts` trên Linux/CI.

## 5. Kết quả chạy

| Bộ | Kết quả |
|---|---|
| jest API (toàn bộ, `apps/api`) | **254 suite / 2712 test**: 2709 đạt, 3 lỗi nền Windows đã biết (`embed-loader.spec.ts`, `heic-conversion.spec.ts`, `board-attachment.service.spec.ts`), cùng lỗi trên cây nền |
| jest `packages/types` | 14 suite / 281 test đạt (thêm 17 test: `identity-policy`, `refusal-reason`) |
| jest `packages/common` (`jest.check.config.js`) | 2 suite / 64 test đạt (không đụng) |
| widget `node --test test/*.test.mjs` | **84/84** (nền 61; thêm 23: loader 7, bộ hẹn giờ 12, session-swap 2, host-bridge 2) |
| `tsc -p tsconfig.check.json` api / web / widget | 0 lỗi ×3 |
| `npm run i18n:check` | đủ 6 ngôn ngữ |
| `npm run migrations:manifest` | chỉ thêm 5 dòng (`git diff --ignore-space-at-eol --stat sql/artefacts.tsv`) |
| Boot API thật (DB tạm `scratch_s1b`, cổng 3021) | `Nest application successfully started` trên cây cuối; cột `conversations.hotel_sn/actor_role/ai_agent_id`, chỉ mục `idx_conv_tenant_hotel_created` và `tenants.identity_policy` có trong DB |

## 6. Kịch bản tích hợp đã chạy trên API thật (cơ sở dữ liệu tạm `scratch_s1b`, cổng 3021)

Tập lệnh HTTP (ngoài kho) gọi API thật: **35/35 đạt** trên cây cuối. Dùng tài khoản master seed trên DB tạm (đặt `must_change_password=0` **chỉ trong DB tạm**).

| Nhóm | Đã chứng kiến |
|---|---|
| Chính sách (console) | `GET identity-policy` chưa cấu hình = mặc định 8 giờ; `max_age_hours` = 0 và 721 → **E5097 (400)**; không token → 401; lưu `{1 giờ, refuseV1}` đọc lại đúng, `effectiveHours:1`; audit `tenant.identity_policy_updated` |
| identify v2 | alice/1721 → phiên `verified` **cùng token**; phản hồi có `identityExpiresAt` (+8 giờ), không có `identityExpired`; chat → hội thoại có `hotel_sn=1721`, `actor_role=receptionist`, `ai_agent_id` |
| Chống phát lại | chữ ký của alice trên phiên thứ hai → **401 E5048**, **cùng status/mã/message** với chữ ký giả; cùng phiên gửi lại → 201 idempotent |
| Fork + đồng ý | bob (người khác) trên cùng token → **phiên mới**, `consentState: pending`; poll của bob rỗng, poll token cũ chỉ thấy hội thoại của alice; tin đầu của bob bị cổng đồng ý giữ lại; carol đổi khách sạn → phiên mới nhưng `consentState: granted` |
| v1 | không có chính sách: v1 được nhận; sau `refuseV1` → **401 E5048** |
| Hết hạn | sau khi lùi `verifiedAt` quá hạn: poll có `identityExpired:true`; `ensure` trả `authenticated:false` + `identityExpired:true`; lượt chat có cờ; `GET /orders` → **401 E5096**; host ký lại → cùng phiên, hiệu lực trở lại |
| Audit | `embed.identify_ok`, `identify_rejected` (lý do `bad_signature`/`replay`/`v1_refused`), `identity_forked`, `logout`: actor `system`, metadata không chứa user id/tên (chỉ khoá 16 hex) |
| Trace thật | tin bàn giao của stub AI lưu `{"reason":"low_confidence","agentId":1}` trong `messages.retrieval_trace` |

**Console (trình duyệt thật, DB tạm)**: thẻ "Signed sign-in (SSO) policy" hiện đúng giá trị đã lưu (Custom 1 giờ + checkbox v1); chọn "Platform default" + bỏ checkbox + Save → toast **"Sign-in policy saved"**, cột `identity_policy` về `NULL`, audit `{"cleared":true}`, dòng "In force now: 8 hours". Live chat: hàng chờ và đầu hội thoại của phiên quá hạn hiện nhãn cảnh báo **"expired"** thay cho dấu "signed", vẫn nêu khách sạn.

**Widget thật trong iframe + trang host giả (ký HMAC bằng secret của DB tạm)**: `ShopTalk.identify()` → API → phiên `verified`; sự kiện `identified` tới được host qua `ShopTalk.on` (loader trước đây bỏ qua); sau khi lùi `verifiedAt` quá hạn, **poll 5 giây của widget nhận cờ, widget gửi `ivy:event identity-expired`, `embed.js` chuyển tiếp, handler của host ký lại và gọi `identify` trên cùng phiên** (verifiedAt mới, không tách phiên). `identify` với người khác tạo đúng **một** phiên mới và một dòng `embed.identity_forked`. **Phát hiện khi chạy**: mỗi tin nhắn host tới handler của widget nhiều lần (một listener cho mỗi hook đăng ký) nên `identify` chạy 2 lần và có thể tách phiên 2 lần; đã sửa trong `host-bridge.ts` (commit riêng, test đỏ khi bỏ sửa) và chạy lại: đúng một `identified` và một fork cho mỗi `identify`.

## 7. Chưa kiểm / ca biên chưa có test tự động

- Giao diện thật: thẻ **Chính sách đăng nhập có chữ ký** trong console (nhập giờ, tắt/bật v1, toast), huy hiệu "hết hạn" ở đầu hội thoại, banner đồng ý hiện lại sau khi đổi người. `apps/web` không có bộ test; chỉ có `tsc` và `i18n:check`.
- Widget trong iframe thật với host thật: bắn `identity-expired` → host ký lại → `identify` trên cùng phiên (đã phủ ở từng mảnh: embed.js, bộ hẹn giờ, API; chưa chạy xuyên suốt trong trình duyệt). Báo E5096 từ `api-client` (`unwrapError`) chưa có test riêng.
- `embed-loader.spec.ts` trên Linux.
- Redis thật khi **ngắt giữa chừng** (chỉ có test fail-open với double); khoá chống phát lại trên Redis cluster.
- Phân tán nhiều tiến trình API: bộ nhớ đệm chính sách 15 s mỗi tiến trình nên sửa chính sách có hiệu lực **trong tối đa ~15 s** ở mỗi tiến trình.
- Đồng ý lưu trong trình duyệt (`ivy_consent`) vẫn được phát lại cho một **phiên khách mới sau khi tải lại trang** (hành vi cũ, theo thiết kế): chỉ bị xoá khi host gọi `ShopTalk.logout()` hoặc khi phiên bị tách sang người khác. Host phải gọi `logout()` khi người dùng đăng xuất (đã ghi trong guide).
