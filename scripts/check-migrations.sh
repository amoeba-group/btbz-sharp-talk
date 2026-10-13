#!/usr/bin/env bash
# Which schema migrations are still outstanding (PLN-260820 W3) — deploy-time.
#
#   bash scripts/check-migrations.sh
#   MYSQL_CONTAINER=sharptalk_mysql_staging bash scripts/check-migrations.sh
#
# Pure bash + the mysql client inside the database container, because a customer
# host is not guaranteed to have Node (the staging host does not). It reads the
# committed manifest sql/artefacts.tsv, which `npm run migrations:manifest`
# generates and CI keeps honest.
#
# It never applies anything. SQL is applied by a person, before the code that
# needs it (deploy standard 04 §3).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$REPO_ROOT/sql/artefacts.tsv"
CONTAINER="${MYSQL_CONTAINER:-sharptalk_mysql}"

[[ -f "$MANIFEST" ]] || { echo "ERROR: $MANIFEST not found (run: npm run migrations:manifest)" >&2; exit 2; }

# The database is named explicitly: a mysql client that has not selected one
# makes DATABASE() return NULL, and every information_schema filter on it comes
# back empty — a silent "nothing is applied" that looks like a broken database.
mysql_q() {
  local out status
  out="$(docker exec "$CONTAINER" sh -lc \
    "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N -B \"\$MYSQL_DATABASE\" -e \"$1\"" 2>/dev/null)"
  status=$?
  # A failed query must not look like an empty schema: that reads as "nothing is
  # applied" and would send an operator off to re-run 59 migrations.
  if [[ $status -ne 0 ]]; then
    echo "ERROR: schema query failed against '$CONTAINER'." >&2
    exit 2
  fi
  printf '%s\n' "$out" | grep -v '^mysql: \[Warning\]' || true
}

# One snapshot of the whole schema; 59 files x N artefacts would otherwise be
# hundreds of round trips.
SNAPSHOT="$(mktemp)"
trap 'rm -f "$SNAPSHOT"' EXIT
# Three columns, not CONCAT with escaped tabs: batch mode (-B) already separates
# columns with real tabs, and the escaping needed to smuggle a \t through two
# layers of shell quoting is exactly the kind of thing that silently produces
# 'columnt' and reports every migration as missing.
{
  mysql_q "SELECT 'column', TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
  mysql_q "SELECT DISTINCT 'index', TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()"
  mysql_q "SELECT 'table', TABLE_NAME, '-' FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
} > "$SNAPSHOT"

if [[ ! -s "$SNAPSHOT" ]]; then
  echo "ERROR: could not read the schema from container '$CONTAINER'." >&2
  echo "       Is the stack running? Set MYSQL_CONTAINER to point elsewhere." >&2
  exit 2
fi

applied=0; data_only=0
pending=(); partial=()

# Group the manifest by file: a file counts as applied only when every artefact
# it promises is actually there. All-or-nothing hides a half-applied migration,
# which is the state that produces the strangest bugs.
current=""; have=0; want=0; missing=""
flush() {
  [[ -z "$current" ]] && return 0
  if [[ "$want" -eq 0 ]]; then data_only=$((data_only + 1))
  elif [[ "$have" -eq "$want" ]]; then applied=$((applied + 1))
  elif [[ "$have" -eq 0 ]]; then pending+=("$current")
  else partial+=("$current|$missing")
  fi
}

while IFS=$'\t' read -r file kind table name; do
  [[ "$file" == \#* || -z "$file" ]] && continue
  name="${name%$'\r'}"   # a CRLF checkout (Windows) must not turn every artefact into "missing"
  if [[ "$file" != "$current" ]]; then
    flush
    current="$file"; have=0; want=0; missing=""
  fi
  [[ "$kind" == "data" ]] && continue
  want=$((want + 1))
  if grep -qxF "$kind"$'\t'"$table"$'\t'"$name" "$SNAPSHOT"; then
    have=$((have + 1))
  else
    missing="$missing $kind:$table.$name"
  fi
done < "$MANIFEST"
flush

echo
echo "migrations vs. $CONTAINER"
echo "  applied            : $applied"
echo "  data-only (unread) : $data_only"

if [[ ${#partial[@]} -gt 0 ]]; then
  echo
  echo "  PARTIALLY applied (${#partial[@]}) — look at these first:"
  for entry in "${partial[@]}"; do
    echo "    ${entry%%|*}"
    echo "      missing:${entry#*|}"
  done
fi

if [[ ${#pending[@]} -gt 0 ]]; then
  echo
  echo "  NOT applied (${#pending[@]}) — listed in RELEASE order, apply top to bottom:"
  # Release order (first appearance in git history, or the bundle's frozen
  # release-order.txt), not the filename order the manifest happens to use: the
  # undated migration_*.sql files are the oldest yet sort last (PLN-261012 SG-80).
  if [[ -f "$SCRIPT_DIR/lib/migrations.sh" ]]; then
    # shellcheck source=lib/migrations.sh
    . "$SCRIPT_DIR/lib/migrations.sh"
    while IFS= read -r f; do [[ -n "$f" ]] && echo "    sql/$f"; done \
      < <(printf '%s\n' "${pending[@]}" | migration_sort_release "$REPO_ROOT/sql")
  else
    for f in "${pending[@]}"; do echo "    sql/$f"; done
  fi
  echo
  echo "  Apply them BEFORE deploying the code, oldest first (the order they were"
  echo "  released). Filename order is NOT dependency order: several files use"
  echo "  AFTER <column> against a column a later-named file adds, so alphabetical"
  echo "  application fails. If one errors with \"Unknown column\", apply the file"
  echo "  that adds that column first and re-run it."
  echo "    docker exec -i $CONTAINER sh -lc 'mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" \"\$MYSQL_DATABASE\"' < sql/<file>"
fi

if [[ ${#pending[@]} -gt 0 || ${#partial[@]} -gt 0 ]]; then
  echo
  echo "FAIL — schema changes are outstanding."
  exit 1
fi
echo
echo "OK — every schema migration is present."
