# PLN-261007 — Chọn đội hỗ trợ sau khi bấm "Talk to Agent" (Team Routing)

- Ngày: 2026-10-07 · Yêu cầu: "Add a user selection-based routing step after the user clicks 'Talk to Agent'" (Go2Joy)
- Phạm vi: widget (bước chọn đội), API chat/escalate + định tuyến cảnh báo, console (cấu hình + hàng chờ). Có 1 migration.
- Phụ thuộc: `feature/user-role-region` (nhãn `sales_admin`, PLN-261007-User-Role-Region) merge trước.
- Trạng thái: **đề xuất, chờ duyệt** (gồm AS-IS/TO-BE, không tách REQ riêng).

## 1. Tóm tắt quyết định

| Câu hỏi | Quyết định đề xuất | Lý do |
|---|---|---|
| Ai quyết định hiện 2 lựa chọn: widget hay server? | **Server**. Widget gọi `POST /chat/escalate` như cũ; server trả về câu hỏi + chip khi tenant bật tính năng | Một luồng cho web, embed, RN; nhãn chip dịch theo ngôn ngữ phiên ở server; tenant tắt thì không đổi gì |
| Lựa chọn lưu ở đâu? | Tin nhắn người dùng (lời chọn) + tin hệ thống (thông báo chuyển) trong thread, và cột `conversations.support_type` | Agent đọc lại thread hiểu ngay; console lọc/badge theo cột |
| Định tuyến tới ai? | Lựa chọn → nhãn công việc (CS = `consult`, Business = `sales_admin`) → bộ chọn "agent online ít tải nhất giữ nhãn" có sẵn | Tái dùng `pickLabelAgent` của deny-list, không thêm cơ chế mới |
| Không có agent online giữ nhãn? | Broadcast cho mọi agent kèm badge đội | Không bao giờ bỏ rơi hội thoại; CS thấy badge "Business" thì chuyển giao |
| Nhãn do người dùng chọn hay `assigneeUserIds` cấu hình thắng? | **Nhãn thắng**, assignee cấu hình là dự phòng | Người dùng đã nói rõ cần đội nào; assignee chung chỉ dành cho khi không rõ |
| Gõ "gặp nhân viên" (AI nhận ý định) có hỏi đội không? | **Có**, cùng câu hỏi + chip | Nhất quán; tránh chat gõ tay thì broadcast còn bấm nút thì định tuyến |
| Ngoài giờ? | Vẫn hỏi đội; sau khi chọn mới áp thông báo ngoài giờ + email | Đội đã chọn được lưu để xử lý ngày hôm sau |
| Cấu hình chung hay riêng Go2Joy? | Chung, trong `handoff_config.teamRouting`, **tắt mặc định** | ivyusa và tenant khác giữ nguyên hành vi; Go2Joy bật ở Cài đặt AI › Chuyển người |
| Khi nào hiện lựa chọn? | Chỉ sau khi người dùng yêu cầu gặp người (nút, chip, ContactCard, scenario `connect_agent`, hoặc ý định gõ tay) | Đúng yêu cầu "không hiện trước" |

## 2. AS-IS

| Điểm | Hiện tại |
|---|---|
| Lối vào "Talk to Agent" | 4 lối (nút cuối thread, chip `agent_connect`, ContactCard, scenario `connect_agent`) đều gọi `escalate()` trong `ChatTab.tsx` → `POST /chat/escalate` |
| Ý định gõ tay | `chat.service` nhận `agent_request` (regex + intent ≥ 0.6) → `handoff('user_request')` ngay |
| Định tuyến cảnh báo | `agent-alert.service`: `targetUserIds[0]` (assignee cấu hình) → nếu trống và có `issueLabel` (chỉ deny-rule gắn) → agent online ít tải nhất giữ nhãn → không có → broadcast |
| Hàng chờ console | Mọi user có `CONVERSATION_HANDLE` thấy toàn bộ WAITING; lọc theo trạng thái, kênh, AI agent, khách sạn; không có "đội" |
| Chip theo tin nhắn | `messages.retrieval_trace.followUps` → widget `quickReplies`; sống qua poll/reload |
| Nhãn | `consult`, `accounting`, `operations`; `sales_admin` trên nhánh user-role-region |

Khoảng trống: escalate do người dùng không mang nhãn → luôn broadcast; không có bước hỏi; console không phân biệt đội.

## 3. TO-BE

### 3.1 Cấu hình (tenant_ai_config.handoff_config)
```ts
teamRouting?: {
  enabled: boolean;
  /** Câu hỏi; trống = mặc định 6 ngôn ngữ ("Bạn cần hỗ trợ về việc gì?") */
  prompt?: LocalizedText;
  /** 2–4 lựa chọn, thứ tự hiển thị */
  options: Array<{ id: string; jobLabel: JobLabel; label?: LocalizedText }>;
};
```
Mặc định khi bật lần đầu: `cs → consult` ("Customer Service Support"), `business → sales_admin` ("Business Support"). Nhãn hiển thị có sẵn 6 ngôn ngữ; tenant sửa được.

