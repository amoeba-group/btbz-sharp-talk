# REQ-261012 — Go2Joy Stage 1: đóng khoảng trống so với checklist tích hợp và củng cố phần đã có

- Ngày: 2026-10-12 · Người yêu cầu: dev@amoeba.group ("lên plan nhận định kỹ để implement luôn phần chưa có, và phần đã có muốn cải thiện")
- Nguồn: PDF *Go2Joy × SharpTalk 연동 체크리스트 및 일정표* (Oct 12, 2026) · `REQ-260831-SharpTalk-Go2Joy-Requirements` · báo cáo "Joydesk cho Go2Joy: tổng hợp cải tiến, trước và sau" (08/10) · mã nguồn nhánh `test/go2joy-integration` (`73ff8acf`, base `main` 9fd31630)
- Phương pháp: đọc PDF và báo cáo; khảo sát mã nguồn song song 5 mảng (hạ tầng AI và tra cứu dữ liệu · KB và cổng khách · danh tính và phiên · quyền riêng tư và triển khai · định tuyến). Bốn phát hiện nặng nhất (D-01, D-02, D-08, D-09) đã tự đọc lại trong code; các mục còn lại ghi nguồn là "khảo sát" và chưa kiểm lại từng dòng.
- Trạng thái: **REQ.** PLN đi kèm: `docs/plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md`. Chưa triển khai gì.

## 0. Tóm tắt

1. **Chín cải tiến hiện có đáp ứng tốt yêu cầu Go2Joy đã nêu thành ticket** (ISN-3785/3786/3852/3853/3855) nhưng **chưa đủ so với checklist Stage 1**: thiếu tra cứu dữ liệu thật (Gate 3), phân quyền theo vai trò, cách ly khi chuyển người dùng/khách sạn (Gate 4), cờ pilot theo khách sạn, tuân thủ PDPL, đóng gói chạy trên hạ tầng Go2Joy.
2. **Khảo sát tìm thêm 20 lỗi hoặc rủi ro trong phần đã làm** (mục 2.2). Ba nhóm cần xử lý trước khi người dùng Go2Joy thật dùng:
   - **Rò rỉ nội dung:** khách chưa đăng nhập có thể nhận tài liệu ngoài phạm vi công khai khi hỏi tiếp nối (D-01); phiên không tách khi đổi người hoặc khách sạn trên cùng trình duyệt, lễ tân dùng chung máy sẽ thấy lịch sử người trước (D-02, D-03).
   - **Định tuyến chưa thực sự chạy:** "đang rảnh" chỉ là một chuỗi do người dùng tự đặt, web không có chỗ nào ghi nó; định tuyến theo vùng hiện chỉ hiển thị nhãn (D-09). Bảng tỉnh mặc định rỗng (D-14).
   - **Quyền riêng tư:** lời đồng ý trong widget tiếng Việt vẫn viết theo CCPA, nêu Google Analytics, "365 ngày" và "Hoa Kỳ" cố định (D-17).
3. **Báo cáo đã gửi Go2Joy có một cam kết cần đính chính** (mục 2.3): "thông báo đi trước cho người đang rảnh có đúng vai trò".
4. **Quy mô:** tổng khoảng trống ≈ **133 người-ngày** (PLN §6, không gồm streaming), trong khi lịch PDF chỉ còn 2 tuần. PLN đề xuất đường cắt rõ ràng và các quyết định cần chốt với Go2Joy.

## 1. Yêu cầu nguồn

### 1.1 Cổng và đầu ra của Stage 1 (PDF)

| Gate | Hạn | Điều kiện | Bên làm |
|---|---|---|---|
| 1 | 10/14 | Phạm vi nghiệp vụ của agent + bản nháp yêu cầu API | A |
| 2 | 10/16 | SharpTalk chạy đúng trên trang login staging; trả lời khi chưa đăng nhập (tài khoản, FAQ cách dùng, nối CS); KB ban đầu; vi + theme Hotel Admin; mobile | A + G |
| 3 | 10/21 | SSO (phiên HA → token ký → cầu nối danh tính: user, vai trò, khách sạn); RBAC theo vai trò và khách sạn; công cụ tra cứu sản phẩm, chính sách; **trả lời bằng dữ liệu thật cho người đã đăng nhập**; OpenAPI cho API còn thiếu | A + G |
| 4 | 10/23 | UAT: cách ly dữ liệu theo vai trò và khách sạn, hết hạn token và đăng nhập lại; chất lượng (độ chính xác, tỉ lệ chuyển người, moderation); hiệu năng và bảo mật (thời gian, giả mạo token, che PII); cam kết R14–R16; tài liệu vận hành, đào tạo | A + G |
| 5 | 11/06 → 11/09 | Hạ tầng đơn tenant của Go2Joy; giám sát và cảnh báo; bật theo từng khách sạn bằng cờ; pilot 2 tuần; kế hoạch mở rộng | A + G (đề xuất) |

