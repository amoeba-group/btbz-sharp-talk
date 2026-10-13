#!/usr/bin/env bash
# SharpTalk — roll a self-hosted deployment back to the previous release (PLN-261012 SG-81).
#
#   bash scripts/rollback-self-hosted.sh --dry-run            # show what would happen (do this first)
#   bash scripts/rollback-self-hosted.sh                      # roll back to the previous release
#   bash scripts/rollback-self-hosted.sh --to 1.3.2           # roll back to a specific release
#   bash scripts/rollback-self-hosted.sh --allow-irreversible # accept a blocking migration (see below)
#   bash scripts/rollback-self-hosted.sh --yes                # no typed confirmation
#
# A rollback here is: run the PREVIOUS IMAGES again. The database is not touched.
# That is only safe when the previous code still works against the schema the newer
# release left behind, so before doing anything this script reads the migration lists
# recorded at deploy time (releases/<version>/migrations.tsv) and looks at every
# migration applied BETWEEN the two releases:
#
#   additive / additive-data / data   safe — the old code ignores new tables, columns, indexes.
#                                     The SQL stays; the documented rollback SQL is shown for
#                                     reference only (run it after the old code is up, and only
#                                     if you have a reason).
#   breaking                          NOT safe — a NOT NULL column with no DEFAULT: the old code's
#                                     INSERTs omit it and start failing.
#   destructive                       NOT safe — DROP / MODIFY / CHANGE / RENAME / TRUNCATE / DELETE:
#                                     a column the old code reads changed shape, or data is gone.
#   unknown / no record               cannot be proven safe, so it is treated as not safe.
#
# When anything blocking is in between this script REFUSES (exit 3). The right move then is
# the backup taken before the release (deploy-self-hosted.sh --pre-backup) restored with
# restore-self-hosted.sh together with the previous images — or fixing forward.
# --allow-irreversible overrides the refusal for someone who has read the list and accepts it.
#
# Images must still be on the host: a bundle deploy loads them, a host build tags them with
# the release version, and neither removes the previous ones. `docker image prune -a` would.
#
# Environment: SHARPTALK_STATE_DIR (default docker/self-hosted), SHARPTALK_ENV_FILE,
#              SHARPTALK_IMAGE_PREFIX, MYSQL_CONTAINER, API_CONTAINER.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="docker/self-hosted/docker-compose.self-hosted.yml"
ENV_FILE="${SHARPTALK_ENV_FILE:-docker/self-hosted/.env.self-hosted}"
STATE_DIR="${SHARPTALK_STATE_DIR:-docker/self-hosted}"
API_CONTAINER="${API_CONTAINER:-sharptalk_api}"
# shellcheck source=lib/migrations.sh
. "$SCRIPT_DIR/lib/migrations.sh"

dry_run=false
assume_yes=false
allow_irreversible=false
target=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --yes) assume_yes=true ;;
    --allow-irreversible) allow_irreversible=true ;;
    --to) target="${2:-}"; [[ -n "$target" ]] || { echo "--to needs a version" >&2; exit 2; }; shift ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

envval() {
  local key="$1" default="${2:-}" value
  value="${!key:-}"
  if [[ -z "$value" && -f "$ENV_FILE" ]]; then
    value="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  fi
  printf '%s' "${value:-$default}"
}
image_prefix="$(envval SHARPTALK_IMAGE_PREFIX sharptalk)"

LOG="$STATE_DIR/releases.log"
[[ -f "$LOG" ]] || {
  echo "ERROR: $LOG not found — no release has been recorded on this host by deploy-self-hosted.sh," >&2
  echo "       so there is nothing to roll back to. (First deploy with the new script, then this works.)" >&2
  exit 1
}

# Releases that actually served traffic, oldest first, consecutive duplicates collapsed.
history="$(awk -F'\t' '$5 == "deployed" || $5 == "rolledback" { if ($2 != last) print $2; last = $2 }' "$LOG")"
current="$(printf '%s\n' "$history" | tail -n1)"
[[ -n "$current" ]] || { echo "ERROR: no deployed release in $LOG" >&2; exit 1; }
if [[ -z "$target" ]]; then
  target="$(printf '%s\n' "$history" | grep -vxF "$current" | tail -n1 || true)"
  [[ -n "$target" ]] || { echo "ERROR: there is no earlier release than $current in $LOG to roll back to." >&2; exit 1; }
fi
[[ "$target" != "$current" ]] || { echo "ERROR: $target is already the current release." >&2; exit 1; }
printf '%s\n' "$history" | grep -qxF "$target" || {
  echo "WARNING: $target was never recorded as deployed on this host; the image check below decides." >&2
}

echo "==> Rollback plan"
echo "    current release : $current"
echo "    roll back to    : $target   (images ${image_prefix}/{api,web,widget}:${target})"

# ---- what changed in the database between the two --------------------------------
cur_tsv="$STATE_DIR/releases/$current/migrations.tsv"
tgt_tsv="$STATE_DIR/releases/$target/migrations.tsv"
blocking=0
echo
echo "==> Migrations applied between $target and $current"
if [[ ! -f "$cur_tsv" ]]; then
  echo "    no migration record for $current ($cur_tsv) — cannot tell what it changed."
  blocking=1
elif [[ ! -f "$tgt_tsv" ]]; then
  echo "    no migration record for $target ($tgt_tsv) — cannot tell which migrations it predates."
  echo "    (A release deployed before this script existed has none.)"
  blocking=1
