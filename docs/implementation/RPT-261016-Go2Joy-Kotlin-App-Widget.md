# RPT-261016-Go2Joy-Kotlin-App-Widget

> Báo cáo triển khai `PLN-261015-Go2Joy-Kotlin-SDK-0.2` v1.1. Nhánh `feature/go2joy-kotlin-app-impl` (từ `main`
> `c676353b`, 2026-10-16). Kiểm thử: `docs/test/TCR-261016-Go2Joy-Kotlin-App-Widget.md`.

## Trạng thái triển khai

| Hạng mục | Trạng thái |
|---|---|
| PR | **chưa mở**, nhánh chưa push |
| Commit | `aab60de0` (S2+S3), `8415bfa9` (S9 backend), `62dc18f7` (S8+S9 console, widget), `8f27c23c` (sửa import), `5c041715` (SDK), `96894a79` (RPT/TCR), `8b997970` (build Gradle/AAR), `872be732`, `a0eea30b` (lỗi từ emulator), `99c68974` (minSdk 21, `@JvmOverloads`), `45766076` + `ae4b6861` (SDK tự đăng xuất khi đổi người dùng, chủ phiên chỉ ghi sau khi widget xác nhận), `7df8be61` (logout xóa tin cũ), `45ef864c` (chủ phiên trên luồng riêng, chip sau khi tạo lại, `onReady` một lần, màn lỗi theo màu app, WebView cũ), `9564c48e` (menu đúng ngôn ngữ, thẻ đánh giá), `e93a51ab` (E5095 sang E5150) và các commit tài liệu. và các commit về cách giao thư viện (thư mục Maven, mức tối thiểu, sửa hướng dẫn). Nhánh `feature/go2joy-kotlin-app-impl`, **chưa push**; main đã tiến thêm 3 commit (1 xung đột một dòng trong `ChatTab.tsx`) |
| SQL `261016-tenant-mobile-app-config.sql` | **chưa áp** trên staging, production Hàn Quốc, Go2Joy. Áp **trước** khi deploy code (`DB_SYNCHRONIZE=false` trên staging) |
| Deploy | chưa deploy môi trường nào |
| Chạy thử | local, DB nháp `db_kimpl` |
| Giao thư viện | `./gradlew deliveryZip` tạo `dist/shoptalk-android-0.2.0-maven.zip` (159.312 byte, SHA-256 `dd9e620e78a9f7f1…e3e9`, giống hệt qua các lần build vì zip không còn chứa `maven-metadata.xml`; thư mục Maven gồm AAR, POM, siêu dữ liệu Gradle, mã nguồn, checksum). AAR lõi 110.069 byte (`db33ac9c…`), AAR Compose 5.791 byte (`cf1e3c5c…`). POM khai báo mức tối thiểu của androidx và stdlib. Test SDK 72/72, lint 0 lỗi. Chạy lại toàn bộ với bản giao cuối trên emulator Android 5.0, 6.0 và 15 (13/13 mỗi máy), ma trận app khách (Android 5.0, 6.0, 15), compileSdk 33 và targetSdk 36 (TCR §12); **chưa chạy trên điện thoại thật** |

## Đã làm, theo PLN

| PLN | Nội dung | Tệp chính |
|---|---|---|
| S2 widget | `chrome=native|widget`; lệnh `settings`, `end`, `back` (trả `ivy:event back{handled}`), `context` (chip, điền sẵn ô trống một lần, gửi kèm tin kế tiếp); `logout` giữ agent/landing/access khi mở lại phiên khách | `apps/widget/src/{lib/host-bridge.ts,lib/host-context.ts,hooks/useEmbedCommands.ts,store/widgetStore.ts,components/chat/ChatTab.tsx,components/widget/WidgetPanel.tsx}`, i18n 6 ngôn ngữ |
| S3 API | `POST /chat/message` nhận `context{screen,ref,label}`; một dòng SYSTEM "Mở từ …" khi nơi mở đổi (so `screen+ref`); dòng SYSTEM không vào lịch sử cho model; prompt có `HOST_CONTEXT` ghi rõ không phải nguồn dữ kiện | `apps/api/src/domain/chat/{host-context.util.ts,chat.service.ts,rag.service.ts,dto/request/chat.request.ts}` |
| S9 backend | `packages/types` `normalizeMobileAppConfig`, `mergeAppSurface`; `GET/PATCH /tenants/mobile-app` (master, director); `GET /public/widget/app-config?shop=` (không cache); entry chỉ trỏ agent của tenant (`E5150`); audit; cột `tenants.mobile_app_config` | `packages/types/src/common/mobile-app-config.ts`, `apps/api/src/domain/tenant/{mobile-app-config.service.ts,dto/request/mobile-app.request.ts}`, `sql/261016-…sql`, `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql` |
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
| Mã lỗi agent lạ là `E5095` | **`E5150`** | `E5095` trùng với `REGION_ROUTING_INVALID` của `feature/go2joy-stage1-complete`; `E5150` trống trên mọi nhánh (khối kế tiếp sau E5145 đến E5149) |