### 1.2 Yêu cầu chức năng, phi chức năng liên quan (REQ-260831)

FR-001 (vai trò và phạm vi khách sạn khi bắt đầu phiên) · FR-003 (chỉ trả lời khi có căn cứ) · FR-005 (không thực hiện thao tác không thể hoàn tác) · FR-007 (PII chỉ trong phiên đã xác thực, log che) · FR-010 (KB gắn phiên bản giao diện, ngày xác nhận; lệch thì nói rõ hoặc rút) · FR-012 (mỗi câu trả lời ghi agent và căn cứ) · FR-101, FR-107, FR-203, FR-204 (số liệu lấy từ hệ thống, LLM không tính tiền) · NFR-001 (P95 ≤ 2 s đầu / ≤ 6 s hoàn tất) · NFR-003 (nhận sai ngôn ngữ ≤ 1%) · NFR-004 (99,5%, suy giảm có kiểm soát) · NFR-005 (PDPD: che PII, thời hạn lưu, chuyển ra nước ngoài) · NFR-007 (ghi agent_id + evidence_id + tenant_id + actor_role) · NFR-008 (dấu tiếng Việt, kể cả font monospace) · NFR-009 (hồi quy rào chắn) · NFR-010 (từ chối có mã lý do).

### 1.3 Danh sách yêu cầu gửi Go2Joy (R1–R16) ảnh hưởng đến thiết kế

R7 (đặc tả xác thực) và R8 (danh sách API, đặc tả) quyết định mức tra cứu dữ liệu thật. R10 (phiên bản giao diện) quyết định trục phiên bản KB. R14 (khách sạn pilot), R15 (quy trình phát hành), R16 (xử lý dữ liệu cá nhân, thời hạn lưu, câu chữ PDPL) quyết định cờ pilot, runbook, thông báo quyền riêng tư. R5, R6 liên quan CSP/CORS và nơi đặt hạ tầng.

## 2. AS-IS

### 2.1 Phần đã có

| Khả năng | Hiện trạng trên `test/go2joy-integration` |
|---|---|
| Widget trên trang login, locale vi, theme | Có (`widget_theme`, locale vi, guide VN-Go2Joy staging) |
| Cầu nối danh tính | identify v2: `userId\|hotelSn\|role\|iat[\|province]` ký HMAC bằng secret của tenant, lệch giờ ±600 s; claims ở `sessions.identity_claims` và `customers.last_claims` |
| Cổng khách | `kb_categories.guest_visible` (nhị phân), `ai_agents.guest_policy`, ngưỡng `GUEST_GATE_CONFIDENCE` |
| Vai trò trong câu trả lời | Chỉ là một dòng trong prompt (`partnerContextOf`, chat.service.ts:197) |
| Tra cứu dữ liệu | Không có. Adapter LLM chỉ nhận văn bản, không có tool-calling (ai-adapter.interface.ts:2-29); AI chỉ truy xuất KB |
| Chuyển người | Hỏi đội CS/Business, vai trò và vùng của nhân viên, bảng tỉnh → vùng, chọn người theo thang online-nhãn-vùng |
| KB | Tài liệu cấp văn bản (không có bảng chunk); đã có `reviewed_at`, `reviewed_by`; không có phiên bản giao diện |
| Triển khai | Stack `docker/self-hosted`, VN profile, backup/restore DB + uploads |
| Quyền riêng tư | Hồ sơ `commerce\|lodging\|generic`, DSAR xuất/xoá cho phiên đã xác thực, thanh lọc theo thời hạn lưu toàn cục |

### 2.2 Lỗi và rủi ro trong phần đã có

Mức: **C** = nghiêm trọng (rò dữ liệu/sai cam kết), **H** = cao, **M** = trung bình. "Xác minh": ✔ = đã đọc lại trong code ở phiên này; ◐ = theo khảo sát.

