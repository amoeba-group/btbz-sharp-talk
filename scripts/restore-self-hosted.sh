#!/usr/bin/env bash
# SharpTalk — restore a self-hosted deployment (PLN-260820 W4, PLN-261012 SG-81).
#
#   bash scripts/restore-self-hosted.sh [--dry-run] [--yes] [--skip-qdrant] <backup-dir>
#
# Restores BOTH archives and then checks they agree: an attachment row whose
# file is missing is a half-restored system, and it looks fine until someone
# opens a conversation from last month. If the backup holds a Qdrant snapshot it is
# restored too (otherwise re-index from the console — that re-embeds every document).
#
# Encrypted backups (*.enc) need BACKUP_ENCRYPT_KEY_FILE pointing at the key they were
# written with. SHA256SUMS is verified BEFORE anything is overwritten.
#
# This REPLACES live data. To rehearse a restore without touching the live stack — which
# is what you should be doing every quarter — use scripts/restore-drill-self-hosted.sh.
#
#   --dry-run       verify the backup and print what would happen; change nothing
#   --yes           do not ask for the typed RESTORE confirmation (automation)
#   --skip-qdrant   leave the vector index alone even if the backup has one
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-sharptalk_mysql}"
API_CONTAINER="${API_CONTAINER:-sharptalk_api}"
KEY_FILE="${BACKUP_ENCRYPT_KEY_FILE:-}"
# shellcheck source=lib/backup-common.sh
. "$SCRIPT_DIR/lib/backup-common.sh"

dry_run=false
assume_yes=false
skip_qdrant=false
SRC=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --yes) assume_yes=true ;;
    --skip-qdrant) skip_qdrant=true ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) SRC="$1" ;;
  esac
  shift
done

[[ -n "$SRC" && -d "$SRC" ]] || { echo "usage: $0 [--dry-run] [--yes] [--skip-qdrant] <backup-dir>" >&2; exit 2; }

for f in db.sql.gz uploads.tar.gz; do
  [[ -s "$(bk_src_file "$SRC" "$f")" ]] || { echo "ERROR: $SRC/$f (or $f.enc) is missing or empty" >&2; exit 1; }
done

encrypted=false
if bk_is_encrypted "$SRC"; then
  encrypted=true
  [[ -n "$KEY_FILE" ]] || { echo "ERROR: $SRC is encrypted; set BACKUP_ENCRYPT_KEY_FILE to its key." >&2; exit 2; }
  bk_validate_key_file "$KEY_FILE" || exit 2
else
  KEY_FILE=""
fi

echo "==> Verifying the backup before anything is overwritten"
bk_verify_checksums "$SRC" || { echo "FAIL — checksum mismatch: this backup is damaged or incomplete." >&2; exit 1; }
# Prove the key opens the archives (a wrong key would otherwise surface half-way through).
for f in db.sql.gz uploads.tar.gz; do
  bk_stream "$SRC" "$f" "$KEY_FILE" | gzip -t \
    || { echo "FAIL — $f cannot be read (wrong key, or a damaged archive)." >&2; exit 1; }
done
echo "    archives read back correctly (encrypted: $encrypted)"

has_qdrant=false
if [[ "$skip_qdrant" != true && -f "$(bk_src_file "$SRC" qdrant-snapshots.tar)" ]]; then has_qdrant=true; fi

if [[ "$dry_run" == true ]]; then
  echo
  echo "DRY RUN — the backup is intact; a real run would:"
  echo "    1. ask you to type RESTORE (unless --yes)"
  echo "    2. stop $API_CONTAINER"
  echo "    3. load db.sql.gz into $MYSQL_CONTAINER (replaces the database)"
  echo "    4. replace the uploads volume with uploads.tar.gz"
  echo "    5. start $API_CONTAINER and wait for it to be healthy"
  if [[ "$has_qdrant" == true ]]; then
    echo "    6. restore the Qdrant collections from qdrant-snapshots.tar (priority=snapshot)"
  else
    echo "    6. (no Qdrant restore: $([[ "$skip_qdrant" == true ]] && echo 'skipped by flag' || echo 'no snapshot in this backup') — re-index from the console)"
  fi
  echo "    7. check that every attachment row has a file and the table counts match manifest.txt"
  exit 0
fi

cat <<WARN
About to overwrite the database and the uploads volume of:
  mysql : $MYSQL_CONTAINER
  api   : $API_CONTAINER
from $SRC

This replaces live data. The API is stopped for the duration so nothing is
written while the two halves are out of step, and started again at the end.
WARN
if [[ "$assume_yes" != true ]]; then
  read -r -p "Type RESTORE to continue: " confirm
  [[ "$confirm" == "RESTORE" ]] || { echo "aborted"; exit 1; }
fi

# Telling the operator to stop the API was not enough: a conversation or an
# upload landing mid-restore leaves rows and files from different moments, which
# is exactly the inconsistency this script checks for at the end.
api_was_running=false
api_started=false
if docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER"; then
  api_was_running=true
  echo "==> Stopping $API_CONTAINER for the restore ..."
  docker stop "$API_CONTAINER" >/dev/null
fi
restart_api() {
  if [[ "$api_was_running" == true && "$api_started" != true ]]; then
    echo "==> Starting $API_CONTAINER ..."
    docker start "$API_CONTAINER" >/dev/null
  fi
}
trap restart_api EXIT

