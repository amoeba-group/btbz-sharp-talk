# Sổ tay vận hành SharpTalk trên hạ tầng của Go2Joy (single-tenant, self-hosted)

| | |
|---|---|
| Mã tài liệu | RUNBOOK-261013-Go2Joy-SelfHosted |
| Phiên bản | 1.0 (bản nháp để Go2Joy rà soát) · 2026-10-13 |
| Căn cứ | PLN-261012 SG-80, SG-81 · REQ-261012 §3.9 (D-18) |
| Đối tượng | Đội hạ tầng / vận hành của Go2Joy; đầu mối kỹ thuật của Amoeba |
| Ngôn ngữ | Tiếng Việt là bản chính. Bảng tóm tắt tiếng Anh ở ngay dưới đây. |
| Tài liệu liên quan | [Hướng dẫn CSP/CORS cho front-end Go2Joy](GUIDE-261013-Go2Joy-HotelAdmin-CSP-CORS.md) · [Giám sát và cảnh báo](GUIDE-261013-Observability-Alerting.md) · [Cài đặt nền (ko)](GUIDE-260913-SharpTalk-Basic-Setup.md) · [Hồ sơ VN-Go2Joy (ko)](GUIDE-260913-SharpTalk-VN-Go2Joy-Staging.md) · [Ứng phó sự cố (ko)](INCIDENT-RESPONSE.md) · [Đăng ký bên xử lý](PROCESSOR-REGISTER.md) |

> Mọi lệnh trong tài liệu này được viết cho **Linux + Docker Engine 24+ / Compose v2**, chạy từ thư mục của một bản phát hành (release bundle). Các câu lệnh và hành vi đã được đối chiếu với script trong kho mã; phần nào **chưa được chạy thật** được liệt kê ở Phụ lục B.

## Summary (English)

| # | Section | What it settles | Tool / where |
|---|---|---|---|
| 1 | Roles and data ownership | Go2Joy owns the host, the data and the keys; Amoeba ships releases and gets no standing access | this document |
| 2 | Egress allow-list | Runtime needs Anthropic, Voyage (+ optional integrations); npm/Docker Hub/GitHub are build-time only; the end-user browser loads fonts from jsDelivr / Google Fonts | section 2 |
| 3 | Image delivery | Release bundle: images as tar files, `SHA256SUMS`, `manifest.json`; no registry, no internet, no build on the host | `scripts/build-release-bundle.sh`, `deploy-self-hosted.sh --bundle` |
| 4 | First install | `gen-secrets` -> env outside the bundle -> `deploy --bundle` (init-sql + migration gate) -> replace seed accounts -> AI engine -> re-index | `deploy-self-hosted.sh` |
| 5 | TLS / CSP / CORS | TLS terminates outside the stack; CORS lists the exact Hotel Admin origin; console is not frameable by default | `provision-host.sh`, CSP guide |
| 6 | Release approval | Pre-backup, SQL first, then code, then smoke (boot log, container age, 401/404/502, golden gate) | checklist in section 6 |
| 7 | Rollback | Previous image tag; refuses when a non-reversible migration lies in between | `rollback-self-hosted.sh` |
| 8 | Backup and restore drill | Encrypted DB + uploads + Qdrant, rotation, schedule, quarterly drill with evidence | `backup-self-hosted.sh`, `restore-drill-self-hosted.sh`, `docker/self-hosted/ops/` |
| 9 | Monitoring and alerts | Liveness, container health, backup markers, credit alerts; link to the observability guide | section 9 |
| 10 | Incident handling | Availability and PII incidents; PDPD notification to A05 within 72 h (wording to be confirmed by counsel) | section 10 |
| 11 | DSAR and retention | Retention default is 365 days (not "forever"); backups outlive purges; keep an external DSAR register | section 11 |
| 12 | Key custody | `CRED_ENC_KEY` has no supported rotation procedure; consequences verified in code | section 12 |
| 13 | Amoeba support access | Time-boxed, ticketed, logged, revoked; no standing access | section 13 |

---

## 1. Vai trò và quyền sở hữu dữ liệu

### 1.1 Ai làm gì

| Vai trò | Thuộc bên nào | Trách nhiệm |
|---|---|---|
| Chủ hạ tầng (host owner) | Go2Joy — đội hạ tầng | Máy chủ, hệ điều hành, Docker, mạng, chứng chỉ TLS, sao lưu và nơi lưu bản sao lưu, lưu giữ khoá (mục 12) |
| Quản trị nền tảng (platform admin) | Go2Joy | Tài khoản `super_admin` trong console: tạo/sửa tenant, đăng ký AI engine. Tạo bằng `SEED_ADMIN_EMAIL` lần khởi động đầu |
| Tenant master / director | Go2Joy — trưởng nhóm CS | Quản lý người dùng, tri thức, cấu hình AI của tenant `go2joy` |
| DPO / pháp chế | Go2Joy | Quyết định về PDPD, thông báo sự cố cho A05, yêu cầu của chủ thể dữ liệu (DSAR) |
| Nhà cung cấp phần mềm | Amoeba | Cấp bản phát hành (bundle) kèm ghi chú migration; hỗ trợ theo quy trình ở mục 13. **Không có quyền truy cập thường trực** vào máy chủ, khoá hay bản sao lưu |
| Bên xử lý thứ ba | Anthropic, Voyage, … | Nhận nội dung hội thoại khi AI được bật (mục 2). Xem `PROCESSOR-REGISTER.md` |

Vai trò trong ứng dụng (từ `CLAUDE.md`): thứ hạng master / director / manager / staff nhân với nhãn consult / accounting / operations (ma trận quyền ở `@sharptalk/common/permission-matrix`); quản trị hệ thống `super_admin` / `admin`.

### 1.2 Dữ liệu nằm ở đâu

| Dữ liệu | Vị trí (volume Docker) | Ra khỏi hạ tầng Go2Joy? |
|---|---|---|
| Hội thoại, khách, cấu hình, nhật ký kiểm toán | `sharptalk_mysql_data` | Không |
| Tệp đính kèm, logo, tệp thiết kế widget, ảnh chụp cấu hình | `sharptalk_uploads` (`/data/uploads`) | Không |
| Chỉ mục vector (embedding) | `sharptalk_qdrant_data` | Không (chỉ vector) |
| Bộ nhớ đệm phiên | `sharptalk_redis_data` | Không |
| Hàng đợi sự kiện (tuỳ chọn) | `sharptalk_rabbitmq_data` | Không |
| Lời gọi AI sinh câu trả lời và embedding | Anthropic / Voyage | **Có — gồm nội dung hội thoại** |
| Tích hợp bạn bật (Notion, Haravan, hub AmoebaTalk…) | API của từng dịch vụ | Có, chỉ với tích hợp đó |

Câu cần đưa vào hợp đồng: **lưu trữ ở Go2Joy, xử lý AI ở bên ngoài**. `AI_PROCESSING_REGION` (hiện `US`) là vùng được nêu trong thông báo AI của widget.

---

## 2. Danh sách cho phép egress

Mặc định hãy chặn mọi kết nối ra ngoài, rồi mở đúng những mục dưới đây.

### 2.1 Từ máy chủ, lúc chạy (runtime)

