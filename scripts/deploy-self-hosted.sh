#!/usr/bin/env bash
# SharpTalk — deploy into a customer's own infrastructure (PLN-260820 W3, PLN-261012 SG-80/81).
#
#   bash scripts/deploy-self-hosted.sh                      # check, then build on this host and deploy
#   bash scripts/deploy-self-hosted.sh --check              # check only, change nothing
#   bash scripts/deploy-self-hosted.sh --bundle <dir>       # deploy a release bundle (no build, no internet)
#   bash scripts/deploy-self-hosted.sh --dry-run [...]      # print every action, run none of them
#   bash scripts/deploy-self-hosted.sh --pre-backup         # take a backup right before changing anything
#   bash scripts/deploy-self-hosted.sh --golden-gate        # run the FAQ regression gate after the deploy
#   bash scripts/deploy-self-hosted.sh --version 1.4.0      # image tag for a host build (default: git describe)
#   bash scripts/deploy-self-hosted.sh --skip-migration-check   # last resort
#
# Order matters and is enforced here: SQL first, code second. Old code against a
# new column is harmless; new code against an old schema is a 500 on every
# request that touches it (deploy standard 04 §3). This script never applies
# SQL — it stops and tells you what is outstanding.
#
# The migration check now also runs on the FIRST install (it used to be skipped,
# "the schema comes from init-sql"): the database container is started alone, the
# check compares what init-sql actually built with sql/artefacts.tsv, and the app
# containers are only started when nothing is outstanding. That is what would have
# caught the six migrations that never reached docker/init-sql (REQ-261012 D-18).
#
# Environment (all optional):
#   SHARPTALK_ENV_FILE     env file path (default docker/self-hosted/.env.self-hosted)
#   SHARPTALK_STATE_DIR    where releases.log and per-release records live. Keep it OUTSIDE a
#                          release bundle directory, or a rollback cannot find the previous
#                          release (default docker/self-hosted)
#   SHARPTALK_VERSION      image tag, same as --version
#   SHARPTALK_IMAGE_PREFIX image name prefix (default sharptalk), same as in the compose file
#   MYSQL_CONTAINER / API_CONTAINER   container names (defaults sharptalk_mysql / sharptalk_api)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="docker/self-hosted/docker-compose.self-hosted.yml"
ENV_FILE="${SHARPTALK_ENV_FILE:-docker/self-hosted/.env.self-hosted}"
CONFIG_FILE="docker/self-hosted/widget-config.js"
STATE_DIR="${SHARPTALK_STATE_DIR:-docker/self-hosted}"
export MYSQL_CONTAINER="${MYSQL_CONTAINER:-sharptalk_mysql}"
export API_CONTAINER="${API_CONTAINER:-sharptalk_api}"

check_only=false
skip_migrations=false
dry_run=false
bundle_dir=""
pre_backup=false
golden_gate=false
version_arg=""

# The header comment is the manual: print it up to the first non-comment line.
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }
ORIG_ARGS=("$@")

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) check_only=true ;;
    --skip-migration-check) skip_migrations=true ;;
    --dry-run) dry_run=true ;;
    --pre-backup) pre_backup=true ;;
    --golden-gate) golden_gate=true ;;
    --bundle) bundle_dir="${2:-}"; [[ -n "$bundle_dir" ]] || { echo "--bundle needs a directory" >&2; exit 2; }; shift ;;
    --version) version_arg="${2:-}"; [[ -n "$version_arg" ]] || { echo "--version needs a value" >&2; exit 2; }; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# A bundle carries its own scripts, sql/ and manifest. Run THAT copy: the migration gate
# reads sql/artefacts.tsv relative to the script, and a gate from a different checkout
# would judge this release by another release's migrations.
if [[ -n "$bundle_dir" && -z "${SHARPTALK_REEXEC:-}" && -f "$bundle_dir/scripts/deploy-self-hosted.sh" ]]; then
  bundle_abs="$(cd "$bundle_dir" 2>/dev/null && pwd || true)"
  if [[ -n "$bundle_abs" && "$bundle_abs" != "$REPO_ROOT" ]]; then
    echo "==> Re-running the deploy script from inside the bundle ($bundle_abs)"
    SHARPTALK_REEXEC=1 exec bash "$bundle_abs/scripts/deploy-self-hosted.sh" "${ORIG_ARGS[@]}"
  fi
