#!/usr/bin/env bash
# SharpTalk — restore DRILL for a self-hosted deployment (PLN-261012 SG-81).
#
#   bash scripts/restore-drill-self-hosted.sh [--dry-run] [--keep] <backup-dir>
#   bash scripts/restore-drill-self-hosted.sh [--dry-run] [--keep] --latest <backup-root>
#
# Proves a backup can actually be restored — WITHOUT touching the live stack. A backup
# nobody has restored is a hope, not a backup; run this against a recent backup every
# quarter (docker/self-hosted/ops/sharptalk-restore-drill.timer) and after any change to
# the backup scripts or the encryption key.
#
# What it does:
#   1. verifies SHA256SUMS and that every archive reads back (decrypting with
#      BACKUP_ENCRYPT_KEY_FILE when the backup is encrypted);
#   2. starts a THROWAWAY MySQL container (same image as the live one, no published port,
#      random root password) and loads db.sql.gz into it;
#   3. consistency checks on the restored copy:
#        - the table counts recorded in manifest.txt (taken just before the dump) are met
#          (1% shortfall tolerated for a purge that ran in between);
#        - every message_attachments row has a file in uploads.tar.gz (listed, not extracted
#          — attachment content never lands on this host's disk);
#        - sql/artefacts.tsv against the restored schema: pending migrations are REPORTED
#          (normal when the backup predates the current release), never a drill failure;
#        - qdrant-snapshots.tar, if present, holds one non-empty snapshot per collection
#          the manifest names;
#   4. removes the scratch container and appends the outcome to <backups>/DRILL_LOG.
#
#   --dry-run   verify the backup and print the plan; start nothing
#   --keep      leave the scratch container running afterwards for manual inspection
#               (docker rm -f <name> when you are done)
#   --latest R  drill the newest dated backup directory under R (what the timer runs)
#
# Exit 0 only when every check passed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-sharptalk_mysql}"
KEY_FILE="${BACKUP_ENCRYPT_KEY_FILE:-}"
# shellcheck source=lib/backup-common.sh
. "$SCRIPT_DIR/lib/backup-common.sh"

dry_run=false
keep=false
latest_root=""
SRC=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --keep) keep=true ;;
    --latest) latest_root="${2:-}"; [[ -n "$latest_root" ]] || { echo "--latest needs a directory" >&2; exit 2; }; shift ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) SRC="$1" ;;
  esac
  shift
done
if [[ -n "$latest_root" ]]; then
  # Names are UTC timestamps (YYYYMMDDTHHMMSSZ[_label]), so a plain sort is chronological.
  SRC="$latest_root/$(ls -1 "$latest_root" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z(_[A-Za-z0-9._-]+)?$' | sort | tail -n1)"
  [[ "$SRC" != "$latest_root/" ]] || { echo "ERROR: no dated backup directory under $latest_root" >&2; exit 1; }
fi
[[ -n "$SRC" && -d "$SRC" ]] || { echo "usage: $0 [--dry-run] [--keep] <backup-dir> | --latest <backup-root>" >&2; exit 2; }
SRC="$(cd "$SRC" && pwd)"

fails=0
pass() { printf '    PASS  %s\n' "$*"; }
fail() { printf '    FAIL  %s\n' "$*"; fails=$((fails + 1)); }
info() { printf '    info  %s\n' "$*"; }

echo "==> Restore drill for $SRC"

for f in db.sql.gz uploads.tar.gz; do
  [[ -s "$(bk_src_file "$SRC" "$f")" ]] || { echo "ERROR: $f (or $f.enc) is missing or empty in $SRC" >&2; exit 1; }
done
if bk_is_encrypted "$SRC"; then
  [[ -n "$KEY_FILE" ]] || { echo "ERROR: $SRC is encrypted; set BACKUP_ENCRYPT_KEY_FILE to its key." >&2; exit 2; }
  bk_validate_key_file "$KEY_FILE" || exit 2
else
  KEY_FILE=""
fi

echo "==> 1. Backup integrity"
if bk_verify_checksums "$SRC" >/dev/null; then pass "SHA256SUMS verified"; else fail "SHA256SUMS does not match the archives"; fi
for f in db.sql.gz uploads.tar.gz; do
  if bk_stream "$SRC" "$f" "$KEY_FILE" | gzip -t 2>/dev/null; then pass "$f reads back"; else fail "$f cannot be read (wrong key or damaged)"; fi
done
if (( fails > 0 )); then
  echo "DRILL FAILED before restoring anything: the backup itself is not usable." >&2
  exit 1
fi

MYSQL_IMAGE_USED="${DRILL_MYSQL_IMAGE:-}"
if [[ "$dry_run" == true ]]; then
  echo
  echo "DRY RUN — the backup is intact; a real drill would:"
  echo "    2. start a throwaway mysql container (image: ${MYSQL_IMAGE_USED:-same as $MYSQL_CONTAINER}), no published port"
  echo "    3. load db.sql.gz into it, then compare manifest table counts"
  echo "    4. list uploads.tar.gz and check every message_attachments row has a file"
  echo "    5. run scripts/check-migrations.sh against the restored schema (informational)"
  echo "    6. check qdrant-snapshots.tar (if present) against the manifest"
  echo "    7. remove the container and append the result to $(dirname "$SRC")/DRILL_LOG"
  exit 0
fi

if [[ -z "$MYSQL_IMAGE_USED" ]]; then
  MYSQL_IMAGE_USED="$(docker inspect -f '{{.Config.Image}}' "$MYSQL_CONTAINER" 2>/dev/null || true)"
fi
[[ -n "$MYSQL_IMAGE_USED" ]] || { echo "ERROR: cannot tell which mysql image to use; set DRILL_MYSQL_IMAGE" >&2; exit 2; }