| ID | Mô tả | Chứng cứ | Mức | Xác minh |
|---|---|---|---|---|
| D-01 | Lượt tìm "câu hiện tại" của câu hỏi tiếp nối không nhận `opts` nên không áp phạm vi khách: khách chưa đăng nhập có thể nhận tài liệu ngoài nhóm công khai | rag.service.ts:659 (lệnh `retrieveHybrid(..., scopeAgentId)` thiếu `opts`) | C | ✔ |
| D-02 | `identify` ghi đè `customerId` và `identityClaims` trên cùng phiên, không kiểm tra người hoặc khách sạn đã gắn trước. Người B (hoặc quản lý đổi khách sạn) kế thừa hội thoại, hàng chờ mở và đồng ý của A; lịch sử vào prompt | embed.service.ts:170-188; hội thoại gắn `session_id` (chat.service.ts:342-395) | C | ✔ |
| D-03 | Đăng xuất chỉ ở client: phiên cũ giữ claims và hội thoại mở. Phiên khách mới không kế thừa đồng ý (suy luận: tin đầu của khách báo "cần đồng ý"). `identify` lỗi trên phiên đã xác thực vẫn giữ ràng buộc cũ | useEmbedCommands.ts:49-53, 118-135 | H | ◐ |
| D-04 | Claims không bao giờ hết hạn: `verifiedAt` chỉ để hiển thị; phiên không có TTL | embed.service.ts:174-188; session.service.ts:148-168 | H | ◐ |
| D-05 | Không có nonce: một cặp (hash, iat) gán được cho nhiều token phiên trong 600 s; hash v1 có hiệu lực vĩnh viễn | embed.service.ts:85, 152-168 | H | ◐ |
| D-06 | Tái dùng câu trả lời không xét đối tượng: khoá theo tenant, ngôn ngữ, agent; bỏ qua duy nhất khi `guestGated`. Khi có bậc quyền hoặc dữ liệu theo khách sạn, câu trả lời của quản lý hoặc khách sạn A sẽ phát lại cho người khác | answer-reuse.service.ts:75-130; chat.service.ts:984; entity answer-reuse.entity.ts:23-38 | H | ◐ |
| D-07 | Yêu cầu xoá (DSAR) bỏ gỡ khách hàng nhưng để lại `identity_claims` | privacy.service.ts:618 | M | ◐ |
| D-08 | `escalate()` ngoài giờ lưu thông báo nhưng không đặt `replyChannel='email'` và không xin email; trả lời của nhân viên không được gửi mail, trình dọn idle đóng hội thoại | chat.service.ts:1470-1479 so với :1365; agent.service.ts:1255 | H | ✔ |
| D-09 | "Online" = `agent_profiles.status='online'` do `PUT /agent/profile` ghi, không có heartbeat và web không gọi endpoint này. Hai bậc đầu của thang chọn người hầu như không khớp: cảnh báo đi tới `assigneeUserIds[0]` hoặc phát chung. Định tuyến theo vùng chỉ là nhãn | agent-alert.service.ts:161-208, 197; không có `agent/profile` trong apps/web | C | ✔ |
| D-10 | Cảnh báo nhắm một người chỉ người đó thấy; không có đồng hồ hết hạn hay phát lại; trình dọn idle coi WAITING là đang mở: hội thoại chưa ai nhận bị hỏi "còn gì nữa không?" sau 30 phút và đóng sau 60 s | agent-alert.service.ts:215-224; idle-conversation.service.ts:172, 262 | H | ◐ |
| D-11 | Lọc nhân viên "bị khoá" dùng `!== 'inactive'` nhưng trạng thái thực là active/suspended; người bị đình chỉ vẫn đủ điều kiện. Chọn người luôn lấy hồ sơ đầu, tải không tính cảnh báo đang chờ | agent-alert.service.ts:180, 205 | M | ◐ |
| D-12 | Kênh Messenger gọi `escalate()` không có đội: khi bật hỏi đội, trả về `choose:true` và không ai được báo | messenger-ingest.service.ts:219, 249 | M | ◐ |
| D-13 | Quyết định cổng khách chỉ có một dòng `logger.log` khi từ chối; không ghi vết khi cho qua; tin từ chối không có trace; không có `agent_id` hay vai trò trên tin nhắn; `moderation_logs` ghi lỗi bị nuốt và không có API đọc; thay đổi `guest_visible` không có audit | chat.service.ts:927-930; moderation.service.ts:223-240; kb-category.service.ts:285-293 | H | ◐ |
| D-14 | Bảng tỉnh mặc định rỗng, bộ khớp chỉ so khớp sau chuẩn hoá (chạy thử: khớp "TP.HCM", "Bà Rịa – Vũng Tàu"; **trượt** "Hanoi", "Sài Gòn", "HCMC", "TT Huế", "Ho Chi Minh City", "Ðà Nẵng" ký tự Ð cũ); tỉnh không xác định bị bỏ qua âm thầm | region.ts:72-121; HandoffSection.tsx:59-68; handoff-router.service.ts:121-124 | H | ◐ |
| D-15 | Qdrant không lọc theo nhóm: lấy `LEG_LIMIT=8` trước khi lọc phạm vi, tài liệu đúng phạm vi có thể bị chen khỏi 8 kết quả đầu và cổng từ chối quá tay | rag.service.ts:180, 386, 413-427 | M | ◐ |
| D-16 | Độ tin cậy có hai mode (0,2 hoặc kẹp trong 0,5–0,95); mọi `GUEST_GATE_CONFIDENCE` trong (0,2; 0,5] cho cùng kết quả. Với embedding giả (local) cổng không bao giờ đóng; môi trường local không có `VOYAGE_API_KEY` | rag.service.ts:816-839; chat.service.ts:63 | H | ◐ |
| D-17 | Lời đồng ý bản vi: "Theo CCPA", nêu Google Analytics, "365 ngày", "Hoa Kỳ" cố định; chỉ `ChatTab` dùng `{{region}}` nên banner và chân trang có thể mâu thuẫn. Không có nội dung riêng cho Việt Nam (chỉ trích Nghị định 13/2023, chưa có Luật Bảo vệ dữ liệu cá nhân 2025) | vi.ts:86, 95, 96; privacy-notice-copy.ts:20-131 | H | ◐ |
| D-18 | Cài mới self-hosted: `docker/init-sql/01-schema.sql` thiếu 6 migration (260920-sessions-access-stats, 260924-fulfillments-tracking-url, 260924-order-items-product-url, 261007-ai-engine-health, 261007-answer-footer, 261008-golden-graded); cột `answer_footer` làm cài mới lỗi 500. Kiểm migration bị bỏ qua lần cài đầu | deploy-self-hosted.sh:84-94 | H | ◐ |
| D-19 | Khi Voyage hoặc Qdrant lỗi, độ tin cậy 0,2 làm mọi lượt chuyển người dù fulltext trả lời được; không có timeout cho Anthropic hay Voyage trực tiếp; thông báo cho khách ("chưa tìm được câu trả lời chắc chắn") sai khi sự cố hạ tầng | rag.service.ts:493-509, 826-829; anthropic.adapter.ts:20-39 | H | ◐ |
| D-20 | Nhân viên đổi vùng khi hội thoại đang chờ: không xếp lại; "assign" chỉ đặt `agentId`, không đổi `support_type/support_region` và không báo người nhận; `handBack` giữ nhãn cũ; khách chọn nhầm đội không có đường chuyển; gọi `escalate` lần hai bị chặn bởi khử trùng cảnh báo | agent.service.ts:897-938, 1446; agent-alert.service.ts:93-100 | M | ◐ |

