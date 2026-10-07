# PLN-261007 — Định tuyến theo vùng của khách sạn (Hotel Region Routing)

- Ngày: 2026-10-07 · Yêu cầu: "Routing based on the hotel's region" (Go2Joy): sau khi khách chọn loại hỗ trợ, xác định vùng của khách sạn và chuyển hội thoại cho đội CS hoặc SA của vùng đó. Bắc và Bắc Trung → đội Bắc; Nam và Nam Trung → đội Nam.
- Phạm vi: identify v2 (thêm tỉnh), cấu hình tenant, định tuyến cảnh báo, hàng chờ console. Không đổi giao diện widget của khách. Có 1 migration.
- Phụ thuộc: `feature/user-role-region` (vùng nhân viên), `feature/handoff-team-routing` (chọn đội), `feature/guest-login-gate-ui` (identify v2). Đây là giai đoạn B đã hứa trong `PLN-261007-User-Role-Region` §3.3.
- ⚠️ **File đính kèm định nghĩa vùng chưa tới tay tôi.** Bảng tỉnh → vùng trong PLN này chỉ là cấu trúc; nội dung lấy từ file đính kèm khi nhận, nhập qua console, không cần sửa mã.
- Trạng thái: **đề xuất, chờ duyệt** (gồm AS-IS/TO-BE, không tách REQ riêng).

## 1. Tóm tắt quyết định

| Câu hỏi | Quyết định đề xuất | Lý do |
|---|---|---|
| Hệ thống biết khách sạn ở tỉnh nào bằng cách nào? | Go2Joy gửi **mã/tên tỉnh trong identify v2, nằm trong chữ ký** | Go2Joy chưa triển khai identify v2 nên thêm một trường bây giờ gần như không tốn; tránh dựng và đồng bộ danh mục 5.500 khách sạn |
| Ai sở hữu bảng tỉnh → vùng? | **Chúng ta**, lưu trong cấu hình tenant, sửa được ở Tenant Settings | Go2Joy đổi ranh giới vùng hoặc tên tỉnh (sáp nhập 2025) không cần phát hành lại |
| Vùng khách sạn và vùng nhân viên khác nhau thế nào? | Khách sạn có 4 loại (Bắc, Bắc Trung, Nam Trung, Nam); mỗi loại thuộc 1 **đội** `north` hoặc `south`. Nhân viên giữ 2 giá trị `users.region` | Không cần đổi cột nhân viên; thêm vùng thứ ba sau này chỉ là thêm dòng cấu hình |
| Chọn người thế nào? | Cùng nhãn vai trò **và** cùng vùng, online, ít tải nhất. Không có thì người **toàn quốc** (vùng trống) cùng nhãn. Không có nữa thì **broadcast**, kèm badge vùng | Giữ nguyên nguyên tắc "không bao giờ bỏ rơi hội thoại" của chọn đội |
| Khi không xác định được vùng? | Định tuyến theo nhãn như hiện nay, ghi `logger.warn` | Khách chưa đăng nhập, claims v1, tỉnh chưa có trong bảng |
| Áp cho những đường nào? | Cả chọn đội (nút/chip/gõ tay) và chuyển người tự động (độ tin cậy thấp, deny-list). Không có nhãn thì dùng `consult` | Yêu cầu "áp cho cả CS và SA"; tránh chuyển tay chỉ theo vai trò |
| Có ẩn hàng chờ của vùng khác không? | **Không**; chỉ badge vùng và bộ lọc | Quản lý cần hỗ trợ chéo vùng; ẩn cứng gây kẹt khi một đội vắng |
| Mặc định? | Tắt. Bật theo từng tenant | Tenant khác không đổi hành vi |

## 2. AS-IS

| Thành phần | Hiện có |
|---|---|
| Vùng nhân viên | `users.region` north \| south \| NULL (toàn quốc), sửa ở Users & Labels |
| Chọn đội | `handoff_config.teamRouting` → nhãn consult / sales_admin → `pickLabelAgent` |
| Claims khách sạn | `identity_claims`: hotelSn, role, hotelName, hotelCode. **Không có tỉnh hay vùng** |
| Chữ ký identify v2 | HMAC trên `userId\|hotelSn\|role\|iat` |
| Người nhận cảnh báo | Một người (online, ít tải nhất giữ nhãn) hoặc broadcast; hàng chờ mọi người thấy hết |
| Hàng chờ console | Lọc theo trạng thái, kênh, AI agent, khách sạn, đội. Chưa có vùng |

