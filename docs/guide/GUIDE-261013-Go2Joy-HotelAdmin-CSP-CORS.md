# Hotel Admin ↔ SharpTalk widget: CSP, CORS and embed settings / CSP, CORS và cấu hình nhúng

| | |
|---|---|
| Document / Tài liệu | GUIDE-261013-Go2Joy-HotelAdmin-CSP-CORS |
| Date / Ngày | 2026-10-13 · PLN-261012 SG-82 |
| For / Dành cho | Go2Joy front-end owner of Hotel Admin / người phụ trách front-end Hotel Admin |
| Placeholders / Ký hiệu thay thế | `https://talk.example.vn` = where the SharpTalk widget is hosted · `https://admin.example.vn` = the Hotel Admin origin |

Every claim below was checked against the code (`apps/widget/public/embed.js`, `apps/widget/index.html`,
`apps/widget/src/lib/theme.ts`, `…/analytics/ga4.ts`, `apps/api/src/main.ts`, `docker/*/nginx.widget.conf`).
Nothing here was tested against Go2Joy's real CSP — **please run section 8 once on a staging copy.**
Mọi nội dung dưới đây đã được đối chiếu với mã nguồn; **chưa** thử với CSP thật của Go2Joy — hãy chạy mục 8 một lần trên bản staging.

---

## English

### 1. What the page loads, and what that means for the Hotel Admin policy

The loader (`embed.js`) is a plain script. It creates **one `<iframe>`** pointing at the widget host and makes
**one `fetch`** from your page. Everything else (chat UI, fonts, images, API calls, analytics) happens **inside the
iframe**, and a page's CSP does **not** apply to a cross-origin iframe's own subresources.

| Directive on the **Hotel Admin** page | Add | Why |
|---|---|---|
| `script-src` | `https://talk.example.vn` **and** a way to run the inline config (below) | The loader is `https://talk.example.vn/widget/v1/embed.js`. |
| `frame-src` (falls back to `child-src`, then `default-src`) | `https://talk.example.vn` | The widget iframe. |
| `connect-src` | `https://talk.example.vn` | The loader calls `GET /api/v1/public/widget/visibility` (the pilot / access check). The API base defaults to the loader's own origin + `/api/v1`; if you set `apiBase`, allow that origin instead. |
| `connect-src` | `'self'` **only if** the identity probe is on (section 3) | By default the probe now runs only on Shopify pages; on Hotel Admin it does not run. |
| `img-src`, `style-src`, `font-src`, `media-src` | **nothing** | The loader sets the frame's size with `element.style.*` (CSSOM, not blocked by `style-src`) and loads no image or font on your page. |
| `frame-ancestors`, `X-Frame-Options` | nothing | They govern who may frame **your** page, not the widget. |

Example addition (merge into your existing policy; do not replace it):

```
script-src    'self' 'nonce-{PER-RESPONSE-NONCE}' https://talk.example.vn;
frame-src     https://talk.example.vn;
connect-src   'self' https://talk.example.vn;
```

**The inline snippet.** The install snippet in the SharpTalk console is an inline `<script>` that sets
`window.SHARPTALK_WIDGET_CONFIG` (and, for the SDK, an inline `SharpTalk.init(…)` / `identify(…)`). A CSP without
`'unsafe-inline'` blocks it. Choose one:

1. put the same `nonce` on the inline script **and** on the loader tag:
   `<script nonce="…" src="https://talk.example.vn/widget/v1/embed.js" defer></script>`
   (with `'strict-dynamic'`, the source list is ignored and only the nonce counts); or
2. move the configuration into a same-origin file, e.g. `/assets/sharptalk-config.js`, and load it before the loader — `script-src 'self'` already covers it.

Use `…/widget/v1/embed.js`, the pinned path, not `…/widget/embed.js`.

### 2. What the iframe loads by itself (no action on the Hotel Admin page)