| Đích | Khi nào cần | Ghi chú |
|---|---|---|
| `api.anthropic.com:443` | Khi dùng AI Anthropic | Khoá nhập trong console (lưu mã hoá) hoặc `ANTHROPIC_API_KEY` |
| `api.voyageai.com:443` | Khi dùng embedding (tìm kiếm tri thức) | `VOYAGE_API_KEY`; không có thì không có embedding, chỉ còn tìm kiếm toàn văn |
| `api.openai.com:443` | Chỉ khi cấu hình engine OpenAI | Tuỳ chọn |
| `api.notion.com:443` | Khi đồng bộ tri thức từ Notion | Tuỳ chọn |
| `oauth2.googleapis.com`, `www.googleapis.com` | Khi dùng nguồn Google Drive | Tuỳ chọn |
| `*.myharavan.com` | Khi bật Haravan | Tuỳ chọn |
| `api-talk.amoeba.site:443` | Khi dùng hub AmoebaTalk (Zalo, Line, WhatsApp) | Địa chỉ mặc định của adapter; do Amoeba vận hành |
| `messenger.amoeba.site:443` | Chỉ khi dùng kênh `btbz_relay` | Tuỳ chọn |
| Máy chủ SMTP của Go2Joy | Khi gửi email cảnh báo / trả lời ngoài giờ | `SMTP_HOST`, `SMTP_PORT` |
| URL Slack webhook | Khi dùng `SLACK_WEBHOOK_URL` | Tuỳ chọn |
| `exp.host` (Expo push); endpoint push của trình duyệt (ví dụ `fcm.googleapis.com`) | Khi bật push cho app / PWA | Tuỳ chọn |
| `acme-v02.api.letsencrypt.org` | Nếu cấp chứng chỉ bằng certbot trên chính máy này | Không cần nếu TLS do LB của Go2Joy xử lý |
| NTP, kho cập nhật hệ điều hành | Luôn | Hạ tầng thông thường |

### 2.2 Chỉ lúc build (không cần trên máy chủ chạy bundle)

Docker Hub, kho npm, GitHub. Một bundle đã chứa mọi image (kể cả MySQL, Redis, RabbitMQ, Qdrant, nginx), nên **máy chủ production không cần ra Internet để cài đặt hay nâng cấp**.

### 2.3 Từ trình duyệt của người dùng cuối

| Đích | Dùng cho |
|---|---|
| `cdn.jsdelivr.net` | Font Pretendard trong trang widget (`apps/widget/index.html`) và console |
| `fonts.googleapis.com`, `fonts.gstatic.com` | Các preset font Noto Sans KR / Inter của widget, nếu tenant chọn |

Hai nguồn này phải được CSP của trang Hotel Admin cho phép (xem hướng dẫn CSP/CORS). Việc đóng gói font cục bộ thuộc SG-82.

### 2.4 Chiều vào

Chỉ **443** ra Internet (TLS do bên ngoài stack kết thúc). Cổng `HTTP_PORT` (mặc định 8080) chỉ dành cho bộ phận TLS; MySQL chỉ mở ở `127.0.0.1:3306`; Redis, RabbitMQ, Qdrant chỉ trong mạng nội bộ Docker. Webhook của kênh nhắn tin cần địa chỉ công khai nếu bạn dùng kênh đó.

### 2.5 RabbitMQ là tuỳ chọn

Mã nguồn chỉ dùng RabbitMQ nếu `RABBITMQ_URL` được đặt và kết nối được; nếu không, API chạy bus sự kiện trong tiến trình (`event-bus.service.ts`). File compose vẫn khởi động nó. Nếu muốn bỏ, phải sửa compose (`depends_on` của `api`) và để trống `RABBITMQ_URL`. Chưa được kiểm chứng trong đợt này.

---

## 3. Phân phối image và checksum

### 3.1 Vì sao dùng bundle

Trước đây compose chỉ có `build:` với `npm install` và image nền thả nổi: hai lần build cùng một commit có thể khác nhau, máy chủ phải có Internet và 8 GB RAM để build, và không có tag nên không thể quay lại bản trước. Bây giờ:

* image nền được ghim phiên bản (`node:20.19.0-alpine3.21`, `nginx:1.27.5-alpine`; MySQL `8.0.44`, Redis `7.4.9`, RabbitMQ `3.13.7`, Qdrant `v1.15.1`). Không ghim digest, vì digest không thể kiểm chứng offline;
* Dockerfile dùng `npm ci` (đúng bản trong `package-lock.json`);
* image ứng dụng có tên và tag: `sharptalk/{api,web,widget}:<version>` và `:sha-<commit>`;
* build **một lần** trên máy build của Amoeba, đóng gói thành bundle.

### 3.2 Bundle gồm gì

```
sharptalk-<version>/
  VERSION  README.md  manifest.json  build.env  SHA256SUMS
  images/*.tar          api, web, widget + mysql, redis, rabbitmq, qdrant, nginx
  scripts/              deploy / rollback / backup / restore / restore-drill / check-migrations / gen-secrets
  sql/  release-order.txt  migrations.tsv     thay đổi schema theo THỨ TỰ PHÁT HÀNH, kèm phân loại
  docker/self-hosted/   compose, nginx.conf, mẫu env, ops/ (cron + systemd), Dockerfile
  docker/init-sql/      schema khởi tạo lần đầu
```

`manifest.json` ghi phiên bản, commit, checksum từng image, và danh sách migration với phân loại (`additive`, `additive-data`, `data`, `breaking`, `destructive`, `unknown`). Bundle được build với `VITE_API_BASE_URL=/api/v1` (đường dẫn tương đối cùng origin) nên **một bundle chạy sau bất kỳ tên miền nào**; nếu console và API ở hai origin khác nhau, Amoeba build bản riêng với `--api-base` tuyệt đối và script triển khai sẽ từ chối file env trỏ chỗ khác.

### 3.3 Nhận và kiểm tra

```bash
cd sharptalk-<version>
sha256sum -c SHA256SUMS          # mọi tệp phải báo OK
```

`deploy-self-hosted.sh --bundle` tự kiểm lại bước này và dừng nếu có tệp sai.

`SHA256SUMS` chứng minh tệp **không bị hỏng hoặc thiếu**, không chứng minh **ai gửi**. Vì vậy Amoeba gửi riêng, qua kênh khác (cuộc gọi, ticket có xác thực), giá trị `sha256sum SHA256SUMS`; Go2Joy so khớp trước khi cài. Ký số bundle (cosign / GPG) **chưa có** — xem việc còn lại.

### 3.4 Registry riêng (tuỳ chọn)

Nếu Go2Joy muốn dùng registry nội bộ: `docker load` các image, `docker tag` sang `<registry>/sharptalk/…`, đẩy lên, đặt `SHARPTALK_IMAGE_PREFIX=<registry>/sharptalk` trong env, rồi chạy `deploy-self-hosted.sh` ở chế độ bundle (hoặc `docker compose … up -d --no-build`). Không bắt buộc.

---

## 4. Cài đặt lần đầu

### 4.1 Chuẩn bị máy chủ

Linux x86-64, 4 vCPU / 8 GB RAM / 80 GB SSD trở lên (UAT) hoặc 8 / 16 / 200 GB (production); Docker Engine 24+ và Compose v2; giờ hệ thống UTC; đặt trong vùng Việt Nam nếu cần cư trú dữ liệu. Có thể dùng `sudo bash scripts/provision-host.sh --domain <tên-miền> --email <email> [--no-tls] [--skip firewall,upgrades,time,packages]` (Ubuntu 22.04/24.04) — script kiểm tra trước, chạy lại được; trên máy dùng chung **luôn** thêm `--skip` như ví dụ.

Cấu trúc thư mục khuyến nghị:

```
/opt/sharptalk/releases/sharptalk-<version>/     mỗi bản phát hành một thư mục, không sửa tay
/opt/sharptalk/current  ->  releases/sharptalk-<version>   (symlink; cron/systemd trỏ vào đây)
/etc/sharptalk/.env.self-hosted                  cấu hình (ngoài bundle, sống qua các lần nâng cấp)
/etc/sharptalk/backup.env  /etc/sharptalk/backup.key
/var/lib/sharptalk/                              releases.log (rất quan trọng cho rollback)
/var/backups/sharptalk/                          bản sao lưu
```

### 4.2 Cấu hình và bí mật

```bash
cd /opt/sharptalk/releases/sharptalk-<version>
sudo install -d -m 700 /etc/sharptalk /var/lib/sharptalk
sudo cp docker/self-hosted/.env.self-hosted.example /etc/sharptalk/.env.self-hosted
bash scripts/gen-secrets.sh        # in ra màn hình, KHÔNG ghi đĩa: dán vào file env rồi đóng terminal
export SHARPTALK_ENV_FILE=/etc/sharptalk/.env.self-hosted
export SHARPTALK_STATE_DIR=/var/lib/sharptalk
```

