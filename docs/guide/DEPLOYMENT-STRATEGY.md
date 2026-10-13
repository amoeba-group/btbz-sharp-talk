# Deployment Strategy — btbz-SharpTalk (배포 전략)

| | |
|---|---|
| Doc ID | CHATWIDGET-DEPLOY-STRATEGY-1.0.0 |
| Updated | 2026-07-16 |
| Scope | Branch→environment model, promotion flow, per-env config policy, TLS, rollback, production plan |
| Companion | [STAGING-DEPLOY.md](STAGING-DEPLOY.md) (step-by-step runbook) · [../../CONFIG.md](../../CONFIG.md) (env/config reference) · `secrets/staging-server.md` (host access, local-only) |

> This is the **strategy** (what/why/when). The **how** (exact commands) lives in the staging
> runbook and `docker/*/deploy-*.sh`. No secrets here — real values live in gitignored env files.

---

## 1. Environments (환경)

| | **Development** | **Staging** | **Production** |
|---|---|---|---|
| Purpose | local dev/test | integration, demo, UAT | live customers |
| Status | local | **🟢 LIVE** `shoptalk.amoeba.site` | **🟢 LIVE 2026-09-14** `sharptalk.amoeba.site` — second stack on the staging host (self-hosted stack, :8081, MySQL 127.0.0.1:3318, dir `~/sharptalk-production`, branch `production`) |
| Branch | `feature/*` | `main` | `production` (planned) |
| Schema | `synchronize` + `db:seed` | `synchronize` + `SEED_ON_BOOT` | init-sql migrations (`synchronize=false`) |
| Demo data | yes | yes (`SEED_DEMO_DATA=true`) | **no** (`SEED_DEMO_DATA=false`) |
| Restart policy | — | `unless-stopped` | `always` |
| DB/queue host ports | exposed | mysql `:3317` only | **none** (internal network) |
| AI provider | stub | stub (Anthropic optional) | anthropic (real key) |
| TLS | — | host nginx + Let's Encrypt → docker nginx `:8080` | TBD |
| Compose | `docker/docker-compose.dev.yml` | `docker/staging/docker-compose.staging.yml` | `docker/production/docker-compose.production.yml` |

**Country deployments (2026-09-13, PLN-260913)** — one deployment (staging + production) per country, built on the
self-hosted stack (`docker/self-hosted/`), aliased `SharpTalk-{CC | CC-Customer}`; the code is always `main`
(**SharpTalk-Basic**). Profiles live in `deploy/profiles/<alias>/`. Guides:
[Basic setup](GUIDE-260913-SharpTalk-Basic-Setup.md) · [Locale customization](GUIDE-260913-Locale-Customization.md) ·
[SharpTalk-VN-Go2Joy](GUIDE-260913-SharpTalk-VN-Go2Joy-Staging.md) · [SharpTalk-USA-IVY](GUIDE-260913-SharpTalk-USA-IVY-Staging.md).

---

## 2. Branch → environment model (브랜치 전략)

```
feature/*  ──PR+squash──▶  main  ──(promote)──▶  production
   │                        │                        │
  local dev             STAGING auto-              PRODUCTION
  (npm run dev)         redeploy target            (tagged release)
```

- **`feature/*`** — branched from `main`; developed locally. PR → **squash-merge to `main`** (1 approval on protected branches).
- **`main`** — default / **staging integration** branch. Staging server tracks `main`; redeploy after merge.
- **`production`** — production release branch (planned). Promote by merging/tagging a vetted `main` commit; never commit directly.
- Hotfix: `hotfix/*` from the affected branch → PR back.

> **Lesson learned (staging history):** avoid deploying long-lived feature branches directly to
> the shared staging host — it caused branch drift and duplicated commits (see `secrets/staging-server.md`).
> Policy: **staging deploys from `main`**; only deploy a branch for a short, deliberate preview,
> then return the server to `main` (`git checkout main && git pull && bash docker/staging/deploy-staging.sh`).

---

## 3. Promotion flow (승격 흐름)

1. **Dev** — `npm run db:up && npm run db:seed && npm run dev`; `npm run typecheck && npm test && npm run build` green.
2. **PR → main** — squash-merge after review + CI. `main` must stay build-green.
3. **Staging** — on the host: `git pull` (on `main`) → `bash docker/staging/deploy-staging.sh` → verify `/api/v1/health` = `ok` (public liveness only — it does not touch the DB), a protected route (`/api/v1/auth/me`) = 401, admin login, widget RAG. UAT/demo here.
4. **Production** (planned) — promote the vetted commit to `production`; provision host + `.env.production`; `bash docker/production/deploy-production.sh`; smoke-test; turn `SEED_ON_BOOT` off.

