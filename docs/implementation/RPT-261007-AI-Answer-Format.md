# RPT-261007 — Câu trả lời AI ngắn, có cấu trúc trong widget

- Ngày: 2026-10-07 · Nhánh: `feature/ai-answer-format` (từ `main` 52f0d21d) · Người yêu cầu: dev@amoeba.group
- Yêu cầu (chat, 2026-10-07): "format response được tổ chức chuyên nghiệp, đơn giản, rõ ràng — response longtext làm user thấy không chuyên nghiệp". Người dùng chọn làm thẳng, bỏ qua REQ/PLN.

## 1. Thay đổi

| # | Việc | Tệp |
|---|---|---|
| 1 | Quy tắc định dạng cố định trong system prompt của mọi câu trả lời RAG (không phụ thuộc rule tenant): mở đầu bằng câu trả lời trực tiếp 1–2 câu, rồi điều kiện/ngoại lệ; tối đa ~5 câu hoặc danh sách ≤5 mục, mỗi ý một dòng, `- ` cho danh sách, `1. ` cho bước; chỉ `**nhãn**` in đậm cho dòng mở đầu; không heading/bảng/markup khác; không lặp lại câu hỏi hay mô tả nguồn | `apps/api/src/domain/chat/rag.service.ts` (`FORMAT_RULES`) |
| 2 | Rule mặc định mới cho tenant chưa tùy chỉnh: "hơn 2 ý hoặc bước → danh sách ngắn" | `apps/api/src/domain/ai-engine/ai-config.service.ts` (`DEFAULT_RULES`) |
| 3 | Widget vẽ `- `/`1. `/`**…**` thành danh sách và in đậm thật cho bubble của bot/nhân viên; bubble của khách giữ text thuần; không phải markdown renderer — mọi ký tự khác giữ nguyên | `apps/widget/src/lib/reply-format.ts` (mới), `apps/widget/src/components/chat/MessageBubble.tsx` |

Không migration, không env.

## 2. Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| `tsc --noEmit` api, widget | pass |
| jest `src/domain/chat` + `src/domain/ai-engine` | 33 suite / 287 pass |
| `node --test apps/widget/test/reply-format.test.mjs` (6 ca: đoạn văn, bullet + dòng mở đầu, bước `1.`/`2)`, đoạn trống tách khối, chỉ `**bold**` là markup, `2024.` giữa dòng không phải bước) | 6/6 |
| Trình duyệt (dev stack, widget standalone, nhân viên trả lời hội thoại #28 qua `/agent/conversations/:id/message` với nội dung có nhãn đậm + 2 bullet + 3 bước) | Bubble hiển thị đúng: **Return policy:** in đậm, danh sách chấm, danh sách số |

**Chưa kiểm được:** câu trả lời thật của mô hình theo `FORMAT_RULES` — khóa Anthropic ở local hết credit (API trả 400 "credit balance is too low", gateway rơi về stub). Cần xem trên staging (có khóa) với 10 câu VI/EN mẫu: đếm số câu, số dòng, có danh sách khi ≥3 ý. Nếu mô hình vẫn viết dài, siết thêm bằng `max_tokens` cho `chat_answer` (chưa đặt).

## 3. Ghi chú vận hành
- Tenant đã lưu rule riêng (vd. ivyusa) không tự nhận rule mặc định #2; `FORMAT_RULES` (#1) vẫn áp dụng cho tất cả.
- Dữ liệu dev dùng để thử (hội thoại #27/#28, routing engine) đã khôi phục; không để lại thay đổi trên DB dev ngoài 2 hội thoại thử.
