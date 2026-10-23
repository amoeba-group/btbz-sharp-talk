# SharpTalk × Go2Joy — Yêu cầu công việc (các việc Go2Joy cần thực hiện)

> Yêu cầu công việc liệt kê những việc Go2Joy cần làm theo từng bộ phận (2026-10-24 · v1.3). Đội phát triển HA: xem checklist ở đầu tài liệu cùng với [Đặc tả tích hợp HA v1.4](ha-identify.vi.html). Để in hoặc gửi: [PDF](work-request.vi.pdf)

| Mục |  |
|----|----|
| Gửi đến | PM Go2Joy · Đội phát triển HA (backend · FE) · Đội phát triển Go2Joy (Partner API) · Hạ tầng · Vận hành (CS) · Pháp chế |
| Từ | SharpTalk (Amoeba) |
| Ngày / phiên bản | 2026-10-24 · **v1.3** (thay thế v1.2, v1.1 và v1.0) |
| Căn cứ | ① Hướng dẫn tích hợp HA **v1.3** + các thay đổi tại §1 của yêu cầu này → [**hướng dẫn v1.4**](https://claude.ai/artifact/2An9WPgY9oCcs3PugiqXf8) (phát hành 10/24) ② Yêu cầu tích hợp & danh sách kiểm tra (số G, 2026-10-22) ③ Tổng quan Go2Joy Support Assistant API và tài liệu Partner API công khai (`dev.go2joy.vn/api`, kiểm tra 10/23)<br>**Bản PDF v1.0 (10/20) đã bị thu hồi.** Định dạng userId, giá trị vùng và test vector T1 · T2 trong đó không còn áp dụng. |
| Phản hồi | Báo cáo hoàn thành theo từng việc, hoặc bảng phản hồi tại §8 — kênh trao đổi hằng ngày (WR-40) |



**✅ Những việc HA (Go2Joy) phải làm — danh sách kiểm tra** `v1.3`

Đặc tả v1.4 đã chốt (phê duyệt 10/24); hướng dẫn v1.4 và test vector đã phát hành. Cách kiểm tra từng mục, kèm mã mẫu, có trong danh sách kiểm tra ở đầu [hướng dẫn tích hợp HA v1.4](https://claude.ai/artifact/2An9WPgY9oCcs3PugiqXf8).

- **Backend (WR-01 · 02, Thứ Ba 10/27)**: ☐ secret chỉ nằm trong biến môi trường của server ☐ endpoint chỉ dành cho phiên đã đăng nhập ☐ giá trị lấy từ phiên và DB ☐ `userId = "ha:" + userSn` ☐ chỉ 4 thuộc tính `hotel_id · hotel_name · province_sn · role` ☐ `province_sn` = provinceSn của Go2Joy ☐ mã vai trò + **gửi danh sách mã** ☐ "tất cả khách sạn" → chỉ `role` ☐ NFC → gộp khoảng trắng → trim → 120 ký tự ☐ bỏ giá trị rỗng ☐ HMAC-SHA256 ☐ **test vector T1 – T6 khớp, gửi lại kết quả** ☐ không bao giờ ghi gói định danh vào log
- **FE (WR-04, Thứ Tư 10/28)**: ☐ bỏ việc lắp ráp trên trình duyệt và `hash: "testing"` ☐ chuyển nguyên phản hồi của server vào `identify` ☐ identify lại khi đăng nhập, tải lại trang, đổi khách sạn, đổi ngôn ngữ ☐ `logout` khi đăng xuất, hết hạn phiên, chuyển tài khoản, đăng xuất ở tab khác ☐ giữ `locale` ☐ cho phép CSP và CORS ☐ một thiết lập duy nhất cho tên miền SharpTalk
- **UAT (WR-05, 10/29 – 30)**: ☐ đạt danh sách kiểm tra §8 của hướng dẫn ☐ tài khoản thử nghiệm miền Bắc và miền Nam
- **Production (WR-06)**: ☐ secret production ☐ tên miền production `sharptalk.go2joy.vn` ☐ CSP, CORS production, chia sẻ lịch phát hành



**Thay đổi trong v1.2 (10/24)**

- Các bản phát hành SharpTalk ngày 10/23 – 10/24 (§2.1): danh mục tư vấn (khách hàng chọn Business Support hoặc Customer Services trong widget; lựa chọn × vùng của khách sạn quyết định đội), trung tâm cảnh báo, cài đặt cảnh báo cá nhân và kiểm tra phân công (trình mô phỏng), gộp hội thoại của cùng khách hàng hoặc khách sạn, dòng thông báo AI kèm liên kết điều khoản, thử lại khi câu trả lời AI rỗng
- Bổ sung thiết lập định tuyến staging của go2joy (§2.3): 4 đội, 11 nhân viên tư vấn (8 người chưa chấp nhận lời mời), 4 quy tắc. **Đội South không có nhân viên đang hoạt động**, nên khách sạn miền Nam không bao giờ được chuyển tới đội này
- Cập nhật công việc: WR-10 xác nhận quy tắc · WR-11 chấp nhận lời mời · WR-12 định nghĩa danh mục tư vấn và tên tiếng Việt (thay cho từ khóa Sales) · WR-13 người phụ trách cho danh mục bị bỏ qua và yêu cầu không khớp quy tắc · WR-15 **hoàn thành** · WR-31 cần xác nhận · WR-19a mới
- Kiểm tra lại HA UAT ngày 10/24: D1 – D9 không thay đổi


## 0. Tóm tắt

- Các tính năng giai đoạn 1 của SharpTalk (xác minh chữ ký, khách sạn = khách hàng doanh nghiệp, tính liên tục của hội thoại, định tuyến theo vùng, hồ sơ khách sạn và loại phòng) **đã triển khai và đang hoạt động trên staging**.
- Kiểm tra HA UAT ngày 10/23: **widget đã được nhúng nhưng định danh chưa được ký** (`hash: "testing"`). HA làm theo bản PDF v1.0; các thay đổi đặc tả từ v1.3 chưa được áp dụng (§2.2). Chỉ staging tạm thời chấp nhận đăng nhập không ký; **production sẽ từ chối.**
- `v1.1` Gói định danh trở nên đơn giản hơn. **HA không còn gửi vùng; SharpTalk tự suy ra** từ `region` của Partner API Province Feed. Tỉnh và vai trò được gửi dưới dạng **mã không phụ thuộc ngôn ngữ** thay vì tên hiển thị. Server HA ít việc hơn, và bảng vùng chỉ nằm ở một nơi là Go2Joy Partner API.
- `v1.2` Đội vận hành Go2Joy đã nhập phần lớn thiết lập định tuyến vào console (§2.3). Phần còn lại là **chấp nhận lời mời** (trước hết là đội South) và **tên danh mục cùng người phụ trách mặc định**.
- **Mở staging ngày 10/31** cần: WR-01 · 02 · 04 · 05 · 10 – 14 · 40.
- **Mở production** cần thêm WR-06 (triển khai HA production) · WR-20 – 23 · WR-30 · 31. Ngày mở production sớm nhất là **Thứ Ba 11/10**: 7 ngày làm việc sau khi cả server production (WR-20) và chứng nhận production Partner API (WR-23, khoảng một tuần) đều hoàn tất.

## 1. Lịch sử đặc tả tích hợp `v1.1`

Một phần HA được xây dựng theo bản PDF v1.0, vì vậy khác biệt giữa các phiên bản được gom vào một bảng. **Cột v1.4 là đặc tả cuối cùng.** SharpTalk đã phát hành hướng dẫn v1.4 và test vector mới vào 10/24 (S-01 hoàn thành).


<table>
<thead>
<tr>
<th>Mục</th>
<th>v1.0 (PDF 10/20)</th>
<th>v1.3</th>
<th>v1.4 (yêu cầu này)</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>userId</code></td>
<td>ID đăng nhập (<code>go2joysupport</code>)</td>
<td><code>"ha:" + userSn</code></td>
<td>Giống v1.3</td>
</tr>
<tr>
<td>Khóa thuộc tính được ký</td>
<td>5: <code>hotel_id</code> · <code>hotel_name</code> · <code>province</code> · <code>region</code> · <code>role</code></td>
<td>5 (giống)</td>
<td><strong>4</strong>: <code>hotel_id</code> · <code>hotel_name</code> · <code>province_sn</code> · <code>role</code></td>
</tr>
<tr>
<td>Tỉnh</td>
<td><code>province</code> = tên tỉnh (<code>Hồ Chí Minh</code>)</td>
<td>Giống</td>
<td><code>province_sn</code> = <code>provinceSn</code> của Go2Joy (Province Feed <code>sn</code>, ví dụ Hồ Chí Minh = <code>"1"</code>)</td>
</tr>
<tr>
<td>Vùng</td>
<td>HA suy ra, 3 giá trị (bắc · trung · nam)</td>
<td>HA suy ra, 5 mã</td>
<td><strong>Không gửi.</strong> SharpTalk suy ra từ Province Feed <code>region</code> (1 – 5)</td>
</tr>
<tr>
<td>Vai trò</td>
<td>Tên hiển thị (<code>Lễ tân</code>)</td>
<td>Giống</td>
<td><strong>Mã vai trò HA</strong> (không phụ thuộc ngôn ngữ giao diện); danh sách mã gửi lại trong WR-01</td>
</tr>
<tr>
<td>Chuẩn hóa</td>
<td>Gộp khoảng trắng · trim · 120 ký tự</td>
<td>+ NFC</td>
<td>Thứ tự cố định: <strong>NFC → gộp khoảng trắng → trim → 120 ký tự (<code>mb_substr</code>)</strong></td>
</tr>
<tr>
<td>Chọn "tất cả khách sạn"</td>
<td>Chưa quy định</td>
<td>Chỉ identify lại</td>
<td>Bỏ 3 khóa khách sạn (<code>hotel_id</code> · <code>hotel_name</code> · <code>province_sn</code>), chỉ ký <code>role</code> → nhân viên dự phòng (WR-13)</td>
</tr>
<tr>
<td>Giá trị rỗng</td>
<td>Bỏ thuộc tính rỗng và email rỗng</td>
<td>Giống</td>
<td><code>name</code> · <code>email</code> · <code>phone</code> rỗng cũng bị bỏ khỏi trường (email rỗng hoặc sai định dạng → 400)</td>
</tr>
<tr>
<td>Test vector</td>
<td>T1 · T2 (userId cũ)</td>
<td>T1 – T5</td>
<td><strong>T1 – T6</strong> (T6 = đầu vào Unicode dạng tách rời). Không dùng các vector trước đó</td>
</tr>
<tr>
<td>Chuyển tiếp</td>
<td colspan="3">Trong một thời gian SharpTalk vẫn xác minh cả dạng v1.3 (khóa <code>province</code> · <code>region</code>); định tuyến ưu tiên giá trị v1.4. Việc này kết thúc khi HA đã chuyển sang v1.4 (S-02).</td>
</tr>
</tbody>
</table>


### 1.1 Gói định danh v1.4


| Trường | Được ký | Giá trị | Nguồn trong HA (ví dụ) | Ví dụ UAT |
|----|----|----|----|----|
| `userId` | Có | `"ha:" + userSn` | Mã số nhân viên trong DB HA | `ha:<userSn>` |
| `attributes.hotel_id` | Có | `hotelSn` của khách sạn đang chọn (chuỗi) | `profile.hotelSn` | `"1721"` |
| `attributes.hotel_name` | Có | Tên khách sạn | `hotelViewList[].name` | `A In Hotel Del Luna` |
| `attributes.province_sn` | Có | `provinceSn` của khách sạn (chuỗi) | Khách sạn trong DB HA → provinceSn | `"1"` |
| `attributes.role` | Có | Mã vai trò HA | Khóa vai trò trong DB HA | Gửi lại trong WR-01 |
| `name` · `email` · `phone` | Không | Chỉ để hiển thị; bỏ trường khi rỗng | `profile.fullName` v.v. | `G2J SUPPORT` |


``` tl
Chuỗi ký (khóa theo thứ tự bảng chữ cái, phân tách bằng \n)
ha:<userSn>
hotel_id=1721
hotel_name=A In Hotel Del Luna
province_sn=1
role=<mã vai trò HA>

hash = hex( HMAC-SHA256( key = SHARPTALK_EMBED_SECRET, message = chuỗi ký (UTF-8) ) )
```

Cách SharpTalk suy ra vùng: Province Feed `region` `1` → `south`, `2` → `north`, `3` → `central`, `4` → `north_center`, `5` → `south_center`. Giá trị `10` (Manila) chưa có trong tài liệu sẽ được chốt sau WR-27.

## 2. Hiện trạng (2026-10-24) `v1.2`

### 2.1 Đã sẵn sàng phía SharpTalk (staging)


| Tính năng | Trạng thái |
|----|----|
| Xác minh identify có chữ ký, ghi nhận việc đồng ý điều khoản HA làm sự đồng ý của widget (không hiện banner đồng ý), tên nhân viên trong lời chào đầu tiên | Hoàn thành |
| Khách sạn = khách hàng doanh nghiệp, nhân viên = người liên hệ, tách B2B / B2C, hội thoại liên tục theo tài khoản khách sạn | Hoàn thành |
| **Danh mục tư vấn**: khi chọn "nói chuyện với nhân viên" hoặc khi AI chuyển giao, widget hỏi nội dung yêu cầu (có thể bỏ qua); lựa chọn × vùng khách sạn → đội × nhãn công việc | Hoàn thành (10/24) — quy tắc và danh sách nhân sự đã nhập một phần (§2.3) |
| **Trung tâm cảnh báo**: 🔔 trên thanh tiêu đề kèm người phụ trách, quy tắc, danh mục, khách sạn, vùng; xác nhận hoặc bỏ qua; cài đặt cá nhân (tất cả / của tôi / tắt, âm thanh, thông báo trên màn hình, mail) | Hoàn thành (10/24) |
| **Kiểm tra phân công** (trình mô phỏng) và cảnh báo quy tắc: nhập danh mục, vùng, tỉnh → quy tắc khớp, người phụ trách, lý do bị bỏ qua; cảnh báo khi không có nhân viên hoạt động và khi dùng sai nhãn công việc | Hoàn thành (10/24) |
| Nhiều phiên của cùng khách hàng hoặc khách sạn được gộp vào một phòng; các phiên sau tự động được thêm vào | Hoàn thành (10/23) |
| Dòng thông báo AI dưới widget (theo ngôn ngữ) kèm liên kết điều khoản; hiện / ẩn nút ngôn ngữ và nút cài đặt trên thanh tiêu đề | Hoàn thành (10/23) |
| Thử lại một lần và chuyển giao khi câu trả lời AI rỗng, chặn giả mạo IP client, tìm kiếm nội dung hội thoại | Hoàn thành (10/23) |
| Câu trả lời và nút theo ngôn ngữ đã chọn (vi / en), tiêu đề live chat "nhân viên / khách sạn" | Hoàn thành |
| Thông tin khách sạn và loại phòng từ Partner API → hồ sơ công ty và sản phẩm theo từng khách sạn; bảng tỉnh → vùng tự động làm mới (80 tỉnh) | Hoàn thành — đang chạy bằng thông tin xác thực staging |
| Giải pháp tạm: tên tỉnh → vùng (HA hiện đang gửi tên tỉnh trong trường vùng) | Triển khai 10/23 |
| Tên hiển thị dạng văn bản thường trên danh sách console; được che khi gửi tới AI bên ngoài và trong log | Hoàn thành |


### 2.2 Phát hiện từ HA UAT

Kiểm tra từ mã nhúng trên HA UAT (`go2joy-ha-uat.go2joy.io`, `window.sharptalkSignIn`) và log staging của SharpTalk. "Căn cứ" là tài liệu HA đã làm theo. `v1.2` **Kiểm tra lại 10/24: không thay đổi** (`hash: "testing"`, ID đăng nhập, 5 khóa thừa, tên tỉnh trong `region`).


| \# | Mục | HA hiện tại | Căn cứ | v1.4 | Ảnh hưởng |
|----|----|----|----|----|----|
| D1 | Chữ ký | Gói được dựng trên trình duyệt, `hash: "testing"` | — (ký trên server từ v1.0) | **Server HA** ký bằng HMAC-SHA256 rồi trả về cho FE | 401 trên production |
| D2 | `userId` | ID đăng nhập | Làm theo v1.0 | `"ha:" + userSn` (đổi ở v1.3) | Hội thoại bị đứt khi ID đăng nhập thay đổi; có thể trùng với ID khách đặt phòng |
| D3 | Khóa thuộc tính | 5 + `hotel_code` · `hotel_group_id` · `user_id` · `user_sn` · `district` | — | Chỉ 4 khóa | Khi đã ký, khóa lạ gây 401 |
| D4 | Vùng | Tên tỉnh trong `region` | v1.0: 3 giá trị, v1.3: 5 mã | Không gửi (SharpTalk tự suy ra) | SharpTalk đã có giải pháp tạm |
| D5 | Giá trị tỉnh / vai trò | Tên hiển thị (`Hồ Chí Minh`, `Lễ tân`) | v1.0 · v1.3 | `province_sn` · mã vai trò | Đổi ngôn ngữ HA có thể làm đổi giá trị được ký, phá vỡ định tuyến và tính liên tục |
| D6 | Chuẩn hóa | Không áp dụng (dựng ở FE) | Mã mẫu PHP v1.0 không có NFC | Bắt buộc NFC (extension `intl`) | 401 khi dấu tiếng Việt đến ở dạng tách rời |
| D7 | `locale` | `localStorage.lang` → `vi` / `en`, `setLocale` khi thay đổi | Giống | Giống | OK |
| D8 | Đăng xuất | `sharptalkSignOut()` → `logout` (nút) | Giống | Thêm khi hết hạn phiên và khi chuyển tài khoản | Định danh của nhân viên trước có thể còn lại trên máy tính dùng chung |
| D9 | Đổi khách sạn | Chưa xác nhận identify lại; chưa có quy tắc "tất cả khách sạn" | — | Identify lại mỗi lần đổi; "tất cả khách sạn" theo §1 | Xác nhận trong UAT (WR-04) |


### 2.3 Thiết lập định tuyến staging của go2joy (đọc 10/24) `v1.2`

Các giá trị đội vận hành Go2Joy đã nhập trong console. Cài đặt › Chuyển giao nhân viên › **Kiểm tra phân công** cho cùng kết quả với một danh mục và vùng cho trước.


| Mục | Hiện tại |
|----|----|
| Danh mục tư vấn (hiển thị cho khách hàng) | `bs` Business Support · `cs` Customer Services — **chưa có tên tiếng Việt** (màn hình tiếng Việt hiển thị tiếng Anh) |
| Đội | North · North Center · South · South Center |
| 11 nhân viên tư vấn | 3 đang hoạt động (North 1, North Center 2) · **8 đã được mời, chưa chấp nhận** (North 2, North Center 2, South 3, South Center 1) |
| Nhãn công việc | `cs` · `sa` (ngoài ra consult · accounting · operations) |



| Quy tắc | Danh mục | Vùng khách sạn | Đích | Kết quả hiện tại |
|----|----|----|----|----|
| BS_North_SA | bs | north · north_center | Đội North × sa | Đã phân công (1 sa đang hoạt động) |
| CS_North_CS | cs | north · north_center | Đội North × cs | Đã phân công (1 cs đang hoạt động) |
| CS_South | cs | south · south_center | Đội South × cs | **Bị bỏ qua — 0 người hoạt động** |
| BS_South_SA | bs | south · south_center | Đội South × sa | **Bị bỏ qua — 0 người hoạt động** |


- **Đội North Center và South Center** không là đích của quy tắc nào; khách sạn vùng bắc-trung cũng được chuyển tới đội North. Chưa có quy tắc cho vùng `central`.
- Khách hàng **bỏ qua** bước chọn danh mục, hoặc yêu cầu không khớp quy tắc nào, sẽ được chuyển tới người phụ trách mặc định (hoặc cảnh báo "mọi người — không khớp quy tắc").
- Điều kiện vùng của quy tắc dùng vùng do SharpTalk suy ra, nên quy tắc không cần thay đổi sau khi chuyển sang v1.4.

## 3. Hạng mục công việc

**P0-S** mở staging 10/31 · **P0** mở production · **P1** chất lượng production · **P2** giai đoạn 2 trở đi. Thời hạn là đề xuất của SharpTalk; nếu không phù hợp, vui lòng ghi ngày khả thi vào bảng phản hồi (§8).

### 3.1 Đội phát triển HA — backend


| WR | Công việc | Chi tiết | Hoàn thành khi | Ưu tiên | Hạn (đề xuất) | Tham chiếu |
|----|----|----|----|----|----|----|
| WR-01 | **Endpoint ký** `v1.1` | Một API được gọi bằng phiên đăng nhập (ví dụ `GET /api/v1/staff/sharptalkIdentity`) dựng và ký gói định danh trên server.<br>① `userId = "ha:" + userSn`<br>② 4 thuộc tính: `hotel_id` · `hotel_name` · `province_sn` · `role` (mã vai trò). Không có `region`<br>③ "Tất cả khách sạn": bỏ 3 khóa khách sạn, chỉ ký `role`<br>④ Chuẩn hóa theo thứ tự: `Normalizer::normalize($v, Normalizer::FORM_C)` → gộp khoảng trắng → trim → `mb_substr(…, 0, 120)`. Cần extension PHP `intl`<br>⑤ Bỏ giá trị rỗng, trong attributes và trong `name` · `email` · `phone`<br>⑥ `hash = hex(HMAC-SHA256(embed secret, signing string))`<br>⑦ Đọc giá trị từ phiên và DB của HA, không bao giờ lấy từ trình duyệt | Test vector **T1 – T6** của hướng dẫn v1.4 khớp + gửi lại **danh sách mã vai trò HA** (mã · nhãn vi/en) | P0-S | Thứ Ba 10/27 | G10 · D1 – D6 · D9 |
| WR-02 | **Quyết định khóa ký** `v1.1` | **Phương án A (khuyến nghị)**: embed secret do SharpTalk cấp, chỉ lưu trong biến môi trường server HA. SharpTalk gửi secret staging qua kênh bảo mật trong cùng ngày.<br>**Phương án B**: dùng lại client secret của Go2Joy. SharpTalk phải bổ sung chỗ nhập secret do đối tác cung cấp (S-04), và nếu bị lộ thì quyền truy cập Partner API cũng bị lộ.<br>Nếu đến 10/26 chưa có quyết định, staging sẽ mở theo phương án A và lựa chọn sẽ được xem xét lại trước production (cùng đặc tả và mã; chỉ giá trị secret thay đổi). Secret không bao giờ được đưa vào FE, trình duyệt, log hay tài liệu. | Có quyết định + secret staging đã được cài đặt | P0-S | Quyết định trước Thứ Hai 10/26 | G12 |
| WR-03 | Thời hạn chữ ký (`ts`) | Có thêm thời điểm ký để ngăn tái sử dụng gói hay không. Thời hạn 5 phút như Partner API đồng nghĩa hai bên cùng thay đổi đặc tả. | Có / không | P1 | 11/06 | G16 |


### 3.2 Đội phát triển HA — FE và triển khai


| WR | Công việc | Chi tiết | Hoàn thành khi | Ưu tiên | Hạn (đề xuất) | Tham chiếu |
|----|----|----|----|----|----|----|
| WR-04 | **Sửa mã nhúng** `v1.1` | ① `sharptalkSignIn` chuyển phản hồi của WR-01 vào `identify` **nguyên vẹn** (không lắp ráp hay chỉnh sửa trên trình duyệt)<br>② Gọi khi xác nhận đăng nhập · khi tải lại trang · **mỗi khi đổi khách sạn đang chọn (kể cả "tất cả khách sạn")** · khi đổi ngôn ngữ HA<br>③ Gọi `logout` khi bấm nút đăng xuất · khi **tự động đăng xuất do hết hạn phiên hoặc token** · ngay trước khi đăng nhập bằng tài khoản khác · khi tab khác đăng xuất (ví dụ sự kiện `storage`)<br>④ Bỏ `hash: "testing"` khỏi `SHARPTALK_WIDGET_CONFIG.user` ban đầu<br>⑤ Cho phép tên miền SharpTalk trong CSP (`script-src` · `frame-src` · `connect-src`) và CORS<br>⑥ Đưa 3 chỗ dùng tên miền SharpTalk (src của `embed.js` · `widgetUrl` · kiểm tra origin của `ivy:event`) về một thiết lập môi trường duy nhất (chuyển sang production ở WR-06) | Tab Network hiển thị `POST …/public/embed/identify` **200** (`consentState: "granted"`) và trang nhận được `ivy:event` `identified {ok: true}` | P0-S | Thứ Tư 10/28 | G11 · D1 · D8 · D9 |
| WR-05 | UAT chung | Cùng SharpTalk thực hiện danh sách kiểm tra §6.1 | Bảng kết quả đã ký xác nhận | P0-S | 10/29 – 10/30 | G13 |
| WR-06 | **Triển khai HA production** `v1.1 new` | ① Triển khai WR-01 · WR-04 lên HA production<br>② Cài đặt embed secret production trong môi trường production. Khác với staging; SharpTalk gửi qua kênh bảo mật (S-08)<br>③ Chuyển sang tên miền SharpTalk production: `https://sharptalk.go2joy.vn/widget/embed.js` · `widgetUrl` · kiểm tra origin<br>④ CSP và CORS production<br>⑤ Chia sẻ trước lịch phát hành HA với SharpTalk | identify 200 trên HA production; gói ký bằng secret staging nhận 401 trên production | P0 | Trước UAT production (bàn giao WR-20 + 4 ngày làm việc) | G11 · G1 |


### 3.3 Vận hành Go2Joy (CS)


| WR | Công việc | Chi tiết | Hoàn thành khi | Ưu tiên | Hạn (đề xuất) | Tham chiếu |
|----|----|----|----|----|----|----|
| WR-10 | **Xác nhận quy tắc định tuyến** `v1.1` `v1.2`<br>\[Một phần\] | Go2Joy có **5 vùng** trong Partner API (1 South · 2 North · 3 Central · 4 North Central · 5 South Center). Vui lòng kiểm tra 4 quy tắc tại §2.3.<br>① **Đội North Center và South Center** có nhận yêu cầu không? Nếu có, tách quy tắc theo vùng hoặc thêm hai đội làm đích<br>② Đội phụ trách vùng `central` (Đà Nẵng v.v.); hiện chưa có quy tắc nào, nên yêu cầu sẽ tới người phụ trách mặc định<br>③ Nếu muốn chia theo tỉnh, vui lòng liệt kê các tỉnh ngoại lệ<br>④ Philippines (vùng `10`) thuộc giai đoạn 2 | Xác nhận (hoặc sửa trong console và báo cho chúng tôi); kiểm tra phân công không còn cảnh báo | P0-S | 10/27 | G20 |
| WR-11 | **Chấp nhận lời mời, hoàn thiện danh sách nhân sự** `v1.2`<br>\[Một phần\] | 8 nhân viên được mời phải đăng nhập một lần (chấp nhận lời mời) thì mới được phân công. **Đội South không có nhân viên đang hoạt động**, nên khách sạn miền Nam không bao giờ được chuyển tới đội này. Gửi họ tên · email · đội · nhãn công việc (cs / sa) · cấp bậc của những người còn thiếu | Mỗi đội có ít nhất một nhân viên đang hoạt động (kiểm tra phân công không còn cảnh báo "0 người hoạt động") | P0-S | 10/27 | G21 |
| WR-12 | **Định nghĩa và đặt tên danh mục tư vấn** `v1.2`<br>\[Một phần\] | Thay cho từ khóa Sales, **khách hàng tự chọn trong widget**. Cho biết khi nào chọn Business Support và khi nào chọn Customer Services (mỗi loại 1 – 2 dòng), và cung cấp **tên hiển thị tiếng Việt**, được hiển thị nguyên văn trên thẻ của widget. Quyết định có chia nhỏ hơn không (ví dụ đối soát / hợp đồng) | Định nghĩa và tên tiếng Việt (hoặc nhập trong mục quản lý danh mục của console) | P0-S | 10/27 | G22 |
| WR-13 | **Giờ làm việc, thứ tự khi vắng mặt, người phụ trách mặc định** `v1.2` | Giờ làm việc theo đội (múi giờ HCM), thứ tự xử lý khi không ai sẵn sàng (đề xuất: nhân viên dự phòng → hàng đợi của đội → tin nhắn ngoài giờ). **Người phụ trách mặc định** cho yêu cầu không có vùng (**chọn "tất cả khách sạn"**, chưa chọn khách sạn, tỉnh chưa được ánh xạ), **khách hàng bỏ qua bước chọn danh mục**, và yêu cầu không khớp quy tắc nào | Phản hồi → SharpTalk nhập quy tắc và chia sẻ bản xem trước | P0-S | 10/27 | G23 |
| WR-14 | **Tài khoản thử nghiệm UAT** | Một `Quản lý` (nhiều khách sạn) + một `Lễ tân` (một khách sạn), bao gồm khách sạn ở ít nhất hai vùng **gồm cả miền Bắc và miền Nam**, và ít nhất một tên khách sạn có dấu tiếng Việt. `v1.2` \[Một phần\] Hiện UAT chỉ chạy trên tài khoản Lá Hotel Quận 10 ở miền Nam | Tài khoản được gửi qua kênh bảo mật | P0-S | 10/27 | G13 |
| WR-15 | Kết nối lại nguồn tri thức Notion<br>\[Hoàn thành\] | `v1.2` 3 nguồn (hướng dẫn HA, FAQ, hướng dẫn đăng ký khách sạn) đã được kết nối lại vào 10/22 và đồng bộ bình thường | — | P0 | 10/30 | G30 |
| WR-16 | Quyết định về xung đột tri thức | 78 mục được phân loại ngày 10/15 (3 mục cần sửa thật, 3 tài liệu chính sách trùng lặp, 32 FAQ sao chép): giữ bên nào | Bảng quyết định | P1 | 11/06 | G31 |
| WR-17 | Rà soát golden set | Xác nhận câu trả lời của 44 câu hỏi `#Talk-4-Hotel` (mốc hồi quy khi đổi engine và tinh chỉnh) | Kết quả rà soát | P1 | 11/06 | G32 |
| WR-18 | Phạm vi hiển thị widget và khung thời gian tiếp tục | Mặc định hiện tại: widget hiển thị hội thoại của chính người dùng + "n yêu cầu trước đó của khách sạn này"; ưu tiên cùng nhân viên trong 24 giờ (nếu đã chọn danh mục thì quy tắc được áp dụng trước) | Giữ / thay đổi | P1 | 11/06 | G14 · G15 |
| WR-19 | Zalo OA · mẫu ZNS | Để gửi cảnh báo cho nhân viên qua cả Zalo | OA và mẫu đã được duyệt | P1 | Chưa xác định | G24 |
| WR-19a | Cài đặt cảnh báo của nhân viên `v1.2` | Mỗi nhân viên tự thiết lập tại 🔔 › Cài đặt trong console: phạm vi cảnh báo (tất cả / chỉ của tôi), âm thanh, **cho phép thông báo trên màn hình**, mail. Quyền thông báo của trình duyệt là điều kiện để cảnh báo hiển thị khi tab console đang chạy nền | Đã thiết lập cho mọi nhân viên | P1 | 10/30 | Mới |


### 3.4 Hạ tầng · đưa Partner API vào vận hành


| WR | Công việc | Chi tiết | Hoàn thành khi | Ưu tiên | Hạn (đề xuất) | Tham chiếu |
|----|----|----|----|----|----|----|
| WR-20 | **Server production + SSH + DNS + TLS** `v1.1` | `sharptalk.go2joy.vn` (chưa có bản ghi DNS tính đến 10/23), khu vực Việt Nam. Thí điểm 4 vCPU / 8 GB / 80 GB; production 8 vCPU / 16 GB / 200 GB trở lên. Bộ nhớ sao lưu hằng ngày. **IP công khai tĩnh** (cho danh sách cho phép của WR-23) và **đồng bộ thời gian NTP** (`timestamp` của Partner API hết hạn sau 5 phút) | Đã bàn giao quyền SSH và IP tĩnh, DNS phân giải được | P0 | 10/30 | G1 |
| WR-21 | **Khóa API AI production (tài khoản và thanh toán của Go2Joy)** | LLM trả lời (khuyến nghị Anthropic Claude) và embedding (Voyage). Hạn mức hằng tháng và người nhận cảnh báo khi hết hạn mức | Khóa được gửi qua kênh bảo mật | P0 | 10/30 | G2 |
| WR-22 | Tài khoản gửi mail | SMTP cho mail cảnh báo nhân viên | Đã bàn giao tài khoản | P1 | 10/30 | G3 |
| WR-23 | **Chứng nhận production Partner API, thông tin xác thực và danh sách IP cho phép** `v1.1` | Quy trình đưa vào vận hành công khai: gửi yêu cầu chứng nhận (khoảng một tuần) → 3 lượt đặt phòng thử (theo giờ · qua đêm · theo ngày) → clientId · secret production → thêm 3 lượt đặt phòng để kiểm tra cuối. **SharpTalk không dùng API đặt phòng**, vì vậy chúng tôi đề nghị được miễn bước đặt phòng thử và dùng cách kiểm tra thay thế (kiểm tra kết nối bằng API tra cứu). Cho phép IP tĩnh production của SharpTalk trên `https://partner.go2joy.vn` (khoảng 500 request/phút). Việc này bật làm mới thông tin khách sạn, phòng và bảng vùng trên production | Đã gửi yêu cầu → có trả lời về miễn trừ → đã bàn giao thông tin xác thực, kiểm tra kết nối đạt | P0 | Gửi 10/26 · thông tin xác thực trước 11/02 | G18 |


### 3.5 Đội phát triển Go2Joy — câu hỏi về Partner API

Những điểm tài liệu Partner API công khai (kiểm tra 10/23) và kết quả đo trên staging (10/21 – 10/23) không khớp. Chỉ cần trả lời; Go2Joy quyết định có cần sửa gì hay không.


| WR | Câu hỏi | Tài liệu / quan sát | Ưu tiên | Tham chiếu |
|----|----|----|----|----|
| WR-24 | Cơ sở dữ liệu Partner staging so với HA UAT | Khách sạn 4118: 21 phòng trên Partner / 7 trên HA, giá và giờ khác nhau. Production có dùng một cơ sở dữ liệu không? | P1 | G19 ① |
| WR-25 | Mã trạng thái phòng | Tài liệu chỉ định nghĩa `status` là 1 Available · 2 Locked, nhưng chúng tôi quan sát thấy 1 · 4 · 5. Ý nghĩa của 4 và 5; mã cho "chờ duyệt" và "bản nháp" | P1 | G19 ② |
| WR-26 | Số lượng phòng | Theo tài liệu, `numOfRoom` 2147483647 nghĩa là "không xác định được", và mọi giá trị chúng tôi thấy đều là giá trị này. Có trường nào cho tổng số phòng của từng khách sạn không? | P1 | G19 ③ ⑥ |
| WR-27 | Vùng `10` `v1.1` | Enum trong tài liệu là 1 – 5, nhưng Province Feed trả về 17 thành phố Manila với `10`. Tên và ý nghĩa, cùng danh sách các giá trị vùng có thể xuất hiện. Ảnh hưởng trực tiếp tới cách SharpTalk suy ra vùng (§1.1) | P1 | G19 ⑤ |
| WR-28 | Lỗi tra cứu theo giờ | Room Type List với `bookingType=1` trả về `code 0` (lỗi máy chủ nội bộ). Tài liệu yêu cầu `startTime` · `endTime` cho đặt theo giờ, nên SharpTalk sẽ kiểm tra lại request của mình trước (S-09) và chỉ hỏi nếu vẫn còn lỗi | P2 | G19 ⑦ |
| WR-29 | Phạm vi và hành vi của Hotel Feed | Tài liệu quy định `provinceSn` · `districtSn` là bắt buộc và `hotelSnList` là tùy chọn. Feed có bao gồm mọi khách sạn HA không (thiếu 4118)? Việc trả về toàn bộ, bỏ qua bộ lọc, khi không có khách sạn nào khớp có phải là chủ ý không? | P2 | G18 · G34 |
| — | Đính chính tài liệu Support Assistant API | Đường dẫn Hotel Info `getHotelnfo` (tài liệu công khai ghi `/api/v2/hotel/getHotelInfo`); đường dẫn Room Type Feed v1 lại hiển thị ví dụ phản hồi v2 | P2 | G19 ⑧ |


### 3.6 Pháp chế


| WR | Công việc | Chi tiết | Hoàn thành khi | Ưu tiên | Hạn (đề xuất) | Tham chiếu |
|----|----|----|----|----|----|----|
| WR-30 | **Rà soát quyền riêng tư / PDPL** | Thông báo chuyển dữ liệu xuyên biên giới (bên xử lý Anthropic · Voyage, khu vực xử lý), có cần đánh giá tác động chuyển dữ liệu hay không, phạm vi che dữ liệu, thời gian lưu hội thoại (dự thảo 180 ngày), quy trình thông báo khi rò rỉ dữ liệu | Trả lời bằng văn bản | P0 | 10/30 | G4 |
| WR-31 | **Xác nhận URL điều khoản, phiên bản và thông báo AI** `v1.2`<br>\[Cần xác nhận\] | Với người dùng HA đã đăng nhập, việc đồng ý điều khoản HA được ghi nhận làm sự đồng ý của widget và banner đồng ý được bỏ qua. SharpTalk đã thiết lập trên staging: điều khoản `https://go2joy.vn/vi-vn/policy?tab=terms-of-use`; thông báo dưới widget VI "Được tạo bởi AI, áp dụng **điều khoản dịch vụ**" / EN "Created by AI; apply **terms of service**" (phần in đậm liên kết tới điều khoản). Đây có đúng tài liệu không, **phiên bản** nào, và nội dung đã được duyệt chưa? | Xác nhận kèm phiên bản | P0 | 10/30 | G5 |


### 3.7 PM


| WR | Công việc | Chi tiết | Ưu tiên | Hạn (đề xuất) | Tham chiếu |
|----|----|----|----|----|----|
| WR-40 | **Người phụ trách và kênh liên lạc** | Người phụ trách PM, HA backend / FE, hạ tầng, Partner API, vận hành (trưởng CS), pháp chế, và kênh trao đổi hằng ngày | P0-S | 10/26 | G6 |
| WR-41 | Lịch giai đoạn 2 | B2C trước / sau đặt phòng, webhook đặt phòng hoàn tất, nhúng vào app / web Go2Joy, menu HA (iframe · SSO), vận hành nhân viên lễ tân, tính phí theo điểm, hội thoại Zalo, điều khoản hợp đồng dịch vụ | P2 | Tháng 11 | G40 – G47 · G7 |
| WR-42 | Có cần tên và địa chỉ doanh nghiệp không? `v1.1 new` | Còn để ngỏ từ v1.0. SharpTalk có thể tự lấy **địa chỉ khách sạn** từ `address` của Hotel Feed, nên HA không cần gửi (trừ khách sạn không có trong feed, WR-29). Nếu console cần **tên doanh nghiệp đã đăng ký**, việc thêm một khóa được ký đã được thống nhất là đặc tả giai đoạn 2 (v1.5). Không gửi trước thời điểm đó (khóa lạ gây 401) | P2 | Cùng WR-41 | v1.0 §8 |


## 4. Công việc của SharpTalk `v1.1`


| \# | Công việc | Bắt đầu khi | Thời gian / hạn | Ưu tiên |
|----|----|----|----|----|
| S-01 | Phát hành hướng dẫn v1.4: đặc tả §1, lịch sử thay đổi, mã mẫu PHP (có NFC), test vector mới T1 – T6 `v1.3`<br>\[Hoàn thành\] 10/24 — [trang chia sẻ](https://claude.ai/artifact/2An9WPgY9oCcs3PugiqXf8) · repo `GUIDE-261024-Go2Joy-HA-Identify-v1.4` · T1 – T6 đã đối chiếu với PHP 8.3 + intl | — | Thứ Hai 10/26 | P0-S |
| S-02 | Chấp nhận v1.4: `province_sn` và mã vai trò, suy ra vùng từ Province Feed, chấp nhận khóa v1.3 trong giai đoạn chuyển tiếp `v1.3`<br>\[Hoàn thành\] 10/24 trên staging — đã lập chỉ mục 80 mã tỉnh; đã đo thực tế (mã → tỉnh và vùng, mã được ưu tiên khi giá trị v1.3 khác, mã không xác định → người phụ trách mặc định) | — | Thứ Ba 10/27 trên staging | P0-S |
| S-03 | Gửi embed secret staging qua kênh bảo mật | WR-02 phương án A | Trong ngày | P0-S |
| S-04 | Chỗ nhập secret do đối tác cung cấp (thay đổi nhỏ) | WR-02 phương án B | Lên lịch sau khi có quyết định | Có điều kiện |
| S-05 | `v1.2` Mời các nhân viên còn thiếu, hoàn thiện quy tắc (North Center, South Center, central), tên danh mục tiếng Việt, người phụ trách mặc định và giờ làm việc (hoặc rà soát những gì Go2Joy đã nhập) → chia sẻ kết quả kiểm tra phân công | WR-10 – 13 | Trong ngày – nửa ngày | P0-S |
| S-06 | Sau khi xác minh, tắt chế độ tạm thời không ký. Giải pháp tạm tên tỉnh → vùng được giữ trong giai đoạn chuyển tiếp | WR-01 · 04 · 05 | Trong ngày | P0-S |
| S-07 | Cài đặt SharpTalk trên server Go2Joy (hồ sơ VN), chuyển tenant go2joy, tri thức, bảng vùng và quy tắc, lập chỉ mục lại, kết nối Partner API. Đồng bộ nằm trong giới hạn production (khoảng 500/phút) | WR-20 · 21 · 22 · 23 | 4 ngày | P0 |
| S-08 | Gửi embed secret production qua kênh bảo mật (khác với staging) | WR-20 | Trước WR-06 | P0 |
| S-09 | Kiểm tra lại request tra cứu theo giờ (có `startTime` · `endTime`) | — | 10/27 | P2 |
| S-10 | **Xoay vòng secret không gián đoạn**: chấp nhận đồng thời secret cũ và mới trong khung thời gian xoay vòng, sau đó loại bỏ secret cũ. Bổ sung quy trình vào hướng dẫn | — | 11/06 | P1 |
| S-11 | Nhập phiên bản điều khoản (URL và nội dung thông báo đã thiết lập trên staging; được chuyển cùng bản cài đặt production) | WR-31 | Trong ngày | P0 |
| S-12 | Xử lý xung đột tri thức (đã xác nhận đồng bộ lại Notion) | WR-16 | 1 – 2 ngày | P1 |


## 5. Lịch trình và phụ thuộc

``` tl
Thứ Hai 10/26  WR-02 quyết định khóa ký · WR-40 người phụ trách · WR-23 gửi yêu cầu chứng nhận Partner production
               SharpTalk: S-01 hướng dẫn v1.4 và test vector
Thứ Ba 10/27   WR-01 endpoint ký + T1–T6 · danh sách mã vai trò · WR-10–14 đội, nhân sự, tiêu chí, tài khoản
               SharpTalk: S-02 chấp nhận v1.4 · S-03 secret · S-05 tài khoản và quy tắc
Thứ Tư 10/28   WR-04 sửa mã nhúng FE → identify 200
10/29–30       WR-05 UAT chung · WR-19a cài đặt cảnh báo nhân viên · WR-20/21/22 điều kiện tiên quyết production
Thứ Bảy 10/31  Mở staging (HA UAT → SharpTalk staging, nhân viên thật trả lời)

Mở production = ngày cả ba việc sau đều xong
  ① WR-20 bàn giao server + S-07 cài đặt 4 ngày + UAT production 3 ngày (cần WR-30 · 31)
  ② WR-23 thông tin xác thực Partner production (chứng nhận khoảng một tuần)
  ③ WR-06 triển khai HA production (cần S-08 secret production)
  → Nếu mọi ngày đề xuất được giữ, ngày mở production sớm nhất là Thứ Ba 11/10
```

- Hạn chót điều kiện tiên quyết 10/22 đã qua, vì vậy **10/31 là mở staging, không phải mở production** (quyết định PLN-261015).
- Nếu WR-01 hoặc WR-04 bị trễ, staging chỉ có thể mở với chế độ tạm thời không ký. Khi đó chúng tôi khuyến nghị không bắt đầu dịch vụ với nhân viên thật.
- Chứng nhận WR-23 mất khoảng một tuần và nằm trên đường găng; phải gửi yêu cầu vào 10/26 thì mốc 11/10 mới giữ được.
- `v1.2` Nếu WR-11 bị trễ, khách sạn miền Nam chỉ đến được người phụ trách mặc định.

## 6. Tiêu chí hoàn thành

### 6.1 Mở staging (danh sách kiểm tra WR-05)


| Kiểm tra | Kết quả mong đợi |
|----|----|
| Mở widget khi chưa đăng nhập | Như hiện nay: khách vãng lai, hiển thị banner đồng ý |
| Đăng nhập HA → mở widget | identify **200**, `identified {ok: true}`, không có banner đồng ý, tên nhân viên trong lời chào, "đã xác minh" trong live chat của console |
| Console › Khách hàng › Doanh nghiệp | Một khách sạn (tên · tỉnh · vùng, vùng do SharpTalk suy ra), nhân viên đã đăng nhập và vai trò là người liên hệ, loại phòng là sản phẩm của khách sạn đó |
| Đổi ngôn ngữ HA vi ↔ en | Giá trị được ký giữ nguyên, nên hội thoại tiếp tục; chỉ ngôn ngữ câu trả lời và nút thay đổi |
| Đổi khách sạn đang chọn | Khách hàng doanh nghiệp và hội thoại chuyển sang khách sạn mới |
| Chọn "tất cả khách sạn" → nói chuyện với nhân viên | identify 200, không có khách sạn, chuyển tới nhân viên dự phòng của WR-13 |
| "Nói chuyện với nhân viên" từ khách sạn ở cả 5 vùng (north · north_center · central · south_center · south) → lần lượt chọn danh mục bs và cs `v1.2` | Được phân công cho đội × nhãn theo quy tắc WR-10; trung tâm cảnh báo hiển thị người phụ trách và quy tắc; người phụ trách nhận cảnh báo |
| Bỏ qua bước chọn danh mục `v1.2` | Được phân công cho người phụ trách mặc định của WR-13 |
| Console Cài đặt › Chuyển giao nhân viên › Kiểm tra phân công `v1.2` | Không có cảnh báo quy tắc (không còn "0 người hoạt động") |
| Tên khách sạn có dấu (kể cả đầu vào dạng tách rời) | 200 (đã xác nhận NFC) |
| Tài khoản nhân viên có email rỗng | Trường email bị bỏ; 200 |
| Widget sau khi đăng xuất · hết hạn phiên · đăng nhập bằng tài khoản khác | Khách vãng lai (hoặc tài khoản mới); không thấy tên và hội thoại của nhân viên trước |
| Sửa một **giá trị được ký** (`userId` hoặc một thuộc tính) mà không ký lại | 401 E5048, `ok: false`, khách vãng lai. `name` · `email` · `phone` không được ký, nên sửa chúng vẫn cho 200, đúng như thiết kế |


Khi các mục trên đạt, SharpTalk tắt chế độ tạm thời không ký trên staging (S-06).

### 6.2 Mở production


| Kiểm tra | Kết quả mong đợi |
|----|----|
| Đăng nhập HA production → widget (`sharptalk.go2joy.vn`) | identify 200 (secret production); các mục kiểm tra chính của §6.1 đạt lại |
| Gửi gói ký bằng secret staging tới production | 401 (các môi trường tách biệt) |
| Kết nối Partner API production | Làm mới thông tin khách sạn · phòng · bảng vùng thành công; không có lỗi 6 (chữ ký) hoặc 8 (IP) |
| Điều khoản và thông báo | Bản ghi đồng ý mang URL và phiên bản điều khoản HA từ WR-31 |


## 7. Tham khảo — điểm chính của Partner API (tài liệu công khai, 10/23)


| Mục | Tài liệu | SharpTalk dùng cho |
|----|----|----|
| Môi trường | Staging `staging-partner.go2joy.vn` (khoảng 250/phút) · production `partner.go2joy.vn` (khoảng 500/phút) | Giới hạn tốc độ đồng bộ |
| Xác thực | `Authorization` = hex(HMAC-SHA256(client secret, URL + "\|" + JSON body)); body có `clientId` · `timestamp` (hết hạn sau 5 phút); danh sách IP cho phép | WR-20 NTP · IP tĩnh |
| Ngôn ngữ | Header `Localization` `vi` / `en` (mặc định en) | Tra cứu theo ngôn ngữ của widget |
| Vùng | Province Feed `region`: 1 South · 2 North · 3 Central · 4 North Central · 5 South Center | Bảng suy ra tại §1.1 |
| Khách sạn → tỉnh | Hotel Feed `provinceSn` · `address`; Hotel Info không có tỉnh | Lý do HA gửi `province_sn` (khách sạn không có trong feed) |
| Mã lỗi | Body `code` 0 lỗi server · 1 thành công · 2 thất bại; lỗi 6 chữ ký không hợp lệ · 8 không được phép (IP) · 12 quá nhiều lần thử | Cảnh báo giám sát production |


## 8. Bảng phản hồi

Điền và gửi vào kênh trao đổi hằng ngày.


| WR | Ưu tiên | Người phụ trách | Ngày khả thi | Trạng thái (đang làm / hoàn thành / tạm dừng) | Ghi chú |
|----|----|----|----|----|----|
| WR-01 | P0-S |  |  |  |  |
| WR-02 | P0-S |  |  |  | Phương án A / B |
| WR-03 | P1 |  |  |  |  |
| WR-04 | P0-S |  |  |  |  |
| WR-05 | P0-S |  |  |  |  |
| WR-06 | P0 |  |  |  |  |
| WR-10 | P0-S |  |  |  |  |
| WR-11 | P0-S |  |  |  |  |
| WR-12 | P0-S |  |  |  |  |
| WR-13 | P0-S |  |  |  |  |
| WR-14 | P0-S |  |  |  |  |
| WR-15 | P0 |  |  | Hoàn thành |  |
| WR-16 | P1 |  |  |  |  |
| WR-17 | P1 |  |  |  |  |
| WR-18 | P1 |  |  |  | Giữ / thay đổi |
| WR-19 | P1 |  |  |  |  |
| WR-19a | P1 |  |  |  |  |
| WR-20 | P0 |  |  |  |  |
| WR-21 | P0 |  |  |  |  |
| WR-22 | P1 |  |  |  |  |
| WR-23 | P0 |  |  |  | Miễn đặt phòng thử? |
| WR-24 – 29 | P1 / P2 |  |  |  |  |
| WR-30 | P0 |  |  |  |  |
| WR-31 | P0 |  |  |  |  |
| WR-40 | P0-S |  |  |  |  |
| WR-41 | P2 |  |  |  |  |
| WR-42 | P2 |  |  |  | Cần / không cần |