### 2.3 Cam kết cần đính chính trong báo cáo gửi Go2Joy

| Câu trong báo cáo | Thực tế |
|---|---|
| "Thông báo đi trước cho người đang rảnh có đúng vai trò." (mục 8) và thứ tự chọn người "đúng khu vực, đang rảnh" (mục 9) | Chưa đúng cho đến khi có SG-60 (D-09). Hiện tại cảnh báo đi tới người được đặt sẵn hoặc phát chung |
| "Chữ đậm" thuộc cải tiến 5 (ISN-3785) | Hiển thị do #630 trên `main`; nhánh này chỉ thêm quy tắc prompt |
| Mục 2 / bước tiếp theo coi cổng khách là sẵn sàng khi Go2Joy xác nhận đăng nhập | Cổng chưa kiểm với embedding thật (D-16) và có lỗ hổng D-01 |

## 3. TO-BE: danh sách yêu cầu

Ưu tiên theo PLN §2: **P0** chặn rủi ro trước khi người dùng thật dùng · **P1** cần để qua UAT (Gate 3/4) · **P2** cần trước pilot 10/26 · **P3** trong hoặc sau pilot.

### 3.1 Bảo mật danh tính và phiên

| ID | Yêu cầu | Xử lý | Ưu tiên |
|---|---|---|---|
| SG-01 | Mọi lượt truy xuất của câu hỏi tiếp nối áp cùng phạm vi khách/vai trò | D-01 | P0 |
| SG-02 | `identify` tạo **phiên mới** khi người hoặc khách sạn khác với ràng buộc hiện có; cho phép nâng cấp khách → người dùng trên cùng phiên; có `POST /public/embed/logout` thật; widget đặt lại toàn bộ khi đăng xuất hoặc `identify` lỗi; một hội thoại ứng với một (người, khách sạn, vai trò) | D-02, D-03 | P0 |
| SG-03 | Tuổi tối đa của claims (`IDENTITY_MAX_AGE`, mặc định 8 giờ, theo tenant): quá hạn coi là khách, trả E5049, widget phát `identity-expired` để Hotel Admin ký lại | D-04 | P1 |
| SG-04 | Chống phát lại: mỗi (hash, iat) chỉ gắn một token phiên; tuỳ chọn tenant từ chối identify v1 | D-05 | P1 |
| SG-05 | DSAR xoá luôn `identity_claims` | D-07 | P0 |
| SG-06 | Tái dùng câu trả lời có `audience_rank`; không tái dùng câu trả lời dùng dữ liệu theo khách sạn | D-06 | P0 (cùng SG-10) |

