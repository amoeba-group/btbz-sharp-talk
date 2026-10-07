# PLN-261007 — Vai trò (Role) và Khu vực (Region) cho tài khoản người dùng

- Ngày: 2026-10-07 · Yêu cầu: "[Users & Labels] Add Role and Region Assignment for User Accounts" (Go2Joy)
- Phạm vi: console Users & Labels, API user, định tuyến chuyển người. Có 1 migration.
- Trạng thái: **đề xuất, chờ duyệt** (gồm luôn phần phân tích AS-IS/TO-BE để không tách REQ riêng).

## 1. Tóm tắt quyết định

| Câu hỏi | Quyết định đề xuất | Lý do |
|---|---|---|
| Role là khái niệm mới hay dùng Label có sẵn? | **Dùng Label có sẵn**, đổi tên hiển thị thành "Vai trò", thêm mã `sales_admin` | Label đã quyết định menu, định tuyến chuyển người, phân công. Tạo Role thứ hai sẽ có hai trường cùng nghĩa |
| CS, SA, Others ánh xạ thế nào? | CS = `consult` (có sẵn) · SA = `sales_admin` (mới) · Others = không chọn vai trò | Giữ `accounting`/`operations` cho tenant khác, go2joy ẩn bằng cách không gán |
| SA được quyền gì? | Như CS (live chat, lịch sử) **cộng** Khách hàng, Đơn hàng; nhận hội thoại được chuyển tới nhãn SA | SA hỗ trợ đối tác về hợp đồng/hoa hồng, cần nhìn khách hàng; vẫn là người trả lời chat |
| Region là gì về dữ liệu? | **1 cột mới** `users.region`: `north` / `south` / trống (= toàn quốc) | Nhu cầu nêu 2 vùng; một người phụ trách cả hai thì để trống. Không làm nhiều-chọn để bộ lọc và định tuyến đơn giản |
| Region dùng để làm gì? | Giai đoạn A: hiển thị + lọc. Giai đoạn B: định tuyến chuyển người ưu tiên nhân viên cùng vùng với khách sạn | Định tuyến cần biết vùng của khách sạn (từ `hotelCode`/tỉnh trong claims identify v2) — có sau khi Go2Joy ký claims (PLN-261001) |
| Rank có đổi không? | Không | Rank = mức quyền chung, đúng như yêu cầu |

## 2. AS-IS

| Khái niệm | Hiện có |
|---|---|
| Rank | master/director/manager/staff, gán ở màn hình mời/sửa |
| Label | `consult`/`accounting`/`operations`, mã cố định trong `packages/types`, tên hiển thị theo tenant (`job_labels`), gán nhiều nhãn ở cùng màn hình; dùng cho menu, cảnh báo chuyển người theo nhãn (`agent-alert.service`), quy tắc deny-list → nhãn (`handoff_config.denyRules[].label`) |
| Region | Không có |

## 3. TO-BE

### 3.1 Vai trò (Role)
- Thêm mã `sales_admin` vào `JOB_LABEL`, ma trận quyền (`packages/common/rbac`), seed nhãn cho tenant mới và chèn nhãn cho tenant hiện có (SQL).
- Tên hiển thị mặc định: `consult` → "CS (Customer Service)", `sales_admin` → "SA (Sales Admin)" (tenant sửa được trong Users & Labels như hiện nay).
- Màn hình mời/sửa: nhãn "Nhãn công việc" đổi thành "Vai trò"; chú thích "Không chọn = Khác (Others)".
- Deny-list và phân công: thêm `sales_admin` vào danh sách nhãn đích, để câu hỏi "hợp đồng/hoa hồng/đăng ký đối tác" chuyển thẳng tới SA.

### 3.2 Khu vực (Region)
- `users.region` varchar(8) NULL (`north` | `south`).
- Mời/sửa user: ô chọn Khu vực (Toàn quốc · Miền Bắc · Miền Nam).
- Bảng user: cột Khu vực + bộ lọc Khu vực và Vai trò.
- API: `POST /users/invite`, `PATCH /users/:id` nhận `region`; `GET /users?region=&label=`; response thêm `region`.
- Hồ sơ nhân viên trong live chat (modal Phân công): hiện vùng cạnh tên để người phân công chọn đúng.

### 3.3 Giai đoạn B — định tuyến theo vùng (sau khi có claims)
- Vùng của khách sạn: suy từ `identity_claims.hotelCode` (ví dụ tiền tố `HN_`/`HCM_`) hoặc danh sách tỉnh → vùng, cấu hình trong `handoff_config.regionRules` (tenant sửa được).
- Cảnh báo chuyển người và tự phân công: ưu tiên nhân viên có nhãn phù hợp **và** cùng vùng; không có ai → mở rộng toàn quốc (không bao giờ bỏ rơi hội thoại).
- Cần Go2Joy xác nhận quy tắc vùng.

## 4. Thay đổi kỹ thuật

