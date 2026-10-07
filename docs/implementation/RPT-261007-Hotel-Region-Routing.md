# RPT-261007 — Định tuyến theo vùng của khách sạn (Hotel Region Routing), giai đoạn R1

- Ngày: 2026-10-07 · Kế hoạch: `docs/plan/PLN-261007-Hotel-Region-Routing.md` · Kiểm thử: `docs/test/TCR-261007-Hotel-Region-Routing.md`
- Nhánh: `feature/hotel-region-routing` (từ `test/go2joy-integration`) · PR: chưa mở · Phụ thuộc: `feature/user-role-region`, `feature/handoff-team-routing`, `feature/guest-login-gate-ui` phải merge trước; nhánh này mở PR sau cùng
- ⚠️ Chờ file đính kèm định nghĩa vùng của Go2Joy. Mã chạy được ngay; bảng tỉnh → vùng là cấu hình tenant, nhập qua console khi có file.

## 1. Đã làm
| Lớp | Thay đổi |
|---|---|
| Dữ liệu từ Go2Joy | identify v2 nhận `claims.province` (tùy chọn, tối đa 64 ký tự). Có thì chữ ký bao gồm nó (`userId\|hotelSn\|role\|iat\|province`), không có thì công thức cũ. Lưu trong `identity_claims.province` |
| Bảng vùng | `handoff_config.regionRouting { enabled, categories[4] }`: mỗi loại (Bắc, Bắc Trung, Nam Trung, Nam) có đội phụ trách `north`/`south` và danh sách tỉnh; sửa ở Tenant Settings. Tắt mặc định |
| So khớp tỉnh | `packages/types/src/common/region.ts`: chuẩn hóa tên (bỏ dấu, hoa thường, bỏ tiền tố hành chính), `resolveHotelRegion`, `duplicateProvinces`, `regionLabelOf`. Console và API dùng chung một hàm |
| Định tuyến | Khi hand-off (chọn đội hoặc tự động) `HandoffRouterService.regionOf` tra vùng từ claims **đã ký**; hội thoại ghi `support_region`; sự kiện mang `supportRegion` và `regionLabel`. `pickLabelAgent` có thang: online đúng nhãn + đúng vùng, rồi đúng nhãn + vùng trống (toàn quốc), rồi assignee cấu hình, rồi broadcast. Không bao giờ chọn nhân viên vùng kia. Có vùng mà không có nhãn thì dùng consult |
| Cảnh báo | Tóm tắt Slack và email thêm dòng `Region:`; thứ tự cố định Reason, Team, Region, Partner, preview. `summary()` nhận một đối tượng ngữ cảnh thay vì ba tham số rời |
| Hàng chờ | `GET /agent/sessions?support_region=north\|south\|none`; hàng và chi tiết trả `supportRegion` |
| Console | Khối "Route by the hotel's region" (bật/tắt, 4 hàng, ô thử tỉnh, cảnh báo tỉnh trùng); Live Chat có badge vùng, bộ lọc "Vùng", dòng tỉnh ở header |
| SDK và hướng dẫn | Widget, loader, RN SDK cho `province` đi qua; hướng dẫn Embed SDK §3.4 và Mobile SDK nêu quy tắc ký |
| Schema | `sql/261007-conversation-support-region.sql` (1 cột NULL), `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv` |
| i18n | aiSetting.handoff +18 khóa, livechat.region +6, partner.province ×6 ngôn ngữ; `i18n:check` complete |

## 2. Tệp
- Types: `packages/types/src/common/region.ts` (+spec), `enum.types.ts` (`IdentityClaims.province`), `index.ts`
- API: `embed/dto/request/embed.request.ts`, `embed/embed.controller.ts`, `embed/embed.service.ts` (+`embed.service.v2.spec.ts`), `ai-engine/entity/tenant-ai-config.entity.ts`, `ai-engine/handoff-router.service.ts` (+spec), `chat/chat.service.ts`, `chat/entity/conversation.entity.ts`, `chat/chat.service.region-routing.spec.ts` (mới), `agent/agent-alert.service.ts` (+spec), `agent/agent.service.ts`, `agent/agent.mapper.ts`, `agent/agent-console.controller.ts`, `agent/dto/request/agent.request.ts`, `agent/agent.service.listsessions.spec.ts`
- Widget/SDK: `apps/widget/src/services/sessionService.ts`, `apps/widget/public/embed.js` (chú thích), `packages/sharptalk-rn/src/index.tsx`
- Console: `ai-settings/HandoffSection.tsx`, `ai-settings/ai-settings.service.ts`, `live-chat/LiveChatPage.tsx`, `live-chat/live-chat.service.ts`, `live-chat/live-chat.hooks.ts`, `live-chat/PartnerContext.tsx`, `i18n/locales/*/{aiSetting,livechat}.json`
- SQL và docs: `sql/261007-conversation-support-region.sql`, `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql`, `docs/guide/임베드SDK설치가이드_Embed-SDK.ko.md`, `docs/guide/모바일SDK연동가이드_Mobile-SDK.ko.md`, PLN/TCR/RPT 261007 Hotel-Region-Routing

## 3. Kết quả kiểm
Xem TCR: spec mới 38 ca (types 11, identify 6, router 4, chat 5, alert 8 gồm thang vùng và dòng tóm tắt, hàng chờ 4), toàn bộ jest API 2217 pass với 3 suite lỗi nền giống main, tsc 3 app, i18n complete, boot thật, và 10 kịch bản live (cấu hình qua giao diện, thang chọn người ba bậc, tỉnh bị giả mạo, khách chưa đăng nhập, bộ lọc, badge, header).

## 4. Trạng thái deploy
| Môi trường | Code | Migration `261007-conversation-support-region.sql` |
|---|---|---|
| dev | nhánh, đã kiểm live | đã áp |
| staging | chưa (sau chuỗi PR) | chưa; áp sau `261007-conversation-support-type.sql`, trước deploy |
| production | chưa | chưa |

## 5. Còn lại
- Nhận file đính kèm của Go2Joy, nhập bảng tỉnh ở console (không cần sửa mã) và đối chiếu cách viết tên tỉnh, có sáp nhập 2025 hay không.
- Go2Joy cập nhật identify v2 để gửi và ký `province`. Khi chưa gửi, tính năng không có tác dụng và không gây lỗi.
- Câu hỏi mở cho Go2Joy: đội vùng không ai online thì mở rộng hay giữ nghiêm (R2), có cần hộp thư ngoài giờ theo vùng không, nếu không gửi được tỉnh thì nạp danh mục khách sạn bằng CSV (R3).
- Khi chuỗi PR đã vào main: rebase nhánh này lên main và mở PR cuối.
