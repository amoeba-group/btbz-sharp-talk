# FIX-260916 (B) — Token phiên widget dùng chung một khóa cho mọi tenant, API resume phiên của tenant khác

- **Phát hiện**: `AN-260907-SharpTalk-Go2Joy-Side-Impact.md` §2.1 ④ / §8 ("위젯 토큰이 shop별로 분리되지 않아 한 앱에서 테넌트를 바꾸면 이전 테넌트 세션이 재개된다"); xếp hạng #1 trong rà soát issue ngày 2026-09-16 vì tái hiện được ngay trong buổi demo Go2Joy. Người dùng chỉ đạo sửa cùng ngày.
- **Ảnh hưởng**: mọi deployment có ≥ 2 tenant dùng chung một origin widget (staging KR: ivyusa, go2joy, tpi…). Lượt mở widget **standalone hoặc app-mode** (URL `/widget/?shop=B&mode=app`, Kotlin SDK, trang mô phỏng, mở trực tiếp để demo) đọc token mà widget của tenant A đã lưu trong `localStorage` của origin đó, gửi kèm `shop_domain=B` — và API **resume phiên của tenant A**: KB, trợ lý, ngôn ngữ, lịch sử chat của A hiện ra dưới tên B. Widget **nhúng iframe** trên storefront không bị vì đã cố ý không đọc token lưu (`embedded → null`), nhưng vẫn *ghi* token vào khóa chung nên là nguồn "nhiễm" cho các lượt standalone.
- **Phạm vi**: 3 file mã + 1 spec mới; không schema, không env, không i18n, không đổi hợp đồng API.

## Tái hiện (test đỏ trước khi sửa)

`apps/api/src/domain/session/session.service.cross-tenant.spec.ts`: phiên `tok-40` thuộc tenant 4 (`app.go2joy.vn`), gọi `ensure('tok-40', 'en-US', 'ivyusa.myshopify.com')`.

```
Tests: 1 failed, 5 passed, 6 total
  ✕ mints a NEW session for the declared shop when the token belongs to another tenant
    Expected length: 1   (một phiên mới được lưu cho tenant 1)
    Received length: 0   (API trả lại phiên tenant 4)
```

## Nguyên nhân gốc (hai đầu)

1. **API** — `SessionService.ensure()` khi có `token` chỉ tìm `sessions.session_token` và trả về ngay nếu tồn tại; `shop_domain` chỉ được dùng ở nhánh *tạo mới*. Không có phép so `existing.tenantId` với tenant của shop được khai báo.
2. **Widget** — `lib/api-client.ts` lưu token dưới **một** khóa `ivy_session` cho toàn origin, trong khi origin widget là dùng chung cho mọi tenant. Lượt standalone của shop B vì thế đọc được token của shop A và gửi lên như của mình.

Cả hai cùng tồn tại mới gây lỗi: sửa một đầu là đủ chặn, sửa cả hai để không phụ thuộc phía client (token có thể bị gửi từ SDK cũ, từ URL, từ bookmark).

## Sửa (tối thiểu)

`apps/api/src/domain/session/session.service.ts`
- Thêm `belongsToShop(existing, shopDomain)`: nếu có `shop_domain` **và** shop đó ứng với một tenant **khác** `existing.tenantId` → ghi `warn` và **không resume**, rơi xuống nhánh tạo phiên mới cho tenant của shop (đúng đường cũ: `resolveTenant` → kiểm tra embed origin → tạo → sự kiện CJM). Ba trường hợp giữ nguyên hành vi cũ: không có shop, shop không khớp tenant nào, phiên legacy `tenant_id NULL`. Không thêm lỗi mới cho client.
- Chi phí: thêm 1 truy vấn `tenants` theo `shop_domain` cho mỗi `ensure` có token + shop (một lần mỗi lượt mở widget).

`apps/widget/src/lib/api-client.ts`
- Khóa lưu token theo shop: `ivy_session:<shop>` (`sessionStorageKey()`); không có shop → khóa cũ `ivy_session` (dev/standalone không shop, hành vi cũ).
- Đọc: khóa theo shop, **fallback** khóa cũ để khách đang chat lúc deploy không mất luồng (API đã tự chặn trường hợp fallback là token của tenant khác). Ghi: khóa theo shop, đồng thời **xóa khóa cũ**.
- `getShopDomain()` chuyển từ `hooks/useSession.ts` sang đây (tránh vòng import), `useSession.ts` re-export cho `lib/branding.ts`.

## Kiểm chứng
- `jest src/domain/session/`: **61/61** (5 suite, gồm spec mới 6 ca: khác tenant → phiên mới cho tenant của shop, cùng tenant → resume, không shop → resume, shop lạ → resume, phiên legacy → resume, token lạ → tạo mới).
- `tsc --noEmit` apps/api và apps/widget: pass. `node --test apps/widget/test/*.test.mjs` (embed loader, host bridge): 24/24 pass.
- Staging (sau deploy): mở `/widget/?shop=<ivyusa>` rồi `/widget/?shop=<go2joy>` cùng trình duyệt → hai phiên khác `session_token`, KB/trợ lý đúng tenant; log API có dòng `session token of tenant … presented for shop … — not resumed` đúng một lần cho lượt đầu (fallback khóa cũ), sau đó `localStorage` có hai khóa `ivy_session:<shop>`.

## Giới hạn còn lại
- Mobile/PWA dùng kho riêng (`ivy_session_token`, SecureStore/localStorage của app) nên không bị; app nhúng nhiều tenant qua **một** WebView vẫn dựa vào guard API (đúng vì `shop` đi trong `widgetUrl`).
- Phiên legacy `tenant_id NULL` vẫn resume — theo dữ liệu hiện tại không còn phiên như vậy được tạo mới.
- Không xóa token của tenant khác khỏi storage khi phát hiện (không biết tenant của token ở phía client) — chỉ để API từ chối.

## Mẫu phòng ngừa
- **Mọi thứ lưu ở origin dùng chung (localStorage, cookie, cache theme) phải có khóa theo tenant/shop.** `cacheTheme(getShopDomain(), …)` đã làm đúng từ PLN-260818; token phiên là chỗ bị bỏ quên. Khi thêm mục lưu mới ở widget, tìm `localStorage.setItem` và hỏi "khóa này có shop chưa".
- **Resume theo token phải tái xác nhận chủ thể đa tenant** (token là *ai*, không phải *của tenant nào*). Cùng nguyên tắc với `customerDisplayName()` đã scope theo tenant.