| Request (made by the iframe, from the widget origin) | When |
|---|---|
| `GET /api/v1/…` (session, chat, theme, logo) | Always. Same origin as the iframe unless `widget-config.js` sets another `apiBase` — then **that** origin must list the widget origin in `CORS_ORIGINS`. |
| `cdn.jsdelivr.net` (Pretendard stylesheet + font files) | Always **by default**. Can be removed — section 5. |
| `fonts.googleapis.com` / `fonts.gstatic.com` | Only if a tenant picks the *Inter* or *Noto Sans KR* font preset in the console (`theme.ts`). Do not pick them if the iframe must stay free of third-party requests; *Pretendard*, *System* and an uploaded font need none. |
| `www.googletagmanager.com` (gtag.js) | Only if a GA4 id reaches the iframe: `ga4Id` in the loader config (it becomes `?ga4=`), or a `VITE_GA4_MEASUREMENT_ID` baked into the build. Off otherwise. |

If you add a CSP **to the widget host**, it must allow those yourself; SharpTalk sends none beyond `frame-ancestors` (section 6).

### 3. Loader settings worth knowing (`SHARPTALK_WIDGET_CONFIG`)

| Key | Default | Use |
|---|---|---|
| `title` | `IVY USA Support` | Accessible name of the iframe (screen readers). Set `Go2Joy Support` / `Hỗ trợ Go2Joy`. Max 120 characters. Also accepted by `SharpTalk.init()`. |
| `identityProbe` | automatic | `false` = never call an identity endpoint. The default probe (`/apps/ivy/identity`, a **Shopify App Proxy** path) now runs only when `window.Shopify` exists or the host is `*.myshopify.com`; on Hotel Admin it was a guaranteed 404 on every page load, sent with cookies. `true` forces it. Read at script load: put it in `SHARPTALK_WIDGET_CONFIG`, not `init()`. |
| `identityPath` | — | The host's **own** "who is signed in" endpoint (same JSON: `{authenticated, sessionToken}`), e.g. `/api/whoami`. Hotel Admin does not need it: it signs the user on **its server** and calls `SharpTalk.identify({userId, hash, claims})`. |
| `proxyPath` | `/apps/ivy` | Unchanged — a custom Shopify App Proxy subpath. |
| `apiBase` | loader origin + `/api/v1` | Only for a split deployment. |
| `widgetUrl` | the loader's own address | Normally omitted. |

### 4. CORS on the SharpTalk API (`CORS_ORIGINS`)

The only call the browser makes **from your origin** to SharpTalk is `GET /api/v1/public/widget/visibility`
(a simple request — no preflight, no cookies). The browser needs `Access-Control-Allow-Origin` back, so the
**API's** env must list your origin:

```
CORS_ORIGINS=https://admin.example.vn,https://admin-staging.example.vn
```

- **Exact origins** — scheme + host (+ port if not 443/80), **no trailing slash, no path, no wildcard**. The list is passed as is to the CORS middleware, which compares strings: `*.example.vn` does not match anything.
- **Production with the variable empty sends no CORS headers at all.** Outside production an empty list reflects any origin (for local development).
- Without it the widget still appears (the loader fails open) but the browser cannot read the answer, so a pilot / access restriction decided server-side is not applied at page level — the API still enforces it on every session call.
- This is separate from the tenant's **embed-origin allowlist** (`PATCH /api/v1/tenants/embed-origins`, master/director; no console screen yet), which decides which parent origins a *session* is accepted from. It only logs a warning unless the API runs with `EMBED_ORIGIN_ENFORCE=true`. Add the Hotel Admin origin to both.

### 5. Fonts: make the iframe free of third-party requests

Pretendard v1.3.9 (the version the widget always linked) is **bundled** under `apps/widget/public/fonts/pretendard/`:
the four weights the widget uses (400/500/600/700, woff2) plus its SIL OFL licence. It was copied unmodified from a
`pretendard@1.3.9` package already present in a local `node_modules` — **nothing was downloaded**. The base stylesheet is
now `/widget/base-font.css` (same origin), whose content is chosen by an env var on the **widget container**:

| Env (widget container) | Meaning |
|---|---|
| `WIDGET_FONT_CSS_URL` | Unset = the default jsDelivr URL (unchanged behaviour). A path/URL = that stylesheet. **Empty** = no external font, system fonts only. Plain URL or path — no quotes, spaces or semicolons. |
| `WIDGET_FRAME_ANCESTORS` | Section 6. |

