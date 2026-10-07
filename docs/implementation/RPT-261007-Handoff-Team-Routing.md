# RPT-261007 — Chọn đội hỗ trợ sau khi bấm "Talk to Agent" (Team Routing)

- Ngày: 2026-10-07 · Kế hoạch: `docs/plan/PLN-261007-Handoff-Team-Routing.md` · Kiểm thử: `docs/test/TCR-261007-Handoff-Team-Routing.md`
- Nhánh: `feature/handoff-team-routing` (từ `feature/user-role-region`) · PR: chờ mở · Phụ thuộc: merge `feature/user-role-region` trước (nhãn `sales_admin`)

## 1. Đã làm
| Lớp | Thay đổi |
|---|---|
| Cấu hình | `handoff_config.teamRouting { enabled, prompt?, options?[{id, jobLabel, label?}] }` — tắt mặc định; bật mà không sửa gì = cặp CS (`consult`) / Business (`sales_admin`) với câu chữ 6 ngôn ngữ có sẵn |
| API | `POST /chat/escalate` không `support_type` → lưu câu hỏi + chip (`team:<id>`) và trả `{escalated:false, choose:true, body, followUps}`; có `support_type` → echo lời chọn (tin người dùng), ghi `conversations.support_type`, WAITING, sự kiện escalation mang `issueLabel`/`supportType`/`supportLabel`; id lạ → 400. Ý định gõ tay "gặp nhân viên" cũng hỏi đội (`ChatTurnResponse.followUps`). Dòng "đang kết nối" nay lưu phía server |
| Cảnh báo | Thứ tự nhắm: nhãn (đội chọn / deny-rule) → assignee cấu hình → broadcast; Slack/email có dòng `Team:` |
| Hàng chờ | `GET /agent/sessions?support_type=`; hàng và chi tiết hội thoại trả `supportType` |
| Widget | Chip `team:*` → escalate lần hai; bubble câu hỏi hiện ngay; thanh "Connect to an agent" ẩn khi câu hỏi đang chờ; mọi lối vào (nút, chip, Contact Support, scenario `connect_agent`, gõ tay) đi cùng một luồng |
| Console | Tenant Settings › Agent handoff: khối bật/tắt, câu hỏi theo ngôn ngữ, bảng lựa chọn (key, nhãn, vai trò), tối đa 4; Live Chat: badge đội trên hàng chờ + header, bộ lọc "Đội" |
| Schema | `sql/261007-conversation-support-type.sql` (1 cột NULL), `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv` |
| i18n | aiSetting.handoff 10 khóa, livechat.team 5 khóa ×6 ngôn ngữ; `i18n:check` complete |

## 2. Tệp
- API: `ai-engine/entity/tenant-ai-config.entity.ts`, `ai-engine/handoff-router.service.ts` (+spec), `chat/chat.service.ts`, `chat/chat.controller.ts`, `chat/dto/request/chat.request.ts`, `chat/entity/conversation.entity.ts`, `chat/chat.service.team-routing.spec.ts` (mới), `agent/agent-alert.service.ts` (+spec), `agent/agent.service.ts`, `agent/agent.mapper.ts`, `agent/agent-console.controller.ts`, `agent/dto/request/agent.request.ts`, `agent/agent.service.listsessions.spec.ts`
- Types: `packages/types/src/api/widget.types.ts` (`ChatTurnResponse.followUps`, `EscalateResponse`)
- Widget: `services/chatService.ts`, `hooks/useChat.ts`, `components/chat/ChatTab.tsx`, `components/chat/reply-chips.ts`, `lib/types.ts`, `test/reply-chips.test.mjs`
- Console: `ai-settings/ai-settings.service.ts`, `ai-settings/HandoffSection.tsx`, `live-chat/live-chat.service.ts`, `live-chat/live-chat.hooks.ts`, `live-chat/LiveChatPage.tsx`, `i18n/locales/*/{aiSetting,livechat}.json`
- SQL/docs: `sql/261007-conversation-support-type.sql`, `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql`, PLN/TCR/RPT 261007 Handoff-Team-Routing

## 3. Kết quả kiểm
Xem TCR §1–§2: spec API 420/420 (phạm vi chat/agent/ai-engine), widget 44/44, tsc 3 app, i18n complete; trình duyệt dev: hỏi đội → chọn → định tuyến theo nhãn, badge/lọc console — đều đúng.

## 4. Trạng thái deploy
| Môi trường | Code | Migration `261007-conversation-support-type.sql` |
|---|---|---|
| dev | nhánh, đã kiểm live | đã áp |
| staging | chưa (chờ PR) | chưa — áp **trước** deploy, sau `261007-user-role-region.sql` |
| production | chưa | chưa |

## 5. Còn lại
- Go2Joy xác nhận tên hiển thị VI, hành vi khi SA offline (hiện: broadcast + badge), có lựa chọn thứ ba không.
- Kết hợp Region (ưu tiên cùng vùng trong nhãn) — giai đoạn B của PLN-261007-User-Role-Region.
- Khi merge với `feature/guest-login-gate-ui`: `agent-alert.service.ts` (`summary(alert, partnerLabel)` ↔ `summary(alert, teamLabel)`) và `listSessions` (tham số `hotel` ↔ `supportType`) sẽ xung đột nhẹ — gộp cả hai tham số.