else
  between="$(awk -F'\t' 'NR == FNR { have[$1] = 1; next } !($1 in have) { print }' "$tgt_tsv" "$cur_tsv")"
  if [[ -z "$between" ]]; then
    echo "    none — the two releases have the same schema. A code-only rollback is safe."
  else
    printf '    %-48s %-14s %s\n' "migration" "class" "rollback SQL documented"
    while IFS=$'\t' read -r file klass has_rb; do
      [[ -n "$file" ]] || continue
      verdict=""
      case "$klass" in
        additive|additive-data|data) verdict="" ;;
        *) verdict="  <-- BLOCKS a code-only rollback"; blocking=$((blocking + 1)) ;;
      esac
      printf '    %-48s %-14s %s%s\n' "$file" "$klass" "$has_rb" "$verdict"
    done <<< "$between"

    echo
    echo "    SQL rollback guidance (reference only — the previous code does not need it):"
    shown=0
    while IFS=$'\t' read -r file klass has_rb; do
      [[ -n "$file" ]] || continue
      if [[ "$has_rb" == yes && -f "sql/$file" ]]; then
        echo "    --- $file ($klass)"
        migration_rollback_text "sql/$file" | sed 's/^/        /'
        shown=$((shown + 1))
      fi
    done <<< "$between"
    [[ "$shown" -gt 0 ]] || echo "    (none of the migrations in between documents a rollback)"
  fi
fi

if [[ "$blocking" -gt 0 ]]; then
  echo
  if [[ "$allow_irreversible" == true ]]; then
    echo "!!  $blocking blocking item(s) above — proceeding ONLY because --allow-irreversible was given."
    echo "!!  The previous code may fail against the current schema. Have the pre-release backup at hand."
  else
    echo "REFUSED — the migration(s) above cannot be assumed compatible with $target's code." >&2
    echo "  Options:" >&2
    echo "    * restore the backup taken before $current (restore-self-hosted.sh) AND run $target's images" >&2
    echo "    * fix forward with a new release" >&2
    echo "    * if you have read the list and accept the risk: re-run with --allow-irreversible" >&2
    exit 3
  fi
fi

# ---- the images the rollback needs ------------------------------------------------
echo
echo "==> Images for $target"
if [[ "$dry_run" == true ]]; then
  for svc in api web widget; do echo "    [dry-run] docker image inspect ${image_prefix}/${svc}:${target}"; done
else
  missing_img=0
  for svc in api web widget; do
    if docker image inspect "${image_prefix}/${svc}:${target}" >/dev/null 2>&1; then
      echo "    present  ${image_prefix}/${svc}:${target}"
    else
      echo "    MISSING  ${image_prefix}/${svc}:${target}"
      missing_img=1
    fi
  done
  if [[ "$missing_img" == 1 ]]; then
    echo "ERROR: the previous images are gone from this host (pruned?). Load the previous bundle" >&2
    echo "       (deploy-self-hosted.sh --bundle <previous-bundle>) or rebuild that commit." >&2
    exit 1
  fi
fi

if [[ "$dry_run" == true ]]; then
  echo
  echo "==> [dry-run] would run:"
  echo "    SHARPTALK_VERSION=$target docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d --no-build"
  echo "    SHARPTALK_VERSION=$target docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d --no-deps --force-recreate nginx"
  echo "    verify: health ok · running image ${image_prefix}/api:${target} · boot log 'successfully started'"
  echo "    append '$target rolledback' to $LOG"
  echo
  echo "Dry run finished: nothing was changed."
  exit 0
fi

if [[ "$assume_yes" != true ]]; then
  read -r -p "Type ROLLBACK to run $target instead of $current: " confirm
  [[ "$confirm" == "ROLLBACK" ]] || { echo "aborted"; exit 1; }
fi

export SHARPTALK_VERSION="$target"
export SHARPTALK_IMAGE_PREFIX="$image_prefix"
# Absolute, for the compose file's `env_file: ${SHARPTALK_ENV_FILE:-./.env.self-hosted}`.
SHARPTALK_ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
export SHARPTALK_ENV_FILE
echo
echo "==> Starting $target (no build)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-build
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps --force-recreate nginx

echo
echo "==> Verifying"
port="$(envval HTTP_PORT 8080)"
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:${port}/api/v1/health" >/dev/null 2>&1; then break; fi
  sleep 5
done
health="$(curl -s "http://localhost:${port}/api/v1/health" || true)"
# 401 on a protected route = this API is serving (404 = a very old image, 502 = down).
route="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${port}/api/v1/auth/me" || true)"
booted="$(docker logs "$API_CONTAINER" 2>&1 | grep -c 'successfully started' || true)"
running="$(docker inspect -f '{{.Config.Image}}' "$API_CONTAINER" 2>/dev/null || true)"
echo "    health : ${health:-<no answer>}"
echo "    route  : $route  (401 expected on /api/v1/auth/me)"
echo "    image  : ${running:-<unknown>}  (expected ${image_prefix}/api:${target})"
echo "    boots  : $booted"
if [[ "$health" != *'"status":"ok"'* || "$route" != "401" || "$running" != "${image_prefix}/api:${target}" || "$booted" -lt 1 ]]; then
  echo "FAIL — the rollback started but the stack is not serving $target. docker logs $API_CONTAINER" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$target" "rollback" \
  "$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)" "rolledback" "from $current" >> "$LOG"
echo
echo "OK — now running $target (was $current). The database was not changed."
