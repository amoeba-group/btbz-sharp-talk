# RPT-261015 Phân loại 78 xung đột tri thức của Go2Joy (PLN-261015 D8)

- Phạm vi: 78 `kb_conflicts` có `status=pending` của go2joy (tenant 4) trên staging (tính đến 2026-10-15 16:40 KST)
- Căn cứ: Với từng cặp, chúng tôi đã đối chiếu trực tiếp văn bản gốc, khóa ngoài (`external_key`), danh mục và ngày đăng ký. Kết luận của mô hình (`verdict`) chỉ dùng để tham khảo.
- Tài liệu này chỉ gồm kết quả phân loại và hành động đề xuất. Không có dữ liệu staging nào bị thay đổi.

## 1. Tóm tắt

| Nhóm | Số lượng | Kết luận của mô hình | Bản chất thực tế | Hành động đề xuất | Bên quyết định |
|---|---:|---|---|---|---|
| **F. Cần sửa (sai lệch thông tin)** | 3 | mâu thuẫn 2 · bổ sung 1 | Sổ tay tóm tắt khác với hướng dẫn video (màn hình thực tế) | Sửa sổ tay tóm tắt ở cả 3 ngôn ngữ | Go2Joy xác nhận → Amoeba sửa |
| **P. Tài liệu chính sách 2 bản** | 3 | trùng lặp 3 | Cùng một văn bản điều khoản được đăng ký hai lần, ngày 8/20 và 8/29 | Giữ một bản, ngừng kích hoạt bản còn lại | Go2Joy (giữ bản nào) |
| **Q. FAQ cùng câu trả lời, khác câu hỏi** | 32 | trùng lặp 32 | 2 câu trả lời được sao chép cho 13 câu hỏi | Gộp thành 1 tài liệu cho mỗi câu trả lời, giữ các câu hỏi làm biến thể | Go2Joy (câu hỏi nào cần câu trả lời riêng) |
| **T. Bản dịch theo ngôn ngữ** | 20 | trùng lặp 20 | Các bản ko / EN / VI của cùng một mục (cấu trúc có chủ đích) | Giữ cả hai, xử lý xung đột là 'giữ cả hai' | Amoeba tự làm được |
| **V. Sổ tay tóm tắt ↔ hướng dẫn video** | 11 | bổ sung 11 | Bản tóm tắt và bản chi tiết, nội dung khớp nhau | Giữ cả hai, xử lý xung đột là 'giữ cả hai' | Amoeba tự làm được |
| **D. Quy trình khác nhau** | 9 | bổ sung 9 | Các quy trình riêng biệt: theo giờ / theo ngày / qua đêm, v.v. | Giữ cả hai, xử lý xung đột là 'giữ cả hai'. Riêng bản nháp BRD-1 cần quyết định riêng | Amoeba tự làm được (BRD-1 do Go2Joy quyết định) |
| Tổng | **78** | | | | |

**Kết luận**: Chỉ có **3 trường hợp nhóm F** thực sự có thể dẫn đến câu trả lời sai. 35 trường hợp nhóm P và Q là đối tượng dọn dẹp vì cùng một nội dung có nhiều bản (câu trả lời không sai, nhưng chiếm chỗ trong kết quả tìm kiếm). 40 trường hợp còn lại (T·V·D) là các cặp mà cả hai tài liệu đều đúng, nên chỉ cần xử lý là 'giữ cả hai'.

## 2. F. Cần sửa — 3 trường hợp (ưu tiên 1)

### C248 Flash sale theo giờ: nhập giá có phải là "không bắt buộc"?
| Tài liệu | Nội dung |
|---|---|
| #2528 `GTJ-FLS-01-EN` Set Up Hourly Flash Sale (sổ tay tóm tắt) | "For hourly flash sales, **price setup is optional**." |
| #2628 `GTJ-VID-08-EN` Video 8 (hướng dẫn video) | Ô `Giá FS cho 2 giờ đầu`\* (giá FS cho 2 giờ đầu) là **bắt buộc**, `Giá FS cho 1 giờ thêm (Không bắt buộc)` (giá cho mỗi giờ thêm) là **không bắt buộc** |

