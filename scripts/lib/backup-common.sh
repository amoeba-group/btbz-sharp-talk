#!/usr/bin/env bash
# Helpers shared by backup / restore / restore-drill (PLN-261012 SG-81). Sourced, never run.
# Pure bash + openssl + coreutils: a customer host is not guaranteed to have Node.

# One cipher definition for all three scripts: an archive written by backup must be
# readable by restore, and a drift between two copies would be found by a failed
# restore — the worst possible moment.
BK_CIPHER_ARGS=(enc -aes-256-cbc -pbkdf2 -iter 600000 -salt)

# Validates the key file; prints the reason and returns 2 when it is unusable.
#   bk_validate_key_file <path>
bk_validate_key_file() {
  local key_file="$1" key_len perms
  command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl not found (needed for encrypted backups)" >&2; return 2; }
  [[ -f "$key_file" ]] || { echo "ERROR: BACKUP_ENCRYPT_KEY_FILE '$key_file' does not exist" >&2; return 2; }
  key_len="$(head -n1 "$key_file" | tr -d '\r\n' | wc -c | tr -d '[:space:]')"
  if [[ "$key_len" -lt 32 ]]; then
    echo "ERROR: the key in $key_file is $key_len characters on its first line; at least 32 are required." >&2
    echo "       Generate one with: openssl rand -base64 48 > $key_file && chmod 600 $key_file" >&2
    return 2
  fi
  perms="$(stat -c '%a' "$key_file" 2>/dev/null || stat -f '%Lp' "$key_file" 2>/dev/null || true)"
  # BACKUP_SKIP_KEY_PERMS_CHECK=1 is for filesystems that have no Unix modes (a Windows
  # checkout under Git Bash reports 644 for everything). Never needed on a Linux host.
  if [[ -n "$perms" && "${perms: -2}" != "00" && "${BACKUP_SKIP_KEY_PERMS_CHECK:-}" != "1" ]]; then
    echo "ERROR: $key_file is mode $perms; group/other must have no access (chmod 600)." >&2
    return 2
  fi
}

# The stored file for an archive name: <name>.enc when encrypted, else <name>.
#   bk_src_file <backup-dir> <name>   → path (may not exist)
bk_src_file() {
  if [[ -f "$1/$2.enc" ]]; then printf '%s/%s.enc' "$1" "$2"; else printf '%s/%s' "$1" "$2"; fi
}

# True when the backup directory holds encrypted archives.
bk_is_encrypted() { compgen -G "$1/*.enc" >/dev/null; }

# Streams the PLAINTEXT of an archive to stdout, decrypting when needed.
#   bk_stream <backup-dir> <name> <key-file-or-empty>
bk_stream() {
  local f
  f="$(bk_src_file "$1" "$2")"
  if [[ "$f" == *.enc ]]; then
    [[ -n "${3:-}" ]] || { echo "ERROR: $f is encrypted; set BACKUP_ENCRYPT_KEY_FILE" >&2; return 2; }
    openssl "${BK_CIPHER_ARGS[@]}" -d -pass "file:$3" < "$f"
  else
    cat "$f"
  fi
}

# Verifies SHA256SUMS inside a backup directory. A backup that predates checksums gets a
# warning, not a failure — it is still restorable, just not verifiable.
#   bk_verify_checksums <backup-dir>
bk_verify_checksums() {
  local dir="$1"
  if [[ ! -f "$dir/SHA256SUMS" ]]; then
    echo "    WARNING: $dir has no SHA256SUMS (a backup from before checksums); integrity not verified." >&2
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$dir" && sha256sum -c SHA256SUMS)
  else
    (cd "$dir" && shasum -a 256 -c SHA256SUMS)
  fi
}

# Value of key=value from manifest.txt (empty when absent).
#   bk_manifest_get <backup-dir> <key>
bk_manifest_get() {
  [[ -f "$1/manifest.txt" ]] || return 0
  grep -E "^$2=" "$1/manifest.txt" | tail -1 | cut -d= -f2- | tr -d '\r' || true
}

# `count.<table>=N` lines from the manifest as "<table> <N>".
bk_manifest_counts() {
  [[ -f "$1/manifest.txt" ]] || return 0
  sed -n 's/^count\.\([a-z_]*\)=\([0-9][0-9]*\)\r\{0,1\}$/\1 \2/p' "$1/manifest.txt"
}