### 3.2 Phân quyền nội dung theo vai trò

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| SG-10 | Nhóm KB có bậc truy cập `public \| partner \| manager` (tương thích ngược `guest_visible`); truy xuất loại nhóm `manager` với mọi người gọi không phải quản lý (kể cả khách của agent `open`); lễ tân hỏi chủ đề của quản lý nhận câu "hãy hỏi tài khoản quản lý" cùng nút gặp nhân viên, ghi `ROLE_MANAGER_ONLY`; nút kịch bản có đối tượng `manager` được kiểm tại thời điểm bấm; ghi audit khi đổi bậc | P1 |
| SG-11 | Đổi vai trò trên cùng phiên bắt đầu hội thoại mới (đi cùng SG-02) | P1 |

### 3.3 Dữ liệu thật từ API Go2Joy (Gate 3)

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| SG-30 | Bản hợp đồng OpenAPI (v0) cho các API còn thiếu (chính sách, giá theo giờ/qua đêm/theo ngày, đặt phòng, đối soát), gửi Go2Joy xem xét (PDF Phase 3: "부족한 API 설계서 → G2J 리뷰") | P1 |
| SG-31 | Module `partner-data` chạy với **mock** theo hợp đồng: danh mục chủ đề cho phép, `hotelSn` lấy từ claims đã ký chứ không từ lời người dùng (tham số chứa mã khách sạn bị từ chối), danh sách vai trò được phép theo chủ đề, tối giản PII, kiểu `Money` số nguyên VND, bảng phân rã server tính, kiểm số trong câu trả lời so với khối dữ liệu, nhật ký tra cứu, bỏ tái dùng, bằng chứng tách khỏi `citations` | P1 (sau cờ tắt) |
| SG-32 | Client HTTP thật (khi có R8, R9) | P3 |
| SG-33 | Vòng tool-calling trong adapter LLM (pha 2) | P3 |

### 3.4 Phiên bản KB (FR-010)

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| SG-20 | `kb_documents.ui_version`; `tenant_ai_config.kb_version_policy {referenceVersion, onMismatch: caveat\|hide\|off}`; lệch phiên bản thêm một câu cố định đa ngôn ngữ sau kiểm duyệt; tài liệu chưa gắn phiên bản hiện cảnh báo "chưa gán" trong console; nhập/xuất CSV có cột; đổi phiên bản tham chiếu thì vô hiệu hoá tái dùng. Trục phiên bản phải chốt (CSV dùng v23.x, FR-010 dùng v0.4.1–v0.12.0) | P1 |

### 3.5 Cờ pilot theo khách sạn

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| SG-40 | Bảng `tenant_pilot_hotels` + công tắc theo tenant; kiểm tra có thẩm quyền ở chat và kịch bản bằng `hotelSn` đã ký; widget ẩn hoặc hiện thông báo cho khách sạn chưa thuộc pilot; thêm khách sạn có hiệu lực không cần đăng nhập lại; console quản lý (nhập danh sách, CSV); kèm audit | P2 |

### 3.6 Audit, quan sát, đo lường

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| SG-50 | `conversations.hotel_sn`, `actor_role`, `ai_agent_id`; enum `REFUSAL_REASON`; trace có lý do cho mọi từ chối (cổng khách, xác thực đơn hàng, đồng ý, pilot, moderation); `audit_logs` cho identify thành công/từ chối, tách phiên, đăng xuất; thử lại khi ghi `moderation_logs` lỗi | P1 |
| SG-51 | `decideGate()` dùng chung; trace cho cả lượt cho qua (chủ đề, độ tương đồng, nhóm khớp, nhà cung cấp vector, đối tượng; không ghi nội dung câu hỏi); mô phỏng "Thử với tư cách…" trong console; script hiệu chỉnh ngưỡng trên bộ câu hỏi có nhãn (cần Voyage + Qdrant thật); golden có cột đối tượng | P1 |
| SG-52 | `GET /analytics/pilot` (nhóm theo khách sạn, vai trò, ngày): hội thoại, tự xử lý, tỉ lệ chuyển theo lý do, độ tin cậy, không nguồn, moderation, CSAT, số khách sạn hoạt động so với danh sách pilot; xuất CSV hội thoại để chấm tay | P1 (tối thiểu), P2 (giao diện) |
| SG-53 | Đo từng lượt (thời gian phản hồi), bộ kiểm nhận diện ngôn ngữ ≥ 500 câu và cổng đánh giá; kiểm trực quan dấu tiếng Việt (ễ ợ ữ ặ ậ) trong font monospace | P2 |

