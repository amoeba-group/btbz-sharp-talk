# Go2Joy — Vietnam personal-data (PDPL) checklist / Danh mục kiểm tra bảo vệ dữ liệu cá nhân

| | |
|---|---|
| Document / Tài liệu | GUIDE-261013-Go2Joy-PDPL-Checklist |
| Date / Ngày | 2026-10-13 |
| Source / Nguồn | PLN-261012 SG-70 (REQ §3.8, R16) |
| Audience / Đối tượng | Go2Joy (data controller, DPO, legal counsel) · Amoeba delivery team |
| Status / Trạng thái | **DRAFT — nothing below is legal advice. / BẢN NHÁP — không phải tư vấn pháp lý.** |

> **EN.** SharpTalk ships a Vietnam notice profile (`vn_pdpl`) and the tooling to run a data-protection
> programme (consent evidence, retention windows, an operator-side data-subject-request screen). It does
> **not** decide what the law requires. Every row in section B is a decision that **Go2Joy and its counsel
> must make** and that Amoeba cannot make for them. The notice wording in the product is a **draft**: the
> governing statute and the legal basis are unconfirmed (this repository only ever cited Decree 13/2023/NĐ-CP;
> whether the Law on Personal Data Protection adopted in 2025 applies, from when, and how it interacts with the
> Decree is **not confirmed here**), and the Vietnamese text needs a **native-speaker review**. None of this
> caveat appears in the text shoppers read — it lives here and in code comments.
>
> **VI.** SharpTalk có sẵn hồ sơ thông báo cho Việt Nam (`vn_pdpl`) và các công cụ để vận hành chương trình
> bảo vệ dữ liệu (bằng chứng đồng ý, thời hạn lưu, màn hình xử lý yêu cầu của chủ thể dữ liệu). Sản phẩm
> **không** quyết định pháp luật yêu cầu gì. Mỗi dòng ở phần B là một quyết định **Go2Joy và luật sư của Go2Joy
> phải đưa ra**; Amoeba không thể quyết định thay. Câu chữ thông báo trong sản phẩm chỉ là **bản nháp**: văn bản
> luật áp dụng và căn cứ pháp lý chưa được xác nhận (kho mã này chỉ từng viện dẫn Nghị định 13/2023/NĐ-CP; việc
> Luật Bảo vệ dữ liệu cá nhân được thông qua năm 2025 có áp dụng hay không, từ khi nào và quan hệ với Nghị định
> **chưa được xác nhận ở đây**), và bản tiếng Việt cần **người bản ngữ rà soát**. Những lưu ý này không xuất
> hiện trong nội dung khách hàng đọc — chúng chỉ nằm ở tài liệu này và trong chú thích mã nguồn.

---

# Part 1 — English

## A. What the deployment does with personal data today (verified in code, 2026-10-13)

| Data | Where it comes from | Stored in | Goes to | Kept for |
|---|---|---|---|---|
| Chat messages (text, attachments) | Widget visitor | `messages`, `conversations`, attachment files | **Anthropic** (answer, intent, moderation) and **Voyage AI** (embedding of the question), both **US** (`AI_PROCESSING_REGION`); the AI copy has e-mail / phone / card / order-number / address **masked** first | `CONVERSATION_LOG_RETENTION_DAYS` (blank/0 = **365**, not "forever") |
| Signed hotel / partner claims (`hotelSn`, role, hotel name, province) | Hotel Admin `identify` (HMAC) | `sessions.identity_claims`, `customers.last_claims` | Hotel name, `hotelSn`/code and role reach the model as one context line (`PARTNER_CONTEXT`) | Session row: with the conversation window; customer row: until erased or `CUSTOMER_RETENTION_DAYS` |
| Customer record (name, e-mail, phone, external id) | Identify / live-chat lead form | `customers` (PII encrypted at rest, AES-256-GCM) | Not sent to AI | Until erased; **opt-in** `CUSTOMER_RETENTION_DAYS` anonymises inactive customers |
| Device information (language, viewport, referrer, landing URL) | Widget | `sessions`, analytics events | Not sent to AI. GA4 only if the host page sets `ga4Id` | With the session |
| Consent evidence | Widget consent banner | `audit_logs` rows `consent.granted / declined / withdrawn` (system actor, session id, notice version, language — **no IP, no PII**) | — | `AUDIT_LOG_RETENTION_DAYS` (opt-in, minimum 90) |
| Data-subject requests handled by staff | Console › Settings › Data requests | `audit_logs` `dsar.lookup / export / delete` (operator id, request reference; the search term is **never** stored) | — | same |
| E-mail replies, alerts | Off-hours replies, escalation alerts | SMTP provider (if `SMTP_HOST` set); Slack (if `SLACK_WEBHOOK_URL` set) | Customer e-mail, message preview (≤ 300 chars) | Provider-side — unknown |
| Notion | Knowledge sources only | — | Nothing personal leaves: the connector only **reads** pages | n/a |