(Đặt hai biến `export` vào profile của tài khoản triển khai để các lần sau không quên.)

Điền tối thiểu: `APP_PUBLIC_URL`, `PUBLIC_BASE_URL`, `VITE_API_BASE_URL` (dạng `https://<tên-miền>/api/v1`; dùng cho `widget-config.js`), `UPLOAD_DIR=/data/uploads` (**không đổi** — script từ chối giá trị khác), `CORS_ORIGINS` (origin chính xác của Hotel Admin, không dùng `*`), `AI_PROCESSING_REGION`, `CONVERSATION_LOG_RETENTION_DAYS` (khớp chính sách quyền riêng tư — mục 11), `SMTP_*`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` / `AI_ALERT_EMAIL`.

Danh tính khởi tạo (**bắt buộc** cho bản cài của Go2Joy, nếu không bản cài khởi động với tenant và hộp thư của Amoeba):

```
SEED_ON_BOOT=true                  # chỉ lần khởi động đầu
SEED_TENANT_SLUG=go2joy
SEED_TENANT_NAME=Go2Joy
SEED_TENANT_DOMAIN=<host nhận diện tenant, ví dụ app.go2joy.vn>
SEED_ADMIN_EMAIL=<hộp thư của quản trị nền tảng Go2Joy>
SEED_MASTER_EMAIL=<hộp thư của trưởng nhóm CS Go2Joy>
SEED_PASSWORD=                     # KHUYẾN NGHỊ để trống: hệ thống SINH hai mật khẩu riêng, dùng một lần, in ra một lần
                                   # (gen-secrets.sh cũng in một SEED_PASSWORD; nếu dán nó vào, cả hai tài khoản
                                   # khởi đầu với cùng một mật khẩu, vẫn bị buộc đổi ở lần đăng nhập đầu)
SEED_DEMO_DATA=false
SEED_KB_PROFILE=none
```

`deploy-self-hosted.sh` từ chối cấu hình dở dang (có `SEED_TENANT_SLUG` mà thiếu domain hoặc email). Mẫu env của hồ sơ `deploy/profiles/SharpTalk-VN-Go2Joy/` đã điền sẵn slug/tên/domain giả định.

**Trước khi khởi động lần đầu, ghi `CRED_ENC_KEY` và `FILE_URL_SECRET` vào nơi lưu bí mật của Go2Joy** (mục 12). Mất khoá = mất khả năng đọc thông tin xác thực và dữ liệu cá nhân đã mã hoá.

### 4.3 Chạy thử rồi cài

```bash
bash scripts/deploy-self-hosted.sh --bundle . --dry-run     # in mọi hành động, không chạy gì (kể cả docker)
bash scripts/deploy-self-hosted.sh --bundle .               # cài thật
```

Điều gì xảy ra với lần cài đầu (script này **không bao giờ tự áp SQL**):

1. kiểm tra cấu hình (env, `UPLOAD_DIR`, các bí mật bắt buộc, danh tính khởi tạo), kiểm tra checksum bundle;
2. `docker load` mọi image từ `images/`;
3. khởi động **riêng MySQL**; lần đầu MySQL chạy `docker/init-sql/01-schema.sql` trên thư mục dữ liệu rỗng (hơn 90 bảng);
4. **cổng migration**: `scripts/check-migrations.sh` so schema thật với `sql/artefacts.tsv`. Nếu `init-sql` thiếu migration, script dừng ở đây với danh sách cần áp, **chưa khởi động container ứng dụng** (đây là lỗi D-18: bản cài mới từng báo 500 vì thiếu 6 migration);
5. khởi động toàn bộ stack không build (`up -d --no-build`), tạo lại nginx;
6. kiểm tra những gì **đang chạy thật** (mục 6.4) và ghi `releases.log` cùng danh sách migration của bản này.

"Sổ migration" ở đây **không phải một bảng trong DB**: trạng thái được đọc từ chính schema (`information_schema`) so với danh sách `sql/artefacts.tsv` do Amoeba sinh ra và CI giữ cho khớp. Ưu điểm: không lệch khi ai đó áp tay một file.

### 4.4 Thay thế tài khoản seed

Lần khởi động đầu in mật khẩu một lần (cả hai tài khoản đều bị buộc đổi mật khẩu ở lần đăng nhập đầu):

```bash
docker logs sharptalk_api 2>&1 | grep -A4 'SEED CREDENTIALS'
```

1. Đăng nhập `/admin/login` bằng tài khoản quản trị nền tảng, **đổi mật khẩu ngay**; đăng nhập `/user/go2joy` bằng tài khoản master, đổi mật khẩu.
2. Đặt `SEED_ON_BOOT=false` trong file env và áp dụng: `bash scripts/deploy-self-hosted.sh --bundle .` (hoặc `export SHARPTALK_VERSION=$(cat VERSION)` rồi `docker compose -f docker/self-hosted/docker-compose.self-hosted.yml --env-file "$SHARPTALK_ENV_FILE" up -d --no-build --no-deps api`; thiếu biến phiên bản compose sẽ tìm image `:local` và cố build). Để `SEED_ON_BOOT=true` thì mỗi lần khởi động lại, tài khoản có mật khẩu cấu hình sẽ bị đặt lại về giá trị seed.
3. Mời người dùng thật trong console (mật khẩu tạm hiển thị một lần), bật MFA (`MFA_ENFORCE_FROM` — đặt **sau khi** đã cấp tài khoản, nếu không lần đăng nhập đầu bị kẹt ở màn đăng ký MFA).
4. Xác nhận không còn tài khoản `@amoeba.group` nào: nếu `SEED_ADMIN_EMAIL` / `SEED_MASTER_EMAIL` được đặt đúng thì không có. Nếu đã lỡ khởi động với mặc định (tenant `ivyusa`), tạo tenant `go2joy` mới trong console, chuyển người dùng, rồi xoá tenant và tài khoản dư.

### 4.5 AI engine

Seed chỉ tạo engine **stub** (trả lời giả, không gọi ai) và một dòng Anthropic không có khoá — nếu không đăng ký khoá thật, hệ thống **im lặng trả lời bằng stub**. Việc cần làm:

1. Console quản trị nền tảng → AI engine → nhập khoá Anthropic cho engine, kích hoạt, chạy "kiểm tra kết nối".
2. Chỉ đổi `AI_DEFAULT_PROVIDER=anthropic` sau khi thông báo chuyển dữ liệu ra nước ngoài (AI xử lý ở Hoa Kỳ) đã được pháp chế duyệt; hồ sơ Go2Joy mặc định bắt đầu bằng `stub` để kiểm tra khói.
3. Đặt `AI_ALERT_EMAIL` (hoặc `ALERT_EMAIL_TO`) để nhận thư khi hết tín dụng / khi phục hồi. Không còn địa chỉ Amoeba làm mặc định; nếu cả hai để trống thì không ai nhận thư (chỉ có dòng cảnh báo trong log).

### 4.6 Tri thức và đánh chỉ mục (Voyage)

Đặt `VOYAGE_API_KEY`, giữ `QDRANT_URL=http://qdrant:6333`. Nạp tri thức (console → Tri thức) rồi đánh chỉ mục lại từ console. Từ dòng lệnh, cùng cách bước golden gate chạy trong container: `docker exec -w /app/apps/api sharptalk_api node dist/database/kb-reindex.js` (thêm `--force` sau khi đổi model embedding hoặc mất volume Qdrant). Lệnh này theo đúng mẫu của golden gate nhưng chưa được chạy thật trong đợt này (Phụ lục B).

### 4.7 Kiểm tra khói sau cài