Each step is a gate: don't promote a commit that hasn't passed the prior environment.

---

## 4. Build & runtime model (빌드·런타임)

- **Monorepo build in-image**: Docker build context = repo root (`../..`) so Turbo compiles the whole workspace; root `.dockerignore` keeps host `node_modules`/`dist` out.
- **Customer infrastructure ships as a release bundle** (PLN-261012 SG-80): `scripts/build-release-bundle.sh` builds the images once (pinned bases, `npm ci`, tags `<prefix>/{api,web,widget}:<version>`), saves them with `SHA256SUMS`, `manifest.json` and the classified migration list; the host runs `deploy-self-hosted.sh --bundle` with no registry, no internet and no build. Operator manual: [RUNBOOK-261013-Go2Joy-SelfHosted](RUNBOOK-261013-Go2Joy-SelfHosted.md).
- **Frontend is build-time baked**: `VITE_API_BASE_URL` (+ widget `VITE_BASE=/widget/`) are compiled into the static bundle — changing the API URL requires a **web/widget rebuild**, not just a restart.
- **Edge nginx** routes `/`→web, `/api/`→api, `/widget`→widget, using the docker DNS resolver + variable `proxy_pass` so recreated containers (new IPs) don't cause stale 404/502.
- **Health gating**: `GET /api/v1/health` (liveness + DB readiness) drives the api container healthcheck; web/nginx `depends_on` api health.

---

## 5. Schema & bootstrap policy (스키마·부트스트랩)

| | Staging | Production |
|---|---|---|
| Schema source | TypeORM `synchronize=true` (no init-sql mount) | init-sql `docker/init-sql/01-schema.sql`, `synchronize=false` (migrations; `npm run initsql:check` keeps it equal to `sql/artefacts.tsv`) |
| Bootstrap | `SEED_ON_BOOT=true` on first boot → **set `false` after** | `SEED_ON_BOOT=true` first boot → **set `false` after**, strong `SEED_PASSWORD`, `SEED_DEMO_DATA=false` |

- Seed is **idempotent**: creates tenant `ivyusa` + `admin@`/`dev@` (must-change-password) and backfills `tenant_id`. Customer deployments set `SEED_TENANT_SLUG/NAME/DOMAIN`, `SEED_ADMIN_EMAIL`, `SEED_MASTER_EMAIL` instead and, in production with no `SEED_PASSWORD`, get generated one-time passwords printed once in the API log (PLN-261012 SG-80).
- **Critical policy — keep `SEED_ON_BOOT=false` after first boot.** With it left on, restarts re-seed and **reset `admin@`/`dev@` to `SEED_PASSWORD`**, silently reverting in-app password changes ("password drift" — see staging history). Rotate credentials via the app change-password / temp-password flow, not re-seed.

---

## 6. TLS / DNS (스테이징)

- Staging host is **shared** (also runs acm/tac prod containers). **Host nginx (1.18) owns 80/443** — do **not** install Caddy or bind those ports from docker.
- Pattern: docker nginx publishes `:8080`; host nginx vhost `shoptalk.amoeba.site` reverse-proxies `127.0.0.1:8080`; Let's Encrypt (`certbot --nginx`) issues the cert + HTTP→HTTPS 301; certbot auto-renews.
- Production TLS: same host-nginx-vhost pattern, or a cloud LB terminating TLS → the production nginx.

---

## 7. Rollback (롤백)

