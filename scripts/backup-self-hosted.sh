#!/usr/bin/env bash
# SharpTalk — back up a self-hosted deployment (PLN-260820 W4, PLN-261012 SG-81).
#
#   bash scripts/backup-self-hosted.sh [--dry-run] [destination-dir]
#
# THREE things are backed up, because the data lives in three places:
#   db.sql.gz              conversations, customers, settings
#   uploads.tar.gz         chat attachments and the widget logo
#   qdrant-snapshots.tar   the vector index (one Qdrant snapshot per collection)
#
# A database-only backup restores a system where every conversation still
# mentions a photo that no longer exists. That is the failure this script exists
# to prevent, so it refuses to finish if it only managed one of the first two.
# The vector index is DERIVED data (MySQL is the source of truth) and can be
# rebuilt by re-indexing — at the price of re-embedding every document with the
# paid embedding API — so it is backed up when it exists, and its absence is a
# warning, not a failure, unless BACKUP_QDRANT=on.
#
# Everything below is OFF unless you set it, so a plain run behaves exactly as before:
#
#   BACKUP_ENCRYPT_KEY_FILE=/etc/sharptalk/backup.key
#       Encrypt every archive with `openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt`
#       (files become *.enc). The key file holds one line of at least 32 characters and
#       must not be readable by group/other:  openssl rand -base64 48 > key && chmod 600 key
#       Store a copy of the key SOMEWHERE ELSE than next to the backups — a lost key is
#       a lost backup and nothing can recover it. openssl was chosen over gpg because it
#       is already required by gen-secrets.sh and needs no keyring or agent on a server.
#       Honest limit: CBC is unauthenticated, so SHA256SUMS catches corruption but not a
#       deliberate edit by someone who can rewrite both files; put offsite copies on
#       storage with object-lock/immutability if that matters. (No HMAC is written on
#       purpose: `openssl dgst -hmac` takes the key on the command line, where any local
#       user can read it from `ps`.)
#   BACKUP_KEEP_DAYS=14
#       After a SUCCESSFUL backup, delete sibling backup directories older than this
#       (only directories named like <YYYYMMDDTHHMMSSZ>[_label] that hold a manifest.txt,
#       and never the newest one).
#   BACKUP_QDRANT=auto|on|off          (default auto: on when Qdrant is configured and running)
#   BACKUP_LABEL=pre-1.4.0             suffix for the directory name (deploy --pre-backup uses it)
#   BACKUP_ROOT=/var/backups/sharptalk default parent of the dated directories
#                                      (default <repo>/backups)
#   MYSQL_CONTAINER / API_CONTAINER / QDRANT_CONTAINER   container names
#
# After a success it writes <parent>/LAST_SUCCESS, after a failure <parent>/LAST_FAILURE —
# files a monitor can check for freshness (a backup that silently stopped is the usual way
# one is found missing). A failed run removes its own half-written directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-sharptalk_mysql}"
API_CONTAINER="${API_CONTAINER:-sharptalk_api}"
QDRANT_CONTAINER="${QDRANT_CONTAINER:-sharptalk_qdrant}"
KEY_FILE="${BACKUP_ENCRYPT_KEY_FILE:-}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-}"
QDRANT_MODE="${BACKUP_QDRANT:-auto}"
LABEL="${BACKUP_LABEL:-}"
BACKUP_ROOT="${BACKUP_ROOT:-$REPO_ROOT/backups}"

dry_run=false
dest_arg=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) dest_arg="$1" ;;
  esac
  shift
done

# shellcheck source=lib/backup-common.sh
. "$SCRIPT_DIR/lib/backup-common.sh"
cipher_args=("${BK_CIPHER_ARGS[@]}")

# ---- validate what was asked for, before touching anything -------------------
if [[ -n "$KEEP_DAYS" && ! "$KEEP_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: BACKUP_KEEP_DAYS must be a positive integer, got '$KEEP_DAYS'" >&2
  exit 2
fi
case "$QDRANT_MODE" in auto|on|off) ;; *) echo "ERROR: BACKUP_QDRANT must be auto, on or off" >&2; exit 2 ;; esac
if [[ -n "$LABEL" ]]; then
  LABEL="$(printf '%s' "$LABEL" | tr -c 'A-Za-z0-9._-' '-')"
fi
if [[ -n "$KEY_FILE" ]]; then bk_validate_key_file "$KEY_FILE" || exit 2; fi

ts="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${dest_arg:-$BACKUP_ROOT/${ts}${LABEL:+_$LABEL}}"
PARENT="$(dirname "$DEST")"