## B. Decisions Go2Joy and counsel must make (R16)

Owner column: **G** = Go2Joy (business) · **L** = Go2Joy legal/counsel · **A** = Amoeba. Tick when decided and
write the answer next to the row.

| # | Decision | Owner | Why it matters / what the product assumes | Where it is set |
|---|---|---|---|---|
| B-1 | **Governing law and articles.** Decree 13/2023/NĐ-CP, the 2025 Law on Personal Data Protection, or both; effective dates, transitional rules, article numbers to cite | L | Repo cites only the Decree. The notice deliberately cites **no** article numbers until this is confirmed | Notice text (console), policy page |
| B-2 | **Roles.** Which Go2Joy entity is the controller (or controller-processor); is Amoeba a processor, or only a support vendor with no data access | L, G | The `controller` line has `[[…]]` placeholders; processor register row 11 | Console › Settings › Privacy notice › *Data controller & contact* |
| B-3 | **DPO / data-protection contact** (name or role, e-mail, phone) | G | Printed in the notice and in the incident runbook | same + INCIDENT-RESPONSE.md §6 |
| B-4 | **Legal basis and consent model.** Hotel Admin users are staff of partner companies: is each user's click-through consent sufficient, or is a partner-level agreement needed? Is consent even the right basis for support chats? | L | Product records an individual click (grant / decline / withdraw). Declined or stale consent blocks chat processing (fail-closed) | `vn_pdpl` profile; bump version after any change |
| B-5 | **Sensitive or special data.** Partners discuss settlement bank accounts and tax ids in chat. Card numbers, e-mail, phone and addresses are masked before the AI; bank account numbers and tax ids are **not** specifically masked | L, A | Decide whether to extend masking (A) or restrict the topic | `pii-scrub.util.ts` |
| B-6 | **Cross-border transfer.** Anthropic and Voyage process in the US. Is a transfer-impact assessment dossier needed, who files it and when, is a notice to the authority required, are standard contractual terms needed? Or switch provider/region? Also: staff-triggered **translate / briefing** calls send **unmasked** chat text to the AI (AI-DPIA-GATE.md §1.1 gap) | L, A | The notice says where AI processing happens (`{{region}}`) and that data may be sent abroad. Keep `AI_PROCESSING_REGION` equal to reality | `AI_PROCESSING_REGION`; DPA in PROCESSOR-REGISTER.md |
| B-7 | **Impact-assessment dossiers** (processing and cross-border) — who prepares, what Amoeba must supply | L, A | AI-DPIA-GATE.md and PROCESSOR-REGISTER.md are inputs, not the dossier | — |
| B-8 | **Retention periods.** Conversation logs (`CONVERSATION_LOG_RETENTION_DAYS`; staging profile drafts **180**), customers (`CUSTOMER_RETENTION_DAYS`), audit trail (`AUDIT_LOG_RETENTION_DAYS`) | L, G | The notice quotes the conversation window automatically. The two opt-in purges are **off** until you choose. Purging audit rows also deletes consent evidence older than the window | `.env` (see `CONFIG.md`) |
| B-9 | **Data-subject-request procedure.** Statutory response deadlines; how the requester's identity is verified (the tool cannot); who may run it (master / director only); what is logged (`reference` field) | L, G | Operator tool exports / erases by customer id; erasure is irreversible and propagates the identity to the suppression list | Console › Settings › Data requests |
| B-10 | **Breach notification.** Who notifies the authority, within what time (the Decree sets 72 h — confirm for the 2025 Law), which authority desk, template | L | INCIDENT-RESPONSE.md §6 lists every contact as **〔지정 필요〕** (to be assigned) | INCIDENT-RESPONSE.md |
| B-11 | **Notice wording and versioning.** Approve the English and Vietnamese text; native Vietnamese review; policy URL; when a change is "material" (bump the version = every user is asked again) | L, G | Wording is a draft. Languages other than vi/en read the **English** lines | Console › Settings › Privacy notice |
| B-12 | **Processor contracts (DPA).** Anthropic, Voyage, SMTP provider, Slack, hosting | L, A | All **TBD** in the register — no evidence in the repo | PROCESSOR-REGISTER.md |
| B-13 | **Hosting location** of the Go2Joy stack (inside Vietnam or not) | G | Decides whether the DB itself is a cross-border transfer; staging is in Korea | PROCESSOR-REGISTER.md row 11 |
| B-14 | **Analytics and cookies.** GA4 is off unless the host page passes `ga4Id`. The `vn_pdpl` notice does not mention analytics | G | If Go2Joy turns GA4 on, the notice must change | embed snippet |
| B-15 | **Consent evidence.** Is a system-level trail (session id, version, time, no person identifier) enough, or must a consent be linkable to a named user? For how long must it be kept? | L | Today the trail is deliberately PII-free; linking it to a user would need extra design | `AUDIT_LOG_RETENTION_DAYS` |
| B-16 | **Record of processing activities** and the other registers the law requires | L, G | Section A is a starting point, not the register | — |