# The uploads helper runs in the API image (already on this host) instead of pulling
# `alpine:3` — a restore is exactly when the registry may be unreachable.
HELPER_IMAGE="${RESTORE_HELPER_IMAGE:-$(docker inspect -f '{{.Config.Image}}' "$API_CONTAINER")}"

echo "==> Restoring the database ..."
bk_stream "$SRC" db.sql.gz "$KEY_FILE" | gunzip | docker exec -i "$MYSQL_CONTAINER" sh -lc \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' 2>/dev/null

echo "==> Restoring uploads ..."
# A throwaway container mounted on the same volume, so the API can stay stopped.
# Cleared first: leaving the previous files behind would hide a backup that is
# actually missing them.
UPLOADS_VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/uploads"}}{{.Name}}{{end}}{{end}}' "$API_CONTAINER")"
[[ -n "$UPLOADS_VOLUME" ]] || { echo "ERROR: could not find the uploads volume on $API_CONTAINER" >&2; exit 1; }
bk_stream "$SRC" uploads.tar.gz "$KEY_FILE" | docker run --rm -i -v "$UPLOADS_VOLUME":/data/uploads "$HELPER_IMAGE" sh -lc \
  'rm -rf /data/uploads/* /data/uploads/.[!.]* 2>/dev/null; cd /data/uploads && tar xzf -'

# Start the API now (not only in the EXIT trap): the Qdrant step below needs it.
echo "==> Starting $API_CONTAINER ..."
docker start "$API_CONTAINER" >/dev/null
api_started=true

if [[ "$has_qdrant" == true ]]; then
  echo "==> Waiting for $API_CONTAINER, then restoring Qdrant ..."
  ready=false
  for _ in $(seq 1 24); do
    if docker exec "$API_CONTAINER" wget -qO- http://localhost:3000/api/v1/health >/dev/null 2>&1; then ready=true; break; fi
    sleep 5
  done
  if [[ "$ready" != true ]]; then
    echo "WARNING: $API_CONTAINER did not become healthy; skipped the Qdrant restore. Re-index from the console." >&2
  else
    qdir="/tmp/qdrant-restore-$$"
    docker exec "$API_CONTAINER" sh -c "rm -rf $qdir && mkdir -p $qdir"
    bk_stream "$SRC" qdrant-snapshots.tar "$KEY_FILE" | docker exec -i "$API_CONTAINER" tar xf - -C "$qdir"
    if docker exec -i "$API_CONTAINER" node --input-type=module - restore "$qdir" < "$SCRIPT_DIR/lib/qdrant-snapshot.mjs"; then
      echo "    Qdrant collections restored"
    else
      echo "WARNING: the Qdrant restore failed. The database and uploads ARE restored; re-index from the console." >&2
    fi
    docker exec "$API_CONTAINER" rm -rf "$qdir" >/dev/null 2>&1 || true
  fi
fi

echo "==> Checking the two halves agree ..."
# One listing of the volume and one query, compared in memory: the old version started a
# container PER attachment row, which is minutes for a busy tenant.
paths="$(mktemp)"; onvolume="$(mktemp)"
trap 'rm -f "$paths" "$onvolume"; restart_api' EXIT
docker exec "$MYSQL_CONTAINER" sh -lc \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B "$MYSQL_DATABASE" -e "SELECT storage_path FROM message_attachments"' \
  2>/dev/null | tr -d '\r' | sed '/^$/d' | sort -u > "$paths"
docker run --rm -v "$UPLOADS_VOLUME":/data/uploads "$HELPER_IMAGE" sh -lc \
  'cd /data/uploads && find . -type f | sed "s#^\./##"' | tr -d '\r' | sort -u > "$onvolume"
missing="$(comm -23 "$paths" "$onvolume" | wc -l | tr -d '[:space:]')"
rows="$(wc -l < "$paths" | tr -d '[:space:]')"

echo "    attachment rows      : $rows"
echo "    rows with no file    : $missing"

bad_counts=0
while read -r table expected; do
  [[ -n "$table" ]] || continue
  actual="$(docker exec "$MYSQL_CONTAINER" sh -lc \
    "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N -B \"\$MYSQL_DATABASE\" -e \"SELECT COUNT(*) FROM $table\"" 2>/dev/null | tr -d '[:space:]')"
  # The manifest counts were taken just BEFORE the dump, so the restored table can only be
  # larger — except for a purge running in between; allow a 1% shortfall.
  if ! [[ "$actual" =~ ^[0-9]+$ ]] || (( actual * 100 < expected * 99 )); then
    echo "    table $table: manifest says $expected, restored $actual   <-- MISMATCH"
    bad_counts=$((bad_counts + 1))
  else
    echo "    table $table: $actual (manifest $expected)"
  fi
done < <(bk_manifest_counts "$SRC")

if [[ "$missing" != "0" ]]; then
  echo
  echo "FAIL — $missing attachment(s) have no file on disk. The uploads archive does" >&2
  echo "       not match this database dump; they were probably taken at different times." >&2
  exit 1
fi
if [[ "$bad_counts" != "0" ]]; then
  echo
  echo "FAIL — $bad_counts table(s) came back with fewer rows than the backup recorded." >&2
  exit 1
fi

echo
echo "OK — database and uploads restored and consistent."