### 3.2 Luồng widget
1. Người dùng bấm "Talk to Agent" (bất kỳ lối vào nào) → `POST /chat/escalate` (không `support_type`).
2. Server, nếu `teamRouting.enabled`: lưu tin hệ thống `prompt` với `followUps = options` (id `team:<optionId>`), **không** WAITING, **không** cảnh báo; trả `{ escalated:false, choose:true }`. Widget bỏ dòng "đang kết nối" cục bộ, hiện bubble + chip từ poll (hoặc từ response để không chờ 5 giây).
3. Bấm chip → `POST /chat/escalate { support_type:'business' }` → server lưu tin người dùng (lời chip), ghi `support_type`, WAITING, phát cảnh báo với `issueLabel = sales_admin`, trả `{ escalated:true }` + thông báo chuyển (hoặc ngoài giờ).
4. Tenant tắt: bước 2 chạy như hiện nay (`escalated:true`, không hỏi).
5. Ý định gõ tay: trong `chat.service`, nhánh `wantsHuman` khi `teamRouting.enabled` trả lời bằng tin hệ thống `prompt` + `followUps` thay vì `handoff()`; chip đi tiếp bước 3. Đang `queued` thì bỏ qua như hiện nay.
6. Preview sandbox: hiện câu hỏi và chip, chọn xong trả thông báo nhưng không WAITING/không cảnh báo (giữ quy tắc sandbox).

### 3.3 API
- `EscalateRequest.support_type?: string` (`@IsOptional @IsString @MaxLength(32)`); không khớp option → `E4xxx VALIDATION` 400.
- `ChatService.escalate(session, conversationId, supportType?)` trả `{ escalated: boolean; choose?: boolean; body?: string; needsContactEmail?: boolean }`.
- `EscalationEvent.issueLabel` = `option.jobLabel`; thêm `supportType` cho alert/email summary ("Team: Business Support").
- `agent-alert.service.onEscalation`: thứ tự mới `issueLabel → pickLabelAgent` ▸ `targetUserIds[0]` ▸ broadcast.
- `GET /agent/sessions?support_type=` lọc; response hàng chờ thêm `supportType`.

### 3.4 Console
- Cài đặt AI › Chuyển người: khối "Hỏi đội hỗ trợ khi khách yêu cầu gặp người" (bật/tắt, câu hỏi, bảng lựa chọn: tên theo ngôn ngữ · nhãn đích). Lưu có toast.
- Live Chat: badge đội trên hàng chờ (CS / Business), bộ lọc "Đội"; BriefingCard dòng "Đội: Business Support"; EscalationAlarm ghi đội.

### 3.5 Schema
`ALTER TABLE conversations ADD support_type varchar(32) NULL AFTER reply_channel;` — `sql/261007-conversation-support-type.sql`, `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv`.

## 4. Thay đổi kỹ thuật

| # | Việc | Tệp |
|---|---|---|
| T1 | SQL cột `support_type` + init schema + artefacts | `sql/261007-conversation-support-type.sql`, `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv` |
| T2 | `HandoffConfig.teamRouting` + mặc định + resolver nhãn theo ngôn ngữ | `tenant-ai-config.entity.ts`, `ai-config.service.ts`, `handoff-router.service.ts` (`teamOptions(tenantId, lang)`) |
| T3 | `Conversation.supportType` (explicit `type: 'varchar'`, nullable) | `chat/entity/conversation.entity.ts` |
| T4 | `EscalateRequest.support_type`; `escalate()` 2 pha; `wantsHuman` → hỏi đội; `EscalationEvent.supportType` | `chat.request.ts`, `chat.controller.ts`, `chat.service.ts` |
| T5 | Alert: nhãn thắng assignee; summary có đội | `agent-alert.service.ts` |
| T6 | Hàng chờ: `support_type` filter + response; `agent.mapper.ts` | `agent.service.ts`, `agent.mapper.ts`, `agent-console.controller.ts` |
| T7 | Widget: `escalate()` xử lý `choose`; chip `team:*` trong `handleQuickReply`; bỏ dòng "đang kết nối" khi `choose` | `useChat.ts`, `chatService.ts`, `ChatTab.tsx` |
| T8 | Console cấu hình + hàng chờ + badge + lọc | `HandoffSection.tsx`, `ai-settings.service.ts`, `LiveChatPage.tsx`, `live-chat.service.ts`, `BriefingCard.tsx`, `EscalationAlarm.tsx` |
| T9 | i18n 6 ngôn ngữ: widget `chat` (mặc định prompt/option — server dùng, widget chỉ hiển thị), console `aiSetting`, `livechat` | — |
| T10 | Spec: escalate 2 pha (bật/tắt, option sai, preview), wantsHuman hỏi đội, alert ưu tiên nhãn, listSessions lọc; widget chip test; TCR | — |

