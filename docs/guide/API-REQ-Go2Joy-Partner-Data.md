# API-REQ — Go2Joy Partner Data API (bản nháp v0 / draft v0)

Tài liệu đi kèm: [`API-REQ-Go2Joy-Partner-Data.openapi.yaml`](./API-REQ-Go2Joy-Partner-Data.openapi.yaml) (OpenAPI 3.0.3)
Người soạn: Amoeba / SharpTalk · Ngày: 2026-10-13 · Căn cứ: PLN-261012 SG-30 (checklist Gate 3: "부족한 API 설계서 → G2J 리뷰")

> **Trạng thái / Status.** Đây là hợp đồng do **phía Amoeba tự soạn**, chưa được Go2Joy xem. SharpTalk đã được xây và kiểm thử
> **chỉ** với bản mock và một máy chủ giả chạy cục bộ theo đúng hợp đồng này — **chưa gọi thử API thật nào của Go2Joy**
> (yêu cầu R8/R9 chưa được cung cấp). Mọi tên header, mã lỗi, giới hạn đều là **đề xuất** để Go2Joy chỉnh sửa.
> *This contract was written by Amoeba and has not been reviewed by Go2Joy. SharpTalk is built and tested only against a mock
> and a local fake server that follow it; it has never called a real Go2Joy API (R8/R9 not delivered). Every header name, error
> code and limit is a proposal.*

---

## 1. Mục đích / Purpose

**VI.** Khi người dùng khách sạn (lễ tân, quản lý) đã đăng nhập Hotel Admin hỏi trợ lý SharpTalk những câu như "giá qua đêm cuối tuần phòng
Deluxe?", "đặt phòng G2J… đang ở trạng thái nào?", "đối soát tháng 9 còn bao nhiêu chưa thanh toán?", trợ lý cần **dữ liệu thật của chính khách sạn
đó** thay vì chỉ trả lời theo tài liệu chung. API này chỉ **đọc**, gồm bốn chủ đề: `policies` (hủy / hoàn tiền / nhận–trả phòng), `rates`
(giá theo giờ / qua đêm / theo ngày theo loại phòng), `bookings` (theo mã đặt phòng hoặc khoảng ngày), `settlement` (kỳ đối soát, trạng thái,
số còn phải thu).

**EN.** When a signed-in hotel user asks the assistant about their own hotel's rates, policies, bookings or settlement, it needs that hotel's **live
data**, not generic help text. The API is read-only and has four topics: `policies`, `rates`, `bookings`, `settlement`.

## 2. Nguyên tắc phạm vi khách sạn / Hotel scoping (quan trọng nhất / the one rule)

**VI.** *Không có tham số nào (query, body, đường dẫn) được mang mã khách sạn.* Khách sạn được xác định bởi:

1. `Authorization: Bearer <khóa dịch vụ>` — nhận diện SharpTalk; phía Go2Joy gắn cho khóa này **danh sách `hotelSn` được phép** (đề xuất).
2. `X-Hotel-Sn` — khách sạn đang thao tác, do **máy chủ SharpTalk** đặt từ danh tính đã được xác minh (HMAC identify v2: `userId|hotelSn|role|iat`),
   **không bao giờ từ nội dung người dùng gõ hay từ mô hình AI**. API **phải từ chối** (403 `hotel_scope_mismatch`) nếu khách sạn nằm ngoài danh sách của khóa.
3. `X-Actor-Role` (`manager|receptionist|internal`), `X-Claims-Verified-At`, `X-Request-Timestamp`, `X-Request-Id`, và `X-Signature` (HMAC-SHA256) buộc các
   giá trị trên vào từng yêu cầu — để chỉ riêng một khóa bị lộ **không** đủ để giả mạo một khách sạn (khi Go2Joy cấp thêm *signing secret*).
4. Mọi phản hồi đều **lặp lại `hotelSn`**; SharpTalk bỏ phản hồi nếu `hotelSn` khác với khách sạn đã hỏi.
5. Mã đặt phòng của khách sạn khác phải trả **404 `not_found` giống hệt** mã không tồn tại (không để lộ sự tồn tại giữa các khách sạn).

**EN.** *No parameter — query, body or path — may carry a hotel identifier.* The hotel comes from the credential (allow-list of `hotelSn` per key,
proposal) plus `X-Hotel-Sn`, set by SharpTalk's server from claims it already verified. The API must reject a hotel outside the key's allow-list; every reply
echoes `hotelSn` and SharpTalk drops a reply whose echo differs; another hotel's booking code must look exactly like a non-existent one.

