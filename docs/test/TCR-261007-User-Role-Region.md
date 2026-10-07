# TCR-261007 — Vai trò (Role) và Khu vực (Region) cho tài khoản người dùng — giai đoạn A

- Ngày: 2026-10-07 · Căn cứ: `docs/plan/PLN-261007-User-Role-Region.md` (đã duyệt) · Nhánh: `feature/user-role-region` (từ `main` 52f0d21d)
- Phạm vi: T1–T9 giai đoạn A. Giai đoạn B (định tuyến theo vùng) chưa làm.

## 1. Đơn vị / kiểu
| # | Kiểm tra | Kết quả |
|---|---|---|
| U1 | `packages/common` jest (ma trận quyền + menu): 5 ca mới — SA thỏa CONVERSATION_HANDLE/ASSIGN/MODULE_CONSULT, không thỏa CAMPAIGN_SEND/MODULE_OPERATIONS; menu SA = consult + Customers/Orders, không mở Campaigns/Knowledge/Reviews; SA ⊇ consult; staff SA vẫn không thấy Customers (ma trận rank) | 2 suite / 64 PASS |
| U2 | `apps/api` jest `src/domain/user` (spec listUsers đổi sang query builder có filter) | PASS |
| U3 | `tsc --noEmit` api, web (map src) | PASS |
| U4 | `npm run i18n:check` sau khi thêm users 11 · aiSetting 1 · livechat 2 khóa ×6 ngôn ngữ | complete |
| U5 | `scripts/check-migrations.mjs --manifest` → `sql/artefacts.tsv` có `261007-user-role-region.sql users.region` | PASS |
| U6 | Thực boot API (dev stack, synchronize=true) sau khi thêm `User.region` (type tường minh, A-1) | `successfully started`; cột `region varchar(8) NULL` khớp SQL |

## 2. Trình duyệt (dev stack, seed master ivyusa, SQL 261007 áp trước lên DB dev)
| # | Thao tác | Kết quả |
|---|---|---|
| B1 | Users: bộ lọc "All roles" liệt kê 4 vai trò gồm 영업관리 (sales_admin); "All regions" có Nationwide/North/South | Đúng |
| B2 | Mời user: email test, rank staff, tick 영업관리, Region South → Send invite | Toast "User invited.", modal mật khẩu tạm; hàng mới: Roles 영업관리, Region South |
| B3 | Lọc Region = South → chỉ user test; = Nationwide → chỉ master; Role = sales_admin → chỉ user test (đếm hàng bảng bằng JS) | Lọc server-side đúng |
| B4 | Edit user test: Region → North → Save | Toast "User updated.", bảng hiện North |
| B5 | Dòng gợi ý "Không chọn vai trò = Khác" dưới danh sách vai trò | Hiển thị |

Dọn dữ liệu sau kiểm: xóa user test + nhãn + lời mời, bật lại `must_change_password` của seed master.

## 3. Phát hiện trong khi kiểm
- `INSERT job_labels … '영업관리'` chạy bằng `mysql < file` từ shell charset latin1 → lưu mojibake. Đã thêm `SET NAMES utf8mb4;` đầu file SQL; runbook staging phải chạy đúng file này (hoặc `--default-character-set=utf8mb4`).
- Ô filter của `Select` dùng `w-full`; bọc `div.w-48` để không kéo dài hết hàng.

## 4. Chưa kiểm
- Modal Phân công ở live chat hiện "tên · vai trò · vùng" (T7) — chỉ kiểm tsc, chưa chụp màn hình.
- Deny-list chọn nhãn `sales_admin` (T6) — chỉ kiểm tsc + i18n.
- Giai đoạn B (định tuyến theo vùng) — chờ Go2Joy trả lời quy tắc vùng.

## 5. Kịch bản staging (sau deploy)
1. Áp `sql/261007-user-role-region.sql` (1 cột + chèn nhãn cho mọi tenant) **trước** deploy code; kiểm `SHOW COLUMNS FROM users LIKE 'region'` và `SELECT tenant_id,name FROM job_labels WHERE code='sales_admin'` (tên phải là tiếng Hàn đúng, không mojibake).
2. Tenant go2joy: đổi tên hiển thị nhãn `consult` → "CS (Customer Service)", `sales_admin` → "SA (Sales Admin)" ở Users & Labels.
3. Mời 1 CS Bắc, 1 SA Nam; đăng nhập bằng SA: thấy Live chat, Lịch sử, Khách hàng, Đơn hàng; không thấy Campaigns/Knowledge.
4. Deny-list: quy tắc "hợp đồng/hoa hồng" → nhãn SA → hội thoại khớp được cảnh báo tới SA.
