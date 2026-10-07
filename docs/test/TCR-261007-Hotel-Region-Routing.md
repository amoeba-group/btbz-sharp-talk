# TCR-261007 — Định tuyến theo vùng của khách sạn (Hotel Region Routing), giai đoạn R1

- Ngày: 2026-10-07 · Căn cứ: `docs/plan/PLN-261007-Hotel-Region-Routing.md` (đã duyệt) · Nhánh: `feature/hotel-region-routing` (từ `test/go2joy-integration`, vì đứng trên role-region, team-routing và gate-ui)
- Phạm vi: T1–T11. R2 (chế độ chỉ báo đội vùng) và R3 (nạp danh mục khách sạn bằng CSV) chưa làm.
- ⚠️ File đính kèm định nghĩa vùng của Go2Joy vẫn chưa tới. Bảng tỉnh dùng khi kiểm là **dữ liệu thử do tôi nhập**, không phải bảng thật và không được nạp mặc định. Bật tính năng mà chưa nhập tỉnh thì mọi khách sạn đều "chưa xác định vùng" và định tuyến theo nhãn như cũ.

## 1. Đơn vị / kiểu
| # | Kiểm tra | Kết quả |
|---|---|---|
| U1 | `packages/types` `region.spec.ts` (11 ca): chuẩn hóa tỉnh (dấu, đ, hoa thường, dấu câu, tiền tố "tỉnh / thành phố / tp / thủ đô"), không cắt nhầm tỉnh bắt đầu bằng chữ giống tiền tố, mã ngắn, ánh xạ tỉnh → vùng và đội, cùng một khóa cho mọi cách viết, tỉnh trùng ở nhiều vùng thì vùng đứng trước thắng và bị báo, hàng sai id bị bỏ, đội sai được sửa về mặc định, nhãn vùng | PASS |
| U2 | `embed.service.v2.spec.ts` +6 ca: chuỗi ký chỉ thêm `\|province` khi có; ghi tỉnh từ chữ ký có tỉnh; **đổi tỉnh sau khi ký bị từ chối**; **thêm tỉnh vào chữ ký không có tỉnh bị từ chối**; **gỡ tỉnh khỏi chữ ký có tỉnh bị từ chối**; không tỉnh thì không ghi tỉnh | PASS |
| U3 | `handoff-router.service.spec.ts` +4 ca `regionOf`: tỉnh có trong bảng cho đội và nhãn; null với khách, v1, tỉnh trống hoặc không có trong bảng; **không tin tỉnh không ký**; null khi bảng tắt hoặc không cấu hình | PASS |
| U4 | `chat.service.region-routing.spec.ts` (5 ca): `escalate` ghi `support_region` và đưa vùng vào sự kiện; không vùng thì y như cũ; **tra vùng lỗi không chặn hand-off**; chuyển người tự động cũng định tuyến theo vùng; preview sandbox không tra, không ghi | PASS |
| U5 | `agent-alert.service.spec.ts` +6 ca thang vùng: người online đúng vùng thắng người vùng kia; không có thì người toàn quốc; **không bao giờ chọn vùng kia** (rơi về assignee cấu hình rồi broadcast); bỏ qua nhân viên đã vô hiệu; có vùng không có nhãn thì tìm nhãn consult; không vùng thì bỏ qua vùng hoàn toàn. +2 ca tóm tắt: thứ tự Team → Region → Partner → preview, mỗi dòng độc lập | PASS (18 ca) |
| U6 | `agent.service.listsessions.spec.ts` +4 ca: lọc `north`/`south`, `none` là `IS NULL`, `all`/trống/bỏ qua không thêm mệnh đề, hàng chờ mang `supportRegion` | PASS |
| U7 | Toàn bộ jest API | 2217 PASS; 3 suite lỗi (`heic-conversion`, `board-attachment.service`, `embed-loader`) cùng 3 suite và cùng thông báo lỗi trên `main` cùng máy |
| U8 | `packages/types` jest | 165 PASS |
| U9 | widget `node --test "test/*.test.mjs"` | 57 PASS |
| U10 | `tsc --noEmit` api, web, widget (map src) | PASS |
| U11 | `npm run i18n:check` sau khi thêm aiSetting.handoff 18 khóa (gồm nhóm lồng) · livechat.region 6 khóa + partner.province ×6 ngôn ngữ | complete |
| U12 | `check-migrations --check` | up to date, có `261007-conversation-support-region.sql conversations.support_region` |
| U13 | Thực boot API (dev) sau khi thêm `Conversation.supportRegion` (type tường minh, bài học A-1) | `successfully started` |

## 2. Trình duyệt và API thật (dev, seed master ivyusa, SQL 261007-conversation-support-region áp trước, chat/moderation/rag tạm trỏ engine stub)
Nhân viên thử: `rr-cs-north` (consult, Bắc), `rr-cs-south` (consult, Nam), `rr-sa-south` (sales_admin, Nam), `rr-cs-all` (consult, vùng trống); cả bốn online. Đội chọn qua câu hỏi đội, tỉnh đi trong identify v2 có chữ ký.

