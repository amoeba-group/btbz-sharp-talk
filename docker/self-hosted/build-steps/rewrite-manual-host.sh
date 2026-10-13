#!/bin/sh
# Image build step (Dockerfile.web): replace Amoeba's staging host in the bundled
# manuals with this deployment's host (PLN-261012 SG-80).
#
#   sh rewrite-manual-host.sh <manual-dir> <bare.host.name>
#
# The manuals under apps/web/public/manual cite https://shoptalk.amoeba.site (staging)
# and https://sharptalk.amoeba.site (KR production) as their example URLs. Left alone,
# a customer's console tells their operators to use Amoeba's server. POSIX sh + sed
# only: it runs in an alpine build stage, and the scripts/__tests__ harness runs it too.
set -eu

dir="${1:-}"
host="${2:-}"

[ -n "$dir" ] || { echo "usage: $0 <manual-dir> <host>" >&2; exit 2; }
case "$host" in
  "" | *[!A-Za-z0-9.-]*)
    echo "MANUAL_HOST must be a bare host name (letters, digits, dots, dashes), got: '$host'" >&2
    exit 1
    ;;
esac

# No manuals directory is not an error: a trimmed build may omit it.
[ -d "$dir" ] || { echo "rewrite-manual-host: $dir not found, nothing to do"; exit 0; }

count=0
for f in "$dir"/*.html "$dir"/*.md; do
  [ -f "$f" ] || continue
  if grep -qE '(shoptalk|sharptalk)\.amoeba\.site' "$f"; then
    sed -i -E "s/(shoptalk|sharptalk)\\.amoeba\\.site/$host/g" "$f"
    count=$((count + 1))
  fi
done
echo "rewrite-manual-host: $count file(s) now cite $host"