Dùng danh sách ở mục 6.4 và mục 9 trong hướng dẫn nền (đăng nhập quản trị, AI engine thật đang hoạt động, một câu hỏi widget có trích dẫn tri thức — không phải câu trả lời stub, chuyển người, tải ảnh đính kèm, một lần sao lưu).

---

## 5. TLS, CSP, CORS

**TLS** không kết thúc trong stack: LB hoặc nginx/Caddy của Go2Joy nhận 443 và chuyển tới `http://127.0.0.1:${HTTP_PORT:-8080}`. Cần: nâng cấp WebSocket (`Upgrade`/`Connection`), `client_max_body_size 25m`, truyền `X-Forwarded-Proto`/`X-Forwarded-For`, HSTS (stack gửi sẵn `max-age=31536000`, trình duyệt chỉ áp dụng qua HTTPS). Chứng chỉ do hạ tầng Go2Joy quản lý và giám sát hạn dùng (đặt cảnh báo trước 21 ngày).

**CORS**: console, widget và API cùng một origin nên không cần CORS. `CORS_ORIGINS` chỉ cần khi front-end Hotel Admin gọi API từ origin khác: điền **đúng origin**, không dùng ký tự đại diện. Để trống ở production nghĩa là không gửi header CORS nào.

**CSP phía Hotel Admin** (`script-src`, `frame-src`, `connect-src`, font): xem [hướng dẫn CSP/CORS](GUIDE-261013-Go2Joy-HotelAdmin-CSP-CORS.md).

**Nhúng console vào trang khác**: mặc định console chỉ cho phép `frame-ancestors 'self'`. Trước đây file nginx của console cứng `https://ama.amoeba.site` cho mọi khách; nay giá trị này là tham số build `CONSOLE_FRAME_ANCESTORS` (mặc định rỗng). Hồ sơ Go2Joy để trống; bản KR production của Amoeba đặt lại trong env của mình.

**Widget** được thiết kế để nhúng iframe nên nginx của widget không đặt `frame-ancestors`; việc giới hạn theo origin thuộc SG-82.

---

## 6. Duyệt và thực hiện một bản phát hành

Mỗi bản phát hành đi qua cùng một danh sách. Ký duyệt bằng ticket thay đổi của Go2Joy; `releases.log` tự ghi lại kết quả kỹ thuật.

### 6.1 Trước (T-1 ngày) — Amoeba cung cấp, Go2Joy duyệt

- [ ] Bundle nhận đủ; giá trị `sha256sum SHA256SUMS` khớp con số Amoeba gửi riêng; `sha256sum -c SHA256SUMS` toàn OK.
- [ ] Đọc `migrations.tsv` / `manifest.json`: mọi migration của bản này, phân loại của nó. Migration `breaking`, `destructive` hoặc `unknown` **cần duyệt riêng và kế hoạch quay lại là khôi phục bản sao lưu** (mục 7), không phải đổi image.
- [ ] Có ghi chú phát hành: thay đổi, rủi ro, biến env mới (so với `docker/self-hosted/.env.self-hosted.example` của bản mới).
- [ ] Đủ đĩa: ảnh mới (vài GB) + bản sao lưu; `df -h` cho `/var/lib/docker` và `/var/backups`.
- [ ] Chọn khung giờ (giờ thấp điểm, theo múi giờ ICT); báo trước cho CS nếu có gián đoạn.

### 6.2 Sao lưu trước phát hành

```bash
bash scripts/deploy-self-hosted.sh --bundle . --dry-run --pre-backup     # xem kế hoạch
# hoặc chạy riêng:
set -a; . /etc/sharptalk/backup.env; set +a
BACKUP_LABEL=pre-<version> bash scripts/backup-self-hosted.sh
cat "$BACKUP_ROOT/LAST_SUCCESS"                                          # phải là thời điểm vừa rồi
```

Không có bản sao lưu đọc lại được thì không tiến hành.

### 6.3 SQL trước, mã sau

Lý do: mã cũ với cột mới thì an toàn; mã mới với schema cũ thì lỗi 500 ở mọi yêu cầu chạm vào cột đó. Script triển khai **không** tự áp SQL (chuẩn deploy 04 §3).

```bash
bash scripts/check-migrations.sh            # liệt kê theo THỨ TỰ PHÁT HÀNH
# áp từng file, từ trên xuống dưới:
docker exec -i sharptalk_mysql sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < sql/<file>.sql
bash scripts/check-migrations.sh            # lặp lại cho tới khi báo OK
```

Thứ tự tên file **không** phải thứ tự phát hành: các file `migration_*.sql` cũ nhất nhưng đứng cuối bảng chữ cái, và vài file dùng `AFTER <cột>` với cột do file phát hành sớm hơn tạo ra. Danh sách do `check-migrations.sh` in ra đã được sắp theo thứ tự phát hành (lấy từ `release-order.txt` trong bundle). Nếu vẫn gặp `Unknown column`, áp file tạo cột đó trước. File chỉ chứa dữ liệu (không đọc được từ schema) được liệt kê riêng để kiểm tay.

### 6.4 Triển khai và kiểm chứng

```bash
bash scripts/deploy-self-hosted.sh --bundle . --dry-run
bash scripts/deploy-self-hosted.sh --bundle . --golden-gate       # cổng hồi quy FAQ chạy nền (cần GOLDEN_GATE trong env)
```

**Đừng tin mã thoát.** Script tự kiểm các điều sau và thất bại nếu một điều sai; người duyệt nên đối chiếu bằng mắt:

| Kiểm tra | Cách xem | Đọc kết quả |
|---|---|---|
| Nhật ký khởi động | `docker logs sharptalk_api 2>&1 \| grep 'successfully started'` | phải có |
| Tuổi container | `docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'` | `Up` vài phút; image đúng `<prefix>/api:<version>` |
| Route được bảo vệ | `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/v1/auth/me` | **401 = đã triển khai** · 404 = còn mã cũ · 502 = API sập |
| Liveness | `curl -s http://localhost:8080/api/v1/health` | `{"success":true,"data":{"status":"ok"}}` — **chỉ chứng minh tiến trình trả lời, không chạm DB** |
| Console / widget | `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/` và `/widget/` | 200 |
| Golden gate | `docker exec sharptalk_api cat /tmp/golden-gate.log` (~10 phút) | `golden gate: passed`; thất bại gửi thư tới `AI_ALERT_EMAIL`/`ALERT_EMAIL_TO`, **không tự quay lại** |

Kiểm tra khói 10 phút cho người (từ hướng dẫn nền §9): đăng nhập quản trị nền tảng và master; widget mở với `?shop=<domain>` → đồng ý → một câu hỏi cho câu trả lời có trích dẫn tri thức; chuyển người → có thông báo ở console; tải ảnh → liên kết có chữ ký trả 200; một lần sao lưu.

### 6.5 Kết thúc

- Ghi vào ticket: phiên bản, thời điểm, người thực hiện, kết quả các kiểm tra.
- `releases.log` đã có dòng `deployed` và `releases/<version>/migrations.tsv` (cần cho rollback — nhớ `SHARPTALK_STATE_DIR` nằm **ngoài** thư mục bundle).
- Giữ lại ít nhất **hai** bản phát hành gần nhất (thư mục bundle và image). Không chạy `docker image prune -a`.
- Nếu một kiểm tra thất bại: mục 7.

---

## 7. Rollback

Rollback ở đây là **chạy lại image của bản trước**; cơ sở dữ liệu không bị đụng tới.

```bash
bash scripts/rollback-self-hosted.sh --dry-run          # luôn xem trước
bash scripts/rollback-self-hosted.sh                    # quay về bản liền trước (hỏi gõ ROLLBACK)
bash scripts/rollback-self-hosted.sh --to 1.3.2         # chọn bản cụ thể
```

Script đọc danh sách migration lưu lúc triển khai và xét mọi migration nằm **giữa** hai bản:

