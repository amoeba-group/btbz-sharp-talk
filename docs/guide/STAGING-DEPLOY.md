# Staging Deployment Runbook — btbz-SharpTalk

| | |
|---|---|
| Doc ID | CHATWIDGET-DEPLOY-STAGING-1.0.0 |
| Stack | Docker Compose (api, web, mysql, redis, rabbitmq, nginx) |
| Files | `docker/staging/` (compose, Dockerfile.api/web, nginx, deploy-staging.sh, .env.staging) |

## 1. Architecture (staging)
```
Internet ─▶ nginx (:8080→80)
              ├─ /api/  ─▶ api:3000  (NestJS, SEED_ON_BOOT self-bootstrap)
              └─ /      ─▶ web:80    (React SPA, built static)
api ─▶ mysql:3306 (TypeORM synchronize=true) · redis:6379 · rabbitmq:5672
```
- Schema: built by TypeORM **synchronize** at boot (no init-sql mount in staging).
- Bootstrap: **SEED_ON_BOOT=true** seeds tenant `ivyusa` + `admin@`/`dev@` accounts (must change password on first login). Set `SEED_DEMO_DATA=false` for a clean staging.

## 2. Pre-deploy checklist
- [ ] Docker + Docker Compose v2 installed on the staging host.
- [ ] `docker/staging/.env.staging` exists with REAL values (copy from `.env.staging.example`):
  - [ ] `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `RABBITMQ_PASSWORD` (+ matching `RABBITMQ_URL`)
  - [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (`openssl rand -hex 32`)
  - [ ] `CRED_ENC_KEY` = 32-byte base64 (`openssl rand -base64 32`)
  - [ ] `SEED_PASSWORD` (don't keep the default), `SEED_ON_BOOT=true`
  - [ ] `VITE_API_BASE_URL` = the public staging API URL (baked into the web image at build)
  - [ ] `ANTHROPIC_API_KEY` if using the real AI engine (else `AI_DEFAULT_PROVIDER=stub`)
  - [ ] `SHOPIFY_WEBHOOK_SECRET` if Shopify GDPR webhooks are wired
- [ ] DNS/TLS terminator points at the host (nginx publishes `:8080`; front it with TLS).
- [ ] `git pull` the target commit on the host.

## 3. Deploy
```bash
# from repo root on the staging host
bash docker/staging/deploy-staging.sh
# == docker compose -f docker/staging/docker-compose.staging.yml \
#      --env-file docker/staging/.env.staging up -d --build
```
First build compiles the monorepo (turbo) inside the images — allow a few minutes.

## 4. Verify
```bash
docker compose -f docker/staging/docker-compose.staging.yml ps        # all healthy
curl -s http://localhost:8080/api/v1/health                            # {"status":"ok","db":"up"}
curl -s -X POST http://localhost:8080/api/v1/auth/admin/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@amoeba.group","password":"<SEED_PASSWORD>"}'      # success:true
# Web: open http://<host>:8080/  (admin console)
```
- API healthcheck must report `db: up`. Compose `depends_on` gates web/nginx on api health.
- Confirm `SEED_ON_BOOT` ran (api logs: "SEED_ON_BOOT: seed applied.").

## 5. Operations
- Logs: `docker compose -f docker/staging/docker-compose.staging.yml logs -f api`
- Re-deploy a new commit: `git pull && bash docker/staging/deploy-staging.sh` (rebuilds changed images).
- Retention purge (manual): `POST /api/v1/privacy/retention/purge` as a system admin.
- DB access: host `:3317` → container mysql:3306 (staging convenience port).

## 6. Rollback
```bash
git checkout <previous-good-commit>
bash docker/staging/deploy-staging.sh
```
Data volumes (`sharptalk_mysql_staging_data` (physical `staging_ivy_mysql_staging_data`), …) persist across redeploys. To wipe staging data:
`docker compose -f docker/staging/docker-compose.staging.yml down -v`.

## 7. Notes / differences from production
- Staging: `DB_SYNCHRONIZE=false` since 2026-07-31 — schema changes are pre-applied from `sql/` before the code deploy (see the `pre-deploy-check` skill); demo data on, MySQL host port exposed.
- Production (`docker/production/`): `DB_SYNCHRONIZE=false`, schema via `init-sql` (`sql/01-schema.sql` DDL), no DB host port, `restart: always`. Bootstrap via `SEED_ON_BOOT` or a controlled seed; rotate all secrets.