fi

step() { printf '\n==> %s\n' "$1"; }
# Every mutating command goes through here: --dry-run prints it, a real run executes it.
act() {
  if [[ "$dry_run" == true ]]; then
    printf '    [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}
# KEY from the process environment, else the env file (last occurrence), else the default.
envval() {
  local key="$1" default="${2:-}" value
  value="${!key:-}"
  if [[ -z "$value" && -f "$ENV_FILE" ]]; then
    value="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  fi
  printf '%s' "${value:-$default}"
}
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
sha_check() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -c "$@"; else shasum -a 256 -c "$@"; fi
}

if [[ "$dry_run" == true ]]; then
  echo "DRY RUN — nothing below is executed: no docker call, no file written."
fi

# One line per deploy outcome; scripts/rollback-self-hosted.sh reads it to find the previous
# release. TSV: time, version, mode, git sha, action (deployed|failed|rolledback), note.
record_release() {
  local action="$1" note="${2:-}"
  [[ "$dry_run" == true ]] && return 0
  mkdir -p "$STATE_DIR"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$version" "$mode" "$git_sha" "$action" "$note" \
    >> "$STATE_DIR/releases.log"
}

# ---- 1. configuration ------------------------------------------------------
step "Checking configuration"
[[ -f "$ENV_FILE" ]] || {
  echo "ERROR: $ENV_FILE not found." >&2
  echo "       cp docker/self-hosted/.env.self-hosted.example $ENV_FILE" >&2
  echo "       bash scripts/gen-secrets.sh   # fills in the secrets" >&2
  exit 1
}

# UPLOAD_DIR must match the volume mount, or attachments are written inside the
# container and vanish at the next upgrade — without an error, which is what
# makes it worth checking here rather than trusting.
upload_dir="$(grep -E '^UPLOAD_DIR=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
if [[ "$upload_dir" != "/data/uploads" ]]; then
  echo "ERROR: UPLOAD_DIR is '${upload_dir:-unset}', but the compose file mounts the" >&2
  echo "       uploads volume at /data/uploads. Attachments would be written to" >&2
  echo "       container storage and lost on the next deploy." >&2
  exit 1
fi

for required in JWT_ACCESS_SECRET JWT_REFRESH_SECRET CRED_ENC_KEY DB_PASSWORD APP_PUBLIC_URL; do
  value="$(grep -E "^${required}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  [[ -n "$value" ]] || { echo "ERROR: $required is empty in $ENV_FILE" >&2; exit 1; }
done

# Bootstrap identity (PLN-261012 SG-80). The seed is configurable so this install
# does not boot with Amoeba's tenant and mailboxes; refuse the half-configured case
# here, where it is cheap, instead of as a seed failure buried in the API log.
if [[ "$(envval SEED_ON_BOOT)" == "true" ]]; then
  seed_slug="$(envval SEED_TENANT_SLUG)"
  if [[ -n "$seed_slug" && "$seed_slug" != "ivyusa" ]]; then
    [[ -n "$(envval SEED_TENANT_DOMAIN)" ]] || {
      echo "ERROR: SEED_TENANT_SLUG=$seed_slug needs SEED_TENANT_DOMAIN (the widget identifies the tenant by it)." >&2
      exit 1
    }
    if [[ -z "$(envval SEED_ADMIN_EMAIL)" || -z "$(envval SEED_MASTER_EMAIL)" ]]; then
      echo "ERROR: SEED_TENANT_SLUG=$seed_slug needs SEED_ADMIN_EMAIL and SEED_MASTER_EMAIL —" >&2
      echo "       the defaults are Amoeba's own mailboxes." >&2
      exit 1
    fi
  fi
  if [[ -z "$(envval SEED_ADMIN_PASSWORD)" && -z "$(envval SEED_PASSWORD)" ]]; then
    echo "    note: no SEED_PASSWORD — a one-time password is generated and printed ONCE in:"
    echo "          docker logs $API_CONTAINER 2>&1 | grep -A4 'SEED CREDENTIALS'"
  fi