```bash
git checkout <previous-good-commit>
bash docker/staging/deploy-staging.sh        # or deploy-production.sh
```
- Data volumes (`sharptalk_mysql_*_data` (staging physical names stay `staging_ivy_*`, pinned via `name:`), redis, rabbitmq) **persist** across redeploys — rollback is code-only, data survives.
- Full wipe (staging only): `docker compose -f docker/staging/docker-compose.staging.yml down -v`.
- **Self-hosted / customer stacks**: use `scripts/rollback-self-hosted.sh` (previous image tag; it reads the migrations applied between the two releases and refuses when one is not reversible — see the runbook §7). `git checkout` + redeploy above is the staging/production-stack procedure.
- **Gotcha:** editing `nginx.conf` needs `up -d --force-recreate nginx` (bind-mounted config isn't hot-reloaded).

---

## 8. Shopify configuration (연동 설정)

- Features are **default-safe/disabled** when keys are unset (OAuth → 501, webhooks accept unverified in dev).
- Per-shop config lives on the server `.env` (never committed): `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (also verifies App Proxy signatures), `SHOPIFY_WEBHOOK_SECRET` (HMAC), `SHOPIFY_SCOPES`, `SHOPIFY_APP_URL`, `SHOPIFY_SYNC_INTERVAL_MIN`.
- Partner-side (manual): add OAuth redirect `…/api/v1/auth/shopify/callback`; App Proxy prefix `apps`/subpath `ivy` → `…/api/v1/shopify/proxy`; approve install to store the tenant access token.
- Tenant `shop_domain` is set via `PUT /tenants/me/shopify` or Settings UI; native webhooks/OAuth operate per-shop regardless.

---

## 9. Current state & production plan (현황·프로덕션 계획)

**Staging — LIVE** (`main`): admin `/`, widget `/widget/`; Shopify OAuth + App Proxy + sync + webhooks verified against `ambshop-dev.myshopify.com`. `SEED_ON_BOOT=false`.

### Staging server access (접속 정보 — 패스워드 제외)
> ⚠️ Passwords / SSH passwords / SEED_PASSWORD / Shopify secrets are **not** here — they live in
> `secrets/staging-server.md` (gitignored, local-only) and the server's `.env.staging`.

| | |
|---|---|
| Host (IP) | `211.110.140.172` |
| DNS | `shoptalk.amoeba.site` |
| SSH user | `shoptalk` |
| SSH key | `secrets/ssh/ivy_staging_ed25519` (private, gitignored) |
| Deploy path | `/home/shoptalk/btbz-sharptalk` |
| Repo | `github.com/amoeba-group/btbz-sharp-talk.git` |
| Public web | `https://shoptalk.amoeba.site/` (admin console) |
| Public widget | `https://shoptalk.amoeba.site/widget/` |
| Public API | `https://shoptalk.amoeba.site/api/v1` (health: `/api/v1/health`) |
| Edge | host nginx (TLS, LE) → docker nginx `:8080` |
| Host OS | Ubuntu · Docker + Compose · **shared host** (also runs acm/tac prod — do not touch 80/443 host nginx) |
| App logins | `admin@amoeba.group` (System Admin) · `dev@amoeba.group` (Tenant Master) — passwords in `secrets/` |

```bash
ssh -i secrets/ssh/ivy_staging_ed25519 shoptalk@211.110.140.172   # key auth (password auth also enabled)
cd /home/shoptalk/btbz-sharptalk && git pull            # on main
bash docker/staging/deploy-staging.sh
curl -s https://shoptalk.amoeba.site/api/v1/health               # {"status":"ok"} — liveness only; DB readiness is /health/ready (admin)
```

**Production — LIVE (2026-09-14, PLN-260913-Production-Provisioning-Deploy).** Runs as a second stack on the staging host until a dedicated host exists: `https://sharptalk.amoeba.site` → host nginx (LE cert, expires 2026-12-13, certbot.timer) → `127.0.0.1:8081` → `docker/self-hosted` stack in `/home/shoptalk/sharptalk-production` (containers `sharptalk_*`, MySQL `127.0.0.1:3318`, backups `~/backups/sharptalk-production/`). Deploy: `git pull --ff-only origin production && bash scripts/deploy-self-hosted.sh` (SQL first: `MYSQL_CONTAINER=sharptalk_mysql bash scripts/check-migrations.sh`). Secrets: `secrets/SharpTalk-KR-Production-server.md`. Original dedicated-host plan (kept for later):
1. Provision host (Docker + compose); DNS + TLS.
2. `cp docker/production/.env.production.example .env.production`; fill strong `DB_*`/`RABBITMQ_*`/`JWT_*`/`CRED_ENC_KEY`, real `ANTHROPIC_API_KEY`, strong `SEED_PASSWORD` (+ `SEED_DEMO_DATA=false`), `SHOPIFY_WEBHOOK_SECRET`, production `VITE_API_BASE_URL`.
3. Apply schema via init-sql; `bash docker/production/deploy-production.sh`; smoke-test; **turn `SEED_ON_BOOT` off**.
4. Create/promote the `production` branch and point production deploys at it.

---

## 10. Deploy-time checklist (배포 체크리스트)

- [ ] Target branch correct (staging = `main`); `git pull` done on host.
- [ ] `.env.{staging,production}` present with real secrets; `VITE_API_BASE_URL` matches the public URL.
- [ ] `npm run build` / `typecheck` / `test` green before merge.
- [ ] `bash docker/<env>/deploy-<env>.sh` → all containers healthy.
- [ ] `GET /api/v1/health` → `{"status":"ok"}` (liveness only); `GET /api/v1/auth/me` → 401 (404 = old code, 502 = API down); admin login OK; widget RAG OK.
- [ ] `SEED_ON_BOOT` reverted to `false` after first successful boot.
- [ ] nginx reloaded / `--force-recreate`d if config changed; TLS/DNS resolves.