## C. Things the product does not do (so nobody assumes it does)

- **No per-customer legal hold.** If a hold or regulator request applies, switch `CUSTOMER_RETENTION_DAYS` / `AUDIT_LOG_RETENTION_DAYS` off (or raise them) **before** the next scheduled run (daily). Purged data cannot be recovered.
- **The operator tool does not verify the requester.** It is a lever, not a procedure.
- **Phone look-up scans.** Phone numbers are encrypted without a search index, so the operator tool walks the tenant's customers (bounded) and tells you when the answer may be incomplete. A `phone_hash` index is a follow-up.
- **Erasure is not deletion.** The customer row stays as an empty stub (history stays joinable); an erased customer who signs in again gets a fresh row.
- **The other privacy profiles still read the bundled text** (365 days, "United States") — only `vn_pdpl` is interpolated from the deployment. Use `vn_pdpl` for the Go2Joy tenant.

---

# Part 2 — Tiếng Việt

## A. Hiện nay hệ thống xử lý dữ liệu cá nhân như thế nào (đã đối chiếu mã nguồn, 13/10/2026)

| Dữ liệu | Nguồn | Lưu ở | Gửi tới | Thời hạn lưu |
|---|---|---|---|---|
| Tin nhắn trò chuyện (văn bản, tệp đính kèm) | Người dùng widget | `messages`, `conversations`, tệp đính kèm | **Anthropic** (trả lời, phân loại ý định, kiểm duyệt) và **Voyage AI** (vector hóa câu hỏi), đều tại **Hoa Kỳ** (`AI_PROCESSING_REGION`); bản gửi cho AI đã được **che** email / điện thoại / thẻ / mã đơn / địa chỉ | `CONVERSATION_LOG_RETENTION_DAYS` (để trống/0 = **365** ngày, không phải "mãi mãi") |
| Thông tin khách sạn / đối tác đã ký (`hotelSn`, vai trò, tên khách sạn, tỉnh) | `identify` từ Hotel Admin (HMAC) | `sessions.identity_claims`, `customers.last_claims` | Tên khách sạn, `hotelSn`/mã và vai trò được đưa cho mô hình dưới dạng một dòng ngữ cảnh (`PARTNER_CONTEXT`) | Bản ghi phiên: theo thời hạn hội thoại; bản ghi khách hàng: đến khi bị xóa hoặc theo `CUSTOMER_RETENTION_DAYS` |
| Hồ sơ khách hàng (tên, email, điện thoại, ID bên ngoài) | `identify` / biểu mẫu khách trong chat trực tiếp | `customers` (mã hóa PII khi lưu, AES-256-GCM) | Không gửi cho AI | Đến khi bị xóa; tùy chọn `CUSTOMER_RETENTION_DAYS` sẽ ẩn danh khách không hoạt động |
| Thông tin thiết bị (ngôn ngữ, kích thước, referrer, URL vào trang) | Widget | `sessions`, sự kiện phân tích | Không gửi cho AI. GA4 chỉ khi trang nhúng khai báo `ga4Id` | Theo phiên |
| Bằng chứng đồng ý | Banner đồng ý trong widget | `audit_logs`: `consent.granted / declined / withdrawn` (tác nhân hệ thống, mã phiên, phiên bản thông báo, ngôn ngữ — **không có IP, không có PII**) | — | `AUDIT_LOG_RETENTION_DAYS` (tùy chọn, tối thiểu 90) |
| Yêu cầu của chủ thể dữ liệu do nhân viên xử lý | Console › Cài đặt › Yêu cầu dữ liệu | `audit_logs`: `dsar.lookup / export / delete` (mã người thao tác, mã tham chiếu yêu cầu; **không bao giờ** lưu nội dung tìm kiếm) | — | như trên |
| Email trả lời, cảnh báo | Trả lời ngoài giờ, cảnh báo chuyển người | Nhà cung cấp SMTP (nếu đặt `SMTP_HOST`); Slack (nếu đặt `SLACK_WEBHOOK_URL`) | Email khách, bản xem trước tin nhắn (≤ 300 ký tự) | Do nhà cung cấp quyết định — chưa rõ |
| Notion | Chỉ là nguồn tri thức | — | Không có dữ liệu cá nhân nào đi ra: trình kết nối chỉ **đọc** trang | Không áp dụng |

