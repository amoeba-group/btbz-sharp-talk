# FIX-261012 — Khách chưa đăng nhập nhận tài liệu ngoài phạm vi công khai ở câu hỏi tiếp nối

- Ngày: 2026-10-12/13 · REQ: `REQ-261012-Go2Joy-Stage1-Gap-Closure` D-01 · Mức: **nghiêm trọng** (rò nội dung chỉ dành cho đối tác đã đăng nhập)
- Nhánh: `feature/guest-login-gate` (PR chưa mở nên sửa thẳng vào nhánh gốc)
- Trạng thái: đã sửa và có test hồi quy; **chưa deploy** (xem §5)

## 1. Triệu chứng

Với agent đặt `guest_policy = guide_login`, người chưa đăng nhập chỉ được trả lời từ các nhóm KB đánh dấu "công khai". Ở **câu hỏi tiếp nối** (câu trước đó đã có trong hội thoại), phạm vi này không còn áp cho một trong hai lượt tìm kiếm, nên kết quả có thể gồm tài liệu của nhóm chỉ dành cho đối tác (đối soát, đổi tài khoản ngân hàng, quyền nhân viên…).

## 2. Nguyên nhân gốc

`RagService.answer()` tìm hai lần khi có ngữ cảnh: lần một gộp các lượt trước (để câu hỏi cụt vẫn tìm đúng chủ đề), lần hai chỉ dùng câu hiện tại (FIX-261007-Topic-Switch, để câu đổi chủ đề không bị kéo về chủ đề cũ). Phạm vi khách (`opts.guestOnly`) được truyền cho lần một nhưng **lần hai gọi `retrieveHybrid(...)` thiếu tham số cuối**. Kết quả lần hai được ưu tiên đứng đầu khi gộp (`mergeOwnFirst`), nên tài liệu ngoài phạm vi vào thẳng danh sách đưa cho mô hình.

Vì sao không bị bắt:
- `opts` là tham số **tuỳ chọn ở cuối** nên bỏ sót không gây lỗi biên dịch.
- Test cũ (`rag-answer-scope.spec.ts`) chỉ kiểm giá trị `agentId` tới tầng truy xuất và chỉ ở lượt không có ngữ cảnh, tức là chỉ một lần gọi.
- Hai thay đổi sinh ra ở hai nhánh khác nhau và **chỉ gặp nhau khi gộp**: lượt tìm thứ hai đến từ `main` (#597, FIX-261007-Topic-Switch), còn nhánh cổng khách được viết khi `rag.service.ts` mới có một lượt tìm (bản `backup/1012/guest-login-gate` không có lượt hai). Git gộp sạch, không báo xung đột vì hai chỗ sửa nằm xa nhau, nên không ai phải nhìn lại. Lỗi có mặt từ nhánh tích hợp đầu tiên và từ đợt rebase 12/10, **không có trong nhánh `feature/guest-login-gate` đã push trước đó**.
- Không có test nào xác nhận mọi lượt tìm đều nhận cùng phạm vi.
- Lỗi chỉ xuất hiện ở lượt tiếp nối của khách chưa đăng nhập; spec cổng khách (`chat.service.guest-gate*.spec.ts`) mock `RagService` nên không thấy.

## 3. Sửa

1. `rag.service.ts`: lượt tìm "câu hiện tại" nhận `opts`.
2. Phòng ngừa cấu trúc: `retrieveHybrid` nay **không còn tham số tuỳ chọn** (`limit`, `preferGroup`, `aiAgentId`, `opts` đều bắt buộc, truyền `undefined` có chủ ý). Thêm lần tìm mới mà quên phạm vi sẽ lỗi biên dịch.
3. Test hồi quy trong `rag-answer-scope.spec.ts`: câu tiếp nối của khách → cả hai lượt tìm đều nhận `{guestOnly:true}` và cùng `agentId`; lượt không ngữ cảnh → một lượt tìm có phạm vi; người đã đăng nhập → hai lượt không bị phạm vi khách chi phối. Xác nhận: bỏ phần sửa thì test thứ nhất thất bại.

## 4. Kiểm chứng

| Kiểm | Kết quả |
|---|---|
| `tsc` api | 0 lỗi |
| jest `chat` + `knowledge` + `ai-engine` | 74 suite / 719 test đạt |
| Test hồi quy khi bỏ phần sửa | thất bại 1/5 đúng ca (xác nhận bắt được lỗi) |

Chưa kiểm: truy xuất thật qua Qdrant/MySQL (local dùng embedding giả). Việc kiểm "khách hỏi tiếp nối không nhận tài liệu ngoài nhóm công khai" bằng dữ liệu thật thuộc SG-51 (mô phỏng cổng "Thử với tư cách…") và UAT.

## 5. Phạm vi ảnh hưởng và triển khai

- Chỉ ảnh hưởng tenant/agent bật `guest_policy = guide_login`. Mặc định là `open`. `main` (production) có lượt tìm thứ hai nhưng **chưa có cổng khách**, nên không ai bị lộ; staging đã áp SQL của cổng khách (07/10) nhưng mã chưa deploy. Lỗi chưa từng chạy trên môi trường nào ngoài local.
- Nhánh `test/go2joy-integration` đã push lên origin (`73ff8acf`) **chứa lỗi này**; bản sửa là commit cherry-pick kế tiếp trên nhánh đó (local, chưa push).
- Trước khi bật `guide_login` cho Go2Joy phải có bản mã chứa sửa này.
- Trạng thái deploy: chưa có PR, chưa merge, chưa deploy ở môi trường nào.

## 6. Mẫu phòng ngừa (đưa vào memory/dev-kit)

> Phạm vi truy cập (agent, đối tượng, khách) là tham số **bắt buộc** của mọi hàm tầng truy xuất, không phải tuỳ chọn cuối. Một hàm có hai lượt tìm trở lên phải có test khẳng định **mọi lượt** nhận cùng phạm vi, kèm ca "tắt phạm vi thì test phải đỏ".
