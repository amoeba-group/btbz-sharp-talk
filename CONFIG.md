# CONFIG — btbz-SharpTalk

> Technical spec + configuration reference for **development / staging / production**.
> Companion to [SPEC.md](SPEC.md) (specification) and [README.md](README.md) (overview).
> ⚠️ **No real secrets in this file.** Live values live only in gitignored env files on the
> server and in `secrets/staging-server.md` (local-only). This documents *structure*, not secrets.

---

## 1. Technical Stack (기술 스펙)

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Runtime | Node.js | ≥ 20 | monorepo engine requirement |
| Monorepo | Turborepo | 2.x | `apps/*`, `packages/*` workspaces |
| Backend | NestJS | 10.3 | REST `/api/v1`, Swagger `/api/v1/docs` |
| ORM | TypeORM | 0.3.20 | `synchronize` in dev/staging; migrations in prod |
| Database | MySQL | 8.0 | utf8mb4 / InnoDB · `db_sharptalk` · 38 tables / 40 entities |
| Cache/session | Redis | 7 | session cache, unread counts (tenant-prefixed keys) |
| Message bus | RabbitMQ | 3.13 | async notifications, logging, CJM (in-process fallback) |
| Auth | @nestjs/jwt | 10.2 | access 15m / refresh 7d; bcryptjs (cost 12) |
| Crypto | AES-256-GCM | — | credential encryption (`crypto.util`, POL-018) |
| Frontend | React + Vite | 18 / 5 | `apps/web` (admin SPA), `apps/widget` (customer) |
| Styling | TailwindCSS | 3 | primary 50–900 ramp; web style guide v2 |
| State/data | Zustand 4 · React Query 5 | — | global state / server state (tenantId in query keys) |
| i18n | react-i18next | 14 | en (default) / es / ko; `fallbackLng: 'en'` |
| AI | Pluggable gateway | — | stub adapter (no key) + Anthropic (`claude-opus-4-8`) |
| Container | Docker Compose | v2/v5 | dev / staging / production stacks |
| Edge | Nginx | alpine | reverse proxy (`/` web · `/api/` api · `/widget` widget) |

**Backend scope:** 26 domain modules — `auth, session, chat, moderation, ai-engine, tenant,
user, customer, order, inquiry, review, affiliate, restock, subscription, notification,
campaign, cjm, knowledge, agent, analytics, audit, integration, privacy, health,
shopify-oauth, shopify-proxy`. 40 TypeORM entities.

---

## 2. Environments at a glance (환경 요약)

| | **Development** | **Staging** | **Production** |
|---|---|---|---|
| Status | local | **🟢 LIVE** | 🔴 templates only, not deployed |
| Host | localhost | `shoptalk.amoeba.site` (211.110.140.172) | TBD |
| Public URL | — | https://shoptalk.amoeba.site | TBD |
| API base | `http://localhost:3000/api/v1` | `https://shoptalk.amoeba.site/api/v1` | TBD |
| Admin console | `:5173` | `/` | TBD |
| Widget | `:5174` | `/widget/` | TBD |
| NODE_ENV | development | staging | production |
| DB schema | `synchronize=true` + seed | `synchronize=true` + `SEED_ON_BOOT` | `synchronize=false` + init-sql migrations |
| TLS | — | host nginx + Let's Encrypt → docker nginx `:8080` | TBD |
| Compose file | `docker/docker-compose.dev.yml` | `docker/staging/docker-compose.staging.yml` | `docker/production/docker-compose.production.yml` |
| Env file | `env/backend/.env.development` (committed) | `docker/staging/.env.staging` (gitignored) | `docker/production/.env.production` (gitignored) |

---

## 3. Port mapping (포트 매핑)

### Development (host ports remapped off occupied defaults)
| Service | Host port | Container port |
|---|---|---|
| API (NestJS) | 3000 | 3000 |
| Admin web (Vite) | 5173 | — |
| Widget (Vite) | 5174 | — |
| MySQL | 3316 | 3306 |
| Redis | 6389 | 6379 |
| RabbitMQ | 5682 | 5672 |