### 3.7 Định tuyến

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| SG-60 | Hiện diện thật: công tắc "Trực" trong console, `last_seen` cập nhật cùng lần poll 10 s; online = trạng thái online **và** thấy trong 90 s | P0 |
| SG-61 | Bộ có sẵn tỉnh Việt Nam (63 tên cũ + 34 tên sau sáp nhập + biệt danh), nút "Nạp bộ có sẵn", sửa chuẩn hoá (Ð, hậu tố "city", ", Việt Nam", Hanoi/Sài Gòn/HCMC/TT Huế); tỉnh chưa ánh xạ hiện dòng "chưa ánh xạ: X" trong cảnh báo và danh sách | P0 |
| SG-62 | `escalate()` ngoài giờ: đặt `replyChannel='email'` và xin email như `handoff()`; trình dọn idle bỏ qua hội thoại WAITING chưa ai nhận | P0 |
| SG-63 | Quét cảnh báo chưa ai nhận: sau N phút mở rộng thành phát chung và đăng "CHƯA AI NHẬN" lên Slack | P1 |
| SG-64 | Hành động chuyển đội/vùng trên hội thoại có sẵn (cả CS bậc staff): cập nhật `support_type/region`, báo người nhận, audit, ghi chú trong luồng | P1 |
| SG-65 | Sửa nhỏ: `status==='active'`, tính cảnh báo đang chờ vào tải, tie-break, đóng dấu vùng lại hoặc xoá khi đổi, kiểm tra `regionRouting` phía server, Messenger không gọi hỏi đội | P0 |
| SG-66 | Đếm theo đội/vùng và tuổi từ lúc chuyển người trong hàng chờ; mặc định lọc "vùng của tôi" | P2 |
| SG-67 | Sau này: chế độ nghiêm (không vượt vùng; hộp thư và webhook riêng theo vùng; mở rộng theo thời gian), CSV khách sạn → tỉnh khi host không gửi tỉnh, giờ làm việc theo đội | P3 |

### 3.8 Tuân thủ PDPL

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| SG-70 | Hồ sơ `vn_pdpl` (vi, en): bên kiểm soát, loại dữ liệu, mục đích, người nhận (Anthropic, Voyage tại Hoa Kỳ, Notion/SMTP nếu dùng), chuyển ra nước ngoài, thời hạn lưu `{{retentionDays}}` và `{{region}}` nội suy phía server, quyền của chủ thể và liên hệ DPO; thời hạn lưu bao gồm customers và audit_logs; nhật ký bằng chứng đồng ý; công cụ DSAR phía vận hành; cập nhật DPIA, sổ nhà xử lý. **Câu chữ pháp lý do Go2Joy và luật sư xác nhận** (R16); bản vi cần người bản ngữ rà soát | P2 |

### 3.9 Hạ tầng và vận hành trên phía Go2Joy

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| SG-80 | Phân phối image (registry hoặc tệp tải kèm, tag, `npm ci`, base cố định); đồng bộ `init-sql`; gỡ mặc định Amoeba (domain widget, email cảnh báo, seed tenant ivyusa và tài khoản amoeba) | P2 |
| SG-81 | Runbook 13 mục (vai trò, egress, cài đặt, TLS/CSP, duyệt phát hành, rollback, backup, giám sát, sự cố 72 giờ, DSAR, quản lý khoá, quy trình hỗ trợ của Amoeba); backup mã hoá + xoay + lịch + Qdrant; giới hạn log | P2 |
| SG-82 | Tài liệu CSP/CORS một trang cho front-end Go2Joy (script-src, frame-src, connect-src; font jsDelivr trong iframe); `frame-ancestors` cho nginx widget; font cục bộ; tiêu đề iframe và thăm dò identity cấu hình được | P2 |
| SG-83 | `/metrics`, kênh cảnh báo webhook/email tổng quát (sự cố, lỗi engine không chỉ hết tín dụng, lỗi purge/backup; mặc định người nhận là Go2Joy), readiness (DB + Redis + Qdrant), theo dõi lỗi tương thích Sentry | P2 |
| SG-84 | Timeout, thử lại, ngắt mạch cho Anthropic và Voyage; khi vector hỏng vẫn dùng fulltext; thông báo sự cố tiếng Việt riêng (xác nhận sau + chuyển người) thay cho "chưa tìm được câu trả lời" | P2 |
| SG-85 | Chương vận hành tiếng Việt cho CS và SA (hỏi đội, bảng vùng, vai trò, cổng khách, bậc truy cập KB, chân trang), giờ làm việc, DSAR, bump đồng ý, đào tạo | P2 |