- Đánh giá: Trên màn hình thực tế (video), giá cho 2 giờ đầu là bắt buộc. Chỉ giá cho giờ thêm là không bắt buộc. Câu "giá là không bắt buộc" trong sổ tay tóm tắt có vẻ không phân biệt hai ô này.
- Ảnh hưởng: Nếu nhân viên lễ tân hỏi "Không nhập giá có được không?", AI có thể trả lời "Không bắt buộc".
- Đề xuất sửa: Đổi phần lưu ý trong `GTJ-FLS-01` / `-EN` / `-VI` (#2508, #2528, #2548) thành "Giá cho 2 giờ đầu là bắt buộc, giá cho giờ thêm là không bắt buộc".

### C218 · C219 Dừng flash sale: thiếu bước xác nhận
| Tài liệu | Nội dung |
|---|---|
| #2510 `GTJ-FLS-03` Dừng flash sale (sổ tay tóm tắt) | Chọn phòng và loại đặt phòng trên dòng thời gian → chi tiết → [Dừng chương trình] → thông báo thành công |
| #2630 `GTJ-VID-10-EN` / #2578 `GTJ-VID-10-VI` (hướng dẫn video) | Quản lý loại phòng › danh sách loại phòng, bấm vào nhãn FS trên dòng thời gian → hộp thoại chi tiết → [Dừng chương trình] → **hộp thoại xác nhận [Xác nhận dừng]** → thông báo thành công |

- Đánh giá: Mô hình kết luận C218 là mâu thuẫn ("đường dẫn khác nhau") và C219 là bổ sung, nhưng hai cặp này là cùng một vấn đề. Đường dẫn thực ra là cùng một chỗ ("dòng thời gian" trong bản tóm tắt = dòng thời gian trong danh sách loại phòng). Khác biệt thực sự duy nhất là **bản tóm tắt thiếu bước hộp thoại xác nhận**.
- Ảnh hưởng: Thông tin không sai, nhưng nhân viên có thể thấy cửa sổ xác nhận và hỏi lại "Có cửa sổ hiện ra mà sổ tay không nhắc đến".
- Đề xuất sửa: Thêm bước "bấm [Xác nhận/Xác nhận dừng] trong hộp thoại xác nhận" vào quy trình của `GTJ-FLS-03` / `-EN` / `-VI` (#2510, #2530, #2550), và ghi đường dẫn là "Quản lý loại phòng › Danh sách loại phòng › Dòng thời gian".

## 3. P. Tài liệu chính sách 2 bản — 3 trường hợp

| Xung đột | Bản đăng ký 8/20 | Bản đăng ký 8/29 | Khác biệt |
|---|---|---|---|
| C210 | #2360 `BRD-18` Thỏa thuận dịch vụ (danh mục `policy`) | #2565 `BRD-13` A. ĐIỀU KHOẢN SỬ DỤNG… (danh mục `service agreement`) | Nội dung giống nhau, khác 1 dòng tiêu đề |
| C211 | #2361 `BRD-17` Chính sách bảo mật (`policy`) | #2566 `BRD-12` PHỤ LỤC I CHÍNH SÁCH BẢO MẬT… (`police_privacy`) | Nội dung giống nhau |
| C212 | #2362 `BRD-16` Chính sách thanh toán (`policy_payment`) | #2567 `BRD-11` A. Phương thức thanh toán (`policy_price`) | Nội dung giống nhau, chỉ khác tiêu đề |

- Đề xuất: Chỉ giữ một bản. Phương án của Amoeba là **giữ bản đăng ký 8/20 (#2360~#2362) và ngừng kích hoạt bản đăng ký 8/29 (#2565~#2567)**. Lý do: tên danh mục của bản 8/29 có lỗi chính tả (`police_privacy`), và `policy_price` khiến chính sách thanh toán trông giống chính sách giá.
- Go2Joy xác nhận: Vui lòng xác nhận văn bản nào là điều khoản mới nhất. Hiện nội dung giống nhau, nhưng từ nay chỉ nên sửa một bản, nên cần chọn bản chuẩn.

## 4. Q. FAQ cùng câu trả lời, khác câu hỏi — 32 trường hợp

13 tài liệu FAQ chỉ khác nhau ở câu hỏi đang dùng chung 2 câu trả lời được sao chép. 32 xung đột là kết quả ghép cặp giữa 13 tài liệu này.

| Câu trả lời | Tài liệu (câu hỏi) |
|---|---|
| Hướng dẫn đặt phòng 3 bước (ứng dụng và web) | #2347 `BRD-31` Tôi muốn đặt phòng · #2348 `BRD-30` Tôi muốn đặt KS ở 1 đêm · #2349 `BRD-29` Cách đặt phòng · #2350 `BRD-28` Tôi muốn tìm KS ở quận 7 · #2351 `BRD-27` Bên KS mình còn phòng ko? · #2352 `BRD-26` Cho xin giá thuê KS này theo giờ ạ · #2353 `BRD-25` Có khách sạn tình yêu không? · #2354 `BRD-24` Muốn check-in lúc 12h đêm · #2355 `BRD-23` Xin giá phòng có bồn tắm · #2356 `BRD-22` Thuê phòng couple |
| Không thể đặt nhiều phòng cùng lúc (đặt lặp lại từng phòng một) | #2357 `BRD-21` Đặt 2 phòng được không? · #2358 `BRD-20` Tôi muốn đặt nhiều phòng thì làm thế nào? · #2359 `BRD-19` Muốn đặt 2 phòng thì làm thế nào? |

Mã xung đột: C124~C155 (32 trường hợp)

- Vấn đề 1 (dọn dẹp): Khi cùng một câu trả lời có 10 bản, các tài liệu này chiếm các vị trí đầu trong kết quả tìm kiếm và đẩy các tài liệu căn cứ khác ra ngoài.
- Vấn đề 2 (nội dung): Các câu hỏi như "muốn check-in lúc nửa đêm" (BRD-24), "giá phòng có bồn tắm" (BRD-23), "tìm khách sạn ở quận 7" (BRD-28) cũng chỉ nhận được hướng dẫn đặt phòng chung. Cần Go2Joy xác nhận câu trả lời có phù hợp với câu hỏi không.
- Vấn đề 3 (phạm vi): FAQ này là câu trả lời cho **khách đặt phòng**, nhưng phạm vi AI agent của danh mục `faq`·`policy` đang để trống (= tất cả), nên **AI agent Hotel Admin cũng dùng các tài liệu này làm căn cứ**. Nếu nhân viên lễ tân hỏi "Đặt phòng như thế nào?", AI có thể trả lời bằng hướng dẫn đặt phòng trên ứng dụng dành cho khách.
- Đề xuất:
  1. Mỗi câu trả lời chỉ giữ 1 tài liệu (ví dụ `BRD-29` Cách đặt phòng, `BRD-19`), chuyển các câu hỏi khác vào nội dung tài liệu đó dưới dạng danh sách "Câu hỏi tương tự", sau đó ngừng kích hoạt 11 tài liệu còn lại.
  2. Với các câu hỏi cần câu trả lời riêng (check-in nửa đêm, phòng có bồn tắm, tìm theo khu vực, v.v.), khi Go2Joy cung cấp câu trả lời thì tạo tài liệu riêng.
  3. Thống nhất với Go2Joy có thu hẹp phạm vi AI agent của danh mục `faq`·`policy` về các AI agent dành cho khách (`default`, `landing-guest`) hay không. Các tài liệu này sẽ được dùng lại ở giai đoạn 2 (AI agent hỗ trợ khách theo từng khách sạn), nên không xóa.

## 5. T. Bản dịch theo ngôn ngữ — 20 trường hợp

Đây là bản tiếng Hàn (không có hậu tố), bản tiếng Anh (`-EN`) và bản tiếng Việt (`-VI`) của cùng một mã mục. Nội dung giống nhau là bình thường, nên xử lý là 'giữ cả hai'.

| Xung đột | Tài liệu A | Tài liệu B |
|---|---|---|
| C222 | #2517 GTJ-LCK-03 Khóa phòng – Qua đêm (Room Lock – Overnight) | #2537 GTJ-LCK-03-EN Room Lock – Overnight |
| C237 | #2524 GTJ-DIS-01-EN Create / Edit a Direct Discount Program | #2544 GTJ-DIS-01-VI Tạo / Sửa chương trình giảm giá trực tiếp (Create / Edit a Direct Disc |
| C207 | #2516 GTJ-LCK-02 Khóa phòng – Theo ngày (Room Lock – By Day) | #2536 GTJ-LCK-02-EN Room Lock – By Day |
| C246 | #2528 GTJ-FLS-01-EN Set Up Hourly Flash Sale | #2548 GTJ-FLS-01-VI Thiết lập Flash Sale theo giờ (Set Up Hourly Flash Sale) |
| C244 | #2527 GTJ-DIS-04-EN Stop a Direct Discount Program | #2547 GTJ-DIS-04-VI Dừng chương trình giảm giá trực tiếp (Stop a Direct Discount Program) |
| C249 | #2529 GTJ-FLS-02-EN Set Up Overnight Flash Sale | #2549 GTJ-FLS-02-VI Thiết lập Flash Sale qua đêm (Set Up Overnight Flash Sale) |
| C243 | #2526 GTJ-DIS-03-EN View Discount Program List | #2546 GTJ-DIS-03-VI Xem danh sách chương trình giảm giá (View Discount Program List) |
| C240 | #2525 GTJ-DIS-02-EN Search Direct Discount Programs | #2545 GTJ-DIS-02-VI Tìm kiếm chương trình giảm giá trực tiếp (Search Direct Discount Progr |
| C234 | #2522 GTJ-DSH-01-EN View Dashboard | #2542 GTJ-DSH-01-VI Xem Bảng điều khiển (View Dashboard) |
| C236 | #2523 GTJ-REV-01-EN Reply to a Review | #2543 GTJ-REV-01-VI Trả lời đánh giá (Reply to a Review) |
| C225 | #2518 GTJ-LCK-04 Mở khóa phòng (Delete Room Lock Settings) | #2538 GTJ-LCK-04-EN Delete Room Lock Settings |
| C228 | #2519 GTJ-RPT-01 Tải báo cáo phòng giá đặc biệt (Download "Shock-Discount Room" Report) — *Cần bổ sung (Updat | #2539 GTJ-RPT-01-EN Download "Shock-Discount Room" Report — *Pending update (Updating)* |
| C232 | #2521 GTJ-STA-01 Định nghĩa giá trị trạng thái (Status Values) | #2541 GTJ-STA-01-EN Status Values |
| C204 | #2515 GTJ-LCK-01 Khóa phòng – Theo giờ (Room Lock – Hourly) | #2555 GTJ-LCK-01-VI Khóa phòng – Theo giờ (Room Lock – Hourly) |
| C226 | #2518 GTJ-LCK-04 Mở khóa phòng (Delete Room Lock Settings) | #2558 GTJ-LCK-04-VI Hủy cài đặt khóa phòng (Delete Room Lock Settings) |
| C229 | #2519 GTJ-RPT-01 Tải báo cáo phòng giá đặc biệt (Download "Shock-Discount Room" Report) — *Cần bổ sung (Updat | #2559 GTJ-RPT-01-VI Tải báo cáo "Phòng giá sốc" (Download "Shock-Discount Room" Report) —  |
| C230 | #2520 GTJ-GLS-01 Bảng thuật ngữ (Glossary) | #2540 GTJ-GLS-01-EN Glossary |
| C233 | #2521 GTJ-STA-01 Định nghĩa giá trị trạng thái (Status Values) | #2561 GTJ-STA-01-VI Định nghĩa trạng thái (Status Values) |
| C224 | #2517 GTJ-LCK-03 Khóa phòng – Qua đêm (Room Lock – Overnight) | #2557 GTJ-LCK-03-VI Khóa phòng – Qua đêm (Room Lock – Overnight) |
| C231 | #2520 GTJ-GLS-01 Bảng thuật ngữ (Glossary) | #2560 GTJ-GLS-01-VI Bảng thuật ngữ (Glossary) |


Lưu ý: Bản tiếng Hàn (`GTJ-*` không có hậu tố) là bản gốc do Amoeba soạn. Nhân viên lễ tân Việt Nam không dùng bản này, nên khi ngôn ngữ mặc định đã chuyển sang `vi`, chúng có thể chỉ chiếm chỗ trong kết quả tìm kiếm. Việc có loại bản tiếng Hàn khỏi phạm vi Hotel Admin hay không có thể quyết định khi bàn giao vận hành (tách biệt với đợt phân loại này).

## 6. V. Sổ tay tóm tắt ↔ hướng dẫn video — 11 trường hợp

Đây là sổ tay tóm tắt (`GTJ-DIS/FLS/SUR/DSH-*`) và hướng dẫn video (`GTJ-VID-*`) của cùng một tính năng. Hướng dẫn video ghi chi tiết hơn về tên màn hình, ô nhập liệu và giá trị ví dụ, và không có thông tin nào khác nhau (các cặp có thông tin khác nhau đã chuyển sang nhóm F). Xử lý là 'giữ cả hai'.

| Xung đột | Tài liệu A | Tài liệu B |
|---|---|---|
| C217 | #2509 GTJ-FLS-02 Thiết lập flash sale qua đêm (Set Up Overnight Flash Sale) | #2629 GTJ-VID-09-EN Video 9 — Creating a Flash Sale for the Qua đêm (overnight) type |
| C238 | #2524 GTJ-DIS-01-EN Create / Edit a Direct Discount Program | #2622 GTJ-VID-02-EN Video 2 — Setting a per-room discount rate at step 2 of creating a dir |
| C241 | #2525 GTJ-DIS-02-EN Search Direct Discount Programs | #2626 GTJ-VID-06-EN Video 6 — Searching by name in the direct-discount program list |
| C239 | #2524 GTJ-DIS-01-EN Create / Edit a Direct Discount Program | #2623 GTJ-VID-03-EN Video 3 — Using the direct discount's Thiết lập hàng loạt (Bulk setup) |
| C215 | #2505 GTJ-DIS-02 Tìm kiếm chương trình giảm giá trực tiếp (Search Direct Discount Programs) | #2626 GTJ-VID-06-EN Video 6 — Searching by name in the direct-discount program list |
| C213 | #2504 GTJ-DIS-01 Tạo·sửa chương trình giảm giá trực tiếp (Create / Edit a Direct Discount Program) | #2622 GTJ-VID-02-EN Video 2 — Setting a per-room discount rate at step 2 of creating a dir |
| C242 | #2525 GTJ-DIS-02-EN Search Direct Discount Programs | #2574 GTJ-VID-06-VI Video 6 — Tìm theo tên trong danh sách chương trình giảm giá trực tiếp |
| C216 | #2505 GTJ-DIS-02 Tìm kiếm chương trình giảm giá trực tiếp (Search Direct Discount Programs) | #2574 GTJ-VID-06-VI Video 6 — Tìm theo tên trong danh sách chương trình giảm giá trực tiếp |
| C220 | #2511 GTJ-SUR-01 Thiết lập phụ thu (Set Up Surcharges) | #2631 GTJ-VID-11-EN Video 11 — Creating and saving a surcharge (Phụ thu) schedule |
| C214 | #2504 GTJ-DIS-01 Tạo·sửa chương trình giảm giá trực tiếp (Create / Edit a Direct Discount Program) | #2623 GTJ-VID-03-EN Video 3 — Using the direct discount's Thiết lập hàng loạt (Bulk setup) |
| C235 | #2522 GTJ-DSH-01-EN View Dashboard | #2620 GTJ-VID-00-EN Video 0 — A walkthrough of the Trang chủ (Home) dashboard |


## 7. D. Quy trình khác nhau — 9 trường hợp

Giống như quy trình khóa phòng và flash sale theo từng loại đặt phòng (theo giờ / theo ngày / qua đêm), các màn hình này chỉ trông giống nhau, còn quy trình thì khác. Xử lý là 'giữ cả hai'.

| Xung đột | Tài liệu A | Tài liệu B |
|---|---|---|
| C208 | #2516 GTJ-LCK-02 Khóa phòng – Theo ngày (Room Lock – By Day) | #2517 GTJ-LCK-03 Khóa phòng – Qua đêm (Room Lock – Overnight) |
| C209 | #2516 GTJ-LCK-02 Khóa phòng – Theo ngày (Room Lock – By Day) | #2537 GTJ-LCK-03-EN Room Lock – Overnight |
| C247 | #2528 GTJ-FLS-01-EN Set Up Hourly Flash Sale | #2529 GTJ-FLS-02-EN Set Up Overnight Flash Sale |
| C205 | #2515 GTJ-LCK-01 Khóa phòng – Theo giờ (Room Lock – Hourly) | #2516 GTJ-LCK-02 Khóa phòng – Theo ngày (Room Lock – By Day) |
| C223 | #2517 GTJ-LCK-03 Khóa phòng – Qua đêm (Room Lock – Overnight) | #2536 GTJ-LCK-02-EN Room Lock – By Day |
| C227 | #2518 GTJ-LCK-04 Mở khóa phòng (Delete Room Lock Settings) | #2534 GTJ-QLK-02-EN Delete Quick Room Lock |
| C221 | #2513 GTJ-QLK-01 Thiết lập khóa phòng nhanh (Set Up Quick Room Lock) | #2563 BRD-1 Quy trình chặn phòng khẩn cấp (bản nháp) |
| C206 | #2515 GTJ-LCK-01 Khóa phòng – Theo giờ (Room Lock – Hourly) | #2517 GTJ-LCK-03 Khóa phòng – Qua đêm (Room Lock – Overnight) |
| C245 | #2527 GTJ-DIS-04-EN Stop a Direct Discount Program | #2541 GTJ-STA-01-EN Status Values |

- Ngoại lệ **C221**: #2563 `BRD-1` "Quy trình chặn phòng khẩn cấp **(bản nháp)**" là bản nháp dài 85 ký tự được chấp nhận từ bảng tri thức (đăng ký 8/29). Bản này đang được kích hoạt và nằm trong phạm vi Hotel Admin. Nội dung là bản rút gọn của #2513 `GTJ-QLK-01` khóa phòng nhanh. Đề xuất ngừng kích hoạt (Go2Joy xác nhận).

## 8. Kế hoạch xử lý

| Bước | Việc cần làm | Đối tượng | Phụ trách |
|---|---|---|---|
| 1 | Sửa 6 sổ tay tóm tắt (giá có bắt buộc không, bước xác nhận) rồi lập chỉ mục lại | F: #2508 #2528 #2548 #2510 #2530 #2550 | Go2Joy xác nhận → Amoeba |
| 2 | Chọn bản chuẩn của tài liệu chính sách, ngừng kích hoạt 3 tài liệu còn lại | P: #2360~#2362 / #2565~#2567 | Go2Joy quyết định → Amoeba |
| 3 | Gộp 13 FAQ thành 2, gửi lại danh sách câu hỏi cần câu trả lời riêng | Q: #2347~#2359 | Go2Joy quyết định → Amoeba |
| 4 | Quyết định phạm vi AI agent của danh mục `faq`·`policy` | Có loại Hotel Admin hay không | Go2Joy quyết định |
| 5 | Ngừng kích hoạt bản nháp BRD-1 | #2563 | Go2Joy xác nhận |
| 6 | Xử lý 40 xung đột T·V·D là 'giữ cả hai' | 40 trường hợp liên quan trong C204~C249 | Amoeba (làm được ngay) |

Khi xong các bước 1~5, các xung đột liên quan sẽ được dọn cùng lúc vì tài liệu đã được ngừng kích hoạt hoặc sửa. Sau khi dọn dẹp, chúng tôi chạy lại kiểm tra xung đột một lần nữa để xác nhận các cặp cũ không bị phát hiện lại.