Không đổi: accept thủ công, SLA, deny-list, giờ làm việc, cơ chế handback.

## 5. Wireframe

**Widget — sau khi bấm "Talk to Agent" (tenant bật)**
```
┌ ShopTalk ───────────────────────────────┐
│ 🤖 Bạn cần hỗ trợ về việc gì?            │
│   [ Customer Service Support ]           │
│   [ Business Support ]                   │
└──────────────────────────────────────────┘
          ↓ bấm "Business Support"
┌ ShopTalk ───────────────────────────────┐
│                     Business Support 👤  │
│ 🤖 Đang kết nối bạn với nhân viên…       │
│    (ngoài giờ: thông báo email như cũ)   │
└──────────────────────────────────────────┘
```
Tenant tắt: bấm nút → "Đang kết nối…" ngay như hiện nay.

**Console › Cài đặt AI › Chuyển người**
```
┌ Hỏi đội hỗ trợ khi khách yêu cầu gặp người ───────────────────────┐
│ [x] Bật                                                            │
│ Câu hỏi (VI) [Bạn cần hỗ trợ về việc gì?            ] [EN][KO]…    │
│ Lựa chọn                                                           │
│  # │ Tên hiển thị (VI)           │ Chuyển tới vai trò  │           │
│  1 │ Hỗ trợ khách hàng           │ [CS ▾]              │ [Xóa]     │
│  2 │ Hỗ trợ kinh doanh           │ [SA ▾]              │ [Xóa]     │
│ [+ Thêm lựa chọn] (tối đa 4)                                       │
│ ⓘ Không có nhân viên online giữ vai trò → báo cho mọi nhân viên    │
│                                                   [Lưu] → ✓ toast  │
└────────────────────────────────────────────────────────────────────┘
```

**Console › Live Chat › Hàng chờ**
```
│ Lọc: [Trạng thái ▾] [Kênh ▾] [AI agent ▾] [Khách sạn] [Đội: Tất cả ▾]      │
├─────────────────────────────────────────────────────────────────────────────┤
│ ● a1b2c3  In Hotel Del Luna (1721) · receptionist   [Business]  WAITING 2m  │
│ ● d4e5f6  khách                                     [CS]        WAITING 5m  │
```

## 6. Giai đoạn và ước lượng

| Giai đoạn | Nội dung | Ước lượng |
|---|---|---|
| 1 | T1–T10 trong một PR (sau khi user-role-region merge) | 1 ngày |
| 2 (sau) | Kết hợp Region (PLN-261007-User-Role-Region giai đoạn B): lọc theo đội rồi theo vùng | gộp vào giai đoạn B của Region |

## 7. Side-impact và rủi ro

| Mục | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Tenant không bật | Không đổi: `escalate` trả `escalated:true` như cũ; widget cũ (cache) vẫn chạy vì response giữ trường cũ | Spec "tắt = hành vi cũ" |
| Widget cũ gặp `choose:true` | Hiện dòng "đang kết nối" cục bộ nhưng chưa WAITING; poll sẽ mang câu hỏi + chip lên sau | Deploy widget cùng API (cùng PR); chấp nhận 1 chu kỳ poll |
| Thứ tự ưu tiên alert đổi (nhãn > assignee) | Deny-rule có nhãn nay cũng ưu tiên nhãn hơn assignee chung | Ghi rõ trong HandoffSection hint; spec |
| Người dùng không chọn chip mà gõ tiếp | Hội thoại chưa WAITING, AI vẫn trả lời; gõ "gặp nhân viên" lại hỏi | Hợp lý: chưa yêu cầu rõ thì chưa chuyển |
| Migration | 1 cột NULL; code cũ chạy được trên schema mới | Áp SQL trước deploy (staging `DB_SYNCHRONIZE=false`) |
| RN SDK | Không đổi: cùng widget, chip là HTML trong WebView | — |

## 8. Câu hỏi cần Go2Joy xác nhận (không chặn)
1. Tên hiển thị 2 lựa chọn bằng tiếng Việt: "Hỗ trợ khách hàng" / "Hỗ trợ kinh doanh" có đúng ý không?
2. SA không online: báo CS nhận tạm (đề xuất) hay để chờ SA?
3. Có lựa chọn thứ ba (ví dụ kế toán/đối soát) không? Cấu hình cho phép tới 4.
