# RPT-261007 — Nhánh tích hợp Go2Joy (7 nhánh tính năng trên main 9fd31630)

- Ngày: 2026-10-07 · **Cập nhật 2026-10-12: rebase toàn bộ lên `main` 9fd31630 (xem §2b)** · Nhánh: `test/go2joy-integration` (local, không dùng để merge) · Base ban đầu: `origin/main` 4949e107, nay 9fd31630
- Mục đích: chứng minh các nhánh Go2Joy chạy cùng nhau trên main mới nhất, ghi lại mọi xung đột và cách giải để rebase từng PR đúng một lần, và chốt thứ tự SQL cho staging.
- Không phải bản phát hành: các PR thật vẫn mở riêng từng nhánh theo §2.

## 1. Gồm những gì
| # | Nhánh | Tài liệu | Migration |
|---|---|---|---|
| 1 | `feature/fix-widget-session-cross-tenant` | `docs/bug-fix/FIX-260916-Widget-Session-Token-Cross-Tenant.md` | không |
| 2 | `feature/go2joy-s3-guest-kb` | `docs/implementation/RPT-260916-Go2Joy-QW1-VI-Fix-KB-Policies.md` | không (CSV nhập qua console) |
| 3 | `feature/ai-answer-format` | `docs/implementation/RPT-261007-AI-Answer-Format.md` | không |
| 4 | `feature/guest-login-gate-ui` (chứa `feature/guest-login-gate`) | `PLN-261001`, `TCR-261006` | `sql/261001-guest-login-gate.sql` (đã áp staging) |
| 5 | `feature/user-role-region` | `PLN/TCR-261007-User-Role-Region` | `sql/261007-user-role-region.sql` |
| 6 | `feature/handoff-team-routing` | `PLN/TCR/RPT-261007-Handoff-Team-Routing` | `sql/261007-conversation-support-type.sql` |

## 2. Thứ tự mở PR và xung đột trên main mới
| # | Nhánh | Xung đột với main 4949e107 | Cách giải (đã áp trong nhánh tích hợp) |
|---|---|---|---|
| 1 | session-fix | `session.service.ts`, `useSession.ts` | Giữ cả `assertWidgetAccessAllowed` (PLN-260929) và `belongsToShop`; `useSession.ts` giữ `getAccessKey` của main, bỏ bản `getShopDomain` cục bộ và re-export từ `lib/api-client` |
| 2 | go2joy-s3-guest-kb | không | — |
| 3 | ai-answer-format | không | — |
| 4 | gate-ui (+ gate) | `rag.service.ts`, `ai-engine.module.ts` | Prompt hệ thống = persona + rules + `partnerBlock` + `FORMAT_RULES` + `CONVERSATION_RULES`; module chỉ khác comment |
| 5 | role-region | không (3 file chung với gate đều là phần cộng thêm) | — |
| 6 | team-routing | 9 file, chỉ khi đứng sau nhóm 4 | xem bảng dưới |

Nhánh 6 sau nhánh 4 (agent / live chat):
| File | Giải |
|---|---|
| `agent-alert.service.ts` | `summary(alert, partnerLabel?, teamLabel?)`; `notifySlack` và `notifyEmail` nhận cả hai; thứ tự dòng Reason → Team → Partner → preview; payload escalation mang `partnerLabel` lẫn `supportLabel` |
| `chat.service.ts` | `EscalationEvent` có `partnerLabel`, `supportType`, `supportLabel`; `escalate()` gửi cả `partnerLabelOf(session)` và nhãn đội |
| `agent.service.ts`, `agent.request.ts`, `agent-console.controller.ts` | `listSessions(…, aiAgentId, hotel, supportType)`; query `hotel` và `support_type` |
| `live-chat.service.ts`, `live-chat.hooks.ts`, `LiveChatPage.tsx` | `sessions(q, status, channel, aiAgentId, hotel, supportType)`; queryKey có cả hai; hai bộ lọc cùng tồn tại |
| `agent-alert.service.spec.ts`, `agent.service.listsessions.spec.ts` | Giữ spec của cả hai nhánh; spec lọc đội truyền `supportType` ở vị trí thứ 9 |