| Phân loại | Ý nghĩa | Rollback |
|---|---|---|
| `additive`, `additive-data`, `data` | thêm bảng/cột/chỉ mục (có thể kèm cập nhật dữ liệu) | An toàn: mã cũ bỏ qua phần mới. SQL giữ nguyên; SQL hoàn tác (nếu file ghi) chỉ in ra để tham khảo |
| `breaking` | thêm cột `NOT NULL` không có `DEFAULT` | **Chặn**: INSERT của mã cũ sẽ lỗi |
| `destructive` | `DROP` / `MODIFY` / `CHANGE` / `RENAME` / `TRUNCATE` / `DELETE` | **Chặn**: dữ liệu mất hoặc cột đổi hình dạng |
| `unknown` / không có bản ghi | không chứng minh được an toàn | **Chặn** |

Khi bị chặn script thoát với mã 3 và nói rõ các lựa chọn: (1) **khôi phục bản sao lưu trước phát hành** (`restore-self-hosted.sh`) cùng với image bản trước; (2) sửa tiến lên bằng bản phát hành mới; (3) nếu đã đọc danh sách và chấp nhận rủi ro: `--allow-irreversible`. Bộ phân loại bảo thủ có chủ ý (ví dụ nới rộng một cột bằng `MODIFY` cũng bị xếp `destructive`).

Điều kiện: image bản trước còn trên máy (không `prune`); `releases.log` còn (`SHARPTALK_STATE_DIR`); bản trước đã được triển khai bằng script này (bản triển khai trước khi có script không có bản ghi migration và bị coi là không chứng minh được). Cách khác: chạy lại `deploy-self-hosted.sh --bundle <thư-mục-bản-trước>` — dùng cả compose và nginx của bản trước, cổng migration vẫn qua vì schema mới là tập cha.

Sau rollback: hội thoại tạo trong lúc chạy bản mới vẫn còn; cột lạ mã cũ bỏ qua. Mở ticket để Amoeba xử lý nguyên nhân.

---

## 8. Sao lưu và diễn tập khôi phục

### 8.1 Sao lưu gì

`scripts/backup-self-hosted.sh` tạo một thư mục `<YYYYMMDDTHHMMSSZ>[_nhãn]` gồm:

| Tệp | Nội dung | Bắt buộc? |
|---|---|---|
| `db.sql.gz` | hội thoại, khách, cấu hình (mysqldump `--single-transaction`, không khoá bảng) | Có |
| `uploads.tar.gz` | tệp đính kèm, logo | Có — chỉ DB thì khôi phục xong hội thoại còn đó mà ảnh mất |
| `qdrant-snapshots.tar` | mỗi collection một snapshot, lấy qua API HTTP của Qdrant (`kb_documents`, `reuse_questions`) | Khi Qdrant được cấu hình (`BACKUP_QDRANT=auto`); chỉ mục là dữ liệu dẫn xuất — mất thì đánh chỉ mục lại được nhưng phải trả tiền embedding lần nữa |
| `manifest.txt` | thời điểm, commit, số bản ghi từng bảng chính, số tệp, trạng thái mã hoá/Qdrant | — |
| `SHA256SUMS` | checksum mọi tệp | — |

Sau khi ghi, script **đọc lại từng archive** (giải mã + `gzip -t`); backup không đọc lại được thì không được coi là backup. Khi thất bại: script xoá thư mục dở dang, ghi `<BACKUP_ROOT>/LAST_FAILURE`, thoát khác 0. Khi thành công: ghi `<BACKUP_ROOT>/LAST_SUCCESS`.

### 8.2 Mã hoá — đã chọn `openssl`

Đặt `BACKUP_ENCRYPT_KEY_FILE`: mọi archive được mã hoá bằng `openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt` (tệp `*.enc`, không bao giờ ghi bản rõ ra đĩa trước). Chọn `openssl` thay cho `gpg` vì `gen-secrets.sh` đã cần nó và không cần keyring/agent trên máy chủ.

```bash
sudo install -d -m 700 /etc/sharptalk
openssl rand -base64 48 | sudo tee /etc/sharptalk/backup.key >/dev/null
sudo chmod 600 /etc/sharptalk/backup.key
```

Khoá phải dài ít nhất 32 ký tự ở dòng đầu và chỉ chủ sở hữu được đọc (script từ chối nếu không). **Lưu một bản sao khoá ở nơi KHÔNG chứa bản sao lưu** (trình quản lý mật khẩu / phong bì niêm phong). Mất khoá là mất bản sao lưu, không có cách phục hồi.

Giới hạn trung thực: CBC không xác thực dữ liệu, nên `SHA256SUMS` phát hiện hỏng hóc nhưng không phát hiện kẻ cố ý sửa cả hai tệp. Nếu cần, đặt bản sao ngoài máy chủ trên kho có object-lock / bất biến. (Không có HMAC vì `openssl dgst -hmac` nhận khoá qua dòng lệnh, người dùng khác trên máy đọc được từ `ps`.)

### 8.3 Xoay vòng và lịch

`BACKUP_KEEP_DAYS=14`: sau một lần sao lưu **thành công**, thư mục sao lưu cũ hơn số ngày này bị xoá — chỉ thư mục đặt tên theo mẫu ngày giờ **và** có `manifest.txt`, không bao giờ là bản vừa ghi.

Lịch mẫu trong `docker/self-hosted/ops/`: `sharptalk-backup.timer` + `.service` (02:30 UTC hằng ngày, `Persistent=true` bù lần lỡ), `sharptalk-restore-drill.timer` + `.service` (03:30 UTC ngày 1 các tháng 1, 4, 7, 10), `sharptalk-backup.cron` cho máy không có systemd, `backup.env.example`. Cài đặt: xem phần đầu mỗi file. 02:30 UTC là 09:30 ICT; điều chỉnh nếu muốn giờ khác.

```bash
sudo install -m 644 docker/self-hosted/ops/sharptalk-backup.{service,timer} /etc/systemd/system/
sudo install -m 600 -o sharptalk docker/self-hosted/ops/backup.env.example /etc/sharptalk/backup.env   # rồi sửa
sudo systemctl daemon-reload && sudo systemctl enable --now sharptalk-backup.timer
```

**Bản sao ngoài máy**: script chỉ ghi vào `BACKUP_ROOT`. Việc chép sang máy/kho khác (trong lãnh thổ Việt Nam nếu cần cư trú dữ liệu) là trách nhiệm của Go2Joy — đĩa của cùng máy không phải bản sao lưu.

### 8.4 Khôi phục và diễn tập

**Khôi phục thật** (ghi đè dữ liệu đang chạy):

```bash
bash scripts/restore-self-hosted.sh --dry-run /var/backups/sharptalk/<thư-mục>   # kiểm tra, không đổi gì
bash scripts/restore-self-hosted.sh /var/backups/sharptalk/<thư-mục>             # gõ RESTORE để xác nhận
```

Thứ tự: kiểm tra SHA256SUMS và khả năng đọc/giải mã **trước khi ghi đè gì**; dừng API; nạp DB; thay uploads (container tạm dùng chính image API nên không cần kéo image từ ngoài); khởi động API; khôi phục Qdrant (nếu có snapshot; thất bại chỉ cảnh báo — đánh chỉ mục lại); rồi kiểm tra: mọi dòng `message_attachments` có tệp, và số bản ghi các bảng chính không thấp hơn `manifest.txt` quá 1%. Sau khôi phục, áp các migration còn thiếu so với bản mã đang chạy (`check-migrations.sh`).

**Diễn tập (quý một lần, và sau mọi thay đổi script/khoá sao lưu)** — không đụng stack đang chạy:

```bash
bash scripts/restore-drill-self-hosted.sh --latest /var/backups/sharptalk
```

Script dựng một container MySQL tạm (cùng image với DB thật, không mở cổng), nạp bản sao lưu, so số bản ghi với manifest, đối chiếu tệp đính kèm với `uploads.tar.gz` (chỉ liệt kê, nội dung không ra đĩa), báo migration còn thiếu (thông tin, không làm hỏng diễn tập), kiểm tra snapshot Qdrant, rồi xoá container và ghi một dòng vào `<BACKUP_ROOT>/DRILL_LOG`. Dòng `DRILL_LOG` là bằng chứng cho kiểm toán.