Switching to the bundled copy (no rebuild beyond the normal image build, since the files ship in every widget image):

1. Set `WIDGET_FONT_CSS_URL=/widget/fonts/pretendard/pretendard.css` on the widget container (already set in the Go2Joy profile example).
2. Restart the widget container.
3. Check in DevTools › Network that no request leaves for `cdn.jsdelivr.net` and that `/widget/fonts/pretendard/woff2/Pretendard-*.woff2` return 200.

The bundle adds about 3 MB to the widget image and is used only when selected. Keep `LICENSE.txt` next to the font files (OFL requires it).
To use a different font, put the stylesheet and its files anywhere under the widget's `public/` and point `WIDGET_FONT_CSS_URL` at it.

### 6. Who may frame the widget (`frame-ancestors`)

`docker/production` and `docker/self-hosted` widget images read `WIDGET_FRAME_ANCESTORS` — a space-separated list of origins:

```
WIDGET_FRAME_ANCESTORS=https://admin.example.vn https://admin-staging.example.vn
```

The widget host then answers its HTML with `Content-Security-Policy: frame-ancestors <list>`, and a browser refuses to render it inside any other site.
Blank (the default) sends no header: any page may embed it, as before. Add `'self'` only if you also open the widget URL directly in a tab. If a proxy or CDN in front of the widget adds its own CSP, it must carry the same `frame-ancestors` (browsers apply every policy they receive). `X-Frame-Options` is deliberately not used — it cannot express a list.

### 7. The iframe sandbox

`sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"`, `allow="clipboard-write"`.

- No top-level navigation: when the widget needs the page to go somewhere (sign-in, partner portal) it **asks the loader by `postMessage`**, and the loader only follows `http(s)` URLs that the widget's own origin sent.
- `allow-scripts` + `allow-same-origin` together are safe **only because the widget origin differs from the Hotel Admin origin**. Never host the widget on the Hotel Admin origin: a same-origin sandboxed frame can remove its own sandbox. A sibling sub-domain is enough.
- If Hotel Admin sends `Permissions-Policy: clipboard-write=()`, the widget's copy button stops working. Cross-origin isolation headers (`COEP: require-corp`) on the host were **not tested** and are likely to block the iframe unless the widget host also sends matching headers.
- The loader puts the page URL (≤ 300 characters), `document.referrer` and UTM parameters in the iframe URL for attribution. The server keeps only origin + path (no query string) and the nginx log format drops the query string.

### 8. Verify (10 minutes, staging)

1. Open Hotel Admin with the DevTools console: no `Refused to …` / `Content Security Policy` errors; the launcher appears.
2. Network: a `visibility?shop=…` request returns **200 with `Access-Control-Allow-Origin: https://admin.example.vn`**; **no** `/apps/ivy/identity` request.
3. `curl -sI https://talk.example.vn/widget/ | grep -i content-security-policy` → the `frame-ancestors` line you set (nothing if blank).
4. Open `https://talk.example.vn/widget/` from an unrelated page in an iframe → refused when `WIDGET_FRAME_ANCESTORS` is set.
5. Elements: `iframe#ivy-talktalk-frame` has your `title`.

---

## Tiếng Việt

### 1. Trang tải những gì và ý nghĩa với chính sách của Hotel Admin

Loader (`embed.js`) chỉ là một script thường. Nó tạo **một `<iframe>`** trỏ tới máy chủ widget và thực hiện **một lệnh
`fetch`** từ trang của bạn. Mọi thứ còn lại (giao diện chat, phông chữ, hình ảnh, gọi API, phân tích) diễn ra **bên trong
iframe**, và CSP của trang **không** áp dụng cho tài nguyên con của một iframe khác nguồn gốc.