Khuyến nghị: merge 1 → 2 → 3 → 4 → 5 rồi để rebase nhánh 6 một lần. Merge 6 trước 4 sẽ buộc giải lại cùng 9 file theo hướng ngược.

## 2b. Rebase lên main 9fd31630 (2026-10-12)
`main` đã tiến 40 commit từ 4949e107 (đáng kể: #630 hiển thị markdown, FOOTER_RULE / `answer_footer` R4, FIX-261007 G1, #633). Mỗi nhánh được rebase riêng, bản gốc giữ ở tag `backup/1012/<nhánh>`.

| Nhánh | Tip mới | Xung đột với main mới | Cách giải |
|---|---|---|---|
| session-fix | `b362b429` | `session.service.ts`, `useSession.ts` | như §2 #1 |
| go2joy-s3-guest-kb | `f8163657` | không | — |
| ai-answer-format | `7971bd4d` (1 commit) | `rag.service.ts`, `MessageBubble.tsx` | **Bỏ bộ render widget** (`reply-format.ts` + test): #630 của main đã có `RichText` làm cùng việc. Nhánh còn lại chỉ là `FORMAT_RULES` + `DEFAULT_RULES`; `FORMAT_RULES` đứng cạnh `FOOTER_RULE` trong prompt. RPT của nhánh đã viết lại tương ứng |
| guest-login-gate | `8edc011f` | `ai-config.{controller,service,dto,entity}`, `ai-engine.module.ts`, `rag.service.ts`, `chat.service.ts` | Cộng thêm cạnh `answerFooter` của main (`guestGuidance` song song `answerFooter`); prompt = persona + rules + `partnerBlock` + … + `FOOTER_RULE`; import `envNumber` + `answer-footer.util` |
| guest-login-gate-ui | `36c51f95` | `AiSettingsPage.tsx`, `ai-settings.service.ts`, 12 file `aiSetting/knowledge.json`, 6 file locale widget | `GuestGuidanceSection` + `AnswerFooterSection` cùng tồn tại; JSON gộp theo khóa; locale widget gộp 3 chiều sau khi bỏ CR. Commit "chore(widget): locale LF" bị loại vì đã thừa — commit S2 nay không còn làm đổi cuối dòng 6 file locale |
| user-role-region | `09dddbac` | chỉ `sql/artefacts.tsv` | sinh lại bằng `npm run migrations:manifest` |
| handoff-team-routing | `4af89323` | chỉ `sql/artefacts.tsv`; spec `chat.service.memory.spec.ts` của main (G1) hỏng vì mock `handoffRouter` thiếu `teamQuestion` | sinh lại manifest; thêm `teamQuestion: jest.fn(async () => null)` vào mock (đã gộp vào commit của nhánh) |

Nhánh tích hợp dựng lại từ main bằng cách merge theo thứ tự §2. Khi merge team-routing sau gate-ui, 9 file xung đột như cũ; lời giải cũ được phát lại lên bản mới (3-way: cha cũ → kết quả cũ → HEAD mới), cả 9 file sạch. Phát sinh thêm một lỗi chỉ xuất hiện khi gộp: `agent.service.listsessions.spec.ts` — `listSessions` có thêm tham số `hotel` (gate) nên tham số `supportType` (team) lùi một vị trí; vá trong commit riêng `test(integration)`.

## 3. Kết quả kiểm trên nhánh tích hợp
| # | Kiểm | Kết quả |
|---|---|---|
| I1 | `tsc --noEmit` api, web, widget (map src) | PASS |
| I2 | jest API toàn bộ | 2289 PASS (sau rebase 2026-10-12); 3 suite lỗi (`heic-conversion`, `board-attachment.service`, `embed-loader`) — cùng 3 suite và cùng thông báo lỗi trên `main` cùng máy (Windows), không do các nhánh này |
| I3 | jest `packages/common` | 64 PASS |
| I4 | widget `node --test "test/*.test.mjs"` | 51 PASS (sau rebase; bộ test `reply-format` đã bỏ cùng bộ render, #630 thay thế) |
| I5 | `npm run i18n:check` | complete |
| I6 | `npm run migrations:manifest` rồi `git diff --ignore-space-at-eol sql/artefacts.tsv` | không khác biệt (lệnh `--check` thuần báo lỗi trên cả `main` ở Windows do CRLF — không phải do nhánh) |
| I7 | Thực boot API (dev, synchronize) | `successfully started`; có đủ `ai_agents.guest_policy`, `kb_categories.guest_visible`, `sessions.identity_claims`, `customers.last_claims`, `tenant_ai_config.guest_guidance`, `users.region`, `conversations.support_type`, `ai_engines.tenant_selectable` |
| I8 | Live: phiên widget | khóa `ivy_session:<shop>` theo từng cửa hàng; `/session/ensure` 201 |
| I9 | Live: identify v2 (user, hotel 1721, manager, chữ ký HMAC) | 201; hàng chờ có dòng đối tác, dấu signed, tên khách sạn |
| I10 | Live: hỏi đội với cấu hình tối thiểu `{enabled:true}` | cặp CS / Business mặc định; chọn Business → `support_type=business`, WAITING |
| I11 | Live: lọc hàng chờ | `support_type=business` + `hotel=Del Luna` → 1 dòng; `cs` + Del Luna → rỗng; `business` + khách sạn khác → rỗng |
| I12 | Live: widget trên nhánh gộp | Delivery status → "Talk to an agent" → câu hỏi + 2 chip |
| I13 | Spec mới `summary — partner and team lines together` | PASS (thứ tự và độc lập hai dòng) |

## 4. Chưa kiểm
- Cổng khách theo độ tin cậy: cần `VOYAGE_API_KEY` thật (staging, bước S4).
- Câu trả lời AI thật theo định dạng mới: cần credit Anthropic.
- `partnerLink`: tenant dev chưa có mẫu link Hotel Admin.
- Ngoài giờ + hỏi đội: chỉ có spec.

## 5. SQL staging (theo thứ tự)
| # | File | Trạng thái |
|---|---|---|
| 1 | `sql/261001-guest-login-gate.sql` | đã áp staging 2026-10-07 |
| 2 | `sql/261007-user-role-region.sql` (chạy với `--default-character-set=utf8mb4`) | chưa |
| 3 | `sql/261007-conversation-support-type.sql` | chưa |

Các file này cộng thêm cột/hàng, code cũ chạy được trên schema mới nên áp trước khi deploy. Sau khi áp: `SHOW COLUMNS` cho 3 cột trên và `SELECT tenant_id,name FROM job_labels WHERE code='sales_admin'` (tên Hàn không bị mojibake).

## 6. Kịch bản staging sau deploy
1. Dev kiểm nhanh `successfully started`, container age, route mới trả 401 (không phải 404/502).
2. Tenant go2joy (đăng nhập console): làm K2, K4, K5 (TCR-261006 §6), bật hỏi đội ở Tenant Settings › Agent handoff, đổi tên nhãn CS/SA ở Users & Labels.
3. Giữ `guest_policy` của agent Go2Joy ở `open` cho đến khi Go2Joy ký identify v2 và qua UAT (K3).
4. S4: đo ngưỡng cổng khách với Voyage thật; chỉnh `GUEST_GATE_CONFIDENCE` nếu cần.

## 7. Trạng thái deploy
| Hạng mục | Dev | Staging | Production |
|---|---|---|---|
| Code 7 nhánh | đã chạy thử trên nhánh gộp | chưa (chờ PR) | chưa |
| SQL 261001 | đã áp | đã áp | chưa |
| SQL 261007 ×2 | đã áp | chưa | chưa |
