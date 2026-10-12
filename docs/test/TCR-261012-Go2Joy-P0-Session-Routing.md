# TCR-261012 — Go2Joy P0: ca kiểm thử

- Ngày: 2026-10-13 · RPT: `docs/implementation/RPT-261012-Go2Joy-P0-Session-Routing.md` · PLN §7 (Gate 2, Gate 3 phần danh tính)
- Số ca tính theo `it()`/`test()` đã chạy; số cuối là kết quả chạy lại độc lập trên bản gộp.

## 1. Ca đơn vị

| Yêu cầu | Tệp spec | Nội dung chính |
|---|---|---|
| SG-01 | `chat/rag-answer-scope.spec.ts` (+3) | Cả hai lượt tìm của câu hỏi tiếp nối đều nhận `{guestOnly:true}` và cùng `agentId`; lượt đơn có phạm vi; người đã đăng nhập không bị phạm vi khách. **Bỏ sửa thì ca đầu thất bại** (đã thử). Lỗi biên dịch TS2554 khi thiếu tham số (đã thử) |
| SG-02 API | `embed/embed.service.rebind.spec.ts` (33) | Người khác → phiên mới và phiên cũ giữ nguyên; cùng người khác khách sạn/vai trò → phiên mới; cùng người cùng khách sạn idempotent; khách → người dùng giữ phiên; v1 lặp lại không tách; v1 → có claims hoặc ngược lại tách; chữ ký sai không ghi gì; phiên mới thừa kế tenant, agent, ngôn ngữ, đồng ý nhưng **không** thừa kế `alias`, `auto_reply_mode`, bộ đếm |
| SG-02 logout | `embed/embed.controller.logout.spec.ts` (4) | Gỡ claims/khách; chỉ đóng hội thoại `ai_active`; token lạ → `SESSION_NOT_FOUND`; idempotent; DI Nest hợp lệ |
| SG-05 | `privacy/privacy.service.erasure-claims.spec.ts` (3) | DSAR xoá `identity_claims` và `last_claims` (bỏ sửa thì 2/3 thất bại) |
| SG-02 widget | `apps/widget/test/session-swap.test.mjs` (10) | Thứ tự đặt lại: tháo token → xoá cache → mở phiên khách → phát lại đồng ý → đặt token cuối; bỏ `identify` treo khi logout; bỏ phản hồi `identify` đến muộn |
| SG-60 | `global/util/presence.util.spec.ts`, `agent/agent.service.profile.spec.ts`, `user/user.service.presence.spec.ts`, `agent/agent-alert.service.presence.spec.ts` | Biên TTL; không hồ sơ hoặc không `last_seen` = offline; giới hạn ghi 20 s; trạng thái hợp lệ của `PUT /agent/profile`; chỉ báo hiện diện |
| SG-61 | `packages/types/src/common/region-vn.spec.ts`, `region.spec.ts`, `ai-engine/region-routing.util.spec.ts`, `ai-engine/handoff-router.service.spec.ts` | Bộ tên VN (cũ + mới + biệt danh): Hanoi, Ha Noi, Sài Gòn, TPHCM, HCMC, Ho Chi Minh City, TT Huế, `Ðà Nẵng`, `Đắc Lắc`; bất biến "không tỉnh nào thuộc hai danh mục"; kiểm bảng phía server (id trùng, đội lạ, tỉnh quá dài); khử trùng cảnh báo chưa ánh xạ |
| SG-62 | `chat/chat.service.escalate-offhours.spec.ts`, `chat/idle-conversation.service.spec.ts` | `escalate` ngoài giờ đặt `replyChannel='email'` và `needsContactEmail`; trong giờ giữ nguyên phản hồi; trình dọn idle bỏ qua WAITING chưa ai nhận, vẫn xử lý AI/agent như cũ |
| SG-65 | `agent/agent-alert.service.eligibility.spec.ts`, `agent/agent-alert.service.spec.ts`, `chat/chat.service.escalate-no-team.spec.ts`, `messenger/messenger-ingest.service.spec.ts` | Nhân viên suspended/invited bị loại ở cả hai nhánh; tải gồm cảnh báo chờ; chọn xác định; Messenger không hỏi đội |

## 2. Kết quả chạy (bản gộp S1+S3, cây `test/go2joy-integration` `f7266697`)

| Bộ | Kết quả |
|---|---|
| jest API | 2478 đạt, 3 lỗi nền Windows (cùng 3 suite lỗi trên `main`) |
| widget | 61/61 |
| `tsc` api/web/widget | 0 lỗi ×3 |
| `i18n:check` | đủ 6 ngôn ngữ |

## 3. Kịch bản tích hợp cần chạy trên staging (chưa chạy)

| # | Kịch bản | Kỳ vọng |
|---|---|---|
| I-1 | Khách chưa đăng nhập hỏi một câu công khai rồi hỏi tiếp câu ngoài nhóm công khai (agent `guide_login`) | Câu thứ hai nhận lời nhắc đăng nhập, không có nội dung tài liệu ngoài phạm vi |
| I-2 | Lễ tân A đăng nhập, chat, đăng xuất; B đăng nhập trên cùng trình duyệt | B bắt đầu hội thoại trống; hội thoại của A không hiện; hàng chờ của A (nếu có) vẫn ở trạng thái cũ |
| I-3 | Quản lý đổi khách sạn 1721 → 2204 trong Hotel Admin (gọi lại `identify`) | Phiên mới; không có lịch sử của 1721 trong prompt hoặc khung chat |
| I-4 | Nhân viên SA bật "Trực", rồi đóng tab 2 phút | Sau 90 s không còn tính online; cảnh báo chuyển sang người kế tiếp hoặc phát chung |
| I-5 | Khách sạn có tỉnh "Sài Gòn" khi bảng đã nạp bộ có sẵn | Vùng Nam; cảnh báo ghi "Vùng"; nhân viên đội Nam trực nhận trước |
| I-6 | Tỉnh không có trong bảng | Cảnh báo ghi "Region: ? (unmapped: …)"; một dòng cảnh báo log mỗi giờ |
| I-7 | "Gặp nhân viên" ngoài giờ làm việc | Khách được xin email; trả lời của nhân viên được gửi mail; hội thoại không bị dọn idle đóng sau 30 phút |
| I-8 | Tin Messenger yêu cầu gặp người khi bật hỏi đội | Cảnh báo tới nhân viên theo nhãn mặc định, không kẹt ở "choose" |

## 4. Ca biên chưa có test tự động

Mất mạng giữa lúc đặt lại widget (khách không có phiên); tab cũ còn token trước khi tách; `identity_level` còn `verified` sau DSAR; số liệu phiên khi tách; bộ kiểm trực quan của UI (công tắc Trực, nút nạp bộ tỉnh). Apps/web không có bộ test; chỉ có `tsc`.
