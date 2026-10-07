# TCR-261007 — Chọn đội hỗ trợ sau khi bấm "Talk to Agent" (Team Routing)

- Ngày: 2026-10-07 · Căn cứ: `docs/plan/PLN-261007-Handoff-Team-Routing.md` (đã duyệt) · Nhánh: `feature/handoff-team-routing` (từ `feature/user-role-region` 7e6a536c)
- Phạm vi: T1–T10. Phần kết hợp Region (giai đoạn B của PLN-261007-User-Role-Region) chưa làm.

## 1. Đơn vị / kiểu
| # | Kiểm tra | Kết quả |
|---|---|---|
| U1 | `chat.service.team-routing.spec.ts` (6 ca): hỏi đội trước (không WAITING, không cảnh báo, chip lưu trên trace); chọn đội → echo lời chọn, ghi `support_type`, WAITING, sự kiện có `issueLabel=sales_admin`; id lạ → 400 không báo ai; tắt → chuyển ngay như cũ; id cũ khi đã tắt → bỏ qua; preview sandbox hỏi + ghi nhưng không báo | PASS |
| U2 | `handoff-router.service.spec.ts` +4 ca `teamQuestion`: null khi tắt; mặc định CS/Business 6 ngôn ngữ; nhãn tenant theo ngôn ngữ phiên, EN dự phòng, nhãn trống → câu mặc định theo id; hàng hỏng/trùng bị bỏ, tối đa 4, không còn hàng → null | PASS |
| U3 | `agent-alert.service.spec.ts` +3 ca: nhãn đã chọn thắng assignee chung (summary có `Team: Business Support`); không ai online giữ nhãn → assignee; không có gì → broadcast | PASS |
| U4 | `agent.service.listsessions.spec.ts` +3 ca: lọc `support_type`; `all`/trống/khoảng trắng không thêm mệnh đề; hàng chờ mang `supportType` | PASS |
| U5 | `apps/api` jest `src/domain/{chat,agent,ai-engine}`: 50 suite / 420 PASS. Toàn bộ API: 213/216 suite PASS; 3 suite lỗi (`embed-loader`, `board-attachment`, `heic-conversion`) cũng lỗi trên `main` cùng máy — không liên quan | PASS (3 lỗi có sẵn) |
| U6 | Widget `node --test "test/*.test.mjs"`: 44 PASS (+1 ca `teamChoiceOf`). Lưu ý: dạng `node --test test/` (thư mục) lỗi trên Node 22 Windows cả ở `main` | PASS |
| U7 | `tsc --noEmit` api, web, widget (map src) | PASS |
| U8 | `npm run i18n:check` sau khi thêm aiSetting.handoff 10 khóa · livechat.team 5 khóa ×6 ngôn ngữ | complete |
| U9 | `npm run migrations:manifest` → `sql/artefacts.tsv` có `261007-conversation-support-type.sql conversations.support_type` | PASS |
| U10 | Thực boot API (dev) sau khi thêm `Conversation.supportType` (type tường minh, A-1) | `successfully started` |