## 4. Đối chiếu checklist với yêu cầu

| Hạng mục PDF | Trạng thái hiện tại | Yêu cầu xử lý |
|---|---|---|
| Phase 2 — widget login, vi, theme, mobile | Có (mobile trên trang HA chưa kiểm) | — (kiểm khi có R3/R4) |
| Phase 2 — trả lời khi chưa đăng nhập | Cơ chế có, rò D-01, chưa kiểm với embedding thật | SG-01, SG-51 |
| Phase 2 — KB ban đầu | 25 chủ đề / 50 bài; K2–K5 trên staging chờ deploy | (vận hành, PLN §6) |
| Phase 3 — SSO | Có (identify v2) | SG-02, SG-03, SG-04 |
| Phase 3 — RBAC theo vai trò và khách sạn | Chỉ ngữ cảnh prompt | SG-10, SG-11, SG-31 |
| Phase 3 — OpenAPI cho API thiếu | Chưa | SG-30 |
| Phase 3 — công cụ tra cứu, Gate 3 | Chưa | SG-31, SG-32 |
| Phase 4 — cách ly, hết hạn token, đăng nhập lại | Không đủ cơ chế | SG-02, SG-03 + bộ kiểm thử |
| Phase 4 — chất lượng, hiệu năng, bảo mật | Có golden, moderation; không đo thời gian | SG-51, SG-52, SG-53 |
| Phase 4 — vận hành, đào tạo | Thiếu chương CS/SA | SG-85 |
| Phase 4 — R16 PDPL | Câu chữ CCPA/US | SG-70 |
| Phase 5 — hạ tầng đơn tenant | Có nền, thiếu giao hàng | SG-80, SG-81 |
| Phase 5 — giám sát, cảnh báo | Chưa | SG-83, SG-84 |
| Phase 5 — cờ theo khách sạn | Chưa | SG-40 |
| FR-010 phiên bản KB | Chưa | SG-20 |
| NFR-007, NFR-010 | Một phần | SG-50, SG-51 |

## 5. Luồng người dùng chính (TO-BE)

**5.1 Lễ tân dùng chung máy**

```
Máy quầy: Lễ tân A đăng nhập HA ──identify(A, KS 1721, receptionist)──▶ phiên S1
   A hỏi, bot trả lời. A đăng xuất HA ──logout()──▶ S1 xoá claims, kết thúc hội thoại AI
Lễ tân B đăng nhập ──identify(B, KS 1721)──▶ phiên S2 mới (S1 không kế thừa)
Quản lý M (nhiều KS) đổi KS 1721 → 2204 ──identify(M, KS 2204)──▶ phiên S3 mới, lịch sử KS 1721 không vào prompt
```

**5.2 Lễ tân hỏi chủ đề dành cho quản lý**

```
Lễ tân: "Đổi tài khoản ngân hàng nhận tiền thế nào?"
 Truy xuất: bỏ nhóm manager → độ tin cậy thấp
 Kiểm lại với đối tượng manager → có căn cứ
 Trả lời: "Nội dung này dành cho tài khoản Quản lý. Vui lòng nhờ quản lý của khách sạn, hoặc [Gặp nhân viên]"
 Ghi trace {reason: ROLE_MANAGER_ONLY, actorRole: receptionist}
```

**5.3 Khách sạn ngoài danh sách pilot**

```
embed.js trên HA tải ──ensure──▶ widget ẩn (khách) hoặc theo cấu hình
identify(KS 3307) ──▶ pilot.eligible=false ──▶ widget ẩn hoặc "Chưa áp dụng cho khách sạn của bạn"
Quản trị thêm KS 3307 vào danh sách ──▶ ≤ 60 s sau, lượt chat kế tiếp được phục vụ (không cần đăng nhập lại)
```

**5.4 Hỏi giá hoặc chính sách bằng dữ liệu thật (SG-31, sau cờ)**