Khoảng trống: không biết tỉnh của khách sạn; `pickLabelAgent` không lọc vùng; hàng chờ không có vùng.

## 3. TO-BE

### 3.1 Dữ liệu tỉnh từ Go2Joy (identify v2)
- Thêm trường tùy chọn `province` vào claims (tên hoặc mã tỉnh của khách sạn, tối đa 64 ký tự).
- Chữ ký: không có `province` thì giữ nguyên `userId|hotelSn|role|iat`; có thì nối thêm `|province` (đúng chuỗi gửi đi). Vì chuỗi ký phụ thuộc việc có hay không có trường này, không thể gỡ hay thêm tỉnh mà vẫn giữ chữ ký hợp lệ.
- Lưu `identity_claims.province` (đã ký). Không cần cột mới: JSON có sẵn.
- Rủi ro cần nói rõ với Go2Joy: gửi `province` mà ký theo công thức cũ sẽ bị từ chối (E5048) và người dùng rơi về khách. Hai đầu phải đổi cùng lúc, hướng dẫn SDK sẽ ghi thật rõ.
- Phương án dự phòng nếu Go2Joy không gửi được tỉnh: nạp danh mục khách sạn → tỉnh bằng CSV (giai đoạn R3, không làm bây giờ).

### 3.2 Bảng tỉnh → vùng (cấu hình tenant)
`handoff_config.regionRouting`:
```ts
regionRouting?: {
  enabled: boolean;
  /** Đúng 4 loại theo file đính kèm; id cố định, tên hiển thị theo ngôn ngữ. */
  categories: Array<{
    id: 'north' | 'north_central' | 'south_central' | 'south';
    team: 'north' | 'south';          // đội phụ trách (USER_REGION)
    label?: LocalizedText;
    provinces: string[];              // tên hoặc mã; so khớp sau khi chuẩn hóa
  }>;
};
```
- Chuẩn hóa khi so khớp: chữ thường, bỏ dấu tiếng Việt (đ → d), bỏ dấu câu, bỏ tiền tố "tỉnh / thành phố / tp", gộp khoảng trắng. "TP. Hồ Chí Minh", "Ho Chi Minh" và "hồ chí minh" cùng một khóa.
- Hàm thuần `resolveHotelRegion(config, province)` đặt ở `packages/types/src/common/region.ts` (web import sâu như `language.ts`) để console có ô "thử một tỉnh" dùng đúng logic của máy chủ.
- Danh sách tỉnh có thể chứa cả tên trước và sau đợt sáp nhập tỉnh năm 2025; khi nhận file đính kèm sẽ đối chiếu xem Go2Joy dùng cách nào.

### 3.3 Định tuyến
1. Sau khi khách chọn loại hỗ trợ (hoặc khi chuyển người tự động), `HandoffRouterService.regionOf(tenantId, claims)` trả `{category, team}` hoặc null.
2. Sự kiện escalation mang `supportRegion` (team) và `regionLabel` (ví dụ "North · Bắc Trung"). Hội thoại ghi `conversations.support_region` để hàng chờ badge và lọc.
3. `AgentAlertService.pickLabelAgent(tenantId, label, region)` đi theo thang:
   a. online, nhãn đúng, `users.region = region`, dưới `maxConcurrent`, ít tải nhất;
   b. online, nhãn đúng, `users.region IS NULL` (toàn quốc);
   c. không có ai: bỏ qua nhắm người, sang cấu hình assignee, rồi broadcast (hành vi cũ).
4. Tóm tắt cảnh báo (Slack, email) thêm dòng `Region:` bên cạnh `Team:` và `Partner:`.
5. Không có `regionRouting` hoặc không xác định được vùng: bước 3 chạy y như cũ.