| Chỉ thị trên trang **Hotel Admin** | Cần thêm | Lý do |
|---|---|---|
| `script-src` | `https://talk.example.vn` **và** cách chạy đoạn cấu hình inline (bên dưới) | Loader là `https://talk.example.vn/widget/v1/embed.js`. |
| `frame-src` (nếu không có thì dùng `child-src`, rồi `default-src`) | `https://talk.example.vn` | Iframe của widget. |
| `connect-src` | `https://talk.example.vn` | Loader gọi `GET /api/v1/public/widget/visibility` (kiểm tra pilot / quyền hiển thị). Gốc API mặc định là nguồn của loader + `/api/v1`; nếu đặt `apiBase` thì cho phép nguồn đó. |
| `connect-src` | `'self'` **chỉ khi** bật thăm dò danh tính (mục 3) | Mặc định thăm dò này chỉ chạy trên trang Shopify; trên Hotel Admin không chạy. |
| `img-src`, `style-src`, `font-src`, `media-src` | **không cần gì** | Loader chỉnh kích thước khung bằng `element.style.*` (CSSOM, `style-src` không chặn) và không tải hình hay phông nào trên trang của bạn. |
| `frame-ancestors`, `X-Frame-Options` | không cần gì | Hai chỉ thị này quy định ai được nhúng **trang của bạn**, không liên quan tới widget. |

Ví dụ bổ sung (gộp vào chính sách hiện có, không thay thế):

```
script-src    'self' 'nonce-{NONCE-MỖI-PHẢN-HỒI}' https://talk.example.vn;
frame-src     https://talk.example.vn;
connect-src   'self' https://talk.example.vn;
```

**Đoạn mã inline.** Đoạn cài đặt trong console SharpTalk là một `<script>` inline đặt `window.SHARPTALK_WIDGET_CONFIG`
(và với SDK còn có `SharpTalk.init(…)` / `identify(…)` inline). CSP không có `'unsafe-inline'` sẽ chặn nó. Chọn một cách:

1. gắn cùng một `nonce` cho script inline **và** cho thẻ loader:
   `<script nonce="…" src="https://talk.example.vn/widget/v1/embed.js" defer></script>`
   (nếu dùng `'strict-dynamic'`, danh sách nguồn bị bỏ qua và chỉ nonce có tác dụng); hoặc
2. chuyển cấu hình vào một tệp cùng nguồn gốc, ví dụ `/assets/sharptalk-config.js`, nạp trước loader — `script-src 'self'` đã bao gồm.

Hãy dùng đường dẫn cố định `…/widget/v1/embed.js`, không dùng `…/widget/embed.js`.

### 2. Những gì iframe tự tải (không cần thao tác trên trang Hotel Admin)

| Yêu cầu (do iframe gửi, từ nguồn của widget) | Khi nào |
|---|---|
| `GET /api/v1/…` (phiên, chat, giao diện, logo) | Luôn có. Cùng nguồn với iframe, trừ khi `widget-config.js` đặt `apiBase` khác — khi đó nguồn **đó** phải liệt kê nguồn của widget trong `CORS_ORIGINS`. |
| `cdn.jsdelivr.net` (stylesheet Pretendard + tệp phông) | Luôn có **theo mặc định**. Có thể bỏ — mục 5. |
| `fonts.googleapis.com` / `fonts.gstatic.com` | Chỉ khi một tenant chọn phông *Inter* hoặc *Noto Sans KR* trong console (`theme.ts`). Đừng chọn nếu iframe phải không có yêu cầu bên thứ ba; *Pretendard*, *System* và phông tải lên không cần gì. |
| `www.googletagmanager.com` (gtag.js) | Chỉ khi một mã GA4 tới được iframe: `ga4Id` trong cấu hình loader (thành `?ga4=`), hoặc `VITE_GA4_MEASUREMENT_ID` đóng sẵn khi build. Mặc định tắt. |

Nếu bạn thêm CSP **cho máy chủ widget**, hãy tự cho phép các nguồn trên; SharpTalk không gửi CSP nào ngoài `frame-ancestors` (mục 6).

### 3. Các thiết lập loader đáng biết (`SHARPTALK_WIDGET_CONFIG`)