| # | Kịch bản | Kết quả |
|---|---|---|
| R1 | Tenant Settings › Agent handoff: tick "Hand the conversation to the hotel's regional team" → hiện bảng 4 hàng (Bắc, Bắc Trung, Nam Trung, Nam), đội mặc định Bắc/Bắc/Nam/Nam; nhập tỉnh thử vào từng hàng; gõ "da nang" vào ô thử | "South Central · South team"; Save lưu `handoff_config.regionRouting` đúng 4 hàng |
| R2 | Khách sạn "Da Nang" (không dấu), chọn CS | `support_region=south`; cảnh báo nhắm `rr-cs-south` (cùng nhãn, cùng vùng) |
| R3 | Đội Nam hết online (`rr-cs-south` offline), khách sạn "TP. Hồ Chí Minh", chọn CS | `support_region=south`; cảnh báo nhắm `rr-cs-all` (người toàn quốc), không phải `rr-cs-north` |
| R4 | Khách sạn "Hà Nội", chọn Business, chỉ có SA của vùng Nam online | `support_region=north`; cảnh báo **broadcast** (`target_user_id` rỗng); không chọn `rr-sa-south` |
| R5 | Tỉnh "Vientiane" (không có trong bảng), chọn CS | `support_region` rỗng; định tuyến theo nhãn như cũ |
| R6 | Khách chưa đăng nhập (không claims), chọn CS | `support_region` rỗng; định tuyến theo nhãn như cũ |
| R7 | Ký với tỉnh "Cần Thơ" nhưng gửi "Hà Nội" | identify 401 (E5048); phiên ở lại là khách |
| R8 | Live Chat: hàng chờ | Mỗi hàng có dòng đối tác (Hotel Test · 1721, signed), badge đội, badge vùng ("South", "North") |
| R9 | Live Chat: bộ lọc "Vùng" (All regions / North / South / Unknown region) | South chỉ hai hàng Nam; North chỉ một hàng Bắc; Unknown region chỉ hai hàng không có vùng (R5, R6) |
| R10 | Header của hội thoại | "Manager @ Hotel Test · 1721 (hotelSn 1721) · Da Nang ✔ signed", badge "Team: Customer Service", badge "Region: South" |

Dọn sau kiểm: xóa 4 nhân viên thử và lời mời, trả engine 2 cho chat/moderation/rag, bật lại `must_change_password` của seed master, gỡ `teamRouting` và `regionRouting` của tenant ivyusa dev. Secret identify của tenant ivyusa dev đã bị xoay vòng (chỉ dev).

## 3. Phát hiện trong khi làm
- Chữ ký phụ thuộc việc có hay không có `province`: đây là chủ đích (không thể thêm hay gỡ tỉnh mà vẫn hợp lệ) nhưng đồng nghĩa Go2Joy gửi tỉnh mà ký theo công thức cũ sẽ bị 401. Đã ghi rõ trong hướng dẫn SDK (tiếng Hàn §3.4) và Mobile SDK, kèm ví dụ PHP.
- Cảnh báo cho tỉnh không có trong bảng nằm ở log API (`region routing: province "X" is not in the table`), không có giao diện riêng. Nếu Go2Joy gửi nhiều cách viết khác nhau thì đây là nơi để xem cần thêm gì vào bảng.
- Người dùng ở trạng thái `invited` (chưa nhận lời mời) vẫn được chọn nếu hồ sơ online. Giống hành vi chọn người theo nhãn hiện có; chỉ `inactive` bị loại.

## 4. Chưa kiểm
- Bảng tỉnh thật của Go2Joy (chờ file đính kèm) và cách họ viết tên tỉnh (trước hay sau sáp nhập 2025).
- Hộp thư ngoài giờ riêng cho từng vùng (chưa làm, chỉ là câu hỏi cho Go2Joy).
- Dòng `Region:` trong Slack và email thật: chỉ có spec (mailer giả).
- R2 và R3.

## 5. Kịch bản staging (sau deploy)
1. Áp SQL theo thứ tự: `261007-user-role-region.sql` (utf8mb4), `261007-conversation-support-type.sql`, `261007-conversation-support-region.sql`; kiểm `SHOW COLUMNS FROM conversations LIKE 'support_region'`.
2. Tenant go2joy: nhập bảng tỉnh theo file đính kèm vào Tenant Settings › Agent handoff, dùng ô "Try a province" thử vài tỉnh mỗi vùng, rồi bật.
3. Users & Labels: gán `region` cho từng CS và SA (Bắc hoặc Nam), để trống cho người phụ trách toàn quốc.
4. Go2Joy cập nhật identify v2 để gửi và ký `province`; thử bằng tài khoản UAT một khách sạn Bắc và một khách sạn Nam.
5. Theo dõi log `region routing: province "…" is not in the table` trong tuần đầu, bổ sung bảng khi thấy.