### Chữ ký yêu cầu / Request signature (vector kiểm tra / test vector)

```
canonical = "v1\nGET\n<path>\n<query đã sắp xếp>\n<X-Hotel-Sn>\n<X-Actor-Role>\n<X-Claims-Verified-At>\n<X-Request-Timestamp>\n<X-Request-Id>"
X-Signature = "v1=" + hex( HMAC_SHA256(signing_secret, canonical) )
```

Ví dụ / Example — `signing_secret = test-secret`:

```
GET /v0/rates?roomType=DELUXE&rateType=overnight&date=2026-10-17
X-Hotel-Sn: 1721            X-Actor-Role: manager
X-Claims-Verified-At: 1760000000    X-Request-Timestamp: 1760000100
X-Request-Id: 11111111-2222-3333-4444-555555555555

canonical (JSON) = "v1\nGET\n/v0/rates\ndate=2026-10-17&rateType=overnight&roomType=DELUXE\n1721\nmanager\n1760000000\n1760000100\n11111111-2222-3333-4444-555555555555"
X-Signature      = v1=b049a318891f1342bc5c136968752424f04794e1093b241595c56f30c69113f1
```

Tham số truy vấn được sắp theo tên rồi theo giá trị, mã hóa RFC 3986, không có dấu `?` đứng đầu (chuỗi rỗng nếu không có tham số). Lệch đồng hồ > 300 s → 401
`stale_timestamp`.

## 3. Quy tắc dữ liệu / Data rules

| | VI | EN |
|---|---|---|
| Tiền | Số nguyên VND, tên trường kết thúc `Vnd`; `finalVnd = baseVnd + extraVnd − directDiscountVnd − flashSaleVnd − couponVnd`. SharpTalk **tự tính lại** và bỏ phản hồi nếu sai lệch | Integer VND; SharpTalk recomputes the identity and drops violating replies |
| Quyết toán | `netVnd = grossVnd − commissionVnd − deductionVnd`, `outstandingVnd = netVnd − paidVnd` (cũng được kiểm tra) | same, also checked |
| PII | **Không** có tên, số điện thoại, e-mail, giấy tờ của khách ở v0; đặt phòng chỉ nhận diện bằng `bookingCode` | No guest name/phone/e-mail/ID in v0; SharpTalk also whitelists the fields it reads |
| Thời gian | ISO 8601 có offset (+07:00), ngày `YYYY-MM-DD` giờ Việt Nam | ISO 8601 with offset |
| Phân trang | `page` (từ 1), `size` (mặc định 20, tối đa 50) | same |
| Phiên bản | `/v0` trong đường dẫn; thêm trường tùy chọn là tương thích; xóa/đổi theo `Deprecation`/`Sunset` ≥ 90 ngày (đề xuất) | same |
| Idempotency | Chỉ có GET (an toàn để thử lại). SharpTalk thử lại tối đa 1 lần khi lỗi mạng/5xx với **cùng** `X-Request-Id` | GET only; one retry with the same `X-Request-Id` |
| Giới hạn tốc độ | Đề xuất 60 yêu cầu/phút/khóa và 20/phút/khách sạn; 429 + `Retry-After` | proposal |
| Hiệu năng | SharpTalk chờ tối đa 3 s mỗi lần; mục tiêu P95 ≤ 1 s; cache 30–60 s theo (tenant, khách sạn, chủ đề, truy vấn) | 3 s per attempt; 30–60 s cache |

> **Lưu ý về tần suất gọi (SG-33) / Call-rate note.** Ở chế độ `tools` (tùy chọn, mặc định tắt) mô hình AI tự chọn tra cứu: một câu hỏi của người dùng có thể
> sinh tối đa **4 lượt GET tuần tự** (cùng bốn chủ đề, cùng tập tham số đóng, cùng header khách sạn do máy chủ đặt) — hợp đồng không đổi, nhưng nên tính vào giới hạn tốc độ
> (đề xuất 20 yêu cầu/phút/khách sạn). Xem `GUIDE-261013-Partner-Data-Tools-Mode.md`.
> *In the optional `tools` mode (off by default) the AI model chooses the lookups: one user question can cause up to **4 sequential GETs** — same four topics, same closed
> parameters, same server-set hotel header. The contract is unchanged, but size rate limits for it (proposal: 20 requests/min/hotel).*

