# Hướng dẫn phân công nhân viên SharpTalk — từ yêu cầu gặp nhân viên đến cảnh báo cho nhân viên phụ trách

> Phiên bản 1.0 · Bản đầu 2026-10-24 · Biên soạn dựa trên mã nguồn
> Đối tượng: người vận hành tenant (master — cài đặt đội, nhãn, quy tắc phân công) · nhân viên (cảnh báo, phản hồi)
> Bản trực tuyến: https://shoptalk.amoeba.site/manual (bản HTML, bản gốc tiếng Hàn và bản dịch tiếng Anh)
> Xem thêm: [Sổ tay người dùng tổng hợp](user-manual.vi.md) mục 4.4 (cảnh báo) · 14.1 (kết nối nhân viên), [Sổ tay tri thức & AI](knowledge-ai.vi.md) chương 5

Tài liệu này theo dõi từ đầu đến cuối **khi khách hàng tìm nhân viên thì cuộc trò chuyện được chuyển tới ai**. Phần đầu (chương 2–4) là các cài đặt người vận hành làm một lần; phần sau (chương 5–9) là những gì diễn ra trên màn hình khách hàng và màn hình nhân viên khi khách thực sự gửi yêu cầu. Ví dụ màn hình là dữ liệu trình diễn giả định tư vấn cho đối tác khách sạn (tên khách sạn và nhân viên là hư cấu).

---