### Staging (internal docker network; only nginx published)
| Service | Exposure |
|---|---|
| nginx (edge) | `8080:80` (host nginx + LE TLS front it on 443) |
| api / web / widget | internal only (`expose`) |
| mysql | `3317:3306` (host, for debugging) |
| redis / rabbitmq | internal only |

### Production (hardened — DB/queue never published)
| Service | Exposure |
|---|---|
| nginx (edge) | `80:80` |
| api / web | internal only |
| mysql / redis / rabbitmq | internal-network only (no host port) |

---

## 4. Environment variables (환경 변수 레퍼런스)

Templates: `env/backend/.env.development` (committed, dev placeholders) ·
`docker/staging/.env.staging.example` · `docker/production/.env.production.example`.
Copy the `.example` to the real filename on the server and fill in secrets — the real
`.env.staging` / `.env.production` are **gitignored**.

### 4.1 Backend (`apps/api`)

| Variable | Dev | Staging | Prod | Purpose |
|---|---|---|---|---|
| `NODE_ENV` | development | staging | production | runtime mode |
| `PORT` | 3000 | 3000 | 3000 | API listen port |
| `API_PREFIX` | api/v1 | api/v1 | api/v1 | global route prefix |
| `DB_HOST` | 127.0.0.1 | mysql | mysql | compose service name in containers |
| `DB_PORT` | 3316 | 3306 | 3306 | |
| `DB_USER` / `DB_PASSWORD` | ivy / dev pw | secret | secret | app DB user |
| `DB_NAME` | db_sharptalk | db_sharptalk | db_sharptalk | |
| `DB_ROOT_PASSWORD` | — | secret | secret | mysql container only |
| `DB_SYNCHRONIZE` | true | true | **false** | prod uses migrations |
| `DB_LOGGING` | false | false | false | |
| `REDIS_HOST` / `REDIS_PORT` | 127.0.0.1 / 6389 | redis / 6379 | redis / 6379 | |
| `RABBITMQ_URL` | amqp://…:5682 | amqp://…@rabbitmq:5672 | amqp://…@rabbitmq:5672 | |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | — | secret | secret | staging/prod compose |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev | **secret** | **secret** | rotate per env |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | 3600 / 604800 | same | same | same |
| `CRED_ENC_KEY` | dev key | **secret** | **secret** | AES-256-GCM 32-byte base64 (POL-018) |
| `AI_DEFAULT_PROVIDER` | stub | stub | anthropic | gateway default adapter |
| `AI_PROCESSING_REGION` | US | US | US | region named in the widget AI disclosure (US/EU/VN/KR/JP/SG) — REQ-260913 G7 |
| `ANTHROPIC_API_KEY` | — | optional | **required** | real provider key |
| `ANTHROPIC_MODEL` | claude-opus-4-8 | claude-opus-4-8 | claude-opus-4-8 | |
| `OPENAI_API_KEY` | — | optional | optional | fallback route; per-engine key in the console wins |
| `OPENAI_MODEL` | gpt-4o-mini | gpt-4o-mini | gpt-4o-mini | used when the engine row names no model |
| `IDLE_SWEEP_INTERVAL_SEC` | 30 | 30 | 30 | 방치 대화 순회 주기(0=비활성) |
| `IDLE_PROMPT_AFTER_MIN` | 30 | 30 | 30 | 이 시간 무응답이면 "더 도와드릴까요?" |
| `IDLE_CLOSE_AFTER_SEC` | 60 | 60 | 60 | 그 질문 후 대기 시간 |
| `IDLE_STALE_AFTER_DAYS` | 7 | 7 | 7 | 이보다 오래된 방치는 질문 없이 종료 |
| `CONVERSATION_LOG_RETENTION_DAYS` | 365 | 90 | 365 | POL-003 retention purge |
| `KB_STORAGE_DIR` | ./storage/kb | — | — | local KB uploads (dev) |
| `UPLOAD_DIR` | ./.uploads | /data/uploads | /data/uploads | 대화 첨부 저장 경로 — **컨테이너에선 반드시 마운트된 볼륨** (PLN-260814) |
| `FILE_URL_SECRET` | — (CRED_ENC_KEY 파생) | **secret** | **secret** | 첨부 다운로드 서명 키; 교체하면 기존 링크 무효 |
| `ATTACHMENT_MAX_IMAGE_MB` | 10 | 10 | 10 | 이미지 상한 (nginx `client_max_body_size 25m` 아래) |
| `ATTACHMENT_MAX_FILE_MB` | 20 | 20 | 20 | 일반 파일 상한 |
| `ATTACHMENT_MAX_PER_MESSAGE` | 5 | 5 | 5 | 메시지당 첨부 개수 |
| `SEED_ON_BOOT` | — | true→false after 1st boot | true→false after 1st boot | idempotent bootstrap seed at startup |
| `SEED_DEMO_DATA` | — | true | **false** | demo orders/customers |
| `SEED_KB_PROFILE` | us-cosmetics | us-cosmetics | us-cosmetics | baseline KB on first boot: `us-cosmetics` / `none` — REQ-260913 G11 |
| `SEED_PASSWORD` | — | override recommended | **strong required** | bootstrap account password |