### 3.4 Console
- Tenant Settings › Agent handoff: khối "Định tuyến theo vùng khách sạn": bật/tắt, 4 hàng (loại, đội phụ trách, danh sách tỉnh), ô thử một tỉnh. Lưu có toast.
- Live Chat: badge vùng cạnh badge đội trên hàng chờ và header; bộ lọc "Vùng" (Tất cả / Bắc / Nam / Chưa xác định); dòng đối tác hiển thị tỉnh.
- Users & Labels: không đổi (đã có cột vùng).

### 3.5 Schema
`ALTER TABLE conversations ADD support_region varchar(8) NULL AFTER support_type;` — `sql/261007-conversation-support-region.sql`, `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv`.

## 4. Thay đổi kỹ thuật

| # | Việc | Tệp |
|---|---|---|
| T1 | SQL cột `support_region` + init schema + manifest | `sql/261007-conversation-support-region.sql`, `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv` |
| T2 | `REGION_CATEGORY`, `normalizeProvince`, `resolveHotelRegion`; `IdentityClaims.province` | `packages/types/src/common/region.ts`, `enum.types.ts` |
| T3 | `HandoffConfig.regionRouting`; `HandoffRouterService.regionOf` | `tenant-ai-config.entity.ts`, `handoff-router.service.ts` |
| T4 | identify: `province` trong DTO, `canonicalV2` có điều kiện, lưu vào claims | `embed.controller` DTO, `embed.service.ts` |
| T5 | `Conversation.supportRegion` (type tường minh, bài học A-1); stamp ở `handoff()` và `escalate()`; sự kiện mang `supportRegion` + `regionLabel` | `conversation.entity.ts`, `chat.service.ts` |
| T6 | `pickLabelAgent` có tham số vùng và thang 3 bậc; tóm tắt cảnh báo gom về một đối tượng ngữ cảnh thay cho 3 tham số rời | `agent-alert.service.ts` |
| T7 | `GET /agent/sessions?support_region=`; `supportRegion` ở hàng và chi tiết | `agent.service.ts`, `agent.mapper.ts`, `agent-console.controller.ts`, `agent.request.ts` |
| T8 | Console: khối cấu hình, badge, bộ lọc, dòng tỉnh trong PartnerContext | `HandoffSection.tsx`, `ai-settings.service.ts`, `LiveChatPage.tsx`, `PartnerContext.tsx`, `live-chat.*` |
| T9 | Widget và SDK: `province` đi qua `identify` | `sessionService.ts`, `useEmbedCommands.ts`, `packages/sharptalk-rn/src/index.tsx`, hướng dẫn `임베드SDK` §3.4 và Mobile SDK |
| T10 | i18n 6 ngôn ngữ (aiSetting, livechat) | `apps/web/src/i18n/locales/*` |
| T11 | Spec: chuẩn hóa tỉnh (dấu, tiền tố, tên cũ/mới), `resolveHotelRegion`, chữ ký có/không có tỉnh và bị giả mạo, thang chọn người, lọc `support_region`, escalate stamp vùng; TCR | — |

Không đổi: widget cho khách, chọn đội, deny-list, giờ làm việc, accept thủ công, vùng nhân viên.

## 5. Wireframe

**Tenant Settings › Agent handoff — khối mới**
```
┌ Định tuyến theo vùng khách sạn ────────────────────────────────────┐
│ [x] Chuyển hội thoại cho đội phụ trách vùng của khách sạn          │
│ ⓘ Cần Go2Joy gửi tỉnh của khách sạn khi đăng nhập vào trợ lý.      │
│                                                                     │
│  Loại vùng      │ Đội phụ trách │ Tỉnh / thành                      │
│  Bắc            │ [Bắc ▾]       │ [Hà Nội, Hải Phòng, …           ] │
│  Bắc Trung      │ [Bắc ▾]       │ [Thanh Hóa, Nghệ An, …          ] │
│  Nam Trung      │ [Nam ▾]       │ [Đà Nẵng, Khánh Hòa, …          ] │
│  Nam            │ [Nam ▾]       │ [TP. Hồ Chí Minh, Cần Thơ, …    ] │
│                                                                     │
│  Thử một tỉnh: [ho chi minh      ] → Nam · đội Nam                  │
│  ⚠ 2 tỉnh xuất hiện ở hơn một loại vùng (nếu có)                    │
│                                              [Lưu] → ✓ toast        │
└─────────────────────────────────────────────────────────────────────┘
```