| # | Việc | Tệp |
|---|---|---|
| T1 | SQL: `ALTER TABLE users ADD region varchar(8) NULL`; `INSERT job_labels (tenant_id, code, name)` `sales_admin` cho mọi tenant chưa có | `sql/261007-user-role-region.sql`, `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv` |
| T2 | `JOB_LABEL.SALES_ADMIN`, `USER_REGION` const + type | `packages/types/src/common/enum.types.ts` |
| T3 | Ma trận quyền: `sales_admin` = consult + customers + orders (đọc); menu-access tương ứng + spec | `packages/common/src/rbac/*` |
| T4 | Entity `User.region`; DTO invite/update `region` (`@IsIn`), list query `region`, `label`; mapper trả `region` | `apps/api/src/domain/user/*` |
| T5 | Seed nhãn tenant mới có `sales_admin`; tên mặc định CS/SA | `tenant.service.ts`, `seed.runner.ts` |
| T6 | Deny-list label select thêm SA; alert routing không đổi (đã theo nhãn) | `HandoffSection.tsx`, `agent-alert.service.ts` (chỉ danh sách mã hợp lệ) |
| T7 | Console Users: ô Vai trò (đổi tên), ô Khu vực, cột + bộ lọc; modal Phân công hiện vùng | `apps/web/src/domain/users/*`, `live-chat/LiveChatPage.tsx` |
| T8 | i18n 6 ngôn ngữ: users.json, livechat.json, aiSetting.json | — |
| T9 | Spec: ma trận quyền SA, DTO region, list filter, seed; TCR | — |

Không đổi: Rank, cơ chế đăng nhập, RBAC của master/director.

## 5. Wireframe

**Users & Labels › Mời / Sửa người dùng**
```
┌ Sửa người dùng ─────────────────────────────────────┐
│ Email        [cs.north@go2joy.vn        ]            │
│ Rank         [staff ▾]   (mức quyền chung)           │
│ Vai trò      ☑ CS (Customer Service)                 │
│              ☐ SA (Sales Admin)                      │
│              ☐ Accounting   ☐ Operations             │
│              ⓘ Không chọn = Khác (Others)            │
│ Khu vực      [Miền Bắc ▾]  (Toàn quốc / Bắc / Nam)   │
│ Trạng thái   [active ▾]                              │
│                                   [Hủy]  [Lưu] → ✓   │
└──────────────────────────────────────────────────────┘
```

**Users & Labels › Danh sách**
```
│ Lọc: [Vai trò: Tất cả ▾] [Khu vực: Tất cả ▾]  🔍 email                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Email                 │ Rank    │ Vai trò │ Khu vực   │ Trạng thái │          │
│ cs.north@go2joy.vn    │ staff   │ CS      │ Miền Bắc  │ active     │ [Sửa]    │
│ sa.south@go2joy.vn    │ manager │ SA      │ Miền Nam  │ active     │ [Sửa]    │
│ ops@go2joy.vn         │ director│ —       │ Toàn quốc │ active     │ [Sửa]    │
```

**Live chat › Phân công (giai đoạn A chỉ hiển thị vùng)**
```
│ Nhân viên: [Nguyễn B — CS · Miền Nam ▾]                                      │
│            [Trần C — SA · Miền Bắc    ]                                      │
```

## 6. Giai đoạn và ước lượng

| Giai đoạn | Nội dung | Ước lượng |
|---|---|---|
| A | T1–T9: vai trò SA + vùng hiển thị/lọc/phân công thủ công | 1,5 ngày |
| B | Định tuyến theo vùng (regionRules + ưu tiên cùng vùng) | 1 ngày, sau khi Go2Joy trả lời quy tắc vùng và claims v2 chạy |

## 7. Side-impact và rủi ro

| Mục | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Tenant khác (ivyusa) | Thấy thêm vai trò SA trong danh sách; không gán thì không đổi gì | Tên mặc định có thể sửa theo tenant |
| Ma trận quyền | Thêm 1 nhãn → thêm 1 cột trong spec ma trận; spec hiện có không đổi kết quả | Spec kiểm tra đủ tổ hợp |
| Migration | 1 cột NULL + insert nhãn: code cũ chạy được trên schema mới | Áp SQL trước deploy (staging `DB_SYNCHRONIZE=false`) |
| "Others" không có nhãn | Người không nhãn không nhận hội thoại chuyển người (như hiện nay) | Nêu rõ trong chú thích màn hình |

## 8. Câu hỏi cần Go2Joy xác nhận (không chặn giai đoạn A)
1. SA có trực tiếp trả lời chat không, hay chỉ xem và nhận ticket? (đề xuất: có trả lời)
2. Quy tắc vùng của khách sạn: theo tỉnh hay theo tiền tố mã khách sạn?
3. Có vùng thứ ba (Miền Trung) trong tương lai không? (cột đã để varchar, thêm giá trị không cần migration)
