# RPT-261012 — Go2Joy P0: bịt rò rỉ, tách phiên, hiện diện thật, định tuyến

- Ngày: 2026-10-13 · PLN: `PLN-261012-Go2Joy-Stage1-Gap-Closure` (Phương án 2, đã duyệt) · REQ: `REQ-261012-…` (D-01, D-02, D-03, D-07, D-08, D-09, D-10, D-11, D-12, D-14; SG-01, 02, 05, 60, 61, 62, 65)
- Phạm vi: nhóm **P0** của PLN. Không gồm SG-06 (đi cùng SG-10), SG-63, SG-64.
- Kiểm thử chi tiết: `docs/test/TCR-261012-Go2Joy-P0-Session-Routing.md`

## 1. Thay đổi

| Nhánh | Commit | Việc |
|---|---|---|
| `feature/guest-login-gate` | `7d577326` | **SG-01 / D-01**: lượt tìm "câu hiện tại" của câu hỏi tiếp nối nhận `opts` (phạm vi khách). 3 test hồi quy; bỏ sửa thì đỏ |
| | `89df7e7b` | `retrieveHybrid` bắt buộc đủ tham số — thiếu phạm vi là lỗi biên dịch TS2554 (đã thử) |
| | `a8154a89` | `FIX-261012-Guest-Scope-Followup-Search.md` |
| `feature/go2joy-s1-session-security` | `4d36bfe9` | **SG-02 (API)**: `identify` tạo phiên mới khi (khách, `hotelSn`, vai trò) đổi; giữ nguyên khi khách → người dùng, cùng người cùng khách sạn, hoặc v1 lặp lại; `POST /public/embed/logout` (đóng hội thoại do AI giữ, không đóng `waiting`/`agent`) |
| | `bffc059d` | **SG-05**: DSAR xoá luôn `sessions.identity_claims` và `customers.last_claims` |
| | `a1625073` | **SG-02 (widget)**: logout hoặc chuyển người dùng thì thay cả phiên: gọi API, xoá cache React Query, kéo khoá theo token, phát lại đồng ý; `identify` lỗi trên phiên đã xác thực thì về khách mới; làm mới tên khách |
| | `38a3ef14` | Ghi chú trong guide Embed SDK (tiếng Hàn) |
| `feature/go2joy-s3-routing-presence` | `c719b27a` | **SG-60**: `agent_profiles.last_seen`; online = trạng thái online **và** thấy trong `AGENT_PRESENCE_TTL_SEC` (mặc định 90 s); nhịp tim ghi cùng lần poll cảnh báo (không ghi quá 20 s/lần); công tắc "Trực" trong Live chat; chỉ báo trong danh sách người dùng |
| | `f2926c56` | **SG-61, 65**: `region-vn.ts` (63 tên cũ + 34 tên mới + biệt danh), bộ khớp chịu `Ð`, hậu tố "city", ", Việt Nam", Hanoi/Sài Gòn/HCMC/TT Huế; nút "Nạp bộ có sẵn"; kiểm bảng vùng phía server (E5095); cảnh báo chưa ánh xạ khử trùng 1 giờ + dòng "Region: ? (unmapped: …)" |
| | `a593ce81` | **SG-62**: `escalate()` ngoài giờ ngang `handoff()` (kênh trả lời email, xin email); trình dọn idle bỏ qua hội thoại WAITING chưa ai nhận (`agent_id` rỗng) |
| | `109fb3a0` | **SG-65**: chỉ nhân viên `active` đủ điều kiện ở cả hai nhánh; tải gồm cảnh báo đang chờ; chọn xác định (tải thấp nhất rồi id); Messenger không hỏi đội |
| `test/go2joy-integration` | `d2b970e0`, `f7266697` | Gộp S1 và S3 (không xung đột); thêm `57db9a9a`, `cd04f1fd`, `370e8c9b` (SG-01) |

## 2. Tệp chính

- API: `embed.service/controller/module`, `embed.request`, `privacy.service`, `agent-alert.service`, `agent.service`, `agent-profile.entity`, `handoff-router.service`, `region-routing.util`, `ai-config.service`, `chat.service`, `idle-conversation.service`, `messenger-ingest.service`, `user.service`, `user.response`, `presence.util`, `error-code.constant` (E5095).
- Types: `region.ts`, `region-vn.ts`, `widget.types.ts`, `index.ts`.
- Widget: `session-swap.ts`, `useEmbedCommands.ts`, `WidgetPanel.tsx`, `sessionService.ts`, `widgetStore.ts`, `ChatTab.tsx`, `useChat.ts`.
- Console: `DutyToggle.tsx`, `LiveChatPage.tsx`, `live-chat.hooks/service`, `UsersPage.tsx`, `users.hooks/service`, `HandoffSection.tsx`, locales `livechat`, `users`, `aiSetting` ×6.
- Schema/cấu hình: `sql/261015-agent-profile-last-seen.sql`, `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql`, `CONFIG.md`, env mẫu VN-Go2Joy (`AGENT_PRESENCE_TTL_SEC`).

