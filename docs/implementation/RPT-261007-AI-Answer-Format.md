# RPT-261007 — Câu trả lời AI ngắn, có cấu trúc trong widget

- Ngày: 2026-10-07 (rebase lên `main` 9fd31630 ngày 2026-10-12) · Nhánh: `feature/ai-answer-format` · Người yêu cầu: dev@amoeba.group
- Yêu cầu (chat, 2026-10-07): "format response được tổ chức chuyên nghiệp, đơn giản, rõ ràng — response longtext làm user thấy không chuyên nghiệp". Người dùng chọn làm thẳng, bỏ qua REQ/PLN.
- Phạm vi sau rebase: nhánh **chỉ còn phần prompt** (backend). Phần hiển thị (`- `/`1. `/`**…**` → danh sách + chữ đậm trong bubble) đã được `main` cung cấp bằng #630 (PLN-261008, component `RichText`), nên bộ render riêng của nhánh này (`reply-format.ts` + test) đã bị bỏ để không trùng lặp.

## 1. Thay đổi

| # | Việc | Tệp |
|---|---|---|
| 1 | Quy tắc định dạng cố định trong system prompt của mọi câu trả lời RAG (không phụ thuộc rule tenant): mở đầu bằng câu trả lời trực tiếp 1–2 câu, rồi điều kiện/ngoại lệ; tối đa ~5 câu hoặc danh sách ≤5 mục, mỗi ý một dòng, `- ` cho danh sách, `1. ` cho bước; chỉ `**nhãn**` in đậm cho dòng mở đầu; không heading/bảng/markup khác; không lặp lại câu hỏi hay mô tả nguồn. Đứng cạnh `FOOTER_RULE` (main) trong cùng prompt, kế thừa thứ tự `persona → rules → FORMAT_RULES → CONVERSATION_RULES → FOOTER_RULE` | `apps/api/src/domain/chat/rag.service.ts` (`FORMAT_RULES`) |
| 2 | Rule mặc định mới cho tenant chưa tùy chỉnh: "hơn 2 ý hoặc bước → danh sách ngắn" | `apps/api/src/domain/ai-engine/ai-config.service.ts` (`DEFAULT_RULES`) |

Không migration, không env. Markup mô hình được phép sinh ra (`**nhãn**`, `- `, `1. `) khớp đúng tập mà `RichText` (#630) vẽ.

## 2. Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| `tsc --noEmit` api (sau rebase) | pass |
| jest `src/domain/chat` + `src/domain/ai-engine` (sau rebase lên 9fd31630) | 37 suite / 316 pass |
| Mô hình thật (2026-10-08, khóa Anthropic đã gia hạn; 8 câu hỏi VI/EN/KO) | Trả lời đúng ngôn ngữ, dùng `**nhãn**` / `- ` / `1. ` đúng quy ước, ngắn gọn; không bị moderation chặn. Một số câu trả lời "không tìm thấy" chỉ do embedding stub ở local (không có khóa Voyage) — không phải do prompt |
| Hiển thị | Thuộc #630 trên `main` (đã lên staging/production) — không kiểm lại ở nhánh này |

**Chưa kiểm được:** hồi quy FAQ golden với `FORMAT_RULES` trên staging (cần embedding thật). Nếu mô hình vẫn viết dài, siết thêm bằng `max_tokens` cho `chat_answer` (chưa đặt).

## 3. Ghi chú vận hành
- Tenant đã lưu rule riêng (vd. ivyusa) không tự nhận rule mặc định #2; `FORMAT_RULES` (#1) vẫn áp dụng cho tất cả.
- Khi đổi cú pháp markup mà prompt cho phép, phải đổi đồng bộ với `RichText` (widget) — hai bên là một hợp đồng.