fi
if [[ -z "$(envval AI_ALERT_EMAIL)" && -z "$(envval ALERT_EMAIL_TO)" ]]; then
  echo "    warning: neither AI_ALERT_EMAIL nor ALERT_EMAIL_TO is set — AI credit and golden-gate"
  echo "             alerts will only appear in the API log (no Amoeba default any more)."
fi
echo "    configuration looks complete"

# The compose file's `env_file:` reads ${SHARPTALK_ENV_FILE:-./.env.self-hosted}, resolved
# against the compose file's own directory — so hand it an ABSOLUTE path, or a config kept
# outside the release directory would be silently ignored by the api container.
SHARPTALK_ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
export SHARPTALK_ENV_FILE

# ---- 2. what is being deployed ---------------------------------------------
step "Release"
mode="build"
if [[ -n "$bundle_dir" ]]; then
  mode="bundle"
  [[ -d "$bundle_dir" ]] || { echo "ERROR: bundle directory '$bundle_dir' not found" >&2; exit 1; }
  bundle_dir="$(cd "$bundle_dir" && pwd)"
  [[ -f "$bundle_dir/VERSION" && -f "$bundle_dir/SHA256SUMS" ]] || {
    echo "ERROR: $bundle_dir is not a release bundle (VERSION / SHA256SUMS missing)." >&2
    exit 1
  }
  version="$(tr -d '[:space:]' < "$bundle_dir/VERSION")"
  # The bundle was built for some image prefix and some API base; honour the first
  # unless the operator chose otherwise, and refuse a console that points elsewhere.
  if [[ -f "$bundle_dir/build.env" ]]; then
    b_prefix="$(grep -E '^SHARPTALK_IMAGE_PREFIX=' "$bundle_dir/build.env" | tail -1 | cut -d= -f2- || true)"
    b_api="$(grep -E '^VITE_API_BASE_URL=' "$bundle_dir/build.env" | tail -1 | cut -d= -f2- || true)"
    [[ -n "${SHARPTALK_IMAGE_PREFIX:-}" || -z "$b_prefix" ]] || export SHARPTALK_IMAGE_PREFIX="$b_prefix"
    if [[ "$b_api" =~ ^https?:// && "$b_api" != "$(envval VITE_API_BASE_URL)" ]]; then
      echo "ERROR: this bundle's console was built for API base $b_api," >&2
      echo "       but VITE_API_BASE_URL in $ENV_FILE is '$(envval VITE_API_BASE_URL)'." >&2
      exit 1
    fi
  fi
else
  version="${version_arg:-${SHARPTALK_VERSION:-}}"
  if [[ -z "$version" ]]; then
    version="$(git -C "$REPO_ROOT" describe --tags --always --dirty 2>/dev/null || true)"
    version="${version:-local-$(date -u +%Y%m%d%H%M%S)}"
  fi
fi
# A docker tag allows [A-Za-z0-9_.-] only and must not start with . or -.
version="$(printf '%s' "$version" | tr -c 'A-Za-z0-9_.-' '-' | sed -E 's/^[.-]+//')"
[[ -n "$version" ]] || { echo "ERROR: could not derive a version tag; pass --version" >&2; exit 1; }
export SHARPTALK_VERSION="$version"
image_prefix="$(envval SHARPTALK_IMAGE_PREFIX sharptalk)"
export SHARPTALK_IMAGE_PREFIX="$image_prefix"
git_sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "    mode    : $mode"
echo "    version : $version   (images ${image_prefix}/{api,web,widget}:${version})"
[[ "$mode" == bundle ]] && echo "    bundle  : $bundle_dir"

# The manuals bundled with the console cite a host; use this deployment's own.
if [[ -z "${MANUAL_HOST:-}" ]]; then
  MANUAL_HOST="$(envval APP_PUBLIC_URL | sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://##; s#[/:?#].*$##')"
  export MANUAL_HOST
fi

# ---- 3. bundle integrity -----------------------------------------------------
if [[ "$mode" == bundle ]]; then
  step "Verifying the bundle's checksums"
  # Read-only, so it runs in --dry-run and --check as well: a tampered or truncated
  # bundle must be found before anything is loaded or started.
  if ! (cd "$bundle_dir" && sha_check SHA256SUMS); then
    echo "ERROR: checksum verification failed — do not deploy this bundle." >&2
    echo "       Copy it again from the source, or ask the sender for a fresh one." >&2
    exit 1
  fi
fi

# ---- 4. widget runtime config ---------------------------------------------
step "Widget runtime config"
api_base="$(grep -E '^VITE_API_BASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
[[ -n "$api_base" ]] || { echo "ERROR: VITE_API_BASE_URL is empty in $ENV_FILE" >&2; exit 1; }
if [[ "$check_only" == true || "$dry_run" == true ]]; then
  # --check promises to change nothing, and nginx serves this file straight from
  # the host mount: writing it here would repoint a LIVE widget during what the
  # operator was told is a dry run.
  echo "    apiBase would be $api_base (not written in --check / --dry-run mode)"
else
  cat > "$CONFIG_FILE" <<CONFIG
/* Generated by scripts/deploy-self-hosted.sh — do not edit by hand. */
window.__SHOPTALK_CONFIG__ = { apiBase: "${api_base}" };
CONFIG
  echo "    apiBase = $api_base"
fi

# ---- 5. images (bundle) ------------------------------------------------------
if [[ "$mode" == bundle && "$check_only" != true ]]; then
  step "Loading images from the bundle"
  shopt -s nullglob
  tars=("$bundle_dir"/images/*.tar)
  shopt -u nullglob
  [[ ${#tars[@]} -gt 0 ]] || { echo "ERROR: no images/*.tar in $bundle_dir" >&2; exit 1; }
  for t in "${tars[@]}"; do
    act docker load -i "$t"
  done
fi

# ---- 6. migration gate -----------------------------------------------------
db_running=false
if [[ "$dry_run" == true ]]; then
  # No docker call at all in a dry run; say what would be decided.
  echo
  echo "    [dry-run] would test whether '$MYSQL_CONTAINER' is running to choose the gate below"
elif docker ps --format '{{.Names}}' | grep -qx "$MYSQL_CONTAINER"; then
  db_running=true
fi

if [[ "$skip_migrations" == true ]]; then
  echo
  echo "!!  Skipping the migration check. Only do this when you have just applied"
  echo "!!  the SQL by hand and know what is in the database."
elif [[ "$dry_run" == true ]]; then
  step "Migration gate (planned)"
  echo "    [dry-run] if the database is already running: bash scripts/check-migrations.sh"
  echo "    [dry-run] if this is a first install:"
  echo "    [dry-run]   docker compose ... up -d mysql          (database only, images already present)"
  echo "    [dry-run]   wait until $MYSQL_CONTAINER is healthy"
  echo "    [dry-run]   bash scripts/check-migrations.sh        (init-sql vs sql/artefacts.tsv)"
  echo "    [dry-run]   stop here when anything is outstanding; the app containers are not started"
elif [[ "$db_running" == true ]]; then
  step "Checking for outstanding schema migrations"
  if ! bash scripts/check-migrations.sh; then
    echo "Apply the SQL above, then run this script again." >&2
    exit 1
  fi
elif [[ "$check_only" == true ]]; then
  echo
  echo "    Database container '$MYSQL_CONTAINER' is not running — first install."
  echo "    A real deploy starts it alone and runs the migration check against what"
  echo "    docker/init-sql built, before any app container is started."
else
  step "First install — building the schema from docker/init-sql, then checking it"
  echo "    Database container '$MYSQL_CONTAINER' is not running."
  compose up -d mysql
  echo -n "    waiting for $MYSQL_CONTAINER to become healthy "
  healthy=false
  for _ in $(seq 1 60); do
    if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$MYSQL_CONTAINER" 2>/dev/null || true)" == "healthy" ]]; then
      healthy=true
      break
    fi
    printf '.'
    sleep 5
  done
  echo
  [[ "$healthy" == true ]] || { echo "ERROR: $MYSQL_CONTAINER did not become healthy. docker logs $MYSQL_CONTAINER" >&2; exit 1; }
  # init-sql runs on the first boot of an EMPTY data directory, and the server accepts
  # connections for a moment before it has finished: give the check a second chance.
  if ! bash scripts/check-migrations.sh; then
    sleep 10
    if ! bash scripts/check-migrations.sh; then
      echo >&2
      echo "FIRST INSTALL STOPPED: docker/init-sql is behind sql/ (the list above)." >&2
      echo "  The database is running with what init-sql built; the app containers were NOT started." >&2
      echo "  Apply the listed SQL in the order shown, then run this script again." >&2
      echo "  (A developer can reproduce this with: npm run initsql:check)" >&2
      exit 1
    fi
  fi
fi

if [[ "$check_only" == true ]]; then
  step "Check-only mode: nothing was deployed"
  exit 0
fi

# ---- 7. backup first --------------------------------------------------------
if [[ "$pre_backup" == true ]]; then
  step "Pre-release backup"
  if [[ "$db_running" == true || "$dry_run" == true ]]; then
    act env BACKUP_LABEL="pre-${version}" bash scripts/backup-self-hosted.sh
  else
    echo "    first install — there is nothing to back up yet"
  fi
fi

# ---- 8. start --------------------------------------------------------------
if [[ "$mode" == bundle ]]; then
  step "Starting the stack from the loaded images (no build)"
  act docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-build
else
  step "Building and starting the stack"
  # --env-file is mandatory: without it the VITE_* build args are empty and the
  # browser bundles are baked pointing at the wrong API.
  act docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
fi
# nginx.conf is a single-FILE bind mount: a `git pull` replaces the file with a new
# inode and a running container keeps the old one, so a reload re-reads stale config
# (found on staging, 2026-08-02). Recreating re-binds it. --no-deps: without it compose
# recreates api/web/widget along with nginx — a second API restart for nothing. Never
# --remove-orphans: other stacks may share the compose project name on a shared host.
act docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps --force-recreate nginx

# ---- 9. verify -------------------------------------------------------------
step "Verifying"
port="$(grep -E '^HTTP_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
port="${port:-8080}"

if [[ "$dry_run" == true ]]; then
  echo "    [dry-run] would wait up to 5 minutes for http://localhost:${port}/api/v1/health"
  echo "    [dry-run] would check: health status ok · /widget/ 200 · / 200 · /api/v1/auth/me 401 · boot log 'successfully started'"
  echo "    [dry-run] would check the running image is ${image_prefix}/api:${version}"
else
  echo -n "    waiting for the API to report healthy "
  for _ in $(seq 1 60); do
    if curl -sf "http://localhost:${port}/api/v1/health" >/dev/null 2>&1; then break; fi
    printf '.'
    sleep 5
  done
  echo

  # Exit codes lie about deployments: a container can be up with the previous
  # image. Check what the running system actually says (deploy standard 04).
  health="$(curl -s "http://localhost:${port}/api/v1/health" || true)"
  widget="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${port}/widget/" || true)"
  console="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${port}/" || true)"
  # A PROTECTED route answers 401 when the new code is serving: 404 means the old image
  # is still running, 502 that the API is down. /health is public liveness only (it
  # does not even touch the database), so it cannot tell these apart.
  route="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${port}/api/v1/auth/me" || true)"
  # API_CONTAINER, not a hardcoded name: the rehearsal that proved this script
  # works ran under different container names and reported "0 boots" for a stack
  # that had booted fine.
  booted="$(docker logs "${API_CONTAINER:-sharptalk_api}" 2>&1 | grep -c 'successfully started' || true)"
  running_image="$(docker inspect -f '{{.Config.Image}}' "$API_CONTAINER" 2>/dev/null || true)"
  expected_image="${image_prefix}/api:${version}"

  echo "    health   : ${health:-<no answer>}"
  echo "    widget   : $widget  (200 expected)"
  echo "    console  : $console  (200 expected)"
  echo "    api route: $route  (401 = deployed and serving · 404 = old code · 502 = API down)"
  echo "    boot log : $booted x 'successfully started'"
  echo "    image    : ${running_image:-<unknown>}  (expected $expected_image)"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

  if [[ "$health" != *'"status":"ok"'* || "$widget" != "200" || "$console" != "200" || "$route" != "401" || "$booted" -lt 1 \
        || "$running_image" != "$expected_image" ]]; then
    record_release failed "post-deploy verification"
    echo
    echo "FAIL — the stack started but is not serving the release it was asked to run. Check: docker logs $API_CONTAINER" >&2
    exit 1
  fi
fi

# ---- 10. record the release (what a rollback needs) -------------------------
step "Recording release $version"
if [[ "$dry_run" == true ]]; then
  echo "    [dry-run] would append to $STATE_DIR/releases.log and write $STATE_DIR/releases/$version/migrations.tsv"
else
  mkdir -p "$STATE_DIR/releases/$version"
  # shellcheck source=lib/migrations.sh
  . "$SCRIPT_DIR/lib/migrations.sh"
  if [[ "$mode" == bundle && -f "$bundle_dir/migrations.tsv" ]]; then
    cp "$bundle_dir/migrations.tsv" "$STATE_DIR/releases/$version/migrations.tsv"
  else
    : > "$STATE_DIR/releases/$version/migrations.tsv"
    while IFS= read -r f; do
      [[ -f "sql/$f" ]] || continue
      printf '%s\t%s\t%s\n' "$f" "$(migration_class "sql/$f")" "$(migration_has_rollback "sql/$f")" \
        >> "$STATE_DIR/releases/$version/migrations.tsv"
    done < <(migration_release_order sql)
  fi
  record_release deployed
  echo "    $STATE_DIR/releases.log updated"
fi

# ---- 11. golden gate (opt-in) ------------------------------------------------
if [[ "$golden_gate" == true ]]; then
  step "Golden gate (FAQ regression)"
  if [[ -z "$(envval GOLDEN_GATE)" ]]; then
    echo "    GOLDEN_GATE is empty in $ENV_FILE — nothing to run (format: tenantId:aiAgentId[,…])"
  elif [[ "$dry_run" == true ]]; then
    echo "    [dry-run] docker exec -d -e GATE_LABEL=$version -w /app/apps/api $API_CONTAINER sh -c 'node dist/database/golden-gate.js > /tmp/golden-gate.log 2>&1'"
  else
    # Runs in the background inside the new API container so the deploy is not held for
    # the ~10 minutes a 44-question set takes. It never rolls back and never changes this
    # script's exit code; failures are mailed to AI_ALERT_EMAIL / ALERT_EMAIL_TO.
    docker exec -d -e GATE_LABEL="$version" -w /app/apps/api "$API_CONTAINER" \
      sh -c 'node dist/database/golden-gate.js > /tmp/golden-gate.log 2>&1' \
      && echo "    started in the background — log: docker exec $API_CONTAINER cat /tmp/golden-gate.log" \
      || echo "    WARN: the golden gate could not be started"
  fi
fi

if [[ "$dry_run" == true ]]; then
  step "Dry run finished: nothing was changed"
  exit 0
fi

cat <<DONE

Deployed $version.

Next:
  * Point your TLS terminator at this host's HTTP port.
  * Sign in to the console and change the seeded password.
  * Set SEED_ON_BOOT=false and recreate the api container once the first sign-in is done.
  * Set up backups:  see docker/self-hosted/ops/ (cron or systemd timer)
  * Rollback if needed:  bash scripts/rollback-self-hosted.sh --dry-run
DONE