```
Quản lý KS 1721: "Giá qua đêm cuối tuần phòng Deluxe?"
 classifyIntent → chủ đề "rates" (không có mã khách sạn trong tham số)
 partner-data: ctx={hotelSn:1721 (từ claims đã ký), role:manager} → API → khối PARTNER_DATA (VND số nguyên, phân rã tính phía server)
 LLM chỉ diễn đạt từ khối; kiểm số: mọi số tiền trong câu trả lời phải có trong khối, sai → hạ về "xác nhận sau" + chuyển người
 Không lưu vào kho tái dùng; bằng chứng ở trace.partnerEvidence
```

**5.5 Chuyển người theo đội và vùng với hiện diện thật**

```
Khách sạn Đà Nẵng bấm "Gặp nhân viên" → chọn "Hỗ trợ khách hàng" → vùng nam
 Thang chọn: CS đội nam đang trực (thấy ≤ 90 s) → CS toàn quốc đang trực → người được đặt sẵn → phát chung kèm nhãn vùng
 Không ai nhận sau N phút → phát chung + Slack "CHƯA AI NHẬN"
 Khách chọn nhầm đội → CS bấm "Chuyển sang Kinh doanh" → định tuyến lại, báo SA, ghi vào luồng
```

## 6. Ràng buộc và giả định

- **Lịch:** hôm nay 10/12, Gate 2 vào 10/16, UAT 10/22–23, pilot 10/26. Quy mô khoảng trống vượt xa 2 tuần (PLN §6); PLN đề xuất đường cắt.
- **Phụ thuộc Go2Joy:** R8/R9 (API và khoá) quyết định SG-32; R7 (xác thực) khẳng định cách ký identify; R10 chốt trục phiên bản KB; R16 chốt thời hạn lưu và câu chữ pháp lý; R14 chốt danh sách pilot; R6 chốt nơi đặt staging.
- **Staging chạy `DB_SYNCHRONIZE=false`:** mọi thay đổi schema cần SQL áp trước khi deploy; mỗi PR đổi schema có mục `## Migration`; dùng `npm run migrations:manifest`.
- **Quy tắc kỹ thuật bắt buộc:** hạ tầng LLM vẫn đi qua kiểm duyệt (FR-069); không tự dựng envelope phản hồi; mọi lưu/cập nhật có toast; mọi chuỗi có i18n 6 ngôn ngữ và `npm run i18n:check`; sau đổi entity phải boot thật.
- **Kiểm chứng giới hạn:** chưa có tài khoản Hotel Admin, chưa có `VOYAGE_API_KEY` trên local, tài khoản master dev đang buộc đổi mật khẩu (E1005) nên chưa chạy được smoke có xác thực. Nhiều kết luận ở mục 2.2 mang nhãn ◐.
- **Pháp lý:** câu chữ PDPL không do SharpTalk tự quyết; kho mã chỉ trích Nghị định 13/2023, cần luật sư xác nhận căn cứ pháp lý và quan hệ B2B với khách hoặc đồng ý.

## 7. Câu hỏi cần chốt

1. Pilot 10/26 có **bắt buộc dữ liệu thật** (Gate 3) không, hay mở bằng KB + ngữ cảnh đã ký rồi bổ sung API trong 2 tuần pilot (PDF đã nêu phương án này ở bảng rủi ro)?
2. Trục phiên bản KB: v23.x (CSV chính sách) hay v0.4.1–v0.12.0 (FR-010, R10)?
3. Mức độ chi tiết của bậc quyền: theo nhóm (đề xuất) hay theo từng tài liệu? Những chủ đề nào chỉ dành cho Quản lý (đối soát, đổi tài khoản ngân hàng, quyền nhân viên…)?
4. Khách sạn ngoài pilot: ẩn widget (đề xuất) hay hiện thông báo? Khách chưa đăng nhập có được thấy widget ở giai đoạn pilot không?
5. Hiện diện: công tắc "Trực" tự đặt cộng heartbeat (đề xuất), hay đồng bộ từ danh bạ nhân viên Go2Joy?
6. Thời hạn lưu hội thoại (R16): 180 ngày (hồ sơ VN đang đặt) hay giá trị luật sư xác nhận?
7. Ai viết và phê duyệt câu chữ vi của thông báo PDPL (bên kiểm soát, người liên hệ DPO)?
8. Phân phối bản cài trên hạ tầng Go2Joy: registry của Go2Joy, tệp image kèm checksum, hay build tại chỗ?
9. Đính chính báo cáo (mục 2.3): sửa rồi mới gửi, hay gửi kèm ghi chú?