say() { printf '%s\n' "$*"; }
# Mutating steps are announced instead of executed in --dry-run.
if [[ "$dry_run" == true ]]; then
  say "DRY RUN — nothing is written and no container is touched."
  say "==> Would back up to $DEST"
  say "    database   : docker exec $MYSQL_CONTAINER mysqldump --single-transaction … | gzip${KEY_FILE:+ | openssl enc (encrypted)} > db.sql.gz${KEY_FILE:+.enc}"
  say "    uploads    : docker exec $API_CONTAINER tar czf - /data/uploads${KEY_FILE:+ | openssl enc (encrypted)} > uploads.tar.gz${KEY_FILE:+.enc}"
  say "    qdrant     : mode=$QDRANT_MODE — one snapshot per collection via Qdrant's HTTP API (qdrant-snapshots.tar${KEY_FILE:+.enc})"
  say "    checksums  : SHA256SUMS"
  say "    read-back  : every archive is read back (decrypt + gzip -t) before it is called a backup"
  if [[ -n "$KEEP_DAYS" ]]; then
    say "    rotation   : delete sibling backups in $PARENT older than $KEEP_DAYS days"
  else
    say "    rotation   : off (BACKUP_KEEP_DAYS unset)"
  fi
  say "    status     : $PARENT/LAST_SUCCESS"
  exit 0
fi

mkdir -p "$PARENT"
created_dest=false
[[ -d "$DEST" ]] || created_dest=true
mkdir -p "$DEST"
echo "==> Backing up to $DEST"

# A failed run leaves a marker for the monitor and removes its own half-written
# directory, so nothing that looks like a backup is ever incomplete.
finish() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    printf '%s %s exit=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$DEST")" "$rc" > "$PARENT/LAST_FAILURE" 2>/dev/null || true
    if [[ "$created_dest" == true ]]; then rm -rf -- "$DEST"; fi
    echo "BACKUP FAILED (exit $rc) — see $PARENT/LAST_FAILURE" >&2
  fi
}
trap finish EXIT

# Streams stdin into <name>, encrypting when a key file was given. The archive is
# never written in the clear first — a crash mid-backup must not leave PII on disk.
emit() {
  local name="$1"
  if [[ -n "$KEY_FILE" ]]; then
    openssl "${cipher_args[@]}" -pass "file:$KEY_FILE" > "$DEST/$name.enc"
  else
    cat > "$DEST/$name"
  fi
}
stored() { [[ -n "$KEY_FILE" ]] && printf '%s.enc' "$1" || printf '%s' "$1"; }

# Reads an archive back the way a restore would. A backup that cannot be read is not one.
read_back() {
  local name="$1" f
  f="$DEST/$(stored "$name")"
  if [[ -n "$KEY_FILE" ]]; then
    openssl "${cipher_args[@]}" -d -pass "file:$KEY_FILE" < "$f" | gzip -t
  else
    gzip -t "$f"
  fi
}

# Row counts are taken BEFORE the dump, so the dump can only hold more rows than the
# manifest says (never fewer): the restore drill compares against them with that in mind.
# The SQL goes in on stdin: quoting it through `sh -lc '…'` is how a missing count
# silently becomes an empty manifest line. A table that does not exist makes the whole
# statement fail, which only costs the drill its row-count comparison — never the backup.
counts_sql="SELECT 'tenants', COUNT(*) FROM tenants UNION ALL SELECT 'users', COUNT(*) FROM users UNION ALL SELECT 'sessions', COUNT(*) FROM sessions UNION ALL SELECT 'conversations', COUNT(*) FROM conversations UNION ALL SELECT 'messages', COUNT(*) FROM messages UNION ALL SELECT 'kb_documents', COUNT(*) FROM kb_documents"
counts="$(docker exec -i "$MYSQL_CONTAINER" sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B "$MYSQL_DATABASE"' \
  <<< "$counts_sql" 2>/dev/null | tr -d '\r' | awk -F'\t' 'NF == 2 { printf "count.%s=%s\n", $1, $2 }' || true)"

# --single-transaction takes a consistent snapshot without locking the tables,
# so a backup does not stop customers from chatting while it runs.
echo "    database ..."
docker exec "$MYSQL_CONTAINER" sh -lc \
  'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  2>/dev/null | gzip | emit db.sql.gz

echo "    uploads ..."
docker exec "$API_CONTAINER" sh -lc 'cd /data/uploads && tar czf - .' | emit uploads.tar.gz

# ---- Qdrant ----------------------------------------------------------------
qdrant_note="skipped"
qdrant_collections=""
want_qdrant=false
case "$QDRANT_MODE" in
  on) want_qdrant=true ;;
  auto)
    if docker ps --format '{{.Names}}' | grep -qx "$QDRANT_CONTAINER" \
       && [[ -n "$(docker exec "$API_CONTAINER" sh -lc 'printf %s "${QDRANT_URL:-}"' 2>/dev/null || true)" ]]; then
      want_qdrant=true
    fi
    ;;