**Live Chat › hàng chờ và header**
```
│ Lọc: [Kênh ▾] [AI ▾] [Khách sạn] [Đội ▾] [Vùng: Tất cả ▾]                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ ● a1b2c3  In Hotel Del Luna (1721) · Đà Nẵng   [Business][Nam]   WAITING 2m  │
│ ● d4e5f6  Khách sạn B (0412) · Hà Nội          [CS][Bắc]         WAITING 5m  │
│ ● g7h8i9  khách                                [CS]              WAITING 7m  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Header: Manager @ In Hotel Del Luna · 1721 · Đà Nẵng  ✔ signed               │
│         Đội: Business · Vùng: Nam (Nam Trung)                                │
```

## 6. Giai đoạn và ước lượng

| Giai đoạn | Nội dung | Ước lượng |
|---|---|---|
| R1 | T1–T11: tỉnh trong identify, bảng vùng, thang chọn người, hàng chờ, console | 1,5 ngày sau khi có file đính kèm và duyệt |
| R2 (nếu Go2Joy yêu cầu nghiêm) | Chế độ "chỉ báo đội vùng, không mở rộng": thêm `agent_alerts.target_region`, người toàn quốc và đội vùng thấy cảnh báo; sweep mở rộng sau X phút | 1 ngày |
| R3 (nếu Go2Joy không gửi được tỉnh) | Nạp CSV khách sạn → tỉnh, tra theo `hotelSn` | 1 ngày |

## 7. Side-impact và rủi ro

| Mục | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Tenant khác | Tắt mặc định, không đổi | Spec "tắt = hành vi cũ" |
| Chữ ký | Có điều kiện theo sự có mặt của `province`; Go2Joy gửi sai công thức thì bị từ chối | Hướng dẫn SDK ghi ví dụ ký có và không có tỉnh; log rõ lý do |
| Tên tỉnh trôi (sáp nhập, viết hoa, bỏ dấu) | Khách sạn rơi về "chưa xác định" | Chuẩn hóa mạnh, ô thử, log cảnh báo tỉnh không khớp để dán thêm vào bảng |
| Vùng sai | Cảnh báo đến nhầm đội; hàng chờ vẫn thấy hết nên quản lý chuyển được | Không ẩn cứng, badge vùng hiển thị rõ |
| Đội vùng vắng | Rơi về toàn quốc rồi broadcast; có thể không đúng ý "gán cho đội vùng" nếu Go2Joy muốn nghiêm | R2 |
| Hai tính năng cùng thêm dòng vào tóm tắt cảnh báo | Chữ ký hàm đang có 3 tham số rời | T6 gom vào một đối tượng ngữ cảnh, cập nhật spec |
| Migration | 1 cột NULL, additive | Áp SQL trước deploy (staging `DB_SYNCHRONIZE=false`) |
| Rebase | Nhánh đứng trên ba nhánh chưa merge | Làm sau khi chuỗi PR merge, hoặc dùng nhánh tích hợp làm gốc rồi rebase |

## 8. Câu hỏi cần Go2Joy / bạn xác nhận

| # | Câu hỏi | Đề xuất của tôi |
|---|---|---|
| 1 | File đính kèm: dán lại nội dung (bảng tỉnh theo 4 loại) | Cần trước khi bắt đầu R1 |
| 2 | Go2Joy gửi được `province` trong identify v2 (và ký) không? | Có; nếu không thì R3 |
| 3 | Danh sách tỉnh theo cách chia nào, trước hay sau sáp nhập tỉnh 2025? Họ gửi tên hay mã? | Nhận cả hai, bảng sửa được |
| 4 | Đội vùng không có ai online thì sao? | Mở rộng sang người toàn quốc rồi broadcast; nếu muốn nghiêm thì R2 |
| 5 | Hội thoại chưa xác định được vùng (khách chưa đăng nhập, v1) xử lý thế nào? | Theo nhãn như hiện nay |
| 6 | Ngoài giờ: một hộp thư chung hay một hộp thư mỗi vùng? | Chung; thêm theo vùng khi cần |
| 7 | Người toàn quốc (vùng trống) có được nhận thay cho cả hai vùng không? | Có, là bậc dự phòng thứ hai |
