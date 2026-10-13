#!/usr/bin/env bash
# Shared helpers for the self-hosted hosting scripts (PLN-261012 SG-80/81).
# Sourced, never executed. Pure bash + awk + (optionally) git: a customer host is
# not guaranteed to have Node, and this runs on the host.
#
#   migration_release_order <sql-dir>     migration file names, in RELEASE order
#   migration_class <file>                additive | additive-data | data | breaking | destructive | unknown
#   migration_has_rollback <file>         yes | no
#   migration_rollback_text <file>        the documented rollback SQL, comment markers removed
#   migration_class_reason <file>         one-line why (for the operator)

# Strip SQL comments and collapse whitespace; upper-cases so matching is simple.
# Only a `--` that starts a line or follows whitespace is a comment (a `--` inside
# a regex literal such as '[\w-]--' must survive), and `#` only counts at line start
# — the same rule scripts/check-migrations.mjs uses to find artefacts.
_mig_normalise() {
  awk '
    BEGIN { inblock = 0 }
    {
      line = $0
      sub(/[[:cntrl:]]+$/, "", line)   # a CRLF checkout leaves a trailing CR
      out = ""
      while (length(line) > 0) {
        if (inblock) {
          i = index(line, "*/")
          if (i == 0) { line = ""; break }
          line = substr(line, i + 2); inblock = 0; continue
        }
        # Whichever comes first on the line wins: a "/*" inside a `-- ...` comment
        # (e.g. "America/*") must not open a block that never closes.
        b = index(line, "/*")
        c = 0
        if (match(line, /(^|[[:blank:]])--([[:blank:]]|$)/)) c = RSTART
        else if (match(line, /^[[:blank:]]*#/)) c = RSTART
        if (c > 0 && (b == 0 || c < b)) { out = out substr(line, 1, c - 1); line = ""; break }
        if (b > 0) { out = out substr(line, 1, b - 1); line = substr(line, b + 2); inblock = 1; continue }
        out = out line; line = ""; break
      }
      printf "%s ", out
    }
    END { print "" }
  ' "$1" | tr '[:lower:]' '[:upper:]' | tr -s '[:blank:]' ' '
}

# -- Classification -----------------------------------------------------------
#
# The question a rollback has to answer is not "can this SQL be undone" but "does
# the PREVIOUS code still work against the schema this migration left behind":
#
#   additive       new tables, nullable/defaulted columns, indexes. Old code ignores
#                  them — a code-only rollback is safe, the SQL stays.
#   additive-data  additive plus a backfill (UPDATE/INSERT). Same, but the data
#                  changes are not undone by anything.
#   data           UPDATE/INSERT only. Not blocking; the rows stay as they are.
#   breaking       ADD COLUMN ... NOT NULL with no DEFAULT: new code is fine, but the
#                  OLD code's INSERTs omit the column and start failing.
#   destructive    DROP / MODIFY / CHANGE / RENAME / TRUNCATE / DELETE FROM: either
#                  data is gone or a column the old code reads has changed shape.
#   unknown        nothing recognisable (comment-only, or DDL this classifier does
#                  not know) — treated as blocking so a surprise is never silent.
migration_class() {
  _mig_normalise "$1" | awk '
    { u = u $0 }
    END {
      destructive = 0; breaking = 0; ddl = 0; dml = 0

      if (u ~ /DROP (COLUMN|TABLE|INDEX|KEY|PRIMARY|FOREIGN|CONSTRAINT|CHECK|VIEW)/) destructive = 1
      if (u ~ /(^|[ ,(;])MODIFY /)                 destructive = 1
      if (u ~ /[ ,]CHANGE (COLUMN )?[`A-Z0-9_]/)   destructive = 1
      if (u ~ /(^|[ ;])RENAME /)                   destructive = 1
      if (u ~ /(^|[ ;])TRUNCATE /)                 destructive = 1
      if (u ~ /(^|[ ;])DELETE FROM /)              destructive = 1

      if (u ~ /CREATE (UNIQUE |FULLTEXT |SPATIAL )?(TABLE|INDEX) /)       ddl = 1
      if (u ~ /ADD (COLUMN |UNIQUE |FULLTEXT |SPATIAL |INDEX |KEY )/)     ddl = 1

      # Clause boundaries: a comma that is followed by the next ALTER clause keyword
      # (a bare comma split would cut decimal(12,2) and string defaults in half).
      s = u
      gsub(/,[ ]*(ADD|DROP|MODIFY|CHANGE|ALTER|RENAME|ALGORITHM|LOCK) /, ";&", s)
      n = split(s, piece, ";")
      for (i = 1; i <= n; i++) {
        p = piece[i]
        sub(/^[ ,]+/, "", p)
        if (p ~ /^(UPDATE|INSERT|REPLACE) /) dml = 1
        if (match(p, /ADD (COLUMN )?(IF NOT EXISTS )?[`"A-Z0-9_]+ /)) {
          head = substr(p, RSTART, RLENGTH)
          if (head ~ /^ADD (INDEX|KEY|UNIQUE|FULLTEXT|SPATIAL|CONSTRAINT|FOREIGN|PRIMARY|CHECK) /) continue
          def = substr(p, RSTART + RLENGTH)
          if (def ~ /NOT NULL/ && def !~ /DEFAULT/ && def !~ /AUTO_INCREMENT/ && def !~ / AS \(/) breaking = 1
          ddl = 1
        }
      }

      if (destructive)        print "destructive"
      else if (breaking)      print "breaking"
      else if (ddl && dml)    print "additive-data"
      else if (ddl)           print "additive"
      else if (dml)           print "data"
      else                    print "unknown"
    }
  '
}

migration_class_reason() {
  case "$(migration_class "$1")" in
    additive)      echo "adds tables/columns/indexes only; previous code ignores them" ;;
    additive-data) echo "adds schema and backfills rows; previous code ignores the schema, the backfill is not undone" ;;
    data)          echo "changes rows only; nothing to roll back in the schema" ;;
    breaking)      echo "adds a NOT NULL column with no DEFAULT; previous code INSERTs would fail" ;;
    destructive)   echo "drops, renames, modifies or deletes; previous code or the data cannot be assumed intact" ;;
    *)             echo "no recognisable statements; cannot prove it is safe" ;;
  esac
}