## Mục lục
1. [Tổng quan nhanh](#1-tổng-quan-nhanh)
2. [Chuẩn bị ① Nhân viên·đội·nhãn](#2-chuẩn-bị--nhân-viênđộinhãn)
3. [Chuẩn bị ② Danh mục tư vấn](#3-chuẩn-bị--danh-mục-tư-vấn)
4. [Chuẩn bị ③ Quy tắc phân công](#4-chuẩn-bị--quy-tắc-phân-công)
5. [Màn hình khách hàng — yêu cầu nhân viên và chọn danh mục tư vấn](#5-màn-hình-khách-hàng--yêu-cầu-nhân-viên-và-chọn-danh-mục-tư-vấn)
6. [Quyết định phân công — ai nhận](#6-quyết-định-phân-công--ai-nhận)
7. [Màn hình nhân viên — cảnh báo](#7-màn-hình-nhân-viên--cảnh-báo)
8. [Phản hồi — mở hội thoại](#8-phản-hồi--mở-hội-thoại)
9. [Cài đặt cảnh báo (cá nhân)](#9-cài-đặt-cảnh-báo-cá-nhân)
10. [Danh sách kiểm tra vận hành](#10-danh-sách-kiểm-tra-vận-hành)
11. [FAQ / xử lý sự cố](#11-faq--xử-lý-sự-cố)

---

## 1. Tổng quan nhanh

```
Widget khách hàng               Máy chủ SharpTalk                      Bảng điều khiển nhân viên
──────────────────              ─────────────────                      ─────────────────────────
[Kết nối nhân viên hỗ trợ]  ──▶  Hiện thẻ danh mục tư vấn
  hoặc AI chuyển tiếp
"Bạn cần hỗ trợ về vấn đề gì?"
  chọn (Customer Services)  ──▶  Kiểm tra quy tắc phân công từ trên xuống
                                  Danh mục tư vấn = Customer Services ?
                                  Khách hàng › Khu vực = Miền Nam ?   (thông tin đăng nhập khách sạn)
                                  → quy tắc đầu tiên khớp tất cả
                                  → nhân viên trực tuyến thuộc đội × nhãn của quy tắc đó
"…kết nối bạn với bộ phận ○○" ◀─  Phân công                        ──▶  🔔 cảnh báo bật lên "Giao cho: tôi"
                                                                       [Mở hội thoại] → phản hồi
```

| Thuật ngữ | Ý nghĩa |
|---|---|
| Danh mục tư vấn | Chủ đề tư vấn khách chọn trên widget (vd: hỗ trợ khách hàng · hợp tác · đối soát). Người vận hành tạo và quyết định có hiển thị hay không |
| Đội | Nơi nhân viên trực thuộc (mỗi người một đội). Vd: North (Hà Nội) · South (TP. Hồ Chí Minh) |
| Nhãn | Dấu hiệu công việc của nhân viên (có thể nhiều). Vd: CS · Sales. Phải có nhãn *Tư vấn (Counsels)* mới xử lý được trò chuyện trực tiếp |
| Quy tắc phân công | Bộ "danh mục tư vấn + thông tin khách hàng (khu vực…) → đội × nhãn". Kiểm tra từ trên xuống và dùng **quy tắc đầu tiên khớp tất cả** |
| Khu vực | Vị trí của khách hàng (khách sạn): Miền Bắc · Bắc Trung Bộ · Miền Trung · Nam Trung Bộ · Miền Nam. Ứng dụng host gửi qua thông tin đăng nhập, hoặc được điền từ tên tỉnh |
| Nhân viên được phân công | Người nhận khi không có quy tắc nào khớp (đầu tab Chuyển nhân viên). Để trống thì báo cho tất cả nhân viên |

---

## 2. Chuẩn bị ① Nhân viên·đội·nhãn
*(bảng điều khiển **[Người dùng & nhãn]** — master)*

Khuyến nghị chọn theo **đội × nhãn** trong quy tắc phân công thay vì chọn trực tiếp từng người. Khi nhân sự thay đổi, không cần sửa quy tắc.

### 2.1 Mời nhân viên và chấp nhận lời mời
1. **[Mời người dùng]** → chọn email · cấp bậc · nhãn · đội → mời
2. Khi người được mời **đăng nhập lần đầu** bằng mật khẩu tạm, trạng thái chuyển thành `active`
3. Kiểm tra **nhãn · đội · trạng thái** trong danh sách

![Danh sách người dùng — xem nhanh nhãn, đội và trạng thái (active)](img/asg-users-list.en.jpg)

⚠️ **Nhân viên chưa chấp nhận lời mời (`invited`) sẽ không được phân công.** Nếu đội của quy tắc có 0 nhân viên đang hoạt động, quy tắc đó bị bỏ qua (cảnh báo ở mục 4.4).

### 2.2 Tạo đội và nhãn
**[Nhãn & đội]** → thêm bằng mã và tên ở tab *Nhãn công việc* / *Đội*. Mã không thể đổi sau khi tạo; tên có thể đổi bất cứ lúc nào.

![Nhãn & đội — tab Nhãn công việc (thêm CS · Sales)](img/asg-labels-units.en.jpg)

![Nhãn & đội — tab Đội (thêm North · South)](img/asg-units.en.jpg)

💡 **Mẹo**: *Tư vấn (consult)* · *Kế toán* · *Vận hành* là các nhãn mặc định gắn với quyền nên không xóa được. Để phân công, hãy tạo nhãn riêng như CS · Sales để không lẫn với quyền.

### 2.3 Gán đội và nhãn cho nhân viên
**[Sửa]** trong danh sách → đánh dấu *Nhãn công việc*, chọn *Đội* rồi lưu. Để xử lý trò chuyện trực tiếp, nhân viên cần có thêm nhãn **Counsels (Tư vấn)**.

![Sửa người dùng — nhãn (Counsels · CS · Sales) và đội (South)](img/asg-user-edit.en.jpg)

---

## 3. Chuẩn bị ② Danh mục tư vấn
*(**[Cài đặt gian hàng] → tab Chuyển nhân viên** → **[Quản lý danh mục tư vấn]** ở đầu phần quy tắc phân công)*

1. Ở dòng dưới cùng, nhập **mã** (chữ, số, _) và **tên**, giữ dấu chọn *Hiển thị cho khách* rồi bấm **[Thêm]**
2. Ở ▸ **Tên theo ngôn ngữ** của mỗi dòng, nhập tên theo ngôn ngữ của khách (để trống thì dùng tên mặc định)
3. Danh mục cho khách thấy đặt **Hiển thị**, danh mục nội bộ đặt **Ẩn**, rồi bấm **[Lưu thay đổi]**

![Quản lý danh mục tư vấn — Hiển thị/Ẩn, tên theo ngôn ngữ, nơi đang dùng](img/asg-categories.en.jpg)

- Mã không thể đổi sau khi tạo (quy tắc tham chiếu theo mã). Tên, thứ tự và hiển thị có thể đổi bất cứ lúc nào.
- Danh mục tư vấn đang được quy tắc, đội hoặc nhãn dùng sẽ không bị xóa, và hệ thống cho biết nó đang được dùng ở đâu.
- Nếu **không có** danh mục tư vấn nào ở trạng thái Hiển thị, widget không hiện thẻ mà kết nối ngay.

---

## 4. Chuẩn bị ③ Quy tắc phân công
*(**[Cài đặt gian hàng] → tab Chuyển nhân viên** → *Quy tắc phân công*)*

### 4.1 Tạo quy tắc
**[Thêm quy tắc]** → mỗi quy tắc xác định các mục sau.

| Ô | Xác định gì | Ví dụ (CS_South) |
|---|---|---|
| Tên | Tên hiển thị trong nhật ký và cảnh báo | CS_South |
| Cách phân công | Nhân viên trực tuyến đang rảnh nhất / Báo cả nhóm | Nhân viên trực tuyến đang rảnh nhất |
| Danh mục tư vấn | Giá trị khách đã chọn (trống = tất cả) | Customer Services |
| Nghiệp vụ | Từ khóa trong câu hỏi (trống = tất cả) | — |
| Khách hàng | Khu vực · tỉnh · ngôn ngữ… (trống = tất cả) | Khu vực = Nam Trung Bộ · Miền Nam |
| Người phụ trách | Phân công theo nhóm (đội × nhãn) hoặc chỉ định cá nhân | Đội South × nhãn CS |

![Sửa quy tắc — danh mục tư vấn, khách hàng (khu vực), phân công theo nhóm (đội × nhãn) và số người phù hợp hiện tại](img/asg-rule-edit.en.jpg)

⚠️ **Chip nhãn ở dòng Nghiệp vụ dùng cho mục đích khác.** Nó chỉ khớp cuộc trò chuyện được chuyển tiếp bởi quy tắc *Bắt buộc chuyển tiếp theo chính sách (deny)*. Nhãn nhóm nhân viên hãy chọn ở **Người phụ trách › Nhóm › Nhãn** bên dưới.

### 4.2 Thứ tự quy tắc và quy tắc mặc định
Quy tắc được kiểm tra **từ trên xuống** và dùng quy tắc đầu tiên khớp mọi điều kiện. Đổi thứ tự bằng ↑↓. Ví dụ trong hướng dẫn này gồm 5 quy tắc sau.

| # | Quy tắc | Danh mục tư vấn | Khu vực | Người phụ trách |
|---|---|---|---|---|
| 1 | CS_North | Customer Services | Miền Bắc · Bắc Trung Bộ | Đội North × CS |
| 2 | CS_South | Customer Services | Nam Trung Bộ · Miền Nam | Đội South × CS |
| 3 | BS_North | Business Support | Miền Bắc · Bắc Trung Bộ | Đội North × Sales |
| 4 | BS_South | Business Support | Nam Trung Bộ · Miền Nam | Đội South × Sales |
| 5 | Default | (tất cả) | (tất cả) | Nhãn CS |

![Danh sách quy tắc phân công — kiểm tra từ trên xuống, phía trên là ô Kiểm tra phân công](img/asg-rules-list.en.jpg)

💡 **Mẹo**: Hãy đặt một **quy tắc mặc định** không có điều kiện ở cuối cùng. Khách không chọn danh mục tư vấn hoặc khách chưa rõ khu vực cũng sẽ đến đúng người đã định (nếu không có, sẽ chuyển cho *Nhân viên được phân công*; nếu cũng không có thì cảnh báo tất cả).

### 4.3 Kiểm tra phân công — thử trước khi lưu
Nhập danh mục tư vấn · khu vực · tỉnh · ngôn ngữ vào ô **Kiểm tra phân công** phía trên các quy tắc rồi bấm **[Kiểm tra]**: hệ thống cho biết với **các quy tắc đang sửa (chưa lưu)** thì cuộc trò chuyện sẽ đến ai, kèm lý do các quy tắc bị bỏ qua. Không gửi cảnh báo.

![Kiểm tra phân công — Customer Services · Miền Nam → #2 CS_South → Minh Le, bỏ qua: #1 điều kiện khu vực không khớp](img/asg-routing-check.en.jpg)

Kiểm tra xong, bấm **[Lưu]** ở cuối thẻ.

### 4.4 Đọc cảnh báo
Các cảnh báo màu vàng phía trên thẻ quy tắc không chặn việc lưu, nhưng có nghĩa là **nếu để nguyên thì sẽ không phân công được**.

| Cảnh báo | Ý nghĩa | Cách xử lý |
|---|---|---|
| Điều kiện nhãn nghiệp vụ (…) chỉ khớp cuộc trò chuyện chuyển tiếp bởi quy tắc chính sách (deny)… | Dùng nhầm chip nhãn ở dòng Nghiệp vụ | Bỏ chọn ở dòng Nghiệp vụ, chọn ở Người phụ trách › Nhãn |
| Tên có địa danh nhưng không có điều kiện khu vực/tỉnh | Khách ở mọi khu vực đều khớp | Thêm Khách hàng › Khu vực |
| Hiện không có nhân viên nào để giao (n người được mời chưa kích hoạt) | Đội × nhãn không có nhân viên đang hoạt động | Nhắc chấp nhận lời mời, kiểm tra việc gán nhãn và đội |

![Cảnh báo — BS_North: đội North không có nhân viên mang nhãn Sales nên 0 người](img/asg-rule-warnings.en.jpg)

---

## 5. Màn hình khách hàng — yêu cầu nhân viên và chọn danh mục tư vấn

Khách có hai cách tìm nhân viên, và cả hai đều hiện cùng một **thẻ danh mục tư vấn**.

### 5.1 Khi khách tự bấm [Kết nối nhân viên hỗ trợ]
Khi khách bấm chip **Kết nối nhân viên hỗ trợ** dưới câu trả lời (hoặc *Trò chuyện với nhân viên* trên thẻ liên hệ, nút kết nối nhân viên trong kịch bản), hệ thống không kết nối ngay mà hiện thẻ trước.

![Widget — thẻ "Bạn cần hỗ trợ về vấn đề gì?" (Customer Services · Business Support · Bỏ qua)](img/asg-widget-before.en.jpg)

Khi khách chọn danh mục tư vấn, hệ thống tìm quy tắc phân công theo giá trị đó; trong cuộc trò chuyện còn lại dòng "Đã rõ — tôi sẽ kết nối bạn với bộ phận ○○", sau đó chuyển sang trạng thái chờ.

![Widget — thông báo kết nối và trạng thái chờ nhân viên sau khi chọn Customer Services](img/asg-widget-connecting.en.jpg)

### 5.2 Khi AI chuyển cho nhân viên
Khi AI không tìm được câu trả lời chắc chắn hoặc khách nói "cho tôi gặp nhân viên", AI **gọi nhân viên ngay** và hiện cùng thẻ đó bên dưới thông báo. Khi khách chọn, nếu **chưa có ai nhận**, hệ thống **kết nối lại** tới nhóm phụ trách của danh mục tư vấn đó (cảnh báo gọi lần đầu được dọn đi).

![Widget — thẻ "Chọn chủ đề để chúng tôi kết nối bạn với đúng người phụ trách" bên dưới thông báo AI chuyển tiếp](img/asg-widget-after.en.jpg)

- **[Bỏ qua]**: không chọn, kết nối như trước (theo quy tắc không có điều kiện danh mục tư vấn).
- Trong một cuộc trò chuyện, thẻ chỉ hiện một lần.
- Tên hiện trên thẻ là *Tên theo ngôn ngữ* của khách.

---

## 6. Quyết định phân công — ai nhận

Với quy tắc ví dụ (mục 4.2) và nhân viên (Linh Tran = đội North · CS / Minh Le = đội South · CS · Sales):

| Khách hàng (khu vực khách sạn) | Danh mục tư vấn đã chọn | Quy tắc khớp | Người nhận |
|---|---|---|---|
| Saigon Riverside Hotel (Miền Nam) | Customer Services | #2 CS_South | Minh Le |
| Hanoi Garden Hotel (Miền Bắc) | Customer Services | #1 CS_North | Linh Tran |
| Hanoi Garden Hotel (Miền Bắc) | Business Support | #3 BS_North → 0 người nên bỏ qua → #5 Default | 1 người rảnh nhất trong nhãn CS |
| Không rõ khu vực | (Bỏ qua) | #5 Default | 1 người rảnh nhất trong nhãn CS |

Quy tắc cần biết:
- **Điều kiện danh mục tư vấn chỉ xét giá trị khách đã chọn.** Khách không chọn chỉ khớp quy tắc có danh mục tư vấn để trống.
- **Khu vực** là khu vực khách sạn do ứng dụng host (vd: Go2Joy HA) gửi qua thông tin đăng nhập. Nếu không có khu vực mà chỉ có tên tỉnh, hệ thống điền theo *bảng khu vực* (tỉnh → khu vực) của tenant.
- Dù quy tắc khớp, nếu **0 nhân viên trực tuyến · đang hoạt động** thì chuyển sang quy tắc tiếp theo.
- Khi khách chọn danh mục tư vấn, quy tắc được ưu tiên hơn *ưu tiên kết nối nhân viên lần trước*. Nếu không chọn, nhân viên đã phụ trách cuộc trò chuyện trước đó của cùng tài khoản sẽ được ưu tiên trước, nếu người đó nằm trong đối tượng phân công lần này.
- **Ngoài giờ làm việc** (khi đã cài giờ làm việc), yêu cầu được tiếp nhận qua *Email ngoài giờ* thay vì nhân viên.

---

## 7. Màn hình nhân viên — cảnh báo

### 7.1 Cảnh báo giao cho tôi
Dù đang ở đâu trong bảng điều khiển, trong vòng 10 giây cửa sổ **Chuyển tiếp hội thoại** sẽ bật lên. Cửa sổ hiện khách sạn · khu vực · danh mục tư vấn, **Giao cho: tôi**, tên quy tắc, lý do và câu nói cuối cùng của khách.

![Cảnh báo bật lên — Giao cho: tôi · quy tắc CS_South](img/asg-alarm-mine.en.jpg)

- **[Mở hội thoại]**: chuyển tới cuộc trò chuyện và **xác nhận** (ngừng nhắc lại).
- **[Bỏ qua]**: chỉ ẩn trên màn hình của tôi (đã đọc). Đây không phải là xác nhận nên việc nhắc lại khi chưa ai nhận vẫn tiếp tục.

### 7.2 Cảnh báo giao cho nhân viên khác
Mọi nhân viên đều thấy cảnh báo. Cảnh báo giao cho người khác có nhãn **Giao cho nhân viên khác**, và dù tôi mở, cảnh báo của nhân viên đó cũng không bị tắt.

![Cảnh báo bật lên — Giao cho: Linh Tran · Giao cho nhân viên khác · kết nối lại do chọn danh mục tư vấn](img/asg-alarm-other.en.jpg)

### 7.3 🔔 và Trung tâm cảnh báo
Biểu tượng 🔔 ở đầu trang hiện số cảnh báo chưa đọc. Bấm vào sẽ hiện các cảnh báo gần đây; bấm *Xem tất cả* sẽ mở **Trung tâm cảnh báo** (`/live-chat/alerts`). Lọc theo Tất cả / Giao cho tôi / Gửi tất cả, trạng thái, thời gian, danh mục tư vấn; bấm vào một dòng để mở cuộc trò chuyện.

![Trung tâm cảnh báo — khách/khách sạn · danh mục tư vấn · được giao · quy tắc · trạng thái](img/asg-alarm-center.en.jpg)

---

## 8. Phản hồi — mở hội thoại
Trong cuộc trò chuyện trực tiếp mở bằng **[Mở hội thoại]**, đầu cuộc trò chuyện hiện thông tin khách sạn · khu vực và huy hiệu **Tư vấn: Customer Services**, còn trong cuộc trò chuyện có dòng hệ thống "Đã rõ — tôi sẽ kết nối bạn với bộ phận Customer Services". Bấm **[Nhận]** để bắt đầu phản hồi.

![Trò chuyện trực tiếp — huy hiệu khu vực · danh mục tư vấn ở đầu cuộc trò chuyện và dòng hệ thống](img/asg-livechat-assigned.en.jpg)

---

## 9. Cài đặt cảnh báo (cá nhân)
Mỗi người tự cài trong **Cài đặt cảnh báo** của Trung tâm cảnh báo hoặc ngăn kéo 🔔.

| Mục | Lựa chọn |
|---|---|
| Cửa sổ bật lên | Mọi cảnh báo / Chỉ cảnh báo giao cho tôi (gồm cảnh báo gửi tất cả) / Tắt |
| Âm thanh | Bật · tắt, *Nghe thử* |
| Thông báo màn hình của trình duyệt | Khi bật, trình duyệt sẽ hỏi quyền |
| Email | Gửi email khi được giao cho tôi |

![Cài đặt cảnh báo — phạm vi cửa sổ bật lên · âm thanh · thông báo màn hình · email](img/asg-alarm-settings.en.jpg)

💡 **Mẹo**: Dù tắt cửa sổ bật lên, mọi cảnh báo vẫn có trong 🔔 và Trung tâm cảnh báo. Trưởng nhóm bận rộn nên chọn *Chỉ cảnh báo giao cho tôi*.

---

## 10. Danh sách kiểm tra vận hành

- [ ] Mọi nhân viên đã chấp nhận lời mời (trạng thái `active`)
- [ ] Mỗi nhân viên đã được gán nhãn Counsels (Tư vấn) + nhãn phân công (CS · Sales…) + đội
- [ ] Danh mục tư vấn cho khách thấy ở trạng thái **Hiển thị** và đã có tên theo ngôn ngữ
- [ ] Mỗi quy tắc phân công có điều kiện danh mục tư vấn · khu vực và đội × nhãn đúng
- [ ] Có quy tắc mặc định không điều kiện ở cuối cùng
- [ ] Thẻ quy tắc không có cảnh báo
- [ ] Đã thử mọi tổ hợp tiêu biểu (danh mục × khu vực) bằng **Kiểm tra phân công**
- [ ] Đã thực sự gửi yêu cầu từ widget và xác nhận cảnh báo đến đúng nhân viên phụ trách

---

## 11. FAQ / xử lý sự cố

**Q. Khách đã gọi nhân viên nhưng thẻ danh mục tư vấn không hiện.**
Kiểm tra trong [Chuyển nhân viên → Quản lý danh mục tư vấn] xem có danh mục tư vấn nào ở trạng thái **Hiển thị** không. Nếu không có, hệ thống kết nối ngay mà không hiện thẻ. Cuộc trò chuyện đã chọn rồi thì thẻ không hiện lại.

**Q. Cảnh báo đến người khác (hoặc tất cả) chứ không phải đội đã chỉ định.**
Hãy nhập cùng danh mục tư vấn · khu vực vào **Kiểm tra phân công** phía trên các quy tắc. Hệ thống sẽ hiện các quy tắc bị bỏ qua và lý do. Nguyên nhân thường gặp: ① dùng chip nhãn ở dòng Nghiệp vụ ② thiếu điều kiện khu vực ③ thành viên đội chưa chấp nhận lời mời (0 người có thể giao) ④ thứ tự quy tắc (một quy tắc rộng hơn ở trên khớp trước).

**Q. Cảnh báo đến tất cả nhân viên.**
Khi không có quy tắc nào khớp và *Nhân viên được phân công* cũng để trống, hệ thống cảnh báo tất cả. Hãy đặt quy tắc mặc định hoặc chỉ định nhân viên được phân công.

**Q. Tôi bỏ qua cảnh báo của nhân viên khác — có ảnh hưởng đến nhân viên đó không?**
Không. [Bỏ qua] chỉ ẩn trên màn hình của tôi; việc xác nhận (ngừng nhắc lại) phải do nhân viên được giao thực hiện.

**Q. Khu vực bị trống.**
Đây là trường hợp ứng dụng host không gửi khu vực và tên tỉnh cũng không có trong bảng khu vực. Hãy dùng *Cập nhật bảng khu vực* ở màn hình [Khách hàng] (khi đã kết nối Go2Joy), hoặc dùng điều kiện *Tỉnh* thay cho điều kiện khu vực.