## B. Các quyết định Go2Joy và luật sư phải đưa ra (R16)

Cột người phụ trách: **G** = Go2Joy (nghiệp vụ) · **L** = pháp chế/luật sư của Go2Joy · **A** = Amoeba. Đánh dấu khi đã
quyết định và ghi câu trả lời cạnh dòng tương ứng.

| # | Quyết định | Ai | Vì sao quan trọng / sản phẩm đang giả định gì | Cấu hình ở đâu |
|---|---|---|---|---|
| B-1 | **Luật áp dụng và điều khoản.** Nghị định 13/2023/NĐ-CP, Luật Bảo vệ dữ liệu cá nhân 2025, hay cả hai; ngày hiệu lực, quy định chuyển tiếp, số điều cần viện dẫn | L | Kho mã chỉ viện dẫn Nghị định. Thông báo cố ý **không** ghi số điều cho đến khi được xác nhận | Nội dung thông báo (console), trang chính sách |
| B-2 | **Vai trò.** Pháp nhân Go2Joy nào là bên kiểm soát (hoặc vừa kiểm soát vừa xử lý); Amoeba là bên xử lý hay chỉ là nhà cung cấp hỗ trợ không truy cập dữ liệu | L, G | Dòng `controller` đang để chỗ trống `[[…]]`; sổ nhà xử lý dòng 11 | Console › Cài đặt › Thông báo quyền riêng tư › *Bên kiểm soát dữ liệu & liên hệ* |
| B-3 | **Đầu mối bảo vệ dữ liệu / DPO** (tên hoặc chức danh, email, điện thoại) | G | In trong thông báo và trong quy trình ứng phó sự cố | như trên + INCIDENT-RESPONSE.md §6 |
| B-4 | **Căn cứ pháp lý và mô hình đồng ý.** Người dùng Hotel Admin là nhân viên của công ty đối tác: bấm đồng ý của từng người đã đủ chưa, hay cần thỏa thuận cấp đối tác? Đồng ý có phải căn cứ phù hợp cho chat hỗ trợ không? | L | Sản phẩm ghi lại từng lần bấm (đồng ý / từ chối / rút lại). Chưa đồng ý hoặc đồng ý cũ sẽ chặn xử lý chat (an toàn mặc định) | Hồ sơ `vn_pdpl`; tăng phiên bản sau mỗi thay đổi |
| B-5 | **Dữ liệu nhạy cảm / đặc biệt.** Đối tác trao đổi về tài khoản ngân hàng đối soát và mã số thuế trong chat. Số thẻ, email, điện thoại, địa chỉ được che trước khi tới AI; số tài khoản ngân hàng và mã số thuế **chưa** được che riêng | L, A | Quyết định có mở rộng việc che (A) hay hạn chế chủ đề | `pii-scrub.util.ts` |
| B-6 | **Chuyển dữ liệu ra nước ngoài.** Anthropic và Voyage xử lý tại Hoa Kỳ. Có cần hồ sơ đánh giá tác động chuyển dữ liệu không, ai nộp và khi nào, có phải thông báo cho cơ quan có thẩm quyền không, có cần điều khoản hợp đồng chuẩn không? Hay đổi nhà cung cấp/khu vực? Lưu ý: tính năng **dịch / tóm tắt** do nhân viên bấm sẽ gửi văn bản chat **chưa che** cho AI (khoảng trống trong AI-DPIA-GATE.md §1.1) | L, A | Thông báo nêu nơi xử lý AI (`{{region}}`) và việc dữ liệu có thể được chuyển ra nước ngoài. Giữ `AI_PROCESSING_REGION` đúng với thực tế | `AI_PROCESSING_REGION`; DPA trong PROCESSOR-REGISTER.md |
| B-7 | **Hồ sơ đánh giá tác động** (xử lý và chuyển dữ liệu) — ai soạn, Amoeba phải cung cấp gì | L, A | AI-DPIA-GATE.md và PROCESSOR-REGISTER.md là đầu vào, không phải hồ sơ | — |
| B-8 | **Thời hạn lưu.** Nhật ký hội thoại (`CONVERSATION_LOG_RETENTION_DAYS`; hồ sơ staging đang nháp **180**), khách hàng (`CUSTOMER_RETENTION_DAYS`), nhật ký kiểm toán (`AUDIT_LOG_RETENTION_DAYS`) | L, G | Thông báo tự động trích đúng thời hạn hội thoại. Hai cơ chế xóa tùy chọn còn **tắt** cho đến khi bạn chọn. Xóa nhật ký kiểm toán cũng xóa bằng chứng đồng ý cũ hơn thời hạn | `.env` (xem `CONFIG.md`) |
| B-9 | **Quy trình xử lý yêu cầu của chủ thể dữ liệu.** Thời hạn phản hồi theo luật; cách xác minh danh tính người yêu cầu (công cụ không làm được); ai được thực hiện (chỉ master / director); ghi gì (trường `reference`) | L, G | Công cụ xuất / xóa theo mã khách hàng; xóa là không thể hoàn tác và đưa danh tính vào danh sách chặn tái tạo | Console › Cài đặt › Yêu cầu dữ liệu |
| B-10 | **Thông báo vi phạm.** Ai báo cho cơ quan, trong bao lâu (Nghị định quy định 72 giờ — cần xác nhận theo Luật 2025), đầu mối nào, mẫu nào | L | INCIDENT-RESPONSE.md §6 để mọi liên hệ ở dạng **〔지정 필요〕** (chưa chỉ định) | INCIDENT-RESPONSE.md |
| B-11 | **Câu chữ thông báo và phiên bản.** Duyệt bản tiếng Anh và tiếng Việt; người bản ngữ rà soát; URL chính sách; khi nào thay đổi là "trọng yếu" (tăng phiên bản = mọi người dùng được hỏi lại) | L, G | Câu chữ là bản nháp. Ngôn ngữ ngoài vi/en đọc các dòng **tiếng Anh** | Console › Cài đặt › Thông báo quyền riêng tư |
| B-12 | **Hợp đồng với bên xử lý (DPA).** Anthropic, Voyage, nhà cung cấp SMTP, Slack, hạ tầng | L, A | Tất cả còn **TBD** trong sổ — kho mã không có bằng chứng | PROCESSOR-REGISTER.md |
| B-13 | **Vị trí đặt hạ tầng** của hệ thống Go2Joy (trong hay ngoài Việt Nam) | G | Quyết định bản thân CSDL có phải là chuyển dữ liệu ra nước ngoài không; staging đang ở Hàn Quốc | PROCESSOR-REGISTER.md dòng 11 |
| B-14 | **Phân tích và cookie.** GA4 tắt trừ khi trang nhúng truyền `ga4Id`. Thông báo `vn_pdpl` không nhắc tới phân tích | G | Nếu Go2Joy bật GA4, thông báo phải đổi | đoạn mã nhúng |
| B-15 | **Bằng chứng đồng ý.** Dấu vết cấp hệ thống (mã phiên, phiên bản, thời gian, không có định danh cá nhân) đã đủ chưa, hay phải gắn được với một người dùng cụ thể? Lưu bao lâu? | L | Hiện dấu vết cố ý không có PII; gắn với người dùng cần thiết kế thêm | `AUDIT_LOG_RETENTION_DAYS` |
| B-16 | **Hồ sơ hoạt động xử lý** và các sổ khác mà luật yêu cầu | L, G | Phần A chỉ là điểm xuất phát, chưa phải sổ đăng ký | — |