### 4.2 Escalation alerts (optional — empty disables a channel)
`SLACK_WEBHOOK_URL`, `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`,
`ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`. The DB-backed console alarm modal always works
regardless of these.

**Agent presence (PLN-261012 SG-60):** `AGENT_PRESENCE_TTL_SEC` (default 90) — an agent counts as
available for alert routing only while "On duty" in the console AND the console polled within this
many seconds (the 10 s alert poll is the heartbeat). Blank or non-positive = default.

**Signed identity (PLN-261012 SG-03 / SG-04):** `IDENTITY_MAX_AGE_HOURS` (default 8) — signed claims from
`ShopTalk.identify()` older than this are treated as a guest (guest gate, partner prompt line, region
routing, console header, scenario menu); the widget raises `identity-expired` so the host signs again.
A tenant overrides it with `tenants.identity_policy.maxAgeHours` (console: Settings > Widget > Signed
sign-in policy, MASTER). `0` switches expiry off platform-wide — an emergency rollback, not a setting.
Anything that is not a plain non-negative number falls back to 8. `IDENTIFY_REPLAY_GUARD` (default on) —
a verified v2 signature is remembered in Redis for 2 x the 10-minute iat window and refused when another
session presents it; `false` turns the guard off. Without Redis the guard fails open (logged, audited).
`identity_policy.refuseV1` rejects `identify` calls that carry no claims.
**Partner data lookup (PLN-261012 SG-30/31/32)** — lets a signed-in hotel user's rate / policy / booking /
settlement questions be answered from the partner (Go2Joy) data API. **Everything defaults OFF** and a tenant that
never opts in behaves exactly as before. Draft API contract: `docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml`
(Go2Joy's real spec and key, requirements R8/R9, are not delivered yet).
| Variable | Default | Purpose |
|---|---|---|
| `PARTNER_DATA_ENABLED` | off | server-wide switch (`1`/`true`/`yes`/`on`); the tenant must ALSO turn it on in Settings → Etc (`tenants.partner_data_enabled`) |
| `PARTNER_API_MODE` | `mock` | `mock` = built-in sample hotels (no real data); `live` = real HTTP API using the tenant's `go2joy_partner_api` credentials (base URL, API key, optional signing secret). Anything but `live` is `mock` |
| `PARTNER_API_TIMEOUT_MS` | 3000 | per attempt (GET only, one jittered retry on network error/5xx) |
| `PARTNER_API_BUDGET_MS` | 7000 | wall-clock cap across attempts |
| `PARTNER_API_PRIVATE_HOSTS` | — | comma list of hostnames/IPs the OPERATOR allows even though private or plain http (e.g. when the partner API is on Go2Joy's own network); plain http is refused in production. Tenants cannot widen it |
| `PARTNER_CLAIMS_MAX_AGE_SEC` | 28800 | identity claims older than this (8 h) no longer allow a data lookup — the user is asked to sign in again |
### 4.2b Resilience, observability and ops alerting (PLN-261012 SG-83 / SG-84)
All optional; every default is safe. Full meaning, thresholds and example Prometheus rules:
[docs/guide/GUIDE-261013-Observability-Alerting.md](docs/guide/GUIDE-261013-Observability-Alerting.md).

| Variable | Default | Purpose |
|---|---|---|
| `AI_REQUEST_TIMEOUT_MS` | 25000 | whole-call deadline for one LLM completion (floor 1000) |
| `AI_CLASSIFY_TIMEOUT_MS` | 10000 | deadline for the intent classifier (a short JSON call) |
| `EMBED_REQUEST_TIMEOUT_MS` | 8000 | deadline for one embedding request (live chat waits on it) |
| `QDRANT_REQUEST_TIMEOUT_MS` | 5000 | deadline for one Qdrant REST call |
| `AI_MAX_RETRIES` | 1 | retries of a completion — network error / 5xx / 429 only, never a timeout or 4xx |
| `EMBED_QUERY_RETRIES` / `EMBED_DOCUMENT_RETRIES` | 1 / 2 | embedding retries (full jitter); document batches also retry a timeout |
| `AI_BREAKER_FAILURE_THRESHOLD` | 5 | consecutive engine-level failures that open an engine's breaker |
| `AI_BREAKER_OPEN_SEC` | 30 | how long calls are skipped before one half-open probe |
| `AI_BREAKER_ENABLED` | on | `0`/`false` = kill switch (also covers the Qdrant search breaker) |
| `RAG_DEGRADED_CONFIDENCE_CAP` | 0.55 | confidence of a keyword-only answer while the vector leg is down; ≤0.45 restores "always hand off" |
| `RAG_DEGRADED_MIN_COVERAGE` | 0.6 | share of the question's distinctive words a document must contain to be trusted then |
| `METRICS_TOKEN` | — | bearer for `GET /metrics` and `GET /api/v1/health/readiness`; **unset = both 404** |
| `OPS_ALERT_TOKEN` | — | bearer for `POST /api/v1/internal/ops-alert` (backup/deploy failure hook); unset = 404 |
| `OPS_ALERT_EMAIL` | — | comma-separated recipients of ops alerts (needs `SMTP_HOST`). **No built-in default** |
| `OPS_ALERT_WEBHOOK_URL` | — | JSON POST target for ops alerts (Slack/Teams/Discord-compatible `text`/`content`) |
| `OPS_ALERT_COOLDOWN_SEC` | 1800 | one alert per key per window; 0 = no dedupe |
| `OPS_WATCHDOG_INTERVAL_SEC` | 30 | how often the watchdog evaluates the rules; 0 = off |
| `OPS_LLM_WINDOW_SEC` / `OPS_LLM_FAILURE_RATE` / `OPS_LLM_MIN_CALLS` | 300 / 0.5 / 10 | LLM failure-rate alert: ratio over the window with at least this many calls |
| `OPS_VECTOR_FAILURES` | 5 | Qdrant/embedding failures in the window that raise the vector-backend alert |
| `OPS_DEP_FAILURES` | 2 | consecutive failed DB/Redis/Qdrant probes before alerting |
| `OPS_WATCHDOG_SKIP` | — | csv of `db,redis,qdrant` to exclude (e.g. a deployment that runs without Redis) |
| `READINESS_REQUIRED` | db | csv of dependencies whose failure makes `/health/readiness` return 503 |
| `READINESS_CHECK_TIMEOUT_MS` | 2000 | per-dependency deadline of the readiness probe |
| `ERROR_WEBHOOK_URL` | — | JSON POST of scrubbed 5xx/unhandled errors (rate-limited) |
| `ERROR_REPORT_MAX_PER_MIN` / `ERROR_REPORT_DEDUPE_SEC` | 20 / 60 | error-reporter rate limits |
| `SENTRY_DSN` | — | activates the optional Sentry adapter **only if `@sentry/node` is installed** (not a dependency of this repo; untested against a real Sentry) |

### 4.3 Shopify (optional — features default-safe/disabled when unset)
| Variable | Purpose |
|---|---|
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | public-app OAuth (install/callback); empty → endpoints disabled (501) |
| `SHOPIFY_SCOPES` | `read_orders,read_customers` |
| `SHOPIFY_APP_URL` | app base URL (OAuth redirect host) |
| `SHOPIFY_WEBHOOK_SECRET` | HMAC verification for native + GDPR webhooks; unset → unverified accepted (dev only) |
| `SHOPIFY_SYNC_INTERVAL_MIN` | scheduled order/customer sync (0/unset = disabled) |

> App Proxy customer identity uses `SHOPIFY_API_SECRET` to verify Shopify-signed
> `/apps/{prefix}/{subpath}` storefront requests (route `/api/v1/shopify/proxy`).

### 4.3b Cafe24 (optional — features default-safe/disabled when unset)
| Variable | Purpose |
|---|---|
| `CAFE24_CLIENT_ID` / `CAFE24_CLIENT_SECRET` | Developer-center app credentials; empty → Cafe24 endpoints 501 |
| `CAFE24_SCOPES` | admin OAuth scopes — `mall.read_order,mall.read_product,mall.read_customer` (`mall.read_personal` NOT needed since PLN-260808-MemberId) |
| `CAFE24_REDIRECT_URI` | the ONE redirect URI registered on the app (shared by admin install + customer auth), default `https://shoptalk.amoeba.site/api/v1/auth/cafe24/callback` |
| `CAFE24_CUSTOMER_SCOPES` | customer-auth scope, default `mall.read_customer_identifier` (token response carries `user_id` = member login id) |
| `CAFE24_LOGIN_SYNC_LOOKBACK_DAYS` | order backfill window on member sign-in, default 30, clamped ≤ 90 (Cafe24 range cap 3 months) |
| `CAFE24_SYNC_INTERVAL_MIN` | scheduled order sync (0/unset = disabled) |
| `CAFE24_API_VERSION` | admin API version header, default `2025-09-01` |

### 4.4 Frontend (`apps/web`, `apps/widget`) — build-time (baked into image)
| Variable | Dev | Staging |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000/api/v1` | `https://shoptalk.amoeba.site/api/v1` |
| `VITE_DEFAULT_LOCALE` | en | en |
| `VITE_BASE` (widget only) | / | `/widget/` |

---

## 5. Docker topology (도커 구성)

Build context is the **repo root** (`../..`) so Turbo sees the whole workspace;
root `.dockerignore` keeps host `node_modules`/`dist` out of images.

| Env | Services | Schema source | Restart |
|---|---|---|---|
| **dev** | mysql, redis, rabbitmq (app runs on host via `npm run dev`) | `synchronize` + `db:seed` | — |
| **staging** | api, web, widget, mysql, redis, rabbitmq, nginx | `synchronize` + `SEED_ON_BOOT` (no init-sql mount) | `unless-stopped` |
| **production** | api, web, mysql, redis, rabbitmq, nginx | init-sql `01-schema.sql` (`synchronize=false`) | `always` |

**Nginx edge routing** (staging/prod): `/widget` → widget:80 · `/api/` → api:3000 ·
`/` → web:80. Uses the docker DNS resolver + variable `proxy_pass` so recreated
containers (new IPs) don't cause stale 404/502.

**Health check:** `GET /api/v1/health` → `{"status":"ok","db":"up"}` (liveness + DB
readiness); wired into the api container healthcheck (staging + production compose).

---

## 6. Staging server (LIVE)

**Public:** https://shoptalk.amoeba.site — landing at `/`, tenant login at `/<slug>` (e.g. `/ivyusa`), system-admin login at `/admin/login`, widget at `/widget/`.
Host nginx (shared host, also runs acm/tac prod) terminates TLS (Let's Encrypt,
auto-renew) and reverse-proxies to the docker nginx on `:8080`.

**Connection, SSH keys, and app credentials:** `secrets/staging-server.md` (gitignored,
local-only — **never commit**). SSH key: `secrets/ssh/ivy_staging_ed25519`.

**Shopify:** OAuth app is wired to store `ambshop-dev.myshopify.com`;
tenant #1 `shop_domain` is set to `ambshop-dev.myshopify.com`. Native + GDPR webhooks
HMAC-enforced; on-demand + 30-min scheduled sync verified live.

### Deploy / redeploy
```bash
# on the server, in the repo checkout (on branch main):
git pull
bash docker/staging/deploy-staging.sh          # rebuilds api/web/widget, reloads nginx
curl -s https://shoptalk.amoeba.site/api/v1/health   # {"status":"ok","db":"up"}
```
> `SEED_ON_BOOT` is kept **false** on the server so in-app password changes persist across
> restarts. Editing `docker/staging/nginx.conf` needs `up -d --force-recreate nginx` (the
> bind-mounted config isn't auto-reloaded). Full runbook: [docs/guide/STAGING-DEPLOY.md](docs/guide/STAGING-DEPLOY.md).

---

## 7. Production (LIVE 2026-09-14 — second stack on the staging host)

`https://sharptalk.amoeba.site` → host nginx (Let's Encrypt) → `127.0.0.1:8081` → `docker/self-hosted` stack in `/home/shoptalk/sharptalk-production` (containers `sharptalk_*`, MySQL loopback `3318`, `RESTART_POLICY=always`). Env: server-only `docker/self-hosted/.env.self-hosted` from profile `deploy/profiles/SharpTalk-KR-Production/`; secrets in `secrets/SharpTalk-KR-Production-server.md`. Deploy from branch `production`. The dedicated-host plan below stays valid for when a host is provisioned.

### 7.1 Original bring-up notes (dedicated host)

Docker templates exist (`docker/production/`: Dockerfiles api/web, compose, nginx,
`deploy-production.sh`) but **production is not set up** — there is no
`docker/production/.env.production` and no production host recorded.

**To bring up production:**
1. Provision a host (Docker + compose); point DNS + TLS at it.
2. `cp docker/production/.env.production.example docker/production/.env.production` and fill:
   strong `DB_*`, `RABBITMQ_*`, `JWT_*`, `CRED_ENC_KEY`, real `ANTHROPIC_API_KEY`,
   strong `SEED_PASSWORD` (with `SEED_DEMO_DATA=false`), `SHOPIFY_WEBHOOK_SECRET`,
   and `VITE_API_BASE_URL` = the production API URL.
3. Apply schema via `docker/init-sql/01-schema.sql` (production keeps `DB_SYNCHRONIZE=false`).
4. `bash docker/production/deploy-production.sh`, then turn `SEED_ON_BOOT` off after the first successful boot.

Production hardening (vs staging): `restart: always`; DB/redis/rabbitmq have **no** host
ports (internal network only); schema via migrations, never auto-synchronize.

---

## 8. Security & compliance config (보안·컴플라이언스)

- **Secrets** — JWT secrets, `CRED_ENC_KEY`, DB/MQ passwords, `SEED_PASSWORD`, Shopify
  keys are per-env and live only in gitignored env files / `secrets/`. Rotate per environment.
- **Passwords** — bcrypt cost 12; seeded/invited accounts `must_change_password=1`.
- **Credentials** — per-tenant integration credentials AES-256-GCM encrypted at rest.
- **PII** — `LoggingInterceptor` logs method/path/status/duration only (no bodies/PII); `maskPii` util; privileged actions → `AuditService.write`.
- **Privacy** — Shopify GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`, HMAC), DSAR export/delete, CCPA opt-out, `RetentionService.purgeExpired()` (`CONVERSATION_LOG_RETENTION_DAYS`).
- **Moderation** — all AI + agent outbound passes `ModerationService.moderate()` (fail-safe = block; non-bypassable, NFR-013).
- **Tenant isolation** — `tenant_id` row scoping via `TenantContext` (AsyncLocalStorage) + `TenantContextInterceptor` + TypeORM `TenantSubscriber` auto-stamp; admin reads filtered by `user.tenantId`.

---

## 9. Reference

[README.md](README.md) · [SPEC.md](SPEC.md) · [CLAUDE.md](CLAUDE.md) ·
[CHANGELOG.md](CHANGELOG.md) · [docs/guide/DEPLOYMENT-STRATEGY.md](docs/guide/DEPLOYMENT-STRATEGY.md) ·
[docs/guide/STAGING-DEPLOY.md](docs/guide/STAGING-DEPLOY.md) ·
`secrets/staging-server.md` (local-only) · `standards/` · `reference/`.