| Khóa | Mặc định | Công dụng |
|---|---|---|
| `title` | `IVY USA Support` | Tên truy cập của iframe (trình đọc màn hình). Đặt `Go2Joy Support` / `Hỗ trợ Go2Joy`. Tối đa 120 ký tự. `SharpTalk.init()` cũng nhận. |
| `identityProbe` | tự động | `false` = không bao giờ gọi endpoint danh tính. Thăm dò mặc định (`/apps/ivy/identity`, đường dẫn **Shopify App Proxy**) nay chỉ chạy khi có `window.Shopify` hoặc host là `*.myshopify.com`; trên Hotel Admin nó luôn trả 404 ở mỗi lần tải trang và còn kèm cookie. `true` để ép chạy. Đọc lúc nạp script: đặt trong `SHARPTALK_WIDGET_CONFIG`, không phải `init()`. |
| `identityPath` | — | Endpoint "ai đang đăng nhập" **của riêng host** (cùng JSON: `{authenticated, sessionToken}`), ví dụ `/api/whoami`. Hotel Admin không cần: máy chủ **của bạn** ký người dùng rồi gọi `SharpTalk.identify({userId, hash, claims})`. |
| `proxyPath` | `/apps/ivy` | Không đổi — đường dẫn App Proxy Shopify tùy chỉnh. |
| `apiBase` | nguồn của loader + `/api/v1` | Chỉ cho triển khai tách riêng. |
| `widgetUrl` | địa chỉ của chính loader | Thường bỏ trống. |

### 4. CORS trên API SharpTalk (`CORS_ORIGINS`)

Lệnh duy nhất trình duyệt gửi **từ nguồn của bạn** tới SharpTalk là `GET /api/v1/public/widget/visibility`
(yêu cầu đơn giản — không preflight, không cookie). Trình duyệt cần nhận lại `Access-Control-Allow-Origin`, nên biến môi trường
của **API** phải liệt kê nguồn của bạn:

```
CORS_ORIGINS=https://admin.example.vn,https://admin-staging.example.vn
```

- **Nguồn chính xác** — scheme + host (+ cổng nếu không phải 443/80), **không dấu `/` cuối, không đường dẫn, không ký tự đại diện**. Danh sách được chuyển nguyên cho middleware CORS, vốn so sánh chuỗi: `*.example.vn` không khớp gì cả.
- **Production để trống thì không gửi header CORS nào.** Ngoài production, danh sách trống sẽ phản chiếu mọi nguồn (để phát triển cục bộ).
- Nếu thiếu, widget vẫn hiện (loader mặc định cho qua khi lỗi) nhưng trình duyệt không đọc được phản hồi, nên hạn chế pilot / quyền hiển thị do máy chủ quyết định không được áp dụng ở mức trang — API vẫn chặn ở mọi lời gọi tạo phiên.
- Việc này tách biệt với **danh sách nguồn được nhúng** của tenant (`PATCH /api/v1/tenants/embed-origins`, master/director; chưa có màn hình trong console), quyết định phiên được chấp nhận từ nguồn cha nào. Nó chỉ ghi cảnh báo trừ khi API chạy với `EMBED_ORIGIN_ENFORCE=true`. Hãy thêm nguồn Hotel Admin vào cả hai.

### 5. Phông chữ: để iframe không có yêu cầu bên thứ ba

Pretendard v1.3.9 (đúng phiên bản widget vẫn liên kết) đã được **đóng gói sẵn** trong `apps/widget/public/fonts/pretendard/`:
bốn độ đậm widget dùng (400/500/600/700, woff2) cùng giấy phép SIL OFL. Tệp được chép nguyên vẹn từ gói `pretendard@1.3.9`
có sẵn trong một `node_modules` cục bộ — **không tải gì từ Internet**. Stylesheet nền nay là `/widget/base-font.css`
(cùng nguồn gốc), nội dung do biến môi trường trên **container widget** quyết định:

| Biến (container widget) | Ý nghĩa |
|---|---|
| `WIDGET_FONT_CSS_URL` | Không đặt = URL jsDelivr mặc định (hành vi cũ). Đường dẫn/URL = stylesheet đó. **Rỗng** = không dùng phông ngoài, chỉ phông hệ thống. URL hoặc đường dẫn thuần — không dấu nháy, khoảng trắng hay dấu chấm phẩy. |
| `WIDGET_FRAME_ANCESTORS` | Mục 6. |

