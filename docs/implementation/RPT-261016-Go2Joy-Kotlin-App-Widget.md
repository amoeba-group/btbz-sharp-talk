# RPT-261016-Go2Joy-Kotlin-App-Widget

> Báo cáo triển khai `PLN-261015-Go2Joy-Kotlin-SDK-0.2` v1.1. Nhánh `feature/go2joy-kotlin-app-impl` (từ `main`
> `c676353b`, 2026-10-16). Kiểm thử: `docs/test/TCR-261016-Go2Joy-Kotlin-App-Widget.md`.

## Trạng thái triển khai

| Hạng mục | Trạng thái |
|---|---|
| PR | **chưa mở**, nhánh chưa push |
| Commit | `aab60de0` (S2+S3), `8415bfa9` (S9 backend), `62dc18f7` (S8+S9 console, widget), `8f27c23c` (sửa import), `5c041715` (SDK) |
| SQL `261016-tenant-mobile-app-config.sql` | **chưa áp** trên staging, production Hàn Quốc, Go2Joy. Áp **trước** khi deploy code (`DB_SYNCHRONIZE=false` trên staging) |
| Deploy | chưa deploy môi trường nào |
| Chạy thử | local, DB nháp `db_kimpl` |
| AAR 0.2.0 | **chưa build**, chưa kiểm trên thiết bị |

## Đã làm, theo PLN

| PLN | Nội dung | Tệp chính |
|---|---|---|
| S2 widget | `chrome=native|widget`; lệnh `settings`, `end`, `back` (trả `ivy:event back{handled}`), `context` (chip, điền sẵn ô trống một lần, gửi kèm tin kế tiếp); `logout` giữ agent/landing/access khi mở lại phiên khách | `apps/widget/src/{lib/host-bridge.ts,lib/host-context.ts,hooks/useEmbedCommands.ts,store/widgetStore.ts,components/chat/ChatTab.tsx,components/widget/WidgetPanel.tsx}`, i18n 6 ngôn ngữ |
| S3 API | `POST /chat/message` nhận `context{screen,ref,label}`; một dòng SYSTEM "Mở từ …" khi nơi mở đổi (so `screen+ref`); dòng SYSTEM không vào lịch sử cho model; prompt có `HOST_CONTEXT` ghi rõ không phải nguồn dữ kiện | `apps/api/src/domain/chat/{host-context.util.ts,chat.service.ts,rag.service.ts,dto/request/chat.request.ts}` |
| S9 backend | `packages/types` `normalizeMobileAppConfig`, `mergeAppSurface`; `GET/PATCH /tenants/mobile-app` (master, director); `GET /public/widget/app-config?shop=` (không cache); entry chỉ trỏ agent của tenant (`E5095`); audit; cột `tenants.mobile_app_config` | `packages/types/src/common/mobile-app-config.ts`, `apps/api/src/domain/tenant/{mobile-app-config.service.ts,dto/request/mobile-app.request.ts}`, `sql/261016-…sql`, `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql` |
| S8+S9 console | mục "Ứng dụng di động" trong Cài đặt widget: giao diện riêng app, bảng màn hình → agent, SDK tối thiểu, link simulator với shop và agent của tenant, khung điện thoại xem trước Web \| App nhận bản nháp chưa lưu | `apps/web/src/domain/settings/MobileAppSection.tsx` |
| S9 widget | trong app mode đọc app-config, `store.widgetTheme` = theme web + override; header: `?chrome=` của app luôn thắng, nếu không theo admin; lệnh `app-config` chỉ nhận khi `?appPreview=1` | `apps/widget/src/hooks/useAppSurface.ts` |
| S1+S4+S5 SDK | xem commit `5c041715` và `sdk/android/README.md`, `docs/guide/GUIDE-261016-Mobile-SDK-0.2.vi.md` | `sdk/android/**` |

## Khác với PLN

| PLN | Thực tế | Lý do |
|---|---|---|
| Tab riêng "Ứng dụng di động" trong Cài đặt tenant | **mục nằm trong tab Cài đặt widget** | Mỗi tab là một mã menu (`MenuCode`) có catalog và cấp quyền theo tenant; thêm tab kéo theo migration menu. Mục này dùng chung quyền `settings_widget` nên không cần cấp thêm |
| Card "Phiên bản SDK" có "widget đang chạy" và "app gần nhất báo về" | chỉ có "SDK tối thiểu" | Chưa có cơ chế app báo phiên bản về server; không hiển thị số giả |
| Nút "Gửi identify thử" trong preview | không có | Cần chữ ký HMAC với secret của tenant, secret không bao giờ xuống trình duyệt |
| `ShopTalkConfig.header` mặc định WIDGET | `header: ShopTalkHeader? = null` (null = để admin quyết định); `WIDGET` thêm `chrome=widget` | Để admin trên console quyết được header khi app không ép |
| Lưu context bằng cột/bảng mới | dòng SYSTEM + `retrieval_trace.hostContext` | Không SQL cho S3, như PLN |

## Việc còn lại trước khi giao Go2Joy

1. Build và kiểm AAR trên máy có Android SDK; TCR 14 hạng mục trên thiết bị (TCR-261016 §5).
2. Áp SQL lên staging, deploy, chạy golden set sau khi prompt có `HOST_CONTEXT`.
3. Chốt hợp đồng identify (Q1 trong REQ) và nhờ Go2Joy viết endpoint ký.
4. Chọn nguồn của `shop` (`https://www.go2joy.vn`) và `widgetUrl` cho app (staging hoặc self-hosted sau M3).