esac
if [[ "$want_qdrant" == true ]]; then
  echo "    qdrant ..."
  qtmp="/tmp/qdrant-backup-$$"
  # The helper runs inside the API container (it has Node and the network route to Qdrant);
  # the script itself is piped in, so nothing is installed or left behind.
  if qout="$(docker exec -i "$API_CONTAINER" node --input-type=module - backup "$qtmp" < "$SCRIPT_DIR/lib/qdrant-snapshot.mjs")"; then
    qdrant_collections="$(printf '%s\n' "$qout" | awk '/^QDRANT_COLLECTION /{printf "%s%s:%s", sep, $2, substr($3,8); sep=","}')"
    if [[ -n "$qdrant_collections" ]]; then
      docker exec "$API_CONTAINER" tar cf - -C "$qtmp" . | emit qdrant-snapshots.tar
      qdrant_note="ok"
    else
      qdrant_note="no collections"
    fi
    docker exec "$API_CONTAINER" rm -rf "$qtmp" >/dev/null 2>&1 || true
  else
    docker exec "$API_CONTAINER" rm -rf "$qtmp" >/dev/null 2>&1 || true
    if [[ "$QDRANT_MODE" == on ]]; then
      echo "FAIL — BACKUP_QDRANT=on and the Qdrant snapshot failed." >&2
      exit 1
    fi
    qdrant_note="FAILED (continuing: the index can be rebuilt by re-indexing)"
    echo "    WARNING: the Qdrant snapshot failed; the index is not in this backup." >&2
  fi
else
  echo "    qdrant : not backed up (mode=$QDRANT_MODE, not configured or not running)"
fi

# What the archives must agree about: every attachment row should have a file.
# The per-table counts let the restore drill tell a complete restore from a partial one.
rows="$(docker exec "$MYSQL_CONTAINER" sh -lc \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B "$MYSQL_DATABASE" -e "SELECT COUNT(*) FROM message_attachments"' \
  2>/dev/null | tr -d '[:space:]')"
files="$(docker exec "$API_CONTAINER" sh -lc 'find /data/uploads -type f | wc -l' | tr -d '[:space:]')"
{
  echo "taken_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  if [[ -f "$REPO_ROOT/VERSION" ]]; then echo "release=$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"; fi
  echo "attachment_rows=$rows"
  echo "upload_files=$files"
  if [[ -n "$KEY_FILE" ]]; then
    echo "encrypted=yes"
    echo "cipher=aes-256-cbc pbkdf2 iter=600000"
  else
    echo "encrypted=no"
  fi
  echo "qdrant=$qdrant_note"
  echo "qdrant_collections=$qdrant_collections"
  if [[ -n "$counts" ]]; then printf '%s\n' "$counts"; fi
} > "$DEST/manifest.txt"

for f in db.sql.gz uploads.tar.gz; do
  s="$DEST/$(stored "$f")"
  [[ -s "$s" ]] || { echo "FAIL — $(basename "$s") is empty. This backup cannot restore a working system." >&2; exit 1; }
done

echo "    reading every archive back ..."
read_back db.sql.gz || { echo "FAIL — db.sql.gz does not read back; this backup is unusable." >&2; exit 1; }
read_back uploads.tar.gz || { echo "FAIL — uploads.tar.gz does not read back; this backup is unusable." >&2; exit 1; }

{
  echo "db_bytes=$(wc -c < "$DEST/$(stored db.sql.gz)" | tr -d '[:space:]')"
  echo "uploads_bytes=$(wc -c < "$DEST/$(stored uploads.tar.gz)" | tr -d '[:space:]')"
} >> "$DEST/manifest.txt"

(
  cd "$DEST"
  files_to_sum=(manifest.txt)
  for f in db.sql.gz uploads.tar.gz qdrant-snapshots.tar; do
    [[ -f "$(stored "$f")" ]] && files_to_sum+=("$(stored "$f")")
  done
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "${files_to_sum[@]}" > SHA256SUMS
  else shasum -a 256 "${files_to_sum[@]}" > SHA256SUMS; fi
)
echo
echo "    attachment rows : $rows"
echo "    files on disk   : $files   (thumbnails make this larger than the row count)"
echo "    qdrant          : $qdrant_note ${qdrant_collections:+($qdrant_collections)}"
cat "$DEST/manifest.txt"

# ---- rotation (only after a backup that read back correctly) -----------------
if [[ -n "$KEEP_DAYS" ]]; then
  echo
  echo "==> Rotation: removing backups in $PARENT older than $KEEP_DAYS day(s)"
  removed=0
  while IFS= read -r old; do
    base="$(basename "$old")"
    [[ "$base" =~ ^[0-9]{8}T[0-9]{6}Z(_[A-Za-z0-9._-]+)?$ ]] || continue   # only dated backup directories
    [[ -f "$old/manifest.txt" ]] || continue                              # …that are really backups
    [[ "$(cd "$old" && pwd)" == "$(cd "$DEST" && pwd)" ]] && continue     # never the one just written
    rm -rf -- "$old"
    echo "    removed $base"
    removed=$((removed + 1))
  done < <(find "$PARENT" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" 2>/dev/null | sort)
  echo "    $removed old backup(s) removed"
fi

printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$DEST")" > "$PARENT/LAST_SUCCESS"
rm -f "$PARENT/LAST_FAILURE"

echo
echo "OK — backup written (database + uploads$([[ "$qdrant_note" == ok ]] && echo ' + qdrant')$([[ -n "$KEY_FILE" ]] && echo ', encrypted'))."
echo "    Copy $DEST somewhere that does not share a failure domain with this host."