### 8.5 Lưu ý về quyền riêng tư

Bản sao lưu chứa dữ liệu cá nhân và **lưu lại cả dữ liệu đã bị xoá sau ngày sao lưu**. Hệ quả: (1) `BACKUP_KEEP_DAYS` không được dài hơn thời hạn lưu giữ trong thông báo quyền riêng tư; (2) sau mỗi lần khôi phục, chạy lại bước xoá theo thời hạn (mục 11.2); (3) yêu cầu xoá dữ liệu (DSAR) xử lý **sau** ngày của bản sao lưu bị khôi phục sẽ mất cùng nó — phải làm lại (mục 11.3).

---

## 9. Giám sát và cảnh báo

Giám sát chi tiết (endpoint `/metrics`, kênh cảnh báo chung, readiness DB + Redis + Qdrant, lỗi engine) do luồng SG-83 xây dựng: xem [Giám sát và cảnh báo](GUIDE-261013-Observability-Alerting.md). Phần dưới là những gì **đã có trong gói hosting** và nên theo dõi ngay.

| Đối tượng | Nguồn | Ngưỡng gợi ý |
|---|---|---|
| API còn sống | `GET /api/v1/health` (liveness công khai, không chạm DB) | khác 200 trong 2 phút liên tiếp |
| Bản chạy đúng | `GET /api/v1/auth/me` phải trả **401** | 404 hoặc 502 |
| Sức khoẻ container | `docker ps`; compose có healthcheck cho `api` (`/api/v1/health`) và `mysql` | `unhealthy`, hoặc khởi động lại liên tục |
| Sao lưu | `LAST_SUCCESS` (tuổi), `LAST_FAILURE` (tồn tại) | `LAST_SUCCESS` cũ hơn 26 giờ, hoặc có `LAST_FAILURE` |
| Diễn tập | `DRILL_LOG` | không có `PASS` trong 100 ngày |
| Hết tín dụng AI | thư từ `AI_ALERT_EMAIL`/`ALERT_EMAIL_TO` (một thư mỗi 6 giờ cho mỗi engine, thêm thư khi phục hồi) | nhận được thư |
| Golden gate sau phát hành | `/tmp/golden-gate.log` trong container api; thất bại gửi thư | có thất bại |
| Chuyển người | hộp thoại cảnh báo (alarm modal) trong console luôn hoạt động, không phụ thuộc SMTP/Slack | — |
| Đĩa | `df -h`, `docker system df`; log container đã giới hạn **5 × 20 MB mỗi container** (`LOG_MAX_SIZE`, `LOG_MAX_FILE`) | đĩa chứa `/var/lib/docker` còn dưới 20% |
| Xoá theo thời hạn | log API: dòng `Retention purge: msgs=…` mỗi 24 giờ; mỗi lần chạy cũng ghi `audit_logs` (`retention.purge`) | không thấy dòng này trong 36 giờ |
| Chứng chỉ TLS | bên TLS của Go2Joy | còn dưới 21 ngày |

Lưu ý: mã 4xx **không** được máy chủ ghi log mặc định — "log không có lỗi" không có nghĩa là yêu cầu thành công. Log chỉ giữ ~100 MB mỗi container: khi có sự cố, sao chép log trước (mục 10.3).

---

## 10. Xử lý sự cố

### 10.1 Phân loại

Dùng thang SEV1/SEV2/SEV3 của `INCIDENT-RESPONSE.md` cho sự cố dữ liệu cá nhân. Thêm cho **sự cố khả dụng**: SEV-A1 dịch vụ sập hoàn toàn (API/console/widget không phục vụ) — phản hồi trong 1 giờ; SEV-A2 suy giảm (AI trả lời stub/chuyển người liên tục, sao lưu hỏng, đĩa đầy sắp tới) — trong 4 giờ.

### 10.2 Khả dụng — thứ tự xử lý