## 3. Kết quả kiểm (chạy lại độc lập sau khi agent báo xong)

| Kiểm | Kết quả |
|---|---|
| `tsc` api, web, widget (map src) trên bản gộp S1+S3 | 0 lỗi ×3 |
| jest API toàn bộ trên bản gộp | 2478 đạt; 3 suite lỗi nền Windows (`embed-loader`, `board-attachment.service`, `heic-conversion`), cùng lỗi trên `main` |
| widget `node --test test/*.test.mjs` | 61/61 |
| `npm run i18n:check` | đủ 6 ngôn ngữ |
| manifest `migrations:manifest` | không lệch (chỉ thêm file SQL mới) |
| Boot API thật (S3, cổng 3011, 2 lần, lần hai trên cây cuối) | `Nest application successfully started`; cột `last_seen` được thêm vào DB dev |
| Kiểm DB thật bằng bản ghi tạm (S3) | nhịp tim ghi cho hồ sơ đang trực, bỏ qua khi < 20 s, ghi lại khi > 20 s, bỏ qua tenant khác/không có hồ sơ; bản ghi đã xoá |

**Chưa kiểm được** (nêu rõ để khỏi hiểu nhầm là đã kiểm):
- Không chạy UI thật (công tắc Trực, cột hiện diện, nút nạp bộ tỉnh, form xin email của widget, thứ tự đặt lại widget khi logout). Tài khoản master dev đang buộc đổi mật khẩu (E1005) nên `PUT /agent/profile`, `GET /agent/alerts`, `GET /users` chưa được gọi qua HTTP; chỉ có test đơn vị.
- Tách phiên và logout dùng giả lập trong bộ nhớ, chưa chạy trên DB thật.
- Không kiểm trên Qdrant/Voyage thật (SG-01 chỉ chứng minh ở tầng gọi).

## 4. Trạng thái triển khai và migration

| Hạng mục | Dev | Staging | Production |
|---|---|---|---|
| Mã P0 | Chạy thử trên nhánh gộp (local) | Chưa (chưa có PR) | Chưa |
| `sql/261015-agent-profile-last-seen.sql` | Đã áp (do `synchronize` khi boot) | **Chưa — phải áp trước khi deploy** (`DB_SYNCHRONIZE=false`) | Chưa |
| PR / commit đã merge | Chưa có PR; nhánh chưa push (trừ `test/go2joy-integration` `73ff8acf` trên origin, **không chứa** SG-01 và S1/S3) | — | — |

Thứ tự áp SQL staging (các nhánh trước chưa áp): `261007-user-role-region` (utf8mb4), `261007-conversation-support-type`, `261007-conversation-support-region`, rồi `261015-agent-profile-last-seen`.

## 5. Lệch so với kế hoạch và việc còn mở

Lệch: tie-break "tải thấp nhất rồi id" (không dùng `last_seen`); huy hiệu vùng "?" trên hàng chờ chưa làm (cần dấu lưu bền), chỉ có dòng trong cảnh báo; "Huế" nay trùng "Thừa Thiên Huế" nên đổi một khẳng định trong `region.spec.ts`; `needsContactEmail` chỉ trả khi true; thêm ngoài kế hoạch: poll cảnh báo chạy cả khi tab nền, `PUT /agent/profile` chỉ nhận `online|away|offline`, trạng thái hổ phách "trực nhưng chưa kết nối" ở danh sách người dùng, phiên khách sau logout giữ mã agent/đường dẫn/khoá truy cập.

Còn mở: xem PLN §11 (đóng dấu lại `support_region`, `identity_level` sau DSAR, số liệu phiên phình do tách phiên, CJM `session_start`, `IssueService.onConversationEnded`, widget mất phiên khi ngoại tuyến, tab cũ giữ token cũ). **Quyết định treo:** có sao chép đồng ý sang phiên mới khi đổi người trên cùng trình duyệt không (hiện sao chép).
