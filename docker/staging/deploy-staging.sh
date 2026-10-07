#!/usr/bin/env bash
# btbz-SharpTalk — staging deploy. Amoeba Structure v2 §5.1 (deploy scripts mandatory).
set -euo pipefail

# Resolve repo root from this script's location (docker/staging/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="docker/staging/docker-compose.staging.yml"
ENV_FILE="docker/staging/.env.staging"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy docker/staging/.env.staging.example and fill it in." >&2
  exit 1
fi

# Optional: pull latest source before deploying.
# git pull --ff-only

echo "==> Building and starting staging stack..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

# Recreate (not reload) the edge nginx: nginx.conf is a single-FILE bind mount,
# and `git pull` replaces the file via rename (new inode) — a running container
# keeps the OLD inode, so `nginx -s reload` re-reads stale config (found
# 2026-08-02: new /app route silently missing after deploy). Recreating re-binds
# the mount to the current file; also re-resolves recreated upstream IPs.
echo "==> Recreating edge nginx (single-file bind mount goes stale on git pull)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate nginx

echo "==> Status:"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

# Post-deploy FAQ regression gate (PLN-261008). Off unless GOLDEN_GATE is set in
# .env.staging (e.g. GOLDEN_GATE=4:10). Runs in the background inside the new API
# container so the deploy is not held for the ~10 minutes a 44-question set takes;
# failures are mailed (AI_ALERT_EMAIL, default dev@amoeba.group). Never rolls back
# and never changes this script's exit code.
if grep -qE '^GOLDEN_GATE=.+' "$ENV_FILE"; then
  echo "==> Golden gate: waiting for the API to be healthy..."
  for _ in $(seq 1 24); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' sharptalk_api_staging 2>/dev/null)" == "healthy" ]] && break
    sleep 5
  done
  GATE_LABEL="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)"
  docker exec -d -e GATE_LABEL="$GATE_LABEL" -w /app/apps/api sharptalk_api_staging \
    sh -c 'node dist/database/golden-gate.js > /tmp/golden-gate.log 2>&1' \
    && echo "==> Golden gate started in background (log: docker exec sharptalk_api_staging cat /tmp/golden-gate.log)" \
    || echo "WARN: golden gate could not be started"
fi