## C. Những việc sản phẩm không làm (để không ai ngộ nhận)

- **Không có cơ chế tạm giữ theo từng khách hàng.** Nếu đang có yêu cầu tạm giữ hoặc yêu cầu của cơ quan chức năng, hãy tắt (hoặc tăng) `CUSTOMER_RETENTION_DAYS` / `AUDIT_LOG_RETENTION_DAYS` **trước** lần chạy định kỳ kế tiếp (hằng ngày). Dữ liệu đã xóa không thể khôi phục.
- **Công cụ xử lý yêu cầu không xác minh người yêu cầu.** Nó là công cụ, không phải quy trình.
- **Tìm theo số điện thoại phải quét.** Số điện thoại được mã hóa và không có chỉ mục tìm kiếm, nên công cụ quét danh sách khách hàng của tổ chức (có giới hạn) và báo khi kết quả có thể chưa đầy đủ. Chỉ mục `phone_hash` là việc làm tiếp theo.
- **Xóa không đồng nghĩa với xóa bản ghi.** Dòng khách hàng còn lại dưới dạng bản ghi rỗng (lịch sử vẫn nối được); người đã bị xóa đăng nhập lại sẽ có bản ghi mới.
- **Các hồ sơ quyền riêng tư khác vẫn dùng văn bản đóng gói sẵn** (365 ngày, "Hoa Kỳ") — chỉ `vn_pdpl` được điền từ cấu hình triển khai. Hãy dùng `vn_pdpl` cho tenant Go2Joy.