Chuyển sang bản đóng gói sẵn (không cần build thêm ngoài lần build image thông thường vì tệp đã nằm trong mọi image widget):

1. Đặt `WIDGET_FONT_CSS_URL=/widget/fonts/pretendard/pretendard.css` trên container widget (đã đặt sẵn trong ví dụ hồ sơ Go2Joy).
2. Khởi động lại container widget.
3. Kiểm tra trong DevTools › Network rằng không còn yêu cầu nào tới `cdn.jsdelivr.net` và `/widget/fonts/pretendard/woff2/Pretendard-*.woff2` trả 200.

Bản đóng gói tăng khoảng 3 MB cho image widget và chỉ được dùng khi chọn. Giữ `LICENSE.txt` cạnh các tệp phông (OFL yêu cầu).
Muốn dùng phông khác, đặt stylesheet và tệp của nó ở bất kỳ đâu dưới `public/` của widget rồi trỏ `WIDGET_FONT_CSS_URL` tới đó.

### 6. Ai được nhúng widget (`frame-ancestors`)

Image widget của `docker/production` và `docker/self-hosted` đọc `WIDGET_FRAME_ANCESTORS` — danh sách nguồn cách nhau bằng dấu cách:

```
WIDGET_FRAME_ANCESTORS=https://admin.example.vn https://admin-staging.example.vn
```

Khi đó máy chủ widget trả HTML kèm `Content-Security-Policy: frame-ancestors <danh sách>`, trình duyệt sẽ từ chối hiển thị widget trong trang khác.
Để trống (mặc định) thì không gửi header: trang nào cũng nhúng được như trước. Chỉ thêm `'self'` nếu bạn cũng mở trực tiếp URL widget trong một tab. Nếu proxy hoặc CDN phía trước widget tự thêm CSP, CSP đó phải mang cùng `frame-ancestors` (trình duyệt áp dụng mọi chính sách nhận được). Cố ý không dùng `X-Frame-Options` vì nó không diễn đạt được một danh sách.

### 7. Sandbox của iframe

`sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"`, `allow="clipboard-write"`.

- Không điều hướng cấp cao nhất: khi widget cần trang chuyển đi đâu đó (đăng nhập, cổng đối tác) nó **nhờ loader qua `postMessage`**, và loader chỉ theo các URL `http(s)` do chính nguồn của widget gửi.
- `allow-scripts` cùng `allow-same-origin` chỉ an toàn **vì nguồn của widget khác nguồn Hotel Admin**. Tuyệt đối không đặt widget trên cùng nguồn với Hotel Admin: khung sandbox cùng nguồn có thể tự gỡ sandbox. Một tên miền con ngang hàng là đủ.
- Nếu Hotel Admin gửi `Permissions-Policy: clipboard-write=()`, nút sao chép của widget sẽ không hoạt động. Header cách ly đa nguồn (`COEP: require-corp`) trên host **chưa được thử** và nhiều khả năng chặn iframe trừ khi máy chủ widget gửi header tương ứng.
- Loader đưa URL trang (≤ 300 ký tự), `document.referrer` và tham số UTM vào URL iframe để phân bổ nguồn. Máy chủ chỉ giữ nguồn + đường dẫn (không chuỗi truy vấn) và định dạng log nginx cũng bỏ chuỗi truy vấn.

### 8. Kiểm tra (10 phút, trên staging)

1. Mở Hotel Admin cùng console DevTools: không có lỗi `Refused to …` / `Content Security Policy`; nút mở widget hiện ra.
2. Network: yêu cầu `visibility?shop=…` trả **200 kèm `Access-Control-Allow-Origin: https://admin.example.vn`**; **không** có yêu cầu `/apps/ivy/identity`.
3. `curl -sI https://talk.example.vn/widget/ | grep -i content-security-policy` → dòng `frame-ancestors` bạn đã đặt (không có gì nếu để trống).
4. Mở `https://talk.example.vn/widget/` trong iframe từ một trang không liên quan → bị từ chối khi đã đặt `WIDGET_FRAME_ANCESTORS`.
5. Elements: `iframe#ivy-talktalk-frame` mang đúng `title` của bạn.
