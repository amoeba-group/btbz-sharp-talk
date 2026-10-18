# FIX-261016 Ảnh chọn từ thư viện không tới widget trên Android 13+

## Triệu chứng
Trong app mẫu trên emulator Android 15, bấm đính kèm, chọn "Chọn từ thư viện", chọn một ảnh và bấm Add: trình chọn đóng,
quay lại chat, nhưng không có thanh đính kèm, không có yêu cầu tải lên và không có thông báo lỗi nào.

## Nguyên nhân (từ log)
Log tạm trong SDK cho thấy trình chọn ảnh hệ thống trả `RESULT_OK` với `data = null` và ảnh nằm trong `clipData` (1 mục, cờ cấp
quyền đọc). SDK gọi `WebChromeClient.FileChooserParams.parseResult`, hàm này chỉ đọc `Intent.data`, nên trả `null` và WebView
coi như người dùng hủy. Không có lỗi nào để bắt vì "hủy" là đường đi hợp lệ.

## Sửa
`ShopTalkChatFragment.parsePickerResult` đọc cả `data` lẫn từng mục của `clipData`; `parseResult` chỉ còn là phương án dự phòng.
Kiểm lại trên emulator: thanh đính kèm có ảnh thu nhỏ, gửi đi, `message_attachments` có bản ghi `image/png` 213 554 byte,
AI trả lời.

## Lỗi cùng đợt
- Nút gửi bị cắt ở cỡ chữ hệ thống 130 %: ô nhập trong khung flex thiếu `min-w-0`. Đã thêm.
- `ivy:ready` bắn hai lần mỗi lần tải làm host bị yêu cầu ký hai lần: `onWidgetReady` bỏ qua lần lặp.
- Dải trống dưới thanh công cụ của host: fragment đệm toàn bộ inset status bar; nay chỉ đệm phần chồng lên view.
- Dòng SYSTEM và chip lặp mã tham chiếu khi label đã chứa mã: API và widget chỉ thêm `#ref` khi label chưa có.

## Phòng ngừa
- Mọi kết quả từ `ActivityResultContracts.StartActivityForResult` của trình chọn tệp phải tự đọc `data` và `clipData`; không dựa vào `parseResult`.
- Đường "hủy" và đường "lỗi" giống nhau với WebView, nên tính năng đính kèm phải được kiểm bằng một tệp thật đi hết vòng tới server,
  không chỉ kiểm hộp chọn mở được. Đã ghi vào TCR-261016 E8.
- Khi viết chú thích Kotlin, tránh chuỗi `image/*` trong `/** */`: Kotlin cho phép chú thích lồng nhau nên `/*` mở thêm một cấp
  và cả phần còn lại của file thành chú thích (build báo hàng loạt "Unresolved reference").