migration_has_rollback() {
  if grep -qiE '^[[:space:]]*(--|#).*rollback' "$1"; then echo yes; else echo no; fi
}

# The documented rollback block: from the first comment line that mentions
# "rollback" to the end of the contiguous comment run, markers removed.
migration_rollback_text() {
  awk '
    { sub(/\r$/, "") }
    !on && /^[ \t]*(--|#).*[Rr][Oo][Ll][Ll][Bb][Aa][Cc][Kk]/ { on = 1 }
    on {
      if ($0 !~ /^[ \t]*(--|#)/) { exit }
      line = $0
      sub(/^[ \t]*(--|#)[ ]?/, "", line)
      print line
    }
  ' "$1"
}

# -- Release order ------------------------------------------------------------
#
# Filename order is NOT the order migrations were released: the undated
# `migration_*.sql` files are the OLDEST but sort after every `2608…` file, and
# several files use `AFTER <column>` against a column an earlier-released file
# adds. Applying alphabetically fails on "Unknown column" (RPT-260820 F-2).
#
# Release order = the order each file first appeared in git history. A bundle has
# no history, so build-release-bundle.sh freezes the order into
# `release-order.txt` next to sql/ and that file wins when present.
migration_release_order() {
  local dir="${1:-sql}" frozen
  frozen="$(dirname "$dir")/release-order.txt"
  if [[ -f "$frozen" ]]; then
    grep -v '^[[:space:]]*#' "$frozen" | tr -d '\r' | grep -v '^[[:space:]]*$'
    return 0
  fi
  local repo_root
  repo_root="$(cd "$dir/.." 2>/dev/null && pwd)" || repo_root=""
  if [[ -n "$repo_root" ]] && command -v git >/dev/null 2>&1 \
     && git -C "$repo_root" rev-parse --git-dir >/dev/null 2>&1 \
     && [[ -n "$(git -C "$repo_root" log -1 --format=%H 2>/dev/null)" ]]; then
    # One `git log` for every file: commit time, then the .sql paths added in that
    # commit. The earliest time a path was ADDED wins; ties fall back to name.
    local rel
    rel="$(basename "$dir")"
    git -C "$repo_root" log --diff-filter=A --name-only --format='@@%ct' -- "$rel/*.sql" 2>/dev/null \
      | awk -v dir="$rel/" '
          /^@@/ { ts = substr($0, 3); next }
          NF == 0 { next }
          { f = $0; sub("^" dir, "", f); if (!(f in first) || ts + 0 < first[f] + 0) first[f] = ts }
          END { for (f in first) print first[f] "\t" f }
        ' | sort -t "$(printf '\t')" -k1,1n -k2,2 | cut -f2 \
      | while IFS= read -r f; do [[ -f "$dir/$f" ]] && printf '%s\n' "$f"; done
    # Files present on disk but never added in history (an uncommitted new file).
    local listed
    listed="$(mktemp)"
    git -C "$repo_root" log --diff-filter=A --name-only --format= -- "$rel/*.sql" 2>/dev/null \
      | sed "s#^$rel/##" | sort -u > "$listed"
    (cd "$dir" && ls -1 ./*.sql 2>/dev/null | sed 's#^\./##' | sort) | grep -vxFf "$listed" || true
    rm -f "$listed"
    return 0
  fi
  (cd "$dir" && ls -1 ./*.sql 2>/dev/null | sed 's#^\./##' | sort)
}

# Reorders the file names on stdin into release order. Names unknown to the order
# list sort last, by name — never dropped.
migration_sort_release() {
  local dir="${1:-sql}" order
  order="$(mktemp)"
  migration_release_order "$dir" > "$order"
  awk -v ordfile="$order" '
    BEGIN { while ((getline l < ordfile) > 0) { gsub(/\r$/, "", l); rank[l] = ++n } }
    { name = $0; sub(/^sql\//, "", name); r = (name in rank) ? rank[name] : 999999; printf "%d\t%s\n", r, $0 }
  ' | sort -t "$(printf '\t')" -k1,1n -k2,2 | cut -f2
  rm -f "$order"
}