## 2. Trình duyệt (dev stack, seed master ivyusa, SQL 261007-conversation-support-type áp trước lên DB dev, chat/moderation/rag tạm trỏ engine stub)
| # | Thao tác | Kết quả |
|---|---|---|
| B1 | Tenant Settings › Agent handoff: tick "Ask the customer to choose a team" → 2 hàng `cs → Consult`, `business → Sales Admin` tự hiện; Save | `handoff_config.teamRouting = {enabled:true, options:[cs/consult, business/sales_admin]}` trong DB |
| B2 | Widget: bấm scenario "Delivery status" → chip "Talk to an agent" → bấm | Bubble "What do you need help with?" + 2 chip "Customer Service Support" / "Business Support"; message lưu với `kind=team_question`; **không** cảnh báo mới, `support_type` NULL |
| B3 | Bấm "Business Support" | Bubble người dùng "Business Support" (lưu `kind=team_choice`), `conversations.support_type='business'`, status `waiting`; `agent_alerts` reason `user_request`, `target_user_id=1` (master được gán nhãn SA + profile online cho bài kiểm) |
| B4 | Gõ "I want to talk to a human agent please" (hội thoại mới) | Cùng câu hỏi + 2 chip ngay trong response (`followUps`), hội thoại vẫn `ai_active`, không cảnh báo |
| B5 | Bấm "Customer Service Support" | `support_type='cs'`, `waiting`, alert nhắm user giữ nhãn consult |
| B6 | Lối vào Contact Support › "Chat with an agent" (hội thoại mới) | Hỏi đội như B2; chọn Business → dòng "I'm connecting you with a support agent…" **lưu phía server** (message 113) và hiện ở widget; alert `target_user_id=1` |
| B7 | Console Live Chat: hàng chờ | Hàng Session 29/31 có badge "Business"; modal cảnh báo hiện preview "Business Support" |
| B8 | Mở hội thoại từ modal | Header có badge "Team: Business" |
| B9 | Bộ lọc "All teams" → Business | Request `GET /agent/sessions?support_type=business`; chỉ hàng có đội Business (hàng không chọn đội không hiện) |

Dọn dữ liệu sau kiểm: trỏ lại engine 2 cho chat/moderation/rag, gỡ nhãn SA + profile online khỏi master, bật lại `must_change_password`, tắt `teamRouting` của ivyusa dev, áp lại `261001-guest-login-gate.sql` (synchronize của nhánh này đã xóa 5 cột của nhánh guest-gate trên DB dev).

## 3. Phát hiện và sửa trong khi kiểm
- Dòng "đang kết nối" trước đây chỉ là bubble cục bộ của widget; sau khi chọn đội, poll reconcile làm mất dòng này (lần B3). Sửa: `escalate()` lưu `sysMsg('connectingAgent')` (có sẵn 6 ngôn ngữ) phía server và trả `body`; widget hiển thị đúng dòng server trả. Áp cho cả tenant không bật hỏi đội (hành vi tốt hơn: transcript ghi nhận khách đã yêu cầu người).
- Lối vào Contact Support bật thanh "Connect to an agent" ngay cả khi câu hỏi đội đang chờ → bấm lại chỉ hỏi thêm lần nữa. Sửa: ẩn thanh khi `escalate()` trả `choose`.
- DB dev lệch schema (các nhánh khác boot với synchronize đã xóa `tenants.privacy_profile`, `orders_cache.subtotal`…) → API 500 khi boot với `DB_SYNCHRONIZE=false`. Boot lại với synchronize để đồng bộ; đây là chi phí quen thuộc của dev DB dùng synchronize, không phải lỗi của nhánh.

## 4. Chưa kiểm
- Ngoài giờ + hỏi đội (route email): chỉ có spec logic (thông báo ngoài giờ được lưu thay dòng kết nối). Chưa chạy trình duyệt với businessHours.
- RN SDK: cùng widget trong WebView, chip là HTML — không đổi mã, chưa chạy thiết bị.
- Slack/email thật có dòng `Team:` — chỉ spec (mailer mock).

## 5. Kịch bản staging (sau deploy)
1. Áp `sql/261007-conversation-support-type.sql` **trước** deploy code (sau `261007-user-role-region.sql`); kiểm `SHOW COLUMNS FROM conversations LIKE 'support_type'`.
2. Tenant go2joy: Tenant Settings › Agent handoff → bật hỏi đội, sửa nhãn VI nếu Go2Joy muốn khác "Hỗ trợ khách hàng / Hỗ trợ kinh doanh"; Save.
3. Đăng nhập 1 CS, 1 SA, bật online; widget: bấm "Talk to an agent" → chọn Business → SA nhận cảnh báo (CS không); chọn CS → CS nhận.
4. SA offline → chọn Business → mọi agent nhận, hàng chờ có badge Business để CS chuyển giao.
5. Gõ "gặp nhân viên" → cũng hỏi đội.