## Việc còn lại trước khi giao Go2Joy

Việc tôi làm được trong repo đã xong. Còn lại là việc cần người quyết định hoặc cần môi trường thật:

1. **Đẩy nhánh và mở PR** (chưa làm, cần lệnh của anh). Dùng `git push -u origin feature/go2joy-kotlin-app-impl` (nhánh đang trỏ upstream `origin/main`, **không** dùng `git push` trần). Nội dung PR gợi ý ở cuối tài liệu.
2. **Áp SQL trước khi deploy**: `sql/261016-tenant-mobile-app-config.sql` lên staging (đang `DB_SYNCHRONIZE=false`), production Hàn Quốc và môi trường Go2Joy. Chưa áp ở đâu.
3. **Hợp nhất với `feature/go2joy-stage1-complete`** (TCR §10.6): 7 tệp xung đột cùng kiểu "cả hai bên cùng thêm"; E5150 đã tránh trùng mã. Thứ tự hợp nhất do anh quyết.
4. **Chốt hợp đồng nhận diện (Q1)** và nhờ Go2Joy viết endpoint ký. SDK truyền nguyên văn nên không bị chặn.
5. **Câu trả lời của Go2Joy** cho bộ câu hỏi `GUIDE-261018-Go2Joy-Android-Techstack-Questionnaire.vi.md` (Compose hay XML, Activity kế thừa lớp nào, minSdk, WebView mục tiêu).
6. **Màu và font thương hiệu thật** của Go2Joy (màu thử `#0EA5E9` là của tôi), và có giữ tab "Đơn hàng" trong app khách sạn hay không. Nội dung demo trong DB nháp vẫn là cửa hàng Mỹ.
7. **Điện thoại thật** (TCR §10.7): camera thật, TalkBack, máy có WebView cũ, Android 7 đến 14.
8. Golden set trên staging sau khi prompt có `HOST_CONTEXT`; chọn nguồn `widgetUrl` cho app (staging hoặc self-hosted sau M3).

## Nội dung PR gợi ý (chưa tạo PR)

**Tiêu đề:** `feat(go2joy): SDK Android 0.2.0 + widget app-mode + cấu hình "Ứng dụng di động" (PLN-261015)`

**Mô tả ngắn.** Nhúng widget SharpTalk vào app Android của Go2Joy: SDK Kotlin (AAR), widget ở chế độ app (header native hoặc widget, chip ngữ cảnh, lệnh `settings`/`end`/`back`/`context`),
cấu hình riêng cho app trong console (giao diện, màn hình tới agent, SDK tối thiểu, xem trước điện thoại), API nhận ngữ cảnh và ghi dòng "Mở từ …".
Kiểm thử: TCR-261016 (đặc biệt §10: ba mức Android, StrictMode, truy cập). Báo cáo: RPT-261016.

## Migration

- SQL: `sql/261016-tenant-mobile-app-config.sql` (thêm `tenants.mobile_app_config json NULL`; chạy lại báo `ERROR 1060 Duplicate column`, an toàn).
- Áp **trước** khi deploy code:
  - [ ] staging `shoptalk.amoeba.site`
  - [ ] production Hàn Quốc
  - [ ] Go2Joy
- Rollback: `ALTER TABLE tenants DROP COLUMN mobile_app_config;` (code cũ không đọc cột này; code mới chạy được khi cột còn nhưng rỗng).
- Mã lỗi mới: `E5150` (trống trên 51 nhánh).
- Không có hạ tầng mới. Thư viện giao bằng thư mục Maven `dist/shoptalk-android-0.2.0-maven.zip` (`./gradlew deliveryZip`; `sdk/android/dist/` không commit).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