NAME="sharptalk_drill_mysql_$(date -u +%Y%m%d%H%M%S)_$$"
DRILL_PW="$(openssl rand -hex 16)"
cleanup() {
  if [[ "$keep" == true ]]; then
    echo "    --keep: scratch container left running: docker rm -f $NAME"
  else
    docker rm -f "$NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "==> 2. Throwaway database ($NAME, image $MYSQL_IMAGE_USED)"
docker run -d --name "$NAME" --label sharptalk.drill=1 \
  -e MYSQL_ROOT_PASSWORD="$DRILL_PW" -e MYSQL_DATABASE=drill \
  "$MYSQL_IMAGE_USED" --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null
ready=false
for _ in $(seq 1 60); do
  # `mysqladmin ping` answers during the image's own init phase; a real query only works
  # once the final server is up.
  if docker exec "$NAME" mysql -uroot -p"$DRILL_PW" -N -B drill -e 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  sleep 3
done
[[ "$ready" == true ]] || { fail "the scratch database never came up"; echo "DRILL FAILED" >&2; exit 1; }

sql() { docker exec "$NAME" mysql -uroot -p"$DRILL_PW" -N -B drill -e "$1" 2>/dev/null | tr -d '\r'; }

echo "==> 3. Loading db.sql.gz"
if bk_stream "$SRC" db.sql.gz "$KEY_FILE" | gunzip | docker exec -i "$NAME" mysql -uroot -p"$DRILL_PW" drill 2>/dev/null; then
  pass "dump loads without error"
else
  fail "the dump failed to load"
fi
tables="$(sql "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'drill'" | tr -d '[:space:]')"
if [[ "$tables" =~ ^[0-9]+$ && "$tables" -gt 0 ]]; then pass "$tables tables restored"; else fail "no tables after the load"; fi

echo "==> 4. Row counts against manifest.txt"
counted=0
while read -r table expected; do
  [[ -n "$table" ]] || continue
  counted=$((counted + 1))
  actual="$(sql "SELECT COUNT(*) FROM $table" | tr -d '[:space:]')"
  if ! [[ "$actual" =~ ^[0-9]+$ ]]; then fail "$table: could not be counted"
  elif (( actual * 100 < expected * 99 )); then fail "$table: manifest $expected, restored $actual"
  else pass "$table: $actual rows (manifest $expected)"; fi
done < <(bk_manifest_counts "$SRC")
[[ "$counted" -gt 0 ]] || info "this backup has no row counts in its manifest (taken by an older backup script)"

echo "==> 5. Attachments against uploads.tar.gz"
paths="$(mktemp)"; listed="$(mktemp)"
trap 'rm -f "$paths" "$listed"; cleanup' EXIT
sql "SELECT storage_path FROM message_attachments" | sed '/^$/d' | sort -u > "$paths"
bk_stream "$SRC" uploads.tar.gz "$KEY_FILE" | tar tzf - 2>/dev/null | sed -e 's#^\./##' -e '/\/$/d' -e '/^$/d' | sort -u > "$listed"
rows="$(wc -l < "$paths" | tr -d '[:space:]')"
missing="$(comm -23 "$paths" "$listed" | wc -l | tr -d '[:space:]')"
if [[ "$missing" == "0" ]]; then pass "all $rows attachment rows have a file in the archive"; else fail "$missing of $rows attachment rows have NO file in the archive"; fi

echo "==> 6. Schema against this release's migrations"
if [[ -f "$SCRIPT_DIR/check-migrations.sh" && -f "$SCRIPT_DIR/../sql/artefacts.tsv" ]]; then
  if mig="$(MYSQL_CONTAINER="$NAME" bash "$SCRIPT_DIR/check-migrations.sh" 2>&1)"; then
    pass "no migration outstanding against the restored schema"
  else
    outstanding="$(printf '%s\n' "$mig" | grep -c '^    sql/' || true)"
    info "$outstanding migration(s) outstanding — expected when the backup predates this release;"
    info "apply them (oldest first) after a real restore, before starting the new code"
  fi
else
  info "check-migrations.sh / sql/artefacts.tsv not available here; skipped"
fi

echo "==> 7. Qdrant snapshots"
if [[ -f "$(bk_src_file "$SRC" qdrant-snapshots.tar)" ]]; then
  qlist="$(bk_stream "$SRC" qdrant-snapshots.tar "$KEY_FILE" | tar tf - 2>/dev/null | sed -e 's#^\./##' | grep '\.snapshot$' || true)"
  expected_cols="$(bk_manifest_get "$SRC" qdrant_collections | tr ',' '\n' | sed 's/:.*//' | sed '/^$/d')"
  if [[ -z "$qlist" ]]; then
    fail "qdrant-snapshots.tar holds no snapshot files"
  else
    for c in $expected_cols; do
      if printf '%s\n' "$qlist" | grep -qx "$c.snapshot"; then pass "snapshot for collection $c present"; else fail "snapshot for collection $c is missing"; fi
    done
    [[ -n "$expected_cols" ]] || info "manifest names no collections; found: $(printf '%s' "$qlist" | tr '\n' ' ')"
  fi
else
  info "no Qdrant snapshot in this backup — after a restore, re-index from the console (re-embeds every document)"
fi

result="PASS"
(( fails == 0 )) || result="FAIL($fails)"
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$SRC")" "$result" >> "$(dirname "$SRC")/DRILL_LOG" 2>/dev/null || true

echo
if (( fails == 0 )); then
  echo "DRILL PASSED — $(basename "$SRC") restores to a consistent copy. Recorded in $(dirname "$SRC")/DRILL_LOG."
else
  echo "DRILL FAILED — $fails check(s) failed. Do not rely on this backup; take a new one and investigate." >&2
  exit 1
fi