1. `docker ps -a` và `docker compose -f docker/self-hosted/docker-compose.self-hosted.yml --env-file "$SHARPTALK_ENV_FILE" ps` (đặt `SHARPTALK_VERSION=$(cat VERSION)` trước, xem 4.4).
2. `docker logs --tail 200 sharptalk_api` — API **cố ý từ chối khởi động** nếu bí mật ngắn, thiếu hoặc giống mẫu (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRED_ENC_KEY`).
3. Đĩa đầy: `docker system df`; log đã được giới hạn nên thủ phạm thường là uploads hoặc backup chưa xoay vòng.
4. RabbitMQ chết hoặc không kết nối được: API chạy với bus sự kiện trong tiến trình. Qdrant chết hoặc không cấu hình: API vẫn khởi động (khởi tạo Qdrant không chặn khởi động), tìm kiếm tri thức chỉ còn toàn văn — chất lượng thấp hơn, có thể chuyển người nhiều hơn (cải thiện thuộc SG-84). Redis chết: chưa kiểm chứng hành vi từng tính năng trong đợt này — đọc log API và coi là SEV-A2 cho tới khi xác định.
5. MySQL hỏng: khôi phục từ sao lưu (8.4). Không bao giờ bật `DB_SYNCHRONIZE=true` để "chữa" schema.
6. Sau một bản phát hành xấu: mục 7.

### 10.3 Dữ liệu cá nhân

1. **Giữ bằng chứng trước khi cách ly**: `docker logs sharptalk_api > /secure/incident-<id>/api.log 2>&1` (và nginx, mysql), xuất `audit_logs` liên quan, ghi sha256 của các tệp. Log container chỉ giữ ~100 MB.
2. Cách ly (xem `INCIDENT-RESPONSE.md` §3.2, với tên biến đúng): đổi mật khẩu tài khoản nghi bị chiếm (token cấp trước đó bị từ chối); đổi `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` rồi áp dụng lại để vô hiệu **mọi** phiên; thu hồi khoá AI (xoá `ANTHROPIC_API_KEY` và vô hiệu engine → hệ thống hạ xuống stub); thu hồi SSH/khoá truy cập hỗ trợ (mục 13). Nếu **`CRED_ENC_KEY` lộ** — đây là SEV1 và **không có quy trình đổi khoá có sẵn** (mục 12).
3. Điều tra, khoanh phạm vi: ai/cái gì/khi nào, số chủ thể dữ liệu, có xuyên tenant không (stack này single-tenant), dữ liệu có được mã hoá (PII khách hàng được mã hoá bằng khoá; khoá không lộ có thể giảm nghĩa vụ thông báo — pháp chế quyết định).
4. **Thông báo theo PDPD (Nghị định 13/2023/NĐ-CP)**: thông báo cho cơ quan chuyên trách bảo vệ dữ liệu cá nhân (Cục A05, Bộ Công an) **trong vòng 72 giờ** kể từ khi phát hiện. Điều khoản chính xác, biểu mẫu và kênh nộp **do pháp chế Go2Joy xác nhận** — tài liệu này không thay thế tư vấn pháp lý. Nếu sự cố liên quan chuyển dữ liệu ra nước ngoài (AI xử lý ở Hoa Kỳ) thì liên hệ hồ sơ đánh giá tác động chuyển dữ liệu. Ghi lại căn cứ quyết định thông báo hay không, kể cả khi không thông báo.
5. Thông báo cho chủ thể dữ liệu khi rủi ro cao; cho bên xử lý bị ảnh hưởng (Anthropic, Voyage… — kênh liên hệ ghi ở `PROCESSOR-REGISTER.md`, hiện còn "TBD").
6. Hậu kiểm trong 5 ngày làm việc; ghi lại và gửi Amoeba các bài học liên quan đến phần mềm.

### 10.4 Danh bạ (điền trước khi đi vào vận hành)

| Vai trò | Họ tên | Điện thoại / email | Ghi chú |
|---|---|---|---|
| Chỉ huy sự cố Go2Joy | 〔cần chỉ định〕 | | |
| Hạ tầng trực | 〔cần chỉ định〕 | | 24/7? |
| DPO / pháp chế Go2Joy | 〔cần chỉ định〕 | | Chịu trách nhiệm thông báo A05 |
| Đầu mối Amoeba (hỗ trợ) | 〔cần chỉ định〕 | | Theo mục 13 |
| Cơ quan chuyên trách (A05) — kênh nộp | 〔pháp chế xác nhận〕 | | Không tự suy đoán |

---

## 11. DSAR và lưu giữ dữ liệu

### 11.1 Quy tắc lưu giữ (đã kiểm chứng trong mã)

* `CONVERSATION_LOG_RETENTION_DAYS`: **để trống hoặc `0` KHÔNG có nghĩa là giữ mãi** — mã dùng **365 ngày** (`retention.service.ts`). (Chú thích "giữ mãi" sai trong các mẫu env đã được sửa ở SG-70.) Hồ sơ Go2Joy đang đặt 180 (bản nháp — cần khớp với thông báo quyền riêng tư đã công bố).
* Bộ lập lịch chạy mỗi `RETENTION_PURGE_INTERVAL_HOURS` (mặc định 24; lần đầu 5 phút sau khi khởi động; `0` tắt).
* Mỗi lần xoá: tệp đính kèm (cả tệp trên đĩa) → tin nhắn → hội thoại → sự kiện hành trình → thông báo → phiên cũ → bản ghi kiểm duyệt và cảnh báo chuyển người (chúng trích dẫn tin nhắn). Số liệu sử dụng AI có cửa sổ riêng `AI_USAGE_RETENTION_DAYS` (400 ngày) vì chỉ là bộ đếm.
* **Hai bảng có bộ dọn riêng, TẮT theo mặc định (SG-70, `opt-in-retention.service.ts`)**: `CUSTOMER_RETENTION_DAYS` — khách không còn hoạt động (phiên, đơn hàng) sau N ngày được **ẩn danh** (không xoá hàng, vì đơn hàng, thông báo và phiên còn giữ id khách); `AUDIT_LOG_RETENTION_DAYS` — xoá `audit_logs` cũ hơn N ngày, với **sàn 90 ngày** (việc này cũng xoá bằng chứng đồng ý `consent.*` và hồ sơ `dsar.*` cũ hơn N, nên chọn N không ngắn hơn thời gian dài nhất bạn có thể phải chứng minh một sự đồng ý hay một yêu cầu). Để trống hoặc `0` = không dọn. Hai bộ dọn chạy cùng bộ lập lịch ở trên và cùng nút kích hoạt tay (11.2). Đây là quyết định pháp lý: chỉ bật sau khi pháp chế chốt thời hạn. **Chưa có cờ "giữ lại theo pháp luật" cho từng khách**: khi có yêu cầu giữ lại, hãy tắt hoặc nâng thời hạn **trước** lần chạy kế tiếp (phần đã ẩn danh hoặc đã xoá không khôi phục được). Nếu không đặt hai biến này, hai bảng vẫn giữ dữ liệu lâu hơn thời hạn công bố — pháp chế cần biết.

### 11.2 Kích hoạt tay và sau khôi phục

Quản trị nền tảng có thể kích hoạt ngay: `POST /api/v1/privacy/retention/purge` với token của tài khoản `super_admin`/`admin` (cũng chạy hai bộ dọn tùy chọn ở 11.1 nếu đã đặt biến). Làm việc này **sau mỗi lần khôi phục bản sao lưu**: dữ liệu đã quá hạn nhưng nằm trong bản sao lưu sẽ quay lại.

### 11.3 Yêu cầu của chủ thể dữ liệu (DSAR)

Hiện có (kiểm chứng trong `privacy.controller.ts`): người dùng widget tự xuất (`GET /api/v1/privacy/export`) và xoá/ẩn danh (`POST /api/v1/privacy/delete`) dữ liệu của mình bằng session token — **chỉ với danh tính đã được xác minh**, khách vãng lai bị từ chối (và việc từ chối được ghi `dsar.denied`); tắt chia sẻ (`opt-out`). Mọi thao tác ghi `audit_logs` (`dsar.export`, `dsar.delete`, `dsar.denied`). Sau khi xoá, danh tính được nhớ trong bảng `erased_identities` (dưới dạng blind index) để không bị nhập lại.

**Công cụ DSAR phía vận hành đã có (SG-70)**: trong console, **Cài đặt gian hàng → tab Yêu cầu dữ liệu** (master và director; xem sổ tay vận hành Go2Joy mục 8.5). Người xử lý tra cứu khách theo email, số điện thoại hoặc ID bên ngoài (kết quả bị che), **xuất** hoặc **xoá** (ẩn danh vĩnh viễn, phải nhập đúng ID khách), mọi bước ghi `audit_logs` (`dsar.lookup`, `dsar.export`, `dsar.delete`; từ khoá tìm không được lưu). API tương ứng: `POST /api/v1/privacy/operator/{lookup,export,delete}`. Hạn chế đã biết: không có cờ giữ lại theo pháp luật cho từng khách; tìm theo số điện thoại chỉ quét tối đa 20.000 khách (cũ nhất trước). Yêu cầu gửi trực tiếp tới Go2Joy vẫn được người của Go2Joy xử lý bằng công cụ này; yêu cầu cần hỗ trợ Amoeba đi theo mục 13 (có ticket); **Amoeba không tự ý truy cập dữ liệu**.

**Sổ đăng ký DSAR ngoài hệ thống**: cơ sở dữ liệu không phải chỗ an toàn để lưu bằng chứng đã xoá, vì khôi phục bản sao lưu sẽ hoàn tác cả việc xoá lẫn bản ghi `audit_logs` / `erased_identities`. Go2Joy giữ sổ riêng (ngày nhận, người yêu cầu, ngày xử lý, ai xử lý) và, sau mỗi lần khôi phục, **xử lý lại** mọi yêu cầu đã hoàn tất sau ngày của bản sao lưu.

---

## 12. Quản lý khoá

### 12.1 Danh mục

| Khoá / bí mật | Dùng cho | Đổi được? |
|---|---|---|
| `CRED_ENC_KEY` | mã hoá AES-256-GCM thông tin xác thực tích hợp, khoá AI trong DB, bí mật nhúng của tenant, dữ liệu cá nhân của khách; khoá HMAC cho blind index (`email_hash`, danh sách chặn xoá) | **KHÔNG đổi tuỳ tiện** (12.2) |
| `FILE_URL_SECRET` | ký liên kết tệp đính kèm và liên kết video tri thức. Nếu để trống thì **suy ra từ `CRED_ENC_KEY`** | Đổi làm mất hiệu lực mọi liên kết đã gửi, kể cả liên kết video nằm trong câu trả lời đã lưu (không hết hạn) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ký phiên đăng nhập | Đổi được, mọi người bị đăng xuất; hai giá trị phải khác nhau |
| `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `RABBITMQ_PASSWORD` (+ `RABBITMQ_URL`) | dịch vụ nội bộ | Đổi trong dịch vụ **và** env rồi tạo lại container |
| Khoá sao lưu `backup.key` | mã hoá bản sao lưu | Đổi cho các bản sao lưu **mới**; giữ khoá cũ tới khi bản sao lưu cũ hết hạn |
| Khoá AI, SMTP, Notion… | nằm trong console (mã hoá bằng `CRED_ENC_KEY`) hoặc env | Đổi trong console / env |

### 12.2 Điều gì xảy ra nếu `CRED_ENC_KEY` bị đổi (đã đối chiếu mã `crypto.util.ts`, `tenant.entity.ts`)

1. **Thông tin xác thực mã hoá** (khoá AI, tích hợp, kênh nhắn tin): `decryptSecret` ném lỗi xác thực GCM — các tính năng dùng chúng thất bại.
2. **Bí mật nhúng của tenant**: transformer của entity `Tenant` giải mã không bắt lỗi, nên truy vấn nạp tenant có bí mật nhúng có thể lỗi 500 trên diện rộng.
3. **Dữ liệu cá nhân của khách** (tên, email, điện thoại): `decryptPii` **nuốt lỗi và trả về byte thô dưới dạng văn bản** — dữ liệu hiển thị rác, **không có lỗi nào báo ra**.
4. **Blind index** (`email_hash`, danh sách chặn nhập lại sau khi xoá): tính lại bằng khoá mới sẽ không khớp bản ghi cũ — tra cứu khách lặp, và việc chặn nhập lại người đã xoá mất tác dụng, cũng không báo lỗi.
5. Khoá phải giải mã base64 thành đúng **32 byte**; kiểm tra khởi động chỉ đòi ≥ 32 ký tự, sai độ dài chỉ lộ ra ở lần dùng đầu tiên. `gen-secrets.sh` sinh đúng định dạng.

**Không có quy trình đổi khoá được hỗ trợ trong mã**: `migrate-encrypt-pii.ts` chỉ ghi chú rằng đổi khoá cần "giải mã bằng khoá cũ, chạy lại với khoá mới" nhưng không có công cụ nào làm việc đó (`INCIDENT-RESPONSE.md` ghi mục này là "chưa quyết"). Quy tắc vận hành:

* **không đổi** `CRED_ENC_KEY` và `FILE_URL_SECRET` khi hệ thống đã có dữ liệu;
* nếu khoá bị lộ: SEV1; liên hệ Amoeba để xây và **diễn tập trên bản sao đã khôi phục** một migration tái mã hoá cần cả hai khoá, trước khi chạm vào production;
* khôi phục bản sao lưu **luôn** cần đúng khoá của hệ thống nguồn: bản sao lưu DB mà không có `CRED_ENC_KEY` thì khoá AI và dữ liệu cá nhân không đọc được.

### 12.3 Lưu giữ

* Hai người của Go2Joy giữ quyền truy cập; một bản trong trình quản lý bí mật, một bản niêm phong ngoại tuyến. Ghi ai, khi nào xem.
* File env (`/etc/sharptalk/.env.self-hosted`) và khoá sao lưu được sao lưu **riêng, mã hoá, ở nơi khác** bản sao lưu dữ liệu. Không đặt chung một chỗ: ai lấy được cả hai là mở được toàn bộ.
* Không dán bí mật vào ticket, chat, email, hay PR. Amoeba không nhận bí mật của Go2Joy.
* Rà soát hằng quý: danh sách người có quyền, khoá còn khớp với bản sao lưu gần nhất (bằng buổi diễn tập mục 8.4).

---

## 13. Quy trình truy cập hỗ trợ của Amoeba (bản nháp — cần ghi vào hợp đồng)

Nguyên tắc: **không có truy cập thường trực**. Amoeba cung cấp phần mềm và hướng dẫn; Go2Joy là bên thao tác trên hệ thống. Khi cần Amoeba nhìn vào hệ thống, áp dụng thứ tự ưu tiên:

1. **Go2Joy thao tác, Amoeba hướng dẫn** (chia sẻ màn hình hoặc gửi lệnh) — mặc định.
2. **Go2Joy gửi tệp đã che dữ liệu**: log API/nginx (dữ liệu cá nhân bị che trong log), `manifest.json`, kết quả `check-migrations.sh`, `docker ps`. Không gửi bản sao lưu hoặc dump DB.
3. **Truy cập có giới hạn thời gian** chỉ khi 1 và 2 không đủ:
   * Amoeba mở ticket: lý do, phạm vi (máy chủ hay console), thời lượng, người thực hiện;
   * Go2Joy duyệt và tạo tài khoản tạm (SSH khoá công khai, quyền tối thiểu; hoặc tài khoản console cấp bậc thấp nhất đủ dùng, bật MFA) **có hạn dùng**;
   * phiên được ghi lại (ghi phiên terminal / `audit_logs` của console); Amoeba không sao chép dữ liệu ra ngoài hạ tầng Go2Joy;
   * thu hồi ngay khi xong; Amoeba gửi báo cáo ngắn (làm gì, ở đâu, kết quả).
4. **Khẩn cấp (SEV1)**: cùng quy trình, rút gọn bước duyệt qua điện thoại với người có thẩm quyền của Go2Joy, vẫn phải có ticket ghi bù trong 24 giờ.

Amoeba **không** có: mật khẩu root, `CRED_ENC_KEY`, khoá sao lưu, hay bản sao lưu. Tài khoản của Amoeba không được tồn tại trong tenant `go2joy` ngoài các tài khoản tạm theo ticket (kiểm tra ở 4.4 bước 4).

---

## Phụ lục A. Lệnh nhanh

```bash
# --- bản phát hành
sha256sum -c SHA256SUMS
bash scripts/deploy-self-hosted.sh --bundle . --dry-run
bash scripts/deploy-self-hosted.sh --bundle . --pre-backup [--golden-gate]
bash scripts/check-migrations.sh                      # SQL còn thiếu, theo thứ tự phát hành
bash scripts/rollback-self-hosted.sh --dry-run

# --- sao lưu
set -a; . /etc/sharptalk/backup.env; set +a
bash scripts/backup-self-hosted.sh [--dry-run]
bash scripts/restore-drill-self-hosted.sh --latest "$BACKUP_ROOT"
bash scripts/restore-self-hosted.sh --dry-run <thư-mục-sao-lưu>

# --- trạng thái
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/v1/auth/me      # 401 = đang phục vụ
tail -n 3 /var/lib/sharptalk/releases.log
cat "$BACKUP_ROOT/LAST_SUCCESS" "$BACKUP_ROOT/DRILL_LOG"
```

## Phụ lục B. Đã kiểm chứng và chưa kiểm chứng (2026-10-13)

**Đã chạy thật** (máy phát triển, MySQL 8.0.44 dùng một lần, container Alpine thay cho API): `init-sql` nạp sạch 93 bảng và `check-migrations.sh` báo 99 migration đã áp (trước khi sửa: 6 thiếu); sao lưu mã hoá → khôi phục → diễn tập đầy đủ, kể cả khóa sai, tệp bị sửa, thiếu khoá; `docker compose config` cho self-hosted và production; `--dry-run` của mọi script; toàn bộ kiểm thử trong `scripts/__tests__/` (xem `docs/test/TCR-261013-s5c-hosting.md`).

**Chưa chạy thật**: build image (`docker build`) và `docker save` thật; `npm ci` trong image (chỉ kiểm tra khô `npm ci --dry-run` trên các manifest); tag nền `node:20.19.0-alpine3.21` và `nginx:1.27.5-alpine` **chưa được kéo về** — `build-release-bundle.sh` kiểm tra chúng bằng `docker manifest inspect` trước khi build; Qdrant thật (snapshot/restore) — chỉ thử với máy chủ giả; `nginx -t` cho cấu hình web mới (không có image nginx ở máy này); triển khai bundle trên một máy Linux; lệnh `kb-reindex.js` trong container; hành vi giao diện của console khi build với `VITE_API_BASE_URL=/api/v1` (chưa mở trình duyệt).

## Phụ lục C. Việc còn lại

1. Ký số bundle (cosign/GPG) — hiện chỉ có checksum.
2. Mã Node 20 hết hỗ trợ từ 2026-04: lên kế hoạch chuyển sang Node 22 LTS (Dockerfile ghim `node:20.19.0`).
3. Sửa chú thích sai về thời hạn lưu giữ trong mẫu env và mở rộng sang `customers`, `audit_logs` (SG-70).
4. Quy trình đổi `CRED_ENC_KEY` (migration tái mã hoá) — chưa có.
5. Đóng gói font cục bộ và `frame-ancestors` cho widget (SG-82); `/metrics`, readiness có Redis và Qdrant, cảnh báo chung (SG-83).
6. Rà soát bản vi bởi người bản ngữ; hợp đồng hoá quy trình ở mục 13.