## 4. Cần Go2Joy cung cấp / What we need from Go2Joy (R8 / R9)

1. **R8 — Danh sách API và đặc tả thật** cho bốn chủ đề (hoặc nhận xét chi tiết trên bản nháp này): đường dẫn, tham số, giá trị liệt kê (trạng thái đặt phòng, loại giá, loại thanh toán), mã loại phòng.
2. **R9 — Khóa dịch vụ và môi trường sandbox**: base URL, khóa API, (tùy chọn) signing secret, tài khoản khách sạn thử nghiệm với dữ liệu mẫu cho cả ba vai trò.
3. Cách Go2Joy **ràng buộc khóa với danh sách khách sạn** (allow-list `hotelSn`) và có chấp nhận cơ chế `X-Hotel-Sn` + chữ ký ở trên không.
4. Xác nhận **mạng**: API công khai (HTTPS) hay mạng nội bộ của Go2Joy (khi SharpTalk chạy trên hạ tầng Go2Joy cần khai báo máy chủ trong `PARTNER_API_PRIVATE_HOSTS`).
5. SLA, giờ bảo trì, giới hạn tốc độ thực tế.
6. Chính sách dữ liệu cá nhân (R16): dữ liệu đặt phòng không chứa PII — xác nhận đủ hay cần thêm trường nào (và ai được xem).

*EN: R8 real API list/spec (or comments on this draft) incl. enumerations and room-type codes; R9 service key + sandbox + test hotels for all three roles;
how keys are bound to hotels; network placement; SLA and real rate limits; PII confirmation (R16).*

## 5. Câu hỏi mở / Open questions

1. Khóa dịch vụ gắn với **một** khách sạn hay nhiều? Có cần `hotelSn` trong khóa hay `X-Hotel-Sn` là đủ? / One key per hotel or many?
2. Mã khách sạn (`hotelSn`) là số hay chuỗi; định dạng mã đặt phòng (`bookingCode`) và mã loại phòng (`roomType`) là gì? / Formats of `hotelSn`, `bookingCode`, `roomType`.
3. Giá theo giờ: gói giờ đầu và giá giờ phụ có chuẩn không (`includedHours`, `extraHourVnd`)? Phụ thu cuối tuần / ngày lễ nằm trong `extraVnd` hay tách riêng? / Hourly and surcharge modelling.
4. `couponVnd`, `flashSaleVnd`, `directDiscountVnd`: ai chịu chi phí (khách sạn hay Go2Joy) — có ảnh hưởng đối soát? / Who funds each discount; effect on settlement.
5. Đối soát: kỳ là tháng hay nửa tháng? Có trạng thái khác `pending|paid|disputed`? Có khoản điều chỉnh âm? / Settlement periods, statuses, negative adjustments.
6. Vai trò nào được xem chủ đề nào phía Go2Joy (SharpTalk hiện cho `settlement` chỉ `manager`/`internal`)? / Role → topic matrix on your side.
7. Thời hạn hiệu lực tối đa của claims (đề xuất 8 giờ) có phù hợp phiên Hotel Admin? / Maximum claims age (8 h proposed).
8. Có cần thêm chủ đề (khuyến mãi, tồn phòng, đánh giá) cho pilot? / Further topics for the pilot.

## 6. SharpTalk đã làm gì để an toàn / What SharpTalk already enforces

- Tham số **đóng** cho từng chủ đề; mọi khóa dạng `hotelSn` / `hotel_id` / `propertyId`… bị từ chối (lỗi E5104), cả khi người dùng nhắc tới khách sạn khác trong tin nhắn.
- Danh sách vai trò theo chủ đề (lễ tân bị từ chối `settlement`, E5101) **trước khi** gọi API; claims phải được ký và còn hạn (E5102).
- Chỉ đọc các trường đã liệt kê (loại bỏ PII), kiểm tra bất biến tiền; mọi số trong câu trả lời của AI phải có trong khối dữ liệu do máy chủ dựng, nếu không câu trả lời bị giữ lại và chuyển người (E5107).
- Không tái sử dụng câu trả lời đã lưu cho lượt dùng dữ liệu đối tác; nhật ký tra cứu `partner_lookup_logs` ghi tenant, khách sạn, vai trò, chủ đề, tham số đã che, trạng thái, độ trễ, mã băm bản chụp.
- Mặc định **tắt**: cần `PARTNER_DATA_ENABLED` ở máy chủ **và** công tắc của tenant; `PARTNER_API_MODE=mock` là mặc định.
